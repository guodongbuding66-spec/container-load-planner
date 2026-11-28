import type { PackingResult, ProductInput } from "./types";

export interface CenterOfGravityReport {
  totalWeightKg: number;
  cogXMm: number;
  cogYMm: number;
  cogZMm: number;
  cogXPct: number; // 0 = nose/front wall, 100 = rear door
  cogYPct: number; // 0 = left wall, 100 = right wall
  cogZPct: number; // 0 = floor, 100 = ceiling
  frontAxlePct: number;
  rearAxlePct: number;
  frontAxleKg: number;
  rearAxleKg: number;
  leftPct: number;
  rightPct: number;
  longitudinalOffsetPct: number; // deviation from 50%
  lateralOffsetPct: number; // deviation from 50%
  status: "balanced" | "caution" | "imbalanced";
  warningsZh: string[];
  warningsEn: string[];
}

export function computeCenterOfGravity(plan: PackingResult): CenterOfGravityReport {
  // The solver includes packaging geometry, solid mass centres and fixed accessories.
  // Both result surfaces use this single, validated coordinate system (usable space).
  const cg = plan.metrics.centerOfGravity;
  const totalW = plan.metrics.grossWeight;
  const cogXMm = cg.x, cogYMm = cg.y, cogZMm = cg.z;
  const cogXPct = Math.max(0, Math.min(100, cg.longitudinalRatio * 100));
  const cogYPct = Math.max(0, Math.min(100, cg.lateralRatio * 100));
  const cogZPct = Math.max(0, Math.min(100, cg.heightRatio * 100));

  // Simple beam reaction model: nose (x=0) vs door (x=L)
  const rearAxlePct = cogXPct;
  const frontAxlePct = 100 - rearAxlePct;
  const frontAxleKg = (totalW * frontAxlePct) / 100;
  const rearAxleKg = (totalW * rearAxlePct) / 100;

  const rightPct = cogYPct;
  const leftPct = 100 - rightPct;

  const longitudinalOffsetPct = Math.abs(cogXPct - 50);
  const lateralOffsetPct = Math.abs(cogYPct - 50);

  const warningsZh: string[] = [];
  const warningsEn: string[] = [];

  if (lateralOffsetPct > 10) {
    warningsZh.push(`左右偏载 ${lateralOffsetPct.toFixed(1)}%（超过 10% 警戒线），建议左右对称调换重货。`);
    warningsEn.push(`Lateral imbalance ${lateralOffsetPct.toFixed(1)}% (>10% limit); rebalance heavy cartons left-to-right.`);
  }
  if (longitudinalOffsetPct > 10) {
    const sideZh = cogXPct < 50 ? "前端（车头/柜内深处）" : "后端（柜门侧）";
    const sideEn = cogXPct < 50 ? "nose/front" : "rear/door";
    warningsZh.push(`纵向重心偏${sideZh} ${longitudinalOffsetPct.toFixed(1)}%（超过 10% 建议窗口），美欧公路拖车可能触发桥轴超载。`);
    warningsEn.push(`Longitudinal CoG shifted ${longitudinalOffsetPct.toFixed(1)}% toward ${sideEn} (>10%); check truck axle limits.`);
  }
  if (cogZPct > 55 && totalW > 5000) {
    warningsZh.push(`重心高度偏高（${cogZPct.toFixed(1)}% 柜高），请确保重货置底、轻货置顶。`);
    warningsEn.push(`High center of gravity (${cogZPct.toFixed(1)}% of height); place heavier cargo on the floor.`);
  }

  const status: CenterOfGravityReport["status"] = cg.balanced ? "balanced" : "imbalanced";

  return {
    totalWeightKg: Math.round(totalW * 10) / 10,
    cogXMm: Math.round(cogXMm),
    cogYMm: Math.round(cogYMm),
    cogZMm: Math.round(cogZMm),
    cogXPct: Math.round(cogXPct * 10) / 10,
    cogYPct: Math.round(cogYPct * 10) / 10,
    cogZPct: Math.round(cogZPct * 10) / 10,
    frontAxlePct: Math.round(frontAxlePct * 10) / 10,
    rearAxlePct: Math.round(rearAxlePct * 10) / 10,
    frontAxleKg: Math.round(frontAxleKg),
    rearAxleKg: Math.round(rearAxleKg),
    leftPct: Math.round(leftPct * 10) / 10,
    rightPct: Math.round(rightPct * 10) / 10,
    longitudinalOffsetPct: Math.round(longitudinalOffsetPct * 10) / 10,
    lateralOffsetPct: Math.round(lateralOffsetPct * 10) / 10,
    status,
    warningsZh,
    warningsEn,
  };
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface VgmMeta {
  containerNo: string;
  sealNo: string;
  bookingNo: string;
  shipper: string;
  tareWeightKg: number;
  method: "Method 1" | "Method 2";
  /** Required when method === "Method 1": actual weighbridge / scale reading for the packed container (kg). */
  verifiedScaleWeightKg?: number;
  /** Optional weighbridge / scale calibration reference or ticket number for Method 1. */
  weighingScaleRef?: string;
}

export function buildVgmDeclarationHtml(plan: PackingResult, meta: VgmMeta): string {
  const cargoGrossKg = Math.round(plan.metrics.grossWeight * 10) / 10;
  if (!Number.isFinite(meta.tareWeightKg) || meta.tareWeightKg <= 0) {
    throw new Error("Container tare weight (CSC plate) must be a positive finite number (> 0 kg).");
  }
  const tareKg = Math.round(meta.tareWeightKg * 10) / 10;

  let totalVgmKg: number;
  if (meta.method === "Method 1") {
    if (
      typeof meta.verifiedScaleWeightKg !== "number" ||
      !Number.isFinite(meta.verifiedScaleWeightKg) ||
      meta.verifiedScaleWeightKg <= 0
    ) {
      throw new Error("SOLAS Method 1 requires an actual verified scale gross mass (verifiedScaleWeightKg > 0 kg).");
    }
    totalVgmKg = Math.round(meta.verifiedScaleWeightKg * 10) / 10;
  } else {
    totalVgmKg = Math.round((cargoGrossKg + tareKg) * 10) / 10;
  }

  const hasVerifiedIdentifiers = Boolean(
    meta.containerNo.trim() && meta.bookingNo.trim() && meta.shipper.trim(),
  );
  const statusBanner = hasVerifiedIdentifiers
    ? ""
    : `<div class="draft-banner">DRAFT / ESTIMATE ONLY — Enter verified Container No., Booking/B/L No., and Shipper before formal SOLAS submission.</div>`;
  const dateStr = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SOLAS VGM Declaration - ${esc(meta.containerNo.trim() || "DRAFT")}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { max-width: 100%; }
  body { font-family: system-ui, -apple-system, sans-serif; color: #0F172A; margin: 24px auto; max-width: 780px; padding: 0 16px; overflow-wrap: anywhere; word-break: break-word; }
  h1 { font-size: 20px; margin: 0 0 4px; border-bottom: 2px solid #0F766E; padding-bottom: 10px; }
  .sub { font-size: 13px; color: #475569; margin: 0 0 16px; }
  .draft-banner { background: #FEF3C7; border: 1px solid #D97706; color: #92400E; padding: 10px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
  .table-wrap { width: 100%; max-width: 100%; overflow-x: auto; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { border: 1px solid #CBD5E1; padding: 10px 12px; text-align: left; overflow-wrap: anywhere; word-break: break-word; }
  th { background: #F8FAFC; width: 34%; color: #334155; }
  .vgm-total { font-size: 18px; font-weight: 700; color: #0F766E; font-variant-numeric: tabular-nums; }
  .sig { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; margin-top: 28px; font-size: 13px; }
  .sig-box { border-top: 1px solid #334155; padding-top: 8px; min-width: 0; }
  @media (max-width: 600px) {
    body { margin: 12px auto; padding: 0 10px; }
    th, td { padding: 8px; font-size: 13px; }
    .sig { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  }
  @media print { .no-print { display: none; } .table-wrap { overflow: visible; } .sig { grid-template-columns: 1fr 1fr; } }
</style>
</head>
<body>
  <div class="no-print" style="margin-bottom:16px;text-align:right">
    <button onclick="window.print()" style="padding:8px 16px;background:#0F766E;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600">Print / Save PDF</button>
  </div>
  <h1>SOLAS VERIFIED GROSS MASS (VGM) ${hasVerifiedIdentifiers ? "DECLARATION" : "DRAFT"}</h1>
  <p class="sub">International Convention for the Safety of Life at Sea (SOLAS) Chapter VI, Regulation 2 · Generated by CargoFit</p>
  ${statusBanner}
  <div class="table-wrap">
  <table>
    <tr><th>Booking / B/L No.</th><td>${esc(meta.bookingNo.trim() || "NOT SPECIFIED")}</td></tr>
    <tr><th>Container No.</th><td><strong>${esc(meta.containerNo.trim() || "NOT SPECIFIED")}</strong> (${esc(plan.container.name)})</td></tr>
    <tr><th>Seal No.</th><td>${esc(meta.sealNo.trim() || "NOT SPECIFIED")}</td></tr>
    <tr><th>Shipper / Authorized Party</th><td>${esc(meta.shipper.trim() || "NOT SPECIFIED")}</td></tr>
    <tr><th>Weighing Method</th><td>${esc(meta.method)} (${meta.method === "Method 1" ? "Actual weighing of packed container on calibrated scale" : "Calculated cargo + packaging + container tare"})</td></tr>
    ${meta.method === "Method 1" && meta.weighingScaleRef?.trim() ? `<tr><th>Scale / Ticket Ref.</th><td>${esc(meta.weighingScaleRef.trim())}</td></tr>` : ""}
    <tr><th>Cargo &amp; Packaging Gross Weight</th><td>${cargoGrossKg.toLocaleString()} kg (${plan.metrics.loadedCount} cartons)</td></tr>
    <tr><th>Container Tare Weight (CSC Plate)</th><td>${tareKg.toLocaleString()} kg</td></tr>
    <tr><th>Verified Gross Mass (VGM)</th><td class="vgm-total">${totalVgmKg.toLocaleString()} kg</td></tr>
  </table>
  </div>
  <p style="font-size:12px;color:#475569;line-height:1.6">
    Declaration: The undersigned hereby certifies that the Verified Gross Mass stated above was obtained in accordance with SOLAS Chapter VI, Regulation 2 and applicable national regulations.
  </p>
  <div class="sig">
    <div class="sig-box">Authorized Signature &amp; Company Stamp</div>
    <div class="sig-box">Date: ${dateStr}</div>
  </div>
</body>
</html>`;
}

export interface ShippingMarkMeta {
  consignee: string;
  destination: string;
  poNo: string;
  origin: string;
  /** Optional verified per-carton net weight (kg) keyed by productId. Never estimated when omitted. */
  netWeightKgByProductId?: Record<string, number>;
}

export function buildShippingMarksHtml(
  plan: PackingResult,
  products: readonly ProductInput[],
  meta: ShippingMarkMeta,
): string {
  const bySpecGroup = new Map<
    string,
    {
      productId: string;
      sku: string;
      name: string;
      qty: number;
      lCm: string;
      wCm: string;
      hCm: string;
      gwKg: number;
      nwKg: number | null;
    }
  >();
  const prodById = new Map(products.map((p) => [p.id, p]));
  const prodBySku = new Map(products.map((p) => [p.sku, p]));

  for (const box of plan.placements) {
    const prod = prodById.get(box.productId) ?? prodBySku.get(box.sku);
    const lCm = ((prod?.length ?? box.dx) / 10).toFixed(1);
    const wCm = ((prod?.width ?? box.dy) / 10).toFixed(1);
    const hCm = ((prod?.height ?? box.dz) / 10).toFixed(1);
    const gwKg = Math.round(box.weight * 1000) / 1000;
    const rawNw = meta.netWeightKgByProductId?.[box.productId];
    const nwKg =
      typeof rawNw === "number" && Number.isFinite(rawNw) && rawNw > 0 && rawNw <= gwKg
        ? Math.round(rawNw * 10) / 10
        : null;
    // BUG-001: Group by stable order line (productId) + SKU + outer dimensions + gross weight
    // so identical SKUs with different specs/weights are never merged into one erroneous mark card.
    const groupKey = `${box.productId}::${box.sku}::${lCm}x${wCm}x${hCm}::${gwKg.toFixed(3)}::${nwKg ?? "na"}`;
    const cur = bySpecGroup.get(groupKey) ?? {
      productId: box.productId,
      sku: box.sku,
      name: prod?.name || box.name || box.sku,
      qty: 0,
      lCm,
      wCm,
      hCm,
      gwKg,
      nwKg,
    };
    cur.qty += 1;
    bySpecGroup.set(groupKey, cur);
  }

  const totalCartons = plan.metrics.loadedCount;
  let cursor = 1;
  const cards: string[] = [];

  for (const item of bySpecGroup.values()) {
    const startNo = cursor;
    const endNo = cursor + item.qty - 1;
    cursor = endNo + 1;
    const nwDisplay = item.nwKg !== null ? `${item.nwKg.toFixed(1)} KG` : "N/A (Not Specified)";
    cards.push(`
      <article class="mark-card" data-product-id="${esc(item.productId)}">
        <div class="mark-col">
          <div class="mark-tag">MAIN MARK / 正唛</div>
          <div class="mark-consignee">${esc(meta.consignee || "CONSIGNEE / BUYER")}</div>
          <div class="mark-line"><strong>PO NO.:</strong> ${esc(meta.poNo || "PO-TBD")}</div>
          <div class="mark-line"><strong>DEST.:</strong> ${esc(meta.destination || "DESTINATION PORT")}</div>
          <div class="mark-cno">C/NO.: ${startNo}–${endNo} / ${totalCartons}</div>
          <div class="mark-origin">${esc(meta.origin || "MADE IN CHINA")}</div>
        </div>
        <div class="mark-col side">
          <div class="mark-tag">SIDE MARK / 侧唛</div>
          <div class="mark-line"><strong>ITEM / SKU:</strong> ${esc(item.sku)}</div>
          <div class="mark-line"><strong>DESC.:</strong> ${esc(item.name)}</div>
          <div class="mark-line"><strong>QTY:</strong> ${item.qty} CTNS</div>
          <div class="mark-line"><strong>G.W.:</strong> ${item.gwKg.toFixed(1)} KG &nbsp; <strong>N.W.:</strong> ${nwDisplay}</div>
          <div class="mark-line"><strong>MEAS.:</strong> ${item.lCm} × ${item.wCm} × ${item.hCm} CM</div>
          <div class="mark-icons">↑ THIS SIDE UP &nbsp;|&nbsp; ☂ KEEP DRY &nbsp;|&nbsp; ⚠ HANDLE WITH CARE</div>
        </div>
      </article>
    `);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Shipping Marks - ${esc(meta.poNo || plan.container.name)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { max-width: 100%; }
  body { font-family: system-ui, -apple-system, sans-serif; color: #0F172A; margin: 24px auto; max-width: 920px; padding: 0 16px; overflow-wrap: anywhere; word-break: break-word; }
  .bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 18px; max-width: 100%; }
  .bar > * { min-width: 0; max-width: 100%; }
  .mark-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); border: 2px solid #0F172A; margin-bottom: 18px; page-break-inside: avoid; max-width: 100%; }
  .mark-col { padding: 16px 18px; min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
  .mark-col.side { border-left: 2px dashed #475569; }
  .mark-tag { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: #0F766E; margin-bottom: 8px; }
  .mark-consignee { font-size: 20px; font-weight: 800; margin-bottom: 10px; overflow-wrap: anywhere; word-break: break-word; }
  .mark-line { font-size: 14px; line-height: 1.65; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; word-break: break-word; }
  .mark-cno { font-size: 18px; font-weight: 700; margin-top: 10px; font-variant-numeric: tabular-nums; }
  .mark-origin { font-size: 13px; font-weight: 700; margin-top: 10px; border-top: 1px solid #CBD5E1; padding-top: 6px; }
  .mark-icons { margin-top: 12px; font-size: 11px; font-weight: 700; color: #334155; border-top: 1px solid #CBD5E1; padding-top: 6px; }
  @media (max-width: 600px) {
    body { margin: 12px auto; padding: 0 10px; }
    .mark-card { grid-template-columns: minmax(0, 1fr); }
    .mark-col { padding: 12px; }
    .mark-col.side { border-left: 0; border-top: 2px dashed #475569; }
    .mark-consignee { font-size: 17px; }
    .mark-line { font-size: 13px; }
  }
  @media print {
    .no-print { display: none; }
    .mark-card { grid-template-columns: 1fr 1fr; }
    .mark-col.side { border-left: 2px dashed #475569; border-top: 0; }
  }
</style>
</head>
<body>
  <div class="bar no-print">
    <strong>CargoFit Batch Shipping Marks (${bySpecGroup.size} Groups · ${totalCartons} Cartons)</strong>
    <button onclick="window.print()" style="padding:8px 16px;background:#0F766E;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600">Print / Save PDF</button>
  </div>
  ${cards.join("\n")}
</body>
</html>`;
}

export function rebalanceProductsForCoG(
  products: readonly ProductInput[],
  bias: "front-heavy" | "rear-heavy" | "balanced",
): ProductInput[] {
  const sorted = [...products].sort((a, b) => {
    const denA = a.weight / Math.max(1e-6, (a.length * a.width * a.height) / 1e9);
    const denB = b.weight / Math.max(1e-6, (b.length * b.width * b.height) / 1e9);
    return bias === "front-heavy" ? denA - denB : denB - denA;
  });
  return sorted.map((p, idx) => ({
    ...p,
    priority: idx + 1,
  }));
}
