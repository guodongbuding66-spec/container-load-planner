import { describe, expect, it } from "vitest";
import {
  analyzeCargoFeaturesAndDispatch,
  runHybridPackingOptimizer,
  runHybridPackingOptimizerAsync,
} from "./hybrid-solver";
import {
  IRREGULAR_10_CATEGORY_REGISTRY,
  solveStaggeredSlatsAndProfiles,
  solveUTProfileInterlock,
  verifyObbBvhZeroCollision,
} from "./irregular-nesting-engine";
import { parseCadMeshFile, parseFbxMesh, preprocessCadMesh } from "./cad-mesh-import";
import { designWoodenCrateBom } from "./smart-pallet-designer";
import { TRANSPORT_PRESETS } from "./transport-library";
import { estimateThreeAxleTractorTrailerLoad } from "./axle-load-estimator";
import { analyzeCtuSecuring, estimateCtuSecuringAccessoryKit } from "./securing-void-analyzer";
import { API_SCHEMA_VERSION, ENGINE_VERSION, executeCargoFitApiV1 } from "./api-contract";
import { CONTAINER_PRESETS } from "./presets";
import type { PackingRequest, ProductInput } from "./types";

const c40hq = CONTAINER_PRESETS.find((c) => c.id === "40hq") ?? CONTAINER_PRESETS[0];

const sampleProducts: ProductInput[] = [
  {
    id: "p1",
    sku: "SHED-PANEL-A",
    name: "Tool Shed Wall Panel",
    length: 1200,
    width: 600,
    height: 400,
    weight: 32,
    quantity: 30,
    color: "#2563eb",
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 6,
    priority: 1,
    mustLoad: true,
  },
  {
    id: "p2",
    sku: "SHED-ROOF-B",
    name: "Tool Shed Roof Carton",
    length: 1000,
    width: 500,
    height: 350,
    weight: 24,
    quantity: 25,
    color: "#10b981",
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 6,
    priority: 1,
    mustLoad: true,
  },
];

const sampleReq: PackingRequest = {
  mode: "mixed",
  workflow: "direct",
  strategy: "maximum",
  container: c40hq,
  products: sampleProducts,
  clearance: 10,
};

