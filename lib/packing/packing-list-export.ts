import type { PackingResult, ProductInput } from "./types";
import { estimateDunnageBom } from "./trade-compliance";
import { calculateConsigneeFreightSplit, type FreightSplitMethod } from "./trade-optimizers";

export interface PackingListLine {
  cartonNoRange: string;
  sku: string;
  productName: string;
  cartons: number;
  unitNetWeightKg: number;
  unitGrossWeightKg: number;
  totalNetWeightKg: number;
  totalGrossWeightKg: number;
  dimensionsMm: string;
  totalCbm: number;
  customer: string;
  destination: string;
}

export function buildPackingListLines(plan: PackingResult, products: readonly ProductInput[]): PackingListLine[] {
  const prodMap = new Map(products.map((p) => [p.id, p]));
  const grouped = new Map<
    string,
    {
      sku: string;
      name: string;
      cartons: number;
      unitGross: number;
      length: number;
      width: number;
      height: number;
      totalCbm: number;
      customer: string;
      destination: string;
    }
  >();

  for (const box of plan.placements) {
    const prod = prodMap.get(box.productId);
    const key = box.productId;
    const vol = (box.dx * box.dy * box.dz) / 1e9;
    const prev = grouped.get(key);
    if (prev) {
      prev.cartons += 1;
      prev.totalCbm += vol;
    } else {
      grouped.set(key, {
        sku: box.sku,
        name: prod?.name || box.sku,
        cartons: 1,
        unitGross: box.weight,
        length: prod?.length ?? box.dx,
        width: prod?.width ?? box.dy,
        height: prod?.height ?? box.dz,
        totalCbm: vol,
        customer: prod?.orderLine?.customer ?? "",
        destination: prod?.orderLine?.destination ?? "",
      });
    }
  }

  let cursor = 1;
  const lines: PackingListLine[] = [];
  for (const g of grouped.values()) {
    const start = cursor;
    const end = cursor + g.cartons - 1;
    cursor = end + 1;
    // Standard trade estimate when net weight isn't separately recorded: 92% of gross weight
    const unitNet = Number((g.unitGross * 0.92).toFixed(2));
    lines.push({
      cartonNoRange: start === end ? `${start}` : `${start}-${end}`,
      sku: g.sku,
      productName: g.name,
      cartons: g.cartons,
      unitNetWeightKg: unitNet,
      unitGrossWeightKg: Number(g.unitGross.toFixed(2)),
      totalNetWeightKg: Number((unitNet * g.cartons).toFixed(2)),
      totalGrossWeightKg: Number((g.unitGross * g.cartons).toFixed(2)),
      dimensionsMm: `${Math.round(g.length)} × ${Math.round(g.width)} × ${Math.round(g.height)}`,
      totalCbm: Number(g.totalCbm.toFixed(4)),
      customer: g.customer,
      destination: g.destination,
    });
  }
  return lines;
}

