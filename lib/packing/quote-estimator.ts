import type { PackingRequest, ProductInput, QuoteEstimate } from "./types";
import { exactCartonVolumeCbm, roundedCartonVolumeCbm } from "./volume";

type HistoricalCarton = {
  length: number;
  width: number;
  height: number;
  weight: number;
  declaredVolumeCbm: number;
};

export type HistoricalLoadingRecord = {
  models: string[];
  cartons: HistoricalCarton[];
  loadingSets: Record<"20gp" | "40gp" | "40hq", number>;
  calibrationEligible?: boolean;
  dataQualityWarnings?: string[];
};

const carton = (
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  weight: number,
  declaredVolumeCbm: number,
): HistoricalCarton => ({
  length: lengthCm * 10,
  width: widthCm * 10,
  height: heightCm * 10,
  weight,
  declaredVolumeCbm,
});

/**
 * Supplier quotation dated 2026-08-30. Loading Qty is stored as finished-product
 * sets, including the physically inconsistent A64M row confirmed by the user.
 * The estimator reports that row faithfully but never turns it into overlapping
 * 3D coordinates.
 */
export const HISTORICAL_LOADING_RECORDS: HistoricalLoadingRecord[] = [
  {
    models: ["SLM-A86M", "SLM-A68M"],
    cartons: [carton(181, 53, 15, 24, 0.14), carton(123, 56, 31, 35, 0.21), carton(187, 38, 19, 34, 0.14)],
    loadingSets: { "20gp": 55, "40gp": 115, "40hq": 135 },
  },
  {
    models: ["SLM-A46M"],
    cartons: [carton(127, 55, 29, 39, 0.20), carton(185, 55, 15, 31, 0.15)],
    loadingSets: { "20gp": 75, "40gp": 160, "40hq": 190 },
  },
  {
    models: ["SLM-A64M"],
    cartons: [carton(127, 55, 27, 30, 0.19), carton(185, 55, 13, 35, 0.13)],
    loadingSets: { "20gp": 170, "40gp": 350, "40hq": 396 },
    calibrationEligible: false,
    dataQualityWarnings: ["SLM-A64M 的 Loading Qty 已确认是套数，但按外箱尺寸计算会超过柜内容积；该记录仅用于精确历史匹配，不参与通用校准。"],
  },
  {
    models: ["SLM-A34"],
    cartons: [carton(127, 55, 27, 27, 0.19), carton(185, 15, 10, 15, 0.03)],
    loadingSets: { "20gp": 120, "40gp": 255, "40hq": 300 },
  },
  {
    models: ["SLM-F48"],
    cartons: [carton(125, 55, 33, 39, 0.23), carton(190, 25, 15, 29, 0.07)],
    loadingSets: { "20gp": 90, "40gp": 190, "40hq": 220 },
  },
  {
    models: ["SLM-F46"],
    cartons: [carton(136, 55, 24, 27, 0.18), carton(190, 55, 11, 25, 0.11)],
    loadingSets: { "20gp": 90, "40gp": 195, "40hq": 230 },
  },
  {
    models: ["SLM-F35"],
    cartons: [carton(173, 55, 20, 33, 0.19)],
    loadingSets: { "20gp": 135, "40gp": 300, "40hq": 345 },
  },
  {
    models: ["SLM-C35"],
    cartons: [carton(165, 55, 19, 36, 0.17)],
    loadingSets: { "20gp": 155, "40gp": 330, "40hq": 390 },
  },
  {
    models: ["SLM-C23"],
    cartons: [carton(175, 56, 15, 29, 0.15)],
    loadingSets: { "20gp": 175, "40gp": 375, "40hq": 440 },
  },
  {
    models: ["实装记录·双箱 180/127"],
    cartons: [carton(180, 15, 10, 15, 0.03), carton(127, 55, 29, 31, 0.20)],
    loadingSets: { "20gp": 110, "40gp": 230, "40hq": 275 },
    dataQualityWarnings: ["源记录的双箱套装净重/毛重标签与箱明细相反；已按 15 + 31 = 46 kg/套作为毛重安全校验。"],
  },
  {
    models: ["实装记录·单箱 167/73/13"],
    cartons: [carton(167, 73, 13, 56, 0.16)],
    loadingSets: { "20gp": 175, "40gp": 360, "40hq": 425 },
  },
  {
    models: ["实装记录·单箱 164/54.5/12"],
    cartons: [carton(164, 54.5, 12, 42, 0.11)],
    loadingSets: { "20gp": 235, "40gp": 505, "40hq": 600 },
  },
];

