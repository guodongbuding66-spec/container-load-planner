import { toKilograms, toMillimeters, type LengthUnit, type WeightUnit } from "./units";
import type { ProductInput } from "./types";
import { EMPTY_ORDER_LINE } from "./order-lines";
import {parseCsvRecords, MAX_CSV_BYTES, MAX_CSV_ROWS} from "./csv";

export interface SmartImportRow {
  rowIndex: number;
  sku: string;
  name: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightKg: number;
  quantity: number;
  customer?: string;
  destination?: string;
  unloadStop?: number;
  errors: string[];
}

export interface SmartImportResult {
  rows: SmartImportRow[];
  detectedLengthUnit: LengthUnit;
  detectedWeightUnit: WeightUnit;
  unitHint?: "possible_cm" | "possible_in";
  headerMatched: boolean;
  validCount: number;
  errorCount: number;
}

const PALETTE = ["#0F766E", "#2563EB", "#D97706", "#7C3AED", "#DC2626", "#059669", "#0284C7", "#9333EA"];

type FieldKey =
  | "sku"
  | "name"
  | "dims"
  | "length"
  | "width"
  | "height"
  | "weight"
  | "quantity"
  | "customer"
  | "destination"
  | "unloadStop";

const HEADER_RULES: Array<{ key: FieldKey; pattern: RegExp }> = [
  { key: "sku", pattern: /^(sku|item(\s*no\.?|\s*code)?|model|货号|型号|编码|品号)$/i },
  { key: "name", pattern: /^(name|product(\s*name)?|description|desc|品名|产品名称|货物名称)$/i },
  { key: "dims", pattern: /^(size|dim(ension)?s?|l\s*[*x×]\s*w\s*[*x×]\s*h|外箱尺寸|箱规|尺寸|规格)$/i },
  { key: "length", pattern: /^(l|len(gth)?|长|外箱长)(\s*\([^)]+\))?$/i },
  { key: "width", pattern: /^(w|wid(th)?|宽|外箱宽)(\s*\([^)]+\))?$/i },
  { key: "height", pattern: /^(h|hei(ght)?|高|外箱高)(\s*\([^)]+\))?$/i },
  { key: "weight", pattern: /^(g\.?w\.?|gross(\s*weight)?|wt|weight|毛重|单箱毛重|重量)(\s*\([^)]+\))?$/i },
  { key: "quantity", pattern: /^(qty|quantity|ctns?|cartons?|pcs|boxes|箱数|数量|需求箱数|件数)$/i },
  { key: "customer", pattern: /^(customer|buyer|consignee|client|客户|收货人|买家)$/i },
  { key: "destination", pattern: /^(dest(ination)?|port|pod|目的港|目的地|站点)$/i },
  { key: "unloadStop", pattern: /^(stop|unload(\s*stop|\s*order)?|卸货顺序|卸货站点|顺序)$/i },
];