describe("v3.0.0 Deep 24-Direction Upgrade Verification", () => {
  it("D01: Feature dispatcher, Beam Search, Exact Branch-and-Bound, and Async Hybrid Solver", async () => {
    const profile = analyzeCargoFeaturesAndDispatch(sampleReq);
    expect(profile.skuCount).toBe(2);
    expect(profile.isSmallExactEligible).toBe(true);
    expect(profile.recommendedNodeIds).toContain("ep-skyline");
    expect(profile.recommendedNodeIds).toContain("brkga-beam");

    const report = runHybridPackingOptimizer(sampleReq, {
      computeMode: "standard",
      seed: 20261128,
    });
    expect(report.strategyNodes.length).toBe(6);
    expect(report.beamCandidatesEvaluated).toBeGreaterThanOrEqual(2);
    expect(report.pareto.mostStable.validation.valid).toBe(true);
    expect(report.oraclePassedCandidates).toBeGreaterThanOrEqual(1);

    const asyncReport = await runHybridPackingOptimizerAsync(sampleReq, {
      computeMode: "fast",
      seed: 20261128,
    });
    expect(asyncReport.recommended.metrics.loadedCount).toBeGreaterThan(0);
  });

  it("D05: 10-category irregular registry, U/T interlock, staggered slats, and OBB/BVH SAT zero-collision", () => {
    expect(IRREGULAR_10_CATEGORY_REGISTRY.length).toBe(10);
    const ut = solveUTProfileInterlock(c40hq, {
      shape: "U",
      outerLengthMm: 600,
      outerWidthMm: 400,
      outerHeightMm: 450,
      wallThicknessMm: 90,
      weightKg: 18,
    });
    expect(ut.zeroOverlapVerified).toBe(true);
    expect(ut.interlockedCount).toBeGreaterThanOrEqual(ut.naiveBoxCount);

    const slats = solveStaggeredSlatsAndProfiles(c40hq, {
      panelLengthMm: 1800,
      panelWidthMm: 950,
      panelThicknessMm: 65,
      lipOverlapMm: 22,
      weightKg: 14,
    });
    expect(slats.staggeredCount).toBeGreaterThan(slats.naiveCount);

    const obbOk = verifyObbBvhZeroCollision([
      { id: "a", cx: 100, cy: 100, cz: 100, hx: 50, hy: 50, hz: 50, yawRad: 0 },
      { id: "b", cx: 250, cy: 100, cz: 100, hx: 50, hy: 50, hz: 50, yawRad: Math.PI / 4 },
    ]);
    expect(obbOk.collisionFree).toBe(true);

    const obbHit = verifyObbBvhZeroCollision([
      { id: "a", cx: 100, cy: 100, cz: 100, hx: 60, hy: 60, hz: 60, yawRad: 0 },
      { id: "b", cx: 140, cy: 100, cz: 100, hx: 60, hy: 60, hz: 60, yawRad: 0.2 },
    ]);
    expect(obbHit.collisionFree).toBe(false);
    expect(obbHit.collisions.length).toBe(1);
  });

  it("D06: ASCII FBX parser + CAD preprocessing pipeline (pivot, CoG, 6 load-bearing faces, nesting zone)", () => {
    const asciiFbx = `
      Geometry: 1001, "Geometry::Box", "Mesh" {
        Vertices: *24 {
          a: 0,0,0, 500,0,0, 500,300,0, 0,300,0, 0,0,200, 500,0,200, 500,300,200, 0,300,200
        }
        PolygonVertexIndex: *24 {
          a: 0,1,2,-4, 4,7,6,-6, 0,4,5,-2, 1,5,6,-3, 2,6,7,-4, 3,7,4,-1
        }
      }
    `;
    const fbxBuf = new TextEncoder().encode(asciiFbx).buffer;
    const fbxAnalysis = parseFbxMesh(fbxBuf, "bracket.fbx", { unit: "mm", up: "Z" });
    expect(fbxAnalysis.triangleCount).toBe(12);
    expect(Math.round(fbxAnalysis.boundingBox.size[0])).toBe(500);

    const prep = preprocessCadMesh(fbxAnalysis, {
      pivotMode: "bottom-center",
      simplifyTargetTriangles: 100,
      customCogOffsetMm: [0, 0, -20],
    });
    expect(prep.dimensionsMm).toEqual([500, 300, 200]);
    expect(prep.loadBearingSurfaces.length).toBe(6);
    expect(prep.cogMm[2]).toBe(80);

    // Ensure OBJ still works seamlessly through parseCadMeshFile
    const objBuf = new TextEncoder().encode("v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 100\nf 1 2 3\nf 1 3 4\n").buffer;
    const objAnalysis = parseCadMeshFile("test.obj", objBuf, { unit: "mm", up: "Z" });
    expect(objAnalysis.triangleCount).toBe(2);
  });

  it("D07: Wooden crate 8-part engineering BOM generator", () => {
    const bom = designWoodenCrateBom(1200, 800, 900, 950);
    expect(bom.parts.length).toBe(8);
    expect(bom.ispm15Required).toBe(true);
    expect(bom.crateTareKg).toBeGreaterThan(20);
    expect(bom.grossCrateWeightKg).toBeGreaterThan(950);
  });

  it("D13: Complete 3x3 transport library including AKE chamfer cutouts, rail boxcar & breakbulk hold", () => {
    const ake = TRANSPORT_PRESETS.find((t) => t.id === "air-ld3-ake");
    expect(ake).toBeDefined();
    expect(ake?.exclusions?.length).toBe(2);

    const rail = TRANSPORT_PRESETS.find((t) => t.id === "rail-boxcar-60");
    expect(rail).toBeDefined();
    expect(rail?.exclusions?.length).toBe(2);

    const hold = TRANSPORT_PRESETS.find((t) => t.id === "bulk-cargo-hold");
    expect(hold).toBeDefined();
    expect(hold?.exclusions?.length).toBe(2);
  });

  it("D14 & D16 & D22: 3-Axle Semi-Trailer Equilibrium, Full CTU Kit, and v3.0.0 API Contract", () => {
    expect(ENGINE_VERSION).toBe("3.2.3");
    const apiRes = executeCargoFitApiV1({
      schema: API_SCHEMA_VERSION,
      computeMode: "fast",
      includeEngineeringAudit: true,
      request: sampleReq,
    });
    expect(apiRes.ok).toBe(true);
    expect(apiRes.engineVersion).toBe("3.2.3");
    expect(apiRes.hybridReport?.strategyNodes.length).toBe(6);
    expect(apiRes.result).toBeDefined();

    const threeAxle = estimateThreeAxleTractorTrailerLoad(apiRes.result!, {
      tractorWheelbaseMm: 4000,
      tractorSteerTareKg: 4800,
    });
    expect(threeAxle.steerAxleKg).toBeGreaterThan(4000);
    expect(threeAxle.driveAxleKg).toBeGreaterThan(3000);
    expect(threeAxle.trailerGroupKg).toBeGreaterThan(5000);

    const ctu = analyzeCtuSecuring(apiRes.result!, {
      mode: "sea-area-c",
      frictionMu: 0.35,
      strapLcDan: 2000,
      certifiedLashingDataProvided: false,
    });
    const kit = estimateCtuSecuringAccessoryKit(apiRes.result!, ctu);
    expect(kit.strapsCount).toBeGreaterThanOrEqual(2);
    expect(kit.desiccantStripsCount).toBeGreaterThanOrEqual(6);
    expect(kit.blockingBarsCount).toBeGreaterThanOrEqual(2);
  });
});
