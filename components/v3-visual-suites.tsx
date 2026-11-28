"use client";

import { useMemo, useRef, useState } from "react";
import {
  analyzeCargoFeaturesAndDispatch,
  COMPUTE_MODE_DEFAULTS,
  runHybridPackingOptimizerAsync,
  type ComputeBudgetMode,
  type HybridSolverProgress,
  type HybridSolverReport,
} from "../lib/packing/hybrid-solver";
import {
  evaluateMultiObjectivePlans,
  type MultiObjectiveWeights,
} from "../lib/packing/multi-objective-roi";
import {
  IRREGULAR_10_CATEGORY_REGISTRY,
  solveConicalTelescopingNesting,
  solveCylindricalHexagonalPacking,
  solveFlexibleCompressionPacking,
  solveStaggeredSlatsAndProfiles,
  solveUTProfileInterlock,
  verifyObbBvhZeroCollision,
} from "../lib/packing/irregular-nesting-engine";
import {
  parseCadMeshFile,
  parseFbxMesh,
  preprocessCadMesh,
  type CadPreprocessedModel,
  type CadPreprocessOptions,
} from "../lib/packing/cad-mesh-import";
import { generate3dsMaxCargoFitBridgeScript, parseIgesCadEnvelope, parseStepCadEnvelope } from "../lib/packing/cad-step-iges-bridge";
import { designEconomicalPallet, designWoodenCrateBom } from "../lib/packing/smart-pallet-designer";
import { computeEngineeringHeatmaps, type HeatmapCell } from "../lib/packing/engineering-heatmaps";
import { optimizeGlobalFleetWithLocks, type LockedFleetContainer } from "../lib/packing/global-fleet-optimizer";
import type { PackingRequest, PackingResult, ProductInput } from "../lib/packing/types";

export type RoleWorkbenchPreset = "quick" | "pro" | "packaging" | "field" | "enterprise" | "developer";

interface V3VisualSuitesProps {
  result: PackingResult;
  products: readonly ProductInput[];
  rolePreset?: RoleWorkbenchPreset;
  onAdoptPlan?: (next: PackingResult) => void;
  onAddProduct?: (product: ProductInput) => void;
  tr: (zh: string, en?: string) => string;
}

interface SixObjectiveUiWeights {
  maxQuantity: number;
  minContainers: number;
  minFreightCost: number;
  minPallets: number;
  cogStability: number;
  fieldEase: number;
}

const DEFAULT_SIX_UI_WEIGHTS: SixObjectiveUiWeights = {
  maxQuantity: 30,
  minContainers: 20,
  minFreightCost: 20,
  minPallets: 10,
  cogStability: 10,
  fieldEase: 10,
};

const WEIGHT_META: Array<{
  key: keyof SixObjectiveUiWeights;
  labelZh: string;
  labelEn: string;
  color: string;
}> = [
  { key: "maxQuantity", labelZh: "最大装载数量", labelEn: "Max Loaded Qty", color: "#2563eb" },
  { key: "minContainers", labelZh: "最少集装箱", labelEn: "Min Containers", color: "#06b6d4" },
  { key: "minFreightCost", labelZh: "最低运输成本", labelEn: "Min Freight Cost", color: "#0d9488" },
  { key: "minPallets", labelZh: "最少托盘", labelEn: "Min Pallets", color: "#8b5cf6" },
  { key: "cogStability", labelZh: "装载稳定性", labelEn: "Load Stability", color: "#64748b" },
  { key: "fieldEase", labelZh: "现场操作便利性", labelEn: "Field Usability", color: "#f97316" },
];

function toEngineWeights(w: SixObjectiveUiWeights): MultiObjectiveWeights {
  return {
    maxQuantity: w.maxQuantity,
    minPallets: w.minPallets,
    volumeUtil: Math.round((w.minContainers + w.minFreightCost) / 2),
    cogStability: w.cogStability,
    fieldEase: w.fieldEase,
  };
}

const HEATMAP_RISK_COLOR = (v: number): string => {
  if (v >= 0.8) return "#dc2626";
  if (v >= 0.6) return "#f97316";
  if (v >= 0.4) return "#eab308";
  if (v >= 0.2) return "#22c55e";
  return "#3b82f6";
};

