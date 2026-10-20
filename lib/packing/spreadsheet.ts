import ExcelJS from "exceljs";
import { MAX_CSV_BYTES, MAX_CSV_ROWS, parseProductsCsv, parseOrderQuantityCsv, toCsvCell } from "./csv";
export const SPREADSHEET_COLUMNS = ["sku", "name", "length", "width", "height", "lengthUnit", "weight", "weightUnit", "quantity", "priority", "setCode", "unitsPerSet", "rotationPolicy", "stackable", "maxStackLayers", "mustLoad", "bottomOnly", "color", "maxTopLoadKg", "topLoadLengthKg", "topLoadWidthKg", "topLoadHeightKg", "allowedAboveSkus", "cargoType", "allowedOrientations", "minimumSupportRatio", "palletBaseHeight", "cargoShape", "shapeAxis", "shapeTopRatio", "shapeWallRatio", "shapeWallHeightRatio", "shapeStepLengthRatio", "shapeStepHeightRatio","solidModel","protectionGap","longSupport","orderLineId","orderReference","orderLineReference","batch","customer","destination","unloadStop"];

/** Validate ZIP directory sizes before ExcelJS inflates any entry. */
export function validateSpreadsheetZip(buffer: ArrayBuffer) {
  if (buffer.byteLength > MAX_CSV_BYTES) throw new Error("Excel 文件不能超过 5 MB。");
  const view = new DataView(buffer); let end = -1;
  for (let p = buffer.byteLength - 22; p >= Math.max(0, buffer.byteLength - 65557); p--) if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === buffer.byteLength) { end = p; break; }
  if (end < 0) throw new Error("Excel 文件不是完整的 XLSX 文件。");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count > 500 || offset + size > end || offset === 0xffffffff) throw new Error("不支持分卷、ZIP64 或过多条目的 Excel 文件。");
  let cursor = offset, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Excel 压缩目录损坏。");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), expanded = view.getUint32(cursor + 24, true);
    total += expanded;
    if (flags & 1 || ![0, 8].includes(method) || expanded > 16 * 1024 * 1024 || total > 64 * 1024 * 1024) throw new Error("Excel 文件加密或解压后过大，请使用精简清单。");
    cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    if (cursor > offset + size) throw new Error("Excel 压缩目录越界。");
  }
}
export async function createSpreadsheetTemplate() {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("Products");
  sheet.addRow(SPREADSHEET_COLUMNS);
  sheet.addRow(["SET-A", "主箱 / Main carton", 1800, 150, 100, "mm", 15, "kg", 100, 100, "SET-2", 1, "upright", true, 0, true, false, "#2f7f89", "", "", "", "", "", "carton", '["LWH","WLH"]', 1, ""]);
  sheet.addRow(["SET-B", "面板箱 / Panel carton", 1270, 550, 290, "mm", 31, "kg", 100, 100, "SET-2", 1, "upright", true, 0, true, false, "#c66a3d", "", "", "", "", "", "carton", '["LWH","WLH"]', 1, ""]);
  sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF277F8D" } };
  sheet.columns.forEach(col => { col.width = 22; });
  const help = book.addWorksheet("Instructions"); help.addRows([
    ["Use the Products sheet. Required columns: sku,name,length,width,height,weight,quantity."],
    ["Length units: mm,cm,m,in. Weight units: kg,lb. Layer limit 0 means no artificial limit."],
    ["allowedOrientations: JSON array containing at least one of LWH,LHW,WLH,WHL,HLW,HWL."],
    ["minimumSupportRatio: >0 to 1. Pallet base is already included in outer height."],
    ["cargoShape: box,cylinder,wedge,trapezoid,frustum,l-profile,u-profile,t-profile,step,irregular. shapeAxis: L,W,H."],
    ["shapeTopRatio: trapezoid >0–1, frustum 0–1; wall and step ratios >0 and <1; U vertical wall <0.5 (minimum ratio 0.000001)."],
    ["Profiles use solid blocks and horizontal support faces. Curved cargo reserves bounding envelopes and cannot support top loads."],
    ["solidModel: validated model JSON (model dimensions are always mm). protectionGap uses lengthUnit; supporting contact is exempt."],
    ["Additional shapes: polygon,tube,reel,bend,ellipsoid,capsule,custom-prism,compound,mesh. Advanced shapes require solidModel."],
    ["longSupport: versioned original-bottom support profile JSON. All profile dimensions are always mm; independent preflight only, no strength certification."],
    ["No formulas; import validates every row before replacing the current manifest."],
  ]); help.getColumn(1).width = 110;
  return new Uint8Array(await book.xlsx.writeBuffer());
}
async function spreadsheetText(source: ArrayBuffer | Uint8Array) {
  const buffer = source instanceof ArrayBuffer ? source : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  validateSpreadsheetZip(buffer); const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const sheet = book.getWorksheet("Products") ?? book.worksheets[0];
  if (!sheet || sheet.rowCount > MAX_CSV_ROWS + 1 || sheet.columnCount > 100) throw new Error("Excel 数据数量无效，最多支持 10,000 行和 100 列。");
  const rows: string[][] = [];
  sheet.eachRow(row => { const cells: string[] = []; for (let col = 1; col <= sheet.columnCount; col++) {
    const value = row.getCell(col).value;
    if (value && typeof value === "object") {
      if ("formula" in value || "sharedFormula" in value) throw new Error("Excel 不能包含公式，请粘贴为数值后再导入。");
      if ("richText" in value) cells.push(value.richText.map(v => v.text).join("")); else if ("text" in value) cells.push(String(value.text)); else throw new Error("Excel 含不支持的单元格类型。");
    } else cells.push(value == null ? "" : String(value));
  } rows.push(cells); });
  return rows.map(row => row.map(toCsvCell).join(",")).join("\n");
}

export async function parseSpreadsheet(source:ArrayBuffer|Uint8Array,colors:readonly string[]){return parseProductsCsv(await spreadsheetText(source),colors);}
export async function parseSpreadsheetQuantities(source:ArrayBuffer|Uint8Array){return parseOrderQuantityCsv(await spreadsheetText(source));}
