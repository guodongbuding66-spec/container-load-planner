export type PackingMode = "single" | "mixed";
export type PackingStrategy = "practical" | "maximum";
export type RotationPolicy = "fixed" | "upright" | "any";

export type ContainerSpec = {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  doorWidth: number;
  doorHeight: number;
  maxWeight: number;
};

export type ProductInput = {
  id: string;
  sku: string;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity: number;
  priority: number;
  rotationPolicy: RotationPolicy;
  stackable: boolean;
  maxStackLayers: number;
  mustLoad?: boolean;
  bottomOnly?: boolean;
  setCode?: string;
  unitsPerSet?: number;
  declaredVolumeCbm?: number;
  allowRotate?: boolean;
  /** Maximum weight resting above one carton; undefined means unspecified. Zero forbids load. */
  maxTopLoadKg?: number;
  allowedAboveSkus?: string[];
  topLoadByVerticalAxis?: Partial<Record<"length" | "width" | "height", number>>;
  source?: { system: "aftos"; skuId: string; packageId: string; orderId: string };
  packaging?: { revision: string; effectiveDate: string; notes: string };
  color: string;
};

export type PackingRequest = {
  searchPass?: number;
  mode: PackingMode;
  strategy?: PackingStrategy;
  practicalTargetUtilization?: number;
  /**
   * Optional planning cap for single-product calculations, expressed as the
   * total number of cartons. Multi-carton products are rounded down to whole
   * sets before packing. Omit this value when calculating the selected
   * strategy's capacity ceiling.
   */
  singleCartonLimit?: number;
  container: ContainerSpec;
  clearance: number;
  products: ProductInput[];
};

export type ReverseCountItem = {
  productId: string;
  sku: string;
  sourceQuantity: number;
  suggestedQuantity: number;
};

export type ReverseCountResult = {
  targetVolumeUtilization: number;
  targetWeightUtilization: number;
  effectiveVolume: number;
  averageUnitVolume: number;
  averageUnitWeight: number;
  volumeLimitedTotal: number;
  weightLimitedTotal: number | null;
  recommendedTotal: number;
  displayUnit: "carton" | "set";
  cartonsPerSet: number;
  volumeLimitedDisplay: number;
  weightLimitedDisplay: number | null;
  recommendedDisplay: number;
  limitingFactor: "volume" | "weight" | "equal";
  quantities: ReverseCountItem[];
};

export type PlacedBox = {
  locked?: boolean;
  id: string;
  productId: string;
  sku: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  weight: number;
  orientation: string;
  layer: number;
  setCode?: string;
  setNumber?: number;
  setItemNumber?: number;
};

export type ProductSummary = {
  productId: string;
  sku: string;
  name: string;
  color: string;
  requested: number;
  loaded: number;
  unloaded: number;
  loadedWeight: number;
  loadedVolume: number;
};

export type SetLoadItem = {
  productId: string;
  sku: string;
  unitsPerSet: number;
  requestedQuantity: number;
  loadedQuantity: number;
};

export type SetLoadSummary = {
  setCode: string;
  componentCount: number;
  cartonsPerSet: number;
  requestedCartons: number;
  loadedCartons: number;
  requestedSets: number;
  loadedSets: number;
  unloadedSets: number;
  requestQuantitiesAligned: boolean;
  items: SetLoadItem[];
};

export type PackingMetrics = {
  loadedCount: number;
  requestedCount: number;
  grossWeight: number;
  loadedVolume: number;
  effectiveVolume: number;
  volumeUtilization: number;
  weightUtilization: number;
  centerOfGravity: {
    x: number;
    y: number;
    z: number;
    longitudinalRatio: number;
    lateralRatio: number;
    heightRatio: number;
    balanced: boolean;
  };
  executionComplexity: {
    orientationVariants: number;
    maxOrientationsPerSku: number;
    partialSupportCount: number;
    tippedCartonCount: number;
  };
  solveTimeMs: number;
};

export type StrategyComparisonSnapshot = {
  loadedCount: number;
  loadedSets: number | null;
  displayQuantity: number;
  volumeUtilization: number;
  weightUtilization: number;
  solveTimeMs: number;
  executionComplexity: PackingMetrics["executionComplexity"];
};

export type StrategyGuidance = {
  level: "adopted" | "review" | "blocked" | "matched";
  title: string;
  detail: string;
};

export type StrategyComparison = {
  displayUnit: "carton" | "set";
  practical: StrategyComparisonSnapshot;
  maximum: StrategyComparisonSnapshot;
  gainQuantity: number;
  gainRatio: number;
  sameQuantity: boolean;
  practicalUsesTheoreticalGuide: boolean;
  guidance: StrategyGuidance[];
};

export type ValidationReport = {
  valid: boolean;
  errors: string[];
};

export type QuoteEstimate = {
  source: "historical-exact" | "historical-near" | "calibrated-volume";
  confidence: "verified" | "estimated";
  matchedModels: string[];
  predictedSets: number;
  physicalLoadedSets: number;
  gapSets: number;
  gapRatio: number;
  expectedErrorPct: number;
  backtestMeanErrorPct: number;
  backtestP90ErrorPct: number;
  backtestMaxErrorPct: number;
  verifiedDataPoints: number;
  calibratedCargoVolumeCbm: number;
  setRoundedVolumeCbm: number;
  setPhysicalVolumeCbm: number;
  setWeightKg: number;
  predictedCargoVolumeCbm: number;
  predictedGrossWeightKg: number;
  volumeBoundRatio: number;
  weightBoundRatio: number;
  withinVolumeBound: boolean;
  withinWeightBound: boolean;
  physicallyPossibleByBounds: boolean;
  dataQualityWarnings: string[];
};

export type PackingResult = {
  id: string;
  mode: PackingMode;
  strategy: PackingStrategy;
  practicalTargetUtilization: number;
  singleCartonLimit?: number;
  engineVersion: string;
  container: ContainerSpec;
  clearance: number;
  placements: PlacedBox[];
  summaries: ProductSummary[];
  setSummaries: SetLoadSummary[];
  quoteEstimate?: QuoteEstimate;
  strategyComparison?: StrategyComparison;
  /**
   * Full independently solved coordinate plans cached by the worker. Nested
   * plans intentionally omit their own strategyPlans value, so the payload is
   * finite and switching tabs never triggers another solve.
   */
  strategyPlans?: Partial<Record<PackingStrategy, PackingResult>>;
  metrics: PackingMetrics;
  validation: ValidationReport;
  warnings: string[];
  createdAt: string;
};

export type WorkerRequest = {
  type: "pack-strategy";
  requestId: string;
  strategy: PackingStrategy;
  payload: PackingRequest;
};

export type WorkerResponse =
  | { type: "result" | "progress"; requestId: string; strategy: PackingStrategy; payload: PackingResult }
  | { type: "error"; requestId: string; strategy: PackingStrategy; message: string };
