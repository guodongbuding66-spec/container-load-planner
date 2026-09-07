"use client";

import {
  Box,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Container,
  Crosshair,
  Download,
  FileJson,
  FileSpreadsheet,
  Gauge,
  Layers3,
  LoaderCircle,
  PackageOpen,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CameraProjection, CameraView } from "../lib/packing/camera-fit";
import {
  feasibleRecommendation,
  isObsoleteCalculation,
  resultDisplayQuantity,
  selectStrategyResult,
} from "../lib/packing/calculation-state";
import { buildPlacementCsv, MAX_CSV_BYTES, MAX_CSV_ROWS, parseProductsCsv } from "../lib/packing/csv";
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
import { SupportAndSites } from "./support-and-sites";
import { OrthographicViews } from "./orthographic-views";
import { SceneErrorBoundary } from "./scene-error-boundary";

const ContainerScene = dynamic(() => import("./container-scene").then((module) => module.ContainerScene), {
  ssr: false,
  loading: () => <div className="scene-loading">正在准备三维视图…</div>,
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
    return `${formatNumber(result.setSummaries[0].loadedSets)} 套（${formatNumber(result.metrics.loadedCount)} 箱）`;
  }
  return `${formatNumber(result.metrics.loadedCount)} 箱`;
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
    name: "新产品",
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
    name: `${cartonCount} 箱套装 · 第 ${componentIndex + 1} 箱（请填写）`,
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
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">
        {children}
        {unit ? <span className="field-unit">{unit}</span> : null}
      </span>
    </label>
  );
}

