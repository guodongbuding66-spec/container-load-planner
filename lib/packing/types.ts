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
  color: string;
};

export type PackingRequest = {
  mode: PackingMode;
  strategy?: PackingStrategy;
  practicalTargetUtilization?: number;
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
  };
  solveTimeMs: number;
};

export type ValidationReport = {
  valid: boolean;
  errors: string[];
};

export type QuoteEstimate = {
  source: "historical-exact" | "calibrated-volume";
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
  engineVersion: string;
  container: ContainerSpec;
  clearance: number;
  placements: PlacedBox[];
  summaries: ProductSummary[];
  setSummaries: SetLoadSummary[];
  quoteEstimate?: QuoteEstimate;
  metrics: PackingMetrics;
  validation: ValidationReport;
  warnings: string[];
  createdAt: string;
};

export type WorkerRequest = {
  type: "pack";
  requestId: string;
  payload: PackingRequest;
};

export type WorkerResponse =
  | { type: "result"; requestId: string; payload: PackingResult }
  | { type: "error"; requestId: string; message: string };
