import type { ContainerSpec, PackingResult, ProductInput } from "./types";

export interface RoadWeightPreset {
  id: "ocean_standard" | "us_ipi_road" | "eu_40t_road";
  labelZh: string;
  labelEn: string;
  limitsKg: { c20: number; c40: number; defaultMax: number };
  noteZh: string;
  noteEn: string;
}

export const ROAD_WEIGHT_PRESETS: readonly RoadWeightPreset[] = [
  {
    id: "ocean_standard",
    labelZh: "海运船司标准限重",
    labelEn: "Ocean carrier standard",
    limitsKg: { c20: 28200, c40: 28600, defaultMax: 28600 },
    noteZh: "按标准 ISO 集装箱铭牌最大净载重控制。",
    noteEn: "Standard ISO container CSC plate payload limit.",
  },
  {
    id: "us_ipi_road",
    labelZh: "美国内陆 IPI / 80,000 lb 公路限重",
    labelEn: "US IPI / Federal 80,000 lb road limit",
    limitsKg: { c20: 17500, c40: 19900, defaultMax: 19900 },
    noteZh: "美国联邦公路总重 80,000 lb 约束（20GP 建议 ≤17.5T，40GP/HQ 建议 ≤19.9T）。",
    noteEn: "US Federal 80,000 lb GVW road limit (~17.5T for 20ft, ~19.9T for 40ft).",
  },
  {
    id: "eu_40t_road",
    labelZh: "欧盟 40T 公路组合限重",
    labelEn: "EU 40T road combination limit",
    limitsKg: { c20: 21500, c40: 23500, defaultMax: 23500 },
    noteZh: "欧洲常规 40T 牵引车+挂车公路合规载重参考。",
    noteEn: "Typical EU 40T tractor-trailer road payload reference.",
  },
];

export function recommendedPayloadLimitKg(container: ContainerSpec, presetId: RoadWeightPreset["id"]): number {
  const preset = ROAD_WEIGHT_PRESETS.find((p) => p.id === presetId) ?? ROAD_WEIGHT_PRESETS[0];
  if (container.length <= 7000) return Math.min(container.maxWeight, preset.limitsKg.c20);
  if (container.length <= 14000) return Math.min(container.maxWeight, preset.limitsKg.c40);
  return Math.min(container.maxWeight, preset.limitsKg.defaultMax);
}

/**
 * Vertical nesting height calculation (e.g., chairs, buckets, trays):
 * 1 unit = baseHeightMm; n units = baseHeightMm + (n - 1) * deltaHeightMm
 */
export function calcNestedStackHeight(baseHeightMm: number, deltaHeightMm: number, layers: number): number {
  if (layers <= 0) return 0;
  const safeDelta = Math.max(0, Math.min(baseHeightMm, deltaHeightMm));
  return Number((baseHeightMm + (layers - 1) * safeDelta).toFixed(2));
}

/**
 * Compare rectangular grid vs. hexagonal staggered packing for cylindrical cargo (drums/rolls).
 */
export interface CylinderPackingComparison {
  matrixCount: number;
  hexStaggeredCount: number;
  gainCount: number;
  gainPercent: number;
  hexRowPitchMm: number;
}

export function compareCylinderPacking(
  usableLengthMm: number,
  usableWidthMm: number,
  diameterMm: number,
): CylinderPackingComparison {
  if (diameterMm <= 0 || usableLengthMm < diameterMm || usableWidthMm < diameterMm) {
    return { matrixCount: 0, hexStaggeredCount: 0, gainCount: 0, gainPercent: 0, hexRowPitchMm: 0 };
  }
  const colsL = Math.floor(usableLengthMm / diameterMm);
  const rowsW = Math.floor(usableWidthMm / diameterMm);
  const matrixCount = colsL * rowsW;

  const pitch = diameterMm * (Math.sqrt(3) / 2);

  // Try staggering along width (rows across W) and along length (rows across L), pick higher
  const evalHex = (primary: number, secondary: number) => {
    const rows = 1 + Math.floor((secondary - diameterMm) / pitch);
    let total = 0;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 1 ? diameterMm / 2 : 0;
      const fit = Math.floor((primary - offset) / diameterMm);
      if (fit > 0) total += fit;
    }
    return total;
  };

  const hexStaggeredCount = Math.max(matrixCount, evalHex(usableLengthMm, usableWidthMm), evalHex(usableWidthMm, usableLengthMm));
  const gainCount = hexStaggeredCount - matrixCount;
  const gainPercent = matrixCount > 0 ? Number(((gainCount / matrixCount) * 100).toFixed(1)) : 0;

  return {
    matrixCount,
    hexStaggeredCount,
    gainCount,
    gainPercent,
    hexRowPitchMm: Number(pitch.toFixed(1)),
  };
}

