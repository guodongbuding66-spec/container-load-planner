import { describe, expect, it } from "vitest";
import { pack, packWithComparison, recommendedPracticalTarget } from "./engine";
import { CONTAINER_PRESETS } from "./presets";
import { HISTORICAL_LOADING_RECORDS } from "./quote-estimator";
import type { ProductInput } from "./types";

const suppliedRecords = HISTORICAL_LOADING_RECORDS.filter((record) =>
  record.models.some((model) => model.startsWith("实装记录·")),
);

function productsForRecord(record: (typeof suppliedRecords)[number]): ProductInput[] {
  const setCode = record.cartons.length > 1 ? `SET-${record.models[0]}` : undefined;
  return record.cartons.map((carton, index) => ({
    id: `${record.models[0]}-${index}`,
    sku: `${record.models[0]}-${index + 1}`,
    name: `${record.models[0]} 第 ${index + 1} 箱`,
    ...carton,
    quantity: 1000,
    priority: 100,
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 0,
    mustLoad: true,
    bottomOnly: false,
    setCode,
    unitsPerSet: 1,
    color: index % 2 ? "#c66a3d" : "#2f7f89",
  }));
}

describe("supplied real loading regression", () => {
  it("keeps all three supplied records within three percent in worker-practical mode", () => {
    expect(suppliedRecords).toHaveLength(3);

    for (const record of suppliedRecords) {
      for (const container of CONTAINER_PRESETS) {
        const result = pack({
          mode: "single",
          strategy: "practical",
          practicalTargetUtilization: recommendedPracticalTarget(container),
          container,
          clearance: 10,
          products: productsForRecord(record),
        });
        const expectedSets = record.loadingSets[container.id as keyof typeof record.loadingSets];
        const physicalSets = result.setSummaries[0]?.loadedSets ?? result.metrics.loadedCount;
        const error = Math.abs(physicalSets - expectedSets) / expectedSets;

        expect(result.validation.valid, `${record.models[0]} ${container.id}`).toBe(true);
        expect(result.quoteEstimate?.predictedSets).toBe(expectedSets);
        expect(error, `${record.models[0]} ${container.id}: ${physicalSets}/${expectedSets}`).toBeLessThanOrEqual(0.03);
        expect(result.metrics.executionComplexity.maxOrientationsPerSku).toBeLessThanOrEqual(2);
        expect(result.metrics.executionComplexity.partialSupportCount).toBe(0);
      }
    }
  }, 30_000);

  it("loads the supplied two-carton record as complete sets and surfaces its weight-label conflict", () => {
    const record = suppliedRecords.find((item) => item.models[0].includes("双箱"))!;
    const container = CONTAINER_PRESETS.find((item) => item.id === "40hq")!;
    const result = pack({
      mode: "single",
      strategy: "practical",
      practicalTargetUtilization: recommendedPracticalTarget(container),
      container,
      clearance: 10,
      products: productsForRecord(record),
    });

    expect(result.setSummaries[0]).toMatchObject({ loadedSets: 275, loadedCartons: 550 });
    expect(result.metrics.loadedCount).toBe(550);
    expect(result.quoteEstimate?.setWeightKg).toBe(46);
    expect(result.warnings.join(" ")).toContain("净重/毛重标签");
    expect(result.warnings.join(" ")).toContain("SKU 分区直码");
  }, 10_000);

  it("compares both independent solvers without regressing any verified field quantity", () => {
    for (const record of suppliedRecords) {
      for (const container of CONTAINER_PRESETS) {
        const result = packWithComparison({
          mode: "single",
          strategy: "practical",
          practicalTargetUtilization: recommendedPracticalTarget(container),
          container,
          clearance: 10,
          products: productsForRecord(record),
        });
        const expectedSets = record.loadingSets[container.id as keyof typeof record.loadingSets];
        const comparison = result.strategyComparison!;
        const practicalError = Math.abs(comparison.practical.displayQuantity - expectedSets) / expectedSets;

        expect(result.validation.valid, `${record.models[0]} ${container.id}`).toBe(true);
        expect(comparison.practical.displayQuantity).toBe(result.setSummaries[0]?.loadedSets ?? result.metrics.loadedCount);
        expect(comparison.maximum.displayQuantity).toBeGreaterThanOrEqual(comparison.practical.displayQuantity);
        expect(practicalError, `${record.models[0]} ${container.id}`).toBeLessThanOrEqual(0.03);
        expect(comparison.practical.executionComplexity.tippedCartonCount).toBe(0);
      }
    }
  }, 60_000);
});
