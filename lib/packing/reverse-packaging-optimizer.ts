import { CONTAINER_PRESETS } from "./presets";
import { packLoadingWorkflow } from "./pack-loading";
import { computePackagingBom, type PackagingBomConfig } from "./packaging-bom";
import { computePackingRoi } from "./multi-objective-roi";
import type { ContainerSpec, PackingStrategy, ProductInput } from "./types";

export interface ReversePackagingRange {
  /** Allowed change on length in mm (e.g. minDeltaMm: -20, maxDeltaMm: 20, stepMm: 10). */
  lengthMinDeltaMm: number;
  lengthMaxDeltaMm: number;
  widthMinDeltaMm: number;
  widthMaxDeltaMm: number;
  heightMinDeltaMm: number;
  heightMaxDeltaMm: number;
  stepMm: number;
}

export interface ReversePackagingEconomics {
  annualShippedCartons: number;
  freightPerContainerUsd: number;
  /** Corrugated board material price per m^2 (USD, default $1.15/m^2). */
  corrugatedUsdPerM2: number;
  bomConfig?: Partial<PackagingBomConfig>;
}

export interface ReversePackagingCandidate {
  id: string;
  targetSku: string;
  deltasMm: [number, number, number];
  proposedDimsMm: [number, number, number];
  loadedCount: number;
  gainCartons: number;
  volumeUtilPct: number;
  /** Corrugated cardboard area change per carton (m^2). */
  boardAreaDeltaM2: number;
  /** Material cost delta per carton (USD, negative means material savings). */
  materialCostDeltaPerCartonUsd: number;
  annualContainersSaved: number;
  annualFreightSavedUsd: number;
  annualMaterialDeltaUsd: number;
  /** Net annual benefit = freight saved - extra cardboard cost. */
  netAnnualBenefitUsd: number;
  valid: boolean;
}

export interface ReversePackagingReport {
  targetSku: string;
  originalDimsMm: [number, number, number];
  baselineLoadedCount: number;
  baselineVolumeUtilPct: number;
  candidatesEvaluated: number;
  bestCandidate: ReversePackagingCandidate | null;
  topCandidates: ReversePackagingCandidate[];
}

export const DEFAULT_REVERSE_RANGE: ReversePackagingRange = {
  lengthMinDeltaMm: -20,
  lengthMaxDeltaMm: 10,
  widthMinDeltaMm: -20,
  widthMaxDeltaMm: 10,
  heightMinDeltaMm: -20,
  heightMaxDeltaMm: 10,
  stepMm: 10,
};

function cartonSurfaceAreaM2(l: number, w: number, h: number): number {
  // Standard RSC corrugated box area including flaps (~2*(LW + LH + WH) + 12% glue/flap allowance)
  return (2 * (l * w + l * h + w * h) * 1.12) / 1e6;
}

function buildAxisSteps(minD: number, maxD: number, step: number): number[] {
  const s = Math.max(5, Math.round(step));
  const vals: number[] = [];
  for (let d = Math.round(minD); d <= Math.round(maxD); d += s) {
    if (d !== 0) vals.push(d);
  }
  return vals;
}

/**
 * Pillar 2: Multi-Axis Joint Reverse Product & Packaging Dimension Optimizer (Direction 03).
 * Performs 2-stage deterministic search (single-axis sensitivity + joint multi-axis combinations)
 * using the REAL 3D packing solver, linking carton geometry to corrugated material area & annual freight ROI.
 */
