import { describe, expect, it } from "vitest";
import {
  feasibleRecommendation,
  isObsoleteCalculation,
  resultDisplayQuantity,
  selectStrategyResult,
} from "./calculation-state";
import type { PackingResult, ReverseCountResult } from "./types";

function result(strategy: "practical" | "maximum", sets: number): PackingResult {
  return {
    id: strategy,
    mode: "single",
    strategy,
    practicalTargetUtilization: 0.88,
    engineVersion: "test",
    container: { id: "40hq", name: "40HQ", length: 1, width: 1, height: 1, doorWidth: 1, doorHeight: 1, maxWeight: 1 },
    clearance: 0,
    placements: [],
    summaries: [],
    setSummaries: [{
      setCode: "SET-2BOX",
      componentCount: 2,
      cartonsPerSet: 2,
      requestedCartons: sets * 2,
      loadedCartons: sets * 2,
      requestedSets: sets,
      loadedSets: sets,
      unloadedSets: 0,
      requestQuantitiesAligned: true,
      items: [],
    }],
    metrics: {
      loadedCount: sets * 2,
      requestedCount: sets * 2,
      grossWeight: 0,
      loadedVolume: 0,
      effectiveVolume: 1,
      volumeUtilization: 0,
      weightUtilization: 0,
      centerOfGravity: { x: 0, y: 0, z: 0, longitudinalRatio: 0, lateralRatio: 0, heightRatio: 0, balanced: true },
      executionComplexity: { orientationVariants: 1, maxOrientationsPerSku: 1, partialSupportCount: 0, tippedCartonCount: 0 },
      solveTimeMs: 0,
    },
    validation: { valid: true, errors: [] },
    warnings: [],
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("calculation request state", () => {
  it("rejects results and errors produced for an older input revision", () => {
    expect(isObsoleteCalculation(4, 5)).toBe(true);
    expect(isObsoleteCalculation(5, 5)).toBe(false);
    expect(isObsoleteCalculation(null, 5)).toBe(false);
  });

  it("selects both strategies from one immutable dual-plan bundle", () => {
    const practical = result("practical", 476);
    const maximum = result("maximum", 528);
    const bundle = { ...practical, strategyPlans: { practical, maximum } };

    const selectedPractical = selectStrategyResult(bundle, "practical");
    const selectedMaximum = selectStrategyResult(bundle, "maximum");

    expect(resultDisplayQuantity(selectedPractical)).toBe(476);
    expect(resultDisplayQuantity(selectedMaximum)).toBe(528);
    expect(selectedPractical?.strategyPlans).toBe(bundle.strategyPlans);
    expect(selectedMaximum?.strategyPlans).toBe(bundle.strategyPlans);
  });

  it("clamps an arithmetic recommendation to the verified whole-set plan", () => {
    const reversePlan: ReverseCountResult = {
      targetVolumeUtilization: 1,
      targetWeightUtilization: 1,
      effectiveVolume: 1,
      averageUnitVolume: 1,
      averageUnitWeight: 1,
      volumeLimitedTotal: 1222,
      weightLimitedTotal: 1058,
      recommendedTotal: 1058,
      displayUnit: "set",
      cartonsPerSet: 2,
      volumeLimitedDisplay: 611,
      weightLimitedDisplay: 529,
      recommendedDisplay: 529,
      limitingFactor: "weight",
      quantities: [],
    };

    expect(feasibleRecommendation(reversePlan, result("maximum", 528))).toEqual({
      totalCartons: 1056,
      displayQuantity: 528,
      displayUnit: "set",
    });
  });
});