/** Robust medians from all physically plausible, user-verified loading rows. */
export const CALIBRATED_CARGO_VOLUME_CBM: Record<string, number> = {
  "20gp": 26.25,
  "40gp": 56.25,
  "40hq": 66,
};

const STANDARD_CONTAINER_IDS = ["20gp", "40gp", "40hq"] as const;

function calibrationRecords() {
  return HISTORICAL_LOADING_RECORDS.filter((record) => record.calibrationEligible !== false);
}

function historicalSetRoundedCbm(record: HistoricalLoadingRecord) {
  return record.cartons.reduce((sum, item) => sum + item.declaredVolumeCbm, 0);
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1))];
}

/**
 * Honest generalized error evidence. Exact carton fingerprints are recalled
 * separately at 0%; these figures describe the fallback median-CBM model.
 */
export const CALIBRATION_BACKTEST_STATS = (() => {
  const errors = calibrationRecords().flatMap((record) => {
    const setCbm = historicalSetRoundedCbm(record);
    return STANDARD_CONTAINER_IDS.map((containerId) => {
      const predicted = Math.round(CALIBRATED_CARGO_VOLUME_CBM[containerId] / setCbm);
      const actual = record.loadingSets[containerId];
      return actual > 0 ? (Math.abs(predicted - actual) / actual) * 100 : 0;
    });
  });
  return {
    meanErrorPct: errors.reduce((sum, error) => sum + error, 0) / Math.max(1, errors.length),
    p90ErrorPct: percentile(errors, 0.9),
    maxErrorPct: Math.max(0, ...errors),
    dataPoints: errors.length,
  };
})();

function normalizedDimensions(item: Pick<ProductInput, "length" | "width" | "height">) {
  return [item.length, item.width, item.height].sort((a, b) => b - a);
}

function expandedProducts(products: ProductInput[]) {
  return products.flatMap((product) =>
    Array.from({ length: Math.max(1, Math.floor(product.unitsPerSet || 1)) }, () => product),
  );
}

function cartonSortKey(item: Pick<ProductInput, "length" | "width" | "height" | "weight">) {
  const dimensions = normalizedDimensions(item);
  return `${dimensions.map((value) => value.toFixed(3).padStart(12, "0")).join(":")}:${item.weight.toFixed(3).padStart(10, "0")}`;
}

function samePackaging(products: ProductInput[], record: HistoricalLoadingRecord) {
  const supplied = expandedProducts(products).sort((a, b) => cartonSortKey(a).localeCompare(cartonSortKey(b)));
  const historical = [...record.cartons].sort((a, b) => cartonSortKey(a).localeCompare(cartonSortKey(b)));
  if (supplied.length !== historical.length) return false;
  return supplied.every((product, index) => {
    const actualDimensions = normalizedDimensions(product);
    const historicalDimensions = normalizedDimensions(historical[index]);
    const dimensionsMatch = actualDimensions.every(
      (dimension, dimensionIndex) => Math.abs(dimension - historicalDimensions[dimensionIndex]) <= 5,
    );
    const weightTolerance = Math.max(1, historical[index].weight * 0.03);
    return dimensionsMatch && Math.abs(product.weight - historical[index].weight) <= weightTolerance;
  });
}

function setVolumes(products: ProductInput[]) {
  return products.reduce((totals, product) => {
    const units = Math.max(1, Math.floor(product.unitsPerSet || 1));
    const physical = exactCartonVolumeCbm(product);
    const autoRounded = roundedCartonVolumeCbm(product);
    totals.physical += physical * units;
    // Avoid a zero business volume for very small cartons that round to 0.00.
    totals.rounded += (autoRounded > 0 ? autoRounded : physical) * units;
    totals.weight += Math.max(0, product.weight) * units;
    return totals;
  }, { physical: 0, rounded: 0, weight: 0 });
}