export function runReversePackagingOptimizer(
  products: readonly ProductInput[],
  container: ContainerSpec,
  clearance: number,
  targetProductId: string,
  range: ReversePackagingRange = DEFAULT_REVERSE_RANGE,
  economics: ReversePackagingEconomics = {
    annualShippedCartons: 10000,
    freightPerContainerUsd: 3500,
    corrugatedUsdPerM2: 1.15,
  },
  strategy: PackingStrategy = "maximum",
): ReversePackagingReport {
  const target = products.find((p) => p.id === targetProductId) ?? products[0];
  if (!target) {
    return {
      targetSku: "-",
      originalDimsMm: [0, 0, 0],
      baselineLoadedCount: 0,
      baselineVolumeUtilPct: 0,
      candidatesEvaluated: 0,
      bestCandidate: null,
      topCandidates: [],
    };
  }

  const singleMode = products.length === 1;
  const evalDims = (dl: number, dw: number, dh: number) => {
    const nl = Math.max(50, Math.round(target.length + dl));
    const nw = Math.max(50, Math.round(target.width + dw));
    const nh = Math.max(50, Math.round(target.height + dh));
    const modProducts = products.map((p) =>
      p.id === target.id ? { ...p, length: nl, width: nw, height: nh } : p,
    );
    const plan = packLoadingWorkflow({
      container,
      clearance,
      products: modProducts,
      mode: singleMode ? "single" : "mixed",
      workflow: singleMode ? "single-capacity" : "direct",
      strategy,
    });
    return { nl, nw, nh, plan };
  };

  const base = evalDims(0, 0, 0);
  const baseCount = Math.max(1, base.plan.metrics.loadedCount);
  const baseVolPct = Number((base.plan.metrics.volumeUtilization * 100).toFixed(2));
  const baseArea = cartonSurfaceAreaM2(target.length, target.width, target.height);

  // Also ensure BOM hook is exercised cleanly for baseline sanity
  computePackagingBom(base.plan, products, economics.bomConfig);

  const lSteps = buildAxisSteps(range.lengthMinDeltaMm, range.lengthMaxDeltaMm, range.stepMm);
  const wSteps = buildAxisSteps(range.widthMinDeltaMm, range.widthMaxDeltaMm, range.stepMm);
  const hSteps = buildAxisSteps(range.heightMinDeltaMm, range.heightMaxDeltaMm, range.stepMm);

  const tried = new Set<string>(["0,0,0"]);
  const candidates: ReversePackagingCandidate[] = [];

  const testDelta = (dl: number, dw: number, dh: number) => {
    const key = `${dl},${dw},${dh}`;
    if (tried.has(key)) return;
    tried.add(key);
    const { nl, nw, nh, plan } = evalDims(dl, dw, dh);
    if (!plan.validation.valid) return;

    const loadedCount = plan.metrics.loadedCount;
    const gainCartons = loadedCount - baseCount;
    const newArea = cartonSurfaceAreaM2(nl, nw, nh);
    const boardAreaDeltaM2 = Number((newArea - baseArea).toFixed(4));
    const materialCostDeltaPerCartonUsd = Number(
      (boardAreaDeltaM2 * economics.corrugatedUsdPerM2).toFixed(4),
    );
    const roi = computePackingRoi({
      annualUnits: Math.max(1, economics.annualShippedCartons),
      freightPerContainer: Math.max(1, economics.freightPerContainerUsd),
      baselineUnitsPerContainer: baseCount,
      optimizedUnitsPerContainer: Math.max(1, loadedCount),
    });
    const annualMaterialDeltaUsd = Number(
      (materialCostDeltaPerCartonUsd * economics.annualShippedCartons).toFixed(2),
    );
    const netAnnualBenefitUsd = Number(
      (roi.annualFreightSaved - annualMaterialDeltaUsd).toFixed(2),
    );

    candidates.push({
      id: `rev-${key}`,
      targetSku: target.sku,
      deltasMm: [dl, dw, dh],
      proposedDimsMm: [nl, nw, nh],
      loadedCount,
      gainCartons,
      volumeUtilPct: Number((plan.metrics.volumeUtilization * 100).toFixed(2)),
      boardAreaDeltaM2,
      materialCostDeltaPerCartonUsd,
      annualContainersSaved: roi.containersSaved,
      annualFreightSavedUsd: Number(roi.annualFreightSaved.toFixed(2)),
      annualMaterialDeltaUsd,
      netAnnualBenefitUsd,
      valid: plan.validation.valid,
    });
  };

  // Stage 1: Single-axis sensitivity sweep
  for (const dl of lSteps) testDelta(dl, 0, 0);
  for (const dw of wSteps) testDelta(0, dw, 0);
  for (const dh of hSteps) testDelta(0, 0, dh);

  // Stage 2: Joint multi-axis combinations from top single-axis improvements
  const bestL = [...candidates].filter((c) => c.deltasMm[1] === 0 && c.deltasMm[2] === 0).sort((a, b) => b.netAnnualBenefitUsd - a.netAnnualBenefitUsd)[0]?.deltasMm[0] ?? 0;
  const bestW = [...candidates].filter((c) => c.deltasMm[0] === 0 && c.deltasMm[2] === 0).sort((a, b) => b.netAnnualBenefitUsd - a.netAnnualBenefitUsd)[0]?.deltasMm[1] ?? 0;
  const bestH = [...candidates].filter((c) => c.deltasMm[0] === 0 && c.deltasMm[1] === 0).sort((a, b) => b.netAnnualBenefitUsd - a.netAnnualBenefitUsd)[0]?.deltasMm[2] ?? 0;

  if (bestL !== 0 && bestW !== 0) testDelta(bestL, bestW, 0);
  if (bestL !== 0 && bestH !== 0) testDelta(bestL, 0, bestH);
  if (bestW !== 0 && bestH !== 0) testDelta(0, bestW, bestH);
  if (bestL !== 0 && bestW !== 0 && bestH !== 0) testDelta(bestL, bestW, bestH);

  // Sort by net annual benefit first, then carton gain, then volume utilization
  candidates.sort(
    (a, b) =>
      b.netAnnualBenefitUsd - a.netAnnualBenefitUsd ||
      b.gainCartons - a.gainCartons ||
      b.volumeUtilPct - a.volumeUtilPct,
  );

  const positive = candidates.filter((c) => c.gainCartons > 0 || c.netAnnualBenefitUsd > 0);
  return {
    targetSku: target.sku,
    originalDimsMm: [target.length, target.width, target.height],
    baselineLoadedCount: baseCount,
    baselineVolumeUtilPct: baseVolPct,
    candidatesEvaluated: tried.size - 1,
    bestCandidate: positive[0] ?? null,
    topCandidates: candidates.slice(0, 8),
  };
}


