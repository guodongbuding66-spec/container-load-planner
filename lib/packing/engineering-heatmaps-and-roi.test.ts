import { describe, expect, it } from "vitest";
import { packLoadingWorkflow } from "./pack-loading";
import { computeEngineeringHeatmaps } from "./engineering-heatmaps";
import {
  computePackingRoi,
  DEFAULT_MULTI_OBJECTIVE_WEIGHTS,
  evaluateMultiObjectivePlans,
} from "./multi-objective-roi";
import type { PackingRequest } from "./types";

const sampleReq: PackingRequest = {
  mode: "mixed",
  workflow: "direct",
  strategy: "practical",
  clearance: 10,
  practicalTargetUtilization: 0.9,
  container: {
    id: "20gp",
    name: "20GP",
    length: 5900,
    width: 2352,
    height: 2395,
    doorWidth: 2340,
    doorHeight: 2280,
    maxWeight: 28130,
  },
  products: [
    {
      id: "p1",
      sku: "BOX-A",
      name: "BOX-A",
      length: 500,
      width: 400,
      height: 400,
      weight: 12,
      quantity: 120,
      priority: 50,
      rotationPolicy: "any",
      stackable: true,
      maxStackLayers: 0,
      maxTopLoadKg: undefined, // intentionally missing to verify unverified handling
      color: "#2b8d83",
    },
  ],
};

describe("Engineering Heatmaps (D08), Multi-Objective Evaluator (D02) & ROI (D24)", () => {
  it("marks missing bearing data as unverified instead of falsely safe in topLoad heatmap", () => {
    const plan = packLoadingWorkflow(sampleReq);
    const bundle = computeEngineeringHeatmaps(plan, sampleReq.products, 8, 4);
    expect(bundle.topLoad.cells.length).toBe(32);
    expect(bundle.topLoad.unverifiedCount).toBeGreaterThan(0);
    expect(bundle.floorLoad.maxValue).toBeGreaterThan(0);
    expect(bundle.supportArea.minValue).toBeGreaterThanOrEqual(50);
  });

  it("disqualifies invalid plans in multi-objective scoring regardless of weights", () => {
    const practical = packLoadingWorkflow({ ...sampleReq, strategy: "practical" });
    const invalidMax = {
      ...packLoadingWorkflow({ ...sampleReq, strategy: "maximum" }),
      validation: { ...practical.validation, valid: false },
    };
    const scores = evaluateMultiObjectivePlans([practical, invalidMax], DEFAULT_MULTI_OBJECTIVE_WEIGHTS);
    expect(scores[0].recommended).toBe(true);
    expect(scores[1].valid).toBe(false);
    expect(scores[1].compositeScore).toBe(-1);
  });

  it("computes exact annual container savings and ROI from real container capacities", () => {
    const roi = computePackingRoi({
      annualUnits: 10000,
      freightPerContainer: 3500,
      baselineUnitsPerContainer: 400,
      optimizedUnitsPerContainer: 450,
    });
    expect(roi.valid).toBe(true);
    expect(roi.baselineContainers).toBe(25);
    expect(roi.optimizedContainers).toBe(23);
    expect(roi.containersSaved).toBe(2);
    expect(roi.annualFreightSaved).toBe(7000);
    expect(roi.freightReductionPct).toBe(8.0);
    expect(roi.capacityGainPct).toBe(12.5);
  });
});