export interface ReeferAirflowCheck {
  isReefer: boolean;
  redLineHeightMm: number;
  maxLoadedTopMm: number;
  violatesRedLine: boolean;
  frontGapMm: number;
  violatesFrontAirflow: boolean;
}

export function inspectReeferAirflow(plan: PackingResult, redLineMarginMm = 130, frontGapMinMm = 100): ReeferAirflowCheck {
  const id = `${plan.container.id} ${plan.container.name}`.toUpperCase();
  const isReefer = /\b(20RF|40RF|40RH|45RH|REEFER)\b/.test(id) || id.includes("冷藏");
  const redLineHeightMm = Math.max(0, plan.container.height - redLineMarginMm);
  const maxLoadedTopMm = plan.placements.reduce((m, b) => Math.max(m, b.z + b.dz), 0);
  const minLoadedX = plan.placements.length ? Math.min(...plan.placements.map((b) => b.x)) : plan.container.length;

  return {
    isReefer,
    redLineHeightMm,
    maxLoadedTopMm,
    violatesRedLine: isReefer && maxLoadedTopMm > redLineHeightMm,
    frontGapMm: Math.round(minLoadedX),
    violatesFrontAirflow: isReefer && plan.placements.length > 0 && minLoadedX < frontGapMinMm,
  };
}

export interface BctHumidityWarning {
  sku: string;
  bottomLoadKg: number;
  ratedMaxTopLoadKg: number;
  requiredSafeCapacityKg: number;
  safetyFactor: number;
}

export function auditHumidityBct(
  plan: PackingResult,
  products: readonly ProductInput[],
  safetyFactor: 1.5 | 2.5 | 3.0 = 2.5,
): BctHumidityWarning[] {
  const productMap = new Map(products.map((p) => [p.id, p]));
  const warnings: BctHumidityWarning[] = [];
  const seenSku = new Set<string>();

  for (const box of plan.placements) {
    if (box.z > 5 || seenSku.has(box.sku)) continue;
    const prod = productMap.get(box.productId);
    if (!prod?.maxTopLoadKg || prod.maxTopLoadKg <= 0) continue;

    // Approximate column load directly above this bottom carton
    const aboveWeight = plan.placements
      .filter(
        (other) =>
          other.id !== box.id &&
          other.z >= box.z + box.dz - 2 &&
          other.x < box.x + box.dx - 1 &&
          other.x + other.dx > box.x + 1 &&
          other.y < box.y + box.dy - 1 &&
          other.y + other.dy > box.y + 1,
      )
      .reduce((sum, b) => sum + b.weight, 0);

    const requiredSafeCapacityKg = Number((aboveWeight * safetyFactor).toFixed(1));
    if (aboveWeight > 0 && requiredSafeCapacityKg > prod.maxTopLoadKg) {
      seenSku.add(box.sku);
      warnings.push({
        sku: box.sku,
        bottomLoadKg: Number(aboveWeight.toFixed(1)),
        ratedMaxTopLoadKg: prod.maxTopLoadKg,
        requiredSafeCapacityKg,
        safetyFactor,
      });
    }
  }
  return warnings;
}

export interface DunnageBomEstimate {
  lateralGapMm: number;
  rearVoidMm: number;
  airbagsRecommended: number;
  airbagSpec: string;
  desiccantPoles: number;
  lashingStraps: number;
  stretchFilmRolls: number;
  rearDoorClearanceOk: boolean;
}

