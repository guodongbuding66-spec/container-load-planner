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
  Rotate3D,
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
import type { CameraProjection, CameraView } from "../lib/packing/camera-fit";
import { buildPlacementCsv, MAX_CSV_BYTES, MAX_CSV_ROWS, parseProductsCsv } from "../lib/packing/csv";
import {
  calculateReverseCounts,
  DEFAULT_PRACTICAL_TARGET,
  ENGINE_VERSION,
  packWithComparison,
  recommendedPracticalTarget,
} from "../lib/packing/engine";
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
import { OrthographicViews } from "./orthographic-views";
import { SceneErrorBoundary } from "./scene-error-boundary";

const ContainerScene = dynamic(() => import("./container-scene").then((module) => module.ContainerScene), {
  ssr: false,
  loading: () => <div className="scene-loading">正在准备三维视图…</div>,
});

const STORAGE_KEY = "cargo-fit-workspace-v1";
const COLORS = ["#2f7f89", "#c66a3d", "#d5a72f", "#6b72a9", "#609d62", "#a95e78", "#447ca8"];
const VALID_COLOR = /^#[0-9a-f]{6}$/i;

type CalcStatus = "idle" | "working" | "done" | "error";

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
    maxStackLayers: 8,
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
  const [result, setResult] = useState<PackingResult | null>(null);
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
  const [packingProgress, setPackingProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [cameraView, setCameraView] = useState<CameraView>("perspective");
  const [cameraProjection, setCameraProjection] = useState<CameraProjection>("perspective");
  const [storageError, setStorageError] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const activeRevisionRef = useRef<number | null>(null);
  const inputRevisionRef = useRef(0);
  const pendingPayloadRef = useRef<PackingRequest | null>(null);
  const packingProgressRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptResult = useCallback((nextResult: PackingResult, successMessage: string) => {
    if (activeRevisionRef.current !== inputRevisionRef.current) {
      activeRequestRef.current = null;
      activeRevisionRef.current = null;
      pendingPayloadRef.current = null;
      setIsPlaying(false);
      setStatus("idle");
      setMessage("计算期间输入已变化，旧结果已安全丢弃；请按当前参数重新计算");
      return;
    }
    setResult(nextResult);
    setVisibleProducts(new Set(nextResult.summaries.map((item) => item.productId)));
    setPackingProgress(nextResult.placements.length);
    setIsPlaying(false);
    setCameraView("perspective");
    setCameraProjection("perspective");
    setStatus(nextResult.validation.valid ? "done" : "error");
    setDirty(false);
    activeRequestRef.current = null;
    activeRevisionRef.current = null;
    pendingPayloadRef.current = null;
    setMessage(nextResult.validation.valid
      ? successMessage
      : `方案未通过独立校验，已阻止打印与导出：${nextResult.validation.errors[0] ?? "请检查异常明细"}`);
  }, []);

  const runFallback = useCallback(
    (payload: PackingRequest) => {
      window.setTimeout(() => {
        try {
          acceptResult(packWithComparison(payload), "双算法方案已在兼容模式下生成并完成校验");
        } catch (fallbackError) {
          activeRequestRef.current = null;
          activeRevisionRef.current = null;
          pendingPayloadRef.current = null;
          setStatus("error");
          setMessage(fallbackError instanceof Error ? fallbackError.message : "计算失败");
        }
      }, 30);
    },
    [acceptResult],
  );

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
    let feedbackTimer: number | undefined;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mode, strategy, practicalTargetPercent, container, clearance, products, customContainers, targetVolumePercent, targetWeightPercent }),
      );
      feedbackTimer = window.setTimeout(() => setStorageError(false), 0);
    } catch {
      feedbackTimer = window.setTimeout(() => {
        setStorageError(true);
        setMessage("本机草稿保存失败：浏览器存储不可用或空间不足");
      }, 0);
    }
    return () => {
      if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer);
    };
  }, [clearance, container, customContainers, hydrated, mode, practicalTargetPercent, products, strategy, targetVolumePercent, targetWeightPercent]);

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/packing/packing.worker.ts", import.meta.url), { type: "module" });
    } catch {
      workerRef.current = null;
      return;
    }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== activeRequestRef.current) return;
      if (response.type === "error") {
        activeRequestRef.current = null;
        activeRevisionRef.current = null;
        pendingPayloadRef.current = null;
        setStatus("error");
        setMessage(response.message);
        return;
      }
      acceptResult(response.payload, `现场与极限双算法已完成，并通过${response.payload.validation.valid ? "独立校验" : "异常检查"}`);
    };
    worker.onerror = () => {
      worker.terminate();
      workerRef.current = null;
      const pendingPayload = pendingPayloadRef.current;
      if (pendingPayload) runFallback(pendingPayload);
      else {
        activeRequestRef.current = null;
        activeRevisionRef.current = null;
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, [acceptResult, runFallback]);

  useEffect(() => {
    packingProgressRef.current = packingProgress;
  }, [packingProgress]);

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
    setDirty(true);
    setIsPlaying(false);
    if (status === "working") setMessage("输入已修改；当前旧参数计算完成后将自动丢弃");
    else if (status === "done") setMessage("输入已修改，请重新计算；旧方案已禁止导出");
  }, [status]);

  const activeProducts = useMemo(() => selectProductsForMode(products, mode), [mode, products]);
  const setInputSummaries = useMemo(() => summarizeSetInputs(activeProducts), [activeProducts]);
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
      { mode, strategy, practicalTargetUtilization: practicalTargetPercent / 100, container, clearance, products: activeProducts },
      targetVolumePercent / 100,
      targetWeightPercent / 100,
    ),
    [activeProducts, clearance, container, mode, practicalTargetPercent, strategy, targetVolumePercent, targetWeightPercent],
  );
  const resultDisplayUnit = result?.mode === "single" && result.setSummaries.length ? "set" : "carton";
  const resultLoadedDisplay = result
    ? resultDisplayUnit === "set" ? result.setSummaries[0]?.loadedSets ?? 0 : result.metrics.loadedCount
    : 0;
  const resultPlanLimitDisplay = result?.singleCartonLimit !== undefined
    ? resultDisplayUnit === "set"
      ? Math.floor(result.singleCartonLimit / (result.setSummaries[0]?.cartonsPerSet ?? 1))
      : result.singleCartonLimit
    : null;
  const resultPlanningDelta = result && result.mode === "single"
    ? resultLoadedDisplay - reversePlan.recommendedDisplay
    : 0;

  const containerChoices = useMemo(() => [...CONTAINER_PRESETS, ...customContainers], [customContainers]);
  const hasKnownContainer = containerChoices.some((item) => item.id === container.id);

  const updateContainer = (field: keyof ContainerSpec, value: string | number) => {
    setContainer((current) => ({
      ...current,
      id: "custom-draft",
      name: "自定义柜型（未保存）",
      [field]: typeof value === "number" ? value : numberValue(value),
    }));
    markDirty();
  };

  const selectPreset = (id: string) => {
    const preset = containerChoices.find((item) => item.id === id);
    if (!preset) return;
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
    const saved: ContainerSpec = { ...container, id: `custom-${Date.now()}`, name };
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

  const addProduct = () => {
    setProducts((current) => [...current, createProduct(current.length)]);
    markDirty();
  };

  const addCartonSet = (cartonCount: number) => {
    const safeCount = Math.min(20, Math.max(2, Math.floor(cartonCount)));
    setProducts((current) => {
      const existing = mode === "single" ? [] : current;
      const setCode = nextSetCode(existing, safeCount);
      const components = Array.from({ length: safeCount }, (_, componentIndex) =>
        createSetComponent(existing.length + componentIndex, setCode, componentIndex, safeCount),
      );
      return mode === "single" ? components : [...existing, ...components];
    });
    setResult(null);
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
    markDirty();
    setMessage(`套装 ${code} 已安全向下对齐为 ${summary?.completeSets ?? 0} 个完整套，未擅自增加订单数量。`);
  };

  const ungroupSet = (code: string) => {
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
    setProducts((current) => (current.length <= 1 ? current : current.filter((item) => item.id !== id)));
    markDirty();
  };

  const loadSample = () => {
    setMode("mixed");
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(SAMPLE_PRODUCTS.map((item) => ({ ...item })));
    setResult(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage("已载入户外产品拼柜示例");
  };

  const loadDimensionTest = () => {
    setMode("mixed");
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(DIMENSION_TEST_PRODUCTS.map((item) => ({ ...item })));
    setResult(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage("已载入你提供的 3 组 CM 尺寸；CBM 将由外箱尺寸自动计算到小数点后两位");
  };

  const loadTwoCartonSetTest = () => {
    setMode("single");
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(TWO_CARTON_SET_PRODUCTS.map((item) => ({ ...item })));
    setResult(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage("已载入单品 1 套 2 箱：保持单品模式，自动计算最大完整套数，无需填写需求箱数");
  };

  const loadMultiCartonSetTest = () => {
    setMode("single");
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setClearance(10);
    setProducts(MULTI_CARTON_SET_PRODUCTS.map((item) => ({ ...item })));
    setResult(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage("已载入单品 1 套 5 箱；保持单品模式，3 箱、4 箱及更多箱型使用同一通用算法。");
  };

  const loadRealA64M = () => {
    setMode("single");
    setStrategy("practical");
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
    setContainer({ ...CONTAINER_PRESETS[2] });
    setClearance(10);
    setProducts(REAL_WORLD_A64M_PRODUCTS.map((item) => ({ ...item })));
    setResult(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage("已载入真实 SLM-A64M：报价轨按已确认的 396 套展示，三维轨继续计算无重叠物理方案");
  };

  const loadSuppliedRealRecord = (model: string) => {
    const record = HISTORICAL_LOADING_RECORDS.find((item) => item.models.includes(model));
    if (!record) return;
    const setCodeValue = record.cartons.length > 1 ? `REAL-${model.replaceAll(/[^A-Za-z0-9]+/g, "-")}` : "";
    setMode("single");
    setStrategy("practical");
    setContainer({ ...CONTAINER_PRESETS[2] });
    setPracticalTargetPercent(recommendedPracticalTarget(CONTAINER_PRESETS[2]) * 100);
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
    setResult(null);
    setCameraView("perspective");
    setCameraProjection("perspective");
    markDirty();
    setStatus("idle");
    setMessage(`已载入 ${model}；40HQ 历史实装 ${record.loadingSets["40hq"]} 套，计算后将同时显示历史预测与无重叠三维方案。`);
  };

  const validateInputs = () => {
    if (!activeProducts.length) return "请至少添加一个产品。";
    if ([container.length, container.width, container.height, container.doorWidth, container.doorHeight, container.maxWeight].some((value) => !Number.isFinite(value) || value <= 0)) {
      return "柜型尺寸、门洞和载重必须大于 0。";
    }
    if (
      !Number.isFinite(clearance) ||
      clearance < 0 ||
      clearance * 2 >= container.length ||
      clearance * 2 >= container.width ||
      clearance >= container.height ||
      clearance * 2 >= container.doorWidth ||
      clearance >= container.doorHeight
    ) {
      return "安全间隙过大，已占满柜内空间或门洞。";
    }
    const invalid = activeProducts.find(
      (item) =>
        !item.sku.trim() ||
        ![item.length, item.width, item.height, item.weight, item.quantity, item.priority, item.maxStackLayers, item.unitsPerSet].every(Number.isFinite) ||
        item.length <= 0 ||
        item.width <= 0 ||
        item.height <= 0 ||
        item.weight < 0 ||
        item.maxStackLayers < 0 ||
        (Boolean(item.setCode?.trim()) && (!item.unitsPerSet || item.unitsPerSet < 1)) ||
        (mode === "mixed" && item.quantity <= 0),
    );
    return invalid ? `${invalid.sku || "未命名产品"} 的尺寸、重量或数量不完整。` : null;
  };

  const submitPacking = (payload: PackingRequest, workingMessage = "正在生成可行摆放并执行边界、重叠与载重校验…") => {
    const requestId = `request-${Date.now()}`;
    activeRequestRef.current = requestId;
    activeRevisionRef.current = inputRevisionRef.current;
    pendingPayloadRef.current = payload;
    setStatus("working");
    setMessage(workingMessage);
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "pack", requestId, payload });
    } else {
      runFallback(payload);
    }
  };

  const calculate = () => {
    const error = validateInputs();
    if (error) {
      setStatus("error");
      setMessage(error);
      return;
    }
    submitPacking({
      mode,
      strategy,
      practicalTargetUtilization: practicalTargetPercent / 100,
      container,
      clearance,
      products: activeProducts,
    });
  };

  const applyReversePlan = () => {
    if (reversePlan.recommendedTotal <= 0) {
      setStatus("error");
      setMessage("当前目标利用率无法倒推出有效箱数，请检查产品尺寸、重量与柜型。");
      return;
    }
    if (mode === "single") {
      const error = validateInputs();
      if (error) {
        setStatus("error");
        setMessage(error);
        return;
      }
      setStrategy("practical");
      submitPacking(
        {
          mode: "single",
          strategy: "practical",
          practicalTargetUtilization: practicalTargetPercent / 100,
          singleCartonLimit: reversePlan.recommendedTotal,
          container,
          clearance,
          products: activeProducts,
        },
        `正在按 ${targetVolumePercent}% 体积 / ${targetWeightPercent}% 载重目标生成 ${reversePlan.recommendedDisplay.toLocaleString()} ${reversePlan.displayUnit === "set" ? "套" : "箱"}现场方案…`,
      );
      return;
    }
    const suggestedByProduct = new Map(reversePlan.quantities.map((item) => [item.productId, item.suggestedQuantity]));
    const nextProducts = activeProducts.map((product) => ({
      ...product,
      quantity: suggestedByProduct.get(product.id) ?? 0,
    }));
    setProducts(nextProducts);
    setMode("mixed");
    markDirty();
    submitPacking(
      { mode: "mixed", strategy, practicalTargetUtilization: practicalTargetPercent / 100, container, clearance, products: nextProducts },
      `已按当前 SKU 比例倒推 ${reversePlan.recommendedTotal.toLocaleString()} 箱，正在验证真实摆放…`,
    );
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
    if (!result?.validation.valid || dirty) return;
    setIsPlaying(false);
    window.print();
  };

  const exportJson = () => {
    if (!result?.validation.valid || dirty) return;
    downloadFile(`装柜方案_${result.container.id}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(result, null, 2), "application/json");
  };

  const exportCsv = () => {
    if (!result?.validation.valid || dirty) return;
    downloadFile(`装柜坐标_${result.container.id}.csv`, `\uFEFF${buildPlacementCsv(result)}`, "text/csv;charset=utf-8");
  };

  const downloadTemplate = () => {
    const lines = [
      "sku,name,length,width,height,weight,quantity,priority,setCode,unitsPerSet,rotationPolicy,stackable,maxStackLayers,mustLoad,bottomOnly,color",
      "SET5-A-128,五箱套装A箱,1280,540,110,40,120,100,SET-5BOX,1,upright,true,22,true,false,#2f7f89",
      "SET5-B-068,五箱套装B箱,680,540,110,14,120,100,SET-5BOX,1,upright,true,22,true,false,#a95e78",
      "SET5-C-103,五箱套装C箱,1030,620,120,30,120,100,SET-5BOX,1,upright,true,20,true,false,#d5a72f",
      "SET5-D-052,五箱套装D箱,520,350,180,12,120,100,SET-5BOX,1,upright,true,15,true,false,#6b72a9",
      "SET5-E-090,五箱套装E箱,900,420,140,18,120,100,SET-5BOX,1,upright,true,18,true,false,#609d62",
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
      setProducts(parsed);
      setMode("mixed");
      setResult(null);
      markDirty();
      setStatus("idle");
      setMessage(`已导入 ${parsed.length} 个 SKU，请检查后计算`);
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
  const canExport = Boolean(result?.validation.valid && !dirty && status !== "working");

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
            <span className={`save-state ${dirty ? "is-dirty" : ""} ${storageError ? "is-error" : ""}`}><Save size={15} />{storageError ? "草稿未能保存" : dirty ? "草稿已保存 · 待重算" : "本机草稿已保存"}</span>
            <button className="button ghost" onClick={loadSample}><Sparkles size={16} />载入示例</button>
            <button className="button ghost" onClick={printPlan} disabled={!canExport}><Printer size={16} />现场指导书</button>
            <button className="button ghost" onClick={exportJson} disabled={!canExport}><FileJson size={16} />导出方案</button>
          </div>
        </header>

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
                <button aria-pressed={mode === "single"} className={mode === "single" ? "active" : ""} onClick={() => { if (mode !== "single") { setMode("single"); markDirty(); } }}><Box size={17} />单品最大装柜</button>
                <button aria-pressed={mode === "mixed"} className={mode === "mixed" ? "active" : ""} onClick={() => { if (mode !== "mixed") { setMode("mixed"); markDirty(); } }}><Boxes size={17} />多 SKU 拼柜</button>
              </div>
              <p className="helper-text">{mode === "single"
                ? isSingleProductSet
                  ? `这是一个 ${singleSetSummary?.cartonsPerSet ?? 0} 箱/套的单品包装，自动计算最大完整套数，不需要填写需求箱数。`
                  : "单箱或多箱都属于单品最大装柜，系统自动计算可装量，不需要填写需求数量。"
                : "按订单数量、优先级、门洞与载重生成可校验的混装方案。"}</p>
              <div className="strategy-divider" />
              <div className="strategy-heading"><strong>独立求解算法</strong><span>{strategy === "practical" ? "工人可直接照做" : "高密度搜索参考"}</span></div>
              <div className="segmented strategy-segmented" role="group" aria-label="装柜执行策略">
                <button aria-pressed={strategy === "practical"} className={strategy === "practical" ? "active" : ""} onClick={() => { if (strategy !== "practical") { setStrategy("practical"); markDirty(); } }}><ShieldCheck size={16} />现场易执行</button>
                <button aria-pressed={strategy === "maximum"} className={strategy === "maximum" ? "active" : ""} onClick={() => { if (strategy !== "maximum") { setStrategy("maximum"); markDirty(); } }}><Gauge size={16} />极限理论</button>
              </div>
              <p className="strategy-help">每次计算都会分别运行两套算法并显示数量差距；这里选择本次三视图、3D、坐标和指导书采用哪一套布局。命中历史实装时，默认值守住旧基准；主动调高现场目标 1% 后才解除硬封顶。极限结果是高密度搜索参考，不是数学最优证明。</p>
              {strategy === "practical" ? (
                <div className="practical-target">
                  <div><strong>现场经验装载率</strong><span>整层模块 · 固定方向 · 完整支撑</span></div>
                  <div className="target-input"><input aria-label="现场经验装载率滑块" type="range" min="50" max="95" step="0.5" value={practicalTargetPercent} onChange={(event) => { setPracticalTargetPercent(clampNumber(event.target.value, DEFAULT_PRACTICAL_TARGET * 100, 50, 95)); markDirty(); }} /><input aria-label="现场经验装载率" type="number" min="50" max="95" step="0.5" value={practicalTargetPercent} onChange={(event) => { setPracticalTargetPercent(clampNumber(event.target.value, DEFAULT_PRACTICAL_TARGET * 100, 50, 95)); markDirty(); }} /><b>%</b></div>
                </div>
              ) : <p className="strategy-warning">独立运行三维分区动态规划和多起点自由空间搜索；允许侧翻与 68% 以上局部承托，仅用于发现潜在增量，不能直接替代现场指导书。</p>}
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
                <Field label="内长" unit="mm"><input type="number" value={container.length} onChange={(event) => updateContainer("length", event.target.value)} /></Field>
                <Field label="内宽" unit="mm"><input type="number" value={container.width} onChange={(event) => updateContainer("width", event.target.value)} /></Field>
                <Field label="内高" unit="mm"><input type="number" value={container.height} onChange={(event) => updateContainer("height", event.target.value)} /></Field>
                <Field label="门宽" unit="mm"><input type="number" value={container.doorWidth} onChange={(event) => updateContainer("doorWidth", event.target.value)} /></Field>
                <Field label="门高" unit="mm"><input type="number" value={container.doorHeight} onChange={(event) => updateContainer("doorHeight", event.target.value)} /></Field>
                <Field label="最大载重" unit="kg"><input type="number" value={container.maxWeight} onChange={(event) => updateContainer("maxWeight", event.target.value)} /></Field>
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
                  <input aria-label="自定义柜型名称" placeholder="例如：45HQ 客户专用柜" value={customContainerName} onChange={(event) => setCustomContainerName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCustomContainer(); }} />
                  <button className="button primary small" onClick={saveCustomContainer}>保存</button>
                  <button className="icon-button" aria-label="取消保存柜型" onClick={() => setShowContainerSave(false)}><X size={16} /></button>
                </div>
              ) : null}
            </article>

            <article className="panel reverse-panel">
              <div className="panel-head"><div><span className="section-kicker">03</span><h2>{mode === "single" ? "计划目标与装载上限" : "目标利用率倒推"}</h2></div><span className="pill">{mode === "single" ? "计划量 ≠ 最大量" : "按当前 SKU 比例"}</span></div>
              <div className="target-control">
                <div><Layers3 size={16} /><span><strong>目标体积利用率</strong><small>按有效柜内容积倒推</small></span></div>
                <div className="target-input"><input aria-label="目标体积利用率滑块" type="range" min="1" max="100" value={targetVolumePercent} onChange={(event) => { setTargetVolumePercent(numberValue(event.target.value)); markDirty(); }} /><input aria-label="目标体积利用率" type="number" min="1" max="100" value={targetVolumePercent} onChange={(event) => { setTargetVolumePercent(Math.min(100, Math.max(1, numberValue(event.target.value)))); markDirty(); }} /><b>%</b></div>
              </div>
              <div className="target-control">
                <div><Weight size={16} /><span><strong>目标载重利用率</strong><small>按柜型最大载重倒推</small></span></div>
                <div className="target-input"><input aria-label="目标载重利用率滑块" type="range" min="1" max="100" value={targetWeightPercent} onChange={(event) => { setTargetWeightPercent(numberValue(event.target.value)); markDirty(); }} /><input aria-label="目标载重利用率" type="number" min="1" max="100" value={targetWeightPercent} onChange={(event) => { setTargetWeightPercent(Math.min(100, Math.max(1, numberValue(event.target.value)))); markDirty(); }} /><b>%</b></div>
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
                  <span>{mode === "single" ? "稳健计划量" : "综合建议"}</span>
                  <strong>{formatNumber(reversePlan.recommendedDisplay)} {reversePlan.displayUnit === "set" ? "套" : "箱"}</strong>
                  <small>{reversePlan.displayUnit === "set" ? `共 ${formatNumber(reversePlan.recommendedTotal)} 箱 · ` : ""}{reversePlan.limitingFactor === "volume" ? "受体积目标限制" : reversePlan.limitingFactor === "weight" ? "受载重目标限制" : "两个目标同时达到"}</small>
                </div>
              </div>
              <div className="ratio-chips" aria-label="各 SKU 建议箱数">
                {reversePlan.quantities.map((item) => <span key={item.productId}><b>{item.sku}</b>{formatNumber(item.suggestedQuantity)} 箱</span>)}
              </div>
              <button className="reverse-apply-button" onClick={applyReversePlan} disabled={status === "working" || reversePlan.recommendedTotal <= 0}><ShieldCheck size={17} />{mode === "single" ? `按目标生成 ${formatNumber(reversePlan.recommendedDisplay)} ${reversePlan.displayUnit === "set" ? "套" : "箱"}现场方案` : "应用建议数量并验证真实装载"}</button>
              <p className="reverse-note">{mode === "single"
                ? "上方按钮严格按体积/载重目标限制计划数量；下方主按钮计算当前所选算法的可装上限。两种结果用途不同，系统会在结果区并排显示差额。"
                : "倒推先保持当前 SKU 数量比例；箱型方向、门洞和碎片空间会影响最终实际利用率，应用后将用装箱算法重新验证。"}</p>
            </article>

            <article className="panel order-overview">
              <div className="panel-head compact"><div><span className="section-kicker">04</span><h2>输入概览</h2></div></div>
              <div className="overview-grid">
                <div><span>{isSingleProductSet ? "包装箱型" : "SKU"}</span><strong>{activeProducts.length}</strong></div>
                <div><span>{mode === "single" ? "测算方式" : "需求件数"}</span><strong>{mode === "single" ? "计划量 / 可装上限" : formatNumber(activeProducts.reduce((sum, item) => sum + item.quantity, 0))}</strong></div>
                <div><span>{mode === "single" ? isSingleProductSet ? "每套 CBM" : "单件 CBM" : "需求 CBM"}</span><strong>{inputVolume.toFixed(2)}</strong></div>
                <div><span>{mode === "single" ? isSingleProductSet ? "每套毛重" : "单件毛重" : "需求毛重"}</span><strong>{formatNumber(inputWeight, 1)} kg</strong></div>
              </div>
              <button className="calculate-button" onClick={calculate} disabled={status === "working"}>
                {status === "working" ? <LoaderCircle className="spin" size={19} /> : <Rotate3D size={19} />}
                {status === "working"
                  ? "正在计算…"
                  : mode === "single"
                    ? strategy === "practical" ? "计算现场可执行上限" : "计算极限理论上限"
                    : "开始计算装柜方案"}
              </button>
            </article>
          </div>

          <section id="result" className="viewer-column">
            <div className="viewer-head">
              <div><span className="section-kicker">2D + LIVE 3D</span><h2>装柜方案联动复核</h2></div>
              <div className="viewer-status-group">
                {result?.mode === "single" && !dirty ? <div className={`plan-context-chip ${resultPlanLimitDisplay !== null ? "planned" : "capacity"}`}><b>{resultPlanLimitDisplay !== null ? "目标计划方案" : "装载上限方案"}</b><span>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? "套" : "箱"} · 计划 {formatNumber(reversePlan.recommendedDisplay)} {reversePlan.displayUnit === "set" ? "套" : "箱"}{resultPlanningDelta ? ` · ${resultPlanningDelta > 0 ? "+" : "−"}${formatNumber(Math.abs(resultPlanningDelta))}` : " · 一致"}</span></div> : null}
                <div className="validation-chip">{result?.validation.valid && !dirty ? <CheckCircle2 size={16} /> : <ShieldCheck size={16} />}{result ? dirty ? "结果已过期" : result.validation.valid ? "布局校验通过" : "发现异常" : "等待计算"}</div>
              </div>
            </div>
            {result ? (
              <>
                <div className="packing-timeline">
                  <button className="timeline-play" onClick={togglePackingPlayback} disabled={!result.placements.length} aria-label={isPlaying ? "暂停码垛动画" : "播放码垛动画"}>{isPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
                  <div className="timeline-count"><strong>{formatNumber(packingProgress)} / {formatNumber(result.placements.length)}</strong><span>码垛进度 · {result.placements.length ? Math.round((packingProgress / result.placements.length) * 100) : 0}%</span></div>
                  <input aria-label="码垛进度" type="range" min="0" max={Math.max(1, result.placements.length)} value={packingProgress} onChange={(event) => { setIsPlaying(false); setPackingProgress(numberValue(event.target.value)); }} />
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
                  {packingProgress > 0 && result.placements[packingProgress - 1]
                    ? <><span>当前第 {formatNumber(packingProgress)} 箱</span><strong>{result.placements[packingProgress - 1].sku}{result.placements[packingProgress - 1].setCode ? ` · ${result.placements[packingProgress - 1].setCode} 第 ${result.placements[packingProgress - 1].setNumber} 套 / 套内第 ${result.placements[packingProgress - 1].setItemNumber} 箱` : ""}</strong><b>坐标 {formatNumber(result.placements[packingProgress - 1].x)} / {formatNumber(result.placements[packingProgress - 1].y)} / {formatNumber(result.placements[packingProgress - 1].z)} mm · 第 {result.placements[packingProgress - 1].layer} 层</b></>
                    : <><span>准备开始</span><strong>尚未装入箱体</strong><b>点击播放或下一步查看装柜顺序</b></>}
                </div>
                <section className="viewer-projections" aria-label="三视图相机控制">
                  <div className="viewer-projection-head">
                    <div><span className="section-kicker">2D CHECK</span><strong>三视图同步复核</strong><small>点击任意视图，三维相机会切换为真正的正交投影并平滑旋转到对应方向</small></div>
                    <span className="projection-progress">当前 {formatNumber(packingProgress)} / {formatNumber(result.placements.length)} 箱</span>
                  </div>
                  <OrthographicViews
                    result={result}
                    visibleProducts={visibleProducts}
                    visibleCount={packingProgress}
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
                  <strong>等待计算方案</strong>
                  <span>填写左侧参数后，柜内真实摆放会显示在这里</span>
                </div>
              </div>
            )}
            {result ? (
              <div className="legend-row">
                {result.summaries.map((item) => (
                  <button key={item.productId} className={visibleProducts.has(item.productId) ? "" : "muted"} onClick={() => toggleProductVisibility(item.productId)}>
                    <i style={{ background: item.color }} />
                    <span>{item.sku}</span>
                    <b>{item.loaded}</b>
                  </button>
                ))}
              </div>
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
                  {setInputSummaries.map((summary) => (
                    <article key={summary.setCode} className={mode === "single" || summary.quantitiesAligned ? "aligned" : "misaligned"}>
                      <div className="set-builder-card-main">
                        <span>{summary.setCode}</span>
                        <strong>{summary.componentCount} 种箱规 · {summary.cartonsPerSet} 箱/套</strong>
                        <small>{mode === "single"
                          ? "单品最大装柜会自动求完整套数，无需录入需求箱数"
                          : `当前可完整组成 ${formatNumber(summary.completeSets)} 套${summary.looseCartons ? ` · 另有 ${formatNumber(summary.looseCartons)} 个比例外箱` : ""}`}</small>
                      </div>
                      <div className="set-ratio-list" aria-label={`${summary.setCode} 套内比例`}>
                        {summary.items.map((item) => <span key={item.productId}><b>{item.sku}</b>× {item.unitsPerSet}</span>)}
                      </div>
                      <div className="set-builder-card-actions">
                        <b className={mode === "single" || summary.quantitiesAligned ? "status-ok" : "status-warning"}>{mode === "single" ? "单品整套测算" : summary.quantitiesAligned ? "数量比例已对齐" : "需求比例未对齐"}</b>
                        {mode === "mixed" && !summary.quantitiesAligned ? <button onClick={() => alignSet(summary.setCode)}><CheckCircle2 size={13} />向下对齐</button> : null}
                        <button onClick={() => addComponentToSet(summary.setCode)}><Plus size={13} />增加箱型</button>
                        <button className="danger" onClick={() => ungroupSet(summary.setCode)}>{mode === "single" ? "恢复单箱" : "取消套装"}</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="set-builder-empty">{mode === "single"
                  ? "当前为单箱产品。若一个产品分成多箱包装，可一键改为 2–5 箱，并继续增加第 6 箱及更多箱型。"
                  : "尚未设置套装。可一键创建 2–5 箱结构，也可在创建后继续增加第 6 箱及更多箱型。"}</div>
              )}
          </section>
          <div className="product-table-wrap">
            <table className="product-table">
              <thead><tr><th>标识</th><th>SKU / 品名</th><th>外箱长</th><th>外箱宽</th><th>外箱高</th><th>CBM 自动</th><th>毛重</th>{mode === "mixed" ? <th>需求箱数</th> : null}{mode === "mixed" || isSingleProductSet ? <><th>套装编码</th><th>套内数量</th></> : null}{mode === "mixed" ? <><th>装载优先级</th><th>必装</th></> : null}<th>方向规则</th><th>可承托</th><th>必须底置</th><th>层数上限</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {activeProducts.map((product) => {
                  const calculatedCbm = exactCartonVolumeCbm(product);
                  const roundedCbm = roundedCartonVolumeCbm(product);
                  return <tr key={product.id}>
                    <td><input className="color-input" aria-label={`${product.sku} 颜色`} type="color" value={product.color} onChange={(event) => updateProduct(product.id, "color", event.target.value)} /></td>
                    <td><input aria-label={`${product.sku} SKU`} maxLength={80} className="sku-input" value={product.sku} onChange={(event) => updateProduct(product.id, "sku", event.target.value)} /><input aria-label={`${product.sku} 品名`} maxLength={200} className="name-input" value={product.name} onChange={(event) => updateProduct(product.id, "name", event.target.value)} /></td>
                    <td><input aria-label={`${product.sku} 外箱长`} type="number" min="0" value={product.length} onChange={(event) => updateProduct(product.id, "length", event.target.value)} /><small>mm</small></td>
                    <td><input aria-label={`${product.sku} 外箱宽`} type="number" min="0" value={product.width} onChange={(event) => updateProduct(product.id, "width", event.target.value)} /><small>mm</small></td>
                    <td><input aria-label={`${product.sku} 外箱高`} type="number" min="0" value={product.height} onChange={(event) => updateProduct(product.id, "height", event.target.value)} /><small>mm</small></td>
                    <td className="cbm-cell"><output className="cbm-auto-value" aria-label={`${product.sku} 自动计算 CBM`}>{roundedCbm.toFixed(2)}</output><small>自动计算 · 精确值 {calculatedCbm.toFixed(4)}</small></td>
                    <td><input aria-label={`${product.sku} 毛重`} type="number" min="0" step="0.1" value={product.weight} onChange={(event) => updateProduct(product.id, "weight", event.target.value)} /><small>kg</small></td>
                    {mode === "mixed" ? <td><input aria-label={`${product.sku} 需求箱数`} type="number" min="0" max="1000000" step="1" value={product.quantity} onChange={(event) => updateProduct(product.id, "quantity", event.target.value)} /><small>箱</small></td> : null}
                    {mode === "mixed" || isSingleProductSet ? <><td><input className="set-code-input" aria-label={`${product.sku} 套装编码`} maxLength={80} value={product.setCode ?? ""} placeholder="留空=散箱" readOnly={mode === "single"} onChange={(event) => updateProduct(product.id, "setCode", event.target.value)} /><small>{mode === "single" ? "同一产品包装" : "同编码组成一套"}</small></td><td><input aria-label={`${product.sku} 套内数量`} type="number" min="1" max="99" step="1" value={product.unitsPerSet || 1} onChange={(event) => updateProduct(product.id, "unitsPerSet", event.target.value)} /><small>箱 / 套</small></td></> : null}
                    {mode === "mixed" ? <><td><input aria-label={`${product.sku} 装载优先级`} type="number" min="0" max="100" step="1" value={product.priority} onChange={(event) => updateProduct(product.id, "priority", event.target.value)} /><small>数值越高越先装</small></td><td><label className="switch" title="必装货物优先于塞货，并在缺装时单独告警"><input aria-label={`${product.sku} 必装`} type="checkbox" checked={product.mustLoad !== false} onChange={(event) => updateProduct(product.id, "mustLoad", event.target.checked)} /><span /></label></td></> : null}
                    <td>
                      <select className="constraint-select" aria-label={`${product.sku} 方向规则`} value={product.rotationPolicy} onChange={(event) => updateProduct(product.id, "rotationPolicy", event.target.value)}>
                        <option value="fixed">固定方向</option>
                        <option value="upright">仅平面旋转</option>
                        <option value="any">任意旋转</option>
                      </select>
                    </td>
                    <td><label className="switch" title="关闭后，其他箱体不能放在此产品上方"><input aria-label={`${product.sku} 可承托`} type="checkbox" checked={product.stackable} onChange={(event) => updateProduct(product.id, "stackable", event.target.checked)} /><span /></label></td>
                    <td><label className="switch" title="开启后该产品只允许摆放在集装箱地板"><input aria-label={`${product.sku} 必须底置`} type="checkbox" checked={product.bottomOnly === true} onChange={(event) => updateProduct(product.id, "bottomOnly", event.target.checked)} /><span /></label></td>
                    <td><input aria-label={`${product.sku} 层数上限`} type="number" min="0" max="99" step="1" value={product.maxStackLayers} onChange={(event) => updateProduct(product.id, "maxStackLayers", event.target.value)} /><small>0 = 不限</small></td>
                    <td>{mode === "mixed" || isSingleProductSet ? <button className="icon-button danger" aria-label={`删除 ${product.sku}`} onClick={() => removeProduct(product.id)} disabled={activeProducts.length <= 1}><Trash2 size={16} /></button> : null}</td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          <div className="table-note"><CircleAlert size={16} /><span>{mode === "single"
            ? "这里每一行代表同一个产品的一种外箱，不代表多个产品拼柜。系统按完整套数装载，任一组成箱放不下即整套回滚。"
            : "相同“套装编码”的任意数量 SKU 会按“套内数量”组成原子批次：支持 2/3/4/5 箱及更多箱型，也支持 1:4、1:2:2 等比例；任一组成箱放不下即整套回滚。"}</span></div>
        </section>

        {result ? (
          <section className="result-section">
            <div className="result-title"><div><span className="section-kicker">CALCULATED PLAN</span><h2>方案结果</h2></div><span className="run-meta">{resultPlanLimitDisplay !== null
              ? `目标计划方案 · ${formatNumber(resultPlanLimitDisplay)} ${resultDisplayUnit === "set" ? "套" : "箱"}上限`
              : result.strategy === "practical" ? `现场可执行上限 · 经验率 ${(result.practicalTargetUtilization * 100).toFixed(1)}%` : "极限理论上限"} · 算法 {result.engineVersion} · {formatNumber(result.metrics.solveTimeMs, 1)} ms</span></div>
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
                  <article><span>稳健计划量</span><strong>{formatNumber(reversePlan.recommendedDisplay)} {reversePlan.displayUnit === "set" ? "套" : "箱"}</strong><small>{reversePlan.limitingFactor === "volume" ? `受 ${targetVolumePercent}% 体积目标限制` : reversePlan.limitingFactor === "weight" ? `受 ${targetWeightPercent}% 载重目标限制` : "两个目标同时限制"}</small></article>
                  <article className={resultPlanLimitDisplay === null ? "selected" : ""}><span>当前坐标方案</span><strong>{formatNumber(resultLoadedDisplay)} {resultDisplayUnit === "set" ? "套" : "箱"}</strong><small>实际体积 {formatPercent(result.metrics.volumeUtilization)} · 实际载重 {formatPercent(result.metrics.weightUtilization)}</small></article>
                  <article className="explanation"><span>口径说明</span><strong>{resultPlanLimitDisplay !== null ? "按计划封顶" : "按策略求上限"}</strong><small>{resultPlanLimitDisplay !== null ? "当前方案主动保留安全余量，不代表柜内只能装这么多。" : "当前结果可以高于计划量，但绝不允许超过柜型最大载重。"}</small></article>
                </div>
              </section>
            ) : null}

            {result.strategyComparison && !dirty ? (
              <section className="strategy-comparison" aria-label="现场与极限算法对比">
                <div className="strategy-comparison-head">
                  <div><span className="section-kicker">TWO INDEPENDENT SOLVERS</span><strong>现场算法 × 极限理论算法</strong><small>同一份输入分别计算；理论结果只把安全子集反向下放到现场方案。</small></div>
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
                    <span><Gauge size={15} />极限理论算法</span>
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
                    ? `已命中历史包装指纹：${result.quoteEstimate.matchedModels.join(" / ")}；忠实展示报价记录，但不绕过物理校验。`
                    : `按当前柜型 ${result.quoteEstimate.calibratedCargoVolumeCbm.toFixed(2)} CBM 基线预测；${result.quoteEstimate.verifiedDataPoints} 个物理可行数据点回测：平均 ${result.quoteEstimate.backtestMeanErrorPct.toFixed(1)}%，90% 不超过 ${result.quoteEstimate.backtestP90ErrorPct.toFixed(1)}%，最差 ${result.quoteEstimate.backtestMaxErrorPct.toFixed(1)}%。`}</small>
                </div>
                <div><span>报价经验预测</span><strong>{formatNumber(result.quoteEstimate.predictedSets)} 套</strong><small>{result.quoteEstimate.confidence === "verified" ? "历史尺寸指纹精确匹配 · 记录误差 0%" : `典型误差约 ±${result.quoteEstimate.expectedErrorPct.toFixed(1)}%`}</small></div>
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
          <section className="empty-result"><PackageOpen size={30} /><div><strong>还没有计算结果</strong><span>点击“开始计算装柜方案”，系统会生成真实三维坐标并执行独立校验。</span></div></section>
        )}

        <footer className="app-footer"><span>外贸装柜智算 · Desktop-first local calculation</span><span>尺寸与柜型预设仅供测算，正式出货请复核实际数据</span></footer>
      </div>
    </main>
  );
}
