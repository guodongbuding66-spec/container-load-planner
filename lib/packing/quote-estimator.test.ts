import { describe, expect, it } from "vitest";
import { CONTAINER_PRESETS } from "./presets";
import {
  CALIBRATION_BACKTEST_STATS,
  CALIBRATED_CARGO_VOLUME_CBM,
  estimateQuoteLoading,
  HISTORICAL_LOADING_RECORDS,
} from "./quote-estimator";
import type { PackingRequest, ProductInput } from "./types";

function productsForRecord(
  record: (typeof HISTORICAL_LOADING_RECORDS)[number],
  options: { weightOffset?: number; lengthOffset?: number; declaredVolumeCbm?: number } = {},
): ProductInput[] {
  const setCode = record.cartons.length > 1 ? `SET-${record.models[0]}` : undefined;
  return record.cartons.map((item, index) => ({
    id: `${record.models[0]}-${index}`,
    sku: `${record.models[0]}-${index + 1}`,
    name: `${record.models[0]} carton ${index + 1}`,
    ...item,
    length: item.length + (options.lengthOffset ?? 0),
    weight: item.weight + (options.weightOffset ?? 0),
    declaredVolumeCbm: options.declaredVolumeCbm ?? item.declaredVolumeCbm,
    quantity: 1000,
    priority: 100,
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 0,
    mustLoad: true,
    bottomOnly: false,
    setCode,
    unitsPerSet: 1,
    color: "#257f8b",
  }));
}

function request(products: ProductInput[], containerIndex: number): PackingRequest {
  return {
    mode: "single",
    strategy: "practical",
    practicalTargetUtilization: 0.845,
    container: CONTAINER_PRESETS[containerIndex],
    clearance: 10,
    products,
  };
}

function effectiveVolume(requestValue: PackingRequest) {
  const { container, clearance } = requestValue;
  return (container.length - clearance * 2) *
    (container.width - clearance * 2) *
    (container.height - clearance);
}

