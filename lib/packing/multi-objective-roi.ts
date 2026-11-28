import { computeCenterOfGravity } from "./vgm-cog";
import type { PackingResult } from "./types";

/* ==================== Direction 02: Multi-Objective Plan Evaluator ==================== */
export interface MultiObjectiveWeights {
  maxQuantity: number;     // 0..100
  minPallets: number;      // 0..100
  volumeUtil: number;      // 0..100
  cogStability: number;    // 0..100
  fieldEase: number;       // 0..100
}

export const DEFAULT_MULTI_OBJECTIVE_WEIGHTS: MultiObjectiveWeights = {
  maxQuantity: 35,
  minPallets: 15,
  volumeUtil: 20,
  cogStability: 15,
  fieldEase: 15,
};

export interface MultiObjectiveCandidateScore {
  id: string;
  strategy: PackingResult["strategy"];
  labelZh: string;
  labelEn: string;
  valid: boolean;
  loadedCount: number;
  palletCount: number;
  volumeUtilPct: number;
  cogDeviationPct: number;
  compositeScore: number; // 0..100, -1 if disqualified by hard constraint
  recommended: boolean;
}

/**
 * Evaluates real computed PackingResult candidates under user-defined multi-objective weights.
 * Hard engineering constraints (validation.valid) are NEVER bypassed: invalid plans are disqualified.
 */
export function evaluateMultiObjectivePlans(
  candidates: readonly PackingResult[],
  weights: MultiObjectiveWeights,
): MultiObjectiveCandidateScore[] {
  if (!candidates.length) return [];

  const totalW =
    Math.max(0, weights.maxQuantity) +
    Math.max(0, weights.minPallets) +
    Math.max(0, weights.volumeUtil) +
    Math.max(0, weights.cogStability) +
    Math.max(0, weights.fieldEase);
  const norm = totalW > 0 ? totalW : 1;

  const maxLoaded = Math.max(1, ...candidates.map((c) => c.metrics.loadedCount));
  const maxPallets = Math.max(1, ...candidates.map((c) => c.pallets?.length ?? 0));

  const scored = candidates.map((plan) => {
    const valid = plan.validation.valid;
    const loadedCount = plan.metrics.loadedCount;
    const palletCount = plan.pallets?.length ?? 0;
    const volumeUtilPct = Number((plan.metrics.volumeUtilization * 100).toFixed(1));
    const cog = computeCenterOfGravity(plan);
    const cogDeviationPct = Number(
      (Math.abs(cog.cogXPct - 50) + Math.abs(cog.cogYPct - 50)).toFixed(1),
    );

    const qtyScore = (loadedCount / maxLoaded) * 100;
    const palletScore = palletCount === 0 ? 100 : (1 - palletCount / (maxPallets + 1)) * 100;
    const volScore = Math.min(100, volumeUtilPct);
    const stabScore = Math.max(0, 100 - cogDeviationPct * 2.5);
    const easeScore = plan.strategy === "practical" ? 95 : 72;

    const composite = valid
      ? Number(
          (
            (qtyScore * Math.max(0, weights.maxQuantity) +
              palletScore * Math.max(0, weights.minPallets) +
              volScore * Math.max(0, weights.volumeUtil) +
              stabScore * Math.max(0, weights.cogStability) +
              easeScore * Math.max(0, weights.fieldEase)) /
            norm
          ).toFixed(1),
        )
      : -1;

    return {
      id: plan.id,
      strategy: plan.strategy,
      labelZh: plan.strategy === "practical" ? "现场易执行" : "高密度参考",
      labelEn: plan.strategy === "practical" ? "Practical" : "High-Density",
      valid,
      loadedCount,
      palletCount,
      volumeUtilPct,
      cogDeviationPct,
      compositeScore: composite,
      recommended: false,
    };
  });

  let bestIdx = -1;
  let bestScore = -1;
  scored.forEach((s, i) => {
    if (s.valid && s.compositeScore > bestScore) {
      bestScore = s.compositeScore;
      bestIdx = i;
    }
  });
  if (bestIdx >= 0) scored[bestIdx].recommended = true;
  return scored;
}

/* ==================== Direction 24: Live Economic ROI Calculator ==================== */
export interface PackingRoiInput {
  annualUnits: number;           // Annual shipment volume (cartons or sets)
  freightPerContainer: number;   // Ocean/road freight per container
  baselineUnitsPerContainer: number;
  optimizedUnitsPerContainer: number;
  palletCostDeltaPerContainer?: number; // Optional packaging/pallet savings (+) or extra cost (-) per container
}

export interface PackingRoiResult {
  valid: boolean;
  baselineContainers: number;
  optimizedContainers: number;
  containersSaved: number;
  annualFreightSaved: number;
  annualPackagingDelta: number;
  netAnnualSavings: number;
  freightReductionPct: number;
  capacityGainPct: number;
}

export function computePackingRoi(input: PackingRoiInput): PackingRoiResult {
  const {
    annualUnits,
    freightPerContainer,
    baselineUnitsPerContainer,
    optimizedUnitsPerContainer,
    palletCostDeltaPerContainer = 0,
  } = input;

  if (
    ![annualUnits, freightPerContainer, baselineUnitsPerContainer, optimizedUnitsPerContainer].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    !Number.isFinite(palletCostDeltaPerContainer)
  ) {
    return {
      valid: false,
      baselineContainers: 0,
      optimizedContainers: 0,
      containersSaved: 0,
      annualFreightSaved: 0,
      annualPackagingDelta: 0,
      netAnnualSavings: 0,
      freightReductionPct: 0,
      capacityGainPct: 0,
    };
  }

  const baselineContainers = Math.ceil(annualUnits / baselineUnitsPerContainer);
  const optimizedContainers = Math.ceil(annualUnits / optimizedUnitsPerContainer);
  const containersSaved = baselineContainers - optimizedContainers;
  const annualFreightSaved = Number((containersSaved * freightPerContainer).toFixed(2));
  const annualPackagingDelta = Number((optimizedContainers * palletCostDeltaPerContainer).toFixed(2));
  const netAnnualSavings = Number((annualFreightSaved + annualPackagingDelta).toFixed(2));
  const freightReductionPct = Number(((containersSaved / baselineContainers) * 100).toFixed(1));
  const capacityGainPct = Number(
    (((optimizedUnitsPerContainer / baselineUnitsPerContainer) - 1) * 100).toFixed(1),
  );

  return {
    valid: true,
    baselineContainers,
    optimizedContainers,
    containersSaved,
    annualFreightSaved,
    annualPackagingDelta,
    netAnnualSavings,
    freightReductionPct,
    capacityGainPct,
  };
}
