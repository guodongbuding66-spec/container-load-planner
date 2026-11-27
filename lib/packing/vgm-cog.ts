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
  const L = Math.max(1, plan.container.length);
  const W = Math.max(1, plan.container.width);
  const H = Math.max(1, plan.container.height);

  let totalW = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;

  for (const box of plan.placements) {
    const w = Math.max(0, box.weight);
    if (w <= 0) continue;
    totalW += w;
    sumX += w * (box.x + box.dx / 2);
    sumY += w * (box.y + box.dy / 2);
    sumZ += w * (box.z + box.dz / 2);
  }

  for (const pal of plan.pallets ?? []) {
    const w = Math.max(0, pal.weight ?? 0);
    if (w <= 0) continue;
    totalW += w;
    sumX += w * (pal.x + pal.dx / 2);
    sumY += w * (pal.y + pal.dy / 2);
    sumZ += w * (pal.z + (pal.dz ?? 144) / 2);
  }

  const cogXMm = totalW > 0 ? sumX / totalW : L / 2;
  const cogYMm = totalW > 0 ? sumY / totalW : W / 2;
  const cogZMm = totalW > 0 ? sumZ / totalW : 0;

  const cogXPct = Math.max(0, Math.min(100, (cogXMm / L) * 100));
  const cogYPct = Math.max(0, Math.min(100, (cogYMm / W) * 100));
  const cogZPct = Math.max(0, Math.min(100, (cogZMm / H) * 100));

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
  if (longitudinalOffsetPct > 15) {
    const sideZh = cogXPct < 50 ? "前端（车头/柜内深处）" : "后端（柜门侧）";
    const sideEn = cogXPct < 50 ? "nose/front" : "rear/door";
    warningsZh.push(`纵向重心偏${sideZh} ${longitudinalOffsetPct.toFixed(1)}%（超过 15% 警戒线），美欧公路拖车可能触发桥轴超载。`);
    warningsEn.push(`Longitudinal CoG shifted ${longitudinalOffsetPct.toFixed(1)}% toward ${sideEn} (>15%); check truck axle limits.`);
  }
  if (cogZPct > 55 && totalW > 5000) {
    warningsZh.push(`重心高度偏高（${cogZPct.toFixed(1)}% 柜高），请确保重货置底、轻货置顶。`);
    warningsEn.push(`High center of gravity (${cogZPct.toFixed(1)}% of height); place heavier cargo on the floor.`);
  }

  const status: CenterOfGravityReport["status"] =
    lateralOffsetPct > 10 || longitudinalOffsetPct > 15
      ? "imbalanced"
      : lateralOffsetPct > 5 || longitudinalOffsetPct > 10
        ? "caution"
        : "balanced";

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
}