describe("dual-track quote estimator", () => {
  it("recalls every verified historical loading quantity exactly", () => {
    for (const record of HISTORICAL_LOADING_RECORDS) {
      CONTAINER_PRESETS.forEach((container, containerIndex) => {
        const input = request(productsForRecord(record), containerIndex);
        const estimate = estimateQuoteLoading(input, effectiveVolume(input), 0)!;
        expect(estimate.source).toBe("historical-exact");
        expect(estimate.confidence).toBe("verified");
        expect(estimate.predictedSets).toBe(record.loadingSets[container.id as keyof typeof record.loadingSets]);
        expect(estimate.expectedErrorPct).toBe(0);
      });
    }
  });

  it("keeps generalized median-CBM mean error below two percent and p90 below five percent", () => {
    expect(CALIBRATION_BACKTEST_STATS.meanErrorPct).toBeLessThan(2);
    expect(CALIBRATION_BACKTEST_STATS.p90ErrorPct).toBeLessThanOrEqual(5);
    expect(CALIBRATION_BACKTEST_STATS.maxErrorPct).toBeLessThanOrEqual(7);
    expect(CALIBRATION_BACKTEST_STATS.dataPoints).toBe(36);
  });

  it("reports A64M as a verified quote that exceeds every standard container volume", () => {
    const record = HISTORICAL_LOADING_RECORDS.find((item) => item.models.includes("SLM-A64M"))!;
    CONTAINER_PRESETS.forEach((container, containerIndex) => {
      const input = request(productsForRecord(record), containerIndex);
      const estimate = estimateQuoteLoading(input, effectiveVolume(input), 0)!;
      expect(estimate.source).toBe("historical-exact");
      expect(estimate.predictedSets).toBe(record.loadingSets[container.id as keyof typeof record.loadingSets]);
      expect(estimate.volumeBoundRatio).toBeGreaterThan(1.6);
      expect(estimate.withinVolumeBound).toBe(false);
      expect(estimate.withinWeightBound).toBe(true);
      expect(estimate.physicallyPossibleByBounds).toBe(false);
    });
  });

  it("uses robust per-container CBM targets for an unknown single product", () => {
    const unknown = productsForRecord(HISTORICAL_LOADING_RECORDS[0], { lengthOffset: 20 });
    const input = request(unknown, 2);
    const estimate = estimateQuoteLoading(input, effectiveVolume(input), 100)!;

    expect(estimate.source).toBe("calibrated-volume");
    expect(estimate.confidence).toBe("estimated");
    expect(estimate.calibratedCargoVolumeCbm).toBe(CALIBRATED_CARGO_VOLUME_CBM["40hq"]);
    expect(estimate.expectedErrorPct).toBeCloseTo(CALIBRATION_BACKTEST_STATS.p90ErrorPct, 6);
    expect(estimate.physicalLoadedSets).toBe(100);
    expect(estimate.gapSets).toBe(estimate.predictedSets - 100);
  });

  it("does not claim an exact historical match when carton weights materially differ", () => {
    const source = HISTORICAL_LOADING_RECORDS.find((item) => item.models.includes("实装记录·单箱 167/73/13"))!;
    const input = request(productsForRecord(source, { weightOffset: 20 }), 2);
    const estimate = estimateQuoteLoading(input, effectiveVolume(input), 0)!;

    expect(estimate.source).toBe("calibrated-volume");
    expect(estimate.confidence).toBe("estimated");
    expect(estimate.matchedModels).toEqual([]);
  });

  it("labels tolerance-based carton fingerprints as a non-zero-error historical reference", () => {
    const source = HISTORICAL_LOADING_RECORDS.find((item) => item.models.includes("实装记录·双箱 180/127"))!;
    const input = request(productsForRecord(source, { lengthOffset: 3 }), 1);
    const estimate = estimateQuoteLoading(input, effectiveVolume(input), 0)!;

    expect(estimate.source).toBe("historical-near");
    expect(estimate.confidence).toBe("estimated");
    expect(estimate.expectedErrorPct).toBeGreaterThan(0);
    expect(estimate.matchedModels).toContain("实装记录·双箱 180/127");
  });

  it("does not apply a single-product quotation model to mixed orders", () => {
    const input = { ...request(productsForRecord(HISTORICAL_LOADING_RECORDS[0]), 2), mode: "mixed" as const };
    expect(estimateQuoteLoading(input, effectiveVolume(input), 0)).toBeUndefined();
  });

  it("uses auto-calculated two-decimal CBM instead of a manually supplied value", () => {
    const source = HISTORICAL_LOADING_RECORDS.find((item) => item.models.includes("实装记录·单箱 164/54.5/12"))!;
    const input = request(productsForRecord(source, { lengthOffset: 20, declaredVolumeCbm: 99 }), 2);
    const estimate = estimateQuoteLoading(input, effectiveVolume(input), 0)!;

    expect(estimate.source).toBe("calibrated-volume");
    expect(estimate.setRoundedVolumeCbm).toBe(0.11);
    expect(estimate.predictedSets).toBe(Math.round(CALIBRATED_CARGO_VOLUME_CBM["40hq"] / 0.11));
  });

  it("propagates the conflicting gross/net labels from the supplied two-carton record", () => {
    const source = HISTORICAL_LOADING_RECORDS.find((item) => item.models.includes("实装记录·双箱 180/127"))!;
    const input = request(productsForRecord(source), 2);
    const estimate = estimateQuoteLoading(input, effectiveVolume(input), 0)!;

    expect(estimate.predictedSets).toBe(275);
    expect(estimate.setWeightKg).toBe(46);
    expect(estimate.dataQualityWarnings.join(" ")).toContain("净重/毛重标签");
  });

  it("treats the new two-row field record as one complete two-carton set", () => {
    const source = HISTORICAL_LOADING_RECORDS.find((item) => item.models.includes("实装记录·双箱 189/168"))!;
    const input = request(productsForRecord(source), 2);
    const estimate = estimateQuoteLoading(input, effectiveVolume(input), 0)!;

    expect(estimate.source).toBe("historical-exact");
    expect(estimate.predictedSets).toBe(270);
    expect(estimate.setWeightKg).toBeCloseTo(85.8, 8);
    expect(estimate.setPhysicalVolumeCbm).toBeCloseTo(0.244146, 8);
    expect(estimate.dataQualityWarnings.join(" ")).toContain("1set / 1 ctn");
    expect(estimate.dataQualityWarnings.join(" ")).toContain("1 套 2 箱");
  });
});
