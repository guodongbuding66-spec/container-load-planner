"use client";
import {ExcelDataGrid} from "./ui/excel-data-grid";
import {cargoEntryColumns,cargoEntryExportColumns,cargoEntryRows} from "./cargo-entry-columns";
import {DEMO_PRODUCTS,DEMO_ACCESS,demoPalletBuild,isDemoOrder} from "../lib/packing/demo-order";
import {CargoSpaceWarnings} from "./cargo-space-warnings";
import {issueDeliveryIdentity} from "../lib/packing/delivery-identity";
import {OrderCapacityTrial} from "./order-capacity-trial";
import {oneLayerPalletCeilings} from "../lib/packing/pallet-height";
import {withPalletRecipe} from "../lib/packing/pallet-recipe";
import {palletSpecifications} from "../lib/packing/pallet-specifications";
import {EngineeringChecks} from "./engineering-checks";
import type {EngineeringDocument} from "../lib/packing/engineering-checks";
import {QualityBenchmarks} from "./quality-benchmarks";
import {WeighingPanel} from "./weighing-panel";
import type {WeighingRecords} from "../lib/packing/weighing";
import {OperationsPanel} from "./operations-panel";
import type {OperationRecords} from "../lib/packing/operations";
import {DeliveryVersionPanel} from "./delivery-version-panel";
import {FieldJournalPanel} from "./field-journal-panel";
import {guardFieldRevision,lockLoadedFieldPositions,readRevisionFieldRecords,readVersionFieldRecords,rememberFieldRecords,requireKnownFieldHandover,type FieldRecords} from "../lib/packing/field-records";
import {ContainerAccessorySettings} from "./container-accessory-settings";
import {ContainerAccessoryManifest} from "./container-accessory-manifest";

import {
  Box,
  Boxes,
  Copy,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  AlertTriangle,
  Container,
  Crosshair,
  Download,
  FileJson,
  FileSpreadsheet,
  Gauge,
  Layers3,
  LoaderCircle,
  PackageOpen,
  Settings2,
  Pause,
  Play,
  Plus,
  Printer,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Weight,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import {OrderLineEditor} from "./order-line-editor";
import { parseShippingMark } from "../lib/packing/shipping-mark";
import {adoptOrderDelivery,inheritOrderDelivery,orderDelivery,copyOrderRows,importOrderRows,updateOrderQuantities,assertOrderReferences,parseOrderLine} from "../lib/packing/order-lines";
import { shapeDetails, shapeCanSupport } from "../lib/packing/cargo-shape";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CameraProjection, CameraView } from "../lib/packing/camera-fit";
import {
  feasibleRecommendation,
  solverOutcome,
  isObsoleteCalculation,
  resultDisplayQuantity,
  selectStrategyResult,
} from "../lib/packing/calculation-state";
import { buildPlacementCsv, buildOrderRowsCsv, parseOrderQuantityCsv, MAX_CSV_BYTES, MAX_CSV_ROWS, parseProductsCsv } from "../lib/packing/csv";
import {
  calculateReverseCounts,
  combineStrategyResults,
  DEFAULT_PRACTICAL_TARGET,
  ENGINE_VERSION,
  recommendedPracticalTarget,
  validateContainerInput,
} from "../lib/packing/engine";
import { summarizePackingProgress } from "../lib/packing/progress";
import { detectRuntimePolicy, type SolverSchedule } from "../lib/packing/runtime-policy";
import {
  CONTAINER_PRESETS,
  DIMENSION_TEST_PRODUCTS,
  MULTI_CARTON_SET_PRODUCTS,
  REAL_WORLD_A64M_PRODUCTS,
  SAMPLE_PRODUCTS,
  TWO_CARTON_SET_PRODUCTS,
} from "../lib/packing/presets";
import { HISTORICAL_LOADING_RECORDS } from "../lib/packing/quote-estimator";
import {
  alignSetQuantities,
  inferImportedPackingMode,
  normalizedUnitsPerSet,
  selectProductsForMode,
  summarizeSetInputs,
} from "../lib/packing/set-utils";
import type {
  ContainerSpec,
  PackingMode,
  PackingRequest,
  PackingResult,
  PackingStrategy,
  ProductInput,
  WorkerResponse,
} from "../lib/packing/types";
import { exactCartonVolumeCbm, roundedCartonVolumeCbm } from "../lib/packing/volume";
import {
  fromKilograms,
  fromMillimeters,
  isLengthUnit,
  isWeightUnit,
  LENGTH_UNIT_OPTIONS,
  lengthUnitPrecision,
  toKilograms,
  toMillimeters,
  WEIGHT_UNIT_OPTIONS,
  weightUnitPrecision,
  type LengthUnit,
  type WeightUnit,
} from "../lib/packing/units";
import { NumericInput } from "./numeric-input";
import { ProductCatalog, CustomerReportPanel } from "./product-catalog";
import { CrateStackPreflight } from "./crate-stack-preflight";
import { DimensionScenarios } from "./dimension-scenarios";
import { WorkflowTools, type WorkflowToolGroup } from "./workflow-tools";
import type { GuideTarget } from "../lib/help/topics";
import { ArchiveLibrary, BearingRules, UnloadedReasons, ManualPlan, FieldGuide, FleetPlanner } from "./planning-upgrades";
import type {FleetSnapshot} from "../lib/packing/fleet-tail";
import { RemainingCapacity } from "./remaining-capacity";
import { SpaceModelPreview } from "./space-model-preview";
import { usePlanEditor } from "./use-plan-editor";
import {parseSiteExclusions} from "../lib/packing/site-exclusions";
import {SiteExclusionSettings} from "./site-exclusion-settings";
import {VehicleEngineeringReview,VehicleEngineeringSettings} from "./vehicle-engineering";
import {parseVehicleEngineering} from "../lib/packing/vehicle-engineering";
import { CargoLoadingAllocation } from "./cargo-loading-allocation";
import { PalletBuildSettings } from "./pallet-build-settings";
import {parsePreparedPalletLayout,type PreparedPalletLayout} from "../lib/packing/prepared-pallet-layout";
import { DEFAULT_PALLET_BUILD, parseLoadingWorkflow, parsePalletBuild } from "../lib/packing/loading-workflow";
import type { LoadingWorkflow, PalletBuildOptions } from "../lib/packing/types";
import { PrebuiltPalletPanel } from "./prebuilt-pallet-panel";
import {parsePalletLayerTemplates,type PalletLayerTemplate} from "../lib/packing/pallet-layer";
import { PalletManifest } from "./pallet-manifest";
import { PalletOrderConsolidationButton } from "./pallet-order-consolidation";
import { PlacementManifest } from "./placement-manifest";
import { LongSupportPanel } from "./long-support-panel";
import { PlanReviewPanel, ResultAuditPanel } from "./result-audit-panel";
import { reviewPlan } from "../lib/packing/plan-review";
import { auditPackingResult } from "../lib/packing/result-audit";
import { WorkflowSteps, type WorkflowStep } from "./workflow-steps";
import { palletOnlyDefaults } from "../lib/packing/packaging-presets";
import { MAX_WORKSPACE_BYTES, parseWorkspaceBackup, restoreWorkspacePlans, serializeWorkspaceBackup, type WorkspaceInputs } from "../lib/packing/workspace-file";
import { PlanViews } from "./plan-views";
import { WorkbenchTabs } from "./workbench-tabs";
import { SceneErrorBoundary } from "./scene-error-boundary";
import { FeatureDialog } from "./feature-dialog";
import { WorkspaceFileMenu } from "./workspace-file-menu";

import { CargoSettings } from "./cargo-settings";
import { ZeroLoadNotice } from "./cargo-fit-notice";
import { LoadingShortfall } from "./loading-shortfall";
import { LoadingRuleSettings } from "./loading-rule-settings";
import { TransportPicker } from "./transport-picker";
import { LearningHub } from "./learning-hub";
import { CloudAccount } from "./cloud-account";
import { PlanViewer } from "./plan-viewer";
import { DEFAULT_LOADING_RULES, parseLoadingRules } from "../lib/packing/loading-rules";
import { TRANSPORT_PRESETS } from "../lib/packing/transport-library";
import { importSpreadsheet } from "../lib/packing/spreadsheet-client";
import { FloorPalletSettings } from "./floor-pallet-settings";
import { parseFloorPalletConfig } from "../lib/packing/floor-pallets";
import type { FloorPalletConfig, LoadingRules } from "../lib/packing/types";
import type { IndustryCase } from "../lib/packing/industry-cases";
import {tr, useLanguage, getAppLanguage, tt, trText} from "./language";

const ContainerScene = dynamic(() => import("./container-scene").then((module) => module.ContainerScene), {
  ssr: false,
  loading: () => <div className="scene-loading">{tr("正在准备三维视图…")}</div>,
});

const STORAGE_KEY = "cargo-fit-workspace-v1";
const STORAGE_SAVE_DELAY_MS = 320;
const AUTO_CALCULATE_DELAY_MS = 280;
const PRODUCT_PAGE_SIZE = 25;
const MAX_VISIBLE_SET_SUMMARIES = 50;
const MAX_VISIBLE_SET_ITEMS = 16;
const COLORS = ["#2f7f89", "#c66a3d", "#d5a72f", "#6b72a9", "#609d62", "#a95e78", "#447ca8"];
const VALID_COLOR = /^#[0-9a-f]{6}$/i;
type DimensionField = "length" | "width" | "height";

type CalcStatus = "idle" | "working" | "done" | "error";
type StorageState = "saved" | "error";

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampNumber(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  return Math.floor(clampNumber(value, fallback, min, max));
}