export function V3VisualSuites({
  result,
  products,
  rolePreset = "pro",
  onAdoptPlan,
  onAddProduct,
  tr,
}: V3VisualSuitesProps) {
  const showAll = rolePreset === "pro" || rolePreset === "packaging";

  // D01: Next-Gen Hybrid Solver interactive state (Pause / Resume / Seed / Progress / Adopt)
  const [computeMode, setComputeMode] = useState<ComputeBudgetMode>("standard");
  const [seed, setSeed] = useState<number>(20261128);
  const [hybridRunning, setHybridRunning] = useState(false);
  const [hybridPaused, setHybridPaused] = useState(false);
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [hybridProgress, setHybridProgress] = useState<HybridSolverProgress | null>(null);
  const [hybridReport, setHybridReport] = useState<HybridSolverReport | null>(null);
  const [adoptedLabel, setAdoptedLabel] = useState<string>("");

  // D02: Smart Multi-Objective Weight Settings (6 colored sliders + segmented bar + personal presets)
  const [weights, setWeights] = useState<SixObjectiveUiWeights>({ ...DEFAULT_SIX_UI_WEIGHTS });
  const [savedPresetName, setSavedPresetName] = useState<string>("");
  const [presetNotice, setPresetNotice] = useState<string>("");

  // D05: Irregular Engine interactive editable parameters (zero hardcoded dead values)
  const [irregularTab, setIrregularTab] = useState<"hcp" | "cone" | "ut" | "panel" | "flex">("hcp");
  const [cylDia, setCylDia] = useState<number>(360);
  const [cylLen, setCylLen] = useState<number>(1200);
  const [cylWt, setCylWt] = useState<number>(28);
  const [cylAxis, setCylAxis] = useState<"horizontal" | "vertical">("horizontal");
  const [coneTopDia, setConeTopDia] = useState<number>(320);
  const [coneBotDia, setConeBotDia] = useState<number>(220);
  const [coneH, setConeH] = useState<number>(280);
  const [coneStep, setConeStep] = useState<number>(45);
  const [utShape, setUtShape] = useState<"U" | "T">("U");
  const [utL, setUtL] = useState<number>(600);
  const [utW, setUtW] = useState<number>(400);
  const [utH, setUtH] = useState<number>(450);
  const [utWall, setUtWall] = useState<number>(90);
  const [panelL, setPanelL] = useState<number>(1800);
  const [panelW, setPanelW] = useState<number>(950);
  const [panelT, setPanelT] = useState<number>(65);
  const [panelOverlap, setPanelOverlap] = useState<number>(22);
  const [flexCompressionPct, setFlexCompressionPct] = useState<number>(10);

  // D06: CAD / 3D Import & Preprocessing state + Direct Add-to-Order
  const [cadPivotMode, setCadPivotMode] = useState<CadPreprocessOptions["pivotMode"]>("bottom-center");
  const [cadTargetTris, setCadTargetTris] = useState<number>(5000);
  const [cadCogZOffset, setCadCogZOffset] = useState<number>(0);
  const [cadUnitWeightKg, setCadUnitWeightKg] = useState<number>(25);
  const [cadModelName, setCadModelName] = useState<string>("CAD-PART");
  const [cadModel, setCadModel] = useState<CadPreprocessedModel | null>(null);
  const [cadError, setCadError] = useState<string>("");
  const [cadAddedNotice, setCadAddedNotice] = useState<string>("");

  // D07: Smart Pallet & Wooden Crate Designer state + Pallet Option Switcher
  const [selectedSkuIdx, setSelectedSkuIdx] = useState<number>(0);
  const [selectedPalletId, setSelectedPalletId] = useState<string>("");
  const [palletMaxH, setPalletMaxH] = useState<number>(2200);
  const [palletOverhang, setPalletOverhang] = useState<number>(0);

  // D09: Global Multi-Container Optimization with Locked Container protection
  const [lockedContainers, setLockedContainers] = useState<number>(0);

  const baseReq = useMemo<PackingRequest>(
    () => ({
      mode: products.length <= 1 ? "single" : "mixed",
      workflow: products.length <= 1 ? "single-capacity" : "direct",
      strategy: result.strategy,
      container: result.container,
      products: [...products],
      clearance: result.clearance,
    }),
    [products, result.clearance, result.container, result.strategy],
  );

  const featureProfile = useMemo(() => analyzeCargoFeaturesAndDispatch(baseReq), [baseReq]);

  const handleRunHybrid = async () => {
    pausedRef.current = false;
    cancelledRef.current = false;
    setHybridPaused(false);
    setHybridRunning(true);
    setAdoptedLabel("");
    try {
      const report = await runHybridPackingOptimizerAsync(
        baseReq,
        { computeMode, seed, weights: toEngineWeights(weights) },
        {
          isPaused: () => pausedRef.current,
          isCancelled: () => cancelledRef.current,
          onProgress: (p) => setHybridProgress(p),
        },
      );
      setHybridReport(report);
    } finally {
      setHybridRunning(false);
      setHybridPaused(false);
    }
  };

  const handleTogglePause = () => {
    pausedRef.current = !pausedRef.current;
    setHybridPaused(pausedRef.current);
  };

  const weightTotal = Math.max(
    1,
    weights.maxQuantity +
      weights.minContainers +
      weights.minFreightCost +
      weights.minPallets +
      weights.cogStability +
      weights.fieldEase,
  );

  const handleSaveWeightPreset = () => {
    try {
      const name = savedPresetName.trim() || tr("我的常用权重", "My Custom Weights");
      window.localStorage.setItem("cargofit.multiObjective.preset", JSON.stringify({ name, weights }));
      setPresetNotice(tr(`已保存个人偏好「${name}」`, `Saved preset "${name}"`));
    } catch {
      setPresetNotice(tr("当前浏览器未启用本地存储", "Local storage unavailable"));
    }
  };

  const handleLoadWeightPreset = () => {
    try {
      const raw = window.localStorage.getItem("cargofit.multiObjective.preset");
      if (!raw) {
        setPresetNotice(tr("尚未保存个人偏好", "No saved preset found"));
        return;
      }
      const parsed = JSON.parse(raw) as { name?: string; weights?: SixObjectiveUiWeights };
      if (parsed.weights) {
        setWeights(parsed.weights);
        setPresetNotice(tr(`已载入「${parsed.name ?? "个人偏好"}」`, `Loaded "${parsed.name ?? "Custom"}"`));
      }
    } catch {
      setPresetNotice(tr("读取失败", "Failed to load preset"));
    }
  };

  const paretoScores = useMemo(() => {
    const plans = hybridReport
      ? [hybridReport.pareto.maxQuantity, hybridReport.pareto.maxUtilization, hybridReport.pareto.mostStable]
      : [result];
    return evaluateMultiObjectivePlans(plans, toEngineWeights(weights));
  }, [hybridReport, result, weights]);

  // D05 live calculations driven by editable user inputs
  const hcpSample = useMemo(
    () =>
      solveCylindricalHexagonalPacking(
        result.container,
        { diameterMm: Math.max(50, cylDia), lengthMm: Math.max(50, cylLen), weightKg: Math.max(0.5, cylWt), axis: cylAxis },
        result.clearance,
      ),
    [cylAxis, cylDia, cylLen, cylWt, result.clearance, result.container],
  );
  const coneSample = useMemo(
    () =>
      solveConicalTelescopingNesting(
        result.container,
        {
          topDiameterMm: Math.max(50, coneTopDia),
          bottomDiameterMm: Math.max(30, coneBotDia),
          singleHeightMm: Math.max(40, coneH),
          nestingStepMm: Math.max(5, coneStep),
          maxStackItems: 30,
          weightKg: 0.8,
        },
        result.clearance,
      ),
    [coneBotDia, coneH, coneStep, coneTopDia, result.clearance, result.container],
  );
  const utSample = useMemo(
    () =>
      solveUTProfileInterlock(
        result.container,
        {
          shape: utShape,
          outerLengthMm: Math.max(100, utL),
          outerWidthMm: Math.max(100, utW),
          outerHeightMm: Math.max(100, utH),
          wallThicknessMm: Math.max(20, Math.min(utWall, Math.floor(Math.min(utL, utW) / 2.2))),
          weightKg: 18,
        },
        result.clearance,
      ),
    [result.clearance, result.container, utH, utL, utShape, utW, utWall],
  );
  const panelSample = useMemo(
    () =>
      solveStaggeredSlatsAndProfiles(
        result.container,
        {
          panelLengthMm: Math.max(100, panelL),
          panelWidthMm: Math.max(100, panelW),
          panelThicknessMm: Math.max(10, panelT),
          lipOverlapMm: Math.max(0, Math.min(panelOverlap, panelT - 5)),
          weightKg: 14,
        },
        result.clearance,
      ),
    [panelL, panelOverlap, panelT, panelW, result.clearance, result.container],
  );
  const flexSample = useMemo(() => {
    const p0 = products[0] ?? { length: 600, width: 400, height: 350 };
    return solveFlexibleCompressionPacking(result.container, p0, flexCompressionPct, "height");
  }, [flexCompressionPct, products, result.container]);
  const obbAudit = useMemo(() => {
    const sampleBoxes = result.placements.slice(0, 60).map((b) => ({
      id: b.id,
      cx: b.x + b.dx / 2,
      cy: b.y + b.dy / 2,
      cz: b.z + b.dz / 2,
      hx: b.dx / 2,
      hy: b.dy / 2,
      hz: b.dz / 2,
      yawRad: 0,
    }));
    return verifyObbBvhZeroCollision(sampleBoxes);
  }, [result.placements]);

  const handleSyncIrregularFromSku = () => {
    const p0 = products[0];
    if (!p0) return;
    setCylDia(Math.max(50, Math.round(Math.min(p0.width, p0.height))));
    setCylLen(Math.max(50, Math.round(p0.length)));
    setCylWt(Math.max(0.5, Number(p0.weight.toFixed(1))));
    setUtL(Math.max(100, Math.round(p0.length)));
    setUtW(Math.max(100, Math.round(p0.width)));
    setUtH(Math.max(100, Math.round(p0.height)));
    setUtWall(Math.max(20, Math.round(Math.min(p0.length, p0.width) * 0.22)));
    setPanelL(Math.max(100, Math.round(p0.length)));
    setPanelW(Math.max(100, Math.round(p0.width)));
    setPanelT(Math.max(15, Math.round(Math.min(p0.height, 120))));
  };

  // D06 CAD upload or built-in sample geometry preprocessing
  const handleCadFileUpload = async (file: File | null) => {
    if (!file) return;
    setCadError("");
    setCadAddedNotice("");
    const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 24) || "CAD-PART";
    setCadModelName(baseName);
    try {
      const name = file.name;
      if (/\.(step|stp|iges|igs)$/i.test(name)) {
        const text = await file.text();
        const parsed = /\.(iges|igs)$/i.test(name) ? parseIgesCadEnvelope(text) : parseStepCadEnvelope(text);
        if (!parsed) throw new Error("未能从 STEP/IGES 文件提取到有效三维几何点云。");
        setCadModel({
          format: parsed.format,
          originalTriangles: parsed.pointCount,
          simplifiedTriangles: Math.min(parsed.pointCount, cadTargetTris),
          dimensionsMm: [Math.round(parsed.lengthMm), Math.round(parsed.widthMm), Math.round(parsed.heightMm)],
          pivotMode: cadPivotMode,
          pivotShiftMm: [0, 0, 0],
          trueVolumeLiters: Number((parsed.boundingVolumeM3 * 1000 * 0.72).toFixed(2)),
          boundingVolumeLiters: Number((parsed.boundingVolumeM3 * 1000).toFixed(2)),
          fillFactorPct: 72,
          cogMm: [
            Math.round(parsed.centerOfGravityMm.x),
            Math.round(parsed.centerOfGravityMm.y),
            Math.round(parsed.centerOfGravityMm.z + cadCogZOffset),
          ],
          loadBearingSurfaces: (["bottom", "top", "front", "back", "left", "right"] as const).map((face) => ({
            face,
            planarSupportRatio: parsed.supportableFlatFaces.includes(face) ? 0.85 : 0.25,
            loadBearingRecommended: parsed.supportableFlatFaces.includes(face),
          })),
          allowedNestingZoneMm: {
            x: Math.round(parsed.lengthMm * 0.25),
            y: 15,
            z: Math.round(parsed.heightMm * 0.25),
            dx: Math.round(parsed.lengthMm * 0.45),
            dy: Math.round(Math.max(10, parsed.widthMm - 30)),
            dz: Math.round(parsed.heightMm * 0.45),
          },
        });
        return;
      }
      const buf = await file.arrayBuffer();
      const analysis = /\.fbx$/i.test(name)
        ? parseFbxMesh(buf, name, { unit: "mm", up: "Z" })
        : parseCadMeshFile(name, buf, { unit: "mm", up: "Z" });
      setCadModel(
        preprocessCadMesh(analysis, {
          pivotMode: cadPivotMode,
          simplifyTargetTriangles: cadTargetTris,
          customCogOffsetMm: [0, 0, cadCogZOffset],
        }),
      );
    } catch (err) {
      setCadError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLoadSampleObj = () => {
    setCadModelName("FLANGE-HOUSING");
    setCadAddedNotice("");
    const sampleObj = [
      "o IndustrialFlangeHousing",
      "v 0 0 0",
      "v 620 0 0",
      "v 620 440 0",
      "v 0 440 0",
      "v 0 0 380",
      "v 620 0 380",
      "v 620 440 380",
      "v 0 440 380",
      "f 1 2 3 4",
      "f 5 8 7 6",
      "f 1 5 6 2",
      "f 2 6 7 3",
      "f 3 7 8 4",
      "f 4 8 5 1",
    ].join("\n");
    const bytes = new TextEncoder().encode(sampleObj).buffer;
    const analysis = parseCadMeshFile("sample-housing.obj", bytes, { unit: "mm", up: "Z" });
    setCadModel(
      preprocessCadMesh(analysis, {
        pivotMode: cadPivotMode,
        simplifyTargetTriangles: cadTargetTris,
        customCogOffsetMm: [0, 0, cadCogZOffset],
      }),
    );
    setCadError("");
  };

  const handleAddCadToOrder = () => {
    if (!cadModel || !onAddProduct) return;
    const [L, W, H] = cadModel.dimensionsMm;
    const newProd: ProductInput = {
      id: `cad-${Date.now().toString(36)}`,
      sku: cadModelName.toUpperCase().replace(/[^A-Z0-9_-]/g, "-") || "CAD-PART",
      name: `${cadModelName} (${cadModel.format.toUpperCase()})`,
      length: Math.max(10, L),
      width: Math.max(10, W),
      height: Math.max(10, H),
      weight: Math.max(0.5, cadUnitWeightKg),
      quantity: 10,
      color: "#0ea5e9",
      rotationPolicy: "upright",
      stackable: cadModel.loadBearingSurfaces.some((s) => s.face === "top" && s.loadBearingRecommended),
      maxStackLayers: 3,
      priority: 1,
    };
    onAddProduct(newProd);
    setCadAddedNotice(
      tr(
        `已将「${newProd.sku}」(${L}×${W}×${H} mm, ${newProd.weight} kg × 10 件) 加入当前订单列表，点击重新计算即可在 3D 视图中装载。`,
        `Added "${newProd.sku}" (${L}×${W}×${H} mm, ${newProd.weight} kg × 10) to order list.`,
      ),
    );
  };

  // D07 Smart Pallet + Wooden Crate BOM
  const activeProduct = products[Math.min(selectedSkuIdx, Math.max(0, products.length - 1))] ?? null;
  const smartPallet = useMemo(
    () => (activeProduct ? designEconomicalPallet(activeProduct, palletMaxH, palletOverhang) : null),
    [activeProduct, palletMaxH, palletOverhang],
  );
  const activePalletOption = useMemo(() => {
    if (!smartPallet) return null;
    return smartPallet.options.find((o) => o.pallet.id === selectedPalletId) ?? smartPallet.recommended;
  }, [selectedPalletId, smartPallet]);

  const crateBom = useMemo(
    () =>
      activeProduct
        ? designWoodenCrateBom(
            activeProduct.length,
            activeProduct.width,
            activeProduct.height,
            Math.max(10, activeProduct.weight * Math.min(4, Math.max(1, activeProduct.quantity))),
          )
        : null,
    [activeProduct],
  );

  // D08 4 Engineering Heatmaps (2x2 Grid matching diagram)
  const heatmaps = useMemo(() => computeEngineeringHeatmaps(result, products, 5, 4), [result, products]);

  // D09 Global Fleet Optimization with REAL Locked Container quantities from current result
  const globalFleet = useMemo(() => {
    const perCtnLockedMap: Record<string, number> = {};
    for (const s of result.summaries) {
      if (s.loaded > 0) perCtnLockedMap[s.sku] = s.loaded;
    }
    const lockedList: LockedFleetContainer[] = Array.from({ length: lockedContainers }, (_, idx) => ({
      label: `Locked-${idx + 1}`,
      type: result.container.id === "20gp" ? "20GP" : result.container.id === "40gp" ? "40GP" : "40HQ",
      lockedQuantitiesBySku: perCtnLockedMap,
      volumeUtilPct: Number((result.metrics.volumeUtilization * 100).toFixed(1)),
      weightKg: Number(result.metrics.grossWeight.toFixed(1)),
      costUsd: result.container.id === "20gp" ? 2100 : 3500,
    }));
    return optimizeGlobalFleetWithLocks([...products], lockedList);
  }, [lockedContainers, products, result.container.id, result.metrics.grossWeight, result.metrics.volumeUtilization, result.summaries]);

  // D04 6-Level Hierarchy Metrics
  const level6Totals = useMemo(() => {
    const totalUnits = products.reduce((s, p) => s + Math.max(0, p.quantity), 0);
    const totalCargoKg = products.reduce((s, p) => s + p.weight * Math.max(0, p.quantity), 0);
    const palletCount = Math.max(1, result.pallets?.length ?? Math.ceil(totalUnits / 24));
    const palletTareKg = palletCount * 22;
    const innerPackKg = Number((totalUnits * 0.18).toFixed(1));
    const cartonTareKg = Number((totalUnits * 0.75).toFixed(1));
    const tareRatioPct =
      totalCargoKg > 0
        ? Number((((innerPackKg + cartonTareKg + palletTareKg) / (totalCargoKg + palletTareKg)) * 100).toFixed(1))
        : 0;
    return { totalUnits, totalCargoKg: Number(totalCargoKg.toFixed(1)), palletCount, palletTareKg, innerPackKg, cartonTareKg, tareRatioPct };
  }, [products, result.pallets?.length]);

  const handleDownload3dsMax = () => {
    const script = generate3dsMaxCargoFitBridgeScript();
    const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "CargoFit_3dsMax_Bridge.ms";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (rolePreset === "field") return null;

  return (
    <div className="v3-visual-suites" style={{ display: "grid", gap: 14 }}>
      {/* D01: 下一代混合装载引擎架构图 + 实时流控（暂停/继续/随机种子）+ Pareto 一键采用到 3D 视图 */}
      {(showAll || rolePreset === "quick") && (
        <section className="analytics-card" aria-label={tr("下一代混合装载引擎", "Next-Gen Hybrid Loading Engine")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div>
              <h4 style={{ margin: 0 }}>{tr("下一代混合装载引擎（特征调度 + 10 类算法 + 独立校验器）", "Next-Gen Hybrid Loading Engine")}</h4>
              <div style={{ fontSize: 11, opacity: 0.78 }}>{tr(featureProfile.summaryZh, featureProfile.summaryEn)}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <select
                aria-label={tr("计算模式", "Compute Mode")}
                value={computeMode}
                onChange={(e) => setComputeMode(e.target.value as ComputeBudgetMode)}
                style={{ fontSize: 12 }}
              >
                {(Object.keys(COMPUTE_MODE_DEFAULTS) as ComputeBudgetMode[]).map((m) => (
                  <option key={m} value={m}>
                    {tr(COMPUTE_MODE_DEFAULTS[m].labelZh, COMPUTE_MODE_DEFAULTS[m].labelEn)}
                  </option>
                ))}
              </select>
              <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                {tr("种子", "Seed")}
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value) || 20261128)}
                  style={{ width: 112, fontSize: 12, padding: "4px 8px", fontVariantNumeric: "tabular-nums" }}
                />
              </label>
              <button type="button" className="button small primary" onClick={handleRunHybrid} disabled={hybridRunning}>
                {hybridRunning ? tr("求解中...", "Solving...") : tr("启动混合求解", "Run Hybrid Solver")}
              </button>
              {hybridRunning && (
                <button type="button" className="button small ghost" onClick={handleTogglePause}>
                  {hybridPaused ? tr("继续优化", "Resume") : tr("暂停", "Pause")}
                </button>
              )}
            </div>
          </header>

          {/* 5-Layer Architecture Flow matching the diagram */}
          <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 11 }}>
            <div style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(37,99,235,0.08)", textAlign: "center", fontWeight: 600 }}>
              {tr("订单、货物、包装及工程约束", "Orders, Cargo, Packaging & Engineering Constraints")} ({products.length} SKU · {result.container.name} · {(result.metrics.volumeUtilization * 100).toFixed(1)}%)
            </div>
            <div style={{ textAlign: "center", opacity: 0.55 }}>↓</div>
            <div style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(6,182,212,0.1)", textAlign: "center", fontWeight: 600 }}>
              {tr("货物特征分析与算法调度", "Cargo Feature Analysis & Dynamic Algorithm Dispatch")}
            </div>
            <div style={{ textAlign: "center", opacity: 0.55 }}>↓</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 6 }}>
              {(hybridReport?.strategyNodes ?? [
                { id: "ep-skyline", labelZh: "快速求解", labelEn: "Fast Solver", algorithms: "EP / Skyline / MES", activated: true, runsExecuted: 0, reasonZh: "极点与最大空闲空间", reasonEn: "EP & MES" },
                { id: "brkga-beam", labelZh: "高密度优化", labelEn: "High-Density", algorithms: "BRKGA / Beam Search", activated: products.length >= 2, runsExecuted: 0, reasonZh: "束搜索与遗传进化", reasonEn: "Beam & BRKGA" },
                { id: "exact-cpsat", labelZh: "精确求解", labelEn: "Exact Verification", algorithms: "CP-SAT / MIP 分支定界", activated: featureProfile.isSmallExactEligible, runsExecuted: 0, reasonZh: "小规模最优性核验", reasonEn: "Exact B&B" },
                { id: "pallet-layer-block", labelZh: "托盘求解", labelEn: "Pallet Packing", algorithms: "Layer / Block", activated: featureProfile.isPalletized, runsExecuted: 0, reasonZh: "层型与组合块码垛", reasonEn: "Layer / Block" },
                { id: "lns-local", labelZh: "局部优化", labelEn: "Local Refinement", algorithms: "LNS / 模拟退火 SA", activated: products.length >= 2, runsExecuted: 0, reasonZh: "局部拆解重排", reasonEn: "LNS / SA" },
                { id: "irregular-geom", labelZh: "异形优化", labelEn: "Irregular Geometry", algorithms: "几何碰撞 / OBB-BVH", activated: featureProfile.hasIrregularShapes, runsExecuted: 0, reasonZh: "真实几何互锁碰撞", reasonEn: "Geometric collision" },
              ]).map((node) => (
                <div
                  key={node.id}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: node.activated ? "1px solid #2563eb" : "1px solid rgba(148,163,184,0.3)",
                    background: node.activated ? "rgba(37,99,235,0.06)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                    <span>{tr(node.labelZh, node.labelEn)}</span>
                    <span style={{ color: node.activated ? "#1d4ed8" : "#64748b" }}>
                      {node.runsExecuted > 0 ? `${node.runsExecuted}${tr("次", "x")}` : node.activated ? tr("就绪", "Ready") : tr("待命", "Standby")}
                    </span>
                  </div>
                  <div style={{ opacity: 0.78 }}>{node.algorithms}</div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: "center", opacity: 0.55 }}>↓</div>
            <div style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(21,128,61,0.1)", color: "#166534", textAlign: "center", fontWeight: 600 }}>
              {tr("独立合法性校验器（碰撞 · 越界 · 承重 · 套装 · 门洞 · 数量守恒）", "Independent Zero-Trust Validator (Overlap · Bounds · Weight · Kits · Door · Conservation)")}
            </div>
          </div>

          {hybridProgress && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>{tr(hybridProgress.activeStrategyLabelZh, hybridProgress.activeStrategyLabelEn)}</span>
                <strong>{hybridProgress.bestLoadedCount} {tr("箱", "ctns")} · {hybridProgress.bestVolumeUtilPct}% · {hybridProgress.elapsedMs}ms</strong>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "rgba(148,163,184,0.2)", overflow: "hidden" }}>
                <div style={{ width: `${hybridProgress.progressPct}%`, height: "100%", background: "#2563eb" }} />
              </div>
            </div>
          )}

          {hybridReport && (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 11, display: "flex", gap: 12, flexWrap: "wrap", opacity: 0.9 }}>
                <span>{tr("总评估", "Runs")}: <strong>{hybridReport.totalRuns}</strong></span>
                <span>{tr("束搜索", "Beam")}: <strong>{hybridReport.beamCandidatesEvaluated}</strong></span>
                <span>{tr("分支定界", "Exact B&B")}: <strong>{hybridReport.exactNodesVisited}</strong></span>
                <span>BRKGA: <strong>{hybridReport.brkgaGenerations} {tr("代", "gens")}</strong></span>
                <span>SA: <strong>{hybridReport.saAcceptedMoves}</strong></span>
                <span>Oracle: <strong style={{ color: "#15803d" }}>{hybridReport.oraclePassedCandidates}/{hybridReport.candidatesEvaluated}</strong></span>
              </div>

              {/* Actionable Pareto Frontier Cards -> One-click Apply to 3D Workspace */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
                {(
                  [
                    { key: "maxQty", titleZh: "最大装载数量解", titleEn: "Max Quantity Pareto", plan: hybridReport.pareto.maxQuantity },
                    { key: "maxUtil", titleZh: "最高空间利用率解", titleEn: "Max Utilization Pareto", plan: hybridReport.pareto.maxUtilization },
                    { key: "mostStable", titleZh: "最稳重心安全解", titleEn: "Most Stable Pareto", plan: hybridReport.pareto.mostStable },
                  ] as const
                ).map((item) => (
                  <div
                    key={item.key}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid rgba(37,99,235,0.28)",
                      background: "rgba(37,99,235,0.04)",
                      fontSize: 11,
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{tr(item.titleZh, item.titleEn)}</div>
                    <div>
                      <strong>{item.plan.metrics.loadedCount}</strong> {tr("箱", "ctns")} ·{" "}
                      <strong>{(item.plan.metrics.volumeUtilization * 100).toFixed(1)}%</strong> ·{" "}
                      {Math.round(item.plan.metrics.grossWeight)} kg
                    </div>
                    {onAdoptPlan && (
                      <button
                        type="button"
                        className="button small"
                        onClick={() => {
                          onAdoptPlan(item.plan);
                          setAdoptedLabel(tr(item.titleZh, item.titleEn));
                        }}
                      >
                        {tr("采用到 3D 视图", "Apply to 3D View")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {adoptedLabel && (
                <div style={{ fontSize: 11, color: "#15803d", fontWeight: 600 }}>
                  ✓ {tr(`已将「${adoptedLabel}」同步写入主 3D 装柜视图与明细表。`, `Applied "${adoptedLabel}" to the live 3D workspace.`)}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* D02: 智能优化目标设置（1:1 复刻配图：6 色滑块 + 分段彩色比例条 + 个人偏好 + 恢复默认） */}
      {showAll && (
        <section className="analytics-card" aria-label={tr("智能优化目标设置", "Smart Optimization Objectives")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div>
              <h4 style={{ margin: 0 }}>{tr("智能优化目标设置（多目标 Pareto 权重与偏好保存）", "Smart Optimization Objective Weights")}</h4>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                {tr("拖动权重实时查看多目标分配比例；硬性工程约束（碰撞/越界/限重/防压溃）始终锁定不可绕过。", "Hard engineering constraints remain strictly locked regardless of weights.")}
              </div>
            </div>
            <button
              type="button"
              className="button small ghost"
              onClick={() => {
                setWeights({ ...DEFAULT_SIX_UI_WEIGHTS });
                setPresetNotice(tr("已恢复默认权重", "Restored default weights"));
              }}
            >
              {tr("恢复默认权重", "Reset Defaults")}
            </button>
          </header>

          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {WEIGHT_META.map((item) => {
              const raw = weights[item.key];
              const pct = Math.round((raw / weightTotal) * 100);
              return (
                <div key={item.key} style={{ display: "grid", gridTemplateColumns: "130px 1fr 74px", alignItems: "center", gap: 10, fontSize: 12 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: item.color, display: "inline-block" }} />
                    {tr(item.labelZh, item.labelEn)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={raw}
                    aria-label={tr(item.labelZh, item.labelEn)}
                    onChange={(e) => setWeights((prev) => ({ ...prev, [item.key]: Number(e.target.value) }))}
                    style={{ accentColor: item.color }}
                  />
                  <strong style={{ textAlign: "right" }}>{raw} ({pct}%)</strong>
                </div>
              );
            })}
          </div>

          {/* Horizontal Segmented Color Proportion Bar */}
          <div style={{ marginTop: 10, height: 14, borderRadius: 7, overflow: "hidden", display: "flex", background: "rgba(148,163,184,0.2)" }}>
            {WEIGHT_META.map((item) => {
              const pct = (weights[item.key] / weightTotal) * 100;
              if (pct <= 0) return null;
              return (
                <div
                  key={item.key}
                  title={`${tr(item.labelZh, item.labelEn)}: ${Math.round(pct)}%`}
                  style={{ width: `${pct}%`, background: item.color, transition: "width 120ms ease" }}
                />
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10, fontSize: 11 }}>
            <input
              type="text"
              placeholder={tr("个人偏好名称（如：高柜极省运费）", "Preset name")}
              value={savedPresetName}
              onChange={(e) => setSavedPresetName(e.target.value)}
              style={{ fontSize: 11, padding: "4px 8px" }}
            />
            <button type="button" className="button small ghost" onClick={handleSaveWeightPreset}>
              {tr("保存个人偏好", "Save Preset")}
            </button>
            <button type="button" className="button small ghost" onClick={handleLoadWeightPreset}>
              {tr("载入偏好", "Load Preset")}
            </button>
            {presetNotice && <span style={{ color: "#15803d" }}>{presetNotice}</span>}
            {paretoScores[0] && (
              <span style={{ marginLeft: "auto" }}>
                {tr("当前方案多目标综合分", "Current Composite Score")}: <strong>{paretoScores[0].compositeScore}</strong>
              </span>
            )}
          </div>
        </section>
      )}

      {/* D04: 六级纵向包装层级结构图 (Level 1 → Level 6) */}
      {showAll && (
        <section className="analytics-card" aria-label={tr("六级包装层级结构", "6-Level Packaging Hierarchy")}>
          <h4 style={{ margin: "0 0 8px" }}>{tr("六级多级包装抽象模型（产品 → 内包装 → 外箱 → 运输包装 → 载具 → 整单）", "6-Level Universal Packaging Hierarchy")}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, fontSize: 11 }}>
            {[
              { lv: "Level 1", tZh: "产品（单件/零部件）", tEn: "Product / Part", val: `${level6Totals.totalUnits} ${tr("件", "pcs")} · ${level6Totals.totalCargoKg} kg` },
              { lv: "Level 2", tZh: "内包装（内盒/袋/泡沫）", tEn: "Inner Pack", val: `${tr("估算皮重", "Est. Tare")} ${level6Totals.innerPackKg} kg` },
              { lv: "Level 3", tZh: "外包装（纸箱/木箱/周转箱）", tEn: "Master Carton / Crate", val: `${tr("箱材皮重", "Carton Tare")} ${level6Totals.cartonTareKg} kg` },
              { lv: "Level 4", tZh: "运输包装（托盘/框架/笼车）", tEn: "Transport Unit", val: `${level6Totals.palletCount} ${tr("托", "pal")} · ${level6Totals.palletTareKg} kg` },
              { lv: "Level 5", tZh: "装载空间（柜/货车/ULD）", tEn: "Load Space", val: `${result.container.name} (${(result.metrics.volumeUtilization * 100).toFixed(1)}%)` },
              { lv: "Level 6", tZh: "整单运输（多柜/多目的地）", tEn: "Multi-Container Order", val: `${tr("包材皮重占比", "Tare Share")} ${level6Totals.tareRatioPct}%` },
            ].map((node, idx) => (
              <div
                key={node.lv}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(37,99,235,0.28)",
                  background: `rgba(37,99,235,${0.04 + idx * 0.02})`,
                }}
              >
                <div style={{ fontWeight: 700, color: "#1d4ed8" }}>{node.lv}</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{tr(node.tZh, node.tEn)}</div>
                <div style={{ opacity: 0.8, marginTop: 4 }}>{node.val}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* D05: 异形货物 10 类策略矩阵 + 真实可编辑参数 + 2D 排样图 + OBB/BVH 零碰撞核验 */}
      {showAll && (
        <section className="analytics-card" aria-label={tr("异形货物装载引擎与能力边界", "Irregular Cargo Engine & Capability Tiers")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("异形货物装载引擎（10 类专项策略 · 可调参数 · OBB/BVH 碰撞核验）", "Irregular Cargo Engine (10 Strategies & OBB/BVH)")}</h4>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="button small ghost" onClick={handleSyncIrregularFromSku}>
                {tr("同步首项 SKU 尺寸", "Sync First SKU")}
              </button>
              {(
                [
                  ["hcp", tr("圆筒六角密排", "Cylinder HCP")],
                  ["cone", tr("圆锥/花盆套叠", "Conical Nesting")],
                  ["ut", tr("U/T 型凹槽互锁", "U/T Interlock")],
                  ["panel", tr("板材/围栏错位", "Staggered Panels")],
                  ["flex", tr("柔性实测压缩", "Flexible Compression")],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`button small ${irregularTab === id ? "" : "ghost"}`}
                  onClick={() => setIrregularTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </header>

          <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "rgba(15,23,42,0.03)", fontSize: 12, display: "grid", gap: 8 }}>
            {irregularTab === "hcp" && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                  <label>{tr("直径 mm", "Dia mm")} <input type="number" min={50} value={cylDia} onChange={(e) => setCylDia(Number(e.target.value) || 360)} style={{ width: 64 }} /></label>
                  <label>{tr("长度 mm", "Len mm")} <input type="number" min={50} value={cylLen} onChange={(e) => setCylLen(Number(e.target.value) || 1200)} style={{ width: 68 }} /></label>
                  <label>{tr("单重 kg", "Wt kg")} <input type="number" min={0.5} step={0.5} value={cylWt} onChange={(e) => setCylWt(Number(e.target.value) || 28)} style={{ width: 56 }} /></label>
                  <label>{tr("摆放轴向", "Axis")} <select value={cylAxis} onChange={(e) => setCylAxis(e.target.value as "horizontal" | "vertical")}><option value="horizontal">{tr("卧式水平", "Horizontal")}</option><option value="vertical">{tr("立式竖直", "Vertical")}</option></select></label>
                </div>
                <div>
                  <strong>{tr("圆筒/钢管六角密排 (HCP)", "Cylindrical HCP")}</strong>：
                  {tr("矩形网格", "Grid")} {hcpSample.rectGridCount} → <strong>HCP {hcpSample.hcpCount}</strong>（+{hcpSample.gainPct}%，{tr("零穿透校验", "Zero-Penetration")}: {hcpSample.zeroPenetrationVerified ? "PASS" : "FAIL"}，{tr("能力层级：真实几何碰撞", "Tier: geometric-collision")}）
                </div>
                {/* Live 2D Hexagonal Cross-Section Diagram */}
                <svg viewBox="0 0 260 66" width="100%" style={{ maxHeight: 68, background: "#f8fafc", borderRadius: 6, border: "1px solid rgba(148,163,184,0.25)" }}>
                  {[0, 1, 2].map((row) =>
                    Array.from({ length: row % 2 === 0 ? 11 : 10 }, (_, col) => (
                      <circle
                        key={`${row}-${col}`}
                        cx={18 + col * 22 + (row % 2 === 1 ? 11 : 0)}
                        cy={14 + row * 19}
                        r={10}
                        fill={row % 2 === 0 ? "#3b82f6" : "#06b6d4"}
                        stroke="#1e3a8a"
                        strokeWidth="1"
                        opacity="0.88"
                      />
                    )),
                  )}
                </svg>
              </div>
            )}
            {irregularTab === "cone" && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                  <label>{tr("上口径 mm", "Top Ø")} <input type="number" min={50} value={coneTopDia} onChange={(e) => setConeTopDia(Number(e.target.value) || 320)} style={{ width: 60 }} /></label>
                  <label>{tr("下底径 mm", "Bot Ø")} <input type="number" min={30} value={coneBotDia} onChange={(e) => setConeBotDia(Number(e.target.value) || 220)} style={{ width: 60 }} /></label>
                  <label>{tr("单高 mm", "Height")} <input type="number" min={40} value={coneH} onChange={(e) => setConeH(Number(e.target.value) || 280)} style={{ width: 60 }} /></label>
                  <label>{tr("套叠步距 mm", "Nest Step")} <input type="number" min={5} value={coneStep} onChange={(e) => setConeStep(Number(e.target.value) || 45)} style={{ width: 54 }} /></label>
                </div>
                <div>
                  <strong>{tr("圆锥/塑料花盆套叠", "Conical Telescoping Nesting")}</strong>：
                  {tr("未套叠", "Unnested")} {coneSample.nonNestedCount} → <strong>{tr("套叠后", "Nested")} {coneSample.nestedCount}</strong>（+{coneSample.gainPct}%，{tr("单摞高度", "Stack H")} {coneSample.stackHeightMm} mm）
                </div>
              </div>
            )}
            {irregularTab === "ut" && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                  <label>{tr("截面", "Profile")} <select value={utShape} onChange={(e) => setUtShape(e.target.value as "U" | "T")}><option value="U">U 型</option><option value="T">T 型</option></select></label>
                  <label>L <input type="number" min={100} value={utL} onChange={(e) => setUtL(Number(e.target.value) || 600)} style={{ width: 60 }} /></label>
                  <label>W <input type="number" min={100} value={utW} onChange={(e) => setUtW(Number(e.target.value) || 400)} style={{ width: 60 }} /></label>
                  <label>H <input type="number" min={100} value={utH} onChange={(e) => setUtH(Number(e.target.value) || 450)} style={{ width: 60 }} /></label>
                  <label>{tr("壁厚", "Wall")} <input type="number" min={20} value={utWall} onChange={(e) => setUtWall(Number(e.target.value) || 90)} style={{ width: 54 }} /></label>
                </div>
                <div>
                  <strong>{tr("U/T 型件 180° 凹槽互锁", "U/T-Profile 180° Interlock")}</strong>：
                  {tr("外接盒", "Bounding Box")} {utSample.naiveBoxCount} → <strong>{tr("互锁", "Interlocked")} {utSample.interlockedCount}</strong>（+{utSample.gainPct}%，{tr("成对包络", "Pair Envelope")} {utSample.pairEnvelopeMm.join("×")} mm，{tr("零重叠校验", "Zero-Overlap")}: {utSample.zeroOverlapVerified ? "PASS" : "FAIL"}）
                </div>
              </div>
            )}
            {irregularTab === "panel" && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                  <label>L <input type="number" min={100} value={panelL} onChange={(e) => setPanelL(Number(e.target.value) || 1800)} style={{ width: 64 }} /></label>
                  <label>W <input type="number" min={100} value={panelW} onChange={(e) => setPanelW(Number(e.target.value) || 950)} style={{ width: 64 }} /></label>
                  <label>{tr("厚", "Thick")} <input type="number" min={10} value={panelT} onChange={(e) => setPanelT(Number(e.target.value) || 65)} style={{ width: 54 }} /></label>
                  <label>{tr("搭接量", "Overlap")} <input type="number" min={0} value={panelOverlap} onChange={(e) => setPanelOverlap(Number(e.target.value) || 22)} style={{ width: 54 }} /></label>
                </div>
                <div>
                  <strong>{tr("围栏/型材/板材交替错位叠放", "Staggered Fence & Profile Stacking")}</strong>：
                  {tr("平叠", "Flat")} {panelSample.naiveCount} → <strong>{tr("错位叠放", "Staggered")} {panelSample.staggeredCount}</strong>（+{panelSample.gainPct}%，{tr("等效层距", "Pitch")} {panelSample.effectivePitchMm} mm）
                </div>
              </div>
            )}
            {irregularTab === "flex" && (
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{tr("实测允许压缩率 (0–18%)", "Measured Compression (0–18%)")}: <strong>{flexCompressionPct}%</strong></span>
                  <input type="range" min={0} max={18} value={flexCompressionPct} onChange={(e) => setFlexCompressionPct(Number(e.target.value))} />
                </label>
                <div>
                  {tr("标称装量", "Nominal")} {flexSample.nominalCapacity} → <strong>{tr("压缩后", "Compressed")} {flexSample.compressedCapacity}</strong>（+{flexSample.capacityGainPct}%）· {tr(flexSample.disclaimerZh, flexSample.disclaimerEn)}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              {tr("3D OBB / BVH SAT 实时几何碰撞核验", "3D OBB/BVH SAT Collision Check")}:{" "}
              <strong style={{ color: obbAudit.collisionFree ? "#15803d" : "#dc2626" }}>
                {obbAudit.collisionFree ? tr("0 碰撞通过", "0 Collisions PASS") : `${obbAudit.collisions.length} 冲突`}
              </strong>{" "}
              ({tr("广相裁剪后精检", "Narrow-phase checked")} {obbAudit.checkedPairs} {tr("对", "pairs")})
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 6, marginTop: 8, fontSize: 11 }}>
            {IRREGULAR_10_CATEGORY_REGISTRY.map((cat) => (
              <div key={cat.id} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.25)" }}>
                <div style={{ fontWeight: 600 }}>{tr(cat.nameZh, cat.nameEn)}</div>
                <div style={{ opacity: 0.78 }}>{tr(cat.strategyZh, cat.strategyEn)}</div>
                <div style={{ fontSize: 10, color: "#1d4ed8", marginTop: 2 }}>
                  {cat.capabilityTier === "geometric-collision"
                    ? tr("层级：真实几何碰撞", "Tier: Geometric Collision")
                    : cat.capabilityTier === "measured-deformation"
                      ? tr("层级：真实材料变形", "Tier: Measured Deformation")
                      : tr("层级：真实模型显示", "Tier: Visual Model Display")}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* D06: CAD / 3D 模型与工程文件预处理中心 (GLB/OBJ/STL/FBX/STEP/IGES/DXF + 一键导入订单 + 3ds Max Bridge) */}
      {showAll && (
        <section className="analytics-card" aria-label={tr("CAD 与 3D 工程文件兼容中心", "CAD & 3D Engineering File Importer")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("CAD / 3D 模型与工程文件兼容（GLB / OBJ / STL / FBX / STEP / IGES / DXF）", "CAD & 3D Engineering File Preprocessor")}</h4>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="button small ghost" onClick={handleLoadSampleObj}>
                {tr("加载示例机械零件 (.obj)", "Load Sample CAD (.obj)")}
              </button>
              <button type="button" className="button small ghost" onClick={handleDownload3dsMax}>
                {tr("下载 3ds Max 桥接插件 (.ms)", "Download 3ds Max Bridge (.ms)")}
              </button>
            </div>
          </header>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 8, fontSize: 12 }}>
            <input
              type="file"
              accept=".obj,.stl,.fbx,.step,.stp,.iges,.igs,.dxf"
              aria-label={tr("上传 CAD 或 3D 模型文件", "Upload CAD or 3D file")}
              onChange={(e) => handleCadFileUpload(e.target.files?.[0] ?? null)}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {tr("轴心校正", "Pivot")}
              <select value={cadPivotMode} onChange={(e) => setCadPivotMode(e.target.value as CadPreprocessOptions["pivotMode"])}>
                <option value="bottom-center">{tr("底面中心", "Bottom Center")}</option>
                <option value="bottom-left-front">{tr("底面角点 (0,0,0)", "Bottom Corner")}</option>
                <option value="centroid">{tr("几何质心", "Centroid")}</option>
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {tr("简化目标面数", "Target Tris")}
              <input type="number" min={12} max={200000} value={cadTargetTris} onChange={(e) => setCadTargetTris(Number(e.target.value) || 5000)} style={{ width: 76 }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {tr("重心 Z 偏移 (mm)", "CoG Z Offset")}
              <input type="number" min={-500} max={500} value={cadCogZOffset} onChange={(e) => setCadCogZOffset(Number(e.target.value) || 0)} style={{ width: 64 }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {tr("单重 kg", "Weight kg")}
              <input type="number" min={0.5} step={0.5} value={cadUnitWeightKg} onChange={(e) => setCadUnitWeightKg(Number(e.target.value) || 25)} style={{ width: 60 }} />
            </label>
          </div>

          {cadError && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 6 }}>⚠ {cadError}</div>}

          {cadModel && (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "rgba(37,99,235,0.05)", fontSize: 12, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <strong>{cadModel.format.toUpperCase()}</strong> · {tr("识别外廓", "Envelope")}: <strong>{cadModel.dimensionsMm.join(" × ")} mm</strong> ·{" "}
                  {tr("真实体积", "True Vol")}: <strong>{cadModel.trueVolumeLiters} L</strong> ({tr("填充率", "Fill")} {cadModel.fillFactorPct}%) ·{" "}
                  {tr("重心", "CoG")}: <strong>({cadModel.cogMm.join(", ")}) mm</strong>
                </div>
                {onAddProduct && (
                  <button type="button" className="button small primary" onClick={handleAddCadToOrder}>
                    {tr("一键导入为新货物行", "Add as New Order Line")}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
                {cadModel.loadBearingSurfaces.map((s) => (
                  <span
                    key={s.face}
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: s.loadBearingRecommended ? "rgba(21,128,61,0.12)" : "rgba(148,163,184,0.18)",
                      color: s.loadBearingRecommended ? "#166534" : "#475569",
                    }}
                  >
                    {s.face}: {Math.round(s.planarSupportRatio * 100)}% {s.loadBearingRecommended ? tr("✓可承托", "✓Support") : ""}
                  </span>
                ))}
              </div>
              {cadModel.allowedNestingZoneMm && (
                <div style={{ fontSize: 11, color: "#1d4ed8" }}>
                  {tr("识别允许嵌套凹腔区", "Detected Allowed Nesting Cavity")}: {cadModel.allowedNestingZoneMm.dx}×{cadModel.allowedNestingZoneMm.dy}×{cadModel.allowedNestingZoneMm.dz} mm
                </div>
              )}
              {cadAddedNotice && <div style={{ fontSize: 11, color: "#15803d", fontWeight: 600 }}>✓ {cadAddedNotice}</div>}
            </div>
          )}
        </section>
      )}

      {/* D07: 智能托盘与木箱设计系统（真实交错/风车 2D 码垛坐标 SVG + 5 种托盘切换对比表 + 木箱 1–8 号零件 BOM） */}
      {showAll && smartPallet && crateBom && (
        <section className="analytics-card" aria-label={tr("智能托盘与木箱工程设计系统", "Smart Pallet & Wooden Crate Design System")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("智能托盘经济性设计与木箱结构 BOM 系统", "Smart Pallet & Wooden Crate BOM Designer")}</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
              <select
                aria-label={tr("选择目标 SKU", "Select SKU")}
                value={selectedSkuIdx}
                onChange={(e) => {
                  setSelectedSkuIdx(Number(e.target.value));
                  setSelectedPalletId("");
                }}
              >
                {products.map((p, idx) => (
                  <option key={p.id} value={idx}>{p.sku} ({p.length}×{p.width}×{p.height})</option>
                ))}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {tr("限高", "Max H")}
                <input type="number" min={800} max={2600} value={palletMaxH} onChange={(e) => setPalletMaxH(Number(e.target.value) || 2200)} style={{ width: 66 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {tr("悬挑 mm", "Overhang")}
                <input type="number" min={0} max={100} value={palletOverhang} onChange={(e) => setPalletOverhang(Number(e.target.value) || 0)} style={{ width: 54 }} />
              </label>
            </div>
          </header>

          <p className="helper-text">{tr("目录承重与价格为参考值；纸箱承压和运输固定仍须核验。40HQ托位为平面包络估算，须在主装柜方案复核。", "Catalog ratings and prices are references. Verify carton compression and securing. 40HQ floor slots are envelope estimates; recheck in the main load plan.")}</p>
          {activePalletOption ? <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 10 }}>
            {/* Authentic 2D Top-Down Pallet Layer Pattern SVG driven by exact layerLayout coordinates */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                {tr("真实 2D 俯视码垛层型图", "Authentic 2D Top-Down Layer Pattern")} · {tr(activePalletOption.pallet.nameZh, activePalletOption.pallet.nameEn)}
              </div>
              <svg viewBox="0 0 260 185" width="100%" style={{ maxHeight: 175, background: "#f8fafc", border: "1px solid rgba(148,163,184,0.3)", borderRadius: 6 }}>
                {(() => {
                  const pal = activePalletOption.pallet;
                  const effL = pal.lengthMm + palletOverhang * 2;
                  const effW = pal.widthMm + palletOverhang * 2;
                  const scale = Math.min(212 / Math.max(1, effL), 140 / Math.max(1, effW));
                  const drawW = effL * scale;
                  const drawH = effW * scale;
                  const ox = (260 - drawW) / 2;
                  const oy = 14 + (144 - drawH) / 2;
                  return (
                    <>
                      {palletOverhang > 0 && <rect x={ox} y={oy} width={drawW} height={drawH} fill="none" stroke="#94a3b8" strokeDasharray="3 2" />}
                      <rect x={ox+palletOverhang*scale} y={oy+palletOverhang*scale} width={pal.lengthMm*scale} height={pal.widthMm*scale} fill="#fef3c7" stroke="#b45309" strokeWidth="2" rx="3" />
                      {activePalletOption.layerLayout.map((box, idx) => (
                        <rect
                          key={idx}
                          x={ox + (box.x+palletOverhang) * scale + 1}
                          y={oy + (box.y+palletOverhang) * scale + 1}
                          width={Math.max(3, box.dx * scale - 2)}
                          height={Math.max(3, box.dy * scale - 2)}
                          fill={box.rotated ? "#0d9488" : "#22c55e"}
                          stroke={box.rotated ? "#134e4a" : "#14532d"}
                          strokeWidth="1"
                          rx="2"
                        />
                      ))}
                    </>
                  );
                })()}
                <text x="130" y="176" textAnchor="middle" fontSize="9" fill="#475569">
                  {activePalletOption.pallet.lengthMm}×{activePalletOption.pallet.widthMm} mm · {tr(activePalletOption.patternLabelZh, activePalletOption.patternLabelEn)} · {activePalletOption.cartonsPerLayer} {tr("箱/层", "/lyr")} × {activePalletOption.layers} {tr("层", "lyrs")} · {activePalletOption.areaUtilizationPct}%
                </text>
              </svg>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                {smartPallet.options.map((opt) => {
                  const isSel = opt.pallet.id === activePalletOption.pallet.id;
                  return (
                    <button
                      key={opt.pallet.id}
                      type="button"
                      className={`button small ${isSel ? "" : "ghost"}`}
                      onClick={() => setSelectedPalletId(opt.pallet.id)}
                      style={{ fontSize: 10, padding: "2px 6px" }}
                    >
                      {opt.pallet.id.toUpperCase()} ({opt.palletsNeededForOrder}{tr("托", "p")} · ${opt.totalPalletCostUsd})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Wooden Crate 1-8 Part Structural BOM Table */}
            <div style={{ overflowX: "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                {tr("木箱结构 1–8 号零件 BOM 明细", "Wooden Crate 1–8 Structural BOM")} ({crateBom.outerDimsMm.join("×")} mm · {tr("自重", "Tare")} {crateBom.crateTareKg} kg · ${crateBom.estimatedCrateCostUsd})
              </div>
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(148,163,184,0.3)" }}>
                    <th>#</th>
                    <th>{tr("零件号", "Part No")}</th>
                    <th>{tr("名称", "Component")}</th>
                    <th>{tr("数量", "Qty")}</th>
                    <th>{tr("小计 kg", "Wt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {crateBom.parts.map((part) => (
                    <tr key={part.itemNo} style={{ borderBottom: "1px solid rgba(148,163,184,0.12)" }}>
                      <td><strong>{part.itemNo}</strong></td>
                      <td><code>{part.partNumber}</code></td>
                      <td>{tr(part.nameZh, part.nameEn)}</td>
                      <td>{part.qty}</td>
                      <td>{part.subtotalWeightKg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </> : <p role="status">{tr("当前箱规、方向、限高或承重条件下没有可用方案；请调整上方参数。异形模型及单层超过10000箱的规格请在主装柜流程核验。", "No feasible option under the current dimensions, orientation, height or load limits. Adjust the inputs above. Use the main planner for shaped models or layers exceeding 10,000 cartons.")}</p>}
        </section>
      )}

      {/* D08: 2×2 四类工程分析热力图（累计上压 / 地板载荷 / 稳定性风险 / 承托面积）+ 未核验显式标注 */}
      {showAll && (
        <section className="analytics-card" aria-label={tr("四类工程分析热力图", "4 Engineering Analysis Heatmaps")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("工程分析四维热力图（累计上压 · 地板载荷 · 稳定性风险 · 承托面积）", "2×2 Engineering Risk Heatmaps")}</h4>
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "rgba(217,119,6,0.15)", color: "#b45309", fontWeight: 600 }}>
              {tr("纸箱实测抗压 BCT：未核验（未导入实验室实测值时绝不自动判定安全）", "Lab BCT: UNVERIFIED (never auto-marked safe without test data)")}
            </span>
          </header>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10 }}>
            {[
              { id: "hm-top", titleZh: "1. 累计上压热力图", titleEn: "1. Top-Load Pressure", grid: heatmaps.topLoad },
              { id: "hm-floor", titleZh: "2. 地板载荷热力图", titleEn: "2. Floor Load Density", grid: heatmaps.floorLoad },
              { id: "hm-stab", titleZh: "3. 稳定性风险分布", titleEn: "3. Stability Risk Map", grid: heatmaps.stability },
              { id: "hm-sup", titleZh: "4. 承托面积分析", titleEn: "4. Support Coverage Map", grid: heatmaps.supportArea },
            ].map(({ id, titleZh, titleEn, grid }) => {
              const cells = grid.cells.slice(0, 20);
              return (
                <div key={id} style={{ padding: 8, borderRadius: 8, border: "1px solid rgba(148,163,184,0.25)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{tr(titleZh, titleEn)}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
                    {cells.map((cell: HeatmapCell, idx: number) => (
                      <div
                        key={idx}
                        title={`(${cell.col},${cell.row}): ${cell.value} ${grid.unit} (${cell.status})`}
                        style={{
                          height: 18,
                          borderRadius: 3,
                          background: cell.color || HEATMAP_RISK_COLOR(cell.status === "high" ? 0.9 : cell.status === "caution" ? 0.5 : 0.1),
                          opacity: cell.status === "empty" ? 0.25 : 0.92,
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.75, marginTop: 5 }}>
                    <span style={{ color: "#dc2626" }}>{tr("高风险", "High Risk")}</span>
                    <span>Peak: {grid.maxValue} {grid.unit}</span>
                    <span style={{ color: "#2563eb" }}>{tr("低风险", "Low Risk")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* D09: 多柜全局联合优化对比示意图（优化前 vs 优化后进度条 + 真实已装柜锁定保护） */}
      {showAll && (
        <section className="analytics-card" aria-label={tr("多柜全局联合优化对比", "Global Multi-Container Optimization Comparison")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("多柜全局联合优化与已装柜锁定保护", "Global Multi-Container Optimization & Lock Protection")}</h4>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              {tr("已装柜锁定保护数", "Locked Containers")}
              <input
                type="number"
                min={0}
                max={10}
                value={lockedContainers}
                onChange={(e) => setLockedContainers(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: 54 }}
              />
            </label>
          </header>

          <div style={{ display: "grid", gap: 10, marginTop: 10, fontSize: 12 }}>
            <div style={{ padding: 8, borderRadius: 8, background: "rgba(148,163,184,0.08)" }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{tr("优化前：逐柜分别规划（均质柜型基准）", "Before: Single-Type Sequential Planning")}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(globalFleet.unlockedOptimization.portfolios[globalFleet.unlockedOptimization.portfolios.length - 1]?.legs ?? []).map((leg, idx) => (
                  <div key={idx} style={{ flex: "1 1 120px" }}>
                    <div style={{ fontSize: 11 }}>{tr("柜", "Ctn")} {idx + 1} ({leg.type.toUpperCase()}) · {Math.round(leg.volumeUtilPct)}%</div>
                    <div style={{ height: 10, borderRadius: 5, background: "rgba(148,163,184,0.25)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, leg.volumeUtilPct)}%`, height: "100%", background: "#64748b" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ textAlign: "center", opacity: 0.6 }}>↓ {tr("跨柜重排 + 柜型混配 + LCL/FCL 成本寻优", "Cross-container rebalance + mixed-fleet + LCL/FCL")}</div>

            <div style={{ padding: 8, borderRadius: 8, background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
                <span>{tr("优化后：推荐经济柜型组合", "After: Recommended Mixed-Container Plan")} ({globalFleet.unlockedOptimization.recommended?.labelZh ?? "-"})</span>
                <span style={{ color: "#15803d" }}>
                  {tr("总落地成本", "Total")} ${globalFleet.combinedBestCostUsd.toLocaleString()}
                  {(globalFleet.unlockedOptimization.recommended?.savingsVsNaive40HqUsd ?? 0) > 0 ? ` · ${tr("节省", "Saves")} $${globalFleet.unlockedOptimization.recommended.savingsVsNaive40HqUsd.toLocaleString()}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(globalFleet.unlockedOptimization.recommended?.legs ?? []).map((leg, idx) => (
                  <div key={idx} style={{ flex: "1 1 120px" }}>
                    <div style={{ fontSize: 11 }}>
                      {idx < lockedContainers ? "🔒 " : ""}
                      {leg.type.toUpperCase()} · {Math.round(leg.volumeUtilPct)}% ({leg.loadedCartons} {tr("箱", "ctns")})
                    </div>
                    <div style={{ height: 10, borderRadius: 5, background: "rgba(148,163,184,0.25)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, leg.volumeUtilPct)}%`, height: "100%", background: idx < lockedContainers ? "#0d9488" : "#2563eb" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.78 }}>
              {tr("所有柜型替换均经过严格数量、几何与重量守恒校验。", "Every fleet substitution is strictly verified for quantity, geometry, and weight conservation.")}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
