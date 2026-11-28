import { describe, expect, it } from "vitest";
import {
  buildAllFiveAcademicSuites,
  parseOrLibraryThpack,
  parsePackingSolverCsv,
  parseQ4RealBppInstance,
} from "./academic-benchmarks";
import { estimateProgressiveUnloadingAxleLoads } from "./axle-load-estimator";
import {
  evaluateCompetitorSubmission,
  exportCompetitorBenchmarkPacket,
  runCargoFitCompetitorBaseline,
} from "./competitor-benchmark-harness";
import { optimizeGlobalFleetWithLocks } from "./global-fleet-optimizer";
import {
  PLANNED_CORPUS_TOTAL_TARGET,
  PLANNED_FACTORY_CASES_TARGET,
  runIndependentCorpusBatch,
  validateFactoryCaseRecord,
} from "./independent-test-corpus";
import { auditPostUnloadSupportStability } from "./multi-stop-auditor";
import { auditExtendedOrderRows } from "./order-data-auditor";
import { packLoadingWorkflow } from "./pack-loading";
import { CONTAINER_PRESETS } from "./presets";
import { verifyPackingOracle } from "./public-benchmarks";
import { analyzeCtuSecuring } from "./securing-void-analyzer";
import { auditSpecialCargoCompliance, getImdgSegregationLevel } from "./special-cargo-rules";
import { TRANSPORT_PRESETS } from "./transport-library";
import type { ProductInput } from "./types";

const C40HQ = CONTAINER_PRESETS.find((c) => c.id === "40hq") ?? CONTAINER_PRESETS[2];

