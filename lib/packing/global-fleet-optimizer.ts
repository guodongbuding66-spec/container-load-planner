import { packLoadingWorkflow } from "./pack-loading";
import { CONTAINER_PRESETS } from "./presets";
import type { ContainerSpec, PackingStrategy, ProductInput } from "./types";

export interface GlobalFleetRateCard {
  freight20gpUsd: number;
  freight40gpUsd: number;
  freight40hqUsd: number;
  /** LCL freight rate per CBM or per 1000kg (whichever is greater, W/M basis). */
  lclRatePerWmUsd: number;
  /** Minimum LCL charge (USD). */
  lclMinChargeUsd: number;
  /** Packaging & handling cost per carton (USD). */
  packagingPerCartonUsd: number;
  /** Local origin/destination handling & customs per FCL container (USD). */
  fclHandlingPerContainerUsd: number;
}

export const DEFAULT_GLOBAL_FLEET_RATES: GlobalFleetRateCard = {
  freight20gpUsd: 2150,
  freight40gpUsd: 3300,
  freight40hqUsd: 3500,
  lclRatePerWmUsd: 115,
  lclMinChargeUsd: 380,
  packagingPerCartonUsd: 2.25,
  fclHandlingPerContainerUsd: 260,
};

export interface FleetLegSummary {
  legIndex: number;
  type: "20GP" | "40GP" | "40HQ" | "LCL";
  loadedCartons: number;
  volumeM3: number;
  volumeUtilPct: number;
  weightKg: number;
  freightUsd: number;
  valid: boolean;
}

export interface GlobalFleetPortfolio {
  id: string;
  labelZh: string;
  labelEn: string;
  legs: FleetLegSummary[];
  totalCartonsLoaded: number;
  totalCartonsRequested: number;
  fullyFulfilled: boolean;
  allValid: boolean;
  avgFclUtilPct: number;
  totalFreightUsd: number;
  totalPackagingUsd: number;
  totalHandlingUsd: number;
  totalLandedCostUsd: number;
  costPerCartonUsd: number;
  savingsVsNaive40HqUsd: number;
}

export interface GlobalFleetOptimizationReport {
  totalRequestedCartons: number;
  totalOrderVolumeM3: number;
  totalOrderWeightKg: number;
  naive40HqCostUsd: number;
  recommended: GlobalFleetPortfolio;
  portfolios: GlobalFleetPortfolio[];
}

function getPresetById(id: string): ContainerSpec {
  return CONTAINER_PRESETS.find((c) => c.id === id) ?? CONTAINER_PRESETS[0];
}

function subtractLoaded(
  remaining: readonly ProductInput[],
  loadedByProductId: ReadonlyMap<string, number>,
): ProductInput[] {
  const next: ProductInput[] = [];
  for (const p of remaining) {
    const used = loadedByProductId.get(p.id) ?? 0;
    const left = Math.max(0, p.quantity - used);
    if (left > 0) next.push({ ...p, quantity: left });
  }
  return next;
}