function MetricCard({ icon, label, value, detail, tone = "teal" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export function PackingApp() {
  const [mode, setMode] = useState<PackingMode>("mixed");
  const [strategy, setStrategy] = useState<PackingStrategy>("practical");
  const [practicalTargetPercent, setPracticalTargetPercent] = useState(
    recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100,
  );
  const [container, setContainer] = useState<ContainerSpec>({ ...CONTAINER_PRESETS[2] });
  const [clearance, setClearance] = useState(10);
  const [products, setProducts] = useState<ProductInput[]>(() => SAMPLE_PRODUCTS.map((item) => ({ ...item })));
  const [resultBundle, setResultBundle] = useState<PackingResult | null>(null);
  const [status, setStatus] = useState<CalcStatus>("idle");
  const [message, setMessage] = useState("参数已就绪");
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
    setMessage("输入已变化，旧结果已安全丢弃；正在按最新参数实时重算");
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
      : `方案未通过独立校验，已阻止打印与导出：${acceptedPlan.validation.errors[0] ?? "请检查异常明细"}`);
  }, [discardObsoleteCalculation, finishActiveCalculation, presentPlan]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved) as {
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
              normalizeContainerDraft(item, { ...CONTAINER_PRESETS[2], id: `custom-restored-${index}`, name: `自定义柜型 ${index + 1}` }),
            ));
          }
          if (typeof data.targetVolumePercent === "number") setTargetVolumePercent(clampInteger(data.targetVolumePercent, 85, 1, 100));
          if (typeof data.targetWeightPercent === "number") setTargetWeightPercent(clampInteger(data.targetWeightPercent, 90, 1, 100));
          if (isLengthUnit(data.lengthUnit)) setLengthUnit(data.lengthUnit);
          if (isWeightUnit(data.weightUnit)) setWeightUnit(data.weightUnit);
          setMessage("已恢复本机草稿");
        }
      } catch {
        setMessage("本机草稿读取失败，已使用示例数据");
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ mode, strategy, practicalTargetPercent, container, clearance, products, customContainers, targetVolumePercent, targetWeightPercent, lengthUnit, weightUnit }),
        );
        setStorageState("saved");
      } catch {
        setStorageState("error");
        setMessage("本机草稿保存失败：浏览器存储不可用或空间不足");
      }
    }, STORAGE_SAVE_DELAY_MS);
    return () => window.clearTimeout(saveTimer);
  }, [clearance, container, customContainers, hydrated, lengthUnit, mode, practicalTargetPercent, products, strategy, targetVolumePercent, targetWeightPercent, weightUnit]);

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
      setMessage("输入已修改；旧计算已立即取消，正在准备最新参数重算");
    }
    else if (status === "done") setMessage("输入已修改；数量、三视图和 3D 正在实时同步");
    else if (status === "error") {
      setStatus("idle");
      setMessage("输入已修改；正在按最新有效参数重新计算");
    } else setMessage("参数已更新；正在准备实时计算");
  }, [clearActiveCalculation, status]);

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
      setMessage(status === "working" ? "算法视图已切换；新快照完成后会自动显示对应方案" : "正在等待当前参数的双算法快照");
      return;
    }
    presentPlan(cachedPlan);
    setStatus(cachedPlan.validation.valid ? "done" : "error");
    setMessage(nextStrategy === "practical"
      ? `已切换现场易执行方案：${strategyDisplayLabel(cachedPlan)}`
      : `已切换高密度参考方案：${strategyDisplayLabel(cachedPlan)}`);
  };

  const activeProducts = useMemo(() => selectProductsForMode(products, mode), [mode, products]);
  const setInputSummaries = useMemo(() => summarizeSetInputs(activeProducts), [activeProducts]);
  const totalProductPages = Math.max(1, Math.ceil(activeProducts.length / PRODUCT_PAGE_SIZE));
  const currentProductPage = Math.min(productPage, totalProductPages - 1);
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
      { mode, strategy: "practical", practicalTargetUtilization: practicalTargetPercent / 100, container, clearance, products: activeProducts },
      targetVolumePercent / 100,
      targetWeightPercent / 100,
    ),
    [activeProducts, clearance, container, mode, practicalTargetPercent, targetVolumePercent, targetWeightPercent],
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

  const containerChoices = useMemo(() => [...CONTAINER_PRESETS, ...customContainers], [customContainers]);
  const hasKnownContainer = containerChoices.some((item) => item.id === container.id);

  const updateContainer = (field: keyof ContainerSpec, value: number) => {
    setContainer((current) => ({
      ...current,
      id: "custom-draft",
      name: "自定义柜型（未保存）",
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
      setMessage("请先填写自定义柜型名称。");
      return;
    }
    const containerError = validateContainerInput(container, clearance);
    if (containerError) {
      setStatus("error");
      setMessage(`无法保存柜型：${containerError}`);
      return;
    }
    if (customContainers.length >= 100) {
      setStatus("error");
      setMessage("本机最多保存 100 个自定义柜型，请先删除不再使用的柜型。");
      return;
    }
    const saved: ContainerSpec = { ...container, id: `custom-${Date.now()}`, name: name.slice(0, 120) };
    setCustomContainers((current) => [...current, saved]);
    setContainer(saved);
    setShowContainerSave(false);
    setCustomContainerName("");
    markDirty();
    setStatus("idle");
    setMessage(`已将“${name}”保存到本机柜型列表`);
  };

  const removeSelectedCustomContainer = () => {
    if (!container.id.startsWith("custom-") || container.id === "custom-draft") return;
    if (!window.confirm(`确认删除本机柜型“${container.name}”吗？`)) return;
    setCustomContainers((current) => current.filter((item) => item.id !== container.id));
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    markDirty();
    setMessage("自定义柜型已删除，已切换到 40HQ 高柜");
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
    setMessage("尺寸录入中；完成所有长、宽、高并离开尺寸输入区后，将统一重算一次");
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
    setMessage("尺寸已一次性提交；正在按完整的长、宽、高生成最新方案");
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
      ? `已将当前单品设为 1 套 ${safeCount} 箱；请逐箱填写参数，系统会自动计算最大完整套数。`
      : `已新增 1 套 ${safeCount} 箱结构；请逐箱填写尺寸、重量和需求套数。`);
  };

  const addComponentToSet = (code: string) => {
    setProducts((current) => {
      const members = current.filter((product) => product.setCode?.trim() === code);
      const completeSets = summarizeSetInputs(members)[0]?.completeSets || 100;
      const component = createSetComponent(current.length, code, members.length, members.length + 1);
      return [...current, { ...component, quantity: Math.max(1, completeSets) }];
    });
    markDirty();
    setMessage(`已向套装 ${code} 增加一个箱型；套装箱数不设 5 箱上限。`);
  };

  const alignSet = (code: string) => {
    const summary = setInputSummaries.find((item) => item.setCode === code);
    setProducts((current) => alignSetQuantities(current, code));
    clearNumericDraftErrors();
    markDirty();
    setMessage(`套装 ${code} 已安全向下对齐为 ${summary?.completeSets ?? 0} 个完整套，未擅自增加订单数量。`);
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
      ? `已将 ${code} 恢复为单箱产品。`
      : `已取消 ${code} 的成套约束，相关 SKU 将按散箱计算。`);
  };

  const removeProduct = (id: string) => {
    clearNumericDraftErrors();
    setProducts((current) => (current.length <= 1 ? current : current.filter((item) => item.id !== id)));
    markDirty();
  };

  const loadSample = () => {
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
    setMessage("已载入户外产品拼柜示例");
  };

  const loadDimensionTest = () => {
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
    setMessage("已载入你提供的 3 组 CM 尺寸；CBM 将由外箱尺寸自动计算到小数点后两位");
  };

  const loadTwoCartonSetTest = () => {
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
    setMessage("已载入单品 1 套 2 箱：保持单品模式，自动计算最大完整套数，无需填写需求箱数");
  };

  const loadMultiCartonSetTest = () => {
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
    setMessage("已载入单品 1 套 5 箱；保持单品模式，3 箱、4 箱及更多箱型使用同一通用算法。");
  };

  const loadRealA64M = () => {
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
    setMessage("已载入真实 SLM-A64M：报价轨按已确认的 396 套展示，三维轨继续计算无重叠物理方案");
  };

  const loadSuppliedRealRecord = (model: string) => {
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
      name: `${model}${record.cartons.length > 1 ? ` · 第 ${index + 1} 箱` : ""}`,
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
    setMessage(`已载入 ${model}；40HQ 历史实装 ${record.loadingSets["40hq"]} 套，计算后将同时显示历史预测与无重叠三维方案。`);
  };

  const validateInputs = useCallback(() => {
    if (invalidNumericFields.size) return "有数字输入尚未完成，请填写后再计算。";
    if (!activeProducts.length) return "请至少添加一个产品。";
    const containerError = validateContainerInput(container, clearance);
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
        (mode === "mixed" && (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 1_000_000)),
    );
    return invalid ? `${invalid.sku || "未命名产品"} 的尺寸、重量或数量不完整。` : null;
  }, [activeProducts, clearance, container, invalidNumericFields, mode]);

  const submitPacking = useCallback((payload: PackingRequest, workingMessage = "正在生成可行摆放并执行边界、重叠与载重校验…") => {
    if (activeRequestRef.current) clearActiveCalculation();
    requestSequenceRef.current += 1;
    const requestId = `request-${inputRevisionRef.current}-${requestSequenceRef.current}`;
    activeRequestRef.current = requestId;
    activeRevisionRef.current = inputRevisionRef.current;
    workerResultsRef.current = {};
    const runtimePolicy = detectRuntimePolicy();
    setSolverSchedule(runtimePolicy.schedule);
    setStatus("working");
    setMessage(runtimePolicy.schedule === "practical-first"
      ? `${workingMessage} 当前设备将先完成现场方案，再计算高密度参考。`
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
        ...(workerResultsRef.current.practical ? { practical: workerResultsRef.current.practical } : {}),
        ...(workerResultsRef.current.maximum ? { maximum: workerResultsRef.current.maximum } : {}),
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
        ? `${reason} 已保留并显示${selected.strategy === "practical" ? "现场易执行" : "高密度参考"}方案，不影响三视图、3D 和导出。`
        : `可用方案未通过独立校验：${selected.validation.errors[0] ?? "请检查异常明细"}`);
      return true;
    };

    const armCalculationTimeout = () => {
      if (calculationTimeoutRef.current !== null) window.clearTimeout(calculationTimeoutRef.current);
      calculationTimeoutRef.current = window.setTimeout(() => {
        if (completeWithAvailablePlan("后台算法达到设备保护时限，")) return;
        failCalculation(`本次计算已超过 ${Math.round(runtimePolicy.calculationTimeoutMs / 1000)} 秒并自动停止。请减少 SKU/箱数，或分批测算。`);
      }, runtimePolicy.calculationTimeoutMs);
    };

    const startStrategyWorker = (solverStrategy: PackingStrategy, attempt = 0) => {
      if (requestId !== activeRequestRef.current) return;
      let worker = workersRef.current[solverStrategy];
      if (!worker) {
        try {
          worker = new Worker(new URL("../lib/packing/packing.worker.ts", import.meta.url), { type: "module" });
        } catch {
          failCalculation("当前浏览器无法启动装柜计算线程，请刷新页面或升级浏览器后重试。");
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
          setMessage(`${solverStrategy === "practical" ? "现场" : "高密度"}算法线程异常，正在自动重试一次…`);
          startStrategyWorker(solverStrategy, attempt + 1);
          return;
        }
        if (completeWithAvailablePlan(`${solverStrategy === "practical" ? "现场" : "高密度"}算法连续失败，`)) return;
        failCalculation(`${solverStrategy === "practical" ? "现场易执行" : "高密度参考"}算法连续两次失败：${message}`);
      };

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (settled || response.requestId !== requestId || requestId !== activeRequestRef.current) return;
        if (response.type === "error") {
          retryOrFail(response.message);
          return;
        }
        if (response.strategy !== solverStrategy) {
          retryOrFail("计算线程返回了不匹配的策略结果。");
          return;
        }
        settled = true;
        workerResultsRef.current[solverStrategy] = response.payload;
        const practicalResult = workerResultsRef.current.practical;
        const maximumResult = workerResultsRef.current.maximum;
        if (!practicalResult || !maximumResult) {
          if (discardObsoleteCalculation()) return;
          const partialBundle: PackingResult = {
            ...response.payload,
            strategyPlans: { [solverStrategy]: response.payload },
          };
          setResultBundle(partialBundle);
          setDirty(false);
          if (strategyRef.current === solverStrategy) presentPlan(response.payload);
          setStatus("working");
          setMessage(`${solverStrategy === "practical" ? "现场易执行" : "高密度参考"}方案已完成并可查看；另一套算法仍在后台独立计算…`);
          if (runtimePolicy.schedule === "practical-first" && solverStrategy === "practical") {
            armCalculationTimeout();
            maximumStartTimerRef.current = window.setTimeout(() => {
              maximumStartTimerRef.current = null;
              if (requestId !== activeRequestRef.current) return;
              setMessage("现场方案已可使用；正在后台补算高密度参考，期间页面仍可操作。");
              startStrategyWorker("maximum");
            }, runtimePolicy.maximumStartDelayMs);
          }
          return;
        }
        const combined = combineStrategyResults(practicalResult, maximumResult, strategyRef.current);
        acceptResult(
          combined,
          `现场与高密度双算法已并行完成，并通过${combined.validation.valid ? "独立校验" : "异常检查"}`,
        );
      };
      worker.onerror = () => retryOrFail("计算线程加载或执行失败。");
      worker.postMessage({ type: "pack-strategy", requestId, strategy: solverStrategy, payload });
    };

    armCalculationTimeout();
    startStrategyWorker("practical");
    if (runtimePolicy.schedule === "parallel") startStrategyWorker("maximum");
  }, [acceptResult, clearActiveCalculation, discardObsoleteCalculation, presentPlan]);

  const calculate = useCallback(() => {
    if (isEditingDimensions || hasPendingDimensionChanges) {
      setMessage("尺寸尚未提交；完成所有长、宽、高并离开尺寸输入区后再统一计算");
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
      setMessage("当前目标利用率无法倒推出有效装载量，请检查产品尺寸、重量与柜型。");
      return;
    }
    submitPacking({
      mode,
      strategy: "practical",
      practicalTargetUtilization: practicalTargetPercent / 100,
      singleCartonLimit: mode === "single" ? reversePlan.recommendedTotal : undefined,
      container,
      clearance,
      products: activeProducts,
    }, mode === "single"
      ? `正在实时重算现场与极限方案；计划上限 ${reversePlan.recommendedDisplay.toLocaleString()} ${reversePlan.displayUnit === "set" ? "套" : "箱"}…`
      : "正在实时重算双算法坐标，并执行边界、重叠与载重校验…");
  }, [activeProducts, clearance, clearActiveCalculation, container, hasPendingDimensionChanges, isEditingDimensions, mode, practicalTargetPercent, reversePlan, submitPacking, validateInputs]);

  useEffect(() => {
    if (!hydrated || isEditingDimensions || hasPendingDimensionChanges) return;
    if (!dirty && resultBundle) return;
    const timer = window.setTimeout(calculate, AUTO_CALCULATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [calculate, dirty, hasPendingDimensionChanges, hydrated, isEditingDimensions, resultBundle]);

  const applyReversePlan = () => {
    if (reversePlan.recommendedTotal <= 0) {
      setStatus("error");
      setMessage("当前目标利用率无法倒推出有效箱数，请检查产品尺寸、重量与柜型。");
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
    clearNumericDraftErrors();
    setMode("mixed");
    markDirty();
    setMessage(`已应用 ${reversePlan.recommendedTotal.toLocaleString()} 箱建议数量，正在实时验证双算法摆放…`);
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
    if (!result?.validation.valid || dirty || hasPendingDimensionChanges) return;
    setIsPlaying(false);
    flushSync(() => setRenderPrintViews(true));
    window.requestAnimationFrame(() => window.print());
  };

  const exportJson = () => {
    if (!result?.validation.valid || dirty || hasPendingDimensionChanges) return;
    const selectedPlanOnly = { ...result, strategyPlans: undefined };
    downloadFile(
      `装柜方案_${result.container.id}_${result.strategy}_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(selectedPlanOnly, null, 2),
      "application/json",
    );
  };

  const exportCsv = () => {
    if (!result?.validation.valid || dirty || hasPendingDimensionChanges) return;
    downloadFile(`装柜坐标_${result.container.id}.csv`, `\uFEFF${buildPlacementCsv(result)}`, "text/csv;charset=utf-8");
  };

  const downloadTemplate = () => {
    const lines = [
      "sku,name,length,width,height,lengthUnit,weight,weightUnit,quantity,priority,setCode,unitsPerSet,rotationPolicy,stackable,maxStackLayers,mustLoad,bottomOnly,color",
      "SET5-A-128,五箱套装A箱,1280,540,110,mm,40,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#2f7f89",
      "SET5-B-068,五箱套装B箱,680,540,110,mm,14,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#a95e78",
      "SET5-C-103,五箱套装C箱,1030,620,120,mm,30,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#d5a72f",
      "SET5-D-052,五箱套装D箱,520,350,180,mm,12,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#6b72a9",
      "SET5-E-090,五箱套装E箱,900,420,140,mm,18,kg,120,100,SET-5BOX,1,upright,true,0,true,false,#609d62",
    ];
    downloadFile("拼柜导入模板.csv", `\uFEFF${lines.join("\n")}`, "text/csv;charset=utf-8");
  };

  const importCsv = async (file: File) => {
    if (file.size > MAX_CSV_BYTES) {
      setStatus("error");
      setMessage(`CSV 文件不能超过 ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB。`);
      return;
    }
    try {
      const parsed = parseProductsCsv(await file.text(), COLORS);
      const importedMode = inferImportedPackingMode(parsed);
      clearNumericDraftErrors();
      setProducts(parsed);
      setMode(importedMode);
      setResultBundle(null);
      markDirty();
      setStatus("idle");
      setMessage(importedMode === "single"
        ? `已识别同一套装编码，按单品多箱模式导入 ${parsed.length} 个箱型；将直接计算完整套数`
        : `已导入 ${parsed.length} 个 SKU，请检查后计算`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "CSV 读取失败，请检查文件后重试。");
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
  const canExport = Boolean(result?.validation.valid && !dirty && !hasPendingDimensionChanges);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Container size={22} /></div>
          <div><strong>装柜智算</strong><span>CargoFit Workspace</span></div>
        </div>
        <nav className="step-nav" aria-label="页面导航">
          <button className="active" onClick={() => scrollTo("workspace")}><Gauge size={18} /><span>测算工作台</span><b>01</b></button>
          <button onClick={() => scrollTo("products")}><Boxes size={18} /><span>产品与订单</span><b>02</b></button>
          <button onClick={() => scrollTo("result") }><Layers3 size={18} /><span>三维方案</span><b>03</b></button>
          <button onClick={() => scrollTo("coordinates")}><FileSpreadsheet size={18} /><span>坐标与导出</span><b>04</b></button>
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <div><strong>本机计算</strong><span>产品与订单数据默认不上传</span></div>
        </div>
        <div className="sidebar-version"><span>ENGINE</span><strong>v{ENGINE_VERSION}</strong></div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">外贸报价 · 拼柜计划 · 三维复核</span>
            <h1>新建装柜测算</h1>
          </div>
          <div className="top-actions">
            <span className={`save-state ${dirty || hasPendingDimensionChanges ? "is-dirty" : ""} ${storageState === "error" ? "is-error" : ""}`}><Save size={15} />{storageState === "error" ? "草稿未能保存" : hasPendingDimensionChanges ? "尺寸录入中 · 尚未提交" : dirty ? "草稿自动保存 · 待重算" : "本机草稿已保存"}</span>
            <button className="button ghost" onClick={loadSample}><Sparkles size={16} />载入示例</button>
            <button className="button ghost" onClick={printPlan} disabled={!canExport}><Printer size={16} />现场指导书</button>
            <button className="button ghost" onClick={exportJson} disabled={!canExport}><FileJson size={16} />导出方案</button>
          </div>
        </header>

        <SupportAndSites />

        <section className="status-strip" aria-live="polite">
          <div className={`status-dot status-${status}`} />
          <span>{message}</span>
          {status === "working" ? <LoaderCircle size={16} className="spin" /> : status === "done" ? <CheckCircle2 size={16} /> : status === "error" ? <CircleAlert size={16} /> : null}
        </section>

        {result ? (
          <header className="print-report-title">
            <div><span>LOADING INSTRUCTION</span><h1>集装箱装柜作业指导书</h1></div>
            <dl><div><dt>方案编号</dt><dd>{result.id}</dd></div><div><dt>柜型</dt><dd>{result.container.name}</dd></div><div><dt>生成时间</dt><dd>{new Date(result.createdAt).toLocaleString("zh-CN")}</dd></div></dl>
          </header>
        ) : null}

        <section id="workspace" className="workspace-grid">
          <div className="config-column">
            <article className="panel mode-panel">
              <div className="panel-head compact"><div><span className="section-kicker">01</span><h2>计算模式</h2></div></div>
              <div className="segmented" role="group" aria-label="计算模式">
                <button aria-pressed={mode === "single"} className={mode === "single" ? "active" : ""} onClick={() => { if (mode !== "single") { clearNumericDraftErrors(); setMode("single"); markDirty(); } }}><Box size={17} />单品最大装柜</button>
                <button aria-pressed={mode === "mixed"} className={mode === "mixed" ? "active" : ""} onClick={() => { if (mode !== "mixed") { clearNumericDraftErrors(); setMode("mixed"); markDirty(); } }}><Boxes size={17} />多 SKU 拼柜</button>
              </div>
              <p className="helper-text">{mode === "single"
                ? isSingleProductSet
                  ? `这是一个 ${singleSetSummary?.cartonsPerSet ?? 0} 箱/套的单品包装，自动计算最大完整套数，不需要填写需求箱数。`
                  : "单箱或多箱都属于单品最大装柜，系统自动计算可装量，不需要填写需求数量。"
                : "按订单数量、优先级、门洞与载重生成可校验的混装方案。"}</p>
              <div className="strategy-divider" />
              <div className="strategy-heading"><strong>独立求解算法</strong><span>{strategy === "practical" ? "工人可直接照做" : "高密度搜索参考"}</span></div>
              <div className="segmented strategy-segmented" role="group" aria-label="装柜执行策略">
                <button aria-pressed={strategy === "practical"} className={strategy === "practical" ? "active" : ""} onClick={() => switchStrategy("practical")}><ShieldCheck size={16} /><span>现场易执行<small className="strategy-count">{dirty
                  ? "实时重算中"
                  : cachedPracticalPlan
                    ? `${formatNumber(practicalPredictionDisplay ?? 0)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}`
                    : status === "working"
                      ? "计算中"
                      : practicalPredictionDisplay === null ? "待计算" : `目标 ${formatNumber(practicalPredictionDisplay)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}`}</small></span></button>
                <button aria-pressed={strategy === "maximum"} className={strategy === "maximum" ? "active" : ""} onClick={() => switchStrategy("maximum")}><Gauge size={16} /><span>高密度参考<small className="strategy-count">{dirty
                  ? "实时重算中"
                  : cachedMaximumPlan
                    ? `${formatNumber(maximumPredictionDisplay ?? 0)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}`
                    : status === "working" ? "计算中" : "待计算"}</small></span></button>
              </div>
              <p className="strategy-help">任一参数变化都会自动重算同一份双算法快照；切换后，数量、三视图、3D、进度、指标和导出同时采用对应坐标。</p>
              {solverSchedule === "practical-first" ? (
                <p className="mobile-compute-note"><ShieldCheck size={15} /><span><strong>设备节能计算已启用</strong>先生成可直接使用的现场方案，再后台补算高密度参考；高密度超时或失败不会清空现场结果。</span></p>
              ) : null}
              {strategy === "practical" ? (
                <div className="practical-target">
                  <div><strong>现场经验装载率</strong><span>仅影响现场算法 · 完整支撑</span></div>
                  <div className="target-input"><input aria-label="现场经验装载率滑块" type="range" min="50" max="95" step="0.5" value={practicalTargetPercent} onChange={(event) => { setNumericFieldValidity("target:practical", true); setPracticalTargetPercent(clampNumber(event.target.value, DEFAULT_PRACTICAL_TARGET * 100, 50, 95)); markDirty(); }} /><NumericInput resetToken={numericResetVersion} ariaLabel="现场经验装载率" value={practicalTargetPercent} min={50} max={95} precision={1} onValueChange={(value) => { setPracticalTargetPercent(value); markDirty(); }} onValidityChange={(valid) => setNumericFieldValidity("target:practical", valid)} /><b>%</b></div>
                </div>
              ) : <p className="strategy-warning">独立运行三维分区动态规划和多起点自由空间搜索；允许侧翻与 68% 以上局部承托。它是高密度启发式参考，不是全局最优证明，也不能直接替代现场指导书。</p>}
            </article>

            <article className="panel">
              <div className="panel-head"><div><span className="section-kicker">02</span><h2>集装箱参数</h2></div><span className="pill">可编辑</span></div>
              <label className="select-wrap">
                <span>柜型预设</span>
                <select value={hasKnownContainer ? container.id : "custom-draft"} onChange={(event) => selectPreset(event.target.value)}>
                  <optgroup label="常用海运柜型">
                    {CONTAINER_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </optgroup>
                  {customContainers.length ? (
                    <optgroup label="我的自定义柜型">
                      {customContainers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </optgroup>
                  ) : null}
                  {!hasKnownContainer ? <option value="custom-draft">自定义柜型（未保存）</option> : null}
                </select>
                <ChevronDown size={16} />
              </label>
              <div className="field-grid three">
                <Field label="内长" unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel="柜体内长" value={container.length} precision={1} onValueChange={(value) => updateContainer("length", value)} onValidityChange={(valid) => setNumericFieldValidity("container:length", valid)} /></Field>
                <Field label="内宽" unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel="柜体内宽" value={container.width} precision={1} onValueChange={(value) => updateContainer("width", value)} onValidityChange={(valid) => setNumericFieldValidity("container:width", valid)} /></Field>
                <Field label="内高" unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel="柜体内高" value={container.height} precision={1} onValueChange={(value) => updateContainer("height", value)} onValidityChange={(valid) => setNumericFieldValidity("container:height", valid)} /></Field>
                <Field label="门宽" unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel="柜门宽度" value={container.doorWidth} precision={1} onValueChange={(value) => updateContainer("doorWidth", value)} onValidityChange={(valid) => setNumericFieldValidity("container:doorWidth", valid)} /></Field>
                <Field label="门高" unit="mm"><NumericInput resetToken={numericResetVersion} ariaLabel="柜门高度" value={container.doorHeight} precision={1} onValueChange={(value) => updateContainer("doorHeight", value)} onValidityChange={(valid) => setNumericFieldValidity("container:doorHeight", valid)} /></Field>
                <Field label="最大载重" unit="kg"><NumericInput resetToken={numericResetVersion} ariaLabel="柜体最大载重" value={container.maxWeight} precision={2} onValueChange={(value) => updateContainer("maxWeight", value)} onValidityChange={(valid) => setNumericFieldValidity("container:maxWeight", valid)} /></Field>
              </div>
              <div className="clearance-row">
                <div><strong>安全间隙</strong><span>自动从有效柜内空间扣除</span></div>
                <div className="range-control"><input aria-label="安全间隙" type="range" min="0" max="50" step="5" value={clearance} onChange={(event) => { setClearance(numberValue(event.target.value)); markDirty(); }} /><output>{clearance} mm</output></div>
              </div>
              <div className="container-save-actions">
                <button className="button ghost small" onClick={() => { setShowContainerSave((current) => !current); setCustomContainerName(container.name.includes("未保存") ? "" : container.name); }}><Save size={14} />另存为自定义柜型</button>
                {container.id.startsWith("custom-") && container.id !== "custom-draft" ? <button className="button text-danger small" onClick={removeSelectedCustomContainer}><Trash2 size={14} />删除当前柜型</button> : null}
              </div>
              {showContainerSave ? (
                <div className="container-save-row">
                  <input aria-label="自定义柜型名称" maxLength={120} placeholder="例如：45HQ 客户专用柜" value={customContainerName} onChange={(event) => setCustomContainerName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCustomContainer(); }} />
                  <button className="button primary small" onClick={saveCustomContainer}>保存</button>
                  <button className="icon-button" aria-label="取消保存柜型" onClick={() => setShowContainerSave(false)}><X size={16} /></button>
                </div>
              ) : null}
            </article>

            <article className="panel reverse-panel">
              <div className="panel-head"><div><span className="section-kicker">03</span><h2>{mode === "single" ? "计划目标与装载上限" : "目标利用率倒推"}</h2></div><span className="pill">{mode === "single" ? "计划量 ≠ 最大量" : "按当前 SKU 比例"}</span></div>
              <div className="target-control">
                <div><Layers3 size={16} /><span><strong>目标体积利用率</strong><small>按有效柜内容积倒推</small></span></div>
                <div className="target-input"><input aria-label="目标体积利用率滑块" type="range" min="1" max="100" value={targetVolumePercent} onChange={(event) => { setNumericFieldValidity("target:volume", true); setTargetVolumePercent(numberValue(event.target.value)); markDirty(); }} /><NumericInput resetToken={numericResetVersion} ariaLabel="目标体积利用率" value={targetVolumePercent} integer min={1} max={100} onValueChange={(value) => { setTargetVolumePercent(value); markDirty(); }} onValidityChange={(valid) => setNumericFieldValidity("target:volume", valid)} /><b>%</b></div>
              </div>
              <div className="target-control">
                <div><Weight size={16} /><span><strong>目标载重利用率</strong><small>按柜型最大载重倒推</small></span></div>
                <div className="target-input"><input aria-label="目标载重利用率滑块" type="range" min="1" max="100" value={targetWeightPercent} onChange={(event) => { setNumericFieldValidity("target:weight", true); setTargetWeightPercent(numberValue(event.target.value)); markDirty(); }} /><NumericInput resetToken={numericResetVersion} ariaLabel="目标载重利用率" value={targetWeightPercent} integer min={1} max={100} onValueChange={(value) => { setTargetWeightPercent(value); markDirty(); }} onValidityChange={(valid) => setNumericFieldValidity("target:weight", valid)} /><b>%</b></div>
              </div>
              <div className="reverse-count-grid">
                <div>
                  <span>体积倒推</span>
                  <strong>{formatNumber(reversePlan.volumeLimitedDisplay)} {reversePlan.displayUnit === "set" ? "套" : "箱"}</strong>
                  <small>{reversePlan.displayUnit === "set" ? `共 ${formatNumber(reversePlan.volumeLimitedDisplay * reversePlan.cartonsPerSet)} 箱 · ` : ""}目标 {targetVolumePercent}%</small>
                </div>
                <div>
                  <span>载重倒推</span>
                  <strong>{reversePlan.weightLimitedDisplay === null ? "缺少重量" : `${formatNumber(reversePlan.weightLimitedDisplay)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}`}</strong>
                  <small>{reversePlan.displayUnit === "set" && reversePlan.weightLimitedDisplay !== null ? `共 ${formatNumber(reversePlan.weightLimitedDisplay * reversePlan.cartonsPerSet)} 箱 · ` : ""}目标 {targetWeightPercent}%</small>
                </div>
                <div className="recommended">
                  <span>{mode === "single" ? strategy === "practical" ? "现场方案预测" : "高密度参考预测" : "综合建议"}</span>
                  <strong>{dirty ? "实时重算中" : selectedPredictionDisplay === null ? status === "working" ? "计算中" : "待计算" : `${formatNumber(selectedPredictionDisplay)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}`}</strong>
                  <small>{selectedCachedPlan
                    ? `${reversePlan.displayUnit === "set" ? `共 ${formatNumber(selectedPlanCartons)} 箱 · ` : ""}已按当前${strategy === "practical" ? "现场" : "极限"}算法生成并独立校验`
                    : mode === "single" && strategy === "maximum"
                    ? selectedPredictionDisplay === null ? "等待独立极限结果" : `共 ${formatNumber(selectedPlanCartons)} 箱 · 不受 ${targetVolumePercent}% / ${targetWeightPercent}% 计划预留限制`
                    : `${reversePlan.displayUnit === "set" ? `共 ${formatNumber(reversePlan.recommendedTotal)} 箱 · ` : ""}${reversePlan.limitingFactor === "volume" ? "受体积目标限制" : reversePlan.limitingFactor === "weight" ? "受载重目标限制" : "两个目标同时达到"}`}</small>
                </div>
              </div>
              <div className="ratio-chips" aria-label="各 SKU 建议箱数">
                {selectedPredictionQuantities.map((item) => <span key={item.productId}><b>{item.sku}</b>{formatNumber(item.suggestedQuantity)} 箱</span>)}
              </div>
              <button className="reverse-apply-button" onClick={applyReversePlan} disabled={status === "working" || hasPendingDimensionChanges || reversePlan.recommendedTotal <= 0}><ShieldCheck size={17} />{mode === "single"
                ? status === "working" ? "正在同步双算法方案…" : `重新计算当前双算法快照`
                : "应用建议数量并验证真实装载"}</button>
              <p className="reverse-note">{dirty
                ? "正在用最新输入重新验证真实坐标；完成前不会展示旧方案或未经验证的统一建议。"
                : status === "working" && selectedCachedPlan
                  ? "当前所选算法已完成并可查看、打印或导出；另一套算法继续在后台独立计算。"
                  : status === "working"
                    ? "当前所选算法仍在计算；若另一算法先完成，可切换查看其已校验坐标。"
                : mode === "single"
                  ? `体积/载重先倒推上限，算法再验证真实可装量；当前统一建议 ${formatNumber(selectedFeasibleRecommendation.displayQuantity)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}。切换算法会同步切换整张坐标方案。`
                  : "倒推先保持当前 SKU 数量比例；箱型方向、门洞和碎片空间会影响最终实际利用率，应用后将用装箱算法重新验证。"}</p>
            </article>
          </div>

          <section id="result" className="viewer-column">
            <div className="viewer-head">
              <div><span className="section-kicker">2D + LIVE 3D</span><h2>装柜方案联动复核</h2></div>
              <div className="viewer-status-group">
                {result?.mode === "single" ? <div className={`plan-context-chip ${result.strategy === "maximum" ? "capacity" : "planned"}`}><b>{result.strategy === "maximum" ? "高密度参考方案" : "现场计划方案"}</b><span>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? "套" : "箱"} · 统一建议 {formatNumber(selectedFeasibleRecommendation.displayQuantity)} {reversePlan.displayUnit === "set" ? "套" : "箱"}{resultPlanningDelta ? ` · ${resultPlanningDelta > 0 ? "+" : "−"}${formatNumber(Math.abs(resultPlanningDelta))}` : " · 一致"}</span></div> : null}
                <div className="validation-chip">{hasPendingDimensionChanges ? <LoaderCircle size={16} /> : result?.validation.valid ? <CheckCircle2 size={16} /> : status === "working" || dirty ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{hasPendingDimensionChanges ? "尺寸录入中 · 已暂停计算" : result ? result.validation.valid ? "布局校验通过" : "发现异常" : status === "working" || dirty ? "实时重算中" : "等待计算"}</div>
              </div>
            </div>
            <section className="viewer-input-strip" aria-label="当前统一输入快照">
              <article><span>{isSingleProductSet ? "包装箱型" : "SKU 数量"}</span><strong>{activeProducts.length}</strong><small>{mode === "single" ? "单品完整套装" : "按订单比例拼柜"}</small></article>
              <article><span>{mode === "single" ? isSingleProductSet ? "每套 CBM" : "单件 CBM" : "需求 CBM"}</span><strong>{inputVolume.toFixed(2)}</strong><small>由外箱尺寸自动计算</small></article>
              <article><span>{mode === "single" ? isSingleProductSet ? "每套毛重" : "单件毛重" : "需求毛重"}</span><strong>{formatNumber(inputWeight, 1)} kg</strong><small>柜型上限 {formatNumber(container.maxWeight)} kg</small></article>
              <article><span>当前约束</span><strong>{clearance} mm</strong><small>安全间隙 · 目标 {targetVolumePercent}% / {targetWeightPercent}%</small></article>
            </section>
            {result ? (
              <>
                <div className="packing-timeline">
                  <button className="timeline-play" onClick={togglePackingPlayback} disabled={!result.placements.length} aria-label={isPlaying ? "暂停码垛动画" : "播放码垛动画"}>{isPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
                  <div className="timeline-count">{progressSummary?.isSetMode
                    ? <><strong>整套 {formatNumber(progressSummary.completedSets)} / {formatNumber(progressSummary.totalSets)} 套</strong><span>箱级进度 {formatNumber(progressSummary.visibleCartons)} / {formatNumber(progressSummary.totalCartons)} 箱 · {result.placements.length ? Math.round((packingProgress / result.placements.length) * 100) : 0}% · 柜内 → 箱门</span></>
                    : <><strong>{formatNumber(packingProgress)} / {formatNumber(result.placements.length)} 箱</strong><span>码垛进度 · {result.placements.length ? Math.round((packingProgress / result.placements.length) * 100) : 0}% · 柜内 → 箱门</span></>}</div>
                  <input aria-label={progressSummary?.isSetMode ? "套装箱级码垛进度" : "码垛进度"} type="range" min="0" max={Math.max(1, result.placements.length)} value={packingProgress} onChange={(event) => { setIsPlaying(false); setPackingProgress(numberValue(event.target.value)); }} />
                  <div className="timeline-step-controls" aria-label="逐箱码垛控制">
                    <button onClick={() => movePackingProgress(-1)} disabled={packingProgress <= 0} aria-label="上一步"><ChevronLeft size={14} /></button>
                    <select aria-label="播放速度" value={playbackSpeed} onChange={(event) => setPlaybackSpeed(numberValue(event.target.value))}>
                      <option value={1}>1×</option>
                      <option value={2}>2×</option>
                      <option value={4}>4×</option>
                    </select>
                    <button onClick={() => movePackingProgress(1)} disabled={packingProgress >= result.placements.length} aria-label="下一步"><ChevronRight size={14} /></button>
                  </div>
                  <button className="timeline-all" onClick={() => { setIsPlaying(false); setPackingProgress(result.placements.length); }}>显示全部</button>
                </div>
                <div className="timeline-current" aria-live="polite">
                  {progressSummary?.currentPlacement
                    ? <><span>{progressSummary.isSetMode && progressSummary.currentSetNumber
                      ? `已完成 ${formatNumber(progressSummary.completedSets)}/${formatNumber(progressSummary.totalSets)} 套 · 当前箱归属套号 ${formatNumber(progressSummary.currentSetNumber)} · 套内 ${formatNumber(progressSummary.currentSetItemNumber ?? 1)}/${formatNumber(progressSummary.currentSetCartons ?? 1)} 箱`
                      : `当前第 ${formatNumber(progressSummary.visibleCartons)} 箱`}</span><strong>{progressSummary.currentPlacement.sku}{progressSummary.currentPlacement.setCode ? ` · ${progressSummary.currentPlacement.setCode}` : ""}</strong><b>坐标 {formatNumber(progressSummary.currentPlacement.x)} / {formatNumber(progressSummary.currentPlacement.y)} / {formatNumber(progressSummary.currentPlacement.z)} mm · 第 {progressSummary.currentPlacement.layer} 层</b></>
                    : <><span>准备开始</span><strong>尚未装入箱体</strong><b>点击播放或下一步查看装柜顺序</b></>}
                </div>
                <section className="viewer-projections" aria-label="三视图相机控制">
                  <div className="viewer-projection-head">
                    <div><span className="section-kicker">2D CHECK</span><strong>三视图同步复核</strong><small>点击任意视图，三维相机会切换为真正的正交投影并平滑旋转到对应方向</small></div>
                    <span className="projection-progress">{progressSummary?.isSetMode
                      ? `当前整套 ${formatNumber(progressSummary.completedSets)} / ${formatNumber(progressSummary.totalSets)} 套 · ${formatNumber(progressSummary.visibleCartons)} / ${formatNumber(progressSummary.totalCartons)} 箱`
                      : `当前 ${formatNumber(packingProgress)} / ${formatNumber(result.placements.length)} 箱`}</span>
                  </div>
                  <OrthographicViews
                    result={result}
                    visibleProducts={visibleProducts}
                    visibleCount={packingProgress}
                    primaryCountLabel={progressSummary?.isSetMode ? `${formatNumber(progressSummary.completedSets)} 套` : `${formatNumber(packingProgress)} 箱`}
                    secondaryCountLabel={progressSummary?.isSetMode ? `${formatNumber(progressSummary.visibleCartons)} 箱` : undefined}
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
                  visibleProducts={visibleProducts}
                  visibleCount={packingProgress}
                  cameraView={cameraView}
                  projectionMode={cameraProjection}
                  onCameraViewChange={setCameraView}
                  onProjectionModeChange={setCameraProjection}
                />
              </SceneErrorBoundary>
            ) : (
              <div className="scene-shell" role="region" aria-label="可交互三维装柜视图">
                <div className="scene-empty">
                  <div className="scene-empty-cube" aria-hidden="true" />
                  <strong>{status === "working" || dirty ? "正在同步最新方案" : "等待计算方案"}</strong>
                  <span>{status === "working" || dirty ? "所选算法完成后会立即显示；另一算法继续在后台计算" : "填写左侧参数后，柜内真实摆放会显示在这里"}</span>
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
                      <b>{formatNumber(item.loaded)} 箱</b>
                    </button>
                  ))}
                </div>
                <section className="viewer-decision-grid" aria-label="现场与极限方案统一对比">
                  <article className="current"><span>当前可视方案</span><strong>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? "套" : "箱"}</strong><small>{formatNumber(result.metrics.loadedCount)} 箱 · 体积 {formatPercent(result.metrics.volumeUtilization)}</small></article>
                  <article><span>现场易执行</span><strong>{practicalPredictionDisplay === null ? "—" : `${formatNumber(practicalPredictionDisplay)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}`}</strong><small>经验率 {practicalTargetPercent.toFixed(1)}% · 完整承托</small></article>
                  <article className="maximum"><span>高密度参考</span><strong>{maximumPredictionDisplay === null ? "—" : `${formatNumber(maximumPredictionDisplay)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}`}</strong><small>启发式独立搜索 · 非全局最优证明</small></article>
                  <article className="delta"><span>搜索增量</span><strong>{theoreticalGainDisplay === null ? "—" : `+${formatNumber(theoreticalGainDisplay)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}`}</strong><small>{theoreticalGainDisplay ? "用于反向优化现场分区" : "当前两套算法数量一致，继续比较复杂度"}</small></article>
                </section>
              </>
            ) : null}
          </section>
        </section>

        <section id="products" className="panel product-panel">
          <div className="panel-head">
            <div><span className="section-kicker">PRODUCTS</span><h2>{mode === "single" ? isSingleProductSet ? "单品多箱包装参数" : "单品包装参数" : "产品与拼柜订单"}</h2></div>
            <div className="panel-actions">
              <input ref={fileInputRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); event.currentTarget.value = ""; }} />
              <select className="real-record-select" aria-label="载入用户提供的真实装柜记录" value="" onChange={(event) => loadSuppliedRealRecord(event.target.value)}>
                <option value="" disabled>载入真实记录…</option>
                {HISTORICAL_LOADING_RECORDS.filter((record) => record.models[0].startsWith("实装记录·")).map((record) => (
                  <option key={record.models[0]} value={record.models[0]}>{record.models[0]} · HQ {record.loadingSets["40hq"]} 套</option>
                ))}
              </select>
              <button className="button ghost small real-data-button" onClick={loadRealA64M}><CheckCircle2 size={15} />载入真实 A64M</button>
              <button className="button ghost small" onClick={loadDimensionTest}><PackageOpen size={15} />载入尺寸测试</button>
              <button className="button ghost small" onClick={loadTwoCartonSetTest}><Boxes size={15} />载入 1 套 2 箱</button>
              <button className="button ghost small" onClick={loadMultiCartonSetTest}><Boxes size={15} />载入 1 套 5 箱</button>
              <button className="button ghost small" onClick={downloadTemplate}><Download size={15} />下载模板</button>
              <button className="button ghost small" onClick={() => fileInputRef.current?.click()}><Upload size={15} />导入 CSV</button>
              {mode === "mixed" ? <button className="button primary small" onClick={addProduct}><Plus size={15} />添加 SKU</button> : null}
            </div>
          </div>
          <div className="unit-toolbar" role="group" aria-label="箱规录入单位">
            <div>
              <strong>箱规录入单位</strong>
              <small>切换只改变下方箱规表的录入和显示；内部始终按 mm / kg 计算，装柜数量不会因换单位而改变。</small>
            </div>
            <label>
              <span>长度</span>
              <select aria-label="长度单位" value={lengthUnit} onChange={(event) => {
                if (!isLengthUnit(event.target.value)) return;
                clearNumericDraftErrors();
                setLengthUnit(event.target.value);
              }}>
                {LENGTH_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>重量</span>
              <select aria-label="重量单位" value={weightUnit} onChange={(event) => {
                if (!isWeightUnit(event.target.value)) return;
                clearNumericDraftErrors();
                setWeightUnit(event.target.value);
              }}>
                {WEIGHT_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <section className="set-builder" aria-label={mode === "single" ? "单品多箱包装助手" : "多箱套装助手"}>
              <div className="set-builder-head">
                <div>
                  <span className="section-kicker">MULTI-CARTON KIT</span>
                  <strong>{mode === "single" ? "单品多箱包装" : "多箱套装助手"}</strong>
                  <small>{mode === "single"
                    ? "一个产品可由 2 箱、3 箱或更多箱组成；仍按单品最大装柜计算，不会进入拼柜模式"
                    : "按整套原子装载；支持不同箱规、1:n 比例、多个套装同时拼柜"}</small>
                </div>
                <div className="set-quick-actions" aria-label="新建套装箱数">
                  {[2, 3, 4, 5].map((count) => <button key={count} onClick={() => addCartonSet(count)}><Plus size={13} />{count} 箱套装</button>)}
                </div>
              </div>
              {setInputSummaries.length ? (
                <div className="set-builder-grid">
                  {setInputSummaries.slice(0, MAX_VISIBLE_SET_SUMMARIES).map((summary) => (
                    <article key={summary.setCode} className={mode === "single" || summary.quantitiesAligned ? "aligned" : "misaligned"}>
                      <div className="set-builder-card-main">
                        <span>{summary.setCode}</span>
                        <strong>{summary.componentCount} 种箱规 · {summary.cartonsPerSet} 箱/套</strong>
                        <small>{mode === "single"
                          ? "单品最大装柜会自动求完整套数，无需录入需求箱数"
                          : `当前可完整组成 ${formatNumber(summary.completeSets)} 套${summary.looseCartons ? ` · 另有 ${formatNumber(summary.looseCartons)} 个比例外箱` : ""}`}</small>
                      </div>
                      <div className="set-ratio-list" aria-label={`${summary.setCode} 套内比例`}>
                        {summary.items.slice(0, MAX_VISIBLE_SET_ITEMS).map((item) => <span key={item.productId}><b>{item.sku}</b>× {item.unitsPerSet}</span>)}
                        {summary.items.length > MAX_VISIBLE_SET_ITEMS ? <span>另有 {formatNumber(summary.items.length - MAX_VISIBLE_SET_ITEMS)} 种箱规</span> : null}
                      </div>
                      <div className="set-builder-card-actions">
                        <b className={mode === "single" || summary.quantitiesAligned ? "status-ok" : "status-warning"}>{mode === "single" ? "单品整套测算" : summary.quantitiesAligned ? "数量比例已对齐" : "需求比例未对齐"}</b>
                        {mode === "mixed" && !summary.quantitiesAligned ? <button onClick={() => alignSet(summary.setCode)}><CheckCircle2 size={13} />向下对齐</button> : null}
                        <button onClick={() => addComponentToSet(summary.setCode)}><Plus size={13} />增加箱型</button>
                        <button className="danger" onClick={() => ungroupSet(summary.setCode)}>{mode === "single" ? "恢复单箱" : "取消套装"}</button>
                      </div>
                    </article>
                  ))}
                  {setInputSummaries.length > MAX_VISIBLE_SET_SUMMARIES
                    ? <div className="set-builder-overflow">套装概览仅显示前 {MAX_VISIBLE_SET_SUMMARIES} 组；全部 {formatNumber(setInputSummaries.length)} 组仍可在下方分页表格中编辑并参与计算。</div>
                    : null}
                </div>
              ) : (
                <div className="set-builder-empty">{mode === "single"
                  ? "当前为单箱产品。若一个产品分成多箱包装，可一键改为 2–5 箱，并继续增加第 6 箱及更多箱型。"
                  : "尚未设置套装。可一键创建 2–5 箱结构，也可在创建后继续增加第 6 箱及更多箱型。"}</div>
              )}
          </section>
          {totalProductPages > 1 ? (
            <nav className="product-pagination" aria-label="产品表分页">
              <span>共 {formatNumber(activeProducts.length)} 个 SKU · 第 {currentProductPage + 1} / {totalProductPages} 页</span>
              <div>
                <button type="button" onClick={() => setProductPage(0)} disabled={currentProductPage === 0}>首页</button>
                <button type="button" onClick={() => setProductPage(Math.max(0, currentProductPage - 1))} disabled={currentProductPage === 0}>上一页</button>
                <button type="button" onClick={() => setProductPage(Math.min(totalProductPages - 1, currentProductPage + 1))} disabled={currentProductPage >= totalProductPages - 1}>下一页</button>
                <button type="button" onClick={() => setProductPage(totalProductPages - 1)} disabled={currentProductPage >= totalProductPages - 1}>末页</button>
              </div>
            </nav>
          ) : null}
          <div className="product-table-wrap">
            <table className="product-table">
              <thead><tr><th>标识</th><th>SKU / 品名</th><th>外箱长</th><th>外箱宽</th><th>外箱高</th><th>CBM 自动</th><th>毛重</th>{mode === "mixed" ? <th>需求箱数</th> : null}{mode === "mixed" || isSingleProductSet ? <><th>套装编码</th><th>套内数量</th></> : null}{mode === "mixed" ? <><th>装载优先级</th><th>必装</th></> : null}<th>方向规则</th><th>可承托</th><th>必须底置</th><th>层数上限</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {pagedActiveProducts.map((product) => {
                  const calculatedCbm = exactCartonVolumeCbm(product);
                  const roundedCbm = roundedCartonVolumeCbm(product);
                  return <tr key={product.id}>
                    <td><input className="color-input" aria-label={`${product.sku} 颜色`} type="color" value={product.color} onChange={(event) => updateProduct(product.id, "color", event.target.value)} /></td>
                    <td><input aria-label={`${product.sku} SKU`} maxLength={80} className="sku-input" value={product.sku} onChange={(event) => updateProduct(product.id, "sku", event.target.value)} /><input aria-label={`${product.sku} 品名`} maxLength={200} className="name-input" value={product.name} onChange={(event) => updateProduct(product.id, "name", event.target.value)} /></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={`${product.sku} 外箱长`} value={fromMillimeters(product.length, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "length", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "length", valid)} onFocusChange={handleDimensionFocusChange} /><small className="cell-unit">{lengthUnit}</small></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={`${product.sku} 外箱宽`} value={fromMillimeters(product.width, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "width", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "width", valid)} onFocusChange={handleDimensionFocusChange} /><small className="cell-unit">{lengthUnit}</small></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={`${product.sku} 外箱高`} value={fromMillimeters(product.height, lengthUnit)} precision={lengthUnitPrecision(lengthUnit)} onValueChange={(value) => stageProductDimension(product.id, "height", toMillimeters(value, lengthUnit))} onValidityChange={(valid) => setDimensionFieldValidity(product.id, "height", valid)} onFocusChange={handleDimensionFocusChange} /><small className="cell-unit">{lengthUnit}</small></td>
                    <td className="cbm-cell"><output className="cbm-auto-value" aria-label={`${product.sku} 自动计算 CBM`}>{roundedCbm.toFixed(2)}</output><small className="cell-meta">自动计算 · 精确值 {calculatedCbm.toFixed(4)}</small></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={`${product.sku} 毛重`} value={fromKilograms(product.weight, weightUnit)} precision={weightUnitPrecision(weightUnit)} onValueChange={(value) => updateProduct(product.id, "weight", toKilograms(value, weightUnit))} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:weight`, valid)} /><small className="cell-unit">{weightUnit}</small></td>
                    {mode === "mixed" ? <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={`${product.sku} 需求箱数`} value={product.quantity} integer max={1_000_000} onValueChange={(value) => updateProduct(product.id, "quantity", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:quantity`, valid)} /><small className="cell-unit">箱</small></td> : null}
                    {mode === "mixed" || isSingleProductSet ? <><td><input className="set-code-input" aria-label={`${product.sku} 套装编码`} maxLength={80} value={product.setCode ?? ""} placeholder="留空=散箱" readOnly={mode === "single"} onChange={(event) => updateProduct(product.id, "setCode", event.target.value)} /><small>{mode === "single" ? "同一产品包装" : "同编码组成一套"}</small></td><td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={`${product.sku} 套内数量`} value={product.unitsPerSet || 1} integer min={1} max={99} onValueChange={(value) => updateProduct(product.id, "unitsPerSet", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:unitsPerSet`, valid)} /><small className="cell-unit">箱 / 套</small></td></> : null}
                    {mode === "mixed" ? <><td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={`${product.sku} 装载优先级`} value={product.priority} integer max={100} onValueChange={(value) => updateProduct(product.id, "priority", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:priority`, valid)} /><small className="cell-meta">数值越高越先装</small></td><td><label className="switch" title="必装货物优先于塞货，并在缺装时单独告警"><input aria-label={`${product.sku} 必装`} type="checkbox" checked={product.mustLoad !== false} onChange={(event) => updateProduct(product.id, "mustLoad", event.target.checked)} /><span /></label></td></> : null}
                    <td>
                      <select className="constraint-select" aria-label={`${product.sku} 方向规则`} value={product.rotationPolicy} onChange={(event) => updateProduct(product.id, "rotationPolicy", event.target.value)}>
                        <option value="fixed">固定方向</option>
                        <option value="upright">仅平面旋转</option>
                        <option value="any">任意旋转</option>
                      </select>
                    </td>
                    <td><label className="switch" title="关闭后，其他箱体不能放在此产品上方"><input aria-label={`${product.sku} 可承托`} type="checkbox" checked={product.stackable} onChange={(event) => updateProduct(product.id, "stackable", event.target.checked)} /><span /></label></td>
                    <td><label className="switch" title="开启后该产品只允许摆放在集装箱地板"><input aria-label={`${product.sku} 必须底置`} type="checkbox" checked={product.bottomOnly === true} onChange={(event) => updateProduct(product.id, "bottomOnly", event.target.checked)} /><span /></label></td>
                    <td className="numeric-cell"><NumericInput resetToken={numericResetVersion} ariaLabel={`${product.sku} 层数上限`} value={product.maxStackLayers} integer max={99} onValueChange={(value) => updateProduct(product.id, "maxStackLayers", value)} onValidityChange={(valid) => setNumericFieldValidity(`product:${product.id}:maxStackLayers`, valid)} /><small className="cell-meta" title="0 表示不设置人为层数上限，仍受柜高、门高、承托和载重约束">0 = 自动按柜高</small></td>
                    <td>{mode === "mixed" || isSingleProductSet ? <button className="icon-button danger" aria-label={`删除 ${product.sku}`} onClick={() => removeProduct(product.id)} disabled={activeProducts.length <= 1}><Trash2 size={16} /></button> : null}</td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          <div className="table-note"><CircleAlert size={16} /><span>{mode === "single"
            ? "这里每一行代表同一个产品的一种外箱，不代表多个产品拼柜。系统按完整套数装载，任一组成箱放不下即整套回滚。"
            : "相同“套装编码”的任意数量 SKU 会按“套内数量”组成原子批次：支持 2/3/4/5 箱及更多箱型，也支持 1:4、1:2:2 等比例；任一组成箱放不下即整套回滚。"}</span></div>
          {hasPendingDimensionChanges ? (
            <div className="dimension-edit-notice" role="status">
              <LoaderCircle size={16} />
              <span><b>尺寸录入期间暂停计算</b>当前保留上一次已校验方案；可连续填写所有行的长、宽、高，离开尺寸输入区后仅统一重算一次。</span>
            </div>
          ) : null}
        </section>

        {result ? (
          <section className="result-section">
            <div className="result-title"><div><span className="section-kicker">CALCULATED PLAN</span><h2>方案结果</h2></div><span className="run-meta">{resultPlanLimitDisplay !== null
              ? `现场计划方案 · ${formatNumber(resultLoadedDisplay)} ${resultDisplayUnit === "set" ? "套" : "箱"}可执行${resultPlanLimitDisplay !== resultLoadedDisplay ? ` · 算术上限 ${formatNumber(resultPlanLimitDisplay)} ${resultDisplayUnit === "set" ? "套" : "箱"}` : ""}`
              : result.strategy === "practical" ? `现场可执行上限 · 经验率 ${(result.practicalTargetUtilization * 100).toFixed(1)}%` : "高密度启发式结果 · 非最优性证明"} · 算法 {result.engineVersion} · {formatNumber(result.metrics.solveTimeMs, 1)} ms</span></div>
            <div className="metrics-grid">
              <MetricCard
                icon={<PackageOpen size={21} />}
                label={result.mode === "single"
                  ? resultPlanLimitDisplay !== null
                    ? result.setSummaries.length ? "计划装载套数" : "计划装载箱数"
                    : result.setSummaries.length ? "最大可装套数" : "最大可装"
                  : "已装件数"}
                value={result.mode === "single" && result.setSummaries.length
                  ? `${formatNumber(result.setSummaries[0].loadedSets)} 套`
                  : `${formatNumber(result.metrics.loadedCount)} 件`}
                detail={result.mode === "single"
                  ? result.setSummaries.length ? `完整装入 ${formatNumber(result.metrics.loadedCount)} 箱` : "规则排布可执行数量"
                  : `需求 ${formatNumber(result.metrics.requestedCount)} 件`}
              />
              <MetricCard icon={<Layers3 size={21} />} label="体积利用率" value={formatPercent(result.metrics.volumeUtilization)} detail={`${(result.metrics.loadedVolume / 1_000_000_000).toFixed(2)} CBM`} tone="blue" />
              <MetricCard icon={<Weight size={21} />} label="已装毛重" value={`${formatNumber(result.metrics.grossWeight, 1)} kg`} detail={`载重利用 ${formatPercent(result.metrics.weightUtilization)}`} tone="amber" />
              <MetricCard icon={<ShieldCheck size={21} />} label="独立校验" value={result.validation.valid ? "全部通过" : `${result.validation.errors.length} 项异常`} detail="边界 · 重叠 · 堆叠 · 载重" tone={result.validation.valid ? "green" : "red"} />
            </div>

            {result.mode === "single" && !dirty ? (
              <section className="planning-comparison" aria-label="稳健计划量与当前装柜方案对比">
                <div className="planning-comparison-head">
                  <div><span className="section-kicker">PLAN TARGET × CAPACITY</span><strong>稳健计划量与装载上限分开核算</strong><small>计划量遵守 {targetVolumePercent}% 体积 / {targetWeightPercent}% 载重目标；装载上限只受空间、门洞、方向与最大载重约束。</small></div>
                  <b className={resultPlanningDelta === 0 ? "matched" : resultPlanningDelta > 0 ? "over" : "under"}>{resultPlanningDelta === 0
                    ? "与计划一致"
                    : `${resultPlanningDelta > 0 ? "超过计划" : "低于计划"} ${formatNumber(Math.abs(resultPlanningDelta))} ${resultDisplayUnit === "set" ? "套" : "箱"}`}</b>
                </div>
                <div className="planning-comparison-grid">
                  <article><span>统一建议量</span><strong>{formatNumber(selectedFeasibleRecommendation.displayQuantity)} {reversePlan.displayUnit === "set" ? "套" : "箱"}</strong><small>{selectedFeasibleRecommendation.displayQuantity < reversePlan.recommendedDisplay ? `倒推 ${formatNumber(reversePlan.recommendedDisplay)}，受当前算法真实坐标上限限制` : reversePlan.limitingFactor === "volume" ? `受 ${targetVolumePercent}% 体积目标限制` : reversePlan.limitingFactor === "weight" ? `受 ${targetWeightPercent}% 载重目标限制` : "两个目标同时限制"}</small></article>
                  <article className={resultPlanLimitDisplay === null ? "selected" : ""}><span>当前坐标方案</span><strong>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? "套" : "箱"}</strong><small>实际体积 {formatPercent(result.metrics.volumeUtilization)} · 实际载重 {formatPercent(result.metrics.weightUtilization)}</small></article>
                  <article className="explanation"><span>口径说明</span><strong>{resultPlanLimitDisplay !== null ? "按计划封顶" : "按策略求上限"}</strong><small>{resultPlanLimitDisplay !== null ? "当前方案主动保留安全余量，不代表柜内只能装这么多。" : "当前结果可以高于计划量，但绝不允许超过柜型最大载重。"}</small></article>
                </div>
              </section>
            ) : null}

            {result.strategyComparison && !dirty ? (
              <section className="strategy-comparison" aria-label="现场与极限算法对比">
                <div className="strategy-comparison-head">
                  <div><span className="section-kicker">TWO INDEPENDENT SOLVERS</span><strong>现场算法 × 高密度参考算法</strong><small>同一份输入分别计算；高密度结果只把安全子集反向下放到现场方案。</small></div>
                  <b className={result.strategyComparison.sameQuantity ? "matched" : "gain"}>{result.strategyComparison.sameQuantity
                    ? "当前数量一致"
                    : `理论多 ${formatNumber(result.strategyComparison.gainQuantity)} ${result.strategyComparison.displayUnit === "set" ? "套" : "箱"}`}</b>
                </div>
                <div className="strategy-comparison-grid">
                  <article className={result.strategy === "practical" ? "selected" : ""}>
                    <span><ShieldCheck size={15} />现场易执行算法</span>
                    <strong>{formatNumber(result.strategyComparison.practical.displayQuantity)} {result.strategyComparison.displayUnit === "set" ? "套" : "箱"}</strong>
                    <small>体积 {formatPercent(result.strategyComparison.practical.volumeUtilization)} · 最多 {result.strategyComparison.practical.executionComplexity.maxOrientationsPerSku} 种水平朝向 · 侧翻 0 · {formatNumber(result.strategyComparison.practical.solveTimeMs, 0)} ms</small>
                  </article>
                  <article className={result.strategy === "maximum" ? "selected maximum" : "maximum"}>
                    <span><Gauge size={15} />高密度参考算法</span>
                    <strong>{formatNumber(result.strategyComparison.maximum.displayQuantity)} {result.strategyComparison.displayUnit === "set" ? "套" : "箱"}</strong>
                    <small>体积 {formatPercent(result.strategyComparison.maximum.volumeUtilization)} · 最多 {result.strategyComparison.maximum.executionComplexity.maxOrientationsPerSku} 种方向 · 侧翻 {formatNumber(result.strategyComparison.maximum.executionComplexity.tippedCartonCount)} 箱 · {formatNumber(result.strategyComparison.maximum.solveTimeMs, 0)} ms</small>
                  </article>
                  <article className="delta">
                    <span>可研究增量</span>
                    <strong>{result.strategyComparison.sameQuantity ? "已追平" : `+${formatPercent(result.strategyComparison.gainRatio)}`}</strong>
                    <small>{result.strategyComparison.sameQuantity ? "复杂摆法未增加数量" : "先看方向、侧翻与承托来源"}</small>
                  </article>
                </div>
                <div className="strategy-guidance-list">
                  {result.strategyComparison.guidance.map((item) => <article key={`${item.level}-${item.title}`} className={`guidance-${item.level}`}><b>{item.title}</b><span>{item.detail}</span></article>)}
                </div>
              </section>
            ) : null}

            {result.quoteEstimate && !dirty ? (
              <section className={`real-benchmark ${result.quoteEstimate.physicallyPossibleByBounds ? "bounds-ok" : "bounds-impossible"}`} aria-label="报价预测与三维物理方案对比">
                <div className="real-benchmark-copy">
                  <span className="section-kicker">DUAL-TRACK ESTIMATE</span>
                  <strong>报价经验预测 × 三维物理方案</strong>
                  <small>{result.quoteEstimate.source === "historical-exact"
                    ? `已精确命中历史包装指纹：${result.quoteEstimate.matchedModels.join(" / ")}；忠实重放该条报价记录，但不绕过物理校验。`
                    : result.quoteEstimate.source === "historical-near"
                      ? `尺寸/重量接近历史记录：${result.quoteEstimate.matchedModels.join(" / ")}；仅作相近包装参考，不作为零误差记录，也不封顶三维现场方案。`
                      : `按当前柜型 ${result.quoteEstimate.calibratedCargoVolumeCbm.toFixed(2)} CBM 基线预测；${result.quoteEstimate.verifiedDataPoints} 个物理可行数据点留一验证：平均 ${result.quoteEstimate.backtestMeanErrorPct.toFixed(1)}%，90% 不超过 ${result.quoteEstimate.backtestP90ErrorPct.toFixed(1)}%，最差 ${result.quoteEstimate.backtestMaxErrorPct.toFixed(1)}%。`}</small>
                </div>
                <div><span>报价经验预测</span><strong>{formatNumber(result.quoteEstimate.predictedSets)} 套</strong><small>{result.quoteEstimate.confidence === "verified" ? "完全相同包装 · 重放历史记录" : `典型误差约 ±${result.quoteEstimate.expectedErrorPct.toFixed(1)}%`}</small></div>
                <div><span>三维可执行方案</span><strong>{formatNumber(result.quoteEstimate.physicalLoadedSets)} 套</strong><small>无重叠坐标 · 独立校验</small></div>
                <div className={result.quoteEstimate.physicallyPossibleByBounds ? (result.quoteEstimate.gapSets === 0 ? "matched" : "different") : "impossible"}>
                  <span>{result.quoteEstimate.physicallyPossibleByBounds ? "双轨差距" : "物理边界"}</span>
                  <strong>{result.quoteEstimate.physicallyPossibleByBounds
                    ? result.quoteEstimate.gapSets === 0
                      ? "完全一致"
                      : `${result.quoteEstimate.gapSets > 0 ? "+" : ""}${formatNumber(result.quoteEstimate.gapSets)} 套`
                    : "报价值不可三维实现"}</strong>
                  <small>体积边界 {formatPercent(result.quoteEstimate.volumeBoundRatio)} · 载重边界 {formatPercent(result.quoteEstimate.weightBoundRatio)}</small>
                </div>
              </section>
            ) : null}

            <div className="execution-summary" aria-label="现场执行复杂度">
              <span><b>{result.metrics.executionComplexity.maxOrientationsPerSku}</b> 单 SKU 最大方向数</span>
              <span><b>{result.metrics.executionComplexity.orientationVariants}</b> 全方案方向组合</span>
              <span className={result.metrics.executionComplexity.partialSupportCount ? "attention" : "safe"}><b>{result.metrics.executionComplexity.partialSupportCount}</b> 局部支撑箱体</span>
              <span className={result.metrics.executionComplexity.tippedCartonCount ? "attention" : "safe"}><b>{result.metrics.executionComplexity.tippedCartonCount}</b> 侧翻箱体</span>
              <small>{result.strategy === "practical" ? "装载顺序已按支撑依赖和柜头→柜门重排" : "极限模式可能增加现场操作复杂度"}</small>
            </div>

            {result.setSummaries.length ? (
              <section className="set-summary-panel" aria-label="成套装载结果">
                <div className="set-summary-heading"><div><span className="section-kicker">SET LOADING</span><strong>完整套数校验</strong></div><small>原子批次装载 · 放不下时整套回滚</small></div>
                <div className="set-summary-grid">
                  {result.setSummaries.map((setSummary) => (
                    <article key={setSummary.setCode} className={setSummary.unloadedSets ? "incomplete" : "complete"}>
                      <div className="set-summary-main"><span>{setSummary.setCode} · {setSummary.componentCount} 种箱规 · {setSummary.cartonsPerSet} 箱/套</span><strong>{formatNumber(setSummary.loadedSets)} <small>/ {formatNumber(setSummary.requestedSets)} 套</small></strong><b>{setSummary.unloadedSets ? `未装 ${formatNumber(setSummary.unloadedSets)} 套` : `全部成套 · 共 ${formatNumber(setSummary.loadedCartons)} 箱`}</b></div>
                      <div className="set-component-list">
                        {setSummary.items.map((item) => <span key={item.productId}><b>{item.sku}</b>{item.loadedQuantity} 箱 · {item.unitsPerSet} 箱/套</span>)}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="result-grid">
              <article className="panel summary-panel">
                <div className="panel-head"><div><h3>SKU 装载明细</h3><span>已装、未装和装载完成率</span></div></div>
                <div className="summary-list">
                  {result.summaries.map((item) => {
                    const completion = item.requested > 0 ? item.loaded / item.requested : 1;
                    return (
                      <div className="summary-item" key={item.productId}>
                        <i style={{ background: item.color }} />
                        <div className="summary-name"><strong>{item.sku}</strong><span>{item.name}</span></div>
                        <div className="progress"><span style={{ width: `${Math.min(100, completion * 100)}%`, background: item.color }} /></div>
                        <div className="summary-count"><strong>{item.loaded}</strong><span> / {item.requested}</span></div>
                        <div className={`unloaded ${item.unloaded ? "has-unloaded" : ""}`}>{item.unloaded ? `未装 ${item.unloaded}` : "已装完"}</div>
                      </div>
                    );
                  })}
                </div>
              </article>
              <article className="panel warning-panel">
                <div className="panel-head"><div><h3>校验与提示</h3><span>现场执行前仍需按实际箱号复核</span></div></div>
                <div className={`balance-box ${result.metrics.centerOfGravity.balanced ? "balanced" : "attention"}`}>
                  <div className="balance-copy">
                    <Crosshair size={17} />
                    <div><strong>重心分布</strong><span>长向 {(result.metrics.centerOfGravity.longitudinalRatio * 100).toFixed(1)}% · 横向 {(result.metrics.centerOfGravity.lateralRatio * 100).toFixed(1)}% · 高度 {(result.metrics.centerOfGravity.heightRatio * 100).toFixed(1)}%</span></div>
                  </div>
                  <div className="balance-map" aria-label="集装箱重心俯视位置">
                    <span className="balance-zone" />
                    <i style={{ left: `${Math.min(100, Math.max(0, result.metrics.centerOfGravity.longitudinalRatio * 100))}%`, top: `${Math.min(100, Math.max(0, result.metrics.centerOfGravity.lateralRatio * 100))}%` }} />
                  </div>
                  <b>{result.metrics.centerOfGravity.balanced ? "重心位于建议区间" : "重心偏离建议区间，请复核配重"}</b>
                </div>
                <div className={`validation-box ${result.validation.valid ? "valid" : "invalid"}`}>
                  {result.validation.valid ? <CheckCircle2 size={20} /> : <X size={20} />}
                  <div><strong>{result.validation.valid ? "方案数据合法" : "方案校验未通过"}</strong><span>{result.validation.valid ? "所有箱体均在有效边界内，无重叠且未超载。" : result.validation.errors[0]}</span></div>
                </div>
                <ul className="warning-list">
                  {(result.warnings.length ? result.warnings : ["未发现门洞、载重或订单缺口告警。"]).map((warning) => <li key={warning}><CircleAlert size={15} />{warning}</li>)}
                </ul>
              </article>
            </div>

            <article id="coordinates" className="panel coordinate-panel">
              <div className="panel-head">
                <div><span className="section-kicker">PLACEMENT DATA</span><h2>三维坐标与装载清单</h2><p>预览前 80 条；导出包含全部 {formatNumber(result.placements.length)} 条可视化摆放记录。</p></div>
                <div className="panel-actions"><button className="button ghost small" onClick={printPlan} disabled={!canExport}><Printer size={15} />打印指导书</button><button className="button ghost small" onClick={exportJson} disabled={!canExport}><FileJson size={15} />方案 JSON</button><button className="button primary small" onClick={exportCsv} disabled={!canExport}><FileSpreadsheet size={15} />导出坐标 CSV</button></div>
              </div>
              <div className="coordinate-wrap">
                <table className="coordinate-table">
                  <thead><tr><th>#</th><th>SKU</th><th>套装 / 套号</th><th>X</th><th>Y</th><th>Z</th><th>摆放尺寸（长×宽×高）</th><th>方向</th><th>层级</th><th>重量</th></tr></thead>
                  <tbody>{result.placements.slice(0, 80).map((box, index) => <tr key={box.id}><td>{index + 1}</td><td><i style={{ background: box.color }} />{box.sku}</td><td>{box.setCode ? `${box.setCode} · 第 ${box.setNumber} 套 · ${box.setItemNumber}/${result.setSummaries.find((item) => item.setCode === box.setCode)?.cartonsPerSet ?? ""}` : "散箱"}</td><td>{formatNumber(box.x)}</td><td>{formatNumber(box.y)}</td><td>{formatNumber(box.z)}</td><td>{formatNumber(box.dx)} × {formatNumber(box.dy)} × {formatNumber(box.dz)} mm</td><td>{box.orientation}</td><td>第 {box.layer} 层</td><td>{box.weight} kg</td></tr>)}</tbody>
                </table>
              </div>
            </article>
          </section>
        ) : (
          <section className="empty-result"><PackageOpen size={30} /><div><strong>{status === "working" || dirty ? "正在生成最新方案" : "等待有效输入"}</strong><span>{status === "working" || dirty ? "系统会自动生成双算法坐标并执行独立校验，无需重复点击计算。" : "填写有效参数后会自动开始测算。"}</span></div></section>
        )}

        <footer className="app-footer"><span>外贸装柜智算 · Desktop-first local calculation</span><span>尺寸与柜型预设仅供测算，正式出货请复核实际数据</span></footer>
      </div>
    </main>
  );
}
