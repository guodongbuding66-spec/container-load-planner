import { describe, expect, it } from "vitest";
import { runBenchmarkSuiteV2 } from "./benchmark-suite-v2";
import { analyzeFactoryCalibrationV2, type FieldFeedbackRecord } from "./field-calibration";
import { DEFAULT_GLOBAL_FLEET_RATES, runGlobalFleetOptimizer } from "./global-fleet-optimizer";
import { runHybridPackingOptimizer } from "./hybrid-solver";
import {
  solveConicalTelescopingNesting,
  solveCylindricalHexagonalPacking,
  solveLProfileInterlocking,
} from "./irregular-nesting-engine";
import { CONTAINER_PRESETS } from "./presets";
import { DEFAULT_REVERSE_RANGE, runReversePackagingOptimizer } from "./reverse-packaging-optimizer";
import type { ProductInput } from "./types";

const C20 = CONTAINER_PRESETS.find((c) => c.id === "20gp") ?? CONTAINER_PRESETS[0];
const C40HQ = CONTAINER_PRESETS.find((c) => c.id === "40hq") ?? CONTAINER_PRESETS[0];

const MULTI_SKU_ORDER: ProductInput[] = [
  {
    id: "p1",
    sku: "SHED-PANEL-A",
    name: "Galvanized Wall Panel A",
    length: 1450,
    width: 650,
    height: 220,
    weight: 34,
    quantity: 80,
    priority: 1,
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 10,
    color: "#2563eb",
  },
  {
    id: "p2",
    sku: "SHED-ROOF-B",
    name: "Roof Beam Kit B",
    length: 1200,
    width: 500,
    height: 300,
    weight: 26,
    quantity: 70,
    priority: 2,
    rotationPolicy: "any",
    stackable: true,
    maxStackLayers: 8,
    color: "#16a34a",
  },
  {
    id: "p3",
    sku: "HW-BOX-C",
    name: "Hardware Carton C",
    length: 480,
    width: 380,
    height: 320,
    weight: 14,
    quantity: 120,
    priority: 3,
    rotationPolicy: "any",
    stackable: true,
    maxStackLayers: 8,
    color: "#f59e0b",
  },
];

