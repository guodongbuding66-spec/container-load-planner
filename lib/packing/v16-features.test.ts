import { describe, expect, it } from "vitest";
import {
  auditCartonBct,
  computeActualTopLoadsByPlacement,
  computeMcKeeLabBctKgf,
} from "./bct-estimator";
import { comparePackingPlans, planComparisonToCsv } from "./plan-comparator";
import type { PackingResult } from "./types";

type Placement = PackingResult["placements"][number];

function mkBox(id: string, sku: string, x: number, y: number, z: number, dx: number, dy: number, dz: number, weight: number): Placement {
  return {
    id,
    productId: sku,
    sku,
    name: sku,
    color: "#0f766e",
    x,
    y,
    z,
    dx,
    dy,
    dz,
    weight,
    layer: 1,
    step: 1,
    orientation: "LWH",
  } as unknown as Placement;
}

function mkPlan(placements: Placement[], strategy: "practical" | "maximum" = "practical"): PackingResult {
  const totalWeight = placements.reduce((s, p) => s + p.weight, 0);
  const totalVol = placements.reduce((s, p) => s + (p.dx * p.dy * p.dz) / 1e9, 0);
  const cVol = (5898 * 2352 * 2393) / 1e9;
  return {
    id: `plan-${strategy}`,
    createdAt: "2026-11-28T00:00:00Z",
    engineVersion: "1.6.0",
    strategy,
    container: {
      id: "20gp",
      name: "20GP",
      length: 5898,
      width: 2352,
      height: 2393,
      doorWidth: 2352,
      doorHeight: 2393,
      maxWeight: 28000,
    },
    clearance: 0,
    placements,
    unloaded: [],
    metrics: {
      requestedCount: placements.length,
      loadedCount: placements.length,
      unloadedCount: 0,
      volumeUtilization: totalVol / cVol,
      weightUtilization: totalWeight / 28000,
      totalWeight,
      totalVolumeM3: totalVol,
      containerVolumeM3: cVol,
      centerOfGravity: { x: 2000, y: 1176, z: 500 },
      frontBackBalance: 0.5,
      leftRightBalance: 0.5,
      layerCount: 2,
    },
    validation: { valid: true, errors: [], warnings: [] },
    steps: [],
  } as unknown as PackingResult;
}

describe("v1.6.0 D07 McKee BCT Carton Compression Estimator", () => {
  it("computes McKee laboratory BCT accurately in kgf", () => {
    // ECT=8.4 kN/m, h=6.8 mm, L=600, W=400 -> Z=2000 mm -> BCT_N = 5.87 * 8.4 * sqrt(6.8*2000) = 5749.2 N -> ~586.3 kgf
    const bct = computeMcKeeLabBctKgf(8.4, 6.8, 600, 400);
    expect(bct).toBeGreaterThan(580);
    expect(bct).toBeLessThan(595);
  });

  it("propagates cumulative vertical top loads down a 3-high stack and flags crush risk under humid ocean profile", () => {
    const stack = mkPlan([
      mkBox("b1", "HEAVY-BOX", 0, 0, 0, 500, 400, 400, 80),
      mkBox("b2", "HEAVY-BOX", 0, 0, 400, 500, 400, 400, 80),
      mkBox("b3", "HEAVY-BOX", 0, 0, 800, 500, 400, 400, 80),
    ]);
    const loads = computeActualTopLoadsByPlacement(stack);
    expect(loads.get("b3")).toBe(0);
    expect(loads.get("b2")).toBe(80);
    expect(loads.get("b1")).toBe(160);

    // Single-wall C-flute under 60d humid ocean (retention 0.25) -> safe top load ~70 kg < 160 kg -> crush-risk
    const audit = auditCartonBct(stack, "c-single", "ocean-60d-humid");
    expect(audit.crushRiskSkus).toBe(1);
    expect(audit.rows[0].actualMaxTopLoadKg).toBe(160);
    expect(audit.rows[0].status).toBe("crush-risk");
  });
});

describe("v1.6.0 D19 Side-by-Side Plan Comparator", () => {
  it("compares practical vs maximum plans across 7 metrics and exports CSV", () => {
    const planA = mkPlan([mkBox("a1", "SKU-1", 0, 0, 0, 1000, 2200, 1000, 200)], "practical");
    const planB = mkPlan(
      [
        mkBox("b1", "SKU-1", 0, 0, 0, 1000, 2200, 1000, 200),
        mkBox("b2", "SKU-1", 1000, 0, 0, 1000, 2200, 1000, 200),
      ],
      "maximum",
    );
    const cmp = comparePackingPlans(planA, planB);
    expect(cmp.rows).toHaveLength(7);
    const loadedRow = cmp.rows.find((r) => r.key === "loadedCount")!;
    expect(loadedRow.winner).toBe("B");
    expect(loadedRow.deltaLabel).toBe("+1 箱");
    const csv = planComparisonToCsv(cmp);
    expect(csv).toContain("装入总箱数");
    expect(csv).toContain("+1 箱");
  });
});