export function buildVgmDeclarationHtml(plan: PackingResult, meta: VgmMeta): string {
  const cargoGrossKg = Math.round(plan.metrics.grossWeight * 10) / 10;
  const tareKg = Math.max(0, meta.tareWeightKg);
  const totalVgmKg = Math.round((cargoGrossKg + tareKg) * 10) / 10;
  const dateStr = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SOLAS VGM Declaration - ${esc(meta.containerNo || "CNTR")}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0F172A; margin: 32px auto; max-width: 780px; padding: 0 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; border-bottom: 2px solid #0F766E; padding-bottom: 10px; }
  .sub { font-size: 13px; color: #475569; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }
  th, td { border: 1px solid #CBD5E1; padding: 10px 12px; text-align: left; }
  th { background: #F8FAFC; width: 34%; color: #334155; }
  .vgm-total { font-size: 18px; font-weight: 700; color: #0F766E; font-variant-numeric: tabular-nums; }
  .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px; font-size: 13px; }
  .sig-box { border-top: 1px solid #334155; padding-top: 8px; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <div class="no-print" style="margin-bottom:16px;text-align:right">
    <button onclick="window.print()" style="padding:8px 16px;background:#0F766E;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600">Print / Save PDF</button>
  </div>
  <h1>SOLAS VERIFIED GROSS MASS (VGM) DECLARATION</h1>
  <p class="sub">International Convention for the Safety of Life at Sea (SOLAS) Chapter VI, Regulation 2 · Generated by CargoFit</p>
  <table>
    <tr><th>Booking / B/L No.</th><td>${esc(meta.bookingNo || "TBD")}</td></tr>
    <tr><th>Container No.</th><td><strong>${esc(meta.containerNo || "TBD")}</strong> (${esc(plan.container.name)})</td></tr>
    <tr><th>Seal No.</th><td>${esc(meta.sealNo || "TBD")}</td></tr>
    <tr><th>Shipper / Authorized Party</th><td>${esc(meta.shipper || "TBD")}</td></tr>
    <tr><th>Weighing Method</th><td>${esc(meta.method)} (${meta.method === "Method 1" ? "Weighing packed container" : "Calculated cargo + packaging + container tare"})</td></tr>
    <tr><th>Cargo &amp; Packaging Gross Weight</th><td>${cargoGrossKg.toLocaleString()} kg (${plan.metrics.loadedCount} cartons)</td></tr>
    <tr><th>Container Tare Weight (CSC Plate)</th><td>${tareKg.toLocaleString()} kg</td></tr>
    <tr><th>Verified Gross Mass (VGM)</th><td class="vgm-total">${totalVgmKg.toLocaleString()} kg</td></tr>
  </table>
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
}

export function buildShippingMarksHtml(
  plan: PackingResult,
  products: readonly ProductInput[],
  meta: ShippingMarkMeta,
): string {
  const bySku = new Map<string, { sku: string; name: string; qty: number; lCm: string; wCm: string; hCm: string; gwKg: number; nwKg: number }>();
  const prodById = new Map(products.map((p) => [p.id, p]));
  const prodBySku = new Map(products.map((p) => [p.sku, p]));

  for (const box of plan.placements) {
    const prod = prodById.get(box.productId) ?? prodBySku.get(box.sku);
    const cur = bySku.get(box.sku) ?? {
      sku: box.sku,
      name: prod?.name || box.sku,
      qty: 0,
      lCm: ((prod?.length ?? box.dx) / 10).toFixed(1),
      wCm: ((prod?.width ?? box.dy) / 10).toFixed(1),
      hCm: ((prod?.height ?? box.dz) / 10).toFixed(1),
      gwKg: box.weight,
      nwKg: Math.round(box.weight * 0.92 * 10) / 10,
    };
    cur.qty += 1;
    bySku.set(box.sku, cur);
  }

  const totalCartons = plan.metrics.loadedCount;
  let cursor = 1;
  const cards: string[] = [];

  for (const item of bySku.values()) {
    const startNo = cursor;
    const endNo = cursor + item.qty - 1;
    cursor = endNo + 1;
    cards.push(`
      <article class="mark-card">
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
          <div class="mark-line"><strong>G.W.:</strong> ${item.gwKg.toFixed(1)} KG &nbsp; <strong>N.W.:</strong> ${item.nwKg.toFixed(1)} KG</div>
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
<title>Shipping Marks - ${esc(meta.poNo || plan.container.name)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0F172A; margin: 24px auto; max-width: 920px; padding: 0 16px; }
  .bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
  .mark-card { display: grid; grid-template-columns: 1fr 1fr; border: 2px solid #0F172A; margin-bottom: 18px; page-break-inside: avoid; }
  .mark-col { padding: 16px 18px; }
  .mark-col.side { border-left: 2px dashed #475569; }
  .mark-tag { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: #0F766E; margin-bottom: 8px; }
  .mark-consignee { font-size: 20px; font-weight: 800; margin-bottom: 10px; }
  .mark-line { font-size: 14px; line-height: 1.65; font-variant-numeric: tabular-nums; }
  .mark-cno { font-size: 18px; font-weight: 700; margin-top: 10px; font-variant-numeric: tabular-nums; }
  .mark-origin { font-size: 13px; font-weight: 700; margin-top: 10px; border-top: 1px solid #CBD5E1; padding-top: 6px; }
  .mark-icons { margin-top: 12px; font-size: 11px; font-weight: 700; color: #334155; border-top: 1px solid #CBD5E1; padding-top: 6px; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <div class="bar no-print">
    <strong>CargoFit Batch Shipping Marks (${bySku.size} SKUs · ${totalCartons} Cartons)</strong>
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