function simulatePortfolio(
  id: string,
  labelZh: string,
  labelEn: string,
  products: readonly ProductInput[],
  clearanceMm: number,
  strategy: PackingStrategy,
  rates: GlobalFleetRateCard,
  primaryType: "20GP" | "40GP" | "40HQ",
  tailMode: "same" | "20GP" | "40GP" | "LCL",
): GlobalFleetPortfolio {
  const specs: Record<"20GP" | "40GP" | "40HQ", { spec: ContainerSpec; freight: number }> = {
    "20GP": { spec: getPresetById("20gp"), freight: rates.freight20gpUsd },
    "40GP": { spec: getPresetById("40gp"), freight: rates.freight40gpUsd },
    "40HQ": { spec: getPresetById("40hq"), freight: rates.freight40hqUsd },
  };

  let remaining = products.map((p) => ({ ...p })).filter((p) => p.quantity > 0);
  const totalRequested = remaining.reduce((s, p) => s + p.quantity, 0);
  const legs: FleetLegSummary[] = [];
  let maxContainersGuard = 12;

  while (remaining.length > 0 && maxContainersGuard-- > 0) {
    const remVolM3 = remaining.reduce((s, p) => s + (p.length * p.width * p.height * p.quantity) / 1e9, 0);
    const remWtKg = remaining.reduce((s, p) => s + p.weight * p.quantity, 0);

    // Check if remaining tail should switch to LCL or smaller tail container
    const primarySpec = specs[primaryType].spec;
    const primaryVolM3 = (primarySpec.length * primarySpec.width * primarySpec.height) / 1e9;
    const isLikelyTail = remVolM3 < primaryVolM3 * 0.55 && remWtKg < primarySpec.maxWeight * 0.65;

    if (isLikelyTail && tailMode === "LCL") {
      const wm = Math.max(remVolM3, remWtKg / 1000);
      const lclCost = Math.max(rates.lclMinChargeUsd, Number((wm * rates.lclRatePerWmUsd).toFixed(2)));
      const tailCartons = remaining.reduce((s, p) => s + p.quantity, 0);
      legs.push({
        legIndex: legs.length + 1,
        type: "LCL",
        loadedCartons: tailCartons,
        volumeM3: Number(remVolM3.toFixed(2)),
        volumeUtilPct: 100,
        weightKg: Number(remWtKg.toFixed(1)),
        freightUsd: lclCost,
        valid: true,
      });
      remaining = [];
      break;
    }

    const chosenType: "20GP" | "40GP" | "40HQ" =
      isLikelyTail && (tailMode === "20GP" || tailMode === "40GP")
        ? tailMode
        : primaryType;
    const chosen = specs[chosenType];

    const plan = packLoadingWorkflow({
      container: chosen.spec,
      clearance: clearanceMm,
      products: remaining,
      mode: "mixed",
      workflow: "direct",
      strategy,
    });

    if (plan.metrics.loadedCount <= 0) {
      // If chosen smaller tail container couldn't fit an oversized box, fall back to primaryType
      if (chosenType !== primaryType) {
        const fb = specs[primaryType];
        const fbPlan = packLoadingWorkflow({
          container: fb.spec,
          clearance: clearanceMm,
          products: remaining,
          mode: "mixed",
          workflow: "direct",
          strategy,
        });
        if (fbPlan.metrics.loadedCount <= 0) break;
        const loadedMap = new Map(fbPlan.summaries.map((s) => [s.productId, s.loaded]));
        legs.push({
          legIndex: legs.length + 1,
          type: primaryType,
          loadedCartons: fbPlan.metrics.loadedCount,
          volumeM3: Number((fbPlan.metrics.loadedVolume / 1e9).toFixed(2)),
          volumeUtilPct: Number((fbPlan.metrics.volumeUtilization * 100).toFixed(1)),
          weightKg: Number(fbPlan.metrics.grossWeight.toFixed(1)),
          freightUsd: fb.freight,
          valid: fbPlan.validation.valid,
        });
        remaining = subtractLoaded(remaining, loadedMap);
        continue;
      }
      break;
    }

    const loadedMap = new Map(plan.summaries.map((s) => [s.productId, s.loaded]));
    legs.push({
      legIndex: legs.length + 1,
      type: chosenType,
      loadedCartons: plan.metrics.loadedCount,
      volumeM3: Number((plan.metrics.loadedVolume / 1e9).toFixed(2)),
      volumeUtilPct: Number((plan.metrics.volumeUtilization * 100).toFixed(1)),
      weightKg: Number(plan.metrics.grossWeight.toFixed(1)),
      freightUsd: chosen.freight,
      valid: plan.validation.valid,
    });
    remaining = subtractLoaded(remaining, loadedMap);
  }

  const totalCartonsLoaded = legs.reduce((s, l) => s + l.loadedCartons, 0);
  const fclLegs = legs.filter((l) => l.type !== "LCL");
  const avgFclUtilPct =
    fclLegs.length > 0
      ? Number((fclLegs.reduce((s, l) => s + l.volumeUtilPct, 0) / fclLegs.length).toFixed(1))
      : 0;
  const totalFreightUsd = Number(legs.reduce((s, l) => s + l.freightUsd, 0).toFixed(2));
  const totalPackagingUsd = Number((totalCartonsLoaded * rates.packagingPerCartonUsd).toFixed(2));
  const totalHandlingUsd = Number((fclLegs.length * rates.fclHandlingPerContainerUsd).toFixed(2));
  const totalLandedCostUsd = Number((totalFreightUsd + totalPackagingUsd + totalHandlingUsd).toFixed(2));
  const costPerCartonUsd =
    totalCartonsLoaded > 0 ? Number((totalLandedCostUsd / totalCartonsLoaded).toFixed(2)) : 0;

  return {
    id,
    labelZh,
    labelEn,
    legs,
    totalCartonsLoaded,
    totalCartonsRequested: totalRequested,
    fullyFulfilled: totalCartonsLoaded === totalRequested && totalRequested > 0,
    allValid: legs.every((l) => l.valid),
    avgFclUtilPct,
    totalFreightUsd,
    totalPackagingUsd,
    totalHandlingUsd,
    totalLandedCostUsd,
    costPerCartonUsd,
    savingsVsNaive40HqUsd: 0,
  };
}

