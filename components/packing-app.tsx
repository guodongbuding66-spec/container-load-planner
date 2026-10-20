"use client";
import {DeliveryVersionPanel} from "./delivery-version-panel";
import {ContainerAccessorySettings} from "./container-accessory-settings";
import {ContainerAccessoryManifest} from "./container-accessory-manifest";

import {
  Box,
  Boxes,
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
  PanelLeftClose,
  PanelLeftOpen,
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
import {adoptOrderDelivery,inheritOrderDelivery,orderDelivery,copyOrderRows,importOrderRows,updateOrderQuantities,assertOrderReferences,parseOrderLine} from "../lib/packing/order-lines";
import { shapeDetails, shapeCanSupport } from "../lib/packing/cargo-shape";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { CloudWorkspace } from "./cloud-workspace";
import { ProductCatalog, CustomerReportPanel } from "./product-catalog";
import { CrateStackPreflight } from "./crate-stack-preflight";
import { DimensionScenarios } from "./dimension-scenarios";
import { WorkflowTools } from "./workflow-tools";
import { ArchiveLibrary, BearingRules, UnloadedReasons, ManualPlan, FieldGuide, FleetPlanner } from "./planning-upgrades";
import { RemainingCapacity } from "./remaining-capacity";
import { SpaceModelPreview } from "./space-model-preview";
import { usePlanEditor } from "./use-plan-editor";
import { PalletBuildPreview } from "./pallet-build-preview";
import {parseSiteExclusions} from "../lib/packing/site-exclusions";
import {SiteExclusionSettings} from "./site-exclusion-settings";
import { PalletBuildSettings } from "./pallet-build-settings";
import { DEFAULT_PALLET_BUILD, parseLoadingWorkflow, parsePalletBuild } from "../lib/packing/loading-workflow";
import type { LoadingWorkflow, PalletBuildOptions } from "../lib/packing/types";
import { PrebuiltPalletPanel } from "./prebuilt-pallet-panel";
import {parsePalletLayerTemplates,type PalletLayerTemplate} from "../lib/packing/pallet-layer";
import { PalletManifest } from "./pallet-manifest";
import { LongSupportPanel } from "./long-support-panel";
import { PlanReviewPanel, ResultAuditPanel } from "./result-audit-panel";
import { reviewPlan } from "../lib/packing/plan-review";
import { auditPackingResult } from "../lib/packing/result-audit";
import { WorkflowSteps } from "./workflow-steps";
import { MAX_WORKSPACE_BYTES, parseWorkspaceBackup, restoreWorkspacePlans, serializeWorkspaceBackup, type WorkspaceInputs } from "../lib/packing/workspace-file";
import { OrthographicViews } from "./orthographic-views";
import { SceneErrorBoundary } from "./scene-error-boundary";

import { CargoSettings } from "./cargo-settings";
import { ZeroLoadNotice } from "./cargo-fit-notice";
import { LoadingRuleSettings } from "./loading-rule-settings";
import { TransportPicker } from "./transport-picker";
import { LearningHub } from "./learning-hub";
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
const PRODUCT_PAGE_SIZE = 100;
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
  const [showFloorPallets, setShowFloorPallets] = useState(false);
  const [loadingRules, setLoadingRules] = useState<LoadingRules>({...DEFAULT_LOADING_RULES});
  const [activeOrderLine,setActiveOrderLine]=useState<string|null>(null);
  const orderImportRevisionRef=useRef(0);
  const [orderImportMode,setOrderImportMode]=useState<"replace"|"append"|"quantity">("replace");
  const [activeCargo, setActiveCargo] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showTransport, setShowTransport] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [mode, setMode] = useState<PackingMode>("mixed");
  const [loadingWorkflow, setLoadingWorkflow] = useState<LoadingWorkflow>("direct");
  const [palletBuild, setPalletBuild] = useState<PalletBuildOptions>(() => structuredClone(DEFAULT_PALLET_BUILD));
  const workflow: LoadingWorkflow = mode === "single" ? "single-capacity" : loadingWorkflow === "single-capacity" ? "direct" : loadingWorkflow;
  const isPalletWorkflow = workflow === "pallet-only" || workflow === "palletized";
  const [strategy, setStrategy] = useState<PackingStrategy>("practical");
  const [practicalTargetPercent, setPracticalTargetPercent] = useState(
    recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100,
  );
  const [container, setContainer] = useState<ContainerSpec>({ ...CONTAINER_PRESETS[2] });
  const [clearance, setClearance] = useState(10);
  const [products, setProducts] = useState<ProductInput[]>(() => SAMPLE_PRODUCTS.map((item) => ({ ...item })));
  const [palletLayerTemplates,setPalletLayerTemplates]=useState<PalletLayerTemplate[]>([]);
  const [autoCalculate, setAutoCalculate] = useState(false);
  const [workflowStep,setWorkflowStep]=useState<1|2|3>(1);
  const [manualRun,setManualRun]=useState(0);
  const [setupInvalid,setSetupInvalid]=useState(false);
  const palletDraftRef=useRef<{value:FloorPalletConfig|undefined;invalid:boolean}|null>(null);
  const rulesDraftRef=useRef<{rules:LoadingRules;products:ProductInput[]}|null>(null);
  const [calculationBudget, setCalculationBudget] = useState(0);
  const [resultBundle, setResultBundle] = useState<PackingResult | null>(null);
  const [status, setStatus] = useState<CalcStatus>("idle");
  const [message, setMessage] = useState(tr("参数已就绪"));
  const [pendingRestore,setPendingRestore]=useState<{description:string;apply:()=>void}|null>(null);
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
  const [hasPendingDimensionChanges, setHasPendingDimensionChanges] = useState(false);
  const [packingProgress, setPackingProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [cameraView, setCameraView] = useState<CameraView>("perspective");
  const [cameraProjection, setCameraProjection] = useState<CameraProjection>("perspective");
  const [storageState, setStorageState] = useState<StorageState>("saved");
  const [productPage, setProductPage] = useState(0);
  const [showProductRules,setShowProductRules]=useState(false);
  const [renderPrintViews, setRenderPrintViews] = useState(false);
  const [solverSchedule, setSolverSchedule] = useState<SolverSchedule>("parallel");
  const workersRef = useRef<Partial<Record<PackingStrategy, Worker>>>({});
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
  }, [clearActiveCalculation]);

  const presentPlan = useCallback((plan: PackingResult) => {
    if (displayedPlanIdRef.current === plan.id) return;
    displayedPlanIdRef.current = plan.id;
    setVisibleProducts(new Set(plan.summaries.map((item) => item.productId)));
    setPackingProgress(plan.placements.length);
    setIsPlaying(false);
    setCameraView("perspective");
    setCameraProjection("perspective");
  }, []);

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
  }, [discardObsoleteCalculation, finishActiveCalculation, presentPlan]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved) as {
            workflow?: LoadingWorkflow;
            palletBuild?: PalletBuildOptions;
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
          if (data.palletBuild) setPalletBuild(parsePalletBuild(data.palletBuild));
          if (data.floorPallets) setFloorPallets(parseFloorPalletConfig(data.floorPallets));
          if (data.loadingRules) setLoadingRules(parseLoadingRules(data.loadingRules));
          if (data.mode === "single" || data.mode === "mixed") setMode(data.mode);
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
  }, []);

  const lastSavedDraftRef = useRef<Partial<WorkspaceInputs>>({});
  const persistDraft = useCallback((patch: Partial<WorkspaceInputs> = {}) => {
    if (!hydrated) return;
    try {
      const snapshot = { palletLayerTemplates, workflow, palletBuild, floorPallets, loadingRules, mode, strategy, practicalTargetPercent, container, clearance, products, customContainers, targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit, ...patch };
      lastSavedDraftRef.current = snapshot;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      setStorageState("saved");
    } catch {
      setStorageState("error");
      setMessage(tr("本机草稿保存失败：浏览器存储不可用或空间不足"));
    }
  }, [palletLayerTemplates,workflow,palletBuild,floorPallets,loadingRules, clearance, container, customContainers, hydrated, lengthUnit, mode, practicalTargetPercent, products, strategy, targetVolumePercent, targetWeightPercent, weightUnit]);

  useEffect(() => {
    if (!hydrated) return;
    lastSavedDraftRef.current = { palletLayerTemplates, workflow, palletBuild, floorPallets, loadingRules, mode, strategy, practicalTargetPercent, container, clearance, products, customContainers, targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit };
    const saveTimer = window.setTimeout(() => persistDraft(), STORAGE_SAVE_DELAY_MS);
    const saveBeforeLeaving = () => persistDraft(lastSavedDraftRef.current);
    window.addEventListener("pagehide", saveBeforeLeaving);
    return () => { window.clearTimeout(saveTimer); window.removeEventListener("pagehide", saveBeforeLeaving); };
  }, [palletLayerTemplates,hydrated, persistDraft, workflow, palletBuild, floorPallets, loadingRules, mode, strategy, practicalTargetPercent, container, clearance, products, customContainers, targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit]);

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
    if (!autoCalculate || workflowStep !== 3) setMessage(tr("输入已修改；完成货物与装载配置后，再统一计算方案。"));
  }, [autoCalculate, clearActiveCalculation, status, workflowStep]);

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
    setHasPendingDimensionChanges(false);
    setIsEditingDimensions(false);
    if (dimensionBlurTimerRef.current !== null) {
      window.clearTimeout(dimensionBlurTimerRef.current);
      dimensionBlurTimerRef.current = null;
    }
  }, []);

  const switchStrategy = (nextStrategy: PackingStrategy) => {
    if (strategy === nextStrategy) return;
    strategyRef.current = nextStrategy;
    setStrategy(nextStrategy);
    const cachedPlan = !dirty ? resultBundle?.strategyPlans?.[nextStrategy] : undefined;
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
  const setInputSummaries = useMemo(() => summarizeSetInputs(activeProducts), [activeProducts]);
  const totalProductPages = Math.max(1, Math.ceil(activeProducts.length / PRODUCT_PAGE_SIZE));
  const currentProductPage = Math.min(productPage, totalProductPages - 1);
  const skuCounts=useMemo(()=>{const map=new Map<string,number>();for(const p of activeProducts)map.set(p.sku,(map.get(p.sku)??0)+1);return map;},[activeProducts]);
  const pagedActiveProducts = useMemo(
    () => activeProducts.slice(currentProductPage * PRODUCT_PAGE_SIZE, (currentProductPage + 1) * PRODUCT_PAGE_SIZE),
    [activeProducts, currentProductPage],
  );
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
    ? Math.max(0, maximumPredictionDisplay - practicalPredictionDisplay)
    : null;
  const resultPlanningDelta = result && result.mode === "single"
    ? resultLoadedDisplay - selectedFeasibleRecommendation.displayQuantity
    : 0;
  const selectedPredictionQuantities = mode === "single" && reversePlan.displayUnit === "set"
    ? activeProducts.map((item) => ({
        productId: item.id,
        sku: item.sku,
        suggestedQuantity: selectedFeasibleRecommendation.displayQuantity * normalizedUnitsPerSet(item),
      }))
    : selectedCachedPlan
      ? selectedCachedPlan.summaries.map((item) => ({ productId: item.productId, sku: item.sku, suggestedQuantity: item.loaded }))
      : reversePlan.quantities;

  const containerChoices = useMemo(() => [...TRANSPORT_PRESETS, ...customContainers], [customContainers]);
  const hasKnownContainer = containerChoices.some((item) => item.id === container.id);

  const updateContainer = (field: keyof ContainerSpec, value: number) => {
    setContainer((current) => ({
      ...current,
      id: "custom-draft",
      name: tr("自定义柜型（未保存）"),
      [field]: value,
    }));
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
  }, [clearActiveCalculation]);

  const stageProductDimension = useCallback((id: string, field: DimensionField, value: number) => {
    beginDimensionEditTransaction();
    const current = pendingDimensionChangesRef.current.get(id) ?? {};
    pendingDimensionChangesRef.current.set(id, { ...current, [field]: value });
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
  }, [markDirty]);

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

  const removeProduct = (id: string) => {
    clearNumericDraftErrors();
    setProducts((current) => (current.length <= 1 ? current : current.filter((item) => item.id !== id)));
    markDirty();
  };

  const loadSample = () => {
    setWorkflowStep(1);setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    clearNumericDraftErrors();
    setMode("mixed");
    setStrategy("practical");
    setTargetVolumePercent(85);
    setTargetWeightPercent(90);
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(SAMPLE_PRODUCTS.map((item) => ({ ...item })));
    setResultBundle(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage(tr("已载入户外产品拼柜示例"));
  };

  const loadDimensionTest = () => {
    setWorkflowStep(1);setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
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
    setWorkflowStep(1);setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    clearNumericDraftErrors();
    setMode("single");
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
    setMessage(tr("已载入单品 1 套 2 箱：保持单品模式，自动计算最大完整套数，无需填写需求箱数"));
  };

  const loadMultiCartonSetTest = () => {
    setWorkflowStep(1);setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
    clearNumericDraftErrors();
    setMode("single");
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
    setMessage(tr("已载入单品 1 套 5 箱；保持单品模式，3 箱、4 箱及更多箱型使用同一通用算法。"));
  };

  const loadRealA64M = () => {
    setWorkflowStep(1);setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
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
    setWorkflowStep(1);setFloorPallets(undefined);palletDraftRef.current=null;rulesDraftRef.current=null;
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
  }, [acceptResult, calculationBudget, clearActiveCalculation, discardObsoleteCalculation, presentPlan]);

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
  }, [workflow,palletBuild,isPalletWorkflow,floorPallets,loadingRules, activeProducts, clearance, clearActiveCalculation, container, hasPendingDimensionChanges, isEditingDimensions, mode, practicalTargetPercent, reversePlan, submitPacking, validateInputs]);

  useEffect(() => {
    if (workflowStep !== 3 || manualRun || status === "working" || !autoCalculate || !hydrated || isEditingDimensions || hasPendingDimensionChanges) return;
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
    if (!result?.validation.valid || resultAudit?.hasErrors || dirty || hasPendingDimensionChanges) return;
    setIsPlaying(false);
    flushSync(() => setRenderPrintViews(true));
    window.requestAnimationFrame(() => window.print());
  };

  const backupWorkspace = () => {
    if (hasPendingDimensionChanges || invalidNumericFields.size) {
      setMessage(tr("请先完成数字和尺寸录入，再备份工作区。"));
      return;
    }
    const contents = serializeWorkspaceBackup(
      { palletLayerTemplates, workflow, palletBuild, floorPallets, loadingRules, mode, strategy, practicalTargetPercent, container, clearance, products, customContainers,
        targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit }, ENGINE_VERSION, result, resultBundle?.strategyPlans,
    );
    downloadFile(tt`装柜工作区_${new Date().toISOString().slice(0, 10)}.json`, contents, "application/json");
    setMessage(tr("工作区已导出，可跨设备恢复；已完成方案的箱位会在恢复时重新校验。"));
  };

  const restoreWorkspace = async (file: File) => {
    const revision = inputRevisionRef.current;
    try {
      if (file.size > MAX_WORKSPACE_BYTES) throw new Error(tt`工作区备份不能超过 ${MAX_WORKSPACE_BYTES / 1024 / 1024} MB。`);
      const contents = await file.text();
      const restored = parseWorkspaceBackup(contents);
      const restoredPlan = restoreWorkspacePlans(contents, restored);
      if (revision !== inputRevisionRef.current || pendingDimensionChangesRef.current.size > 0) {
        throw new Error(tr("读取文件期间输入发生变化，请完成录入后重新选择备份。"));
      }
      const description=tt`恢复包含 ${restored.products.length} 个箱型的工作区？当前输入将被替换。${restoredPlan ? tr("已保存箱位通过当前规则校验，将一并恢复。") : tr("恢复后将使用当前算法重新计算。")}`;
      const apply=()=>{
      if(revision!==inputRevisionRef.current||pendingDimensionChangesRef.current.size>0){setPendingRestore(null);setMessage(tr("当前输入已变化，请重新选择需要恢复的工作区。"));return;}
      setPendingRestore(null);
      clearActiveCalculation();
      clearNumericDraftErrors();
      setLoadingWorkflow(parseLoadingWorkflow(restored.workflow,restored.mode));
      setPalletLayerTemplates(restored.palletLayerTemplates??[]);
      setPalletBuild(restored.palletBuild ?? structuredClone(DEFAULT_PALLET_BUILD));
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
        setWorkflowStep(3);
        setResultBundle(restoredPlan);
        setDirty(false);
        presentPlan(restoredPlan);
        setStatus("done");
        setMessage(tr("已恢复并重新校验历史箱位、锁定标记与输入参数；自动重算已暂停。"));
      } else {
        setAutoCalculate(false);
        setWorkflowStep(1);
        setMessage(tr("已恢复工作区输入，请确认货物与装载配置后计算。"));
      }
      };
      setPendingRestore({description,apply});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr("工作区恢复失败，当前输入未修改。"));
    }
  };

  const exportJson = () => {
    if (!result?.validation.valid || resultAudit?.hasErrors || dirty || hasPendingDimensionChanges) return;
    const selectedPlanOnly = { ...result, strategyPlans: undefined };
    downloadFile(
      tt`装柜方案_${result.container.id}_${result.strategy}_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(selectedPlanOnly, null, 2),
      "application/json",
    );
  };

  const exportCsv = () => {
    if (!result?.validation.valid || resultAudit?.hasErrors || dirty || hasPendingDimensionChanges) return;
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
      setStatus("error");
      setMessage(tt`CSV / Excel 文件不能超过 ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB。`);
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
      const importedMode = orderImportMode==="replace"?inferImportedPackingMode(next):"mixed";
      clearNumericDraftErrors();
      if(importedMode==="mixed"&&workflow==="single-capacity")setLoadingWorkflow("direct");
      setProducts(next);
      setMode(importedMode);
      setResultBundle(null);
      markDirty();
      setStatus("idle");
      setMessage(orderImportMode==="quantity"?tr("已按稳定 ID 更新数量，箱规、客户、批次和包装规则保留。","Quantities updated by stable ID; dimensions, customer, batch and packaging rules are preserved."):orderImportMode==="append"?tr("已追加新订单行并生成新 ID，请核对数量和套装编码。","New order rows appended with new IDs; review quantities and kit codes."):importedMode === "single"
        ? tt`已识别同一套装编码，按单品多箱模式导入 ${next.length} 个箱型；将直接计算完整套数`
        : tt`已导入 ${next.length} 个 SKU，请检查后计算`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : tr("CSV 读取失败，请检查文件后重试。"));
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

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const workspaceBackup = useMemo(() => serializeWorkspaceBackup({palletLayerTemplates,workflow,palletBuild,floorPallets,loadingRules,mode,strategy,practicalTargetPercent,container,clearance,products,customContainers,targetVolumePercent,targetWeightPercent,lengthUnit,weightUnit},ENGINE_VERSION,result,resultBundle?.strategyPlans), [palletLayerTemplates,workflow,palletBuild,floorPallets,loadingRules,mode,strategy,practicalTargetPercent,container,clearance,products,customContainers,targetVolumePercent,targetWeightPercent,lengthUnit,weightUnit,result,resultBundle?.strategyPlans]);
  const upgradesDisabled = hasPendingDimensionChanges || isEditingDimensions || invalidNumericFields.size > 0 || status === "working";
  const adoptDeliveryVersion=(next:PackingResult)=>{
    const inputs=parseWorkspaceBackup(workspaceBackup);
    const backup=serializeWorkspaceBackup(inputs,ENGINE_VERSION,next,{[next.strategy]:next});
    downloadFile(`delivery-${next.deliveryIdentity!.planId}-v${next.deliveryIdentity!.revision}.json`,backup,"application/json");
    clearActiveCalculation();setAutoCalculate(false);setResultBundle(next);setDirty(false);presentPlan(next);setStatus("done");
    setMessage(tr("交付版本已登记并下载；请保留备份，修改后重新发布版本。","Delivery version issued and downloaded. Keep the backup and issue a new revision after edits."));
  };
  const adoptManualPlan=(next:PackingResult)=>{const rows=adoptOrderDelivery(products,next.delivery??result?.delivery);setProducts(rows);next={...next,cargoDetails:Object.fromEntries(rows.filter(p=>next.summaries.some(s=>s.productId===p.id)).map(p=>[p.id,shapeDetails(p)])),delivery:orderDelivery(rows.filter(p=>next.summaries.some(s=>s.productId===p.id)),next.delivery??result?.delivery),accessConfig:next.accessConfig??result?.accessConfig,handlingTasks:next.handlingTasks??result?.handlingTasks};clearActiveCalculation();setAutoCalculate(false);setResultBundle(next);setDirty(false);presentPlan(next);setStatus("done");setMessage(tr("已采用手动方案，三维、指标和导出已同步；自动重算已暂停。"));};

  const planEditor=usePlanEditor(result,activeProducts,upgradesDisabled||!result?.validation.valid||result.metrics.loadedCount!==result.placements.length,adoptManualPlan);
  const fleetRequest: PackingRequest = {delivery:orderDelivery(activeProducts,Object.fromEntries(Object.entries(result?.delivery??{}).filter(([id])=>activeProducts.some(p=>p.id===id&&!p.orderLine)))),accessConfig:result?.accessConfig, floorPallets, loadingRules, mode, strategy, practicalTargetUtilization: practicalTargetPercent / 100, container, clearance, products: activeProducts };

  const downloadExcelTemplate = async () => { setMessage(tr("正在生成 Excel 模板…")); try { const { createSpreadsheetTemplate } = await import("../lib/packing/spreadsheet"); const bytes=await createSpreadsheetTemplate(); const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));const a=document.createElement("a");a.href=url;a.download="CargoFit_products_template.xlsx";document.body.appendChild(a);a.click();a.remove();setMessage(tr("Excel 模板已生成。"));setTimeout(()=>URL.revokeObjectURL(url),10000); } catch(e) {setMessage(e instanceof Error?e.message:"Excel export failed");} };
  const downloadPdf = async () => { if(!result?.validation.valid||resultAudit?.hasErrors||dirty||hasPendingDimensionChanges)return;setExportingPdf(true);try{const {downloadPdfGuide}=await import("../lib/packing/pdf-guide");await downloadPdfGuide(result,getAppLanguage(),activeProducts);}catch(e){setMessage(e instanceof Error?e.message:"PDF export failed");}finally{setExportingPdf(false);} };
  const loadIndustryCase = (example: IndustryCase) => {setWorkflowStep(1);palletDraftRef.current=null;rulesDraftRef.current=null;clearNumericDraftErrors();setMode("mixed");setLoadingWorkflow("direct");setContainer({...example.container});setProducts(example.products.map(p=>({...p})));setFloorPallets(undefined);setLoadingRules({...DEFAULT_LOADING_RULES});setClearance(10);setProductPage(0);setAutoCalculate(false);setPracticalTargetPercent(recommendedPracticalTarget(example.container)*100);markDirty();scrollTo("workspace");};
  const tutorialAction = (step: string) => {if(step==="cargo"){setActiveCargo(activeProducts[0]?.id??null);return;}if(step==="rules"){setShowRules(true);return;}if(step==="calculate"){goToStep(2);return;}if(step==="viewer"){if(result)setShowViewer(true);else setMessage(tr("请先计算有效方案。","Calculate a valid plan first."));return;}if(step==="pdf"){void downloadPdf();return;}if(step==="cloud"){const el=document.getElementById("cloud-workspace");if(el instanceof HTMLDetailsElement)el.open=true;scrollTo("cloud-workspace");return;}goToStep(1);};

  const receivePalletDraft=useCallback((value:FloorPalletConfig|undefined,invalid:boolean)=>{
    const previous=palletDraftRef.current;
    if(previous && (JSON.stringify(previous.value)!==JSON.stringify(value)||previous.invalid!==invalid)) markDirty();
    palletDraftRef.current={value,invalid};setSetupInvalid(invalid);
  },[markDirty]);
  const receiveRulesDraft=useCallback((rules:LoadingRules,nextProducts:ProductInput[])=>{
    const previous=rulesDraftRef.current;
    if(previous && (JSON.stringify(previous.rules)!==JSON.stringify(rules)||JSON.stringify(previous.products)!==JSON.stringify(nextProducts))) markDirty();
    rulesDraftRef.current={rules,products:nextProducts};
  },[markDirty]);
  const commitSetup=()=>{
    const base=palletDraftRef.current;
    const rules=rulesDraftRef.current;
    if(base?.invalid){setMessage(tr("托盘参数尚未完成，请先修正。"));return false;}
    const patch={floorPallets:base?base.value:floorPallets,loadingRules:rules?.rules??loadingRules,products:rules?.products??products};
    setFloorPallets(patch.floorPallets);setLoadingRules(patch.loadingRules);setProducts(patch.products);persistDraft(patch);
    return true;
  };
  const goToStep=(step:1|2|3)=>{
    if(step===workflowStep)return;
    if(step===2&&workflowStep===1){
      const next=activeProducts.map(p=>({...p,...pendingDimensionChangesRef.current.get(p.id)}));
      if(invalidNumericFields.size||!next.length||next.some(p=>!p.sku.trim()||p.length<=0||p.width<=0||p.height<=0||p.weight<0||(mode==="mixed"&&p.quantity<0))){setStatus("error");setMessage(tr("请先完成货物 SKU、完整尺寸、毛重和需求数量。"));return;}
      commitPendingDimensions();
    }
    if(step===3&&!result&&status!=="working"){setMessage(tr("请在第二步确认配置，并点击开始计算。"));return;}
    if(workflowStep===2&&!commitSetup())return;
    if(step!==3&&status==="working"){clearActiveCalculation();setStatus("idle");setMessage(tr("已暂停计算，可继续修改配置。"));}
    if(step===2){palletDraftRef.current=null;rulesDraftRef.current=null;setSetupInvalid(false);}
    setWorkflowStep(step);window.requestAnimationFrame(()=>document.querySelector('.wizard-steps')?.scrollIntoView({behavior:"smooth",block:"start"}));
  };
  const advanceToConfiguration=()=>{
    if(invalidNumericFields.size){setMessage(tr("请先完成所有数字输入。"));return;}
    const next=activeProducts.map(p=>({...p,...pendingDimensionChangesRef.current.get(p.id)}));
    if(!next.length||next.some(p=>!p.sku.trim()||p.length<=0||p.width<=0||p.height<=0||p.weight<0||(mode==="mixed"&&p.quantity<0))){setStatus("error");setMessage(tr("请填写有效 SKU、完整尺寸、重量和需求数量。"));return;}
    commitPendingDimensions();goToStep(2);
  };
  const startConfiguredCalculation=()=>{
    if(!commitSetup())return;
    const error=validateInputs();
    if(error){setStatus("error");setMessage(error);return;}
    setWorkflowStep(3);setAutoCalculate(false);setManualRun(v=>v+1);
    window.requestAnimationFrame(()=>document.querySelector('.wizard-steps')?.scrollIntoView({behavior:"smooth",block:"start"}));
  };
  const canExport = Boolean(result?.validation.valid && result.metrics.loadedCount > 0 && !resultAudit?.hasErrors && !dirty && !hasPendingDimensionChanges);

  return (
    <main className={`app-shell compact-workspace ${navCollapsed ? "nav-collapsed" : "nav-expanded"}`}>
      {pendingRestore?<section className="restore-confirm" role="region" aria-label={tr("确认恢复工作区")}><strong>{tr("确认恢复工作区")}</strong><p>{pendingRestore.description}</p><div className="upgrade-actions"><button className="button primary" onClick={pendingRestore.apply}>{tr("确认恢复")}</button><button className="button" onClick={()=>setPendingRestore(null)}>{tr("取消恢复")}</button></div></section>:null}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Container size={22} /></div>
          <div><strong>{tr("装柜智算")}</strong><span>CargoFit Workspace</span></div>
        </div>
        <button className="sidebar-toggle" aria-label={tr(navCollapsed ? "展开导航" : "收起导航", navCollapsed ? "Expand navigation" : "Collapse navigation")} aria-expanded={!navCollapsed} onClick={()=>setNavCollapsed(v=>!v)}>{navCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>
        <nav className="step-nav" aria-label={tr("页面导航")}>
          <button title={tr("测算工作台")} aria-label={tr("测算工作台")} className={workflowStep===2?"active":""} onClick={() => goToStep(2)}><Gauge size={18} /><span>{tr("测算工作台")}</span><b>01</b></button>
          <button title={tr("产品与订单")} aria-label={tr("产品与订单")} className={workflowStep===1?"active":""} onClick={() => goToStep(1)}><Boxes size={18} /><span>{tr("产品与订单")}</span><b>02</b></button>
          <button title={tr("三维方案")} aria-label={tr("三维方案")} className={workflowStep===3?"active":""} onClick={() => goToStep(3)}><Layers3 size={18} /><span>{tr("三维方案")}</span><b>03</b></button>
          <button title={tr("坐标与导出")} aria-label={tr("坐标与导出")} onClick={() => {goToStep(3);window.setTimeout(()=>scrollTo("coordinates"),0);}}><FileSpreadsheet size={18} /><span>{tr("坐标与导出")}</span><b>04</b></button>
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <div><strong>{tr("本机计算")}</strong><span>{tr("产品与订单数据默认不上传")}</span></div>
        </div>
        <div className="sidebar-version"><span>ENGINE</span><strong>v{ENGINE_VERSION}</strong></div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">{tr("外贸报价 · 拼柜计划 · 三维复核")}</span>
            <h1>{tr("新建装柜测算")}</h1>
          </div>
          <div className="top-actions">
            <span className={`save-state ${dirty || hasPendingDimensionChanges ? "is-dirty" : ""} ${storageState === "error" ? "is-error" : ""}`}><Save size={15} />{storageState === "error" ? tr("草稿未能保存") : hasPendingDimensionChanges ? tr("尺寸录入中 · 尚未提交") : dirty ? tr("草稿自动保存 · 待重算") : tr("本机草稿已保存")}</span>
            <details className="workspace-file-menu">
              <summary className="button ghost"><FileJson size={16} />{tr("文件与备份")}</summary>
              <div className="workspace-file-panel">
            <button className="button ghost" onClick={loadSample}><Sparkles size={16} />{tr("载入示例")}</button>
            <button className="button ghost" onClick={printPlan} disabled={!canExport}><Printer size={16} />{tr("现场指导书")}</button>

                <button type="button" className="button ghost" onClick={exportJson} disabled={!canExport}><FileJson size={16} />{tr("导出当前方案")}</button>
                <button type="button" className="button ghost" onClick={backupWorkspace} disabled={hasPendingDimensionChanges || invalidNumericFields.size > 0}><Download size={16} />{tr("备份工作区")}</button>
                <button type="button" className="button ghost" onClick={() => workspaceInputRef.current?.click()} disabled={hasPendingDimensionChanges}><Upload size={16} />{tr("恢复工作区")}</button>
                <p>{tr("备份箱规、套装、柜型、目标与单位，可跨设备恢复。包含已完成方案时，重新校验后恢复箱位；仅有输入时重新计算。")}</p>
              </div>
            </details>
            <input ref={workspaceInputRef} type="file" accept=".json,application/json" aria-label={tr("选择工作区备份文件")} hidden onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void restoreWorkspace(file);
            }} />
        <LearningHub onCase={loadIndustryCase} onStep={tutorialAction} integration={JSON.stringify({schema:"cargo-fit-integration-v1",units:{length:"mm",weight:"kg",volume:"mm3"},runtime:"local-web-worker",request:fleetRequest,result:result?{...result,strategyPlans:undefined}:null},null,2)}/>
          </div>
        </header>


        {showTransport && <TransportPicker selected={container} customContainers={customContainers} onCustomChange={spaces=>{setCustomContainers(spaces);persistDraft({customContainers:spaces});}} onSelect={space=>{persistDraft({container:space,practicalTargetPercent:recommendedPracticalTarget(space)*100});clearNumericDraftErrors();setContainer(space);setPracticalTargetPercent(recommendedPracticalTarget(space)*100);markDirty();}} onClose={()=>setShowTransport(false)}/>}
        {showFloorPallets && <FloorPalletSettings config={floorPallets} container={container} clearance={clearance} customSpaces={customContainers} onClose={()=>setShowFloorPallets(false)} onSave={next=>{persistDraft({floorPallets:next});setFloorPallets(next);markDirty();}}/>}
        {showRules && <LoadingRuleSettings rules={loadingRules} products={products} onSave={(rules,next)=>{persistDraft({loadingRules:rules,products:next});setLoadingRules(rules);setProducts(next);markDirty();}} onClose={()=>setShowRules(false)}/>}
        {activeOrderLine&&products.find(p=>p.id===activeOrderLine)&&<OrderLineEditor key={activeOrderLine} product={products.find(p=>p.id===activeOrderLine)!} delivery={result?.delivery} onSave={line=>{setProducts(current=>current.map(p=>p.id===activeOrderLine?{...p,orderLine:line}:p));setActiveOrderLine(null);markDirty();}} onCopy={()=>{try{const rows=copyOrderRows(inheritOrderDelivery(products,result?.delivery),activeOrderLine);if(rows.length>MAX_CSV_ROWS)throw Error(tr("订单行超过上限","Order-line limit exceeded"));setProducts(rows);setMode("mixed");if(workflow==="single-capacity")setLoadingWorkflow("direct");setActiveOrderLine(null);markDirty();}catch(e){setMessage(String(e instanceof Error?e.message:e));}}} onClose={()=>setActiveOrderLine(null)}/>}
        {activeCargo && products.find(p=>p.id===activeCargo) && <CargoSettings product={products.find(p=>p.id===activeCargo)!} mode={mode} lengthUnit={lengthUnit} weightUnit={weightUnit} container={container} clearance={clearance} strategy={strategy} onSave={product=>{if(product.cargoType !== products.find(p=>p.id===product.id)?.cargoType) product = {...product,minimumSupportRatio:loadingRules.supportByType?.[product.cargoType ?? "carton"]};persistDraft({products:products.map(p=>p.id===product.id?product:p)});clearNumericDraftErrors();setProducts(current=>current.map(p=>p.id===product.id?product:p));markDirty();}} onClose={()=>setActiveCargo(null)}/>}
        {showViewer && result && <PlanViewer plans={[result]} exportsBlocked={!canExport} onClose={()=>setShowViewer(false)}/>}

        <WorkflowSteps palletOnly={workflow === "pallet-only"} current={workflowStep} resultAvailable={Boolean(result)||status==="working"} onSelect={goToStep}/>

        <section className="status-strip" aria-live="polite">
          <div className={`status-dot status-${status}`} />
          <span>{trText(message)}</span>
          {status === "working" ? <LoaderCircle size={16} className="spin" /> : status === "done" ? <CheckCircle2 size={16} /> : status === "error" ? <CircleAlert size={16} /> : null}
        </section>

        {result ? (
          <header className="print-report-title">
            <div><span>LOADING INSTRUCTION</span><h1>{tr("集装箱装柜作业指导书")}</h1></div>
            <dl><div><dt>{tr("方案编号")}</dt><dd>{result.id}</dd></div><div><dt>{tr("柜型")}</dt><dd>{tr(result.container.name)}</dd></div><div><dt>{tr("生成时间")}</dt><dd>{new Date(result.createdAt).toLocaleString("zh-CN")}</dd></div></dl>
          </header>
        ) : null}

        {workflowStep===1 && <section className="wizard-page" aria-label={tr("第一步：货物清单")}>
          <div className="wizard-page-heading"><div><span className="section-kicker">STEP 01</span><h2>{tr("货物清单")}</h2><p>{tr("先录入完整箱规、毛重与数量，再确认装载空间。")}</p></div><div className="wizard-input-summary"><strong>{activeProducts.length}{tr(" 个箱型")}</strong><span>{inputVolume.toFixed(2)} m³ · {formatNumber(inputWeight,1)} kg{mode==="single"?tr(" / 单件或单套"):tr(" / 订单")}</span></div></div>
          <article className="panel wizard-mode"><h3>{tr("计算模式")}</h3>              <div className="loading-workflow-options" role="group" aria-label={tr("装载方式", "Loading workflow")}>
                {([ ["direct", "直接装箱", "Direct load", "多 SKU 拼柜"], ["pallet-only", "只打托不装箱", "Palletize only", "订单 → 独立托盘"], ["palletized", "先打托后装箱", "Palletize then load", "订单 → 整托 → 装柜"], ["single-capacity", "单品单箱测算", "Single product capacity", "支持单品多箱整套测算"] ] as const).map(([value, zh, en, hint]) => <button key={value} aria-pressed={workflow === value} className={workflow === value ? "active" : ""} onClick={() => { if (workflow !== value) { commitPendingDimensions(); clearNumericDraftErrors(); palletDraftRef.current=null; setLoadingWorkflow(value); setMode(value === "single-capacity" ? "single" : "mixed"); markDirty(); } }}><strong>{tr(zh, en)}</strong><small>{tr(hint, value === "direct" ? "Mixed-SKU order" : value === "pallet-only" ? "Order → independent pallets" : value === "palletized" ? "Order → loaded pallets → vehicle" : "Single or multi-carton product")}</small></button>)}
              </div>
              <p className="helper-text">{mode === "single"
                ? isSingleProductSet
                  ? tt`这是一个 ${singleSetSummary?.cartonsPerSet ?? 0} 箱/套的单品包装，自动计算最大完整套数，不需要填写需求箱数。`
                  : tr("单箱或多箱都属于单品最大装柜，系统自动计算可装量，不需要填写需求数量。")
                : isPalletWorkflow ? tr("按订单先生成单品托或混托，整套不拆托；尾数按实际高度与重量单独成托。", "Build single-product or mixed pallets from order quantities. Kits stay together; remainders use actual height and weight.") : tr("按订单数量、优先级、门洞与载重生成可校验的混装方案。")}</p>
</article>
        <section id="products" className="panel product-panel">
          <div className="panel-head">
            <div><span className="section-kicker">PRODUCTS</span><h2>{mode === "single" ? isSingleProductSet ? tr("单品多箱包装参数") : tr("单品包装参数") : tr("产品与拼柜订单")}</h2></div>
            <div className="panel-actions">
              <input ref={fileInputRef} hidden type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); event.currentTarget.value = ""; }} />
              <details className="product-examples-menu"><summary className="button small"><Sparkles size={14}/>{tr("示例与真实记录")}</summary><div className="product-examples-panel">
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
              <button className="button ghost small" disabled={!hydrated} onClick={() => void downloadExcelTemplate()}><FileSpreadsheet size={15}/>{tr("下载 Excel 模板")}</button>
              <button className="button ghost small" onClick={downloadTemplate}><Download size={15} />{tr("下载模板")}</button>
              <label>{tr("导入方式","Import action")}<select aria-label={tr("订单行导入方式","Order-row import action")} value={orderImportMode} onChange={e=>{setOrderImportMode(e.target.value as typeof orderImportMode);orderImportRevisionRef.current+=1;}}><option value="replace">{tr("替换订单","Replace order")}</option><option value="append">{tr("追加为新行","Append as new rows")}</option><option value="quantity">{tr("按 ID 只更新数量","Update quantities by ID")}</option></select></label>
              <button className="button ghost small" disabled={hasPendingDimensionChanges||invalidNumericFields.size>0} onClick={()=>downloadFile("order-rows.csv","\uFEFF"+buildOrderRowsCsv(inheritOrderDelivery(products,result?.delivery)),"text/csv;charset=utf-8")}>{tr("导出订单行 CSV","Export order-row CSV")}</button>
              <button className="button ghost small" disabled={hasPendingDimensionChanges||invalidNumericFields.size>0} onClick={() => fileInputRef.current?.click()}><Upload size={15} />{tr("导入 CSV / Excel")}</button>
              {mode === "mixed" ? <button className="button primary small" onClick={addProduct}><Plus size={15} />{tr("添加 SKU")}</button> : null}
            </div>
          </div>
          <div className="unit-toolbar" role="group" aria-label={tr("箱规录入单位")}>
            <div>
              <strong>{tr("箱规录入单位")}</strong>
              <small>{tr("切换只改变下方箱规表的录入和显示；内部始终按 mm / kg 计算，装柜数量不会因换单位而改变。")}</small>
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
          <section className={`set-builder ${!setInputSummaries.length?"set-builder-unconfigured":""}`} aria-label={mode === "single" ? tr("单品多箱包装助手") : tr("多箱套装助手")}>
              <div className="set-builder-head">
                <div>
                  <span className="section-kicker">MULTI-CARTON KIT</span>
                  <strong>{mode === "single" ? tr("单品多箱包装") : tr("多箱套装助手")}</strong>
                  <small>{mode === "single"
                    ? tr("一个产品可由 2 箱、3 箱或更多箱组成；仍按单品最大装柜计算，不会进入拼柜模式")
                    : tr("按整套原子装载；支持不同箱规、1:n 比例、多个套装同时拼柜")}</small>
                </div>
                <div className="set-quick-actions" aria-label={tr("新建套装箱数")}>
                  {[2, 3, 4, 5].map((count) => <button key={count} onClick={() => addCartonSet(count)}><Plus size={13} />{count}{tr(" 箱套装")}</button>)}
                </div>
              </div>
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
          {totalProductPages > 1 ? (
            <nav className="product-pagination" aria-label={tr("产品表分页")}>
              <span>{tr("共 ")}{formatNumber(activeProducts.length)}{tr(" 个 SKU · 第 ")}{currentProductPage + 1} / {totalProductPages}{tr(" 页")}</span>
              <div>
                <button type="button" onClick={() => setProductPage(0)} disabled={currentProductPage === 0}>{tr("首页")}</button>
                <button type="button" onClick={() => setProductPage(Math.max(0, currentProductPage - 1))} disabled={currentProductPage === 0}>{tr("上一页")}</button>
                <button type="button" onClick={() => setProductPage(Math.min(totalProductPages - 1, currentProductPage + 1))} disabled={currentProductPage >= totalProductPages - 1}>{tr("下一页")}</button>
                <button type="button" onClick={() => setProductPage(totalProductPages - 1)} disabled={currentProductPage >= totalProductPages - 1}>{tr("末页")}</button>
              </div>
            </nav>
          ) : null}
          <div className="product-table-wrap">
            <table className={`product-table ${showProductRules?"expanded":"compact-cargo-table"}`}>
              <thead><tr><th>{tr("标识")}</th><th className="cargo-sku-heading">SKU</th><th className="cargo-settings-heading">{tr("货物设置", "Cargo settings")}</th><th>{tr("外箱长")}</th><th>{tr("外箱宽")}</th><th>{tr("外箱高")}</th><th>{tr("CBM 自动")}</th><th>{tr("毛重")}</th>{mode === "mixed" ? <th>{tr("需求箱数")}</th> : null}{mode === "mixed" || isSingleProductSet ? <><th>{tr("套装编码")}</th><th>{tr("套内数量")}</th></> : null}{mode === "mixed" && showProductRules ? <><th>{tr("装载优先级")}</th><th>{tr("必装")}</th></> : null}{showProductRules && <><th>{tr("方向规则")}</th><th>{tr("可承托")}</th><th>{tr("必须底置")}</th><th>{tr("层数上限")}</th></>}<th aria-label={tr("操作")} /></tr></thead>
              <tbody>
                {pagedActiveProducts.map((product) => {
                  const rowLabel=(skuCounts.get(product.sku)??0)>1?`${product.sku} [${product.id}]`:product.sku;
                  const calculatedCbm = exactCartonVolumeCbm(product);
                  const roundedCbm = roundedCartonVolumeCbm(product);
                  return <tr key={product.id}>
                    <td><input className="color-input" aria-label={tt`${rowLabel} 颜色`} type="color" value={product.color} onChange={(event) => updateProduct(product.id, "color", event.target.value)} /></td>
                    <td className="cargo-sku-cell"><input aria-label={`${rowLabel} SKU`} maxLength={80} className="sku-input" value={product.sku} onChange={(event) => updateProduct(product.id, "sku", event.target.value)} /><button className="button small" disabled={hasPendingDimensionChanges} aria-label={`${rowLabel} ${tr("订单行","Order row")}`} onClick={()=>setActiveOrderLine(product.id)}>{tr("订单行","Order row")}</button><small className="order-row-reference" title={product.id}>{product.orderLine?.lineReference||product.id}</small>{product.orderLine&&<small className="order-row-reference">{[product.orderLine.customer,product.orderLine.batch].filter(Boolean).join(" · ")}</small>}</td>
                    <td className="cargo-settings-cell"><button className="button primary cargo-settings-button" disabled={hasPendingDimensionChanges} onClick={()=>setActiveCargo(product.id)} aria-label={`${rowLabel} ${tr("货物设置")}`}><Box size={16}/><span className="cargo-settings-label">{tr("朝向与规则", "Orientation & rules")}</span><span className="cargo-settings-short">{tr("设置", "Settings")}</span></button></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 外箱长`} value={fromMillimeters(product.length, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "length", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "length", valid)} onFocusChange={handleDimensionFocusChange} /><small className="cell-unit">{lengthUnit}</small></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 外箱宽`} value={fromMillimeters(product.width, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "width", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "width", valid)} onFocusChange={handleDimensionFocusChange} /><small className="cell-unit">{lengthUnit}</small></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 外箱高`} value={fromMillimeters(product.height, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "height", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "height", valid)} onFocusChange={handleDimensionFocusChange} /><small className="cell-unit">{lengthUnit}</small></td>
                    <td className="cbm-cell"><output className="cbm-auto-value" aria-label={tt`${rowLabel} 自动计算 CBM`}>{roundedCbm.toFixed(2)}</output><small className="cell-meta">{tr("自动计算 · 精确值 ")}{calculatedCbm.toFixed(4)}</small></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 毛重`} value={fromKilograms(product.weight, weightUnit)} precision={weightUnitPrecision(weightUnit)} onValueChange={(value) => updateProduct(product.id, "weight", toKilograms(value, weightUnit))} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:weight`, valid)} /><small className="cell-unit">{weightUnit}</small></td>
                    {mode === "mixed" ? <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 需求箱数`} value={product.quantity} integer max={1_000_000} onValueChange={(value) => updateProduct(product.id, "quantity", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:quantity`, valid)} /><small className="cell-unit">{tr("箱")}</small></td> : null}
                    {mode === "mixed" || isSingleProductSet ? <><td><input className="set-code-input" aria-label={tt`${rowLabel} 套装编码`} maxLength={80} value={product.setCode ?? ""} placeholder={tr("留空=散箱")} readOnly={mode === "single"} onChange={(event) => updateProduct(product.id, "setCode", event.target.value)} /><small>{mode === "single" ? tr("同一产品包装") : tr("同编码组成一套")}</small></td><td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 套内数量`} value={product.unitsPerSet || 1} integer min={1} max={99} onValueChange={(value) => updateProduct(product.id, "unitsPerSet", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:unitsPerSet`, valid)} /><small className="cell-unit">{tr("箱 / 套")}</small></td></> : null}
                    {mode === "mixed" && showProductRules ? <><td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 装载优先级`} value={product.priority} integer max={100} onValueChange={(value) => updateProduct(product.id, "priority", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:priority`, valid)} /><small className="cell-meta">{tr("数值越高越先装")}</small></td><td><label className="switch" title={tr("必装货物优先于塞货，并在缺装时单独告警")}><input aria-label={tt`${rowLabel} 必装`} type="checkbox" checked={product.mustLoad !== false} onChange={(event) => updateProduct(product.id, "mustLoad", event.target.checked)} /><span /></label></td></> : null}
                    {showProductRules && <>
                    <td>
                      <select className="constraint-select" aria-label={tt`${rowLabel} 方向规则`} value={product.rotationPolicy} onChange={(event) => updateProduct(product.id, "rotationPolicy", event.target.value)}>
                        <option value="fixed">{tr("固定方向")}</option>
                        <option value="upright">{tr("仅平面旋转")}</option>
                        <option value="any">{tr("任意旋转")}</option>
                      </select>
                    </td>
                    <td><label className="switch" title={tr("关闭后，其他箱体不能放在此产品上方")}><input aria-label={tt`${rowLabel} 可承托`} type="checkbox" checked={shapeCanSupport(product)&&product.stackable} disabled={!shapeCanSupport(product)} onChange={(event) => updateProduct(product.id, "stackable", event.target.checked)} /><span /></label></td>
                    <td><label className="switch" title={tr("开启后该产品只允许摆放在集装箱地板")}><input aria-label={tt`${rowLabel} 必须底置`} type="checkbox" checked={product.bottomOnly === true} onChange={(event) => updateProduct(product.id, "bottomOnly", event.target.checked)} /><span /></label></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={tt`${rowLabel} 层数上限`} value={product.maxStackLayers} integer max={99} onValueChange={(value) => updateProduct(product.id, "maxStackLayers", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:maxStackLayers`, valid)} /><small className="cell-meta" title={tr("0 表示不设置人为层数上限，仍受柜高、门高、承托和载重约束")}>{tr("0 = 自动按柜高")}</small></td>
                    </>}
                    <td>{mode === "mixed" || isSingleProductSet ? <button className="icon-button danger" aria-label={tt`删除 ${rowLabel}`} onClick={() => removeProduct(product.id)} disabled={activeProducts.length <= 1}><Trash2 size={16} /></button> : null}</td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          <div className="table-note"><CircleAlert size={16} /><span>{mode === "single"
            ? tr("这里每一行代表同一个产品的一种外箱，不代表多个产品拼柜。系统按完整套数装载，任一组成箱放不下即整套回滚。")
            : tr("相同“套装编码”的任意数量 SKU 会按“套内数量”组成原子批次：支持 2/3/4/5 箱及更多箱型，也支持 1:4、1:2:2 等比例；任一组成箱放不下即整套回滚。")}</span></div>
          {hasPendingDimensionChanges ? (
            <div className="dimension-edit-notice" role="status">
              <LoaderCircle size={16} />
              <span><b>{tr("尺寸录入期间暂停计算")}</b>{tr("当前保留上一次已校验方案；可连续填写所有行的长、宽、高，离开输入区后统一提交；第二步配置完成后再计算。")}</span>
            </div>
          ) : null}
        </section>

          <div className="wizard-navigation"><span>{tr("输入过程中仅保存草稿；确认配置后统一计算。")}</span><button className="button primary" onClick={advanceToConfiguration} disabled={invalidNumericFields.size>0}>{workflow === "pallet-only" ? tr("下一步：配置打托", "Next: Pallet settings") : tr("下一步：选择柜型与托盘 ")}<ChevronRight size={17}/></button></div>
        </section>}
        {workflowStep===2 && <section id="workspace" className="wizard-page" aria-label={tr("第二步：装载配置")}>
          <div className="wizard-page-heading"><div><span className="section-kicker">STEP 02</span><h2>{tr("装载配置")}</h2><p>{workflow === "pallet-only" ? tr("设置托盘尺寸、每托限高、重量和单品托 / 混托规则。", "Set pallet dimensions, cargo height, payload and mix policy.") : tr("确认柜内净空；按需要启用托盘，设置承托与搜索规则。")}</p></div><span className="wizard-input-summary">{activeProducts.length}{tr(" 个箱型 · ")}{mode==="single"?tr("单品最大装柜"):tr("按订单拼柜")}</span></div>
          <div className={`wizard-space-grid ${workflow === "pallet-only" ? "pallet-only-setup" : ""}`}>{workflow !== "pallet-only" && <div className="vehicle-config">            <article className="panel">
              <div className="panel-head"><div><span className="section-kicker">02</span><h2>{tr("集装箱 / 车辆","Container / vehicle")}</h2></div><span className="pill">{tr("可编辑")}</span></div>
              <details className="space-preview-details"><summary>{tr("柜体模型与尺寸", "Container model and dimensions")}</summary><SpaceModelPreview space={container}/></details>
              <button className="button small space-library-button" onClick={()=>setShowTransport(true)}><Container size={15}/>{tr("浏览装载空间库","Browse spaces")}</button>
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
              <div className="field-grid three">
                <Field label={tr("内长")} unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel={tr("柜体内长")} value={container.length} precision={1} onValueChange={(value) => updateContainer("length", value)} onValidityChange={(valid) => setNumericFieldValidity("container:length", valid)} /></Field>
                <Field label={tr("内宽")} unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel={tr("柜体内宽")} value={container.width} precision={1} onValueChange={(value) => updateContainer("width", value)} onValidityChange={(valid) => setNumericFieldValidity("container:width", valid)} /></Field>
                <Field label={tr("内高")} unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel={tr("柜体内高")} value={container.height} precision={1} onValueChange={(value) => updateContainer("height", value)} onValidityChange={(valid) => setNumericFieldValidity("container:height", valid)} /></Field>
                <Field label={tr("门宽")} unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel={tr("柜门宽度")} value={container.doorWidth} precision={1} onValueChange={(value) => updateContainer("doorWidth", value)} onValidityChange={(valid) => setNumericFieldValidity("container:doorWidth", valid)} /></Field>
                <Field label={tr("门高")} unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel={tr("柜门高度")} value={container.doorHeight} precision={1} onValueChange={(value) => updateContainer("doorHeight", value)} onValidityChange={(valid) => setNumericFieldValidity("container:doorHeight", valid)} /></Field>
                <Field label={tr("最大载重")} unit="kg"><NumericInput resetToken={numericResetVersion} ariaLabel={tr("柜体最大载重")} value={container.maxWeight} precision={2} onValueChange={(value) => updateContainer("maxWeight", value)} onValidityChange={(valid) => setNumericFieldValidity("container:maxWeight", valid)} /></Field>
              </div>
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
            </article>

</div>}
            {isPalletWorkflow ? <><PalletBuildSettings products={activeProducts} resetToken={numericResetVersion} onReset={clearNumericDraftErrors} invalid={invalidNumericFields.size>0} value={palletBuild} only={workflow === "pallet-only"} onChange={value=>{setPalletBuild(value);markDirty();}} onValidityChange={setNumericFieldValidity}/><PalletBuildPreview key={JSON.stringify([palletBuild,activeProducts,strategy,loadingRules])} request={fleetRequest} value={palletBuild} disabled={invalidNumericFields.size>0||!activeProducts.length}/></> : <FloorPalletSettings inline config={floorPallets} container={container} clearance={clearance} customSpaces={customContainers} onDraftChange={receivePalletDraft} onSave={()=>{}} onClose={()=>{}}/>}
          </div>
          {(workflow!=="pallet-only"||!!container.exclusions?.length)&&<SiteExclusionSettings container={container} clearance={clearance} only={workflow==="pallet-only"} floor={!isPalletWorkflow&&!!floorPallets} invalid={invalidNumericFields.size>0} resetToken={numericResetVersion} onValidityChange={setNumericFieldValidity} onChange={next=>{setContainer(next);markDirty();}}/>}
          {(workflow!=="pallet-only"||!!container.exclusions?.some(z=>z.accessory))&&<ContainerAccessorySettings container={container} products={activeProducts} only={workflow==="pallet-only"} prebuilt={workflow==="palletized"} floor={!isPalletWorkflow&&!!floorPallets} invalid={invalidNumericFields.size>0} resetToken={numericResetVersion} onValidityChange={setNumericFieldValidity} onChange={next=>{setContainer(next);markDirty();}}/>}
          <LoadingRuleSettings inline rules={loadingRules} products={products} onDraftChange={receiveRulesDraft} onSave={()=>{}} onClose={()=>{}}/>
          {workflow !== "pallet-only" && <details className="wizard-advanced"><summary>{tr("计算偏好与计划目标")}</summary><div className="wizard-preference-grid">            <article className="panel mode-panel">
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
                  <span>{mode === "single" ? strategy === "practical" ? tr("现场方案预测") : tr("高密度参考预测") : tr("综合建议")}</span>
                  <strong>{dirty ? tr("待重新计算") : selectedPredictionDisplay === null ? status === "working" ? tr("计算中") : tr("待计算") : `${formatNumber(selectedPredictionDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong>
                  <small>{selectedCachedPlan
                    ? tt`${reversePlan.displayUnit === "set" ? tt`共 ${formatNumber(selectedPlanCartons)} 箱 · ` : ""}已按当前${strategy === "practical" ? tr("现场") : tr("极限")}算法生成并独立校验`
                    : mode === "single" && strategy === "maximum"
                    ? selectedPredictionDisplay === null ? tr("等待独立极限结果") : tt`共 ${formatNumber(selectedPlanCartons)} 箱 · 不受 ${targetVolumePercent}% / ${targetWeightPercent}% 计划预留限制`
                    : `${reversePlan.displayUnit === "set" ? tt`共 ${formatNumber(reversePlan.recommendedTotal)} 箱 · ` : ""}${reversePlan.limitingFactor === "volume" ? tr("受体积目标限制") : reversePlan.limitingFactor === "weight" ? tr("受载重目标限制") : tr("两个目标同时达到")}`}</small>
                </div>
              </div>
              <div className="ratio-chips" aria-label={tr("各 SKU 建议箱数")}>
                {selectedPredictionQuantities.map((item) => <span key={item.productId}><b>{item.sku}</b>{formatNumber(item.suggestedQuantity)}{tr(" 箱")}</span>)}
              </div>
              <button className="reverse-apply-button" onClick={mode === "single" ? startConfiguredCalculation : applyReversePlan} disabled={status === "working" || hasPendingDimensionChanges || reversePlan.recommendedTotal <= 0}><ShieldCheck size={17} />{mode === "single"
                ? status === "working" ? tr("正在同步双算法方案…") : tr("重新计算当前双算法快照")
                : tr("应用建议数量并验证真实装载")}</button>
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
          <div className="wizard-navigation"><button className="button" onClick={()=>goToStep(1)}><ChevronLeft size={17}/>{tr("上一步：货物清单")}</button><div><span>{setupInvalid?tr("托盘参数尚未完成，请先修正。"):tr("配置完成后生成双算法方案与完整坐标。")}</span><button className="button primary" disabled={setupInvalid||invalidNumericFields.size>0||hasPendingDimensionChanges} onClick={startConfiguredCalculation}>{tr("开始计算 ")}<ChevronRight size={17}/></button></div></div>
        </section>}
        {workflowStep===3 && <section className="wizard-page" aria-label={tr("第三步：装箱方案")}>
          <div className="wizard-page-heading"><div><span className="section-kicker">STEP 03</span><h2>{tr(workflow === "pallet-only" ? "打托方案" : "装箱方案", workflow === "pallet-only" ? "Pallet plan" : "Loading plan")}</h2><p>{tr(result?.container.name ?? container.name)} · {result?.workflow === "pallet-only" ? tr("仅打托，未执行装柜", "Pallets only; no vehicle loading") : result?.palletization?tr("先打托，再装柜","Palletize first, then load"):floorPallets?tt`使用托盘 ${floorPallets.length} × ${floorPallets.width} × ${floorPallets.height} mm`:tr("直接装柜，无底层托盘")}</p></div><button className="button" onClick={()=>goToStep(2)}><ChevronLeft size={16}/>{tr("修改装载配置")}</button></div>
          <div className="plan-command-bar">
          <div className="result-strategy-switch" role="group" aria-label={tr("方案算法切换")}><button className={strategy==="practical"?"selected":""} aria-pressed={strategy==="practical"} onClick={()=>switchStrategy("practical")}><ShieldCheck size={18}/><span><strong>{tr("现场易执行")}</strong><small>{cachedPracticalPlan?strategyDisplayLabel(cachedPracticalPlan):tr("等待计算")}</small></span></button><button className={strategy==="maximum"?"selected":""} aria-pressed={strategy==="maximum"} onClick={()=>switchStrategy("maximum")}><Gauge size={18}/><span><strong>{tr("高密度参考")}</strong><small>{cachedMaximumPlan?strategyDisplayLabel(cachedMaximumPlan):tr("等待计算")}</small></span></button></div>
          <div className="plan-command-actions"><details className="plan-calculation-menu"><summary className="button"><Settings2 size={15}/>{tr("计算设置", "Calculation settings")}</summary><div className="plan-calculation-panel">          <section className="calculation-controls" aria-label={tr("计算控制")}><label><input type="checkbox" checked={autoCalculate} onChange={e=>setAutoCalculate(e.target.checked)}/>{tr("方案阶段自动更新")}</label><label>{tr("计算时限")}<select aria-label={tr("计算时限")} value={calculationBudget} onChange={e=>setCalculationBudget(Number(e.target.value))}><option value={0}>{tr("按设备自动")}</option><option value={15}>{tr("15 秒")}</option><option value={35}>{tr("35 秒")}</option><option value={60}>{tr("60 秒")}</option><option value={120}>{tr("120 秒")}</option></select></label></section></div></details><button className="button primary" disabled={status==="working"||hasPendingDimensionChanges||invalidNumericFields.size>0} onClick={()=>setManualRun(v=>v+1)}>{tr("重新计算方案")}</button>{status==="working"&&<button className="button" onClick={stopCalculation}>{tr("停止并保留已完成方案")}</button>}</div>

          <div className="feature-action-bar"><button className="button" disabled={!canExport} onClick={()=>setShowViewer(true)}><Layers3 size={16}/>{tr("三维方案查看器")}</button><button className="button" disabled={!canExport||exportingPdf} onClick={()=>void downloadPdf()}><Download size={16}/>{tr("下载 PDF")}</button></div>
          </div>
          <section id="result" className="viewer-column">
            <div className="viewer-head">
              <div><span className="section-kicker">2D + LIVE 3D</span><h2>{tr("装柜方案联动复核")}</h2></div>
              <div className="viewer-status-group">
                {result?.mode === "single" ? <div className={`plan-context-chip ${result.strategy === "maximum" ? "capacity" : "planned"}`}><b>{result.strategy === "maximum" ? tr("高密度参考方案") : tr("现场计划方案")}</b><span>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? tr("套") : tr("箱")}{tr(" · 统一建议 ")}{formatNumber(selectedFeasibleRecommendation.displayQuantity)} {reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}{resultPlanningDelta ? ` · ${resultPlanningDelta > 0 ? "+" : "−"}${formatNumber(Math.abs(resultPlanningDelta))}` : tr(" · 一致")}</span></div> : null}
                <div className="validation-chip">{hasPendingDimensionChanges ? <LoaderCircle size={16} /> : result?.metrics.loadedCount === 0 ? <AlertTriangle size={16} /> : result?.validation.valid ? <CheckCircle2 size={16} /> : status === "working" ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{hasPendingDimensionChanges ? tr("尺寸录入中 · 已暂停计算") : result ? result.metrics.loadedCount === 0 ? tr("未装入货物，请查看原因", "No cargo loaded; review the causes") : result.validation.valid ? tr("布局校验通过") : tr("发现异常") : status === "working" ? tr("待重新计算") : tr("等待计算")}</div>
              </div>
            </div>
            <details className="viewer-input-details"><summary>{tr("输入快照", "Input snapshot")} · {activeProducts.length} SKU · {inputVolume.toFixed(2)} m³ · {formatNumber(inputWeight,1)} kg</summary><section className="viewer-input-strip" aria-label={tr("当前统一输入快照")}>
              <article><span>{isSingleProductSet ? tr("包装箱型") : tr("SKU 数量")}</span><strong>{activeProducts.length}</strong><small>{mode === "single" ? tr("单品完整套装") : tr("按订单比例拼柜")}</small></article>
              <article><span>{mode === "single" ? isSingleProductSet ? tr("每套 CBM") : tr("单件 CBM") : tr("需求 CBM")}</span><strong>{inputVolume.toFixed(2)}</strong><small>{tr("由外箱尺寸自动计算")}</small></article>
              <article><span>{mode === "single" ? isSingleProductSet ? tr("每套毛重") : tr("单件毛重") : tr("需求毛重")}</span><strong>{formatNumber(inputWeight, 1)} kg</strong><small>{tr("柜型上限 ")}{formatNumber(result?.container.maxWeight ?? container.maxWeight)} kg</small></article>
              <article><span>{tr("当前约束")}</span><strong>{clearance} mm</strong><small>{tr("安全间隙 · 目标 ")}{targetVolumePercent}% / {targetWeightPercent}%</small></article>
            </section>
            </details>
            {result?.metrics.loadedCount === 0 && <ZeroLoadNotice result={result} products={activeProducts} unit={lengthUnit} onEdit={id=>{goToStep(1);if(id)setActiveCargo(id);}}/>}
            {result ? <RemainingCapacity result={result} visibleCount={packingProgress} pending={hasPendingDimensionChanges} /> : null}
            {result ? (
              <>
                <div className="packing-timeline">
                  <button className="timeline-play" onClick={togglePackingPlayback} disabled={!result.placements.length} aria-label={isPlaying ? tr("暂停码垛动画") : tr("播放码垛动画")}>{isPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
                  <div className="timeline-count">{progressSummary?.isSetMode
                    ? <><strong>{tr("整套 ")}{formatNumber(progressSummary.completedSets)} / {formatNumber(progressSummary.totalSets)}{tr(" 套")}</strong><span>{tr("箱级进度 ")}{formatNumber(progressSummary.visibleCartons)} / {formatNumber(progressSummary.totalCartons)}{tr(" 箱 · ")}{result.placements.length ? Math.round((packingProgress / result.placements.length) * 100) : 0}{tr("% · 柜内 → 箱门")}</span></>
                    : <><strong>{formatNumber(packingProgress)} / {formatNumber(result.placements.length)}{tr(" 箱")}</strong><span>{tr("码垛进度 · ")}{result.placements.length ? Math.round((packingProgress / result.placements.length) * 100) : 0}{tr("% · 柜内 → 箱门")}</span></>}</div>
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
                <section className="viewer-projections" aria-label={tr("三视图相机控制")}>
                  <div className="viewer-projection-head">
                    <div><span className="section-kicker">2D CHECK</span><strong>{tr("三视图同步复核")}</strong><small>{tr("点击任意视图，三维相机会切换为真正的正交投影并平滑旋转到对应方向")}</small></div>
                    <span className="projection-progress">{progressSummary?.isSetMode
                      ? tt`当前整套 ${formatNumber(progressSummary.completedSets)} / ${formatNumber(progressSummary.totalSets)} 套 · ${formatNumber(progressSummary.visibleCartons)} / ${formatNumber(progressSummary.totalCartons)} 箱`
                      : tt`当前 ${formatNumber(packingProgress)} / ${formatNumber(result.placements.length)} 箱`}</span>
                  </div>
                  <OrthographicViews
                    result={result}
                    visibleProducts={visibleProducts}
                    visibleCount={packingProgress}
                    primaryCountLabel={progressSummary?.isSetMode ? tt`${formatNumber(progressSummary.completedSets)} 套` : tt`${formatNumber(packingProgress)} 箱`}
                    secondaryCountLabel={progressSummary?.isSetMode ? tt`${formatNumber(progressSummary.visibleCartons)} 箱` : undefined}
                    renderPrintSvg={renderPrintViews}
                    activeView={cameraProjection === "orthographic" ? cameraView : "free"}
                    onViewSelect={selectOrthographicView}
                  />
                </section>
              </>
            ) : null}
            {result ? (
              <SceneErrorBoundary resetKey={result.id}>
                <ContainerScene
                  result={result}
                  editor={planEditor}
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
              </SceneErrorBoundary>
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
                <div className="legend-row">
                  {result.summaries.map((item) => (
                    <button key={item.productId} className={visibleProducts.has(item.productId) ? "" : "muted"} onClick={() => toggleProductVisibility(item.productId)}>
                      <i style={{ background: item.color }} />
                      <span>{item.sku}</span>
                      <b>{formatNumber(item.loaded)}{tr(" 箱")}</b>
                    </button>
                  ))}
                </div>
                <section className="viewer-decision-grid" aria-label={tr("现场与极限方案统一对比")}>
                  <article className="current"><span>{tr("当前可视方案")}</span><strong>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? tr("套") : tr("箱")}</strong><small>{formatNumber(result.metrics.loadedCount)}{tr(" 箱 · 体积 ")}{formatPercent(result.metrics.volumeUtilization)}</small></article>
                  <article><span>{tr("现场易执行")}</span><strong>{practicalPredictionDisplay === null ? "—" : `${formatNumber(practicalPredictionDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong><small>{tr("经验率 ")}{practicalTargetPercent.toFixed(1)}{tr("% · 完整承托")}</small></article>
                  <article className="maximum"><span>{tr("高密度参考")}</span><strong>{maximumPredictionDisplay === null ? "—" : `${formatNumber(maximumPredictionDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong><small>{tr("启发式独立搜索 · 非全局最优证明")}</small></article>
                  <article className="delta"><span>{tr("搜索增量")}</span><strong>{theoreticalGainDisplay === null ? "—" : `+${formatNumber(theoreticalGainDisplay)} ${reversePlan.displayUnit === "set" ? tr("套") : tr("箱")}`}</strong><small>{theoreticalGainDisplay ? tr("用于反向优化现场分区") : tr("当前两套算法数量一致，继续比较复杂度")}</small></article>
                </section>
              </>
            ) : null}
          </section>

        {result ? (
          <section className="result-section">
            <div className="result-title"><div><span className="section-kicker">CALCULATED PLAN</span><h2>{tr("方案结果")}</h2></div><span className="run-meta">{resultPlanLimitDisplay !== null
              ? tt`现场计划方案 · ${formatNumber(resultLoadedDisplay)} ${resultDisplayUnit === "set" ? tr("套") : tr("箱")}可执行${resultPlanLimitDisplay !== resultLoadedDisplay ? tt` · 算术上限 ${formatNumber(resultPlanLimitDisplay)} ${resultDisplayUnit === "set" ? tr("套") : tr("箱")}` : ""}`
              : result.strategy === "practical" ? tt`现场可执行上限 · 经验率 ${(result.practicalTargetUtilization * 100).toFixed(1)}%` : tr("高密度启发式结果 · 非最优性证明")}{tr(" · 算法 ")}{result.engineVersion} · {formatNumber(result.metrics.solveTimeMs, 1)} ms</span></div>
            <div className="metrics-grid">
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
              <MetricCard icon={<ShieldCheck size={21} />} label={tr("方案复核", "Plan review")} value={planReview?.failed ? `${planReview.failed} ${tr("项不通过", "failed")}` : `${planReview?.unverified ?? 0} ${tr("项未核验", "unverified")}`} detail={tr("数据 · 几何 · 承重 · 路径 · 固定", "Data · geometry · bearing · access · securing")} tone={planReview?.failed ? "red" : "amber"} />
            </div>

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
                  <div><span className="section-kicker">TWO INDEPENDENT SOLVERS</span><strong>{tr("现场算法 × 高密度参考算法")}</strong><small>{tr("同一份输入分别计算；高密度结果只把安全子集反向下放到现场方案。")}</small></div>
                  <b className={result.strategyComparison.sameQuantity ? "matched" : "gain"}>{result.strategyComparison.sameQuantity
                    ? tr("当前数量一致")
                    : tt`理论多 ${formatNumber(result.strategyComparison.gainQuantity)} ${result.strategyComparison.displayUnit === "set" ? tr("套") : tr("箱")}`}</b>
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
                    <strong>{result.strategyComparison.sameQuantity ? tr("已追平") : `+${formatPercent(result.strategyComparison.gainRatio)}`}</strong>
                    <small>{result.strategyComparison.sameQuantity ? tr("复杂摆法未增加数量") : tr("先看方向、侧翻与承托来源")}</small>
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

            <div className="result-grid">
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
                {planReview && <PlanReviewPanel report={planReview}/>}
                <LongSupportPanel plan={result} products={activeProducts}/>
                {resultAudit && <ResultAuditPanel report={resultAudit}/>}
                <ul className="warning-list">
                  {(result.warnings.length ? result.warnings : [tr("未发现门洞、载重或订单缺口告警。")]).map((warning) => <li key={trText(warning)}><CircleAlert size={15} />{trText(warning)}</li>)}
                </ul>
              </article>
            </div>

            <ContainerAccessoryManifest result={result} products={activeProducts} disabled={upgradesDisabled||dirty||!!resultAudit?.hasErrors}/>
            <PalletManifest layerTemplates={palletLayerTemplates} onLayerTemplatesChange={setPalletLayerTemplates} result={result} products={activeProducts} disabled={upgradesDisabled||dirty||!!resultAudit?.hasErrors} onAdopt={adoptManualPlan}/>
            <article id="coordinates" className="panel coordinate-panel">
              <div className="panel-head">
                <div><span className="section-kicker">PLACEMENT DATA</span><h2>{tr("三维坐标与装载清单")}</h2><p>{tr("预览前 80 条；导出包含全部 ")}{formatNumber(result.placements.length)}{tr(" 条可视化摆放记录。")}</p></div>
                <div className="panel-actions"><button className="button ghost small" onClick={printPlan} disabled={!canExport}><Printer size={15} />{tr("打印指导书")}</button><button className="button ghost small" onClick={exportJson} disabled={!canExport}><FileJson size={15} />{tr("方案 JSON")}</button><button className="button primary small" onClick={exportCsv} disabled={!canExport}><FileSpreadsheet size={15} />{tr("导出坐标 CSV")}</button></div>
              </div>
              <div className="coordinate-wrap">
                <table className="coordinate-table">
                  <thead><tr><th>#</th><th>SKU</th><th>{tr("套装 / 套号")}</th><th>X</th><th>Y</th><th>Z</th><th>{tr("摆放尺寸（长×宽×高）")}</th><th>{tr("方向")}</th><th>{tr("层级")}</th><th>{tr("重量")}</th><th>{tr("订单行 ID","Order-line ID")}</th><th>{tr("批次","Batch")}</th></tr></thead>
                  <tbody>{result.placements.slice(0, 80).map((box, index) => <tr key={box.id}><td>{index + 1}</td><td><i style={{ background: box.color }} />{box.sku}</td><td>{box.setCode ? tt`${box.setCode} · 第 ${box.setNumber} 套 · ${box.setItemNumber}/${result.setSummaries.find((item) => item.setCode === box.setCode)?.cartonsPerSet ?? ""}` : tr("散箱")}</td><td>{formatNumber(box.x)}</td><td>{formatNumber(box.y)}</td><td>{formatNumber(box.z)}</td><td>{formatNumber(box.dx)} × {formatNumber(box.dy)} × {formatNumber(box.dz)} mm</td><td>{box.orientation}</td><td>{tt`第 ${box.layer} 层`}</td><td>{box.weight} kg</td><td style={{overflowWrap:"anywhere"}}>{box.productId}</td><td>{result.cargoDetails?.[box.productId]?.orderLine?.batch??""}</td></tr>)}</tbody>
                </table>
              </div>
            </article>
          </section>
        ) : (
          <section className="empty-result"><PackageOpen size={30} /><div><strong>{status === "working" || (dirty && autoCalculate) ? tr("正在生成最新方案") : tr("等待计算")}</strong><span>{!autoCalculate ? tr("当前为手动计算，请完成录入后点击“计算方案”。") : tr("系统会自动生成双算法坐标并执行独立校验。")}</span></div></section>
        )}

        </section>}

        <WorkflowTools
          projects={<>
          <ArchiveLibrary backup={workspaceBackup} disabled={upgradesDisabled} onRestore={backup=>{void restoreWorkspace(new File([backup],tr("工作区归档.json"),{type:"application/json"}));}} onProducts={replaceProductInputs}/>
          <ProductCatalog products={activeProducts} plan={result} disabled={upgradesDisabled} onProducts={replaceProductInputs}/>
          <CloudWorkspace backup={workspaceBackup} plan={result} products={activeProducts} disabled={upgradesDisabled} onRestore={backup=>{void restoreWorkspace(new File([backup],tr("云端归档.json"),{type:"application/json"}));}} onProducts={next=>{setMode("mixed");replaceProductInputs(next);}}/>
          </>}
          loading={<>
          {!isPalletWorkflow && <PrebuiltPalletPanel key={JSON.stringify(fleetRequest)} request={fleetRequest} disabled={upgradesDisabled} onAdopt={next=>{const build=next.palletBuild??{...DEFAULT_PALLET_BUILD,config:next.palletization!.config,mix:next.palletization!.mix};palletDraftRef.current=null;setFloorPallets(undefined);setLoadingWorkflow("palletized");setPalletBuild(build);persistDraft({workflow:"palletized",palletBuild:build,floorPallets:undefined,strategy:next.strategy});strategyRef.current=next.strategy;setStrategy(next.strategy);setWorkflowStep(3);adoptManualPlan(next);}}/>}
          <DimensionScenarios key={JSON.stringify([fleetRequest,workflow,palletBuild,result?.id])} request={{...fleetRequest,workflow,palletBuild,floorPallets:isPalletWorkflow?undefined:floorPallets,singleCartonLimit:result?.singleCartonLimit}} result={dirty?null:result} disabled={upgradesDisabled||dirty} unit={lengthUnit} onProducts={next=>replaceProductInputs(products.map(p=>next.find(n=>n.id===p.id)??p))}/>
          <BearingRules key={JSON.stringify(products.map(p=>[p.id,p.maxTopLoadKg]))} products={activeProducts} disabled={upgradesDisabled} onChange={next=>replaceProductInputs(products.map(p=>next.find(n=>n.id===p.id)??p))}/>
          {mode === "mixed" && workflow!=="pallet-only" ? <FleetPlanner key={JSON.stringify([fleetRequest,customContainers,workflow,palletBuild])} request={{...fleetRequest,workflow,palletBuild:workflow==="palletized"?palletBuild:undefined,floorPallets:isPalletWorkflow?undefined:floorPallets}} customContainers={customContainers} disabled={upgradesDisabled}/> : null}
            {result && !hasPendingDimensionChanges ? <>
            <CrateStackPreflight key={result.id} plan={result} disabled={upgradesDisabled||dirty||!!resultAudit?.hasErrors}/>
            <UnloadedReasons result={result} products={activeProducts} onFocus={id=>{setVisibleProducts(new Set(result.summaries.map(s=>s.productId)));setCameraView("top");setPackingProgress(result.placements.length);setMessage(tt`已在原因面板突出 ${activeProducts.find(p=>p.id===id)?.sku??tr("当前 SKU")}；三维保留其他货物，避免把隐藏箱位误认为空闲空间。`);}}/>
            <ManualPlan key={result.id} editor={planEditor} result={result} products={activeProducts} disabled={upgradesDisabled||!result.validation.valid} onAdopt={next=>{clearActiveCalculation();setAutoCalculate(false);setResultBundle(next);setDirty(false);presentPlan(next);setStatus("done");setMessage(tr("已采用手动方案，三维、指标和导出已同步；自动重算已暂停。"));}}/>
            </> : <p className="tool-empty">{tr("计算方案后，可诊断余货并手动调整箱位。")}</p>}
          </>}
          delivery={result && !hasPendingDimensionChanges ? <>
            <DeliveryVersionPanel plan={result} disabled={!canExport} onIssue={adoptDeliveryVersion}/>
            {canExport ? <FieldGuide key={`field-${result.id}`} result={result} products={activeProducts}/> : null}
            <CustomerReportPanel plan={result} products={activeProducts} disabled={!canExport}/>
          </> : <p className="tool-empty">{tr("先完成一次装柜计算，再生成客户报告和现场指导书。")}</p>}
        />

        <footer className="app-footer"><span>{tr("外贸装柜智算 · Desktop-first local calculation")}</span><span>{tr("尺寸与柜型预设仅供测算，正式出货请复核实际数据")}</span></footer>
      </div>
    </main>
  );
}