export function estimateDunnageBom(plan: PackingResult, minRearDoorClearanceMm = 100): DunnageBomEstimate {
  const usableL = plan.container.length - 2 * plan.clearance;
  const usableW = plan.container.width - 2 * plan.clearance;
  const maxX = plan.placements.reduce((m, b) => Math.max(m, b.x + b.dx), 0);
  const maxY = plan.placements.reduce((m, b) => Math.max(m, b.y + b.dy), 0);
  const minY = plan.placements.length ? Math.min(...plan.placements.map((b) => b.y)) : 0;

  const lateralGapMm = Math.max(0, Math.round(usableW - (maxY - minY)));
  const rearVoidMm = Math.max(0, Math.round(usableL - maxX));

  let airbagsRecommended = 0;
  let airbagSpec = "无需充气袋 / None needed";
  if (lateralGapMm >= 80 && lateralGapMm <= 450 && plan.placements.length > 0) {
    const sections = Math.max(2, Math.ceil(maxX / 2400));
    airbagsRecommended = sections;
    airbagSpec = lateralGapMm <= 200 ? "900 × 1200 mm (Level 1)" : "1000 × 1800 mm (Level 2)";
  }

  const is40ft = plan.container.length >= 10000;
  const desiccantPoles = plan.placements.length === 0 ? 0 : is40ft ? 14 : 8;
  const lashingStraps = plan.placements.length === 0 ? 0 : plan.metrics.grossWeight > 12000 ? 6 : 4;
  const palletCount = plan.pallets?.length ?? 0;
  const stretchFilmRolls = palletCount > 0 ? Math.max(1, Math.ceil(palletCount / 10)) : 0;

  return {
    lateralGapMm,
    rearVoidMm,
    airbagsRecommended,
    airbagSpec,
    desiccantPoles,
    lashingStraps,
    stretchFilmRolls,
    rearDoorClearanceOk: rearVoidMm >= minRearDoorClearanceMm,
  };
}

export interface HexCylinderPlacement {
  index: number;
  cx: number;
  cy: number;
  z: number;
  diameterMm: number;
  heightMm: number;
  layer: number;
}

/**
 * Generates exact non-overlapping 3D staggered hexagonal coordinates for cylindrical drums/rolls.
 */
export function packHexCylinders(
  container: ContainerSpec,
  diameterMm: number,
  heightMm: number,
  weightKg: number,
  quantity: number,
  clearance = 10,
): HexCylinderPlacement[] {
  const L = container.length - 2 * clearance - (container.loadingAccess === "open" ? 0 : Math.max(0, container.rearDoorClearanceMm ?? 0));
  const W = Math.min(container.width, container.loadingAccess === "open" ? container.width : container.doorWidth) - 2 * clearance;
  const H = Math.min(container.height, container.loadingAccess === "open" ? container.height : container.doorHeight) - clearance;
  if (diameterMm <= 0 || heightMm <= 0 || quantity <= 0 || L < diameterMm || W < diameterMm || H < heightMm) return [];

  const r = diameterMm / 2;
  const pitch = diameterMm * (Math.sqrt(3) / 2);
  const maxLayers = Math.floor(H / heightMm);
  const maxByWeight = weightKg > 0 ? Math.floor(container.maxWeight / weightKg) : quantity;
  const target = Math.min(quantity, maxByWeight);

  const layer2D: Array<{ cx: number; cy: number }> = [];
  const rows = 1 + Math.floor((W - diameterMm) / pitch);
  for (let row = 0; row < rows; row++) {
    const cy = r + row * pitch;
    const xOffset = row % 2 === 1 ? r : 0;
    const cols = Math.floor((L - xOffset) / diameterMm);
    for (let col = 0; col < cols; col++) {
      layer2D.push({ cx: Number((r + xOffset + col * diameterMm).toFixed(4)), cy: Number(cy.toFixed(4)) });
    }
  }

  const out: HexCylinderPlacement[] = [];
  for (let layer = 0; layer < maxLayers && out.length < target; layer++) {
    for (const pt of layer2D) {
      if (out.length >= target) break;
      out.push({
        index: out.length + 1,
        cx: pt.cx,
        cy: pt.cy,
        z: Number((layer * heightMm).toFixed(2)),
        diameterMm,
        heightMm,
        layer: layer + 1,
      });
    }
  }
  return out;
}

export interface NestedColumnBox {
  layer: number;
  z: number;
  effectiveDz: number;
  cumulativeHeightMm: number;
}

/**
 * Generates non-overlapping incremental Z-slices for vertically nested items (H + (n-1)*ΔH).
 */
export function buildNestedColumnBoxes(
  baseHeightMm: number,
  deltaHeightMm: number,
  maxCeilingMm: number,
  quantity: number,
): NestedColumnBox[] {
  if (baseHeightMm <= 0 || quantity <= 0 || maxCeilingMm < baseHeightMm) return [];
  const safeDelta = Math.max(1, Math.min(baseHeightMm, deltaHeightMm));
  const out: NestedColumnBox[] = [];
  let z = 0;
  for (let i = 0; i < quantity; i++) {
    const dz = i === 0 ? baseHeightMm : safeDelta;
    if (z + dz > maxCeilingMm + 1e-6) break;
    out.push({ layer: i + 1, z: Number(z.toFixed(2)), effectiveDz: Number(dz.toFixed(2)), cumulativeHeightMm: Number((z + dz).toFixed(2)) });
    z += dz;
  }
  return out;
}
