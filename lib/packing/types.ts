export type PackingMode = "single" | "mixed";
export type LoadingWorkflow = "direct" | "pallet-only" | "palletized" | "single-capacity";
export type PalletBuildSpecification = {
  id: string;
  config: FloorPalletConfig;
  /** Available packaging units; zero disables this specification. */
  maxPallets: number;
  /** Omit for all products. Whole kits must be eligible together. */
  productIds?: string[];
  stackLayers: number;
  maxTopLoadKg: number;
};
export type PalletBuildOptions = {
  selection?: import("./packaging-choice").PackagingSelection;
  config: FloorPalletConfig;
  primaryRule?: { maxPallets: number; productIds?: string[] };
  /** Source order after primary; compact mode retains this order for ties. */
  additionalSpecs?: PalletBuildSpecification[];
  mix: "single" | "mixed";
  maxPallets: number;
  stackLayers: number;
  /** Certified additional load above a complete loaded pallet; 0 disables stacking. */
  maxTopLoadKg: number;
};
export type PackingStrategy = "practical" | "maximum";
export type RotationPolicy = "fixed" | "upright" | "any";
export type OrientationCode = "LWH" | "LHW" | "WLH" | "WHL" | "HLW" | "HWL";
export type OrientationSigns = [1 | -1, 1 | -1, 1 | -1];
export type CargoType = "carton" | "pallet" | "crate" | "drum" | "roll" | "loose";
export type CargoShape = "box" | "cylinder" | "wedge" | "trapezoid" | "frustum" | "l-profile" | "u-profile" | "t-profile" | "step" | "irregular" | "polygon" | "tube" | "reel" | "bend" | "ellipsoid" | "capsule" | "custom-prism" | "compound" | "mesh";
export type FloorPalletConfig = {
  /** Documentary twin-fork preflight; does not authorize handling. */
  forkInterface?: import("./fork-interface").ForkInterface;
  /** Documentary ratings for independent crate-stack preflight; never unlocks automatic stacking. */
  crateBearing?: import("./crate-bearing").CrateBearingProfile;
  /** Physical packaging recipe. Dimensions below are exterior dimensions. */
  packaging?: import("./packaging").PackagingSpec;
  presetId: string;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  maxLoad: number;
  /** 0 fills the floor with the selected layout; otherwise a fixed count. */
  count: number;
  gap: number;
  layout: "auto" | "long" | "cross";
  allowFloorCargo: boolean;
  /** Maximum cargo height above the deck. Omit or use 0 for the vehicle/door limit. */
  maxCargoHeight?: number;
};
export type PlacedPallet = {
  /** Prevent movement and contents edits until explicitly unlocked. */
  locked?: boolean;
  specificationId?: string;
  packaging?: import("./packaging").PackagingSpec;
  /** Fixed exterior height of an enclosing crate, including deck and lid. */
  enclosureHeight?: number;
  id: string;
  presetId: string;
  name: string;
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
  weight: number;
  maxLoad: number;
  orientation: "LWH" | "WLH";
};
export type LoadingRules = {
  layout: "auto" | "deep-first" | "layers";
  search: "smart" | "deep";
  cargoOrder: "auto" | "large-first" | "small-first";
  supportByType?: Partial<Record<CargoType, number>>;
};

export type ContainerSpec = {
  /** Non-supporting fixed obstacles or keep-clear regions, physical inner-origin mm. */
  exclusions?: import("./site-exclusions").SiteExclusion[];
  category?: "container" | "truck" | "pallet" | "other";
  loadingAccess?: "rear" | "open";
  /** Physical base below the cargo envelope; excluded from cargo capacity. */
  baseHeight?: number;
  specificationNote?: string;
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
  /** Only used by the independent conservative scenario, never applied to nominal packing. */
  dimensionAllowance?: import("./dimension-allowance").DimensionAllowance;
  /** Validated physical model, shared by rendering, collision and flat-face support. */
  solidModel?: import("./solid-model").SolidModel;
  /** Required separation from other cargo, in canonical mm. */
  protectionGap?: number;
  cargoType?: CargoType;
  cargoShape?: CargoShape;
  /** Original axis of a cylindrical package, before its placement rotation. */
  shapeAxis?: "L" | "W" | "H";
  /** Trapezoid top length / bottom length; preview keeps the full envelope. */
  shapeTopRatio?: number;
  /** Profile wall width / L and wall height / H, positive fractions; U vertical walls remain below 0.5. */
  shapeWallRatio?: number;
  shapeWallHeightRatio?: number;
  /** Raised step length / L and lower step height / H, positive fractions below 1. */
  shapeStepLengthRatio?: number;
  shapeStepHeightRatio?: number;
  allowedOrientations?: OrientationCode[];
  minimumSupportRatio?: number;
  /** Already included in outer height; never added to the cargo envelope. */
  palletBaseHeight?: number;
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
  /** Internal pallet-building stage: use the full deck envelope while retaining practical support/orientation rules. */
  palletBuildStage?: true;
  workflow?: LoadingWorkflow;
  palletBuild?: PalletBuildOptions;
  delivery?: import("./access").DeliveryMap;
  accessConfig?: import("./maneuver").AccessConfig;
  floorPallets?: FloorPalletConfig;
  loadingRules?: LoadingRules;
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
  /** Signed world X/Y/Z axes preserve all four horizontal turns of asymmetric bodies. */
  orientationSigns?: OrientationSigns;
  /** Internal support envelope; never used for a customer carton. */
  supportOnly?: boolean;
  palletIds?: string[];
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
  solidVolumeApproximate?:boolean;
  envelopeVolume?: number;
  envelopeUtilization?: number;
  envelopeApproximate?: boolean;
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
  dimensionScenario?: import("./dimension-scenarios").DimensionScenarioTag;
  workflow?: LoadingWorkflow;
  palletBuild?: PalletBuildOptions;
  palletization?: import("./prebuilt-pallets").Palletization;
  delivery?: import("./access").DeliveryMap;
  accessConfig?: import("./maneuver").AccessConfig;
  floorPallets?: FloorPalletConfig;
  pallets?: PlacedPallet[];
  loadingRules?: LoadingRules;
  cargoDetails?: Record<string, Pick<ProductInput, "cargoType" | "palletBaseHeight" | "cargoShape" | "shapeAxis" | "shapeTopRatio" | "shapeWallRatio" | "shapeWallHeightRatio" | "shapeStepLengthRatio" | "shapeStepHeightRatio" | "solidModel" | "protectionGap">>;
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
