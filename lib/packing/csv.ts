import type { PackingResult, ProductInput, RotationPolicy } from "./types";
import { isLengthUnit, isWeightUnit, toKilograms, toMillimeters } from "./units";
import { roundedCartonVolumeCbm } from "./volume";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;
export const PLACEMENT_CSV_HEADER = "序号,SKU,品名,套装编码,套号,套内序号,X(mm),Y(mm),Z(mm),长(mm),宽(mm),高(mm),方向,层级,重量(kg)";

const REQUIRED_PRODUCT_COLUMNS = ["sku", "name", "length", "width", "height", "weight", "quantity"];
const VALID_COLOR = /^#[0-9a-f]{6}$/i;
const FORMULA_PREFIX = /^[\t ]*[=+\-@]/;

function finiteNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInteger(value: string, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(finiteNumber(value, fallback))));
}

function boundedNumber(value: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

function sanitizeText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

export function toCsvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  const protectedValue = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

export function buildPlacementCsv(result: PackingResult) {
  const rows = result.placements.map((box, index) => [
    index + 1,
    box.sku,
    box.name,
    box.setCode ?? "",
    box.setNumber ?? "",
    box.setItemNumber ?? "",
    box.x,
    box.y,
    box.z,
    box.dx,
    box.dy,
    box.dz,
    box.orientation,
    box.layer,
    box.weight,
  ].map(toCsvCell).join(","));

  return [PLACEMENT_CSV_HEADER, ...rows].join("\r\n");
}

export function parseCsvRecords(source: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  const finishValue = () => {
    record.push(value);
    value = "";
  };
  const finishRecord = () => {
    finishValue();
    if (record.some((cell) => cell.trim() !== "")) records.push(record);
    record = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      finishValue();
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      finishRecord();
      continue;
    }
    value += character;
  }

  if (quoted) throw new Error("CSV 存在未闭合的引号，请检查文件格式。");
  if (value !== "" || record.length) finishRecord();
  return records;
}

export function parseProductsCsv(text: string, colors: readonly string[], now = Date.now()) {
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ""));
  const headerRecord = records.shift();
  if (!headerRecord) throw new Error("CSV 文件为空，请先下载模板。");

  const headers = headerRecord.map((header) => header.trim());
  const duplicateHeaders = [...new Set(headers.filter((header, index) => header && headers.indexOf(header) !== index))];
  if (duplicateHeaders.length) {
    throw new Error(`CSV 存在重复表头：${duplicateHeaders.join("、")}。请保证每个字段只出现一次。`);
  }
  if (!REQUIRED_PRODUCT_COLUMNS.every((key) => headers.includes(key))) {
    throw new Error("CSV 缺少必要字段，请先下载模板。");
  }
  if (records.length > MAX_CSV_ROWS) {
    throw new Error(`CSV 最多支持 ${MAX_CSV_ROWS.toLocaleString("zh-CN")} 行产品数据。`);
  }

  const products = records.map((values, index) => {
    const get = (key: string) => values[headers.indexOf(key)] ?? "";
    const rawLengthUnit = get("lengthUnit").trim().toLowerCase();
    const rawWeightUnit = get("weightUnit").trim().toLowerCase();
    if (rawLengthUnit && !isLengthUnit(rawLengthUnit)) {
      throw new Error(`CSV 第 ${index + 2} 行的长度单位“${rawLengthUnit}”不受支持；请使用 mm、cm、m 或 in。`);
    }
    if (rawWeightUnit && !isWeightUnit(rawWeightUnit)) {
      throw new Error(`CSV 第 ${index + 2} 行的重量单位“${rawWeightUnit}”不受支持；请使用 kg 或 lb。`);
    }
    const lengthUnit = isLengthUnit(rawLengthUnit) ? rawLengthUnit : "mm";
    const weightUnit = isWeightUnit(rawWeightUnit) ? rawWeightUnit : "kg";
    const rawRotation = get("rotationPolicy").trim().toLowerCase();
    const rotationPolicy: RotationPolicy = ["fixed", "upright", "any"].includes(rawRotation)
      ? (rawRotation as RotationPolicy)
      : get("allowRotate").trim().toLowerCase() === "false"
        ? "fixed"
        : "any";
    const rawColor = get("color").trim();
    const fallbackColor = colors[index % Math.max(1, colors.length)] ?? "#2f7f89";

    const length = toMillimeters(boundedNumber(get("length"), 0, 0), lengthUnit);
    const width = toMillimeters(boundedNumber(get("width"), 0, 0), lengthUnit);
    const height = toMillimeters(boundedNumber(get("height"), 0, 0), lengthUnit);
    return {
      id: `import-${now}-${index}`,
      sku: sanitizeText(get("sku"), 80),
      name: sanitizeText(get("name"), 200),
      length,
      width,
      height,
      declaredVolumeCbm: roundedCartonVolumeCbm({ length, width, height }),
      weight: toKilograms(boundedNumber(get("weight"), 0, 0), weightUnit),
      quantity: boundedInteger(get("quantity"), 0, 0, 1_000_000),
      priority: boundedInteger(get("priority"), 50, 0, 100),
      rotationPolicy,
      stackable: get("stackable").trim().toLowerCase() !== "false",
      maxStackLayers: boundedInteger(get("maxStackLayers"), 0, 0, 99),
      mustLoad: get("mustLoad").trim().toLowerCase() !== "false",
      bottomOnly: get("bottomOnly").trim().toLowerCase() === "true",
      setCode: sanitizeText(get("setCode"), 80),
      unitsPerSet: boundedInteger(get("unitsPerSet"), 1, 1, 99),
      color: VALID_COLOR.test(rawColor) ? rawColor : fallbackColor,
    } satisfies ProductInput;
  });

  if (!products.length) throw new Error("CSV 中没有可导入的数据行。");
  return products;
}
