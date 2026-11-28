import { describe, expect, it } from "vitest";
import { API_SCHEMA_VERSION, executeCargoFitApiV1 } from "./api-contract";
import { parseCadMeshFile, parseDxfProfile } from "./cad-mesh-import";
import { recommendCatalogGapFill } from "./catalog-gap-recommender";
import { askCargoFitCopilot, classifyCopilotIntent } from "./copilot-assistant";
import { runHybridPackingOptimizer } from "./hybrid-solver";
import { packLoadingWorkflow } from "./pack-loading";
import { computePackagingBom, packagingBomToCsv } from "./packaging-bom";
import { CONTAINER_PRESETS } from "./presets";
import type { ProductInput } from "./types";

const CONTAINER_20GP = CONTAINER_PRESETS.find((c) => c.id === "20gp") ?? CONTAINER_PRESETS[0];

const SAMPLE_PRODUCTS: ProductInput[] = [
  {
    id: "sku-a",
    sku: "SKU-A",
    name: "Metal Shed Panel A",
    length: 1200,
    width: 600,
    height: 400,
    weight: 32,
    quantity: 30,
    priority: 1,
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 6,
    color: "#2563eb",
  },
  {
    id: "sku-b",
    sku: "SKU-B",
    name: "Hardware Kit Box B",
    length: 500,
    width: 400,
    height: 300,
    weight: 14,
    quantity: 40,
    priority: 2,
    rotationPolicy: "any",
    stackable: true,
    maxStackLayers: 8,
    color: "#16a34a",
  },
];