export function estimateQuoteLoading(
  request: PackingRequest,
  effectiveVolumeMm3: number,
  physicalLoadedSets: number,
): QuoteEstimate | undefined {
  if (request.mode !== "single" || !request.products.length) return undefined;
  const volumes = setVolumes(request.products);
  if (volumes.rounded <= 0 || volumes.physical <= 0) return undefined;

  const standardContainerId = request.container.id.toLowerCase();
  const matchingRecords = HISTORICAL_LOADING_RECORDS.filter((record) => samePackaging(request.products, record));
  const historicalLoading = matchingRecords
    .map((record) => record.loadingSets[standardContainerId as keyof HistoricalLoadingRecord["loadingSets"]])
    .filter((value): value is number => Number.isFinite(value));
  const calibratedCargoVolumeCbm = CALIBRATED_CARGO_VOLUME_CBM[standardContainerId] ??
    (effectiveVolumeMm3 / 1_000_000_000) * 0.845;

  let predictedSets: number;
  let source: QuoteEstimate["source"];
  let confidence: QuoteEstimate["confidence"];
  let expectedErrorPct: number;
  if (historicalLoading.length) {
    predictedSets = Math.round(historicalLoading.reduce((sum, value) => sum + value, 0) / historicalLoading.length);
    source = "historical-exact";
    confidence = "verified";
    expectedErrorPct = 0;
  } else {
    const volumeEstimate = Math.max(0, Math.round(calibratedCargoVolumeCbm / volumes.rounded));
    const weightEstimate = volumes.weight > 0
      ? Math.max(0, Math.floor(request.container.maxWeight / volumes.weight))
      : Number.MAX_SAFE_INTEGER;
    predictedSets = Math.min(volumeEstimate, weightEstimate);
    source = "calibrated-volume";
    confidence = "estimated";
    expectedErrorPct = CALIBRATED_CARGO_VOLUME_CBM[standardContainerId]
      ? CALIBRATION_BACKTEST_STATS.p90ErrorPct
      : 8;
  }

  const effectiveVolumeCbm = effectiveVolumeMm3 / 1_000_000_000;
  const predictedCargoVolumeCbm = predictedSets * volumes.physical;
  const predictedGrossWeightKg = predictedSets * volumes.weight;
  const volumeBoundRatio = effectiveVolumeCbm > 0 ? predictedCargoVolumeCbm / effectiveVolumeCbm : Number.POSITIVE_INFINITY;
  const weightBoundRatio = request.container.maxWeight > 0
    ? predictedGrossWeightKg / request.container.maxWeight
    : Number.POSITIVE_INFINITY;
  const gapSets = predictedSets - physicalLoadedSets;

  return {
    source,
    confidence,
    matchedModels: matchingRecords.flatMap((record) => record.models),
    predictedSets,
    physicalLoadedSets,
    gapSets,
    gapRatio: predictedSets > 0 ? gapSets / predictedSets : 0,
    expectedErrorPct,
    backtestMeanErrorPct: CALIBRATION_BACKTEST_STATS.meanErrorPct,
    backtestP90ErrorPct: CALIBRATION_BACKTEST_STATS.p90ErrorPct,
    backtestMaxErrorPct: CALIBRATION_BACKTEST_STATS.maxErrorPct,
    verifiedDataPoints: CALIBRATION_BACKTEST_STATS.dataPoints,
    calibratedCargoVolumeCbm,
    setRoundedVolumeCbm: volumes.rounded,
    setPhysicalVolumeCbm: volumes.physical,
    setWeightKg: volumes.weight,
    predictedCargoVolumeCbm,
    predictedGrossWeightKg,
    volumeBoundRatio,
    weightBoundRatio,
    withinVolumeBound: volumeBoundRatio <= 1,
    withinWeightBound: weightBoundRatio <= 1,
    physicallyPossibleByBounds: volumeBoundRatio <= 1 && weightBoundRatio <= 1,
    dataQualityWarnings: matchingRecords.flatMap((record) => record.dataQualityWarnings ?? []),
  };
}