/**
 * Pillar 4: Global Packaging + Mixed-Container Fleet + LCL/FCL Landed Cost Optimizer (Direction 09 / 24).
 * Evaluates homogeneous & mixed container portfolios (e.g. N×40HQ + 20GP / N×40HQ + LCL)
 * using the REAL deterministic 3D packing solver on every leg.
 */
export function runGlobalFleetOptimizer(
  products: readonly ProductInput[],
  clearanceMm = 10,
  rates: GlobalFleetRateCard = DEFAULT_GLOBAL_FLEET_RATES,
  strategy: PackingStrategy = "practical",
): GlobalFleetOptimizationReport {
  const totalRequestedCartons = products.reduce((s, p) => s + p.quantity, 0);
  const totalOrderVolumeM3 = Number(
    products.reduce((s, p) => s + (p.length * p.width * p.height * p.quantity) / 1e9, 0).toFixed(2),
  );
  const totalOrderWeightKg = Number(
    products.reduce((s, p) => s + p.weight * p.quantity, 0).toFixed(1),
  );

  const candidates: GlobalFleetPortfolio[] = [
    simulatePortfolio("pure-40hq", "纯 40HQ 高柜方案", "All 40HQ Fleet", products, clearanceMm, strategy, rates, "40HQ", "same"),
    simulatePortfolio("40hq-plus-20gp", "40HQ 主柜 + 20GP 尾柜混配", "40HQ + 20GP Tail Mix", products, clearanceMm, strategy, rates, "40HQ", "20GP"),
    simulatePortfolio("40hq-plus-40gp", "40HQ 主柜 + 40GP 尾柜混配", "40HQ + 40GP Tail Mix", products, clearanceMm, strategy, rates, "40HQ", "40GP"),
    simulatePortfolio("40hq-plus-lcl", "40HQ 整柜 + LCL 拼箱尾货", "40HQ FCL + LCL Tail", products, clearanceMm, strategy, rates, "40HQ", "LCL"),
    simulatePortfolio("pure-20gp", "纯 20GP 小柜方案", "All 20GP Fleet", products, clearanceMm, strategy, rates, "20GP", "same"),
  ];

  const naive40HqCostUsd = candidates[0].totalLandedCostUsd;
  for (const c of candidates) {
    c.savingsVsNaive40HqUsd = Number((naive40HqCostUsd - c.totalLandedCostUsd).toFixed(2));
  }

  // Deduplicate identical leg sequences (e.g. if order fits inside 1×40HQ, all 40HQ-tail variants yield 1×40HQ)
  const unique: GlobalFleetPortfolio[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = c.legs.map((l) => `${l.type}:${l.loadedCartons}`).join("|");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  unique.sort((a, b) => {
    if (a.fullyFulfilled !== b.fullyFulfilled) return a.fullyFulfilled ? -1 : 1;
    if (a.allValid !== b.allValid) return a.allValid ? -1 : 1;
    return a.totalLandedCostUsd - b.totalLandedCostUsd;
  });

  return {
    totalRequestedCartons,
    totalOrderVolumeM3,
    totalOrderWeightKg,
    naive40HqCostUsd,
    recommended: unique[0] ?? candidates[0],
    portfolios: unique,
  };
}


/* ==================== Direction 09: Locked Container Protection in Global Fleet Optimization ==================== */
export interface LockedFleetContainer {
  label: string;
  type: "20GP" | "40GP" | "40HQ";
  /** Map of SKU -> locked quantity already loaded and sealed in this container. */
  lockedQuantitiesBySku: Record<string, number>;
  volumeUtilPct: number;
  weightKg: number;
}

export interface GlobalFleetLockedReport {
  lockedContainers: LockedFleetContainer[];
  unlockedOptimization: GlobalFleetOptimizationReport;
  totalLockedCartons: number;
  totalUnlockedCartons: number;
  combinedBestCostUsd: number;
  conservationVerified: boolean;
  summaryZh: string;
  summaryEn: string;
}

/**
 * Re-optimizes only unlocked remaining order cargo while strictly preserving already-loaded
 * locked containers (Direction 09: 已装柜货物锁定保护), verifying exact quantity conservation.
 */
export function optimizeGlobalFleetWithLocks(
  products: readonly ProductInput[],
  lockedContainers: readonly LockedFleetContainer[],
  rates: GlobalFleetRateCard = DEFAULT_GLOBAL_FLEET_RATES,
  strategy: PackingStrategy = "maximum",
): GlobalFleetLockedReport {
  const lockedBySku = new Map<string, number>();
  let totalLockedCartons = 0;
  for (const lc of lockedContainers) {
    for (const [sku, qty] of Object.entries(lc.lockedQuantitiesBySku)) {
      const q = Math.max(0, Math.floor(qty));
      lockedBySku.set(sku, (lockedBySku.get(sku) ?? 0) + q);
      totalLockedCartons += q;
    }
  }

  const remainingProducts: ProductInput[] = [];
  let totalOriginalCartons = 0;
  let totalUnlockedCartons = 0;

  for (const p of products) {
    totalOriginalCartons += p.quantity;
    const locked = lockedBySku.get(p.sku) ?? 0;
    const rem = Math.max(0, p.quantity - locked);
    if (rem > 0) {
      remainingProducts.push({ ...p, quantity: rem });
      totalUnlockedCartons += rem;
    }
  }

  const unlockedOptimization = runGlobalFleetOptimizer(remainingProducts, 0, rates, strategy);

  const lockedFreightUsd = lockedContainers.reduce((sum, lc) => {
    const f =
      lc.type === "20GP"
        ? rates.freight20gpUsd
        : lc.type === "40GP"
          ? rates.freight40gpUsd
          : rates.freight40hqUsd;
    const ctnCount = Object.values(lc.lockedQuantitiesBySku).reduce((s, q) => s + Math.max(0, q), 0);
    return sum + f + rates.fclHandlingPerContainerUsd + ctnCount * rates.packagingPerCartonUsd;
  }, 0);

  const bestUnlockedCost = unlockedOptimization.recommended?.totalLandedCostUsd ?? 0;
  const combinedBestCostUsd = Number((lockedFreightUsd + bestUnlockedCost).toFixed(2));
  const bestUnlockedLoaded = unlockedOptimization.recommended?.legs.reduce((s, l) => s + l.loadedCartons, 0) ?? 0;
  const conservationVerified = totalLockedCartons + bestUnlockedLoaded === totalOriginalCartons;

  return {
    lockedContainers: [...lockedContainers],
    unlockedOptimization,
    totalLockedCartons,
    totalUnlockedCartons,
    combinedBestCostUsd,
    conservationVerified,
    summaryZh: `已锁定 ${lockedContainers.length} 个已装柜（${totalLockedCartons} 箱冻结不动），仅对剩余 ${totalUnlockedCartons} 箱重算最优组合；总落地成本 $${combinedBestCostUsd.toLocaleString()}，数量守恒${conservationVerified ? "已验证通过" : "存在未装尾箱"}。`,
    summaryEn: `Locked ${lockedContainers.length} container(s) (${totalLockedCartons} cartons frozen); re-optimized remaining ${totalUnlockedCartons} cartons. Combined landed cost: $${combinedBestCostUsd.toLocaleString()}.`,
  };
}