describe("CargoFit v1.8.0 Core Upgrades (D01/D02/D04/D06/D10/D12/D22)", () => {
  it("D01/D02: runs 4-mode hybrid LNS optimizer with reproducible seed and strictly valid Pareto plans", () => {
    const req = {
      container: CONTAINER_20GP,
      clearance: 10,
      products: SAMPLE_PRODUCTS,
      mode: "mixed" as const,
      workflow: "direct" as const,
      strategy: "practical" as const,
    };
    const r1 = runHybridPackingOptimizer(req, { computeMode: "fast", seed: 42 });
    const r2 = runHybridPackingOptimizer(req, { computeMode: "fast", seed: 42 });

    expect(r1.candidatesEvaluated).toBeGreaterThanOrEqual(2);
    expect(r1.validCandidates).toBe(r1.candidatesEvaluated);
    expect(r1.recommended.validation.valid).toBe(true);
    expect(r1.pareto.maxQuantity.metrics.loadedCount).toBe(r2.pareto.maxQuantity.metrics.loadedCount);
    expect(r1.pareto.maxUtilization.metrics.volumeUtilization).toBeGreaterThan(0.3);
  });

  it("D04: computes 6-level Packaging BOM, tare ratio, reusable pallet amortization & CSV export", () => {
    const plan = packLoadingWorkflow({
      container: CONTAINER_20GP,
      clearance: 10,
      products: SAMPLE_PRODUCTS,
      mode: "mixed",
      workflow: "direct",
      strategy: "practical",
    });
    const bom = computePackagingBom(plan, SAMPLE_PRODUCTS, {
      unitsPerInnerPack: 2,
      innerPacksPerCarton: 3,
      palletReuseCycles: 5,
      fleetContainerCount: 3,
    });
    expect(bom.levels).toHaveLength(6);
    expect(bom.totalProductUnits).toBe(plan.metrics.loadedCount * 6);
    expect(bom.tareRatioPct).toBeGreaterThan(0);
    expect(bom.fleetTotalLandedLogisticsUsd).toBeGreaterThan(bom.totalPackagingCostPerContainerUsd * 3);
    const csv = packagingBomToCsv(bom);
    expect(csv).toContain("L1-PRODUCT");
    expect(csv).toContain("L6-FLEET");
  });

  it("D06: parses native ASCII DXF LWPOLYLINE and CIRCLE profiles into watertight 3D extruded meshes", () => {
    const dxfRect = [
      "0", "SECTION", "2", "ENTITIES",
      "0", "LWPOLYLINE", "90", "4", "70", "1",
      "10", "0", "20", "0",
      "10", "200", "20", "0",
      "10", "200", "20", "100",
      "10", "0", "20", "100",
      "0", "CIRCLE", "10", "50", "20", "50", "40", "25",
      "0", "ENDSEC", "0", "EOF",
    ].join("\n");

    const parsed = parseDxfProfile(dxfRect, "profile.dxf", { unit: "mm", up: "Z" }, 50);
    expect(parsed.format).toBe("dxf");
    expect(parsed.chunks).toHaveLength(2);
    expect(parsed.boundingBox.size[0]).toBeCloseTo(200, 1);
    expect(parsed.boundingBox.size[1]).toBeCloseTo(100, 1);
    expect(parsed.boundingBox.size[2]).toBeCloseTo(50, 1);
    // Box volume = 200*100*50 = 1,000,000 mm^3 + cylinder pi*25^2*50 ~= 98,174 mm^3
    expect(parsed.absoluteVolumeMm3).toBeGreaterThan(1050000);

    const viaDispatcher = parseCadMeshFile(
      "part.dxf",
      new TextEncoder().encode(dxfRect).buffer,
      { unit: "mm", up: "Z" },
    );
    expect(viaDispatcher.format).toBe("dxf");
  });

  it("D10: recommends SKU catalog gap-fill strictly from real 3D residual void cuboids and weight headroom", () => {
    const smallOrder: ProductInput[] = [{ ...SAMPLE_PRODUCTS[0], quantity: 12 }];
    const plan = packLoadingWorkflow({
      container: CONTAINER_20GP,
      clearance: 10,
      products: smallOrder,
      mode: "mixed",
      workflow: "direct",
      strategy: "practical",
    });
    const report = recommendCatalogGapFill(plan, SAMPLE_PRODUCTS, 5);
    expect(report.usableZones.length).toBeGreaterThan(0);
    expect(report.remainingPayloadKg).toBeGreaterThan(10000);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations[0].maxAdditionalUnits).toBeGreaterThan(0);
    expect(report.recommendations[0].utilizationGainPct).toBeGreaterThan(0);
  });

  it("D12: deterministic CargoFit Smart Copilot answers all 6 engineering intents with live engine numbers", () => {
    const plan = packLoadingWorkflow({
      container: CONTAINER_20GP,
      clearance: 10,
      products: SAMPLE_PRODUCTS,
      mode: "mixed",
      workflow: "direct",
      strategy: "practical",
    });
    expect(classifyCopilotIntent("为什么还有箱子没装进去？")).toBe("shortfall");
    expect(classifyCopilotIntent("检查轴荷和压溃风险")).toBe("safety-audit");

    for (const q of [
      "为什么还有箱子没有装进去？",
      "这批订单需要几个柜子？",
      "纸箱尺寸微调多少才能多装？",
      "全面检查轴荷、压溃风险和充气袋",
      "对比高密度与现场易执行方案",
      "剩余空隙还能补装什么货？",
    ]) {
      const ans = askCargoFitCopilot(q, plan, SAMPLE_PRODUCTS, 3500);
      expect(ans.summaryZh.length).toBeGreaterThan(10);
      expect(ans.summaryEn.length).toBeGreaterThan(10);
      expect(ans.engineModules.length).toBeGreaterThan(0);
      expect(ans.metrics.length).toBeGreaterThan(0);
    }
  });

  it("D22: executes v1.8 API contract with hybrid computeMode & engineeringAudit while retaining v1.2 compatibility", () => {
    const req = {
      container: CONTAINER_20GP,
      clearance: 10,
      products: SAMPLE_PRODUCTS,
      mode: "mixed" as const,
      workflow: "direct" as const,
      strategy: "practical" as const,
    };
    const resV18 = executeCargoFitApiV1({
      schema: API_SCHEMA_VERSION,
      requestId: "req-v18-1",
      computeMode: "fast",
      seed: 7,
      includeEngineeringAudit: true,
      request: req,
    });
    expect(resV18.ok).toBe(true);
    expect(resV18.hybridReport?.candidatesEvaluated).toBeGreaterThanOrEqual(2);
    expect(resV18.engineeringAudit?.axle.cargoWeightKg).toBeGreaterThan(0);
    expect(resV18.engineeringAudit?.bct.totalSkus).toBeGreaterThan(0);

    const resLegacy = executeCargoFitApiV1({
      schema: "cargo-fit-api-v1.2",
      requestId: "req-v12-compat",
      request: req,
    });
    expect(resLegacy.ok).toBe(true);
  });
});