export function parseCombinedDimensions(raw: string): { l: number; w: number; h: number; unit?: LengthUnit } | null {
  const m = raw.trim().match(
    /^([+-]?\d+(?:\.\d+)?)\s*(mm|cm|m|in|"|″)?\s*[*x×X\/,]\s*([+-]?\d+(?:\.\d+)?)\s*(mm|cm|m|in|"|″)?\s*[*x×X\/,]\s*([+-]?\d+(?:\.\d+)?)\s*(mm|cm|m|in|"|″)?$/i,
  );
  if (!m) return null;
  const [l,w,h] = [m[1],m[3],m[5]].map(Number);
  if (![l,w,h].every(v => Number.isFinite(v) && v > 0)) return null;
  const explicit = [m[2],m[4],m[6]].filter(Boolean).map(v => /["″]/.test(v) ? "in" : v.toLowerCase());
  // Mixed unit axes must be split into explicit columns rather than silently using the last suffix.
  if (new Set(explicit).size > 1) return null;
  return {l,w,h,unit:explicit[0] as LengthUnit | undefined};
}

function detectUnitFromHeaders(headers: string[]): { length: LengthUnit; weight: WeightUnit } {
  const joined = headers.join(" ").toLowerCase();
  let length: LengthUnit = "mm";
  if (/\((in|inch|inches)\)|\binch\b/.test(joined)) length = "in";
  else if (/\(cm\)|\bcm\b/.test(joined)) length = "cm";
  else if (/\(m\)/.test(joined)) length = "m";

  let weight: WeightUnit = "kg";
  if (/\((lb|lbs)\)|\blbs?\b/.test(joined)) weight = "lb";
  return { length, weight };
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t").map((c) => c.trim());
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseNumber(val: string | undefined): number {
  if (!val) return NaN;
  const cleaned = val.replace(/,/g, "").replace(/\s*(mm|cm|m|in|kg|kgs|lb|lbs|ctns?|pcs|"|″)$/i, "").trim();
  if (!cleaned) return NaN;
  return Number(cleaned);
}

/** Labelled customer messages are deterministic inputs, not guessed table columns. */
function parseCustomerMessage(text: string, lengthOverride?: LengthUnit, weightOverride?: WeightUnit): SmartImportResult | null {
  const lines = text.split(/[\r\n；;]+/).map(s => s.trim()).filter(Boolean);
  if (!lines.some(s => /(?:毛重|重量|weight)\s*[:：=]?\s*[+-]?\d/i.test(s) && /(?:长|宽|高|\d\s*[x×*]\s*\d|\blength\b)/i.test(s))) return null;
  const rows: SmartImportRow[] = lines.slice(0,MAX_CSV_ROWS+1).map((original, idx) => {
    const line = original.replace(/毫米/g,"mm").replace(/厘米|公分/g,"cm").replace(/英寸/g,"in").replace(/公斤|千克/g,"kg").replace(/磅/g,"lb");
    const sku = line.match(/(?:货号|型号|SKU)\s*[:：=]?\s*([\w.-]+)/i)?.[1] ?? `TEXT-${idx + 1}`;
    const number = "([+-]?\\d+(?:\\.\\d+)?)";
    const axis = (labels: string) => line.match(new RegExp(`(?:${labels})\\s*[:：=]?\\s*${number}\\s*(mm|cm|in|m)?`,"i"));
    const axes = [axis("外箱长|长度|长|length|\\bL"),axis("外箱宽|宽度|宽|width|\\bW"),axis("外箱高|高度|高|height|\\bH")];
    const combined = line.match(/[+-]?\d+(?:\.\d+)?\s*(?:mm|cm|in|m)?\s*[x×*]\s*[+-]?\d+(?:\.\d+)?\s*(?:mm|cm|in|m)?\s*[x×*]\s*[+-]?\d+(?:\.\d+)?\s*(?:mm|cm|in|m)?/i);
    const dims = combined ? parseCombinedDimensions(combined[0]) : null;
    const dimension = (i: number) => axes[i] ? toMillimeters(Number(axes[i]![1]),lengthOverride ?? axes[i]![2]?.toLowerCase() as LengthUnit ?? "mm") : dims ? toMillimeters([dims.l,dims.w,dims.h][i],lengthOverride ?? dims.unit ?? "mm") : 0;
    const weight = line.match(/(?:单箱毛重|毛重|重量|gross\s*weight|weight|g\.?w\.?)\s*[:：=]?\s*([+-]?\d+(?:\.\d+)?)\s*(kg|lbs?|kgs)?/i);
    const qty = line.match(/(?:箱数|数量|qty|quantity)\s*[:：=]?\s*([+-]?\d+(?:\.\d+)?)/i) ?? line.match(/([+-]?\d+(?:\.\d+)?)\s*(?:箱|cartons?\b|ctns?\b)/i);
    const lengthMm=dimension(0),widthMm=dimension(1),heightMm=dimension(2);
    const weightKg=weight ? toKilograms(Number(weight[1]),weightOverride ?? (/^lb/i.test(weight[2] ?? "") ? "lb" : "kg")) : 0;
    const quantity=qty ? Number(qty[1]) : 0;
    const errors:string[]=[];
    if (lines.length > MAX_CSV_ROWS) errors.push("订单行超过 10,000 行 / Order exceeds 10,000 rows");
    if (![lengthMm,widthMm,heightMm].every(n=>Number.isFinite(n)&&n>0)) errors.push("请补全正数长宽高及单位 / Enter positive dimensions and units");
    if (!weight || !Number.isFinite(weightKg) || weightKg<0) errors.push("请补全单箱毛重 / Enter carton gross weight");
    if (!qty || !Number.isInteger(quantity) || quantity<0) errors.push("请补全整数箱数 / Enter a whole carton quantity");
    return {rowIndex:idx+1,sku,name:original.match(/(?:品名|名称)\s*[:：=]?\s*([^，,;；]+)/)?.[1]?.trim()??sku,lengthMm,widthMm,heightMm,weightKg,quantity,errors};
  });
  const validCount=rows.filter(r=>!r.errors.length).length;
  return {rows,detectedLengthUnit:lengthOverride??"mm",detectedWeightUnit:weightOverride??"kg",headerMatched:false,validCount,errorCount:rows.length-validCount};
}

export function parseSmartCargoText(
  text: string,
  overrideLengthUnit?: LengthUnit,
  overrideWeightUnit?: WeightUnit,
): SmartImportResult {
  const rawLines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!rawLines.length) {
    return {
      rows: [],
      detectedLengthUnit: overrideLengthUnit ?? "mm",
      detectedWeightUnit: overrideWeightUnit ?? "kg",
      headerMatched: false,
      validCount: 0,
      errorCount: 0,
    };
  }

  const firstLine = rawLines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes("|") ? "|" : ",";
  const invalidResult = (message: string): SmartImportResult => ({
    rows:[{rowIndex:1,sku:"CSV",name:"CSV",lengthMm:0,widthMm:0,heightMm:0,weightKg:0,quantity:0,errors:[message]}],
    detectedLengthUnit:overrideLengthUnit??"mm",detectedWeightUnit:overrideWeightUnit??"kg",headerMatched:false,validCount:0,errorCount:1,
  });
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) return invalidResult("导入文件超过 5 MB / Import exceeds 5 MB");
  const message = parseCustomerMessage(text, overrideLengthUnit, overrideWeightUnit);
  if (message) return message;
  let records: string[][];
  try { records = delimiter === "," ? parseCsvRecords(text) : rawLines.map(line => splitLine(line, delimiter)); }
  catch { return invalidResult("CSV 引号或分隔格式无效 / Invalid CSV quotes or delimiters"); }
  if (records.length > MAX_CSV_ROWS + 1) return invalidResult("订单行超过 10,000 行 / Order exceeds 10,000 rows");
  const firstCells = records[0] ?? [];


  const colMap: Partial<Record<FieldKey, number>> = {};
  let matchedCount = 0;
  firstCells.forEach((cell, idx) => {
    const clean = cell.replace(/^["']|["']$/g, "").trim();
    for (const rule of HEADER_RULES) {
      if (rule.pattern.test(clean) && colMap[rule.key] === undefined) {
        colMap[rule.key] = idx;
        matchedCount++;
        break;
      }
    }
  });

  const headerMatched = matchedCount >= 2;
  const headerUnits = headerMatched ? detectUnitFromHeaders(firstCells) : { length: "mm" as LengthUnit, weight: "kg" as WeightUnit };
  const lengthUnit = overrideLengthUnit ?? headerUnits.length;
  const weightUnit = overrideWeightUnit ?? headerUnits.weight;

  const dataRecords = headerMatched ? records.slice(1) : records;
  const rows: SmartImportRow[] = [];
  const rawDimSamples: number[] = [];

  dataRecords.forEach((cells, idx) => {
    const errors: string[] = [];
    if (headerMatched && cells.length > firstCells.length && cells.slice(firstCells.length).some(cell => cell.trim())) errors.push("数据列数超过表头 / Extra data columns");

    let sku = "";
    let name = "";
    let l = NaN;
    let w = NaN;
    let h = NaN;
    let rowLenUnit: LengthUnit = lengthUnit;
    let weight = NaN;
    let qty = NaN;
    let customer: string | undefined;
    let destination: string | undefined;
    let unloadStop: number | undefined;

    if (headerMatched) {
      sku = (colMap.sku !== undefined ? cells[colMap.sku] : "") || `SKU-${idx + 1}`;
      name = (colMap.name !== undefined ? cells[colMap.name] : "") || sku;
      if (colMap.dims !== undefined && cells[colMap.dims]) {
        const parsed = parseCombinedDimensions(cells[colMap.dims]);
        if (parsed) {
          l = parsed.l;
          w = parsed.w;
          h = parsed.h;
          if (parsed.unit && !overrideLengthUnit) rowLenUnit = parsed.unit;
        }
      }
      if (!Number.isFinite(l) && colMap.length !== undefined) l = parseNumber(cells[colMap.length]);
      if (!Number.isFinite(w) && colMap.width !== undefined) w = parseNumber(cells[colMap.width]);
      if (!Number.isFinite(h) && colMap.height !== undefined) h = parseNumber(cells[colMap.height]);
      if (colMap.weight !== undefined) weight = parseNumber(cells[colMap.weight]);
      if (colMap.quantity !== undefined) qty = parseNumber(cells[colMap.quantity]);
      if (colMap.customer !== undefined && cells[colMap.customer]) customer = cells[colMap.customer];
      if (colMap.destination !== undefined && cells[colMap.destination]) destination = cells[colMap.destination];
      if (colMap.unloadStop !== undefined && cells[colMap.unloadStop]) {
        const st = parseNumber(cells[colMap.unloadStop]);
        if (Number.isInteger(st) && st > 0) unloadStop = st;
      }
    } else {
      // Heuristic positional fallback:
      // Format A: SKU, L*W*H, Weight, Qty
      // Format B: SKU, L, W, H, Weight, Qty
      sku = cells[0] || `SKU-${idx + 1}`;
      name = sku;
      const combined = cells[1] ? parseCombinedDimensions(cells[1]) : null;
      if (combined) {
        l = combined.l;
        w = combined.w;
        h = combined.h;
        if (combined.unit && !overrideLengthUnit) rowLenUnit = combined.unit;
        weight = parseNumber(cells[2]);
        qty = parseNumber(cells[3]);
      } else {
        l = parseNumber(cells[1]);
        w = parseNumber(cells[2]);
        h = parseNumber(cells[3]);
        weight = parseNumber(cells[4]);
        qty = parseNumber(cells[5]);
      }
    }

    if (!Number.isFinite(l) || l <= 0) errors.push("外箱长无效 / Invalid length");
    if (!Number.isFinite(w) || w <= 0) errors.push("外箱宽无效 / Invalid width");
    if (!Number.isFinite(h) || h <= 0) errors.push("外箱高无效 / Invalid height");
    if (!Number.isFinite(weight) || weight < 0) errors.push("毛重无效 / Invalid weight");
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) errors.push("箱数需为非负整数 / Invalid integer qty");

    if (Number.isFinite(l) && Number.isFinite(w) && Number.isFinite(h)) {
      rawDimSamples.push(l, w, h);
    }

    rows.push({
      rowIndex: idx + (headerMatched ? 2 : 1),
      sku,
      name,
      lengthMm: Number.isFinite(l) ? Number(toMillimeters(l, rowLenUnit).toFixed(2)) : 0,
      widthMm: Number.isFinite(w) ? Number(toMillimeters(w, rowLenUnit).toFixed(2)) : 0,
      heightMm: Number.isFinite(h) ? Number(toMillimeters(h, rowLenUnit).toFixed(2)) : 0,
      weightKg: Number.isFinite(weight) ? Number(toKilograms(weight, weightUnit).toFixed(3)) : 0,
      quantity: Number.isFinite(qty) ? qty : 0,
      customer,
      destination,
      unloadStop,
      errors,
    });
  });

  let unitHint: "possible_cm" | "possible_in" | undefined;
  if (!overrideLengthUnit && lengthUnit === "mm" && rawDimSamples.length >= 3) {
    const maxDim = Math.max(...rawDimSamples);
    if (maxDim <= 180 && maxDim >= 10) unitHint = "possible_cm";
  }

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  return {
    rows,
    detectedLengthUnit: lengthUnit,
    detectedWeightUnit: weightUnit,
    unitHint,
    headerMatched,
    validCount,
    errorCount: rows.length - validCount,
  };
}

export function smartRowsToProducts(rows: readonly SmartImportRow[], startColorIndex = 0): ProductInput[] {
  return rows
    .filter((r) => r.errors.length === 0)
    .map((r, i) => ({
      id: `imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      sku: r.sku,
      name: r.name || r.sku,
      length: r.lengthMm,
      width: r.widthMm,
      height: r.heightMm,
      weight: r.weightKg,
      quantity: r.quantity,
      priority: r.unloadStop ? Math.max(1, 100 - r.unloadStop * 5) : 50,
      rotationPolicy: "upright",
      stackable: true,
      maxStackLayers: 0,
      mustLoad: true,
      color: PALETTE[(startColorIndex + i) % PALETTE.length],
      ...(r.customer || r.destination || r.unloadStop
        ? {
            orderLine: {
              ...EMPTY_ORDER_LINE,
              lineReference: `line-${i + 1}`,
              customer: r.customer ?? "",
              destination: r.destination ?? "",
              stop: r.unloadStop ?? 0,
            },
          }
        : {}),
    }));
}