describe("CargoFit v2.0.0 Five Core Breakthrough Pillars", () => {
  it("Pillar 1A: Hybrid BRKGA + SA + LNS solver runs with 100% zero-trust oracle pass rate", () => {
    const rep = runHybridPackingOptimizer(
      {
        container: C20,
        clearance: 10,
        products: MULTI_SKU_ORDER,
        mode: "mixed",
        workflow: "direct",
        strategy: "maximum",
      },
      { computeMode: "standard", seed: 20261128, customBudgetMs: 3000 },
    );
    expect(rep.totalRuns).toBeGreaterThanOrEqual(4);
    expect(rep.candidatesEvaluated).toBeGreaterThanOrEqual(1);
    expect(rep.oraclePassedCandidates).toBe(rep.candidatesEvaluated);
    expect(rep.recommended.validation.valid).toBe(true);
    expect(rep.brkgaGenerations).toBeGreaterThanOrEqual(1);
    expect(rep.pareto.maxQuantity.metrics.loadedCount).toBeGreaterThan(0);
  });

  it("Pillar 1B: 112-scenario comprehensive benchmark suite (BR1-BR7 + Extreme + Random + Kits + Heavy) passes with 0 physical violations", () => {
    const suite = runBenchmarkSuiteV2("maximum", 20261128);
    console.log(
      `[V2.0 112-CASE BENCHMARK] passed=${suite.passedCases}/${suite.totalCases} zeroViolations=${suite.zeroViolations} BR_mean=${suite.brAcademicMeanVolUtilPct}% overall_mean=${suite.overallMeanVolUtilPct}% P50=${suite.p50Ms}ms P95=${suite.p95Ms}ms P99=${suite.p99Ms}ms`,
    );
    expect(suite.totalCases).toBe(112);
    expect(suite.passedCases).toBe(112);
    expect(suite.zeroViolations).toBe(true);
    expect(suite.brAcademicMeanVolUtilPct).toBeGreaterThan(85);
  }, 60000);

  it("Pillar 2: Multi-axis reverse packaging optimizer links real 3D capacity to corrugated area & net annual ROI", () => {
    const singleBox: ProductInput[] = [
      {
        id: "rev-1",
        sku: "CARTON-605",
        name: "Export Carton 605x485x460",
        length: 605,
        width: 485,
        height: 460,
        weight: 16,
        quantity: 200,
        priority: 1,
        rotationPolicy: "upright",
        stackable: true,
        maxStackLayers: 6,
        color: "#0ea5e9",
      },
    ];
    const report = runReversePackagingOptimizer(
      singleBox,
      C20,
      10,
      "rev-1",
      { ...DEFAULT_REVERSE_RANGE, lengthMinDeltaMm: -20, widthMinDeltaMm: -20, heightMinDeltaMm: -20, stepMm: 10 },
      { annualShippedCartons: 12000, freightPerContainerUsd: 3200, corrugatedUsdPerM2: 1.2 },
    );
    expect(report.candidatesEvaluated).toBeGreaterThanOrEqual(6);
    expect(report.baselineLoadedCount).toBeGreaterThan(0);
    expect(report.topCandidates.length).toBeGreaterThan(0);
    expect(report.bestCandidate).not.toBeNull();
    expect(report.bestCandidate!.gainCartons).toBeGreaterThan(0);
    expect(report.bestCandidate!.netAnnualBenefitUsd).toBeGreaterThan(0);
  });

  it("Pillar 3: Irregular geometry & nesting engine (Cylindrical HCP, Conical Nesting, L-Profile 180° Interlock) proves zero penetration & capacity gains", () => {
    // 3A: Cylindrical Hexagonal Close Packing (vertical 580mm drums in 40HQ)
    const hcp = solveCylindricalHexagonalPacking(
      C40HQ,
      { diameterMm: 580, lengthMm: 880, weightKg: 110, axis: "vertical" },
      10,
    );
    expect(hcp.zeroPenetrationVerified).toBe(true);
    expect(hcp.minCenterDistanceMm).toBeGreaterThanOrEqual(579.9);
    expect(hcp.hcpCount).toBeGreaterThanOrEqual(hcp.rectGridCount);

    // 3B: Conical flower pots telescoping nesting
    const cone = solveConicalTelescopingNesting(
      C40HQ,
      { topDiameterMm: 320, bottomDiameterMm: 220, singleHeightMm: 280, nestingStepMm: 45, maxStackItems: 30, weightKg: 0.6 },
      10,
    );
    expect(cone.nestedCount).toBeGreaterThan(cone.nonNestedCount * 3);
    expect(cone.gainPct).toBeGreaterThan(200);

    // 3C: L-Profile 180° Recess Interlocking
    const lProf = solveLProfileInterlocking(
      C40HQ,
      { outerLengthMm: 1000, outerWidthMm: 600, outerHeightMm: 800, legThicknessMm: 250, footHeightMm: 200, weightKg: 25 },
      10,
    );
    expect(lProf.zeroOverlapVerified).toBe(true);
    expect(lProf.interlockedCount).toBeGreaterThan(lProf.naiveBoxCount);
  });

  it("Pillar 4: Global mixed-container fleet & LCL/FCL landed cost optimizer finds cheaper portfolio than naive pure-40HQ", () => {
    // Order sized ~82 CBM -> needs 2x40HQ (naive) vs 1x40HQ + 1x20GP or 1x40HQ + LCL
    const largeOrder: ProductInput[] = [
      { ...MULTI_SKU_ORDER[0], quantity: 260 },
      { ...MULTI_SKU_ORDER[1], quantity: 140 },
    ];
    const fleet = runGlobalFleetOptimizer(largeOrder, 10, DEFAULT_GLOBAL_FLEET_RATES, "practical");
    expect(fleet.portfolios.length).toBeGreaterThanOrEqual(2);
    expect(fleet.recommended.fullyFulfilled).toBe(true);
    expect(fleet.recommended.allValid).toBe(true);
    expect(fleet.recommended.totalLandedCostUsd).toBeLessThanOrEqual(fleet.naive40HqCostUsd);
  });

  it("Pillar 5: Factory calibration v2 isolates 70% calibration vs 30% holdout validation, filters IQR outliers & computes 95% CI", () => {
    const records: FieldFeedbackRecord[] = Array.from({ length: 14 }, (_, i) => ({
      id: `rec-${i + 1}`,
      recordedAt: `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      containerName: "40HQ",
      containerNo: `MSCU${100000 + i}`,
      plannedCartons: 200,
      // 13 realistic factory actuals (~96-98% fill) + 1 corrupted typo outlier (40 cartons)
      actualCartons: i === 5 ? 40 : 193 + (i % 4),
      plannedWeightKg: 14000,
      actualWeighedKg: 13850,
      plannedTailVoidMm: 350,
      actualTailVoidMm: 390,
      discrepancyCount: 0,
      note: "Factory load record",
      category: i % 2 === 0 ? "Metal Shed" : "Greenhouse",
      packagingVersion: "V2-BC-Double",
    }));

    const cal = analyzeFactoryCalibrationV2(records);
    expect(cal.outlierIds).toContain("rec-6");
    expect(cal.calibrationSetCount + cal.validationSetCount).toBe(cal.cleanSampleCount);
    expect(cal.validationSetCount).toBeGreaterThanOrEqual(3);
    expect(cal.holdoutMaePct).not.toBeNull();
    expect(cal.holdoutMaePct!).toBeLessThanOrEqual(3.0);
    expect(cal.meets3PctTarget).toBe(true);
    expect(cal.status).toBe("verified-within-3pct");
    expect(cal.byCategory.length).toBe(2);
  });
});