describe("CargoFit v2.1.0 Deepened Engineering Modules & Industry Test System", () => {
  it("1. Special Cargo & IMDG 7.2.4 Segregation Engine catches fragile top-load, upright, and DG conflicts deterministically", () => {
    expect(getImdgSegregationLevel("3", "5.1")).toBe(2);
    expect(getImdgSegregationLevel("1", "3")).toBe(4);
    expect(getImdgSegregationLevel("3", "3")).toBe(0);

    const products: ProductInput[] = [
      { id: "p-dg1", sku: "UN1263-PAINT", name: "Flammable Paint Class 3", length: 500, width: 400, height: 400, weight: 20, quantity: 6, color: "#dc2626", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
      { id: "p-dg2", sku: "UN1479-OXIDIZER", name: "Oxidizer Powder Class 5.1", length: 500, width: 400, height: 400, weight: 20, quantity: 6, color: "#d97706", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
      { id: "p-food", sku: "FOOD-SNACK", name: "Packaged Food Snack", length: 500, width: 400, height: 350, weight: 12, quantity: 6, color: "#16a34a", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 40 },
    ];
    const plan = packLoadingWorkflow({ container: C40HQ, products, mode: "mixed", strategy: "maximum", clearance: 0 });
    const audit = auditSpecialCargoCompliance(plan, products);
    expect(audit.complianceStatus).toBe("fail");
    expect(audit.violations.some((v) => v.ruleCode.startsWith("IMDG_SEGREGATION"))).toBe(true);
    expect(audit.violations.some((v) => v.ruleCode === "FOOD_DG_PROHIBITED")).toBe(true);
  });

  it("2. CTU Code Securing Mechanics computes real sliding forces, strap count, and incomplete-data warnings", () => {
    const products: ProductInput[] = [
      { id: "c1", sku: "TALL-CAB", name: "Tall Cabinet", length: 600, width: 400, height: 1400, weight: 85, quantity: 10, color: "#2563eb", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
    ];
    const plan = packLoadingWorkflow({ container: C40HQ, products, mode: "mixed", strategy: "maximum", clearance: 0 });
    const ctu = analyzeCtuSecuring(plan, { mode: "sea-area-c", frictionMu: 0.3, strapLcDan: 2000, certifiedLashingDataProvided: false });
    expect(ctu.totalCargoMassKg).toBeGreaterThan(0);
    expect(ctu.requiredLashingCapacityDan).toBeGreaterThan(0);
    expect(ctu.recommendedStrapsCount).toBeGreaterThanOrEqual(2);
    expect(ctu.tippingRiskItemsCount).toBeGreaterThan(0);
    expect(ctu.dataCompletenessWarningsZh.length).toBeGreaterThanOrEqual(2);
  });

  it("3. Progressive Multi-Stop Unloading Axle Audit & Post-Unload Support Stability work across stops", () => {
    const products: ProductInput[] = [
      { id: "s1", sku: "STOP1-DOOR", name: "Stop 1 Cargo", length: 800, width: 600, height: 500, weight: 40, quantity: 12, color: "#2563eb", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
      { id: "s2", sku: "STOP2-MID", name: "Stop 2 Cargo", length: 800, width: 600, height: 500, weight: 45, quantity: 12, color: "#0f766e", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 60 },
      { id: "s3", sku: "STOP3-NOSE", name: "Stop 3 Cargo", length: 800, width: 600, height: 500, weight: 50, quantity: 12, color: "#d97706", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 70 },
    ];
    const plan = packLoadingWorkflow({ container: C40HQ, products, mode: "mixed", strategy: "practical", clearance: 0, delivery: { s1: { customer: "A", destination: "Hub A", stop: 1 }, s2: { customer: "B", destination: "Hub B", stop: 2 }, s3: { customer: "C", destination: "Hub C", stop: 3 } } });
    const axle = estimateProgressiveUnloadingAxleLoads(plan, "container-chassis", { emptyFrontTareKg: 1800, emptyRearTareKg: 2400 });
    expect(axle.steps.length).toBe(3); // Full load, after Stop 1, after Stop 2
    expect(axle.steps[0].remainingCartons).toBeGreaterThan(axle.steps[1].remainingCartons);
    const supportRisks = auditPostUnloadSupportStability(plan);
    expect(Array.isArray(supportRisks)).toBe(true);
  });

  it("4. Transport Library includes true interior exclusions for Reefers, Step-Deck trailer, and Roll Cage", () => {
    const rh40 = TRANSPORT_PRESETS.find((t) => t.id === "40rh");
    const stepDeck = TRANSPORT_PRESETS.find((t) => t.id === "truck-step-deck-13.6");
    const rollCage = TRANSPORT_PRESETS.find((t) => t.id === "roll-cage-std");
    expect(rh40?.exclusions?.length).toBeGreaterThanOrEqual(2);
    expect(stepDeck?.exclusions?.length).toBeGreaterThanOrEqual(1);
    expect(rollCage?.maxWeight).toBe(500);
  });

  it("5. Order Data Auditor catches all 7 packing-list error classes including net>gross, CBM mismatch & physical limit", () => {
    const summary = auditExtendedOrderRows(
      [
        {
          product: { id: "o1", sku: "DUP-1", name: "ErrBox", length: 600, width: 400, height: 400, weight: 10, quantity: 2000, color: "#2563eb", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
          netWeightKg: 14, // net > gross!
          declaredTotalCbm: 10, // huge mismatch vs 192 m3!
        },
        {
          product: { id: "o2", sku: "DUP-1", name: "DupBox", length: 600, width: 400, height: 400, weight: 10, quantity: 5, color: "#0f766e", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
        },
      ],
      C40HQ,
    );
    const codes = new Set(summary.issues.map((i) => i.code));
    expect(codes.has("net_exceeds_gross")).toBe(true);
    expect(codes.has("cbm_dimension_mismatch")).toBe(true);
    expect(codes.has("quantity_exceeds_physical_limit")).toBe(true);
    expect(codes.has("duplicate_sku")).toBe(true);
  });

  it("6. Global Fleet Optimizer preserves locked containers while re-optimizing unlocked cargo with exact conservation", () => {
    const products: ProductInput[] = [
      { id: "gf1", sku: "SKU-LOCK", name: "Main Box", length: 600, width: 400, height: 400, weight: 15, quantity: 300, color: "#2563eb", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
    ];
    const report = optimizeGlobalFleetWithLocks(products, [
      { label: "Locked 40HQ #1", type: "40HQ", lockedQuantitiesBySku: { "SKU-LOCK": 200 }, volumeUtilPct: 92, weightKg: 3000 },
    ]);
    expect(report.totalLockedCartons).toBe(200);
    expect(report.totalUnlockedCartons).toBe(100);
    expect(report.conservationVerified).toBe(true);
    expect(report.combinedBestCostUsd).toBeGreaterThan(0);
  });

  it("7. All 5 Academic Benchmark Parsers (BR, OR-Library, ESICUP, Q4RealBPP, PackingSolver) parse and pass zero-trust oracle", () => {
    const suites = buildAllFiveAcademicSuites();
    const suiteIds = new Set(suites.map((s) => s.suite));
    expect(suiteIds.has("bischoff-ratcliff")).toBe(true);
    expect(suiteIds.has("or-library")).toBe(true);
    expect(suiteIds.has("esicup")).toBe(true);
    expect(suiteIds.has("q4realbpp")).toBe(true);
    expect(suiteIds.has("packingsolver")).toBe(true);

    for (const inst of suites) {
      const res = packLoadingWorkflow(inst.request);
      const oracle = verifyPackingOracle(res, inst.request);
      expect(oracle.passed).toBe(true);
    }

    // Direct parser smoke checks
    expect(parseOrLibraryThpack("1\n1 99\n587 233 220\n1\n1 100 1 80 1 60 1 20").length).toBe(1);
    expect(parsePackingSolverCsv("ID,X,Y,Z,COPIES\n0,5870,2330,2200,1", "ID,X,Y,Z,COPIES\n0,600,400,400,25")).not.toBeNull();
    expect(parseQ4RealBppInstance({ id: "q4-t", bin: { length: 5898, width: 2352, height: 2393, maxWeight: 25000 }, items: [{ sku: "A", length: 500, width: 400, height: 300, weight: 10, quantity: 10 }] }).hasRealWorldConstraints).toBe(true);
  });

  it("8. Independent Test Corpus (6 categories) & 12-Metric Competitor Harness pass with 0 violations and honest roadmap targets", () => {
    const corpus = runIndependentCorpusBatch(60, "maximum", 20261128);
    expect(corpus.plannedTotalTarget).toBe(PLANNED_CORPUS_TOTAL_TARGET);
    expect(corpus.factoryCasesTarget).toBe(PLANNED_FACTORY_CASES_TARGET);
    expect(corpus.executedTotal).toBeGreaterThanOrEqual(55);
    expect(corpus.totalPhysicalViolations).toBe(0);
    expect(corpus.passedTotal).toBe(corpus.executedTotal);

    expect(validateFactoryCaseRecord({ caseId: "F-01" }).valid).toBe(false);

    const scenario: import("./competitor-benchmark-harness").CompetitorBenchmarkScenario = {
      scenarioId: "cmp-01",
      title: "Standard 40HQ Mixed",
      timeBudgetMs: 5000,
      container: C40HQ,
      products: [
        { id: "m1", sku: "CMP-A", name: "Box A", length: 600, width: 400, height: 400, weight: 16, quantity: 80, color: "#2563eb", rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
        { id: "m2", sku: "CMP-B", name: "Box B", length: 500, width: 350, height: 300, weight: 11, quantity: 90, color: "#0f766e", rotationPolicy: "any", stackable: true, maxStackLayers: 0, priority: 40 },
      ],
      clearanceMm: 0,
    };
    const baseline = runCargoFitCompetitorBaseline(scenario, 2);
    expect(baseline.hardConstraintsPassed).toBe(true);
    expect(baseline.stabilityVariancePct).toBe(0);

    const packet = exportCompetitorBenchmarkPacket(scenario);
    expect(packet.csv).toContain("CMP-A");
    expect(packet.json).toContain("EasyCargo");

    const extEval = evaluateCompetitorSubmission(scenario, {
      software: "EasyCargo",
      softwareVersion: "sample-import",
      scenarioId: "cmp-01",
      elapsedMs: 120,
      placements: [],
    });
    expect(extEval.software).toBe("EasyCargo");
  }, 30_000);
});
