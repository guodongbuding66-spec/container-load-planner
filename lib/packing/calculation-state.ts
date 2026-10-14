import type { PackingResult, PackingStrategy, ReverseCountResult } from "./types";

export type FeasibleRecommendation = {
  totalCartons: number;
  displayQuantity: number;
  displayUnit: ReverseCountResult["displayUnit"];
};

export function isObsoleteCalculation(activeRevision: number | null, inputRevision: number) {
  return activeRevision !== null && activeRevision !== inputRevision;
}

/** A failed solver cannot cancel a peer that may still produce a valid plan. */
export function solverOutcome(finished:ReadonlySet<PackingStrategy>,failed:ReadonlyMap<PackingStrategy,string>,plans:Partial<Record<PackingStrategy,PackingResult>>):'waiting'|'compare'|'retain'|'failed'{
  if(new Set([...finished,...failed.keys()]).size<2)return 'waiting';
  if(finished.has('practical')&&finished.has('maximum'))return 'compare';
  return Object.values(plans).some(p=>p?.validation.valid)?'retain':'failed';
}

/**
 * A dual-solver response is one immutable calculation bundle. UI strategy
 * switches must select from that bundle instead of copying a plan into a
 * second piece of state, otherwise counters and coordinates can drift apart.
 */
export function selectStrategyResult(
  bundle: PackingResult | null,
  strategy: PackingStrategy,
): PackingResult | null {
  if (!bundle) return null;
  const selected = bundle.strategyPlans?.[strategy];
  if (selected) return { ...selected, strategyPlans: bundle.strategyPlans };
  return bundle.strategy === strategy ? bundle : null;
}

export function resultDisplayQuantity(result: PackingResult | null) {
  if (!result) return 0;
  return result.mode === "single" && result.setSummaries.length
    ? result.setSummaries[0].loadedSets
    : result.metrics.loadedCount;
}

/**
 * Volume/weight reversal is an arithmetic upper bound. The number presented
 * as the recommendation must also respect the selected solver's verified
 * coordinate plan, and multi-carton products must remain whole sets.
 */
export function feasibleRecommendation(
  reversePlan: ReverseCountResult,
  verifiedPlan: PackingResult | null | undefined,
): FeasibleRecommendation {
  const verifiedCartons = verifiedPlan?.validation.valid
    ? verifiedPlan.metrics.loadedCount
    : reversePlan.recommendedTotal;
  const rawCartons = Math.max(0, Math.min(reversePlan.recommendedTotal, verifiedCartons));
  const totalCartons = reversePlan.displayUnit === "set"
    ? Math.floor(rawCartons / Math.max(1, reversePlan.cartonsPerSet)) * Math.max(1, reversePlan.cartonsPerSet)
    : Math.floor(rawCartons);
  return {
    totalCartons,
    displayQuantity: reversePlan.displayUnit === "set"
      ? Math.floor(totalCartons / Math.max(1, reversePlan.cartonsPerSet))
      : totalCartons,
    displayUnit: reversePlan.displayUnit,
  };
}