export async function createPackingListWorkbook(
  plan: PackingResult,
  products: readonly ProductInput[],
  meta: { invoiceNo?: string; containerNo?: string; sealNo?: string } = {},
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CargoFit v1.0";
  wb.created = new Date();

  const ws = wb.addWorksheet("PACKING LIST");
  ws.columns = [
    { header: "Carton No. / 箱号", key: "cartonNoRange", width: 16 },
    { header: "SKU / 货号", key: "sku", width: 18 },
    { header: "Description / 品名", key: "productName", width: 24 },
    { header: "Qty (CTNS) / 箱数", key: "cartons", width: 14 },
    { header: "Size (mm) / 外箱尺寸", key: "dimensionsMm", width: 22 },
    { header: "Unit N.W. (kg)", key: "unitNetWeightKg", width: 14 },
    { header: "Unit G.W. (kg)", key: "unitGrossWeightKg", width: 14 },
    { header: "Total N.W. (kg)", key: "totalNetWeightKg", width: 16 },
    { header: "Total G.W. (kg)", key: "totalGrossWeightKg", width: 16 },
    { header: "Total CBM (m³)", key: "totalCbm", width: 15 },
    { header: "Customer / 客户", key: "customer", width: 16 },
    { header: "Destination / 目的港", key: "destination", width: 16 },
  ];

  // Insert trade header block above table
  ws.spliceRows(1, 0,
    ["COMMERCIAL PACKING LIST / 外贸装箱单"],
    [`Container Type: ${plan.container.name}`, "", `Container No.: ${meta.containerNo || "____________"}`, "", `Seal No.: ${meta.sealNo || "____________"}`, "", `Invoice No.: ${meta.invoiceNo || "____________"}`],
    [],
  );

  const titleRow = ws.getRow(1);
  titleRow.font = { bold: true, size: 15, color: { argb: "FF0F766E" } };
  const headerRow = ws.getRow(4);
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F6" } };

  const lines = buildPackingListLines(plan, products);
  const dataStartRow = 5;
  for (const line of lines) {
    ws.addRow(line);
  }
  const dataEndRow = dataStartRow + lines.length - 1;

  if (lines.length > 0) {
    const totalRow = ws.addRow({
      cartonNoRange: "TOTAL / 合计",
      cartons: { formula: `SUM(D${dataStartRow}:D${dataEndRow})` },
      totalNetWeightKg: { formula: `SUM(H${dataStartRow}:H${dataEndRow})` },
      totalGrossWeightKg: { formula: `SUM(I${dataStartRow}:I${dataEndRow})` },
      totalCbm: { formula: `SUM(J${dataStartRow}:J${dataEndRow})` },
    });
    totalRow.font = { bold: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}


export async function createFreightSplitWorkbook(
  plan: PackingResult,
  products: readonly ProductInput[],
  totalFreight: number,
  currency = "USD",
  method: FreightSplitMethod = "cbm",
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CargoFit v1.0";
  wb.created = new Date();

  const report = calculateConsigneeFreightSplit(plan, products, totalFreight, currency, method);

  // Sheet 1: Consignee / Stop Freight Split
  const ws1 = wb.addWorksheet("CONSIGNEE FREIGHT SPLIT");
  ws1.columns = [
    { header: "Unload Stop / 卸货站", key: "unloadStop", width: 16 },
    { header: "Consignee / 客户", key: "customer", width: 22 },
    { header: "Destination / 目的港", key: "destination", width: 20 },
    { header: "Cartons / 箱数", key: "cartons", width: 14 },
    { header: "Volume (CBM)", key: "volumeCbm", width: 15 },
    { header: "Gross Weight (kg)", key: "weightKg", width: 17 },
    { header: "LDM (m)", key: "ldmMeters", width: 12 },
    { header: "Share (%)", key: "sharePercent", width: 12 },
    { header: `Allocated (${currency})`, key: "allocatedFreight", width: 18 },
  ];
  ws1.getRow(1).font = { bold: true };
  for (const r of report.rows) ws1.addRow(r);
  if (report.rows.length > 0) {
    const end = report.rows.length + 1;
    const tot = ws1.addRow({
      unloadStop: "TOTAL",
      cartons: { formula: `SUM(D2:D${end})` },
      volumeCbm: { formula: `SUM(E2:E${end})` },
      weightKg: { formula: `SUM(F2:F${end})` },
      allocatedFreight: { formula: `SUM(I2:I${end})` },
    });
    tot.font = { bold: true };
  }

  // Sheet 2: Per-SKU Unit Freight Cost Allocation (for CIF/DDP quoting)
  const ws2 = wb.addWorksheet("SKU UNIT FREIGHT COST");
  ws2.columns = [
    { header: "SKU / 货号", key: "sku", width: 18 },
    { header: "Product / 品名", key: "productName", width: 24 },
    { header: "Cartons / 箱数", key: "cartons", width: 14 },
    { header: "Total CBM", key: "totalCbm", width: 14 },
    { header: "Total G.W. (kg)", key: "totalGrossWeightKg", width: 16 },
    { header: `SKU Freight (${currency})`, key: "skuFreight", width: 18 },
    { header: `Freight / Carton (${currency})`, key: "freightPerCarton", width: 22 },
  ];
  ws2.getRow(1).font = { bold: true };
  const plLines = buildPackingListLines(plan, products);
  const sumBasis = plLines.reduce(
    (sum, l) => sum + (method === "wm" ? Math.max(l.totalCbm, l.totalGrossWeightKg / 1000) : l.totalCbm),
    0,
  );
  for (const l of plLines) {
    const basis = method === "wm" ? Math.max(l.totalCbm, l.totalGrossWeightKg / 1000) : l.totalCbm;
    const skuFreight = sumBasis > 0 ? Number(((totalFreight * basis) / sumBasis).toFixed(2)) : 0;
    const freightPerCarton = l.cartons > 0 ? Number((skuFreight / l.cartons).toFixed(2)) : 0;
    ws2.addRow({
      sku: l.sku,
      productName: l.productName,
      cartons: l.cartons,
      totalCbm: l.totalCbm,
      totalGrossWeightKg: l.totalGrossWeightKg,
      skuFreight,
      freightPerCarton,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function createTradeDocBundleWorkbook(
  plan: PackingResult,
  products: readonly ProductInput[],
  options: { invoiceNo?: string; containerNo?: string; sealNo?: string; currency?: string; unitPrices?: Record<string, number> } = {},
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CargoFit v1.0";
  wb.created = new Date();
  const cur = options.currency || "USD";
  const lines = buildPackingListLines(plan, products);
  const prodBySku = new Map(products.map((pr) => [pr.sku, pr]));

  // Sheet 1: Commercial Invoice (CI)
  const ci = wb.addWorksheet("COMMERCIAL INVOICE");
  ci.columns = [
    { header: "SKU / 货号", key: "sku", width: 18 },
    { header: "Description / 品名", key: "productName", width: 26 },
    { header: "Qty (CTNS)", key: "cartons", width: 14 },
    { header: `Unit Price (${cur})`, key: "unitPrice", width: 16 },
    { header: `Amount (${cur})`, key: "amount", width: 18 },
  ];
  ci.spliceRows(1, 0,
    ["COMMERCIAL INVOICE / 商业发票"],
    [`Invoice No.: ${options.invoiceNo || "____________"}`, "", `Container: ${plan.container.name}`, `Currency: ${cur}`],
    [],
  );
  ci.getRow(1).font = { bold: true, size: 15, color: { argb: "FF0F766E" } };
  ci.getRow(4).font = { bold: true };
  const ciStart = 5;
  lines.forEach((l, idx) => {
    const r = ciStart + idx;
    const prod = prodBySku.get(l.sku);
    const price = prod ? (options.unitPrices?.[prod.id] ?? 0) : 0;
    ci.addRow({
      sku: l.sku,
      productName: l.productName,
      cartons: l.cartons,
      unitPrice: price,
      amount: { formula: `C${r}*D${r}` },
    });
  });
  if (lines.length > 0) {
    const ciEnd = ciStart + lines.length - 1;
    const tot = ci.addRow({
      sku: "TOTAL / 合计",
      cartons: { formula: `SUM(C${ciStart}:C${ciEnd})` },
      amount: { formula: `SUM(E${ciStart}:E${ciEnd})` },
    });
    tot.font = { bold: true };
  }

  // Sheet 2: Packing List (PL)
  const pl = wb.addWorksheet("PACKING LIST");
  pl.columns = [
    { header: "Carton No. / 箱号", key: "cartonNoRange", width: 16 },
    { header: "SKU / 货号", key: "sku", width: 18 },
    { header: "Description / 品名", key: "productName", width: 24 },
    { header: "Qty (CTNS)", key: "cartons", width: 14 },
    { header: "Size (mm)", key: "dimensionsMm", width: 22 },
    { header: "Total N.W. (kg)", key: "totalNetWeightKg", width: 16 },
    { header: "Total G.W. (kg)", key: "totalGrossWeightKg", width: 16 },
    { header: "Total CBM (m³)", key: "totalCbm", width: 15 },
  ];
  pl.spliceRows(1, 0,
    ["COMMERCIAL PACKING LIST / 外贸装箱单"],
    [`Container No.: ${options.containerNo || "____________"}`, "", `Seal No.: ${options.sealNo || "____________"}`, "", `Container Type: ${plan.container.name}`],
    [],
  );
  pl.getRow(1).font = { bold: true, size: 15, color: { argb: "FF0F766E" } };
  pl.getRow(4).font = { bold: true };
  const plStart = 5;
  for (const l of lines) pl.addRow(l);
  if (lines.length > 0) {
    const plEnd = plStart + lines.length - 1;
    const tot = pl.addRow({
      cartonNoRange: "TOTAL / 合计",
      cartons: { formula: `SUM(D${plStart}:D${plEnd})` },
      totalNetWeightKg: { formula: `SUM(F${plStart}:F${plEnd})` },
      totalGrossWeightKg: { formula: `SUM(G${plStart}:G${plEnd})` },
      totalCbm: { formula: `SUM(H${plStart}:H${plEnd})` },
    });
    tot.font = { bold: true };
  }

  // Sheet 3: Loading & Dunnage Summary
  const sm = wb.addWorksheet("LOADING & DUNNAGE");
  const bom = estimateDunnageBom(plan, plan.container.rearDoorClearanceMm ?? 100);
  sm.columns = [
    { header: "Item / 项目", key: "item", width: 32 },
    { header: "Value / 数值", key: "val", width: 30 },
  ];
  sm.getRow(1).font = { bold: true };
  sm.addRows([
    { item: "Container Type / 柜型", val: plan.container.name },
    { item: "Loaded Cartons / 已装总箱数", val: plan.metrics.loadedCount },
    { item: "Loaded Volume / 已装体积 (CBM)", val: Number((plan.metrics.loadedVolume / 1e9).toFixed(3)) },
    { item: "Gross Weight / 总毛重 (kg)", val: Number(plan.metrics.grossWeight.toFixed(1)) },
    { item: "Dunnage Airbags / 建议充气袋", val: `${bom.airbagsRecommended} pcs (${bom.airbagSpec})` },
    { item: "Desiccant Poles / 建议干燥剂", val: `${bom.desiccantPoles} poles` },
    { item: "Lashing Straps / 建议拉带", val: `${bom.lashingStraps} straps` },
    { item: "Rear Door Void / 尾门预留净空", val: `${bom.rearVoidMm} mm` },
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