/* ==================== Direction 03 Extension: Multi-Container (20GP/40GP/40HQ) & Pallet Fit Matrix ==================== */
export interface ReversePackagingMultiContainerRow {
  containerId: string;
  containerName: string;
  loadedCartons: number;
  volumeUtilPct: number;
  freightPerCartonUsd: number;
}

export interface ReversePackagingHolisticMatrix {
  cartonDimsMm: { length: number; width: number; height: number };
  recommendedPalletId: string;
  recommendedPalletNameZh: string;
  cartonsPerPalletLayer: number;
  containers: ReversePackagingMultiContainerRow[];
}

/**
 * Evaluates a candidate carton dimension across 20GP, 40GP, and 40HQ containers using the real 3D solver
 * and identifies the highest-area-utilization standard pallet footprint.
 */
export function evaluateReversePackagingMatrix(
  baseProduct: ProductInput,
  candidateDimsMm: { length: number; width: number; height: number },
  freightMap: Record<string, number> = { "20gp": 2150, "40gp": 3300, "40hq": 3500 },
): ReversePackagingHolisticMatrix {
  const testProd: ProductInput = {
    ...baseProduct,
    length: candidateDimsMm.length,
    width: candidateDimsMm.width,
    height: candidateDimsMm.height,
    quantity: 2000,
  };

  const targetIds = ["20gp", "40gp", "40hq"];
  const containers: ReversePackagingMultiContainerRow[] = [];
  for (const cid of targetIds) {
    const ctn = CONTAINER_PRESETS.find((c) => c.id === cid);
    if (!ctn) continue;
    const plan = packLoadingWorkflow({
      container: ctn,
      products: [testProd],
      mode: "single",
      strategy: "maximum",
      clearance: 0,
    });
    const loaded = Math.max(1, plan.metrics.loadedCount);
    const freight = freightMap[cid] ?? 3500;
    containers.push({
      containerId: cid,
      containerName: ctn.name,
      loadedCartons: plan.metrics.loadedCount,
      volumeUtilPct: Number((plan.metrics.volumeUtilization * 100).toFixed(1)),
      freightPerCartonUsd: Number((freight / loaded).toFixed(2)),
    });
  }

  // Evaluate standard pallet footprints for best area fit
  const pallets = [
    { id: "eur1", zh: "欧标 EUR 1 (1200×800)", l: 1200, w: 800 },
    { id: "eur2", zh: "欧标 EUR 2 (1200×1000)", l: 1200, w: 1000 },
    { id: "gma", zh: "北美 GMA (1219×1016)", l: 1219, w: 1016 },
    { id: "asia", zh: "亚洲标准 (1100×1100)", l: 1100, w: 1100 },
  ];
  let bestPal = pallets[0];
  let bestCount = 0;
  let bestUtil = -1;
  for (const pal of pallets) {
    const c1 = Math.floor(pal.l / candidateDimsMm.length) * Math.floor(pal.w / candidateDimsMm.width);
    const c2 = Math.floor(pal.l / candidateDimsMm.width) * Math.floor(pal.w / candidateDimsMm.length);
    const cnt = Math.max(c1, c2);
    const util = (cnt * candidateDimsMm.length * candidateDimsMm.width) / (pal.l * pal.w);
    if (util > bestUtil) {
      bestUtil = util;
      bestCount = cnt;
      bestPal = pal;
    }
  }

  return {
    cartonDimsMm: { ...candidateDimsMm },
    recommendedPalletId: bestPal.id,
    recommendedPalletNameZh: bestPal.zh,
    cartonsPerPalletLayer: bestCount,
    containers,
  };
}