function safeText(value: unknown, fallback: string, maxLength: number) {
  return (typeof value === "string" ? value : fallback).slice(0, maxLength);
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function strategyDisplayLabel(result: PackingResult) {
  if (result.mode === "single" && result.setSummaries.length) {
    return tt`${formatNumber(result.setSummaries[0].loadedSets)} 套（${formatNumber(result.metrics.loadedCount)} 箱）`;
  }
  return tt`${formatNumber(result.metrics.loadedCount)} 箱`;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createProduct(index: number): ProductInput {
  return {
    id: `product-${Date.now()}-${index}`,
    sku: `SKU-${String(index + 1).padStart(3, "0")}`,
    name: tr("新产品"),
    length: 1000,
    width: 500,
    height: 300,
    weight: 25,
    quantity: 20,
    priority: 50,
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 0,
    mustLoad: true,
    bottomOnly: false,
    setCode: "",
    unitsPerSet: 1,
    declaredVolumeCbm: 0.15,
    color: COLORS[index % COLORS.length],
  };
}

function createSetComponent(index: number, setCode: string, componentIndex: number, cartonCount: number): ProductInput {
  return {
    ...createProduct(index),
    id: `set-${Date.now()}-${index}-${componentIndex}`,
    sku: `${setCode}-${String(componentIndex + 1).padStart(2, "0")}`,
    name: tt`${cartonCount} 箱套装 · 第 ${componentIndex + 1} 箱（请填写）`,
    quantity: 100,
    priority: 100,
    setCode,
    unitsPerSet: 1,
    mustLoad: true,
  };
}

function nextSetCode(products: ProductInput[], cartonCount: number) {
  const existing = new Set(products.flatMap((product) => {
    const setCode = product.setCode?.trim();
    return setCode ? [setCode] : [];
  }));
  let index = 1;
  let candidate = "";
  do {
    candidate = `SET-${cartonCount}BOX-${String(index).padStart(2, "0")}`;
    index += 1;
  } while (existing.has(candidate));
  return candidate;
}

function normalizeProductDraft(product: Partial<ProductInput>, index: number): ProductInput {
  const fallback = createProduct(index);
  const length = clampNumber(product.length, 0, 0);
  const width = clampNumber(product.width, 0, 0);
  const height = clampNumber(product.height, 0, 0);
  const rotationPolicy = ["fixed", "upright", "any"].includes(product.rotationPolicy ?? "")
    ? product.rotationPolicy as ProductInput["rotationPolicy"]
    : product.allowRotate === false
      ? "fixed"
      : "any";
  return {
    ...fallback,
    ...product,
    shippingMark: parseShippingMark(product.shippingMark),
    ...(product.orderLine===undefined?{}:{orderLine:parseOrderLine(product.orderLine)}),
    id: safeText(product.id, fallback.id, 120),
    sku: safeText(product.sku, fallback.sku, 80),
    name: safeText(product.name, fallback.name, 200),
    length,
    width,
    height,
    weight: clampNumber(product.weight, 0, 0),
    quantity: clampInteger(product.quantity, 0, 0, 1_000_000),
    priority: clampInteger(product.priority, 50, 0, 100),
    rotationPolicy,
    stackable: product.stackable !== false,
    maxStackLayers: clampInteger(product.maxStackLayers, 0, 0, 99),
    mustLoad: product.mustLoad !== false,
    bottomOnly: product.bottomOnly === true,
    setCode: safeText(product.setCode, "", 80).trim(),
    unitsPerSet: clampInteger(product.unitsPerSet, 1, 1, 99),
    declaredVolumeCbm: roundedCartonVolumeCbm({ length, width, height }),
    color: typeof product.color === "string" && VALID_COLOR.test(product.color) ? product.color : fallback.color,
  };
}

function normalizeContainerDraft(value: unknown, fallback: ContainerSpec): ContainerSpec {
  const candidate = value && typeof value === "object" ? value as Partial<ContainerSpec> : {};
  return {
    ...(candidate.engineering===undefined?{}:{engineering:parseVehicleEngineering(candidate.engineering,{length:1e6,width:1e6})}),
    ...(candidate.exclusions===undefined?{}:{exclusions:parseSiteExclusions(candidate.exclusions,candidate as ContainerSpec,true)}),
    category: candidate.category ?? fallback.category, loadingAccess: candidate.loadingAccess ?? fallback.loadingAccess, baseHeight: candidate.baseHeight ?? fallback.baseHeight, specificationNote: candidate.specificationNote ?? fallback.specificationNote,
    id: safeText(candidate.id, fallback.id, 120),
    name: safeText(candidate.name, fallback.name, 120),
    length: clampNumber(candidate.length, fallback.length, 0),
    width: clampNumber(candidate.width, fallback.width, 0),
    height: clampNumber(candidate.height, fallback.height, 0),
    doorWidth: clampNumber(candidate.doorWidth, fallback.doorWidth, 0),
    doorHeight: clampNumber(candidate.doorHeight, fallback.doorHeight, 0),
    maxWeight: clampNumber(candidate.maxWeight, fallback.maxWeight, 0),
  };
}

function normalizeProductList(products: ProductInput[]) {
  const seen = new Set<string>();
  return products.slice(0, MAX_CSV_ROWS).map((product, index) => {
    const normalized = normalizeProductDraft(product, index);
    const baseId = normalized.id || `restored-${index}`;
    let id = baseId;
    let suffix = 1;
    while (seen.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    return { ...normalized, id };
  });
}

function Field({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  useLanguage();
  return (
    <label className="field">
      <span className="field-label">{tr(label)}</span>
      <span className="field-control">
        {children}
        {unit ? <span className="field-unit">{unit}</span> : null}
      </span>
    </label>
  );
}

function MetricCard({ icon, label, value, detail, tone = "teal" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  useLanguage();
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{tr(label)}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export function PackingApp() {
  useLanguage();
  const [floorPallets, setFloorPallets] = useState<FloorPalletConfig | undefined>();
  const [pendingFleetTail,setPendingFleetTail]=useState<FleetSnapshot|null>(null);
  const consumeFleetTail=useCallback((value:FleetSnapshot)=>setPendingFleetTail(current=>current===value?null:current),[]);
  const [showFloorPallets, setShowFloorPallets] = useState(false);
  const [loadingRules, setLoadingRules] = useState<LoadingRules>({...DEFAULT_LOADING_RULES});
  const [activeOrderLine,setActiveOrderLine]=useState<string|null>(null);
  const orderImportRevisionRef=useRef(0);
  const [orderImportMode,setOrderImportMode]=useState<"replace"|"append"|"quantity">("replace");
  const [activeCargo, setActiveCargo] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showTransport, setShowTransport] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [guide,setGuide] = useState<string|null>(null);
  const [toolGroup,setToolGroup] = useState<WorkflowToolGroup>("projects");
  const fileMenu = useRef<HTMLDetailsElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const [toolsOpen,setToolsOpen] = useState(false);
  const [toolsVisited,setToolsVisited] = useState(false);
  const [palletPreviewReady,setPalletPreviewReady]=useState(false);
  const [resultPane,setResultPane] = useState<"view"|"review"|"exports">("view");
  const [viewRevision,setViewRevision] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [mode, setMode] = useState<PackingMode>("mixed");
  const [loadingWorkflow, setLoadingWorkflow] = useState<LoadingWorkflow>("palletized");
  const [palletBuild, setPalletBuild] = useState<PalletBuildOptions>(demoPalletBuild);
  const [preparedPalletLayout,setPreparedPalletLayout]=useState<PreparedPalletLayout>();
  const workflow: LoadingWorkflow = mode === "single" ? "single-capacity" : loadingWorkflow === "single-capacity" ? "direct" : loadingWorkflow;
  const isPalletWorkflow = workflow === "pallet-only" || workflow === "palletized";
  const hasManualPreparation=isPalletWorkflow&&!!preparedPalletLayout;
  const [strategy, setStrategy] = useState<PackingStrategy>("practical");
  const [practicalTargetPercent, setPracticalTargetPercent] = useState(
    recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100,
  );
  const [container, setContainer] = useState<ContainerSpec>({ ...CONTAINER_PRESETS[2] });
  const [clearance, setClearance] = useState(10);
  const [products, setProducts] = useState<ProductInput[]>(() => structuredClone(DEMO_PRODUCTS));
  const [palletLayerTemplates,setPalletLayerTemplates]=useState<PalletLayerTemplate[]>([]);
  const [autoCalculate, setAutoCalculate] = useState(false);
  const [workflowStep,setWorkflowStep]=useState<WorkflowStep>(1);
  const [manualRun,setManualRun]=useState(0);
  const [setupInvalid,setSetupInvalid]=useState(false);
  const [palletRecipePending,setPalletRecipePending]=useState(false);
  const [palletSetupSpec,setPalletSetupSpec]=useState("primary");
  const modePackagingDrafts=useRef<Partial<Record<"pallet-only"|"palletized",{build:PalletBuildOptions;layout?:PreparedPalletLayout}>>>({});
  const [previewRuleDraft,setPreviewRuleDraft]=useState<{rules:LoadingRules;products:ProductInput[]}|null>(null);
  const palletDraftRef=useRef<{value:FloorPalletConfig|undefined;invalid:boolean}|null>(null);
  const rulesDraftRef=useRef<{rules:LoadingRules;products:ProductInput[]}|null>(null);
  const [calculationBudget, setCalculationBudget] = useState(0);
  const [resultBundle, setResultBundle] = useState<PackingResult | null>(null);
  const [status, setStatus] = useState<CalcStatus>("idle");
  const [notice, setNotice] = useState<{text: string; status?: "done" | "error"}>(() => ({text: tr("参数已就绪")}));
  const setMessage = useCallback((text: string, status?: "done" | "error") => setNotice({text, status}), []);
  const [workspaceConfirmation, setWorkspaceConfirmation] = useState<{
    kind: "sample" | "restore"; description: string; fileName?: string; apply: () => void;
  } | null>(null);
  const restoreAttempt = useRef(0);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [visibleProducts, setVisibleProducts] = useState<Set<string>>(new Set());
  const [customContainers, setCustomContainers] = useState<ContainerSpec[]>([]);
  const [showContainerSave, setShowContainerSave] = useState(false);
  const [customContainerName, setCustomContainerName] = useState("");
  const [targetVolumePercent, setTargetVolumePercent] = useState(85);
  const [targetWeightPercent, setTargetWeightPercent] = useState(90);
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>("mm");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg");
  const [invalidNumericFields, setInvalidNumericFields] = useState<Set<string>>(new Set());
  const [numericResetVersion, setNumericResetVersion] = useState(0);
  const [isEditingDimensions, setIsEditingDimensions] = useState(false);
  const [pendingDimensionProducts,setPendingDimensionProducts]=useState<Set<string>>(()=>new Set());
  const [hasPendingDimensionChanges, setHasPendingDimensionChanges] = useState(false);
  const [packingProgress, setPackingProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [cameraView, setCameraView] = useState<CameraView>("perspective");
  const [cameraProjection, setCameraProjection] = useState<CameraProjection>("perspective");
  const [storageState, setStorageState] = useState<StorageState>("saved");
  const [productPage, setProductPage] = useState(0);
  const [showProductRules,setShowProductRules]=useState(false);
  const [kitRows,setKitRows]=useState<Set<string>|null>(null);
  const locateFromReviewRef=useRef<((id:string)=>void)|null>(null);
  const [renderPrintViews, setRenderPrintViews] = useState(false);
  const [solverSchedule, setSolverSchedule] = useState<SolverSchedule>("parallel");
  const workersRef = useRef<Partial<Record<PackingStrategy, Worker>>>({});
  const engineeringDocumentsRef=useRef(new Map<string,EngineeringDocument>());
  const getEngineeringDocument=useCallback((key:string)=>engineeringDocumentsRef.current.get(key),[]);
  const receiveEngineeringDocument=useCallback((key:string,doc:EngineeringDocument)=>{engineeringDocumentsRef.current.set(key,doc);},[]);
  const weighingRecordsRef=useRef(new Map<string,WeighingRecords>());
  const getWeighingRecords=useCallback((key:string)=>weighingRecordsRef.current.get(key),[]);
  const receiveWeighingRecords=useCallback((key:string,records:WeighingRecords)=>{weighingRecordsRef.current.set(key,records);},[]);
  const operationRecordsRef=useRef(new Map<string,OperationRecords>());
  const getOperationRecords=useCallback((key:string)=>operationRecordsRef.current.get(key),[]);
  const receiveOperationRecords=useCallback((key:string,records:OperationRecords)=>{operationRecordsRef.current.set(key,records);},[]);
  const fieldRecordsRef=useRef(new Map<string,FieldRecords>());
  const receiveFieldRecords=useCallback((records:FieldRecords)=>{rememberFieldRecords(fieldRecordsRef.current,records,{getItem:key=>localStorage.getItem(key)});},[]);
  const getKnownFieldRecords=useCallback((plan:PackingResult)=>{const id=plan.deliveryIdentity;return id?fieldRecordsRef.current.get(`${id.planId}/${id.revisionId}`):undefined;},[]);
  const workerResultsRef = useRef<Partial<Record<PackingStrategy, PackingResult>>>({});
  const calculationTimeoutRef = useRef<number | null>(null);
  const maximumStartTimerRef = useRef<number | null>(null);
  const dimensionBlurTimerRef = useRef<number | null>(null);
  const pendingDimensionChangesRef = useRef<Map<string, Partial<Record<DimensionField, number>>>>(new Map());
  const activeRequestRef = useRef<string | null>(null);
  const activeRevisionRef = useRef<number | null>(null);
  const inputRevisionRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const strategyRef = useRef<PackingStrategy>(strategy);
  const displayedPlanIdRef = useRef<string | null>(null);
  const packingProgressRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceInputRef = useRef<HTMLInputElement>(null);
  const result = useMemo(
    () => dirty ? null : selectStrategyResult(resultBundle, strategy),
    [dirty, resultBundle, strategy],
  );

  const terminateActiveWorkers = useCallback(() => {
    Object.values(workersRef.current).forEach((worker) => worker?.terminate());
    workersRef.current = {};
    if (maximumStartTimerRef.current !== null) {
      window.clearTimeout(maximumStartTimerRef.current);
      maximumStartTimerRef.current = null;
    }
    if (calculationTimeoutRef.current !== null) {
      window.clearTimeout(calculationTimeoutRef.current);
      calculationTimeoutRef.current = null;
    }
  }, []);

  const clearActiveCalculation = useCallback(() => {
    terminateActiveWorkers();
    activeRequestRef.current = null;
    activeRevisionRef.current = null;
    workerResultsRef.current = {};
  }, [terminateActiveWorkers]);

  const finishActiveCalculation = useCallback(() => {
    if (maximumStartTimerRef.current !== null) {
      window.clearTimeout(maximumStartTimerRef.current);
      maximumStartTimerRef.current = null;
    }
    if (calculationTimeoutRef.current !== null) {
      window.clearTimeout(calculationTimeoutRef.current);
      calculationTimeoutRef.current = null;
    }
    activeRequestRef.current = null;
    activeRevisionRef.current = null;
    workerResultsRef.current = {};
  }, []);

  const discardObsoleteCalculation = useCallback(() => {
    if (!isObsoleteCalculation(activeRevisionRef.current, inputRevisionRef.current)) return false;
    clearActiveCalculation();
    setIsPlaying(false);
    setStatus("idle");
    setMessage(tr("输入已变化，旧结果已安全丢弃；请按最新参数重新计算。"));
    return true;
  }, [clearActiveCalculation, setStatus, setMessage]);

  const presentPlan = useCallback((plan: PackingResult) => {
    if (displayedPlanIdRef.current === plan.id) return;
    displayedPlanIdRef.current = plan.id;
    setVisibleProducts(new Set(plan.summaries.map((item) => item.productId)));
    setPackingProgress(plan.placements.length);
    setIsPlaying(false);
    setCameraView("perspective");
    setCameraProjection("perspective");
  }, [setVisibleProducts, setPackingProgress, setCameraView]);

  const acceptResult = useCallback((nextResult: PackingResult, successMessage: string) => {
    if (discardObsoleteCalculation()) {
      return;
    }
    const acceptedPlan = selectStrategyResult(nextResult, strategyRef.current) ?? nextResult;
    setResultBundle(nextResult);
    presentPlan(acceptedPlan);
    setStatus(acceptedPlan.validation.valid ? "done" : "error");
    setDirty(false);
    finishActiveCalculation();
    setMessage(acceptedPlan.validation.valid
      ? successMessage
      : tt`方案未通过独立校验，已阻止打印与导出：${acceptedPlan.validation.errors[0] ?? tr("请检查异常明细")}`);
  }, [discardObsoleteCalculation, finishActiveCalculation, presentPlan, setResultBundle, setStatus, setDirty, setMessage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved) as {
            workflow?: LoadingWorkflow;
            palletBuild?: PalletBuildOptions;
            preparedPalletLayout?: unknown;
            palletLayerTemplates?: unknown;
            floorPallets?: FloorPalletConfig;
            loadingRules?: LoadingRules;
            mode?: PackingMode;
            strategy?: PackingStrategy;
            practicalTargetPercent?: number;
            container?: ContainerSpec;
            clearance?: number;
            products?: ProductInput[];
            customContainers?: ContainerSpec[];
            targetVolumePercent?: number;
            targetWeightPercent?: number;
            lengthUnit?: LengthUnit;
            weightUnit?: WeightUnit;
          };
          setLoadingWorkflow(parseLoadingWorkflow(data.workflow, data.mode));
          if (data.palletLayerTemplates) setPalletLayerTemplates(parsePalletLayerTemplates(data.palletLayerTemplates));
          if (data.palletBuild) setPalletBuild(parsePalletBuild(data.palletBuild,true));
          setPreparedPalletLayout(parsePreparedPalletLayout(data.preparedPalletLayout));
          if (data.floorPallets) setFloorPallets(parseFloorPalletConfig(data.floorPallets));
          if (data.loadingRules) setLoadingRules(parseLoadingRules(data.loadingRules));
          if (data.workflow==="palletized"||data.workflow==="pallet-only") setMode("mixed");
          else if (data.mode === "single" || data.mode === "mixed") setMode(data.mode);
          if (data.strategy === "practical" || data.strategy === "maximum") setStrategy(data.strategy);
          if (typeof data.practicalTargetPercent === "number") {
            setPracticalTargetPercent(clampNumber(data.practicalTargetPercent, DEFAULT_PRACTICAL_TARGET * 100, 50, 95));
          }
          if (data.container) setContainer(normalizeContainerDraft(data.container, CONTAINER_PRESETS[2]));
          if (typeof data.clearance === "number") setClearance(clampNumber(data.clearance, 10, 0, 50));
          if (Array.isArray(data.products) && data.products.length) {
            setProducts(normalizeProductList(data.products));
          }
          if (Array.isArray(data.customContainers)) {
            setCustomContainers(data.customContainers.slice(0, 100).map((item, index) =>
              normalizeContainerDraft(item, { ...CONTAINER_PRESETS[2], id: `custom-restored-${index}`, name: tt`自定义柜型 ${index + 1}` }),
            ));
          }
          if (typeof data.targetVolumePercent === "number") setTargetVolumePercent(clampInteger(data.targetVolumePercent, 85, 1, 100));
          if (typeof data.targetWeightPercent === "number") setTargetWeightPercent(clampInteger(data.targetWeightPercent, 90, 1, 100));
          if (isLengthUnit(data.lengthUnit)) setLengthUnit(data.lengthUnit);
          if (isWeightUnit(data.weightUnit)) setWeightUnit(data.weightUnit);
          setMessage(tr("已恢复本机草稿"));
        }
      } catch {
        setMessage(tr("本机草稿读取失败，已使用示例数据"));
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [setMessage]);

  const lastSavedDraftRef = useRef<Partial<WorkspaceInputs>>({});
  const persistDraft = useCallback((patch: Partial<WorkspaceInputs> = {}) => {
    if (!hydrated) return;
    try {
      const snapshot = { palletLayerTemplates, workflow, palletBuild, preparedPalletLayout, floorPallets, loadingRules, mode, strategy, practicalTargetPercent, container, clearance, products, customContainers, targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit, ...patch };
      lastSavedDraftRef.current = snapshot;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      setStorageState("saved");
    } catch {
      setStorageState("error");
      setMessage(tr("本机草稿保存失败：浏览器存储不可用或空间不足"));
    }
  }, [palletLayerTemplates,workflow,palletBuild,preparedPalletLayout,floorPallets,loadingRules, clearance, container, customContainers, hydrated, lengthUnit, mode, practicalTargetPercent, products, strategy, targetVolumePercent, targetWeightPercent, weightUnit, setMessage]);

  useEffect(() => {
    if (!hydrated) return;
    lastSavedDraftRef.current = { palletLayerTemplates, workflow, palletBuild, preparedPalletLayout, floorPallets, loadingRules, mode, strategy, practicalTargetPercent, container, clearance, products, customContainers, targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit };
    const saveTimer = window.setTimeout(() => persistDraft(), STORAGE_SAVE_DELAY_MS);
    const saveBeforeLeaving = () => persistDraft(lastSavedDraftRef.current);
    window.addEventListener("pagehide", saveBeforeLeaving);
    return () => { window.clearTimeout(saveTimer); window.removeEventListener("pagehide", saveBeforeLeaving); };
  }, [palletLayerTemplates,hydrated, persistDraft, workflow, palletBuild, preparedPalletLayout, floorPallets, loadingRules, mode, strategy, practicalTargetPercent, container, clearance, products, customContainers, targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit]);

  useEffect(() => () => {
    terminateActiveWorkers();
    if (dimensionBlurTimerRef.current !== null) window.clearTimeout(dimensionBlurTimerRef.current);
  }, [terminateActiveWorkers]);

  useEffect(() => {
    const preparePrint = () => flushSync(() => setRenderPrintViews(true));
    const finishPrint = () => setRenderPrintViews(false);
    window.addEventListener("beforeprint", preparePrint);
    window.addEventListener("afterprint", finishPrint);
    return () => {
      window.removeEventListener("beforeprint", preparePrint);
      window.removeEventListener("afterprint", finishPrint);
    };
  }, []);

  useEffect(() => {
    packingProgressRef.current = packingProgress;
  }, [packingProgress]);

  useEffect(() => {
    strategyRef.current = strategy;
  }, [strategy]);

  useEffect(() => {
    if (!isPlaying || !result?.placements.length) return;
    const total = result.placements.length;
    const step = Math.max(1, Math.ceil(total / 120)) * playbackSpeed;
    const timer = window.setInterval(() => {
      const next = Math.min(total, packingProgressRef.current + step);
      packingProgressRef.current = next;
      setPackingProgress(next);
      if (next >= total) {
        window.clearInterval(timer);
        setIsPlaying(false);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackSpeed, result]);

  const markDirty = useCallback(() => {
    inputRevisionRef.current += 1;
    displayedPlanIdRef.current = null;
    setDirty(true);
    setIsPlaying(false);
    if (status === "working") {
      clearActiveCalculation();
      setStatus("idle");
      setMessage(tr("输入已修改；旧计算已立即取消，正在准备最新参数重算"));
    }
    else if (status === "done") setMessage(tr("输入已修改；数量、三视图和 3D 正在实时同步"));
    else if (status === "error") {
      setStatus("idle");
      setMessage(tr("输入已修改；正在按最新有效参数重新计算"));
    } else setMessage(tr("参数已更新；正在准备实时计算"));
    if (!autoCalculate || workflowStep !== 7) setMessage(tr("输入已修改；完成货物与装载配置后，再统一计算方案。"));
  }, [autoCalculate, clearActiveCalculation, status, workflowStep, setDirty, setStatus, setMessage]);

  const setNumericFieldValidity = useCallback((fieldKey: string, valid: boolean) => {
    setInvalidNumericFields((current) => {
      const hasField = current.has(fieldKey);
      if ((valid && !hasField) || (!valid && hasField)) return current;
      const next = new Set(current);
      if (valid) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
    if (!valid) markDirty();
  }, [markDirty]);

  const clearNumericDraftErrors = useCallback(() => {
    setInvalidNumericFields(new Set());
    setNumericResetVersion((current) => current + 1);
    pendingDimensionChangesRef.current.clear();
    setPendingDimensionProducts(current=>current.size?new Set():current);
    setHasPendingDimensionChanges(false);
    setIsEditingDimensions(false);
    if (dimensionBlurTimerRef.current !== null) {
      window.clearTimeout(dimensionBlurTimerRef.current);
      dimensionBlurTimerRef.current = null;
    }
  }, []);

  const switchStrategy = (nextStrategy: PackingStrategy) => {
    if (strategy === nextStrategy) return;
    const cachedPlan = !dirty ? resultBundle?.strategyPlans?.[nextStrategy] : undefined;
    if (!cachedPlan && result && status !== "working") {
      setMessage(tr("请先重新计算方案，再比较两种算法。", "Recalculate the plan to compare both strategies."));
      return;
    }
    strategyRef.current = nextStrategy;
    setStrategy(nextStrategy);
    if (!cachedPlan) {
      setMessage(status === "working" ? tr("算法视图已切换；新快照完成后会自动显示对应方案") : tr("正在等待当前参数的双算法快照"));
      return;
    }
    presentPlan(cachedPlan);
    setStatus(cachedPlan.validation.valid ? "done" : "error");
    setMessage(nextStrategy === "practical"
      ? tt`已切换现场易执行方案：${strategyDisplayLabel(cachedPlan)}`
      : tt`已切换高密度参考方案：${strategyDisplayLabel(cachedPlan)}`);
  };

  const activeProducts = useMemo(() => selectProductsForMode(products, mode), [mode, products]);
  const resultAudit = useMemo(() => result ? auditPackingResult(result, activeProducts) : null, [result, activeProducts]);
  const planReview = useMemo(() => result && resultAudit ? reviewPlan(result, activeProducts, resultAudit) : null, [result, activeProducts, resultAudit]);
  const demoOrder=isDemoOrder(activeProducts);
  const exampleOrder=demoOrder||activeProducts.length===SAMPLE_PRODUCTS.length&&activeProducts.every((p,i)=>{
    const sample=SAMPLE_PRODUCTS[i];
    return p.sku===sample.sku&&p.length===sample.length&&p.width===sample.width&&p.height===sample.height&&p.quantity===sample.quantity&&p.weight===sample.weight;
  });
  const setInputSummaries = useMemo(() => summarizeSetInputs(activeProducts), [activeProducts]);
  const skuCounts=useMemo(()=>{const map=new Map<string,number>();for(const p of activeProducts)map.set(p.sku,(map.get(p.sku)??0)+1);return map;},[activeProducts]);
  const singleSetSummary = mode === "single" ? setInputSummaries[0] : undefined;
  const isSingleProductSet = Boolean(singleSetSummary);
  const inputVolume = useMemo(
    () => activeProducts.reduce(
      (sum, item) => sum + item.length * item.width * item.height * (
        mode === "single" ? isSingleProductSet ? normalizedUnitsPerSet(item) : 1 : item.quantity
      ),
      0,
    ) / 1_000_000_000,
    [activeProducts, isSingleProductSet, mode],
  );
  const inputWeight = useMemo(
    () => activeProducts.reduce(
      (sum, item) => sum + item.weight * (
        mode === "single" ? isSingleProductSet ? normalizedUnitsPerSet(item) : 1 : item.quantity
      ),
      0,
    ),
    [activeProducts, isSingleProductSet, mode],
  );

  const reversePlan = useMemo(
    () => calculateReverseCounts(
      { floorPallets, mode, strategy: "practical", practicalTargetUtilization: practicalTargetPercent / 100, container, clearance, products: activeProducts },
      targetVolumePercent / 100,
      targetWeightPercent / 100,
    ),
    [floorPallets, activeProducts, clearance, container, mode, practicalTargetPercent, targetVolumePercent, targetWeightPercent],
  );
  const resultDisplayUnit = result?.mode === "single" && result.setSummaries.length ? "set" : "carton";
  const resultLoadedDisplay = resultDisplayQuantity(result);
  const resultPlanLimitDisplay = result?.singleCartonLimit !== undefined
    ? resultDisplayUnit === "set"
      ? Math.floor(result.singleCartonLimit / (result.setSummaries[0]?.cartonsPerSet ?? 1))
      : result.singleCartonLimit
    : null;
  const progressSummary = useMemo(
    () => result ? summarizePackingProgress(result, packingProgress) : null,
    [packingProgress, result],
  );
  const cachedPracticalPlan = !dirty ? resultBundle?.strategyPlans?.practical : undefined;
  const cachedMaximumPlan = !dirty ? resultBundle?.strategyPlans?.maximum : undefined;
  const strategyLabel = (target: PackingStrategy, cached?: PackingResult) => {
    const plan = cached ?? (result?.strategy === target ? result : null);
    if (plan) return strategyDisplayLabel(plan);
    return result && status !== "working" ? tr("需重新计算", "Recalculate") : tr("等待计算");
  };
  const practicalPredictionDisplay = cachedPracticalPlan
    ? cachedPracticalPlan.mode === "single" && cachedPracticalPlan.setSummaries.length
      ? cachedPracticalPlan.setSummaries[0].loadedSets
      : cachedPracticalPlan.metrics.loadedCount
    : mode === "single" ? reversePlan.recommendedDisplay : null;
  const maximumPredictionDisplay = cachedMaximumPlan
    ? cachedMaximumPlan.mode === "single" && cachedMaximumPlan.setSummaries.length
      ? cachedMaximumPlan.setSummaries[0].loadedSets
      : cachedMaximumPlan.metrics.loadedCount
    : null;
  const selectedPredictionDisplay = strategy === "practical" ? practicalPredictionDisplay : maximumPredictionDisplay;
  const selectedCachedPlan = strategy === "practical" ? cachedPracticalPlan : cachedMaximumPlan;
  const selectedFeasibleRecommendation = feasibleRecommendation(reversePlan, selectedCachedPlan);
  const selectedPlanCartons = selectedCachedPlan?.metrics.loadedCount ?? selectedFeasibleRecommendation.totalCartons;
  const theoreticalGainDisplay = practicalPredictionDisplay !== null && maximumPredictionDisplay !== null
    ? maximumPredictionDisplay - practicalPredictionDisplay
    : null;
  const usesPracticalLowerBound = !!cachedMaximumPlan?.strategyComparison?.maximumUsesPracticalLowerBound;
  const comparisonNeedsSkuReview = !!result?.strategyComparison && result.strategyComparison.maximum.displayQuantity < result.strategyComparison.practical.displayQuantity;
  const resultPlanningDelta = result && result.mode === "single"
    ? resultLoadedDisplay - selectedFeasibleRecommendation.displayQuantity
    : 0;
  const selectedPredictionQuantities = mode === "single" && reversePlan.displayUnit === "set"
    ? activeProducts.map((item) => ({
        productId: item.id,
        sku: item.sku,
        suggestedQuantity: selectedFeasibleRecommendation.displayQuantity * normalizedUnitsPerSet(item),
      }))
    : mode !== "mixed" && selectedCachedPlan
      ? selectedCachedPlan.summaries.map((item) => ({ productId: item.productId, sku: item.sku, suggestedQuantity: item.loaded }))
      : reversePlan.quantities;

  const containerChoices = useMemo(() => [...TRANSPORT_PRESETS, ...customContainers], [customContainers]);
  const hasKnownContainer = containerChoices.some((item) => item.id === container.id);

  const updateContainer = (field: keyof ContainerSpec, value: number) => {
    setContainer(current=>{
      const next={...current,[field]:value};
      const match=containerChoices.find(p=>(["length","width","height","doorWidth","doorHeight","maxWeight"] as const).every(k=>p[k]===next[k]) && (p.loadingAccess??"rear")===(next.loadingAccess??"rear") && (p.baseHeight??0)===(next.baseHeight??0));
      return {...next,id:match?.id??"custom-draft",name:match?.name??tr("自定义柜型（未保存）")};
    });
    markDirty();
  };

  const selectPreset = (id: string) => {
    const preset = containerChoices.find((item) => item.id === id);
    if (!preset) return;
    clearNumericDraftErrors();
    setContainer({ ...preset });
    setPracticalTargetPercent(recommendedPracticalTarget(preset) * 100);
    markDirty();
  };

  const saveCustomContainer = () => {
    const name = customContainerName.trim();
    if (!name) {
      setStatus("error");
      setMessage(tr("请先填写自定义柜型名称。"));
      return;
    }
    const containerError = workflow === "pallet-only" ? null : validateContainerInput(container, clearance);
    if (containerError) {
      setStatus("error");
      setMessage(tt`无法保存柜型：${containerError}`);
      return;
    }
    if (customContainers.length >= 100) {
      setStatus("error");
      setMessage(tr("本机最多保存 100 个自定义柜型，请先删除不再使用的柜型。"));
      return;
    }
    const saved: ContainerSpec = { ...container, id: `custom-${Date.now()}`, name: name.slice(0, 120) };
    setCustomContainers((current) => [...current, saved]);
    setContainer(saved);
    setShowContainerSave(false);
    setCustomContainerName("");
    markDirty();
    setStatus("idle");
    setMessage(tt`已将“${name}”保存到本机柜型列表`);
  };

  const removeSelectedCustomContainer = () => {
    if (!container.id.startsWith("custom-") || container.id === "custom-draft") return;
    if (!window.confirm(tt`确认删除本机柜型“${container.name}”吗？`)) return;
    setCustomContainers((current) => current.filter((item) => item.id !== container.id));
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    markDirty();
    setMessage(tr("自定义柜型已删除，已切换到 40HQ 高柜"));
  };

  const updateProduct = (id: string, field: keyof ProductInput, value: string | number | boolean) => {
    setProducts((current) =>
      current.map((product) => {
        if (product.id !== id) return product;
        let nextValue: string | number | boolean = value;
        if (typeof value === "string") {
          if (["length", "width", "height", "weight"].includes(field)) {
            nextValue = clampNumber(value, 0, 0);
          } else if (field === "quantity") {
            nextValue = clampInteger(value, 0, 0, 1_000_000);
          } else if (field === "priority") {
            nextValue = clampInteger(value, 50, 0, 100);
          } else if (field === "maxStackLayers") {
            nextValue = clampInteger(value, 0, 0, 99);
          } else if (field === "unitsPerSet") {
            nextValue = clampInteger(value, 1, 1, 99);
          } else if (field === "sku") {
            nextValue = value.slice(0, 80);
          } else if (field === "name") {
            nextValue = value.slice(0, 200);
          } else if (field === "setCode") {
            nextValue = value.slice(0, 80);
          }
        }
        const updated = { ...product, [field]: nextValue };
        return ["length", "width", "height"].includes(field)
          ? { ...updated, declaredVolumeCbm: roundedCartonVolumeCbm(updated) }
          : updated;
      }),
    );
    markDirty();
  };

  const duplicateOrderRow = (id: string) => {
    if (hasPendingDimensionChanges || invalidNumericFields.size) return;
    try {
      const rows = copyOrderRows(inheritOrderDelivery(products,result?.delivery),id);
      if (rows.length>MAX_CSV_ROWS) throw Error(tr("订单行超过上限","Order-line limit exceeded"));
      setProducts(rows);
      setMode("mixed");
      if(workflow==="single-capacity")setLoadingWorkflow("direct");
      setProductPage(Math.floor((rows.length-1)/PRODUCT_PAGE_SIZE));
      setActiveOrderLine(null);
      markDirty();
    } catch(e) {
      setMessage(String(e instanceof Error?e.message:e));
    }
  };

  const beginDimensionEditTransaction = useCallback(() => {
    if (pendingDimensionChangesRef.current.size === 0) {
      // A running worker still represents the previously committed dimensions.
      // Stop it once, then keep that last verified plan visible while the user
      // moves through every length/width/height field.
      inputRevisionRef.current += 1;
      clearActiveCalculation();
      setStatus((current) => current === "working" ? "idle" : current);
      setIsPlaying(false);
    }
    setHasPendingDimensionChanges(true);
    setMessage(tr("尺寸录入中；完成所有长、宽、高并离开尺寸输入区后，统一提交完整箱规"));
  }, [clearActiveCalculation, setStatus, setMessage]);

  const stageProductDimension = useCallback((id: string, field: DimensionField, value: number) => {
    beginDimensionEditTransaction();
    const current = pendingDimensionChangesRef.current.get(id) ?? {};
    pendingDimensionChangesRef.current.set(id, { ...current, [field]: value });
    setPendingDimensionProducts(ids=>ids.has(id)?ids:new Set([...ids,id]));
  }, [beginDimensionEditTransaction]);

  const setDimensionFieldValidity = useCallback((id: string, field: DimensionField, valid: boolean) => {
    const fieldKey = `product:${id}:${field}`;
    setInvalidNumericFields((current) => {
      const hasField = current.has(fieldKey);
      if ((valid && !hasField) || (!valid && hasField)) return current;
      const next = new Set(current);
      if (valid) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
    if (!valid) {
      beginDimensionEditTransaction();
      if (!pendingDimensionChangesRef.current.has(id)) pendingDimensionChangesRef.current.set(id, {});
    }
  }, [beginDimensionEditTransaction]);

  const commitPendingDimensions = useCallback(() => {
    const pending = new Map(pendingDimensionChangesRef.current);
    pendingDimensionChangesRef.current.clear();
    setPendingDimensionProducts(current=>current.size?new Set():current);
    setHasPendingDimensionChanges(false);
    setIsEditingDimensions(false);
    if (!pending.size) return;

    setProducts((current) => current.map((product) => {
      const dimensions = pending.get(product.id);
      if (!dimensions || !Object.keys(dimensions).length) return product;
      const updated = { ...product, ...dimensions };
      return { ...updated, declaredVolumeCbm: roundedCartonVolumeCbm(updated) };
    }));
    markDirty();
    setMessage(tr("尺寸已一次性提交；完成第二步配置后，再统一计算方案。"));
  }, [markDirty, setMessage]);

  const handleDimensionFocusChange = useCallback((focused: boolean) => {
    if (dimensionBlurTimerRef.current !== null) {
      window.clearTimeout(dimensionBlurTimerRef.current);
      dimensionBlurTimerRef.current = null;
    }
    if (focused) {
      setIsEditingDimensions(true);
      return;
    }
    // Blur fires before the next input's focus event. Deferring one task keeps
    // tabbing/clicking across products and all three dimensions in one edit session.
    dimensionBlurTimerRef.current = window.setTimeout(() => {
      dimensionBlurTimerRef.current = null;
      commitPendingDimensions();
    }, 0);
  }, [commitPendingDimensions]);

  const addProduct = () => {
    setProducts((current) => [...current, createProduct(current.length)]);
    markDirty();
  };

  const addCartonSet = (cartonCount: number) => {
    clearNumericDraftErrors();
    const safeCount = Math.min(20, Math.max(2, Math.floor(cartonCount)));
    setProducts((current) => {
      const existing = mode === "single" ? [] : current;
      const setCode = nextSetCode(existing, safeCount);
      const components = Array.from({ length: safeCount }, (_, componentIndex) =>
        createSetComponent(existing.length + componentIndex, setCode, componentIndex, safeCount),
      );
      return mode === "single" ? components : [...existing, ...components];
    });
    setResultBundle(null);
    markDirty();
    setStatus("idle");
    setMessage(mode === "single"
      ? tt`已将当前单品设为 1 套 ${safeCount} 箱；请逐箱填写参数，系统会自动计算最大完整套数。`
      : tt`已新增 1 套 ${safeCount} 箱结构；请逐箱填写尺寸、重量和需求套数。`);
  };

  const addComponentToSet = (code: string) => {
    setProducts((current) => {
      const members = current.filter((product) => product.setCode?.trim() === code);
      const completeSets = summarizeSetInputs(members)[0]?.completeSets || 100;
      const component = createSetComponent(current.length, code, members.length, members.length + 1);
      return [...current, { ...component, quantity: Math.max(1, completeSets) }];
    });
    markDirty();
    setMessage(tt`已向套装 ${code} 增加一个箱型；套装箱数不设 5 箱上限。`);
  };

  const alignSet = (code: string) => {
    const summary = setInputSummaries.find((item) => item.setCode === code);
    setProducts((current) => alignSetQuantities(current, code));
    clearNumericDraftErrors();
    markDirty();
    setMessage(tt`套装 ${code} 已安全向下对齐为 ${summary?.completeSets ?? 0} 个完整套，未擅自增加订单数量。`);
  };

  const ungroupSet = (code: string) => {
    clearNumericDraftErrors();
    setProducts((current) => {
      if (mode === "single") {
        const first = current.find((product) => product.setCode?.trim() === code);
        return first ? [{ ...first, setCode: "", unitsPerSet: 1 }] : current;
      }
      return current.map((product) =>
        product.setCode?.trim() === code ? { ...product, setCode: "", unitsPerSet: 1 } : product,
      );
    });
    markDirty();
    setMessage(mode === "single"
      ? tt`已将 ${code} 恢复为单箱产品。`
      : tt`已取消 ${code} 的成套约束，相关 SKU 将按散箱计算。`);
  };

  const groupSelectedKit = () => {
    const selected=activeProducts.filter(p=>kitRows?.has(p.id));
    if(selected.length<2||hasPendingDimensionChanges||invalidNumericFields.size)return;
    const selectedCodes=new Set(selected.flatMap(p=>p.setCode?.trim()?[p.setCode.trim()]:[]));
    if(activeProducts.some(p=>!kitRows?.has(p.id)&&selectedCodes.has(p.setCode?.trim()??""))){
      setMessage(tr("请选中原套装的所有箱型，再合并。","Select every carton type in the existing kit before grouping."),"error");
      return;
    }
    const cartons=selected.reduce((n,p)=>n+(p.unitsPerSet??1),0);
    const existingCode=selected[0].setCode?.trim();
    const code=existingCode&&selected.every(p=>p.setCode?.trim()===existingCode)?existingCode:nextSetCode(products,cartons);
    const hadPrepared=!!preparedPalletLayout;
    setProducts(current=>current.map(p=>kitRows?.has(p.id)?{...p,setCode:code}:p));
    setPalletBuild(current=>({...current,oneKitPerPallet:true}));
    setPreparedPalletLayout(undefined);
    setKitRows(null);
    markDirty();
    setMessage(hadPrepared
      ? tr("已合并为一套一托，请重新生成托内布置。","Grouped as one kit per pallet. Regenerate the pallet layout.")
      : tr("已合并所选箱型。打托时每托放一整套。","Selected cartons grouped. Each pallet will take one complete kit."),"done");
  };

  const removeProduct = (id: string) => {
    clearNumericDraftErrors();
    setProducts((current) => (current.length <= 1 ? current : current.filter((item) => item.id !== id)));
    markDirty();
  };

  const loadSample = () => {
    clearActiveCalculation();
    setToolsOpen(false);
    setResultPane("view");
    setPreparedPalletLayout(undefined);
    setWorkflowStep(1);modePackagingDrafts.current={};setPalletSetupSpec("primary");setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    setSetupInvalid(false);
    setPalletRecipePending(false);
    setPreviewRuleDraft(null);
    setAutoCalculate(false);
    clearNumericDraftErrors();
    setLoadingWorkflow("palletized");
    setPalletBuild(demoPalletBuild());
    setLoadingRules({...DEFAULT_LOADING_RULES});
    setMode("mixed");
    strategyRef.current = "practical";
    setStrategy("practical");
    setTargetVolumePercent(85);
    setTargetWeightPercent(90);
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(structuredClone(DEMO_PRODUCTS));
    setProductPage(0);
    setResultBundle(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage(tr("已载入宽托装柜示例（含有限路径搜索）","Loaded the wide-pallet demo with bounded access search"));
    scrollTo("workspace", true);
  };

  const loadDimensionTest = () => {
    setPreparedPalletLayout(undefined);
    setWorkflowStep(1);modePackagingDrafts.current={};setPalletSetupSpec("primary");setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    clearNumericDraftErrors();
    setMode("mixed");
    setStrategy("practical");
    setTargetVolumePercent(85);
    setTargetWeightPercent(90);
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(DIMENSION_TEST_PRODUCTS.map((item) => ({ ...item })));
    setResultBundle(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage(tr("已载入你提供的 3 组 CM 尺寸；CBM 将由外箱尺寸自动计算到小数点后两位"));
  };

  const loadTwoCartonSetTest = () => {
    setWorkflowStep(1);modePackagingDrafts.current={};setPalletSetupSpec("primary");setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    clearNumericDraftErrors();
    setPreparedPalletLayout(undefined);
    setMode(isPalletWorkflow?"mixed":"single");
    if(isPalletWorkflow)setPalletBuild(current=>({...current,oneKitPerPallet:true}));
    setStrategy("practical");
    setTargetVolumePercent(85);
    setTargetWeightPercent(90);
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(TWO_CARTON_SET_PRODUCTS.map((item) => ({ ...item })));
    setResultBundle(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage(isPalletWorkflow?tr("已载入两箱套装，已启用一套一托。","Loaded a two-carton kit with one kit per pallet."):tr("已载入单品 1 套 2 箱：保持单品模式，自动计算最大完整套数，无需填写需求箱数"));
  };

  const loadMultiCartonSetTest = () => {
    setWorkflowStep(1);modePackagingDrafts.current={};setPalletSetupSpec("primary");setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    clearNumericDraftErrors();
    setPreparedPalletLayout(undefined);
    setMode(isPalletWorkflow?"mixed":"single");
    if(isPalletWorkflow)setPalletBuild(current=>({...current,oneKitPerPallet:true}));
    setStrategy("practical");
    setTargetVolumePercent(85);
    setTargetWeightPercent(90);
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(MULTI_CARTON_SET_PRODUCTS.map((item) => ({ ...item })));
    setResultBundle(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage(isPalletWorkflow?tr("已载入 120 套五箱装示例，已启用一套一托。","Loaded 120 five-carton kits with one kit per pallet."):tr("已载入单品 1 套 5 箱；保持单品模式，3 箱、4 箱及更多箱型使用同一通用算法。"));
  };

  const loadRealA64M = () => {
    setWorkflowStep(1);modePackagingDrafts.current={};setPalletSetupSpec("primary");setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    clearNumericDraftErrors();
    setMode("single");
    setStrategy("practical");
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setTargetVolumePercent(85);
    setTargetWeightPercent(90);
    setContainer({ ...CONTAINER_PRESETS[2] });
    setClearance(10);
    setProducts(REAL_WORLD_A64M_PRODUCTS.map((item) => ({ ...item })));
    setResultBundle(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage(tr("已载入真实 SLM-A64M：报价轨按已确认的 396 套展示，三维轨继续计算无重叠物理方案"));
  };

  const loadSuppliedRealRecord = (model: string) => {
    setWorkflowStep(1);modePackagingDrafts.current={};setPalletSetupSpec("primary");setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    const record = HISTORICAL_LOADING_RECORDS.find((item) => item.models.includes(model));
    if (!record) return;
    clearNumericDraftErrors();
    const setCodeValue = record.cartons.length > 1 ? `REAL-${model.replaceAll(/[^A-Za-z0-9]+/g, "-")}` : "";
    setMode("single");
    setStrategy("practical");
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setTargetVolumePercent(85);
    setTargetWeightPercent(90);
    setClearance(10);
    setProducts(record.cartons.map((carton, index) => ({
      id: `real-supplied-${index}-${carton.length}-${carton.width}-${carton.height}`,
      sku: record.cartons.length > 1 ? `REAL-${index + 1}` : "REAL-1CTN",
      name: `${tr(model)}${record.cartons.length > 1 ? tt` · 第 ${index + 1} 箱` : ""}`,
      ...carton,
      quantity: 1000,
      priority: 100,
      rotationPolicy: "upright",
      stackable: true,
      maxStackLayers: 0,
      mustLoad: true,
      bottomOnly: false,
      setCode: setCodeValue,
      unitsPerSet: 1,
      color: COLORS[index % COLORS.length],
    })));
    setResultBundle(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage(tt`已载入 ${tr(model)}；40HQ 历史实装 ${record.loadingSets["40hq"]} 套，计算后将同时显示历史预测与无重叠三维方案。`);
  };

  const validateInputs = useCallback(() => {
    if (invalidNumericFields.size) return tr("有数字输入尚未完成，请填写后再计算。");
    if (!activeProducts.length) return tr("请至少添加一个产品。");
    if(mode==="mixed"&&!activeProducts.some(p=>p.quantity>0))return tr("至少一种箱型的需求箱数应大于 0。","Enter a positive order quantity for at least one carton type.");
    const containerError = workflow === "pallet-only" ? null : validateContainerInput(container, clearance);
    if (containerError) return containerError;
    const invalid = activeProducts.find(
      (item) =>
        !item.sku.trim() ||
        ![item.length, item.width, item.height, item.weight, item.quantity, item.priority, item.maxStackLayers].every(Number.isFinite) ||
        item.length <= 0 ||
        item.width <= 0 ||
        item.height <= 0 ||
        item.weight < 0 ||
        !Number.isInteger(item.maxStackLayers) || item.maxStackLayers < 0 || item.maxStackLayers > 99 ||
        !Number.isInteger(item.priority) || item.priority < 0 || item.priority > 100 ||
        !["fixed", "upright", "any"].includes(item.rotationPolicy) ||
        (Boolean(item.setCode?.trim()) && (!Number.isInteger(item.unitsPerSet) || !item.unitsPerSet || item.unitsPerSet < 1 || item.unitsPerSet > 99)) ||
        (mode === "mixed" && (!Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 1_000_000)),
    );
    return invalid ? tt`${invalid.sku || tr("未命名产品")} 的尺寸、重量或数量不完整。` : null;
  }, [workflow,activeProducts, clearance, container, invalidNumericFields, mode]);

  const submitPacking = useCallback((payload: PackingRequest, workingMessage = tr("正在生成可行摆放并执行边界、重叠与载重校验…")) => {
    if (activeRequestRef.current) clearActiveCalculation();
    requestSequenceRef.current += 1;
    const requestId = `request-${inputRevisionRef.current}-${requestSequenceRef.current}`;
    activeRequestRef.current = requestId;
    activeRevisionRef.current = inputRevisionRef.current;
    workerResultsRef.current = {};
    const finishedStrategies = new Set<PackingStrategy>();
    const failedStrategies = new Map<PackingStrategy,string>();
    const runtimePolicy = { ...detectRuntimePolicy(), ...(calculationBudget ? { calculationTimeoutMs: calculationBudget * 1000 } : {}) };
    setSolverSchedule(runtimePolicy.schedule);
    setStatus("working");
    setMessage(runtimePolicy.schedule === "practical-first"
      ? tt`${workingMessage} 当前设备将先完成现场方案，再计算高密度参考。`
      : workingMessage);

    const failCalculation = (message: string) => {
      if (requestId !== activeRequestRef.current) return;
      clearActiveCalculation();
      setStatus("error");
      setMessage(message);
    };

    const completeWithAvailablePlan = (reason: string) => {
      if (requestId !== activeRequestRef.current) return false;
      const plans: NonNullable<PackingResult["strategyPlans"]> = {
        ...(workerResultsRef.current.practical?.validation.valid ? { practical: workerResultsRef.current.practical } : {}),
        ...(workerResultsRef.current.maximum?.validation.valid ? { maximum: workerResultsRef.current.maximum } : {}),
      };
      const selected = plans[strategyRef.current] ?? plans.practical ?? plans.maximum;
      if (!selected) return false;
      clearActiveCalculation();
      if (!plans[strategyRef.current]) {
        strategyRef.current = selected.strategy;
        setStrategy(selected.strategy);
      }
      setResultBundle({ ...selected, strategyPlans: plans });
      presentPlan(selected);
      setDirty(false);
      setStatus(selected.validation.valid ? "done" : "error");
      setMessage(selected.validation.valid
        ? tt`${trText(reason)} 已保留并显示${selected.strategy === "practical" ? tr("现场易执行") : tr("高密度参考")}方案，不影响三视图、3D 和导出。`
        : tt`可用方案未通过独立校验：${selected.validation.errors[0] ?? tr("请检查异常明细")}`);
      return true;
    };

    const armCalculationTimeout = () => {
      if (calculationTimeoutRef.current !== null) window.clearTimeout(calculationTimeoutRef.current);
      calculationTimeoutRef.current = window.setTimeout(() => {
        if (completeWithAvailablePlan(tr("后台算法达到设备保护时限，"))) return;
        failCalculation(tt`本次计算已超过 ${Math.round(runtimePolicy.calculationTimeoutMs / 1000)} 秒并自动停止。请减少 SKU/箱数，或分批测算。`);
      }, runtimePolicy.calculationTimeoutMs);
    };

    const startStrategyWorker = (solverStrategy: PackingStrategy, attempt = 0) => {
      if (requestId !== activeRequestRef.current) return;
      let worker = workersRef.current[solverStrategy];
      if (!worker) {
        try {
          worker = new Worker(new URL("../lib/packing/packing.worker.ts", import.meta.url), { type: "module" });
        } catch {
          failCalculation(tr("当前浏览器无法启动装柜计算线程，请刷新页面或升级浏览器后重试。"));
          return;
        }
        workersRef.current[solverStrategy] = worker;
      }
      let settled = false;

      const retryOrFail = (message: string) => {
        if (settled || requestId !== activeRequestRef.current || workersRef.current[solverStrategy] !== worker) return;
        settled = true;
        worker.terminate();
        delete workersRef.current[solverStrategy];
        if (attempt < 1) {
          setMessage(tt`${solverStrategy === "practical" ? tr("现场") : tr("高密度")}算法线程异常，正在自动重试一次…`);
          startStrategyWorker(solverStrategy, attempt + 1);
          return;
        }
        failedStrategies.set(solverStrategy,message);
        if(solverOutcome(finishedStrategies,failedStrategies,workerResultsRef.current)!=="waiting"){
          if (completeWithAvailablePlan(tt`${solverStrategy === "practical" ? tr("现场") : tr("高密度")}算法连续失败，`)) return;
          failCalculation(tt`${solverStrategy === "practical" ? tr("现场易执行") : tr("高密度参考")}算法连续两次失败：${trText(message)}`);return;
        }
        setMessage(tr("一套算法重试后仍失败，另一套继续独立计算；已校验方案会保留。","One solver failed after retry; the other continues independently. Validated plans will be retained."));
        if(runtimePolicy.schedule==='practical-first'&&solverStrategy==='practical'){armCalculationTimeout();startStrategyWorker('maximum');}
      };

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (settled || response.requestId !== requestId || requestId !== activeRequestRef.current) return;
        if (response.type === "error") {
          retryOrFail(response.message);
          return;
        }
        if (response.strategy !== solverStrategy) {
          retryOrFail(tr("计算线程返回了不匹配的策略结果。"));
          return;
        }
        if(response.type === "progress") {
          workerResultsRef.current[solverStrategy]=response.payload;
          setResultBundle({...response.payload,strategyPlans:{...workerResultsRef.current}});
          setDirty(false);
          if(strategyRef.current===solverStrategy)presentPlan(response.payload);
          setMessage(tr("已找到并校验首个可行方案，正在继续搜索；可随时停止保留。"));
          return;
        }
        settled = true;
        finishedStrategies.add(solverStrategy);
        workerResultsRef.current[solverStrategy] = response.payload;
        const other=solverStrategy==='practical'?'maximum':'practical';
        if(failedStrategies.has(other)){
          if(discardObsoleteCalculation())return;
          completeWithAvailablePlan(tr("另一套算法失败，","The other solver failed;"));return;
        }
        const practicalResult = workerResultsRef.current.practical;
        const maximumResult = workerResultsRef.current.maximum;
        if (!practicalResult || !maximumResult || !finishedStrategies.has("practical") || !finishedStrategies.has("maximum")) {
          if (discardObsoleteCalculation()) return;
          const partialBundle: PackingResult = {
            ...response.payload,
            strategyPlans: { ...workerResultsRef.current },
          };
          setResultBundle(partialBundle);
          setDirty(false);
          if (strategyRef.current === solverStrategy) presentPlan(response.payload);
          setStatus("working");
          setMessage(tt`${solverStrategy === "practical" ? tr("现场易执行") : tr("高密度参考")}方案已完成并可查看；另一套算法仍在后台独立计算…`);
          if (runtimePolicy.schedule === "practical-first" && solverStrategy === "practical") {
            armCalculationTimeout();
            maximumStartTimerRef.current = window.setTimeout(() => {
              maximumStartTimerRef.current = null;
              if (requestId !== activeRequestRef.current) return;
              setMessage(tr("现场方案已可使用；正在后台补算高密度参考，期间页面仍可操作。"));
              startStrategyWorker("maximum");
            }, runtimePolicy.maximumStartDelayMs);
          }
          return;
        }
        const combined = combineStrategyResults(practicalResult, maximumResult, strategyRef.current);
        acceptResult(
          combined,
          combined.metrics.loadedCount === 0 ? tr("双算法已完成，但未装入货物，请查看零装载原因。", "Both solvers finished without loading cargo; review the zero-load diagnosis.") : tt`现场与高密度双算法已并行完成，并通过${combined.validation.valid ? tr("独立校验") : tr("异常检查")}`,
        );
      };
      worker.onerror = () => retryOrFail(tr("计算线程加载或执行失败。"));
      worker.postMessage({ type: "pack-strategy", requestId, strategy: solverStrategy, payload });
    };

    armCalculationTimeout();
    startStrategyWorker("practical");
    if (runtimePolicy.schedule === "parallel") startStrategyWorker("maximum");
  }, [acceptResult, calculationBudget, clearActiveCalculation, discardObsoleteCalculation, presentPlan, setMessage]);

  const calculate = useCallback(() => {
    if (isEditingDimensions || hasPendingDimensionChanges) {
      setMessage(tr("尺寸尚未提交；完成所有长、宽、高并离开尺寸输入区后再统一计算"));
      return;
    }
    const error = validateInputs();
    if (error) {
      clearActiveCalculation();
      setStatus("error");
      setMessage(error);
      return;
    }
    if (mode === "single" && reversePlan.recommendedTotal <= 0) {
      clearActiveCalculation();
      setStatus("error");
      setMessage(tr("当前目标利用率无法倒推出有效装载量，请检查产品尺寸、重量与柜型。"));
      return;
    }
    submitPacking({
      workflow, palletBuild: isPalletWorkflow ? palletBuild : undefined,
      accessConfig: demoOrder&&workflow==="palletized"?DEMO_ACCESS:undefined,
      preparedPalletLayout: isPalletWorkflow ? preparedPalletLayout : undefined,
      floorPallets: isPalletWorkflow ? undefined : floorPallets, loadingRules,
      mode,
      strategy: "practical",
      practicalTargetUtilization: practicalTargetPercent / 100,
      singleCartonLimit: mode === "single" ? reversePlan.recommendedTotal : undefined,
      container,
      clearance,
      products: activeProducts,
    }, mode === "single"
      ? tt`正在实时重算现场与极限方案；计划上限 ${reversePlan.recommendedDisplay.toLocaleString()} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}…`
      : tr("正在实时重算双算法坐标，并执行边界、重叠与载重校验…"));
  }, [workflow,palletBuild,preparedPalletLayout,isPalletWorkflow,floorPallets,loadingRules, activeProducts, demoOrder, clearance, clearActiveCalculation, container, hasPendingDimensionChanges, isEditingDimensions, mode, practicalTargetPercent, reversePlan, submitPacking, validateInputs, setStatus, setMessage]);

  useEffect(() => {
    if (workflowStep !== 7 || manualRun || status === "working" || !autoCalculate || !hydrated || isEditingDimensions || hasPendingDimensionChanges) return;
    if (!dirty && resultBundle) return;
    const timer = window.setTimeout(calculate, AUTO_CALCULATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [workflowStep, manualRun, status, autoCalculate, calculate, dirty, hasPendingDimensionChanges, hydrated, isEditingDimensions, resultBundle]);

  useEffect(()=>{
    if (!manualRun || isEditingDimensions || hasPendingDimensionChanges) return;
    // Run after the step-2 draft transaction has committed, so workers receive
    // the complete configuration rather than the previous render's payload.
    const timer=window.setTimeout(()=>{setManualRun(0);calculate();},0);
    return ()=>window.clearTimeout(timer);
  },[manualRun,isEditingDimensions,hasPendingDimensionChanges,calculate]);

  const applyReversePlan = () => {
    if (reversePlan.recommendedTotal <= 0) {
      setStatus("error");
      setMessage(tr("当前目标利用率无法倒推出有效箱数，请检查产品尺寸、重量与柜型。"));
      return;
    }
    if (mode === "single") {
      calculate();
      return;
    }
    const suggestedByProduct = new Map(reversePlan.quantities.map((item) => [item.productId, item.suggestedQuantity]));
    const nextProducts = activeProducts.map((product) => ({
      ...product,
      quantity: suggestedByProduct.get(product.id) ?? 0,
    }));
    setProducts(nextProducts);
    rulesDraftRef.current=null;
    clearNumericDraftErrors();
    setMode("mixed");
    markDirty();
    setMessage(tt`已应用 ${reversePlan.recommendedTotal.toLocaleString()} 箱建议数量；请确认配置后开始计算。`);
  };

  const togglePackingPlayback = () => {
    const total = result?.placements.length ?? 0;
    if (!total) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (packingProgress >= total) setPackingProgress(0);
    setIsPlaying(true);
  };

  const movePackingProgress = (delta: number) => {
    const total = result?.placements.length ?? 0;
    if (!total) return;
    setIsPlaying(false);
    setPackingProgress((current) => Math.min(total, Math.max(0, current + delta)));
  };

  const printPlan = () => {
    if (!canExport) return;
    flushSync(() => {
      setIsPlaying(false);
      setToolsOpen(false);
      setWorkflowStep(7);
      setRenderPrintViews(true);
    });
    window.requestAnimationFrame(() => window.print());
  };

  const backupWorkspace = () => {
    if (hasPendingDimensionChanges || invalidNumericFields.size) {
      setMessage(tr("请先完成数字和尺寸录入，再备份工作区。"), "error");
      return;
    }
    const contents = serializeWorkspaceBackup(
      { palletLayerTemplates, workflow, palletBuild, preparedPalletLayout, floorPallets, loadingRules, mode, strategy, practicalTargetPercent, container, clearance, products, customContainers,
        targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit }, ENGINE_VERSION, dirty?null:result, resultBundle?.strategyPlans,
    );
    downloadFile(tt`装柜工作区_${new Date().toISOString().slice(0, 10)}.json`, contents, "application/json");
    setMessage(tr("工作区已导出，可跨设备恢复；已完成方案的箱位会在恢复时重新校验。"), "done");
  };

  const restoreWorkspace = async (file: File) => {
    const attempt = ++restoreAttempt.current;
    const revision = inputRevisionRef.current;
    setWorkspaceConfirmation(null);
    try {
      if (file.size > MAX_WORKSPACE_BYTES) throw new Error(tt`工作区备份不能超过 ${MAX_WORKSPACE_BYTES / 1024 / 1024} MB。`);
      const contents = await file.text();
      if (attempt !== restoreAttempt.current) return;
      const restored = parseWorkspaceBackup(contents);
      const restoredPlan = restoreWorkspacePlans(contents, restored);
      if (revision !== inputRevisionRef.current || pendingDimensionChangesRef.current.size > 0) {
        throw new Error(tr("读取文件期间输入发生变化，请完成录入后重新选择备份。"));
      }
      const description=tt`恢复包含 ${restored.products.length} 个箱型的工作区？当前输入将被替换。${restoredPlan ? tr("已保存箱位通过当前规则校验，将一并恢复。") : tr("恢复输入后，请核对配置并重新计算。","After restoring the inputs, review the configuration and calculate again.")}`;
      const apply=()=>{
      if(revision!==inputRevisionRef.current||pendingDimensionChangesRef.current.size>0){setMessage(tr("当前输入已变化，请重新选择需要恢复的工作区。"), "error");return;}
      clearActiveCalculation();
      clearNumericDraftErrors();
      palletDraftRef.current = null;
      rulesDraftRef.current = null;
      setSetupInvalid(false);
      setPalletRecipePending(false);
      setPreviewRuleDraft(null);
      setToolsOpen(false);
        setResultPane("view");
      modePackagingDrafts.current={};
      setPalletSetupSpec("primary");
      setLoadingWorkflow(parseLoadingWorkflow(restored.workflow,restored.mode));
      setPalletLayerTemplates(restored.palletLayerTemplates??[]);
      setPalletBuild(restored.palletBuild ?? structuredClone(DEFAULT_PALLET_BUILD));
      setPreparedPalletLayout(restored.preparedPalletLayout);
      setFloorPallets(restored.floorPallets);
      setLoadingRules(restored.loadingRules ?? {...DEFAULT_LOADING_RULES});
      setMode(restored.mode);
      strategyRef.current = restored.strategy;
      setStrategy(restored.strategy);
      setPracticalTargetPercent(restored.practicalTargetPercent);
      setContainer(restored.container);
      setClearance(restored.clearance);
      setProducts(normalizeProductList(restored.products));
      setCustomContainers(restored.customContainers);
      setTargetVolumePercent(restored.targetVolumePercent);
      setTargetWeightPercent(restored.targetWeightPercent);
      setLengthUnit(restored.lengthUnit);
      setWeightUnit(restored.weightUnit);
      setProductPage(0);
      setResultBundle(null);
      markDirty();
      setStatus("idle");
      if (restoredPlan) {
        setAutoCalculate(false);
        strategyRef.current=restoredPlan.strategy;
        setStrategy(restoredPlan.strategy);
        setWorkflowStep(7);
        setResultBundle(restoredPlan);
        setDirty(false);
        presentPlan(restoredPlan);
        setStatus("done");
        setMessage(tr("已恢复并重新校验历史箱位、锁定标记与输入参数；自动重算已暂停。"));
        scrollTo("result", true);
      } else {
        setAutoCalculate(false);
        setWorkflowStep(1);
        setMessage(tr("已恢复工作区输入，请确认货物与装载配置后计算。"), "done");
        scrollTo("workspace", true);
      }
      };
      setWorkspaceConfirmation({kind:"restore",description,fileName:file.name,apply});
    } catch (error) {
      if (attempt !== restoreAttempt.current) return;
      setMessage(error instanceof SyntaxError
        ? tr("文件无法解析。请选择有效的工作区备份 JSON。","The file could not be read. Choose a valid workspace backup JSON.")
        : error instanceof Error ? error.message : tr("工作区恢复失败，当前输入未修改。"), "error");
    }
  };

  const exportJson = () => {
    if (!canExport || !result) return;
    const selectedPlanOnly = { ...result, strategyPlans: undefined };
    downloadFile(
      tt`装柜方案_${result.container.id}_${result.strategy}_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(selectedPlanOnly, null, 2),
      "application/json",
    );
  };

  const exportCsv = () => {
    if (!canExport || !result) return;
    downloadFile(tt`装柜坐标_${result.container.id}.csv`, `\uFEFF${buildPlacementCsv(result)}`, "text/csv;charset=utf-8");
  };

  const downloadTemplate = () => {
    const lines = [
      "sku,name,length,width,height,lengthUnit,weight,weightUnit,quantity,priority,setCode,unitsPerSet,rotationPolicy,stackable,maxStackLayers,mustLoad,bottomOnly,color,maxTopLoadKg,topLoadLengthKg,topLoadWidthKg,topLoadHeightKg,allowedAboveSkus,cargoType,allowedOrientations,minimumSupportRatio,palletBaseHeight,cargoShape,shapeAxis,shapeTopRatio,shapeWallRatio,shapeWallHeightRatio,shapeStepLengthRatio,shapeStepHeightRatio,solidModel,protectionGap,longSupport,orderLineId,orderReference,orderLineReference,batch,customer,destination,unloadStop",
      tr("SET5-A-128,五箱套装A箱,1280,540,110,mm,40,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#2f7f89"),
      tr("SET5-B-068,五箱套装B箱,680,540,110,mm,14,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#a95e78"),
      tr("SET5-C-103,五箱套装C箱,1030,620,120,mm,30,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#d5a72f"),
      tr("SET5-D-052,五箱套装D箱,520,350,180,mm,12,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#6b72a9"),
      tr("SET5-E-090,五箱套装E箱,900,420,140,mm,18,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#609d62"),
    ];
    downloadFile(tr("拼柜导入模板.csv"), `\uFEFF${lines.join("\n")}`, "text/csv;charset=utf-8");
  };

  const importCsv = async (file: File) => {
    if (file.size > MAX_CSV_BYTES) {
      setMessage(tt`CSV / Excel 文件不能超过 ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB。`, "error");
      return;
    }
    try {
      const importRevision = inputRevisionRef.current,importActionRevision=orderImportRevisionRef.current;
      const excel=file.name.toLowerCase().endsWith(".xlsx");
      const parsed=orderImportMode==="quantity"?undefined:excel?await importSpreadsheet(file,COLORS):parseProductsCsv(await file.text(),COLORS);
      const updates=orderImportMode!=="quantity"?undefined:excel?await (await import("../lib/packing/spreadsheet")).parseSpreadsheetQuantities(await file.arrayBuffer()):parseOrderQuantityCsv(await file.text());
      if (importRevision !== inputRevisionRef.current || importActionRevision!==orderImportRevisionRef.current || pendingDimensionChangesRef.current.size > 0) throw new Error(tr("导入期间输入发生变化，请完成录入后重新导入。"));
      const inherited=inheritOrderDelivery(products,result?.delivery);
      const next=updates?updateOrderQuantities(inherited,updates):importOrderRows(inherited,parsed!,orderImportMode as "replace"|"append");
      assertOrderReferences(next,palletBuild,container);
      const importedMode = orderImportMode==="replace"&&!isPalletWorkflow?inferImportedPackingMode(next):"mixed";
      clearNumericDraftErrors();
      if(importedMode==="mixed"&&workflow==="single-capacity")setLoadingWorkflow("direct");
      setProducts(next);
      setMode(importedMode);
      setResultBundle(null);
      markDirty();
      setStatus("idle");
      setMessage(orderImportMode==="quantity"?tr("已按稳定 ID 更新数量，箱规、客户、批次和包装规则保留。","Quantities updated by stable ID; dimensions, customer, batch and packaging rules are preserved."):orderImportMode==="append"?tr("已追加新订单行并生成新 ID，请核对数量和套装编码。","New order rows appended with new IDs; review quantities and kit codes."):importedMode === "single"
        ? tt`已识别同一套装编码，按单品多箱模式导入 ${next.length} 个箱型；将直接计算完整套数`
        : tt`已导入 ${next.length} 个 SKU，请检查后计算`, "done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr("CSV 读取失败，请检查文件后重试。"), "error");
    }
  };

  const toggleProductVisibility = (id: string) => {
    setVisibleProducts((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectOrthographicView = (view: "top" | "side" | "door") => {
    setCameraProjection("orthographic");
    setCameraView(view);
  };

  const revealDetails = (target: Element) => {
    let disclosure=target.closest("details");
    while(disclosure){disclosure.open=true;disclosure=disclosure.parentElement?.closest("details")??null;}
  };

  const scrollTo = (id: string, focusDestination = false) => {
    if(id==="result"||id==="loading-diagnosis")setResultPane("view");
    if(id==="plan-review"||id==="load-summary")setResultPane("review");
    if(id==="coordinates"||id==="loaded-pallets")setResultPane("exports");
    window.requestAnimationFrame(()=>{
      const target=document.getElementById(id);
      if(!target)return;
      revealDetails(target);
      const records=target.querySelector<HTMLDetailsElement>(":scope > details.record-disclosure");
      if(records)records.open=true;
      const focus = id === "pallet-recipe" ? document.getElementById("pallet-recipe-count")
        : id === "coordinates" ? target
        : focusDestination ? target.querySelector<HTMLElement>("h2,h3") ?? target : null;
      if (focus) {
        if (focus.tabIndex < 0) {
          focus.tabIndex = -1;
          focus.dataset.workspaceDestination = "";
        }
        focus.focus({ preventScroll: true });
      }
      target.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"});
    });
  };
  useEffect(() => {
    const selector = 'details:is([name="workspace-menus"],[name="order-menus"],.plan-calculation-menu)[open]';
    const dismissOutside = (event: Event) => {
      if (!(event.target instanceof Node)) return;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(selector)) {
        if (!menu.contains(event.target)) menu.open = false;
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !(event.target instanceof Element)) return;
      const menu = event.target.closest<HTMLDetailsElement>(selector);
      if (!menu) return;
      event.preventDefault();
      menu.open = false;
      menu.querySelector("summary")?.focus({preventScroll:true});
    };
    document.addEventListener("pointerdown",dismissOutside);
    document.addEventListener("focusin",dismissOutside);
    document.addEventListener("keydown",dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown",dismissOutside);
      document.removeEventListener("focusin",dismissOutside);
      document.removeEventListener("keydown",dismissOnEscape);
    };
  }, []);
  const stopCalculation = () => {
    const plans = { ...workerResultsRef.current };
    const selected = plans[strategyRef.current] ?? plans.practical ?? plans.maximum;
    const currentRevision = activeRevisionRef.current === inputRevisionRef.current;
    clearActiveCalculation();
    setAutoCalculate(false);
    if (selected && currentRevision && selected.validation.valid) {
      strategyRef.current = selected.strategy;
      setStrategy(selected.strategy);
      setResultBundle({ ...selected, strategyPlans: plans });
      presentPlan(selected);
      setDirty(false);
      setStatus("done");
      setMessage(tr("已停止后续计算并保留已完成方案；当前切换为手动计算。"));
    } else {
      setStatus("idle");
      setMessage(tr("已停止计算；尚未完成的搜索不会被当作可用方案。点击“计算方案”可重新开始。"));
    }
  };
  const replaceProductInputs = (nextProducts: ProductInput[]) => {
    clearNumericDraftErrors();
    setProducts(normalizeProductList(nextProducts));
    setProductPage(0);
    markDirty();
  };
  const workspaceBackup = useMemo(() => serializeWorkspaceBackup({palletLayerTemplates,workflow,palletBuild,preparedPalletLayout,floorPallets,loadingRules,mode,strategy,practicalTargetPercent,container,clearance,products,customContainers,targetVolumePercent,targetWeightPercent,lengthUnit,weightUnit},ENGINE_VERSION,dirty?null:result,resultBundle?.strategyPlans), [palletLayerTemplates,workflow,palletBuild,preparedPalletLayout,floorPallets,loadingRules,mode,strategy,practicalTargetPercent,container,clearance,products,customContainers,targetVolumePercent,targetWeightPercent,lengthUnit,weightUnit,dirty,result,resultBundle?.strategyPlans]);
  const upgradesDisabled = hasPendingDimensionChanges || isEditingDimensions || invalidNumericFields.size > 0 || status === "working";
  const capacityRequest: PackingRequest = {workflow,palletBuild:isPalletWorkflow?palletBuild:undefined,floorPallets:isPalletWorkflow?undefined:floorPallets,loadingRules,mode,strategy,practicalTargetUtilization:practicalTargetPercent/100,container,clearance,products:activeProducts};
  const applyCapacityStock=(next:ProductInput[])=>{if(result?.deliveryIdentity||hasManualPreparation)return;clearActiveCalculation();setAutoCalculate(false);setProducts(next);clearNumericDraftErrors();rulesDraftRef.current=null;markDirty();setToolsOpen(false);setResultPane("view");setWorkflowStep(7);setManualRun(value=>value+1);};
  const applyPalletBuildTrial=(next:PalletBuildOptions)=>{if(result?.deliveryIdentity||hasManualPreparation)return;clearActiveCalculation();setAutoCalculate(false);setPalletBuild(next);persistDraft({palletBuild:next});clearNumericDraftErrors();palletDraftRef.current=null;rulesDraftRef.current=null;markDirty();setToolsOpen(false);setResultPane("view");setWorkflowStep(7);setManualRun(value=>value+1);};
  const palletPreviewRequest = previewRuleDraft ? {...capacityRequest, loadingRules:previewRuleDraft.rules, products:selectProductsForMode(previewRuleDraft.products,mode)} : capacityRequest;
  const changePreparedLayout=(layout:PreparedPalletLayout|undefined)=>{
    setPreparedPalletLayout(layout);
    markDirty();
    persistDraft({preparedPalletLayout:layout});
    if(layout)setMessage(tr("已采用托内布置，开始计算时将使用这些箱位。","Pallet layout applied. Calculation will use these carton positions."));
  };
  const changePalletBuild=(next:PalletBuildOptions)=>{
    setPalletBuild(next);
    if(preparedPalletLayout&&(!!next.oneKitPerPallet!==!!palletBuild.oneKitPerPallet||JSON.stringify(next.looseQuantities)!==JSON.stringify(palletBuild.looseQuantities))){
      setPreparedPalletLayout(undefined);
      setMessage(tr("货物分配或每托套数已更改，请重新生成托内布置。","Cargo allocation or kit rule changed. Regenerate the pallet layout."));
    }
    markDirty();
  };
  const adoptDeliveryVersion=(next:PackingResult)=>{
    if(result?.deliveryIdentity&&next.deliveryIdentity?.planId===result.deliveryIdentity.planId){const id=result.deliveryIdentity,known=fieldRecordsRef.current.get(`${id.planId}/${id.revisionId}`)??readVersionFieldRecords(id,localStorage),prior=id.previousRevisionId?(fieldRecordsRef.current.get(`${id.planId}/${id.previousRevisionId}`)??readRevisionFieldRecords({planId:id.planId,revisionId:id.previousRevisionId},localStorage)):null;requireKnownFieldHandover(result,known,prior);guardFieldRevision(result,next,known);}
    const inputs=parseWorkspaceBackup(workspaceBackup);
    const backup=serializeWorkspaceBackup(inputs,ENGINE_VERSION,next,{[next.strategy]:next});
    downloadFile(`delivery-${next.deliveryIdentity!.planId}-v${next.deliveryIdentity!.revision}.json`,backup,"application/json");
    clearActiveCalculation();setAutoCalculate(false);setResultBundle(next);setDirty(false);presentPlan(next);setStatus("done");
    setMessage(tr("交付版本已登记并发起下载；请确认文件已保存，或显示版本备份文本。修改后重新发布版本。","Delivery version issued and download started. Confirm the file was saved, or show the version backup text. Issue a new revision after edits."));
  };
  const adoptManualPlan=(next:PackingResult)=>{const rows=adoptOrderDelivery(products,next.delivery??result?.delivery);setProducts(rows);next={...next,cargoDetails:Object.fromEntries(rows.filter(p=>next.summaries.some(s=>s.productId===p.id)).map(p=>[p.id,shapeDetails(p)])),delivery:orderDelivery(rows.filter(p=>next.summaries.some(s=>s.productId===p.id)),next.delivery??result?.delivery),accessConfig:next.accessConfig??result?.accessConfig,handlingTasks:next.handlingTasks??result?.handlingTasks};clearActiveCalculation();setAutoCalculate(false);setResultBundle(next);setDirty(false);presentPlan(next);setStatus("done");setMessage(tr("已采用手动方案，三维、指标和导出已同步；自动重算已暂停。"));};
  const adoptLoadedLocks=(records:FieldRecords)=>{if(!result)return;const id=result.deliveryIdentity!,prior=id.previousRevisionId?(fieldRecordsRef.current.get(`${id.planId}/${id.previousRevisionId}`)??readRevisionFieldRecords({planId:id.planId,revisionId:id.previousRevisionId},localStorage)):null;requireKnownFieldHandover(result,records,prior);const next=lockLoadedFieldPositions(result,records,activeProducts);clearActiveCalculation();setAutoCalculate(false);setResultBundle(next);setDirty(false);presentPlan(next);setStatus("done");setMessage(tr("已锁定已装箱位；可调整其余货物，登记下一版后明确迁移现场记录。","Loaded positions locked. Edit the remaining cargo, issue the next revision, then explicitly carry over field records."));};

  const planEditor=usePlanEditor(result,activeProducts,upgradesDisabled||!result?.validation.valid||result.metrics.loadedCount!==result.placements.length,adoptManualPlan);
  const fleetRequest: PackingRequest = {delivery:orderDelivery(activeProducts,Object.fromEntries(Object.entries(result?.delivery??{}).filter(([id])=>activeProducts.some(p=>p.id===id&&!p.orderLine)))),accessConfig:result?.accessConfig??(demoOrder&&workflow==="palletized"?DEMO_ACCESS:undefined), floorPallets, loadingRules, mode, strategy, practicalTargetUtilization: practicalTargetPercent / 100, container, clearance, products: activeProducts };

  const downloadExcelTemplate = async () => { setMessage(tr("正在生成 Excel 模板…")); try { const { createSpreadsheetTemplate } = await import("../lib/packing/spreadsheet"); const bytes=await createSpreadsheetTemplate(); const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));const a=document.createElement("a");a.href=url;a.download="CargoFit_products_template.xlsx";document.body.appendChild(a);a.click();a.remove();setMessage(tr("Excel 模板已生成。"), "done");setTimeout(()=>URL.revokeObjectURL(url),10000); } catch(e) {setMessage(e instanceof Error?e.message:tr("Excel 模板导出失败。","The Excel template could not be exported."), "error");} };
  const downloadPdf = async () => { if(!result?.validation.valid||resultAudit?.hasErrors||dirty||hasPendingDimensionChanges)return;setExportingPdf(true);try{const {downloadPdfGuide}=await import("../lib/packing/pdf-guide");await downloadPdfGuide(result,getAppLanguage(),activeProducts);}catch(e){setMessage(e instanceof Error?e.message:tr("PDF 导出失败。","The PDF could not be exported."), "error");}finally{setExportingPdf(false);} };
  const loadIndustryCase = (example: IndustryCase) => {setToolsOpen(false);setPreparedPalletLayout(undefined);setWorkflowStep(1);modePackagingDrafts.current={};setPalletSetupSpec("primary");palletDraftRef.current=null;rulesDraftRef.current=null;clearNumericDraftErrors();setMode("mixed");setLoadingWorkflow("direct");setContainer({...example.container});setProducts(example.products.map(p=>({...p})));setFloorPallets(undefined);setLoadingRules({...DEFAULT_LOADING_RULES});setClearance(10);setProductPage(0);setAutoCalculate(false);setPracticalTargetPercent(recommendedPracticalTarget(example.container)*100);markDirty();scrollTo("workspace");};

  const receivePalletDraft=useCallback((value:FloorPalletConfig|undefined,invalid:boolean)=>{
    const previous=palletDraftRef.current;
    if(previous && (JSON.stringify(previous.value)!==JSON.stringify(value)||previous.invalid!==invalid)) markDirty();
    palletDraftRef.current={value,invalid};setSetupInvalid(invalid);
  },[markDirty]);
  const receiveRulesDraft=useCallback((rules:LoadingRules,nextProducts:ProductInput[])=>{
    const previous=rulesDraftRef.current;
    if(previous && (JSON.stringify(previous.rules)!==JSON.stringify(rules)||JSON.stringify(previous.products)!==JSON.stringify(nextProducts))) markDirty();
    rulesDraftRef.current={rules,products:nextProducts};
    if (isPalletWorkflow) setPreviewRuleDraft(current=>current?.rules===rules&&current.products===nextProducts?current:{rules,products:nextProducts});
  },[isPalletWorkflow,markDirty]);
  const commitSetup=()=>{
    const base=palletDraftRef.current;
    const rules=rulesDraftRef.current;
    if(base?.invalid){setMessage(tr("托盘参数尚未完成，请先修正。"));return false;}
    const patch={floorPallets:base?base.value:floorPallets,loadingRules:rules?.rules??loadingRules,products:rules?.products??products};
    setFloorPallets(patch.floorPallets);setLoadingRules(patch.loadingRules);setProducts(patch.products);persistDraft(patch);
    return true;
  };
  const selectWorkflow=(next:LoadingWorkflow)=>{
    if(workflow===next)return;
    commitPendingDimensions();
    clearNumericDraftErrors();
    palletDraftRef.current=null;
    setSetupInvalid(false);
    if(workflow==="palletized"||workflow==="pallet-only")modePackagingDrafts.current[workflow]={build:palletBuild,layout:preparedPalletLayout};
    if(next==="palletized"||next==="pallet-only"){
      if(next==="pallet-only"&&!modePackagingDrafts.current.palletized&&workflow!=="pallet-only")modePackagingDrafts.current.palletized={build:palletBuild};
      const saved=modePackagingDrafts.current[next];
      const shared=palletBuild;
      setPalletBuild(saved?.build??(next==="pallet-only"?palletOnlyDefaults(shared):shared));
      setPreparedPalletLayout(saved?.layout);
    }
    setLoadingWorkflow(next);
    setMode(next==="single-capacity"?"single":"mixed");
    markDirty();
  };
  const goToStep=(step:WorkflowStep,anchor?:string,focusDestination=false)=>{
    setToolsOpen(false);
    if(step>workflowStep+1){
      setMessage(tr("请按顺序完成当前步骤。","Complete the steps in order."));
      return false;
    }
    if(step===7&&step!==workflowStep)setResultPane("view");
    if(step===workflowStep){
      if(anchor) window.requestAnimationFrame(()=>scrollTo(anchor,focusDestination));
      return true;
    }
    if(step===7&&!result){setMessage(tr("请在「核对计算」开始计算。","Start the calculation in Review."));return false;}
    if(step>workflowStep&&invalidNumericFields.size){setMessage(tr("请先修正标红的输入。","Correct the highlighted inputs to continue."));return false;}
    if(step>workflowStep){
      if(workflowStep===1&&workflow!=="pallet-only"){
        const issue=validateContainerInput(container,clearance);
        if(issue){setMessage(issue,"error");return false;}
      }
      if(workflowStep===3){
        const issue=validateInputs();
        if(issue){setMessage(issue,"error");return false;}
      }
      if(workflowStep===4&&isPalletWorkflow&&(palletRecipePending||!palletPreviewReady)){
        setMessage(tr("请先完成并核对打托预览。","Complete and check the pallet preview first."));
        return false;
      }
    }
    if(workflowStep>=2&&workflowStep<=5){
      if(!palletDraftRef.current?.invalid)commitSetup();
      else if(step>workflowStep){setMessage(tr("请先修正底层托盘参数。","Correct the floor pallet settings to continue."));return false;}
    }
    if(step!==7&&status==="working"){clearActiveCalculation();setStatus("idle");setMessage(tr("已暂停计算，可继续修改配置。"));}
    if(step<workflowStep&&invalidNumericFields.size)clearNumericDraftErrors();
    palletDraftRef.current=null;rulesDraftRef.current=null;setSetupInvalid(false);setPreviewRuleDraft(null);
    if(step===4)setPalletPreviewReady(false);
    if(workflowStep===3)setKitRows(null);
    setWorkflowStep(step);
    window.requestAnimationFrame(()=>{
      if(anchor) scrollTo(anchor,focusDestination);
      else document.querySelector(".wizard-steps")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
    return true;
  };
  const tutorialAction = (target: GuideTarget): string|undefined => {
    if(target==="files"||target==="account"){
      window.requestAnimationFrame(()=>{
        if(target==="account") accountButton.current?.click();
        else if(fileMenu.current) {
          fileMenu.current.open = true;
          fileMenu.current.querySelector("summary")?.focus();
        }
      });
      return;
    }
    if(target==="projects"||target==="loading"||target==="delivery"){
      setToolGroup(target);
      setToolsOpen(true);setToolsVisited(true);
      scrollTo("workflow-tools",true);
      return;
    }
    if(workflowStep===4&&palletRecipePending){
      return tr("请先回到配置页，采用或取消本次打托预览。","Apply or cancel the pending pallet preview in setup first.");
    }
    if((target==="recipe"||target==="packaging"||target==="pallet-preview")&&!isPalletWorkflow){
      return tr("请先在「选柜型」选择「先打托再装柜」或「只打托」。","Choose Palletize then load or Palletize only under Container first.");
    }
    if(target==="planning-targets"&&workflow==="pallet-only"){
      return tr("在「选柜型」选择包含装柜的装载方式后，可设置体积和载重目标。","Choose a container loading method to set volume and payload targets.");
    }
    const destinations = {
      products:[3,"products"], setup:[1,"workspace"], recipe:[4,preparedPalletLayout?"pallet-build-preview":"pallet-recipe"],
      "pallet-preview":[4,"pallet-build-preview"],
      packaging:[2,"packaging-settings"], rules:[5,"loading-rules"], "planning-targets":[5,"planning-targets"], review:[7,"result"],
      checks:[7,"plan-review"], pallets:[7,"loaded-pallets"], coordinates:[7,"coordinates"],
    } as const;
    const [step,anchor] = destinations[target];
    if(step===7&&(!result||target==="pallets"&&!result.pallets?.length&&!result.palletization?.looseQuantities)){
      return target==="pallets"
        ? tr("先计算包含托盘的方案，再打开整托清单。","Calculate a plan with pallet loads first.")
        : tr("先在「核对计算」计算方案，再查看结果。","Calculate the load plan in Review first.");
    }
    if(!goToStep(step,anchor,true)) return tr("请先完成工作区内待修正的输入。","Complete the highlighted workspace inputs first.");
  };
  const startConfiguredCalculation=()=>{
    if(workflowStep!==6)return;
    if(palletRecipePending){setMessage(tr("请先采用或取消本次打托预览。","Apply or cancel the pending pallet preview first."));return;}
    if(!commitSetup())return;
    const error=validateInputs();
    if(error){setStatus("error");setMessage(error);return;}
    setResultPane("view");setWorkflowStep(7);setAutoCalculate(false);setManualRun(v=>v+1);
    window.requestAnimationFrame(()=>document.querySelector('.wizard-steps')?.scrollIntoView({behavior:"smooth",block:"start"}));
  };
  const canExport = Boolean(result?.validation.valid && result.metrics.loadedCount > 0 && !resultAudit?.hasErrors && !dirty && !hasPendingDimensionChanges);
  const planDownloadBlock = canExport ? undefined
    : status==="working" ? tr("方案正在计算，完成后可打印或导出。", "The plan is calculating. Print and export become available when it is ready.")
    : !result ? tr("先计算装柜方案，即可打印或导出。", "Calculate a load plan to print or export it.")
    : dirty || hasPendingDimensionChanges ? tr("输入已修改，重新计算后可导出。", "Recalculate after editing to export the plan.")
    : tr("方案通过校验且有装入货物后可导出。", "Export is available for a validated plan with loaded cargo.");
  const noticeStatus = notice.status ?? status;
  const workStatus = <section className="status-strip" data-status={noticeStatus} aria-live="polite">
    <div className={`status-dot status-${noticeStatus}`} />
    <span>{trText(notice.text)}</span>
    {noticeStatus === "working" ? <LoaderCircle size={16} className="spin" /> : noticeStatus === "done" ? <CheckCircle2 size={16} /> : noticeStatus === "error" ? <CircleAlert size={16} /> : null}
  </section>;
  const needsPalletRecipe = mode==="mixed"&&workflow==="palletized"&&!preparedPalletLayout&&!dirty&&!result?.deliveryIdentity&&!result?.pallets?.some(p=>p.measuredEnvelope)&&
    oneLayerPalletCeilings(capacityRequest,result).some(s=>palletSpecifications(palletBuild).some(spec=>spec.id===s.id));
  const recalculatePlan=()=>{
    if(needsPalletRecipe){
      setMessage(tr("当前尺寸只能放一层。请在下方确认打托预览，再点击“采用此打托并重新计算”。","Current dimensions allow only one layer. Review the pallet preview below and apply it to recalculate."));
      document.getElementById("pallet-recipe")?.scrollIntoView({block:"center",behavior:"smooth"});
      document.getElementById("pallet-recipe-count")?.focus({preventScroll:true});
      return;
    }
    setManualRun(v=>v+1);
  };
  const capacityTrial=mode==="mixed"&&workflow!=="pallet-only"?<OrderCapacityTrial request={capacityRequest} plan={dirty?null:result} measuredEnvelope={!!result?.pallets?.some(p=>p.measuredEnvelope)} volume={targetVolumePercent/100} weight={targetWeightPercent/100} disabled={upgradesDisabled||setupInvalid} canApply={!result?.deliveryIdentity&&!hasManualPreparation}
    adoptionBlockedReason={hasManualPreparation?tr("当前使用人工托内布置。恢复自动打托后可采用试算结果。","The manual pallet layout is active. Return to automatic palletizing to adopt trial results."):undefined}
    onApply={applyCapacityStock} onApplyBuild={applyPalletBuildTrial} onRecalculateCurrent={()=>setManualRun(v=>v+1)} onDesignPallet={(specId,patch)=>{
    if(hasManualPreparation)return;
    if(patch){const next=withPalletRecipe(palletBuild,specId,patch);setPalletBuild(next);persistDraft({palletBuild:next});markDirty();}
    setPalletSetupSpec(specId);
    goToStep(4,"pallet-recipe");
  }}/>:null;
  const openLoadDiagnosis=()=>{
    if(result?.palletization&&capacityTrial){scrollTo("loading-diagnosis");return;}
    setToolGroup("loading");
    setToolsOpen(true);setToolsVisited(true);
    scrollTo("unloaded-reasons");
  };

  return (
    <main className="app-shell compact-workspace cargo-workbench" data-workflow-step={workflowStep}>
      {workspaceConfirmation && <FeatureDialog
        title={workspaceConfirmation.kind==="restore" ? tr("确认恢复工作区") : tr("载入示例？", "Load the example?")}
        onClose={()=>setWorkspaceConfirmation(null)}
        footer={<>
          <button type="button" className="button" data-dialog-autofocus onClick={()=>setWorkspaceConfirmation(null)}>{workspaceConfirmation.kind==="restore" ? tr("取消恢复") : tr("取消")}</button>
          <button type="button" className="button primary" onClick={()=>{
            setWorkspaceConfirmation(null);
            workspaceConfirmation.apply();
          }}>{workspaceConfirmation.kind==="restore" ? tr("确认恢复") : tr("载入示例")}</button>
        </>}>
        {workspaceConfirmation.fileName && <p className="workspace-confirm-file">{workspaceConfirmation.fileName}</p>}
        <p className="workspace-confirm-description">{workspaceConfirmation.description}</p>
      </FeatureDialog>}
      <div className="app-main">
        <header className="topbar">
          <div className="workspace-brand"><span className="brand-mark"><Container size={22} aria-hidden="true"/></span>
            <h1>{tr("装柜智算")}</h1>
          </div>
          <div className="top-actions">
            <span className={`save-state ${dirty || hasPendingDimensionChanges ? "is-dirty" : ""} ${storageState === "error" ? "is-error" : ""}`}><Save size={15} />{storageState === "error" ? tr("草稿未能保存") : hasPendingDimensionChanges ? tr("尺寸录入中 · 尚未提交") : dirty ? tr("草稿自动保存 · 待重算") : tr("本机草稿已保存")}</span>
            <WorkspaceFileMenu menuRef={fileMenu}
              backupBlocked={hasPendingDimensionChanges || invalidNumericFields.size > 0}
              restoreBlocked={hasPendingDimensionChanges}
              planBlockReason={planDownloadBlock}
              onBackUp={backupWorkspace}
              onRestore={()=>workspaceInputRef.current?.click()}
              onPrint={printPlan}
              onExport={exportJson}
              onSample={()=>{
                restoreAttempt.current += 1;
                setWorkspaceConfirmation({
                  kind:"sample", apply:loadSample,
                  description:tr("示例会替换当前箱规、柜型、打托设置和计算结果。需要保留当前工作时，可先备份工作区。","The example replaces the carton data, container, pallet settings and plan. Back up the workspace first if you want to keep your current work."),
                });
              }}
            />
            <input ref={workspaceInputRef} type="file" accept=".json,application/json" aria-label={tr("选择工作区备份文件")} hidden onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void restoreWorkspace(file);
            }} />
            <CloudAccount buttonRef={accountButton} backup={workspaceBackup} disabled={upgradesDisabled} onRestore={payload => {
              void restoreWorkspace(new File([payload], "CargoFit-cloud-workspace.json", { type: "application/json" }));
            }}/>
            <button type="button" className="button ghost workspace-tools-entry" aria-expanded={toolsOpen} onClick={()=>{
              setToolsOpen(!toolsOpen);
              if(!toolsOpen){setToolsVisited(true);scrollTo("workflow-tools");}
            }}><Settings2 size={16}/>{tr("方案工具")}</button>
        <div className="workspace-other-entry"/>
        <LearningHub guide={guide} onGuideChange={setGuide} onCase={loadIndustryCase} onStep={tutorialAction} integration={JSON.stringify({schema:"cargo-fit-integration-v1",units:{length:"mm",weight:"kg",volume:"mm3"},runtime:"local-web-worker",request:fleetRequest,result:result?{...result,strategyPlans:undefined}:null},null,2)}/>
          </div>
        </header>


        {showTransport && <TransportPicker selected={container} customContainers={customContainers} onCustomChange={spaces=>{setCustomContainers(spaces);persistDraft({customContainers:spaces});}} onSelect={space=>{persistDraft({container:space,practicalTargetPercent:recommendedPracticalTarget(space)*100});clearNumericDraftErrors();setContainer(space);setPracticalTargetPercent(recommendedPracticalTarget(space)*100);markDirty();}} onClose={()=>setShowTransport(false)}/>}
        {showFloorPallets && <FloorPalletSettings config={floorPallets} container={container} clearance={clearance} customSpaces={customContainers} onClose={()=>setShowFloorPallets(false)} onSave={next=>{persistDraft({floorPallets:next});setFloorPallets(next);markDirty();}}/>}
        {showRules && <LoadingRuleSettings rules={loadingRules} products={products} onSave={(rules,next)=>{persistDraft({loadingRules:rules,products:next});setLoadingRules(rules);setProducts(next);markDirty();}} onClose={()=>setShowRules(false)}/>}
        {activeOrderLine&&products.find(p=>p.id===activeOrderLine)&&<OrderLineEditor key={activeOrderLine} product={products.find(p=>p.id===activeOrderLine)!} delivery={result?.delivery} onSave={line=>{setProducts(current=>current.map(p=>p.id===activeOrderLine?{...p,orderLine:line}:p));setActiveOrderLine(null);markDirty();}} onCopy={()=>duplicateOrderRow(activeOrderLine)} onClose={()=>setActiveOrderLine(null)}/>}
        {activeCargo && products.find(p=>p.id===activeCargo) && <CargoSettings product={products.find(p=>p.id===activeCargo)!} mode={mode} lengthUnit={lengthUnit} weightUnit={weightUnit} container={container} clearance={clearance} strategy={strategy} onSave={product=>{if(product.cargoType !== products.find(p=>p.id===product.id)?.cargoType) product = {...product,minimumSupportRatio:loadingRules.supportByType?.[product.cargoType ?? "carton"]};persistDraft({products:products.map(p=>p.id===product.id?product:p)});clearNumericDraftErrors();setProducts(current=>current.map(p=>p.id===product.id?product:p));markDirty();}} onClose={()=>setActiveCargo(null)}/>}
        {showViewer && result && <PlanViewer plans={[result]} exportsBlocked={!canExport} onClose={()=>setShowViewer(false)}/>}

        <div className="workspace-flow" hidden={toolsOpen}>
        <WorkflowSteps workflow={workflow} current={workflowStep} onSelect={goToStep}/>

        {!toolsOpen && workStatus}

        {result ? (
          <header className="print-report-title">
            <div><span>LOADING INSTRUCTION</span><h1>{tr("集装箱装柜作业指导书")}</h1></div>
            <dl><div><dt>{tr("方案编号")}</dt><dd>{result.id}</dd></div><div><dt>{tr("柜型")}</dt><dd>{tr(result.container.name)}</dd></div><div><dt>{tr("生成时间")}</dt><dd>{new Date(result.createdAt).toLocaleString("zh-CN")}</dd></div></dl>
          </header>
        ) : null}

        {workflowStep===1 && <section id="workspace" className="wizard-page" aria-label={tr("第一步：装载空间","Step 1: Load space")}>
          <div className="wizard-page-heading">
            <div><h2>{tr("选柜型和装载方式","Choose a container and loading method")}</h2><p>{workflow==="pallet-only"?tr("只打托时可直接进入包装设置。","Continue to packaging selection for pallet-only work."):tr("请选择集装箱或车辆，并确认货物是否先打托。","Select a container or vehicle and choose how to prepare the cargo.")}</p></div>
          </div>
          <div className={`space-stage-grid${workflow==="pallet-only"?" is-pallet-only":""}`}>
            <div className="panel space-stage-form"><div id="vehicle-setup" className="vehicle-config" hidden={workflow==="pallet-only"}><article className="panel">
              <div className="panel-head"><h3>{tr("柜型或车辆","Container or vehicle")}</h3><button className="button small space-library-button" onClick={()=>setShowTransport(true)}><Container size={15}/>{tr("装载空间库","Space library")}</button></div>
              <label className="select-wrap">
                <span>{tr("柜型预设")}</span>
                <select value={hasKnownContainer ? container.id : "custom-draft"} onChange={(event) => selectPreset(event.target.value)}>
                  <optgroup label={tr("常用海运柜型")}>
                    {TRANSPORT_PRESETS.filter(item=>item.category!=="pallet").map((item) => <option key={item.id} value={item.id}>{tr(item.name)}</option>)}
                  </optgroup>
                  {customContainers.length ? (
                    <optgroup label={tr("我的自定义柜型")}>
                      {customContainers.map((item) => <option key={item.id} value={item.id}>{tr(item.name)}</option>)}
                    </optgroup>
                  ) : null}
                  {!hasKnownContainer ? <option value="custom-draft">{tr("自定义柜型（未保存）")}</option> : null}
                </select>
                <ChevronDown size={16} />
              </label>
              <details className="stage-options">
                <summary>{tr("柜内尺寸、门洞与净载重","Interior, door and payload")}</summary>
              <div className="field-grid three">
                <Field label={tr("内长")} unit="mm"><NumericInput showError min={1} resetToken={numericResetVersion} ariaLabel={tr("柜体内长")} value={container.length} precision={1} onValueChange={(value) => updateContainer("length", value)} onValidityChange={(valid) => setNumericFieldValidity("container:length", valid)} /></Field>
                <Field label={tr("内宽")} unit="mm"><NumericInput showError min={1} resetToken={numericResetVersion} ariaLabel={tr("柜体内宽")} value={container.width} precision={1} onValueChange={(value) => updateContainer("width", value)} onValidityChange={(valid) => setNumericFieldValidity("container:width", valid)} /></Field>
                <Field label={tr("内高")} unit="mm"><NumericInput showError min={1} resetToken={numericResetVersion} ariaLabel={tr("柜体内高")} value={container.height} precision={1} onValueChange={(value) => updateContainer("height", value)} onValidityChange={(valid) => setNumericFieldValidity("container:height", valid)} /></Field>
                <Field label={tr("门宽")} unit="mm"><NumericInput showError min={1} resetToken={numericResetVersion} ariaLabel={tr("柜门宽度")} value={container.doorWidth} precision={1} onValueChange={(value) => updateContainer("doorWidth", value)} onValidityChange={(valid) => setNumericFieldValidity("container:doorWidth", valid)} /></Field>
                <Field label={tr("门高")} unit="mm"><NumericInput showError min={1} resetToken={numericResetVersion} ariaLabel={tr("柜门高度")} value={container.doorHeight} precision={1} onValueChange={(value) => updateContainer("doorHeight", value)} onValidityChange={(valid) => setNumericFieldValidity("container:doorHeight", valid)} /></Field>
                <Field label={tr("最大净载重","Maximum payload")} unit="kg"><NumericInput showError min={1} resetToken={numericResetVersion} ariaLabel={tr("柜体最大载重")} value={container.maxWeight} precision={2} onValueChange={(value) => updateContainer("maxWeight", value)} onValidityChange={(valid) => setNumericFieldValidity("container:maxWeight", valid)} /></Field>
              </div>
              <p className="payload-note">{tr("净载重为柜内货物、包装与附件合计。预设为参考值，装运时按实际铭牌与线路限重核对。","Payload covers cargo, packaging and accessories in the container. Verify the equipment plate and route limits for the shipment.")}</p>
              <div className="clearance-row">
                <div><strong>{tr("安全间隙")}</strong><span>{tr("自动从有效柜内空间扣除")}</span></div>
                <div className="range-control"><input aria-label={tr("安全间隙")} type="range" min="0" max="50" step="5" value={clearance} onChange={(event) => { setClearance(numberValue(event.target.value)); markDirty(); }} /><output>{clearance} mm</output></div>
              </div>
              <div className="container-save-actions">
                <button className="button ghost small" onClick={() => { setShowContainerSave((current) => !current); setCustomContainerName(container.name.includes("未保存") ? "" : tr(container.name)); }}><Save size={14} />{tr("另存为自定义柜型")}</button>
                {container.id.startsWith("custom-") && container.id !== "custom-draft" ? <button className="button text-danger small" onClick={removeSelectedCustomContainer}><Trash2 size={14} />{tr("删除当前柜型")}</button> : null}
              </div>
              {showContainerSave ? (
                <div className="container-save-row">
                  <input aria-label={tr("自定义柜型名称")} maxLength={120} placeholder={tr("例如：45HQ 客户专用柜")} value={customContainerName} onChange={(event) => setCustomContainerName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCustomContainer(); }} />
                  <button className="button primary small" onClick={saveCustomContainer}>{tr("保存")}</button>
                  <button className="icon-button" aria-label={tr("取消保存柜型")} onClick={() => setShowContainerSave(false)}><X size={16} /></button>
                </div>
              ) : null}
              </details>
            </article></div>
          <article className="stage-mode">
            <h3>{tr("货物怎么装？","How will you load the cargo?")}</h3>
            <div className="loading-workflow-options" role="group" aria-label={tr("装载方式", "Loading workflow")}>
              {([["palletized","先打托再装柜","Palletize then load","支持全部打托，也可按货物指定散箱混装","Palletize all cargo or mix pallets with selected loose cartons"],
                ["direct","散箱直接装柜","Load loose cartons","按订单直接摆放纸箱","Place ordered cartons directly in the container"],
                ["pallet-only","只打托","Palletize only","计算每托摆放和总托数","Plan pallet contents and total units"],
                ["single-capacity","单品容量测算","Single-product capacity","估算一个产品最多能装多少","Estimate capacity for one product"]] as const)
                .map(([value,zh,en,hint,hintEn])=><button key={value} type="button" aria-pressed={workflow === value} className={workflow===value?"active":""} onClick={()=>selectWorkflow(value)}>
                  <strong>{tr(zh,en)}</strong><small>{tr(hint,hintEn)}</small>
                </button>)}
            </div>
          </article>
            </div>
            <div className="panel space-stage-preview" hidden={workflow==="pallet-only"}>
              <div className="space-overview"><strong>{tr(container.name)}</strong><span>{container.length} × {container.width} × {container.height} mm</span><span>{formatNumber(container.maxWeight,1)} kg {tr("最大净载重","max. payload")}</span></div>
              <SpaceModelPreview space={container} compactDimensions/>
            </div>
          </div>
          {(workflow!=="pallet-only"||!!container.exclusions?.length)&&<details className="stage-options space-advanced">
            <summary>{tr("柜内障碍、附件与配重","Obstacles, accessories and weight distribution")}</summary>
          {(workflow!=="pallet-only"||!!container.exclusions?.length)&&<SiteExclusionSettings container={container} clearance={clearance} only={workflow==="pallet-only"} invalid={invalidNumericFields.size>0} resetToken={numericResetVersion} onValidityChange={setNumericFieldValidity} onChange={next=>{setContainer(next);markDirty();}}/>}
          {(workflow!=="pallet-only"||!!container.exclusions?.some(z=>z.accessory))&&<ContainerAccessorySettings container={container} products={activeProducts} only={workflow==="pallet-only"} prebuilt={workflow==="palletized"} invalid={invalidNumericFields.size>0} resetToken={numericResetVersion} onValidityChange={setNumericFieldValidity} onChange={next=>{setContainer(next);markDirty();}}/>}
          {workflow!=="pallet-only"&&<VehicleEngineeringSettings key={JSON.stringify([container.id,container.engineering])} container={container} onChange={next=>{setContainer(next);markDirty();}}/>}
          </details>}
        </section>}
        {workflowStep===2 && <section className="wizard-page" aria-label={tr("第二步：打托包装","Step 2: Packaging")}>
          <div className="wizard-page-heading"><div><h2>{isPalletWorkflow?tr("选择打托包装","Choose pallet packaging"):tr("选用底层托盘","Optional floor pallets")}</h2><p>{workflow==="pallet-only"?tr("只打托","Palletize only"):tr(container.name)}</p></div>
          </div>

          {isPalletWorkflow
            ? <PalletBuildSettings chooseOnly initialSpecId={palletSetupSpec} onSelectSpec={setPalletSetupSpec} resetToken={numericResetVersion} value={palletBuild} only={workflow==="pallet-only"} onChange={changePalletBuild} onValidityChange={setNumericFieldValidity}/>
            : <FloorPalletSettings inline config={floorPallets} container={container} clearance={clearance} customSpaces={customContainers} onDraftChange={receivePalletDraft} onSave={()=>{}} onClose={()=>{}}/>}
        </section>}
        {workflowStep===3 && <section id="cargo-layout" className="wizard-page" aria-label={tr("第三步：录入货物","Step 3: Cargo")}>
          <div className="wizard-page-heading"><div><h2>{tr("录入货物","Enter cargo")}</h2>
            <p>{tr("填写外箱尺寸、单箱毛重和订单箱数。","Enter each carton's outside dimensions, gross weight and quantity.")}</p></div></div>
          {invalidNumericFields.size>0&&<p className="workflow-field-status" role="status">{tr("还有输入需要修正。","Some inputs still need correction.")} <button type="button" className="button small" onClick={()=>{
            const key=[...invalidNumericFields][0];
            const id=key.startsWith("pallet-build:")?"packaging-settings":key.startsWith("target:")?"loading-rules":"products";
            scrollTo(id);
            window.requestAnimationFrame(()=>{
              const field=document.querySelector<HTMLElement>(`#${id} [aria-invalid="true"]`);
              if(field){revealDetails(field);field.focus();}
            });
          }}>{tr("定位输入","Find input")}</button></p>}
        <section id="products" className="panel product-panel">
          <div className="panel-head">
            <h3>{tr("订单箱规","Order cartons")}</h3>
            <div className="panel-actions">
              <input ref={fileInputRef} hidden type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); event.currentTarget.value = ""; }} />
                <button className="button small" disabled={hasPendingDimensionChanges||invalidNumericFields.size>0} onClick={() => fileInputRef.current?.click()}><Upload size={15} />{tr("导入 CSV / Excel")}</button>
              {mode === "mixed" && <button className="button small" onClick={addProduct}><Plus size={15} />{tr("添加 SKU")}</button>}
              <details className="product-files-menu" name="order-menus">
                <summary className="button small"><FileSpreadsheet size={15}/>{tr("表格选项","Spreadsheet options")}</summary>
                <div className="product-files-panel">
                  <label className="spreadsheet-import-mode">{tr("导入时处理现有订单","When importing into the current order")}<select aria-label={tr("订单行导入方式","Order-row import action")} value={orderImportMode} onChange={e=>{setOrderImportMode(e.target.value as typeof orderImportMode);orderImportRevisionRef.current+=1;}}><option value="replace">{tr("替换订单","Replace order")}</option><option value="append">{tr("追加为新行","Append as new rows")}</option><option value="quantity">{tr("按 ID 只更新数量","Update quantities by ID")}</option></select></label>
                  <button className="button ghost small" disabled={!hydrated} onClick={() => void downloadExcelTemplate()}><FileSpreadsheet size={15}/>{tr("下载 Excel 模板")}</button>
                  <button className="button ghost small" onClick={downloadTemplate}><Download size={15} />{tr("下载模板")}</button>
                  <button className="button ghost small" disabled={hasPendingDimensionChanges||invalidNumericFields.size>0} onClick={()=>downloadFile("order-rows.csv","\uFEFF"+buildOrderRowsCsv(inheritOrderDelivery(products,result?.delivery)),"text/csv;charset=utf-8")}>{tr("导出订单行 CSV","Export order-row CSV")}</button>
                </div>
              </details>
              <details className="product-examples-menu" name="order-menus"><summary className="button small"><Sparkles size={14}/>{tr("示例与真实记录")}</summary><div className="product-examples-panel">
              <select className="real-record-select" aria-label={tr("载入用户提供的真实装柜记录")} value="" onChange={(event) => loadSuppliedRealRecord(event.target.value)}>
                <option value="" disabled>{tr("载入真实记录…")}</option>
                {HISTORICAL_LOADING_RECORDS.filter((record) => record.models[0].startsWith("实装记录·")).map((record) => (
                  <option key={record.models[0]} value={record.models[0]}>{tr(record.models[0])} · HQ {record.loadingSets["40hq"]}{tr(" 套")}</option>
                ))}
              </select>
              <button className="button ghost small real-data-button" onClick={loadRealA64M}><CheckCircle2 size={15} />{tr("载入真实 A64M")}</button>
              <button className="button ghost small" onClick={loadDimensionTest}><PackageOpen size={15} />{tr("载入尺寸测试")}</button>
              <button className="button ghost small" onClick={loadTwoCartonSetTest}><Boxes size={15} />{tr("载入 1 套 2 箱")}</button>
              <button className="button ghost small" onClick={loadMultiCartonSetTest}><Boxes size={15} />{tr("载入 1 套 5 箱")}</button>
              </div></details>
              <button className="button small" aria-pressed={showProductRules} onClick={()=>setShowProductRules(v=>!v)}>{showProductRules?tr("收起详细规则"):tr("显示详细规则")}</button>
            </div>
          </div>
          {demoOrder&&<p className="helper-text">{tr("此演示使用 1200 × 2300 mm 宽托、1800 mm 货物限高及有限装卸路径搜索。承重资料和运输固定仍须现场核验。","This demo uses 1200 × 2300 mm pallets, 1800 mm cargo ceilings and bounded access search. Bearing evidence and transport securing still require on-site verification.")}</p>}
          {exampleOrder&&<p className="example-order-note">{tr("当前显示示例订单。可编辑下表，或用 Excel / CSV 导入自己的订单。","This is a sample order. Edit the rows or import your own order with Excel or CSV.")}</p>}
          <div className="unit-toolbar" role="group" aria-label={tr("箱规录入单位")}>
            <div>
              <strong>{tr("箱规录入单位")}</strong>
            </div>
            <label>
              <span>{tr("长度")}</span>
              <select aria-label={tr("长度单位")} value={lengthUnit} onChange={(event) => {
                if (!isLengthUnit(event.target.value)) return;
                if(invalidNumericFields.size){setMessage(tr("请先完成数字输入，再切换单位。"));return;}
                commitPendingDimensions();clearNumericDraftErrors();
                setLengthUnit(event.target.value);
              }}>
                {LENGTH_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}
              </select>
            </label>
            <label>
              <span>{tr("重量")}</span>
              <select aria-label={tr("重量单位")} value={weightUnit} onChange={(event) => {
                if (!isWeightUnit(event.target.value)) return;
                if(invalidNumericFields.size){setMessage(tr("请先完成数字输入，再切换单位。"));return;}
                commitPendingDimensions();clearNumericDraftErrors();
                setWeightUnit(event.target.value);
              }}>
                {WEIGHT_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}
              </select>
            </label>
          </div>
          <details className="stage-options cargo-kits">
            <summary>{tr("多箱套装","Multi-carton kits")}{setInputSummaries.length>0&&<span>{setInputSummaries.length} {tr("组","groups")}</span>}</summary>
          <section className={`set-builder ${!setInputSummaries.length?"set-builder-unconfigured":""}`} aria-label={mode === "single" ? tr("单品多箱包装助手") : tr("多箱套装助手")}>
              <div className="set-builder-head">
                <div>

                  <strong>{mode === "single" ? tr("单品多箱包装") : tr("多箱套装助手")}</strong>
                  <small>{mode === "single"
                    ? tr("一个产品可由 2 箱、3 箱或更多箱组成；仍按单品最大装柜计算，不会进入拼柜模式")
                    : tr("按整套原子装载；支持不同箱规、1:n 比例、多个套装同时拼柜")}</small>
                </div>
                <div className="set-quick-actions" aria-label={tr("新建套装箱数")}>
                  {[2, 3, 4, 5].map((count) => <button key={count} onClick={() => addCartonSet(count)}><Plus size={13} />{count}{tr(" 箱套装")}</button>)}
                  {mode==="mixed"&&activeProducts.length>1&&<button type="button" onClick={()=>setKitRows(new Set())}>{tr("勾选已有箱型","Select existing cartons")}</button>}
                </div>
              </div>
              {setInputSummaries.length>1&&setInputSummaries.every(set=>set.componentCount===1)&&<p className="helper-text">
                {tr("当前每个套装编码只有一种箱规。属于同一产品的箱型，请勾选后合并。","Each current kit code contains one carton type. Select and group the cartons that belong to the same product.")}
              </p>}
              {setInputSummaries.length ? (
                <div className="set-builder-grid">
                  {setInputSummaries.slice(0, MAX_VISIBLE_SET_SUMMARIES).map((summary) => (
                    <article key={summary.setCode} className={mode === "single" || summary.quantitiesAligned ? "aligned" : "misaligned"}>
                      <div className="set-builder-card-main">
                        <span>{summary.setCode}</span>
                        <strong>{summary.componentCount}{tr(" 种箱规 · ")}{summary.cartonsPerSet}{tr(" 箱/套")}</strong>
                        <small>{mode === "single"
                          ? tr("单品最大装柜会自动求完整套数，无需录入需求箱数")
                          : tt`当前可完整组成 ${formatNumber(summary.completeSets)} 套${summary.looseCartons ? tt` · 另有 ${formatNumber(summary.looseCartons)} 个比例外箱` : ""}`}</small>
                      </div>
                      <div className="set-ratio-list" aria-label={tt`${summary.setCode} 套内比例`}>
                        {summary.items.slice(0, MAX_VISIBLE_SET_ITEMS).map((item) => <span key={item.productId}><b>{item.sku}</b>× {item.unitsPerSet}</span>)}
                        {summary.items.length > MAX_VISIBLE_SET_ITEMS ? <span>{tr("另有 ")}{formatNumber(summary.items.length - MAX_VISIBLE_SET_ITEMS)}{tr(" 种箱规")}</span> : null}
                      </div>
                      <div className="set-builder-card-actions">
                        <b className={mode === "single" || summary.quantitiesAligned ? "status-ok" : "status-warning"}>{mode === "single" ? tr("单品整套测算") : summary.quantitiesAligned ? tr("数量比例已对齐") : tr("需求比例未对齐")}</b>
                        {mode === "mixed" && !summary.quantitiesAligned ? <button onClick={() => alignSet(summary.setCode)}><CheckCircle2 size={13} />{tr("向下对齐")}</button> : null}
                        <button onClick={() => addComponentToSet(summary.setCode)}><Plus size={13} />{tr("增加箱型")}</button>
                        <button className="danger" onClick={() => ungroupSet(summary.setCode)}>{mode === "single" ? tr("恢复单箱") : tr("取消套装")}</button>
                      </div>
                    </article>
                  ))}
                  {setInputSummaries.length > MAX_VISIBLE_SET_SUMMARIES
                    ? <div className="set-builder-overflow">{tr("套装概览仅显示前 ")}{MAX_VISIBLE_SET_SUMMARIES}{tr(" 组；全部 ")}{formatNumber(setInputSummaries.length)}{tr(" 组仍可在下方分页表格中编辑并参与计算。")}</div>
                    : null}
                </div>
              ) : (
                <div className="set-builder-empty">{mode === "single"
                  ? tr("当前为单箱产品。若一个产品分成多箱包装，可一键改为 2–5 箱，并继续增加第 6 箱及更多箱型。")
                  : tr("尚未设置套装。可一键创建 2–5 箱结构，也可在创建后继续增加第 6 箱及更多箱型。")}</div>
              )}
          </section>
          </details>
          {mode==="mixed"&&kitRows&&<div className="kit-row-selection">
            <span role="status">{tr("勾选属于同一个产品的箱型。","Select the carton types for one product.")} · {kitRows.size} {tr("行已选","rows selected")}</span>
            <button className="button primary small" type="button" disabled={kitRows.size<2||hasPendingDimensionChanges||invalidNumericFields.size>0} onClick={groupSelectedKit}>{tr("合并为一套 · 一套一托","Group as one kit per pallet")}</button>
            <button className="button small" type="button" onClick={()=>setKitRows(null)}>{tr("取消选择","Cancel selection")}</button>
          </div>}
          <CargoSpaceWarnings products={activeProducts} container={container} clearance={clearance} palletBuild={workflow==="pallet-only"?palletBuild:undefined}/>
          <ExcelDataGrid key={`${mode}:${activeProducts.length}`} rows={cargoEntryRows(activeProducts)} columns={cargoEntryColumns(lengthUnit,weightUnit,mode==="mixed",isSingleProductSet)} exportColumns={cargoEntryExportColumns(lengthUnit,weightUnit)} label={tr("货物清单表格","Cargo Manifest Table")} searchPlaceholder={tr("搜索 SKU、套装或订单行","Search SKU, Kit or Order Row")} fileName="CargoFit-cargo.xlsx" tableClassName="product-table compact-cargo-table" scrollClassName="product-table-wrap" className="cargo-entry-grid" pageSize={PRODUCT_PAGE_SIZE} pageIndex={productPage} onPageChange={setProductPage} exportDisabled={hasPendingDimensionChanges||invalidNumericFields.size>0} renderRow={product=>{
                  const rowLabel=(skuCounts.get(product.sku)??0)>1?`${product.sku} [${product.id}]`:product.sku;
                  const dimensionsInvalid=(["length","width","height"] as const).some(field=>invalidNumericFields.has(`product:${product.id}:${field}`));
                  const volumePending=dimensionsInvalid||pendingDimensionProducts.has(product.id);
                  const calculatedCbm = exactCartonVolumeCbm(product);
                  return <Fragment key={product.id}><tr className={mode==="mixed"&&kitRows?.has(product.id)?"kit-row-selected":undefined}>
                    <td className="cargo-color-cell">{mode==="mixed"&&kitRows
                      ? <input type="checkbox" className="kit-row-checkbox" aria-label={`${tr("选择箱型","Select carton type")} ${rowLabel}`} checked={kitRows.has(product.id)} onChange={event=>{const next=new Set(kitRows);if(event.target.checked)next.add(product.id);else next.delete(product.id);setKitRows(next);}}/>
                      : <input className="color-input" aria-label={tt`${rowLabel} 颜色`} type="color" value={product.color} onChange={(event) => updateProduct(product.id, "color", event.target.value)} />}</td>
                    <td className="cargo-sku-cell"><input aria-label={`${rowLabel} SKU`} maxLength={80} className="sku-input" value={product.sku} onChange={(event) => updateProduct(product.id, "sku", event.target.value)} /><div className="cargo-row-reference"><button className="cargo-order-link" disabled={hasPendingDimensionChanges} aria-label={`${rowLabel} ${tr("订单行","Order Row")}`} onClick={()=>setActiveOrderLine(product.id)}>{tr("订单行","Order Row")}</button><small className="order-row-reference" title={product.id}>{product.orderLine?.lineReference||product.id}</small></div>{product.orderLine&&<small className="order-row-reference">{[product.orderLine.customer,product.orderLine.batch].filter(Boolean).join(" · ")}</small>}</td>
                    <td className="cargo-settings-cell"><button className="button small cargo-settings-button" disabled={hasPendingDimensionChanges} onClick={()=>setActiveCargo(product.id)} aria-label={`${rowLabel} ${tr("货物设置")}`}><Box size={16}/><span className="cargo-settings-label">{tr("朝向与规则", "Orientation & rules")}</span><span className="cargo-settings-short">{tr("设置", "Settings")}</span></button></td>
                    <td className="numeric-cell" data-label={`${tr("外箱长")} (${lengthUnit})`}><NumericInput showError min={fromMillimeters(.001,lengthUnit)} max={fromMillimeters(100000,lengthUnit)} resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 外箱长`} value={fromMillimeters(product.length, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "length", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "length", valid)} onFocusChange={handleDimensionFocusChange} /></td>
                    <td className="numeric-cell" data-label={`${tr("外箱宽")} (${lengthUnit})`}><NumericInput showError min={fromMillimeters(.001,lengthUnit)} max={fromMillimeters(100000,lengthUnit)} resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 外箱宽`} value={fromMillimeters(product.width, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "width", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "width", valid)} onFocusChange={handleDimensionFocusChange} /></td>
                    <td className="numeric-cell" data-label={`${tr("外箱高")} (${lengthUnit})`}><NumericInput showError min={fromMillimeters(.001,lengthUnit)} max={fromMillimeters(100000,lengthUnit)} resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 外箱高`} value={fromMillimeters(product.height, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "height", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "height", valid)} onFocusChange={handleDimensionFocusChange} /></td>
                    <td className="cbm-cell" data-label="CBM (m³)"><output className="cbm-auto-value" aria-label={tt`${rowLabel} 自动计算 CBM`}>{volumePending?"—":calculatedCbm.toFixed(calculatedCbm>0&&calculatedCbm<.0001?6:4)}</output>{volumePending&&<small className="cell-unit">{dimensionsInvalid?tr("请检查尺寸","Check Dimensions"):tr("待确认尺寸","Pending Dimensions")}</small>}</td>
                    <td className="numeric-cell" data-label={`${tr("毛重")} (${weightUnit})`}><NumericInput showError resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 毛重`} value={fromKilograms(product.weight, weightUnit)} precision={weightUnitPrecision(weightUnit)} onValueChange={(value) => updateProduct(product.id, "weight", toKilograms(value, weightUnit))} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:weight`, valid)} />{product.weight===0&&!invalidNumericFields.has(`product:${product.id}:weight`)&&<small className="cargo-field-note">{tr("当前按零重量计算","Counted as zero mass")}</small>}</td>
                    {mode === "mixed" ? <td className="numeric-cell" data-label={tr("需求箱数")}><NumericInput showError resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 需求箱数`} value={product.quantity} integer max={1_000_000} onValueChange={(value) => updateProduct(product.id, "quantity", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:quantity`, valid)} /></td> : null}
                    {mode === "mixed" || isSingleProductSet ? <><td data-label={tr("套装编码")}><input className="set-code-input" aria-label={tt`${rowLabel} 套装编码`} maxLength={80} value={product.setCode ?? ""} placeholder={tr("留空=散箱")} readOnly={mode === "single"} onChange={(event) => updateProduct(product.id, "setCode", event.target.value)} /></td><td className="numeric-cell" data-label={tr("套内数量 (箱/套)","Cartons / Kit")}><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 套内数量`} value={product.unitsPerSet || 1} integer min={1} max={99} onValueChange={(value) => updateProduct(product.id, "unitsPerSet", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:unitsPerSet`, valid)} /></td></> : null}
                    <td className="cargo-row-actions">{mode === "mixed"&&<button type="button" className="icon-button cargo-copy" aria-label={`${tr("复制","Duplicate")} ${rowLabel}`} title={product.setCode?.trim()?tr("复制完整套装","Duplicate whole kit"):tr("复制订单行","Duplicate order row")} onClick={()=>duplicateOrderRow(product.id)} disabled={hasPendingDimensionChanges||invalidNumericFields.size>0}><Copy size={16}/></button>}{mode === "mixed" || isSingleProductSet ? <button className="icon-button danger" aria-label={tt`删除 ${rowLabel}`} onClick={() => removeProduct(product.id)} disabled={activeProducts.length <= 1}><Trash2 size={16} /></button> : null}</td>
                  </tr>
                  {showProductRules&&<tr className="cargo-rules-row"><td colSpan={cargoEntryColumns(lengthUnit,weightUnit,mode==="mixed",isSingleProductSet).length}><div className="cargo-rules-fields" role="group" aria-label={`${rowLabel} ${tr("详细规则","Detailed Rules")}`}><strong>{rowLabel} · {tr("详细规则","Detailed Rules")}</strong>{mode==="mixed"&&<label className="cargo-rule-field"><span>{tr("装载优先级")}</span><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 装载优先级`} value={product.priority} integer max={100} onValueChange={(value) => updateProduct(product.id, "priority", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:priority`, valid)} /><small className="cell-meta">{tr("数值越高越先装")}</small></label>}{mode==="mixed"&&<div className="cargo-rule-field"><span>{tr("必装")}</span><label className="switch" title={tr("必装货物优先于塞货，并在缺装时单独告警")}><input aria-label={tt`${rowLabel} 必装`} type="checkbox" checked={product.mustLoad !== false} onChange={(event) => updateProduct(product.id, "mustLoad", event.target.checked)} /><span /></label></div>}<label className="cargo-rule-field"><span>{tr("方向规则")}</span>
                      <select className="constraint-select" aria-label={tt`${rowLabel} 方向规则`} value={product.rotationPolicy} onChange={(event) => updateProduct(product.id, "rotationPolicy", event.target.value)}>
                        <option value="fixed">{tr("固定方向")}</option>
                        <option value="upright">{tr("仅平面旋转")}</option>
                        <option value="any">{tr("任意旋转")}</option>
                      </select>
                    </label><div className="cargo-rule-field"><span>{tr("可承托")}</span><label className="switch" title={tr("关闭后，其他箱体不能放在此产品上方")}><input aria-label={tt`${rowLabel} 可承托`} type="checkbox" checked={shapeCanSupport(product)&&product.stackable} disabled={!shapeCanSupport(product)} onChange={(event) => updateProduct(product.id, "stackable", event.target.checked)} /><span /></label></div><div className="cargo-rule-field"><span>{tr("必须底置")}</span><label className="switch" title={tr("开启后该产品只允许摆放在集装箱地板")}><input aria-label={tt`${rowLabel} 必须底置`} type="checkbox" checked={product.bottomOnly === true} onChange={(event) => updateProduct(product.id, "bottomOnly", event.target.checked)} /><span /></label></div><label className="cargo-rule-field"><span>{tr("层数上限")}</span><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 层数上限`} value={product.maxStackLayers} integer max={99} onValueChange={(value) => updateProduct(product.id, "maxStackLayers", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:maxStackLayers`, valid)} /><small className="cell-meta" title={tr("0 表示不设置人为层数上限，仍受柜高、门高、承托和载重约束")}>{tr("0 = 自动按柜高")}</small></label></div></td></tr>}
                  </Fragment>;
                }}/>
          <div className="table-note"><CircleAlert size={16} /><span>{mode === "single"
            ? tr("每行录入同一产品的一种外箱。单品容量测算不需要填写需求箱数，系统按可完整装入的套数计算。","Each row represents an outer carton of the same product. Single-product capacity uses complete kits and needs no order quantity.")
            : tr("相同“套装编码”的任意数量 SKU 会按“套内数量”组成原子批次：支持 2/3/4/5 箱及更多箱型，也支持 1:4、1:2:2 等比例；任一组成箱放不下即整套回滚。")}</span></div>
          {hasPendingDimensionChanges ? (
            <div className="dimension-edit-notice" role="status">
              <LoaderCircle size={16} />
              <span><b>{tr("尺寸录入期间暂停计算")}</b>{tr("输入区保留上一次校验结果。离开尺寸字段后统一提交长、宽、高，再确认托内布置和计算。","The last checked result stays visible. Confirm dimensions together when you leave the fields, then review the layout and calculate.")}</span>
            </div>
          ) : null}
        </section>

        {workflow==="palletized"&&<CargoLoadingAllocation products={activeProducts} value={palletBuild.looseQuantities} resetToken={numericResetVersion} onValidityChange={setNumericFieldValidity} onChange={looseQuantities=>changePalletBuild({...palletBuild,looseQuantities})}/>}
        </section>}
        {workflowStep===4&&<section className="wizard-page" aria-label={tr("第四步：布置预览","Step 4: Layout preview")}>
          <div className="wizard-page-heading"><div><h2>{isPalletWorkflow?tr("核对托内布置","Review pallet layout"):tr("确认散箱布置","Review loose loading setup")}</h2>
            <p>{isPalletWorkflow?tr("核对当前包装与托内货物，必要时调整尺寸或摆放。","Review the packaging and pallet contents. Adjust dimensions or placement as needed."):tr("确认散箱如何落位，再核对装载规则。","Confirm where loose cartons may be placed before reviewing loading rules.")}</p></div></div>
          {isPalletWorkflow?<PalletBuildSettings previewActive={!toolsOpen} onPreviewReady={setPalletPreviewReady} products={activeProducts} request={palletPreviewRequest} preparedLayout={preparedPalletLayout} onPreparedLayoutChange={changePreparedLayout} layerTemplates={palletLayerTemplates} onLayerTemplatesChange={setPalletLayerTemplates} initialSpecId={palletSetupSpec} onSelectSpec={setPalletSetupSpec} onRecipePending={setPalletRecipePending} resetToken={numericResetVersion} onReset={clearNumericDraftErrors} invalid={invalidNumericFields.size>0||hasPendingDimensionChanges} value={palletBuild} only={workflow === "pallet-only"} onChange={changePalletBuild} onValidityChange={setNumericFieldValidity}/>:
            <article className="panel layout-method-review"><h3>{floorPallets?tr("使用底层托盘","Floor pallets"):tr("散箱直接装柜","Loose cartons")}</h3><p>{floorPallets
              ? `${floorPallets.name} · ${floorPallets.length} × ${floorPallets.width} × ${floorPallets.height} mm`
              :tr("纸箱在柜内直接排列，后续计算会生成实际箱位。","Cartons are arranged directly in the container. Calculation generates the exact placements.")}</p>
              {floorPallets&&<p>{floorPallets.allowFloorCargo?tr("允许使用底托外的地板空间。","Floor space outside the pallets can be used."):tr("货物仅放在底层托盘上。","Cartons must be placed on floor pallets.")}</p>}
              <button type="button" className="button small" onClick={()=>goToStep(2)}>{tr("修改底层托盘","Edit floor pallets")}</button>
            </article>}
        </section>}
        {workflowStep===5&&<section className="wizard-page" aria-label={tr("第五步：装载规则","Step 5: Loading rules")}>
          <div className="wizard-page-heading"><div><h2>{tr("核对装载规则","Review loading rules")}</h2><p>{tr("按货物和现场要求核对朝向、承托及装载顺序。","Review orientation, support and loading order for this shipment.")}</p></div></div>
          <div id="loading-rules"><LoadingRuleSettings inline rules={loadingRules} products={products} onDraftChange={receiveRulesDraft} onSave={()=>{}} onClose={()=>{}}/></div>
          {workflow !== "pallet-only" && <details id="planning-targets" className="wizard-advanced"><summary>{tr("计算偏好与计划目标")}</summary><div className="wizard-preference-grid">            <article className="panel mode-panel">
              <div className="panel-head compact"><div><span className="section-kicker">01</span><h2>{tr("计算偏好","Solver preferences")}</h2></div></div>
              <div className="strategy-divider" />
              <div className="strategy-heading"><strong>{tr("独立求解算法")}</strong><span>{strategy === "practical" ? tr("工人可直接照做") : tr("高密度搜索参考")}</span></div>
              <div className="segmented strategy-segmented" role="group" aria-label={tr("装柜执行策略")}>
                <button aria-pressed={strategy === "practical"} className={strategy === "practical" ? "active" : ""} onClick={() => switchStrategy("practical")}><ShieldCheck size={16} /><span>{tr("现场易执行")}<small className="strategy-count">{dirty
                  ? tr("待重新计算")
                  : cachedPracticalPlan
                    ? `${formatNumber(practicalPredictionDisplay ?? 0)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`
                    : status === "working"
                      ? tr("计算中")
                      : practicalPredictionDisplay === null ? tr("待计算") : tt`目标 ${formatNumber(practicalPredictionDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</small></span></button>
                <button aria-pressed={strategy === "maximum"} className={strategy === "maximum" ? "active" : ""} onClick={() => switchStrategy("maximum")}><Gauge size={16} /><span>{tr("高密度参考")}<small className="strategy-count">{dirty
                  ? tr("待重新计算")
                  : cachedMaximumPlan
                    ? `${formatNumber(maximumPredictionDisplay ?? 0)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`
                    : status === "working" ? tr("计算中") : tr("待计算")}</small></span></button>
              </div>
              <p className="strategy-help">{tr("完成录入后统一生成双算法快照；切换后，数量、三视图、3D、进度、指标和导出同时采用对应坐标。")}</p>
              {solverSchedule === "practical-first" ? (
                <p className="mobile-compute-note"><ShieldCheck size={15} /><span><strong>{tr("设备节能计算已启用")}</strong>{tr("先生成可直接使用的现场方案，再后台补算高密度参考；高密度超时或失败不会清空现场结果。")}</span></p>
              ) : null}
              {strategy === "practical" ? (
                <div className="practical-target">
                  <div><strong>{tr("现场经验装载率")}</strong><span>{tr("仅影响现场算法 · 完整支撑")}</span></div>
                  <div className="target-input"><input aria-label={tr("现场经验装载率滑块")} type="range" min="50" max="95" step="0.5" value={practicalTargetPercent} onChange={(event) => { setNumericFieldValidity("target:practical", true); setPracticalTargetPercent(clampNumber(event.target.value, DEFAULT_PRACTICAL_TARGET * 100, 50, 95)); markDirty(); }} /><NumericInput resetToken={numericResetVersion} ariaLabel={tr("现场经验装载率")} value={practicalTargetPercent} min={50} max={95} precision={1} onValueChange={(value) => { setPracticalTargetPercent(value); markDirty(); }} onValidityChange={(valid) => setNumericFieldValidity("target:practical", valid)} /><b>%</b></div>
                </div>
              ) : <p className="strategy-warning">{tr("独立运行三维分区动态规划和多起点自由空间搜索；允许侧翻与 68% 以上局部承托。它是高密度启发式参考，不是全局最优证明，也不能直接替代现场指导书。")}</p>}
            </article>

            <article className="panel reverse-panel">
              <div className="panel-head"><div><span className="section-kicker">03</span><h2>{mode === "single" ? tr("计划目标与装载上限") : tr("目标利用率倒推")}</h2></div><span className="pill">{mode === "single" ? tr("计划量 ≠ 最大量") : tr("按当前 SKU 比例")}</span></div>
              <div className="target-control">
                <div><Layers3 size={16} /><span><strong>{tr("目标体积利用率")}</strong><small>{tr("按有效柜内容积倒推")}</small></span></div>
                <div className="target-input"><input aria-label={tr("目标体积利用率滑块")} type="range" min="1" max="100" value={targetVolumePercent} onChange={(event) => { setNumericFieldValidity("target:volume", true); setTargetVolumePercent(numberValue(event.target.value)); markDirty(); }} /><NumericInput resetToken={numericResetVersion} ariaLabel={tr("目标体积利用率")} value={targetVolumePercent} integer min={1} max={100} onValueChange={(value) => { setTargetVolumePercent(value); markDirty(); }} onValidityChange={(valid) => setNumericFieldValidity("target:volume", valid)} /><b>%</b></div>
              </div>
              <div className="target-control">
                <div><Weight size={16} /><span><strong>{tr("目标载重利用率")}</strong><small>{tr("按柜型最大载重倒推")}</small></span></div>
                <div className="target-input"><input aria-label={tr("目标载重利用率滑块")} type="range" min="1" max="100" value={targetWeightPercent} onChange={(event) => { setNumericFieldValidity("target:weight", true); setTargetWeightPercent(numberValue(event.target.value)); markDirty(); }} /><NumericInput resetToken={numericResetVersion} ariaLabel={tr("目标载重利用率")} value={targetWeightPercent} integer min={1} max={100} onValueChange={(value) => { setTargetWeightPercent(value); markDirty(); }} onValidityChange={(valid) => setNumericFieldValidity("target:weight", valid)} /><b>%</b></div>
              </div>
              <div className="reverse-count-grid">
                <div>
                  <span>{tr("体积倒推")}</span>
                  <strong>{formatNumber(reversePlan.volumeLimitedDisplay)} {reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}</strong>
                  <small>{reversePlan.displayUnit === "set" ? tt`共 ${formatNumber(reversePlan.volumeLimitedDisplay * reversePlan.cartonsPerSet)} 箱 · ` : ""}{tr("目标 ")}{targetVolumePercent}%</small>
                </div>
                <div>
                  <span>{tr("载重倒推")}</span>
                  <strong>{reversePlan.weightLimitedDisplay === null ? tr("缺少重量") : `${formatNumber(reversePlan.weightLimitedDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong>
                  <small>{reversePlan.displayUnit === "set" && reversePlan.weightLimitedDisplay !== null ? tt`共 ${formatNumber(reversePlan.weightLimitedDisplay * reversePlan.cartonsPerSet)} 箱 · ` : ""}{tr("目标 ")}{targetWeightPercent}%</small>
                </div>
                <div className="recommended">
                  <span>{mode === "single" ? strategy === "practical" ? tr("现场方案预测") : tr("高密度参考预测") : tr("算术计划量（待试装）","Arithmetic plan (not yet packed)")}</span>
                  <strong>{mode==="mixed"?`${formatNumber(reversePlan.recommendedTotal)} ${tr("箱")}`:dirty ? tr("待重新计算") : selectedPredictionDisplay === null ? status === "working" ? tr("计算中") : tr("待计算") : `${formatNumber(selectedPredictionDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong>
                  <small>{mode==="mixed"?tr("尚未核验完整包装、摆放和承重；计算后可在装箱方案中试算补货。","Complete packaging, placement and loads are not yet checked; run a replenishment trial after calculating the order."):selectedCachedPlan
                    ? tt`${reversePlan.displayUnit === "set" ? tt`共 ${formatNumber(selectedPlanCartons)} 箱 · ` : ""}已按当前${strategy === "practical" ? tr("现场") : tr("极限")}算法生成并独立校验`
                    : mode === "single" && strategy === "maximum"
                    ? selectedPredictionDisplay === null ? tr("等待独立极限结果") : tt`共 ${formatNumber(selectedPlanCartons)} 箱 · 不受 ${targetVolumePercent}% / ${targetWeightPercent}% 计划预留限制`
                    : `${reversePlan.displayUnit === "set" ? tt`共 ${formatNumber(reversePlan.recommendedTotal)} 箱 · ` : ""}${reversePlan.limitingFactor === "volume" ? tr("受体积目标限制") : reversePlan.limitingFactor === "weight" ? tr("受载重目标限制") : tr("两个目标同时达到")}`}</small>
                </div>
              </div>
              <div className="ratio-chips" aria-label={tr("各 SKU 建议箱数")}>
                {selectedPredictionQuantities.map((item) => <span key={item.productId}><b>{item.sku}</b>{formatNumber(item.suggestedQuantity)}{tr(" 箱")}</span>)}
              </div>
              <button className="reverse-apply-button" onClick={mode === "single" ? ()=>goToStep(6) : applyReversePlan} disabled={status === "working" || hasPendingDimensionChanges || reversePlan.recommendedTotal <= 0}><ShieldCheck size={17} />{mode === "single"
                ? status === "working" ? tr("正在同步双算法方案…") : tr("前往核对计算","Continue to review")
                : tr("将算术数量填入订单（随后计算）","Fill arithmetic quantities into order (calculate next)")}</button>
              <p className="reverse-note">{dirty
                ? tr("输入已修改，计算后再展示经过校验的统一建议。")
                : status === "working" && selectedCachedPlan
                  ? tr("当前所选算法已完成并可查看、打印或导出；另一套算法继续在后台独立计算。")
                  : status === "working"
                    ? tr("当前所选算法仍在计算；若另一算法先完成，可切换查看其已校验坐标。")
                : mode === "single"
                  ? tt`体积/载重先倒推上限，算法再验证真实可装量；当前统一建议 ${formatNumber(selectedFeasibleRecommendation.displayQuantity)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}。切换算法会同步切换整张坐标方案。`
                  : tr("倒推先保持当前 SKU 数量比例；箱型方向、门洞和碎片空间会影响最终实际利用率，应用后将用装箱算法重新验证。")}</p>
            </article>
</div></details>}
        </section>}
        {workflowStep===6&&<section className="wizard-page" aria-label={tr("第六步：核对计算","Step 6: Review and calculate")}>
          <div className="wizard-page-heading"><div><h2>{tr("核对后开始计算","Review and calculate")}</h2><p>{tr("确认柜型、包装、订单数量和装载规则。","Confirm the container, packaging, order quantities and loading rules.")}</p></div></div>
          <div className="workflow-review-grid">
            <article className="panel"><h3>{tr("柜型与装载方式","Container and method")}</h3>
              <strong>{workflow==="pallet-only"?tr("只打托","Palletize only"):tr(container.name)}</strong>
              {workflow!=="pallet-only"&&<p>{container.length} × {container.width} × {container.height} mm · {formatNumber(container.maxWeight)} kg</p>}
              <button type="button" className="button small" onClick={()=>goToStep(1)}>{tr("修改柜型","Edit container")}</button></article>
            <article className="panel"><h3>{tr("包装与托内布置","Packaging and layout")}</h3>
              {isPalletWorkflow?<ul className="review-packaging-specs">{palletSpecifications(palletBuild).filter(s=>s.maxPallets>0).map(s=><li key={s.id}><strong>{s.config.name}</strong><small>{s.config.length} × {s.config.width} mm · {tr("可用","Available")} {s.maxPallets} {tr("托","units")}</small></li>)}</ul>:<strong>{floorPallets?.name??tr("散箱直接装柜","Loose cartons")}</strong>}
              {isPalletWorkflow&&<p>{palletBuild.oneKitPerPallet?tr("一套一托","One kit per pallet"):tr("按包装限制打托","Palletize to packaging limits")} · {formatNumber(palletBuild.maxPallets)} {tr("托上限","pallet limit")}</p>}
              <button type="button" className="button small" onClick={()=>goToStep(4)}>{tr("查看布置","Review layout")}</button></article>
            <article className="panel"><h3>{tr("货物清单","Cargo manifest")}</h3>
              <strong>{formatNumber(activeProducts.length)} {tr("种箱规","carton types")}{mode==="mixed"&&` · ${formatNumber(activeProducts.reduce((sum,p)=>sum+p.quantity,0))} ${tr("箱","cartons")}`}</strong>
              {setInputSummaries.length>0&&<p>{mode==="mixed"?`${formatNumber(setInputSummaries.reduce((sum,set)=>sum+set.completeSets,0))} ${tr("完整套","complete kits")}`:`${setInputSummaries[0].cartonsPerSet} ${tr("箱/套","cartons per kit")}`}</p>}
              {workflow==="palletized"&&<p>{tr("待打托","To palletize")} {activeProducts.reduce((sum,p)=>sum+p.quantity-(palletBuild.looseQuantities?.[p.id]??0),0)} · {tr("直接散装","Loose")} {Object.values(palletBuild.looseQuantities??{}).reduce((sum,n)=>sum+n,0)} {tr("箱","cartons")}</p>}
              <button type="button" className="button small" onClick={()=>goToStep(3)}>{tr("修改货物","Edit cargo")}</button></article>
            <article className="panel"><h3>{tr("装载规则","Loading rules")}</h3>
              <strong>{loadingRules.layout==="layers"?tr("逐层摆放","Build in layers"):loadingRules.layout==="deep-first"?tr("从柜内深处开始","Load deep-first"):tr("自动布置","Automatic layout")}</strong>
              <p>{tr("现场易执行与高密度参考分别计算。","Practical and high-density plans are calculated independently.")}</p>
              <button type="button" className="button small" onClick={()=>goToStep(5)}>{tr("修改规则","Edit rules")}</button></article>
          </div>
        </section>}
        {workflowStep===7 && <section className="wizard-page" aria-label={tr("第七步：查看方案","Step 7: Results")}>
          <div className="wizard-page-heading"><div><h2>{tr(workflow === "pallet-only" ? "打托方案" : "装箱方案", workflow === "pallet-only" ? "Pallet plan" : "Loading plan")}</h2><p>{workflow==="pallet-only"?tr("独立托盘编组","Independent pallet layout"): <>{tr(result?.container.name ?? container.name)} · {isPalletWorkflow?tr("先打托，再装柜","Palletize first, then load"):floorPallets?tt`使用托盘 ${floorPallets.length} × ${floorPallets.width} × ${floorPallets.height} mm`:tr("直接装柜，无底层托盘")}</>}</p></div><button className="button" onClick={()=>goToStep(3)}><ChevronLeft size={16}/>{tr("修改货物或布置","Edit cargo or layout")}</button></div>
          <div className="plan-command-bar">
          <div className="result-strategy-switch" role="group" aria-label={tr("方案算法切换")}><button className={strategy==="practical"?"selected":""} aria-pressed={strategy==="practical"} onClick={()=>switchStrategy("practical")}><ShieldCheck size={18}/><span><strong>{tr("现场易执行")}</strong><small>{strategyLabel("practical", cachedPracticalPlan)}</small></span></button><button className={strategy==="maximum"?"selected":""} aria-pressed={strategy==="maximum"} onClick={()=>switchStrategy("maximum")}><Gauge size={18}/><span><strong>{tr("高密度参考")}</strong><small>{strategyLabel("maximum", cachedMaximumPlan)}</small></span></button></div>
          <div className="plan-command-actions"><details className="plan-calculation-menu"><summary className="button"><Settings2 size={15}/>{tr("计算设置", "Calculation settings")}</summary><div className="plan-calculation-panel">          <section className="calculation-controls" aria-label={tr("计算控制")}><label><input type="checkbox" checked={autoCalculate} onChange={e=>setAutoCalculate(e.target.checked)}/>{tr("方案阶段自动更新")}</label><label>{tr("计算时限")}<select aria-label={tr("计算时限")} value={calculationBudget} onChange={e=>setCalculationBudget(Number(e.target.value))}><option value={0}>{tr("按设备自动")}</option><option value={15}>{tr("15 秒")}</option><option value={35}>{tr("35 秒")}</option><option value={60}>{tr("60 秒")}</option><option value={120}>{tr("120 秒")}</option></select></label></section></div></details><button className="button primary" disabled={status==="working"||hasPendingDimensionChanges||invalidNumericFields.size>0} onClick={recalculatePlan}>{tr("重新计算方案")}</button>{status==="working"&&<button className="button" onClick={stopCalculation}>{tr("停止并保留已完成方案")}</button>}</div>

          </div>
          {result&&<div className="metrics-grid result-overview" aria-label={tr("装载结果摘要","Load result summary")}>
              <MetricCard
                icon={<PackageOpen size={21} />}
                label={result.mode === "single"
                  ? resultPlanLimitDisplay !== null
                    ? result.setSummaries.length ? tr("计划装载套数") : tr("计划装载箱数")
                    : result.setSummaries.length ? tr("最大可装套数") : tr("最大可装")
                  : tr("已装件数")}
                value={result.mode === "single" && result.setSummaries.length
                  ? tt`${formatNumber(result.setSummaries[0].loadedSets)} 套`
                  : tt`${formatNumber(result.metrics.loadedCount)} 件`}
                detail={result.mode === "single"
                  ? result.setSummaries.length ? tt`完整装入 ${formatNumber(result.metrics.loadedCount)} 箱` : tr("规则排布可执行数量")
                  : tt`需求 ${formatNumber(result.metrics.requestedCount)} 件`}
              />
              <MetricCard icon={<Layers3 size={21} />} label={tr("体积利用率")} value={formatPercent(result.metrics.volumeUtilization)} detail={`${(result.metrics.loadedVolume / 1_000_000_000).toFixed(2)} CBM`} tone="blue" />
              <MetricCard icon={<Weight size={21} />} label={tr("已装毛重")} value={`${formatNumber(result.metrics.grossWeight, 1)} kg`} detail={tt`载重利用 ${formatPercent(result.metrics.weightUtilization)}`} tone="amber" />
              <MetricCard icon={<ShieldCheck size={21} />} label={tr("方案复核", "Plan review")} value={planReview?.failed ? `${planReview.failed} ${tr("项不通过", "failed")}` : `${planReview?.unverified ?? 0} ${tr("项未核验", "unverified")}`} detail={tr("数据 · 几何 · 承重 · 路径 · 固定", "Data · Geometry · Bearing · Access · Securing")} tone={planReview?.failed ? "red" : "amber"} />
            </div>}
          {result&&<WorkbenchTabs label={tr("装柜结果","Loading results")} value={resultPane} onChange={setResultPane} items={[
            ["view",workflow==="pallet-only"?tr("打托预览","Pallet preview"):tr("装柜预览","Load preview")],["review",tr("装载明细与复核","Breakdown & review")],["exports",tr("清单与导出","Manifests & exports")],
          ]}/>}
          <div className="workbench-pane result-view-pane" hidden={!!result&&resultPane!=="view"}>
          {result&&!hasPendingDimensionChanges&&!resultAudit?.hasErrors&&<LoadingShortfall plan={result} products={activeProducts} onDetails={openLoadDiagnosis} onGuide={setGuide}/>}
          <section id="result" className="viewer-column">
            <div className="viewer-head">
              <div><h3>{tr("装载视图","Loading views")}</h3></div>
              <div className="viewer-status-group">
                {result?.mode === "single" ? <div className={`plan-context-chip ${result.strategy === "maximum" ? "capacity" : "planned"}`}><b>{result.strategy === "maximum" ? tr("高密度参考方案") : tr("现场计划方案")}</b><span>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? tr("套") : tr("箱")}{tr(" · 统一建议 ")}{formatNumber(selectedFeasibleRecommendation.displayQuantity)} {reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}{resultPlanningDelta ? ` · ${resultPlanningDelta > 0 ? "+" : "−"}${formatNumber(Math.abs(resultPlanningDelta))}` : tr(" · 一致")}</span></div> : null}
                <div className="validation-chip">{hasPendingDimensionChanges ? <LoaderCircle size={16} /> : result?.metrics.loadedCount === 0 ? <AlertTriangle size={16} /> : result?.validation.valid ? <CheckCircle2 size={16} /> : status === "working" ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{hasPendingDimensionChanges ? tr("尺寸录入中 · 已暂停计算") : result ? result.metrics.loadedCount === 0 ? tr("未装入货物，请查看原因", "No cargo loaded; review the causes") : result.validation.valid ? tr("布局校验通过") : tr("发现异常") : status === "working" ? tr("待重新计算") : tr("等待计算")}</div>
              </div>
            </div>
            {result?.metrics.loadedCount === 0 && <ZeroLoadNotice result={result} products={activeProducts} unit={lengthUnit} onEdit={id=>{goToStep(3);if(id)setActiveCargo(id);}}/>}
            {result ? (
              <PlanViews result={result} visibleProducts={visibleProducts} visibleCount={packingProgress}
                primaryCountLabel={progressSummary?.isSetMode ? tt`${formatNumber(progressSummary.completedSets)} 套` : tt`${formatNumber(packingProgress)} 箱`}
                secondaryCountLabel={progressSummary?.isSetMode ? tt`${formatNumber(progressSummary.visibleCartons)} 箱` : undefined}
                renderPrintSvg={renderPrintViews} activeView={cameraProjection==="orthographic"?cameraView:"free"} onViewSelect={selectOrthographicView}
                viewRevision={viewRevision}
                scene={              <SceneErrorBoundary resetKey={result.id}>
                <ContainerScene
                  result={result}
                  editor={planEditor}
                  locateRef={locateFromReviewRef}
                  products={activeProducts}
                  onAdopt={adoptManualPlan}
                  visibleProducts={visibleProducts}
                  visibleCount={packingProgress}
                  onVisibleCountChange={value=>{setIsPlaying(false);setPackingProgress(value);}}
                  cameraView={cameraView}
                  projectionMode={cameraProjection}
                  onCameraViewChange={setCameraView}
                  onProjectionModeChange={setCameraProjection}
                />
              </SceneErrorBoundary>}/>
            ) : (
              <div className="scene-shell" role="region" aria-label={tr("可交互三维装柜视图")}>
                <div className="scene-empty">
                  <div className="scene-empty-cube" aria-hidden="true" />
                  <strong>{status === "working" ? tr("正在同步最新方案") : tr("等待计算方案")}</strong>
                  <span>{status === "working" ? tr("所选算法完成后会立即显示；另一算法继续在后台计算") : tr("填写左侧参数后，柜内真实摆放会显示在这里")}</span>
                </div>
              </div>
            )}
            {result ? (
              <>
                <div className="packing-timeline">
                  <button className="timeline-play" onClick={togglePackingPlayback} disabled={!result.placements.length} aria-label={isPlaying ? tr("暂停码垛动画") : tr("播放码垛动画")}>{isPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
                  <div className="timeline-count">{progressSummary?.isSetMode
                    ? <><strong>{tr("整套 ")}{formatNumber(progressSummary.completedSets)} / {formatNumber(progressSummary.totalSets)}{tr(" 套")}</strong><span>{tr("箱级进度 ")}{formatNumber(progressSummary.visibleCartons)} / {formatNumber(progressSummary.totalCartons)}{tr(" 箱 · ")}{result.placements.length ? Math.round((packingProgress / result.placements.length) * 100) : 0}{tr("% · 柜内 → 箱门")}</span></>
                    : <><strong>{formatNumber(packingProgress)} / {formatNumber(result.placements.length)}{tr(" 箱")}</strong><span>{tr("动画进度，非整柜容量 · ","Playback, not container capacity · ")}{result.placements.length ? Math.round((packingProgress / result.placements.length) * 100) : 0}{tr("% · 柜内 → 箱门")}</span></>}</div>
                  <input aria-label={progressSummary?.isSetMode ? tr("套装箱级码垛进度") : tr("码垛进度")} type="range" min="0" max={Math.max(1, result.placements.length)} value={packingProgress} onChange={(event) => { setIsPlaying(false); setPackingProgress(numberValue(event.target.value)); }} />
                  <div className="timeline-step-controls" aria-label={tr("逐箱码垛控制")}>
                    <button onClick={() => movePackingProgress(-1)} disabled={packingProgress <= 0} aria-label={tr("上一步")}><ChevronLeft size={14} /></button>
                    <select aria-label={tr("播放速度")} value={playbackSpeed} onChange={(event) => setPlaybackSpeed(numberValue(event.target.value))}>
                      <option value={1}>1×</option>
                      <option value={2}>2×</option>
                      <option value={4}>4×</option>
                    </select>
                    <button onClick={() => movePackingProgress(1)} disabled={packingProgress >= result.placements.length} aria-label={tr("下一步")}><ChevronRight size={14} /></button>
                  </div>
                  <button className="timeline-all" onClick={() => { setIsPlaying(false); setPackingProgress(result.placements.length); }}>{tr("显示全部")}</button>
                </div>
                <div className="timeline-current" aria-live="polite">
                  {progressSummary?.currentPlacement
                    ? <><span>{progressSummary.isSetMode && progressSummary.currentSetNumber
                      ? tt`已完成 ${formatNumber(progressSummary.completedSets)}/${formatNumber(progressSummary.totalSets)} 套 · 当前箱归属套号 ${formatNumber(progressSummary.currentSetNumber)} · 套内 ${formatNumber(progressSummary.currentSetItemNumber ?? 1)}/${formatNumber(progressSummary.currentSetCartons ?? 1)} 箱`
                      : tt`当前第 ${formatNumber(progressSummary.visibleCartons)} 箱`}</span><strong>{progressSummary.currentPlacement.sku}{progressSummary.currentPlacement.setCode ? ` · ${progressSummary.currentPlacement.setCode}` : ""}</strong><b>{tt`坐标 ${formatNumber(progressSummary.currentPlacement.x)} / ${formatNumber(progressSummary.currentPlacement.y)} / ${formatNumber(progressSummary.currentPlacement.z)} mm · 第 ${progressSummary.currentPlacement.layer} 层`}</b></>
                    : <><span>{result.metrics.loadedCount === 0 ? tr("装载为空", "Empty load") : tr("准备开始")}</span><strong>{tr("尚未装入箱体")}</strong><b>{result.metrics.loadedCount === 0 ? tr("请查看上方零装载原因。", "Review the zero-load diagnosis above.") : tr("点击播放或下一步查看装柜顺序")}</b></>}
                </div>

              </>
            ) : null}
            {result ? (
              <>
                <div className="legend-row">
                  {result.summaries.map((item) => (
                    <button key={item.productId} className={visibleProducts.has(item.productId) ? "" : "muted"} onClick={() => toggleProductVisibility(item.productId)}>
                      <i style={{ background: item.color }} />
                      <span>{item.sku}</span>
                      <b>{formatNumber(item.loaded)}{tr(" 箱")}</b>
                    </button>
                  ))}
                </div>
                <RemainingCapacity result={result} visibleCount={packingProgress} pending={hasPendingDimensionChanges} />
                <details className="stage-options solver-comparison"><summary>{tr("两种算法对比","Compare solver results")}</summary>
                <section className="viewer-decision-grid" aria-label={tr("现场与极限方案统一对比")}>
                  <article className="current"><span>{tr("当前可视方案")}</span><strong>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? tr("套") : tr("箱")}</strong><small>{formatNumber(result.metrics.loadedCount)}{tr(" 箱 · 体积 ")}{formatPercent(result.metrics.volumeUtilization)}</small></article>
                  <article><span>{tr("现场易执行")}</span><strong>{practicalPredictionDisplay === null ? "—" : `${formatNumber(practicalPredictionDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong><small>{tr("经验率 ")}{practicalTargetPercent.toFixed(1)}{tr("% · 完整承托")}</small></article>
                  <article className="maximum"><span>{tr("高密度参考")}</span><strong>{maximumPredictionDisplay === null ? "—" : `${formatNumber(maximumPredictionDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong><small>{usesPracticalLowerBound ? tr("采用已复核的现场候选 · 非全局最优证明", "Reviewed practical candidate · no global optimum proof") : tr("启发式候选 · 非全局最优证明", "Heuristic candidate · no global optimum proof")}</small></article>
                  <article className="delta"><span>{tr("搜索增量")}</span><strong>{theoreticalGainDisplay === null ? "—" : `${theoreticalGainDisplay >= 0 ? "+" : ""}${formatNumber(theoreticalGainDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong><small>{theoreticalGainDisplay === null ? tr("等待另一算法完成", "Waiting for the other solver") : theoreticalGainDisplay < 0 ? tr("货物组合不同，请逐 SKU 复核", "Different cargo mixes; review each SKU") : theoreticalGainDisplay > 0 ? tr("用于反向优化现场分区") : usesPracticalLowerBound ? tr("采用已复核的现场候选", "Reviewed practical candidate adopted") : tr("当前两套算法数量一致，继续比较复杂度")}</small></article>
                </section></details>
              </>
            ) : null}
            {capacityTrial&&<details id="loading-diagnosis" className="result-capacity-details">
              <summary>{tr("装载诊断与补货试算", "Loading diagnosis and replenishment trials")}{result&&<small>{formatNumber(result.metrics.loadedCount)} / {formatNumber(result.metrics.requestedCount)} {tr("箱", "cartons")}</small>}</summary>
              {capacityTrial}
            </details>}
            <details className="viewer-input-details">
              <summary>{tr("输入快照", "Input snapshot")} · {activeProducts.length} SKU · {inputVolume.toFixed(2)} m³ · {formatNumber(inputWeight,1)} kg</summary>
              <section className="viewer-input-strip" aria-label={tr("当前统一输入快照")}>
                <article><span>{isSingleProductSet ? tr("包装箱型") : tr("SKU 数量")}</span><strong>{activeProducts.length}</strong><small>{mode === "single" ? tr("单品完整套装") : tr("按订单比例拼柜")}</small></article>
                <article><span>{mode === "single" ? isSingleProductSet ? tr("每套 CBM") : tr("单件 CBM") : tr("需求 CBM")}</span><strong>{inputVolume.toFixed(2)}</strong><small>{tr("由外箱尺寸自动计算")}</small></article>
                <article><span>{mode === "single" ? isSingleProductSet ? tr("每套毛重") : tr("单件毛重") : tr("需求毛重")}</span><strong>{formatNumber(inputWeight, 1)} kg</strong><small>{tr("柜型上限 ")}{formatNumber(result?.container.maxWeight ?? container.maxWeight)} kg</small></article>
                <article><span>{tr("当前约束")}</span><strong>{clearance} mm</strong><small>{tr("安全间隙 · 目标 ")}{targetVolumePercent}% / {targetWeightPercent}%</small></article>
              </section>
            </details>
          </section>

          </div>
        {result ? (
          <section className="result-section">
            <div className="workbench-pane result-review-pane" hidden={resultPane!=="review"}>
            <div className="result-title"><div><h2>{tr("方案结果")}</h2></div><span className="run-meta">{resultPlanLimitDisplay !== null
              ? tt`现场计划方案 · ${formatNumber(resultLoadedDisplay)} ${resultDisplayUnit === "set" ? tr("套") : tr("箱")}可执行${resultPlanLimitDisplay !== resultLoadedDisplay ? tt` · 算术上限 ${formatNumber(resultPlanLimitDisplay)} ${resultDisplayUnit === "set" ? tr("套") : tr("箱")}` : ""}`
              : result.strategy === "practical" ? tt`现场可执行上限 · 经验率 ${(result.practicalTargetUtilization * 100).toFixed(1)}%` : tr("高密度启发式结果 · 非最优性证明")}{tr(" · 算法 ")}{result.engineVersion} · {formatNumber(result.metrics.solveTimeMs, 1)} ms</span></div>
            <details className="result-method-details">
              <summary>{tr("算法对比与测算依据","Solver comparison and estimate details")}</summary>
            {result.mode === "single" && !dirty ? (
              <section className="planning-comparison" aria-label={tr("稳健计划量与当前装柜方案对比")}>
                <div className="planning-comparison-head">
                  <div><span className="section-kicker">PLAN TARGET × CAPACITY</span><strong>{tr("稳健计划量与装载上限分开核算")}</strong><small>{tr("计划量遵守 ")}{targetVolumePercent}{tr("% 体积 / ")}{targetWeightPercent}{tr("% 载重目标；装载上限只受空间、门洞、方向与最大载重约束。")}</small></div>
                  <b className={resultPlanningDelta === 0 ? "matched" : resultPlanningDelta > 0 ? "over" : "under"}>{resultPlanningDelta === 0
                    ? tr("与计划一致")
                    : `${resultPlanningDelta > 0 ? tr("超过计划") : tr("低于计划")} ${formatNumber(Math.abs(resultPlanningDelta))} ${resultDisplayUnit === "set" ? tr("套") : tr("箱")}`}</b>
                </div>
                <div className="planning-comparison-grid">
                  <article><span>{tr("统一建议量")}</span><strong>{formatNumber(selectedFeasibleRecommendation.displayQuantity)} {reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}</strong><small>{selectedFeasibleRecommendation.displayQuantity < reversePlan.recommendedDisplay ? tt`倒推 ${formatNumber(reversePlan.recommendedDisplay)}，受当前算法真实坐标上限限制` : reversePlan.limitingFactor === "volume" ? tt`受 ${targetVolumePercent}% 体积目标限制` : reversePlan.limitingFactor === "weight" ? tt`受 ${targetWeightPercent}% 载重目标限制` : tr("两个目标同时限制")}</small></article>
                  <article className={resultPlanLimitDisplay === null ? "selected" : ""}><span>{tr("当前坐标方案")}</span><strong>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? tr("套") : tr("箱")}</strong><small>{tr("实际体积 ")}{formatPercent(result.metrics.volumeUtilization)}{tr(" · 实际载重 ")}{formatPercent(result.metrics.weightUtilization)}</small></article>
                  <article className="explanation"><span>{tr("口径说明")}</span><strong>{resultPlanLimitDisplay !== null && resultLoadedDisplay < resultPlanLimitDisplay ? tr("当前搜索与规则限制", "Constrained by search and loading rules") : resultPlanLimitDisplay !== null ? tr("按计划封顶") : tr("按策略求上限")}</strong><small>{resultPlanLimitDisplay !== null && resultLoadedDisplay < resultPlanLimitDisplay ? tr("当前坐标方案未达到算术计划量；剩余空间不代表还能合法放入货物，有限搜索也不证明全局上限。", "The coordinate plan falls below the arithmetic target. Spare space does not guarantee more feasible cargo, and bounded search does not prove global capacity.") : resultPlanLimitDisplay !== null ? tr("当前方案主动保留安全余量，不代表柜内只能装这么多。") : tr("当前结果可以高于计划量，但绝不允许超过柜型最大载重。")}</small></article>
                </div>
              </section>
            ) : null}

            {result.strategyComparison && !dirty ? (
              <section className="strategy-comparison" aria-label={tr("现场与极限算法对比")}>
                <div className="strategy-comparison-head">
                  <div><span className="section-kicker">TWO INDEPENDENT SOLVERS</span><strong>{tr("现场算法 × 高密度参考算法")}</strong><small>{usesPracticalLowerBound ? tr("同源输入分别搜索；高密度方案已采用通过校验且逐订单行数量不减少的现场候选。", "Both searches use the same inputs. The high-density plan adopted a validated practical candidate without reducing any order row.") : tr("同一份输入分别计算；高密度结果只把安全子集反向下放到现场方案。")}</small></div>
                  <b className={result.strategyComparison.sameQuantity ? "matched" : "gain"}>{result.strategyComparison.sameQuantity
                    ? tr("当前数量一致")
                    : comparisonNeedsSkuReview ? tr("货物组合不同，需复核", "Different cargo mixes; review required") : tt`理论多 ${formatNumber(result.strategyComparison.gainQuantity)} ${result.strategyComparison.displayUnit === "set" ? tr("套") : tr("箱")}`}</b>
                </div>
                <div className="strategy-comparison-grid">
                  <article className={result.strategy === "practical" ? "selected" : ""}>
                    <span><ShieldCheck size={15} />{tr("现场易执行算法")}</span>
                    <strong>{formatNumber(result.strategyComparison.practical.displayQuantity)} {result.strategyComparison.displayUnit === "set" ? tr("套") : tr("箱")}</strong>
                    <small>{tr("体积 ")}{formatPercent(result.strategyComparison.practical.volumeUtilization)}{tr(" · 最多 ")}{result.strategyComparison.practical.executionComplexity.maxOrientationsPerSku}{tr(" 种水平朝向 · 侧翻 0 · ")}{formatNumber(result.strategyComparison.practical.solveTimeMs, 0)} ms</small>
                  </article>
                  <article className={result.strategy === "maximum" ? "selected maximum" : "maximum"}>
                    <span><Gauge size={15} />{tr("高密度参考算法")}</span>
                    <strong>{formatNumber(result.strategyComparison.maximum.displayQuantity)} {result.strategyComparison.displayUnit === "set" ? tr("套") : tr("箱")}</strong>
                    <small>{tr("体积 ")}{formatPercent(result.strategyComparison.maximum.volumeUtilization)}{tr(" · 最多 ")}{result.strategyComparison.maximum.executionComplexity.maxOrientationsPerSku}{tr(" 种方向 · 侧翻 ")}{formatNumber(result.strategyComparison.maximum.executionComplexity.tippedCartonCount)}{tr(" 箱 · ")}{formatNumber(result.strategyComparison.maximum.solveTimeMs, 0)} ms</small>
                  </article>
                  <article className="delta">
                    <span>{tr("可研究增量")}</span>
                    <strong>{comparisonNeedsSkuReview ? tr("组合待复核", "Cargo mix needs review") : result.strategyComparison.sameQuantity ? usesPracticalLowerBound ? tr("采用合法下界", "Valid lower bound adopted") : tr("已追平") : `+${formatPercent(result.strategyComparison.gainRatio)}`}</strong>
                    <small>{comparisonNeedsSkuReview ? tr("总箱数不能替代逐 SKU 的装载要求", "Total cartons cannot replace per-SKU loading requirements") : usesPracticalLowerBound ? tr("候选复用，不代表两次搜索自然收敛", "Candidate reuse does not mean independent convergence") : result.strategyComparison.sameQuantity ? tr("复杂摆法未增加数量") : tr("先看方向、侧翻与承托来源")}</small>
                  </article>
                </div>
                <div className="strategy-guidance-list">
                  {result.strategyComparison.guidance.map((item) => <article key={`${item.level}-${trText(item.title)}`} className={`guidance-${item.level}`}><b>{trText(item.title)}</b><span>{trText(item.detail)}</span></article>)}
                </div>
              </section>
            ) : null}

            {result.quoteEstimate && !dirty ? (
              <section className={`real-benchmark ${result.quoteEstimate.physicallyPossibleByBounds ? "bounds-ok" : "bounds-impossible"}`} aria-label={tr("报价预测与三维物理方案对比")}>
                <div className="real-benchmark-copy">
                  <span className="section-kicker">DUAL-TRACK ESTIMATE</span>
                  <strong>{tr("报价经验预测 × 三维物理方案")}</strong>
                  <small>{result.quoteEstimate.source === "historical-exact"
                    ? tt`已精确命中历史包装指纹：${result.quoteEstimate.matchedModels.map(model=>tr(model)).join(" / ")}；忠实重放该条报价记录，但不绕过物理校验。`
                    : result.quoteEstimate.source === "historical-near"
                      ? tt`尺寸/重量接近历史记录：${result.quoteEstimate.matchedModels.map(model=>tr(model)).join(" / ")}；仅作相近包装参考，不作为零误差记录，也不封顶三维现场方案。`
                      : tt`按当前柜型 ${result.quoteEstimate.calibratedCargoVolumeCbm.toFixed(2)} CBM 基线预测；${result.quoteEstimate.verifiedDataPoints} 个物理可行数据点留一验证：平均 ${result.quoteEstimate.backtestMeanErrorPct.toFixed(1)}%，90% 不超过 ${result.quoteEstimate.backtestP90ErrorPct.toFixed(1)}%，最差 ${result.quoteEstimate.backtestMaxErrorPct.toFixed(1)}%。`}</small>
                </div>
                <div><span>{tr("报价经验预测")}</span><strong>{formatNumber(result.quoteEstimate.predictedSets)}{tr(" 套")}</strong><small>{result.quoteEstimate.confidence === "verified" ? tr("完全相同包装 · 重放历史记录") : tt`典型误差约 ±${result.quoteEstimate.expectedErrorPct.toFixed(1)}%`}</small></div>
                <div><span>{tr("三维可执行方案")}</span><strong>{formatNumber(result.quoteEstimate.physicalLoadedSets)}{tr(" 套")}</strong><small>{tr("无重叠坐标 · 独立校验")}</small></div>
                <div className={result.quoteEstimate.physicallyPossibleByBounds ? (result.quoteEstimate.gapSets === 0 ? "matched" : "different") : "impossible"}>
                  <span>{result.quoteEstimate.physicallyPossibleByBounds ? tr("双轨差距") : tr("物理边界")}</span>
                  <strong>{result.quoteEstimate.physicallyPossibleByBounds
                    ? result.quoteEstimate.gapSets === 0
                      ? tr("完全一致")
                      : tt`${result.quoteEstimate.gapSets > 0 ? "+" : ""}${formatNumber(result.quoteEstimate.gapSets)} 套`
                    : tr("报价值不可三维实现")}</strong>
                  <small>{tr("体积边界 ")}{formatPercent(result.quoteEstimate.volumeBoundRatio)}{tr(" · 载重边界 ")}{formatPercent(result.quoteEstimate.weightBoundRatio)}</small>
                </div>
              </section>
            ) : null}

            <div className="execution-summary" aria-label={tr("现场执行复杂度")}>
              <span><b>{result.metrics.executionComplexity.maxOrientationsPerSku}</b>{tr(" 单 SKU 最大方向数")}</span>
              <span><b>{result.metrics.executionComplexity.orientationVariants}</b>{tr(" 全方案方向组合")}</span>
              <span className={result.metrics.executionComplexity.partialSupportCount ? "attention" : "safe"}><b>{result.metrics.executionComplexity.partialSupportCount}</b>{tr(" 局部支撑箱体")}</span>
              <span className={result.metrics.executionComplexity.tippedCartonCount ? "attention" : "safe"}><b>{result.metrics.executionComplexity.tippedCartonCount}</b>{tr(" 侧翻箱体")}</span>
              <small>{result.strategy === "practical" ? tr("装载顺序已按支撑依赖和柜头→柜门重排") : tr("极限模式可能增加现场操作复杂度")}</small>
            </div>
            </details>

            <div id="load-summary" className="result-grid">
              <div className="result-cargo-summary">
                <article className="panel summary-panel">
                  <div className="panel-head"><div><h3>{tr("SKU 装载明细")}</h3><span>{tr("已装、未装和装载完成率")}</span></div></div>
                  <div className="summary-list">
                    {result.summaries.map((item) => {
                      const completion = item.requested > 0 ? item.loaded / item.requested : 1;
                      return (
                        <div className="summary-item" key={item.productId}>
                          <i style={{ background: item.color }} />
                          <div className="summary-name"><strong>{item.sku}</strong><span>{tr(item.name)}</span></div>
                          <div className="progress"><span style={{ width: `${Math.min(100, completion * 100)}%`, background: item.color }} /></div>
                          <div className="summary-count"><strong>{item.loaded}</strong><span> / {item.requested}</span></div>
                          <div className={`unloaded ${item.unloaded ? "has-unloaded" : ""}`}>{item.unloaded ? tt`未装 ${item.unloaded}` : tr("已装完")}</div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              {result.setSummaries.length ? (
                <section className="set-summary-panel" aria-label={tr("成套装载结果")}>
                  <div className="set-summary-heading"><div><span className="section-kicker">SET LOADING</span><strong>{tr("完整套数校验")}</strong></div><small>{tr("原子批次装载 · 放不下时整套回滚")}</small></div>
                  <div className="set-summary-grid">
                    {result.setSummaries.map((setSummary) => (
                      <article key={setSummary.setCode} className={setSummary.unloadedSets ? "incomplete" : "complete"}>
                        <div className="set-summary-main"><span>{setSummary.setCode} · {setSummary.componentCount}{tr(" 种箱规 · ")}{setSummary.cartonsPerSet}{tr(" 箱/套")}</span><strong>{formatNumber(setSummary.loadedSets)} <small>/ {formatNumber(setSummary.requestedSets)}{tr(" 套")}</small></strong><b>{setSummary.unloadedSets ? tt`未装 ${formatNumber(setSummary.unloadedSets)} 套` : tt`全部成套 · 共 ${formatNumber(setSummary.loadedCartons)} 箱`}</b></div>
                        <div className="set-component-list">
                          {setSummary.items.map((item) => <span key={item.productId}><b>{item.sku}</b>{item.loadedQuantity}{tr(" 箱 · ")}{item.unitsPerSet}{tr(" 箱/套")}</span>)}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              </div>
              <article className="panel warning-panel">
                <div className="panel-head"><div><h3>{tr("校验与提示")}</h3><span>{tr("现场执行前仍需按实际箱号复核")}</span></div></div>
                <div className={`balance-box ${result.metrics.centerOfGravity.balanced ? "balanced" : "attention"}`}>
                  <div className="balance-copy">
                    <Crosshair size={17} />
                    <div><strong>{tr("重心分布")}</strong><span>{tr("长向 ")}{(result.metrics.centerOfGravity.longitudinalRatio * 100).toFixed(1)}{tr("% · 横向 ")}{(result.metrics.centerOfGravity.lateralRatio * 100).toFixed(1)}{tr("% · 高度 ")}{(result.metrics.centerOfGravity.heightRatio * 100).toFixed(1)}%</span></div>
                  </div>
                  <div className="balance-map" aria-label={tr("集装箱重心俯视位置")}>
                    <span className="balance-zone" />
                    <i style={{ left: `${Math.min(100, Math.max(0, result.metrics.centerOfGravity.longitudinalRatio * 100))}%`, top: `${Math.min(100, Math.max(0, result.metrics.centerOfGravity.lateralRatio * 100))}%` }} />
                  </div>
                  <b>{result.metrics.centerOfGravity.balanced ? tr("重心位于建议区间") : tr("重心偏离建议区间，请复核配重")}</b>
                </div>
                <div className={`validation-box ${result.metrics.loadedCount === 0 ? "incomplete" : result.validation.valid ? "valid" : "invalid"}`}>
                  {result.metrics.loadedCount === 0 ? <AlertTriangle size={20} /> : result.validation.valid ? <CheckCircle2 size={20} /> : <X size={20} />}
                  <div><strong>{result.metrics.loadedCount === 0 ? tr("未生成可执行装载方案", "No executable load plan was generated") : result.validation.valid ? tr("方案数据合法") : tr("方案校验未通过")}</strong><span>{result.metrics.loadedCount === 0 ? tr("空坐标通过数据检查不代表货物可以装入，请查看零装载原因。", "Valid empty coordinates do not establish loadability; review the zero-load diagnosis.") : result.validation.valid ? tr("所有箱体均在有效边界内，无重叠且未超载。") : trText(result.validation.errors[0])}</span></div>
                </div>
                <details className="result-warnings"><summary>{tr("方案提示","Plan notes")} · {result.warnings.length}</summary><ul className="warning-list">
                  {(result.warnings.length ? result.warnings : [tr("未发现门洞、载重或订单缺口告警。")]).map((warning) => <li key={trText(warning)}><CircleAlert size={15} />{trText(warning)}</li>)}
                </ul></details>
              </article>
            </div>

            <section id="plan-review" className="result-review-details" aria-label={tr("方案复核","Plan review")}>
                {planReview && <PlanReviewPanel report={planReview} plan={result} onLocate={planEditor.enabled?undefined:id=>{
                  setIsPlaying(false);setPackingProgress(result.placements.length);
                  setVisibleProducts(new Set(result.placements.map(box=>box.productId)));
                  locateFromReviewRef.current?.(id);
                  setViewRevision(v=>v+1);
                  scrollTo("result", true);
                }}/>}
                <LongSupportPanel plan={result} products={activeProducts}/>
                {resultAudit && <ResultAuditPanel report={resultAudit}/>}
                {result.container.engineering&&<VehicleEngineeringReview plan={result}/>}
            </section>

            </div>
            <div className="workbench-pane result-export-pane" hidden={resultPane!=="exports"}>
            <div className="feature-action-bar">{result&&<PalletOrderConsolidationButton plan={result} products={activeProducts} disabled={upgradesDisabled||dirty||!!resultAudit?.hasErrors} onAdopt={adoptManualPlan}/>}<button className="button" disabled={!canExport} onClick={()=>setShowViewer(true)}><Layers3 size={16}/>{tr("方案查看器","Plan viewer")}</button><button className="button" disabled={!canExport||exportingPdf} onClick={()=>void downloadPdf()}><Download size={16}/>{tr("下载 PDF")}</button></div>
            <ContainerAccessoryManifest result={result} products={activeProducts} disabled={upgradesDisabled||dirty||!!resultAudit?.hasErrors}/>
            <PalletManifest anchor="loaded-pallets" printing={renderPrintViews} layerTemplates={palletLayerTemplates} onLayerTemplatesChange={setPalletLayerTemplates} result={result} products={activeProducts} disabled={upgradesDisabled||dirty||!!resultAudit?.hasErrors} onAdopt={adoptManualPlan}/>
            <PlacementManifest result={result} printing={renderPrintViews} actions={<div className="panel-actions">
              <button className="button ghost small" onClick={printPlan} disabled={!canExport}><Printer size={15}/>{tr("打印指导书")}</button>
              <button className="button ghost small" onClick={exportJson} disabled={!canExport}><FileJson size={15}/>{tr("方案 JSON")}</button>
              <button className="button primary small" onClick={exportCsv} disabled={!canExport}><FileSpreadsheet size={15}/>{tr("导出坐标 CSV")}</button>
            </div>}/>
            </div>
          </section>
        ) : (
          <section className="empty-result"><PackageOpen size={30} /><div><strong>{status === "working" || (dirty && autoCalculate) ? tr("正在生成最新方案") : tr("等待计算")}</strong><span>{!autoCalculate ? tr("当前为手动计算，请完成录入后点击“计算方案”。") : tr("系统会自动生成双算法坐标并执行独立校验。")}</span></div></section>
        )}

        </section>}

        {workflowStep<7&&<div className="stage-action-bar">
          {workflowStep>1&&<button type="button" className="button ghost" onClick={()=>goToStep((workflowStep-1) as WorkflowStep)}><ChevronLeft size={17}/>{tr("上一步","Back")}</button>}
          <span className="stage-context">{workflow==="pallet-only"?tr("只打托","Palletize only"):tr(container.name)}
            {workflowStep===3&&` · ${formatNumber(activeProducts.length)} ${tr("个箱型","carton types")}`}</span>
          {workflowStep===6?
            <button type="button" className="button primary" disabled={setupInvalid||invalidNumericFields.size>0||hasPendingDimensionChanges||palletRecipePending} onClick={startConfiguredCalculation}>
              {workflow==="pallet-only"?tr("计算打托","Calculate pallets"):tr("计算装柜","Calculate loading")}<ChevronRight size={17}/>
            </button>:
            <button type="button" className="button primary" disabled={workflowStep===4&&isPalletWorkflow&&(!palletPreviewReady||palletRecipePending)}
              onClick={()=>goToStep((workflowStep+1) as WorkflowStep)}>
              {[
                isPalletWorkflow?tr("下一步 · 选包装","Next · Packaging"):tr("下一步 · 底托选项","Next · Floor options"),
                tr("下一步 · 录入货物","Next · Cargo"),
                isPalletWorkflow?tr("下一步 · 布置预览","Next · Layout"):tr("下一步 · 散箱布置","Next · Loose layout"),
                tr("下一步 · 装载规则","Next · Rules"),
                tr("下一步 · 核对计算","Next · Review"),
              ][workflowStep-1]}<ChevronRight size={17}/>
            </button>}
        </div>}
        </div>
        {toolsVisited&&<section className="workspace-toolbox" hidden={!toolsOpen}>
          {toolsOpen && workStatus}
          <div className="wizard-page-heading"><h2>{tr("项目与装柜工具","Project and loading tools")}</h2>
          <button type="button" className="button" onClick={()=>setToolsOpen(false)}><ChevronLeft size={16}/>{tr("返回装柜工作区","Back to loading workspace")}</button></div>
        <WorkflowTools active={toolGroup} onGroupChange={setToolGroup}
          projects={<>
          <ArchiveLibrary backup={workspaceBackup} disabled={upgradesDisabled} onRestore={backup=>{void restoreWorkspace(new File([backup],tr("工作区归档.json"),{type:"application/json"}));}} onProducts={replaceProductInputs}/>
          <QualityBenchmarks/>
          <ProductCatalog products={activeProducts} plan={resultAudit?.hasErrors?null:result} preparedLayout={preparedPalletLayout} disabled={upgradesDisabled} onProducts={replaceProductInputs}/>
          </>}
          loading={<>
          {!isPalletWorkflow && <PrebuiltPalletPanel key={JSON.stringify(fleetRequest)} request={fleetRequest} disabled={upgradesDisabled} onAdopt={next=>{const build=next.palletBuild??{...DEFAULT_PALLET_BUILD,config:next.palletization!.config,mix:next.palletization!.mix};palletDraftRef.current=null;setFloorPallets(undefined);setLoadingWorkflow("palletized");setPreparedPalletLayout(undefined);setPalletBuild(build);persistDraft({workflow:"palletized",palletBuild:build,preparedPalletLayout:undefined,floorPallets:undefined,strategy:next.strategy});strategyRef.current=next.strategy;setStrategy(next.strategy);setToolsOpen(false);setResultPane("view");setWorkflowStep(7);adoptManualPlan(next);}}/>}
          <DimensionScenarios key={JSON.stringify([fleetRequest,workflow,palletBuild,result?.id])} request={{...fleetRequest,workflow,palletBuild,floorPallets:isPalletWorkflow?undefined:floorPallets,singleCartonLimit:result?.singleCartonLimit}} result={dirty?null:result} disabled={upgradesDisabled||dirty} unit={lengthUnit} onProducts={next=>replaceProductInputs(products.map(p=>next.find(n=>n.id===p.id)??p))}/>
          <BearingRules key={JSON.stringify(products.map(p=>[p.id,p.maxTopLoadKg]))} products={activeProducts} disabled={upgradesDisabled} onChange={next=>replaceProductInputs(products.map(p=>next.find(n=>n.id===p.id)??p))}/>
          {mode === "mixed" && workflow!=="pallet-only" ? <FleetPlanner key={JSON.stringify([fleetRequest,customContainers,workflow,palletBuild])} request={{...fleetRequest,workflow,palletBuild:workflow==="palletized"?palletBuild:undefined,floorPallets:isPalletWorkflow?undefined:floorPallets}} customContainers={customContainers} disabled={upgradesDisabled||setupInvalid} initialFleet={pendingFleetTail} onInitialConsumed={consumeFleetTail} canApplyTail={!result?.deliveryIdentity&&!hasManualPreparation} onApplyTail={next=>{if(upgradesDisabled||setupInvalid||result?.deliveryIdentity||hasManualPreparation||!next.request.palletBuild)return false;setPendingFleetTail(next);applyPalletBuildTrial(next.request.palletBuild);return true;}}/> : null}
            {result && !hasPendingDimensionChanges ? <>
            <CrateStackPreflight key={result.id} plan={result} disabled={upgradesDisabled||dirty||!!resultAudit?.hasErrors}/>
            <UnloadedReasons result={result} products={activeProducts} onFocus={id=>{setVisibleProducts(new Set(result.summaries.map(s=>s.productId)));setCameraView("top");setPackingProgress(result.placements.length);setMessage(tt`已在原因面板突出 ${activeProducts.find(p=>p.id===id)?.sku??tr("当前 SKU")}；三维保留其他货物，避免把隐藏箱位误认为空闲空间。`);}}/>
            <ManualPlan key={result.id} editor={planEditor} result={result} products={activeProducts} disabled={upgradesDisabled||!result.validation.valid} onAdopt={next=>{clearActiveCalculation();setAutoCalculate(false);setResultBundle(next);setDirty(false);presentPlan(next);setStatus("done");setMessage(tr("已采用手动方案，三维、指标和导出已同步；自动重算已暂停。"));}}/>
            </> : <p className="tool-empty">{tr("计算方案后，可诊断余货并手动调整箱位。")}</p>}
          </>}
          delivery={result && !hasPendingDimensionChanges ? <>
            <DeliveryVersionPanel plan={result} disabled={!canExport} onIssue={adoptDeliveryVersion} backup={workspaceBackup}/>
            <WeighingPanel plan={result} disabled={!canExport} getRecords={getWeighingRecords} onRecords={receiveWeighingRecords}/>
            <EngineeringChecks plan={result} products={activeProducts} onAdopt={next=>adoptDeliveryVersion(issueDeliveryIdentity(next))} disabled={!canExport} getDocument={getEngineeringDocument} onDocument={receiveEngineeringDocument}/>
            <OperationsPanel plan={result} disabled={!canExport} getRecords={getOperationRecords} onRecords={receiveOperationRecords}/>
            <FieldJournalPanel plan={result} disabled={!canExport} onRecords={receiveFieldRecords} onLockLoaded={adoptLoadedLocks} getRecords={getKnownFieldRecords}/>
            {canExport ? <FieldGuide key={`field-${result.id}`} result={result} products={activeProducts}/> : null}
            <CustomerReportPanel plan={result} products={activeProducts} disabled={!canExport}/>
          </> : <p className="tool-empty">{tr("先完成一次装柜计算，再生成客户报告和现场指导书。")}</p>}
        />

        </section>}
        <footer className="app-footer"><span className="workspace-version">CargoFit · v{ENGINE_VERSION}</span><span>{tr("尺寸与柜型预设仅供测算，正式出货请复核实际数据")}</span></footer>
      </div>
    </main>
  );
}
