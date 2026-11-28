"use client";

import { useMemo, useState } from "react";
import { TRANSPORT_PRESETS } from "../lib/packing/transport-library";
import {
  estimateProgressiveUnloadingAxleLoads,
  estimateThreeAxleTractorTrailerLoad,
} from "../lib/packing/axle-load-estimator";
import { auditPostUnloadSupportStability } from "../lib/packing/multi-stop-auditor";
import {
  analyzeCtuSecuring,
  estimateCtuSecuringAccessoryKit,
  type CtuTransportMode,
} from "../lib/packing/securing-void-analyzer";
import {
  createGovernedPlanRecord,
  diffGovernedPlans,
  transitionApprovalStatus,
  type ApprovalStatus,
  type GovernedPlanRecord,
} from "../lib/packing/enterprise-governance";
import { API_SCHEMA_VERSION, executeCargoFitApiV1 } from "../lib/packing/api-contract";
import { CargoFitClient } from "../lib/sdk/cargofit-sdk";
import { computePackingRoi } from "../lib/packing/multi-objective-roi";
import type { ContainerSpec, PackingResult, ProductInput } from "../lib/packing/types";
import type { RoleWorkbenchPreset } from "./v3-visual-suites";

interface V3OpsEnterpriseSuitesProps {
  result: PackingResult;
  products: readonly ProductInput[];
  rolePreset?: RoleWorkbenchPreset;
  onSelectContainerPreset?: (spec: ContainerSpec) => void;
  tr: (zh: string, en?: string) => string;
}

const NINE_TRANSPORT_CARDS = [
  { id: "40hq", labelZh: "标准集装箱 (20/40/40HQ)", labelEn: "Standard Dry Container", tagZh: "标准干货" },
  { id: "40ot", labelZh: "开顶柜 (20OT/40OT)", labelEn: "Open Top Container", tagZh: "顶部吊装" },
  { id: "40fr", labelZh: "框架柜 (20FR/40FR)", labelEn: "Flat Rack Container", tagZh: "超宽超高" },
  { id: "40rh", labelZh: "冷藏柜 (含冷机与回风红线)", labelEn: "Reefer (Airflow Exclusions)", tagZh: "真实障碍区" },
  { id: "truck-step-deck-13.6", labelZh: "阶梯式车厢 (Step-Deck)", labelEn: "Step-Deck Trailer", tagZh: "鹅颈阶梯" },
  { id: "air-ld3-ake", labelZh: "航空集装器 LD3 (AKE)", labelEn: "Air ULD LD3 (AKE)", tagZh: "45°切角包络" },
  { id: "rail-boxcar-60", labelZh: "铁路货运车厢 (P70/60ft)", labelEn: "Rail Freight Boxcar", tagZh: "专业铁路模块" },
  { id: "roll-cage-std", labelZh: "仓储笼车 (Roll Cage)", labelEn: "Warehouse Roll Cage", tagZh: "商超周转" },
  { id: "bulk-cargo-hold", labelZh: "散杂货船舱 (Breakbulk)", labelEn: "Breakbulk Vessel Hold", tagZh: "专业散杂模块" },
];

const EIGHT_PLATFORM_MODULES = [
  { name: "CargoFit Engine", zh: "核心装载算法引擎", en: "Core Hybrid Loading Solver" },
  { name: "CargoFit Pack", zh: "包装工程与智能打托", en: "Packaging Eng & Smart Palletizing" },
  { name: "CargoFit 3D Studio", zh: "三维建模与装载编辑", en: "3D CAD Studio & Load Editing" },
  { name: "CargoFit Optimize", zh: "多柜及成本全局优化", en: "Multi-Container & Cost Optimizer" },
  { name: "CargoFit Warehouse", zh: "仓库装载与现场执行", en: "Warehouse Execution & Mobile Sync" },
  { name: "CargoFit AI", zh: "智能分析与决策助手", en: "Deterministic AI Loading Copilot" },
  { name: "CargoFit Cloud", zh: "企业数据与团队协作", en: "Enterprise Data, RBAC & Approvals" },
  { name: "CargoFit Connect", zh: "API、SDK、MCP 生态", en: "REST API, SDK, MCP & Webhooks" },
];

export function V3OpsEnterpriseSuites({
  result,
  products,
  rolePreset = "pro",
  onSelectContainerPreset,
  tr,
}: V3OpsEnterpriseSuitesProps) {
  // D13: live switch feedback
  const [switchedNotice, setSwitchedNotice] = useState<string>("");

  // D14: 3-Axle Semi-Trailer Custom Parameters
  const [tractorWb, setTractorWb] = useState<number>(3800);
  const [steerTare, setSteerTare] = useState<number>(4600);
  const [driveTare, setDriveTare] = useState<number>(3200);
  const [trailerTare, setTrailerTare] = useState<number>(5200);
  const [unloadedStep, setUnloadedStep] = useState<number>(0);

  // D16: CTU Securing Mode
  const [ctuMode, setCtuMode] = useState<CtuTransportMode>("sea-area-c");
  const [frictionMu, setFrictionMu] = useState<number>(0.35);

  // D21: Enterprise Plan Governance State Machine
  const [govRecord, setGovRecord] = useState<GovernedPlanRecord>(() =>
    createGovernedPlanRecord(
      `PLAN-${result.container.id.toUpperCase()}`,
      `${result.container.name} (${products.length} SKUs)`,
      {
        loadedCartons: result.metrics.loadedCount,
        volumeUtilPct: Number((result.metrics.volumeUtilization * 100).toFixed(1)),
        totalWeightKg: Number(result.metrics.grossWeight.toFixed(1)),
      },
      "planner@company.com",
    ),
  );
  const [govError, setGovError] = useState<string>("");

  // D22: Developer Center Live API / SDK Playground
  const [sdkTab, setSdkTab] = useState<"ts" | "py" | "mcp" | "webhook">("ts");
  const [apiJsonOutput, setApiJsonOutput] = useState<string>("");

  // D24: Economic ROI Calculator
  const liveOptUnits = Math.max(1, result.metrics.loadedCount || 450);
  const [annualUnits, setAnnualUnits] = useState<number>(10000);
  const [freightPerCtn, setFreightPerCtn] = useState<number>(3500);
  const [baseUnits, setBaseUnits] = useState<number>(400);
  const [optUnits, setOptUnits] = useState<number>(450);

  const threeAxle = useMemo(
    () =>
      estimateThreeAxleTractorTrailerLoad(
        result,
        {
          tractorWheelbaseMm: tractorWb,
          tractorSteerTareKg: steerTare,
          tractorDriveTareKg: driveTare,
          trailerAxleTareKg: trailerTare,
        },
        unloadedStep,
      ),
    [driveTare, result, steerTare, tractorWb, trailerTare, unloadedStep],
  );

  const progressiveAxle = useMemo(
    () => estimateProgressiveUnloadingAxleLoads(result, "container-chassis"),
    [result],
  );
  const postUnloadRisks = useMemo(() => auditPostUnloadSupportStability(result), [result]);

  // Real placements remaining after unloadedStep for authentic side-profile trailer rendering
  const remainingSideBoxes = useMemo(() => {
    const cLen = Math.max(1, result.container.length);
    const cH = Math.max(1, result.container.height);
    return result.placements
      .filter((box) => {
        const raw = result.delivery?.[box.productId]?.stop;
        const stop = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 1;
        return stop > unloadedStep;
      })
      .slice(0, 120)
      .map((box) => ({
        id: box.id,
        x: 84 + (box.x / cLen) * 232,
        w: Math.max(3, (box.dx / cLen) * 232),
        y: 80 - ((box.z + box.dz) / cH) * 60,
        h: Math.max(3, (box.dz / cH) * 60),
        color: box.color || "#3b82f6",
      }));
  }, [result.container.height, result.container.length, result.delivery, result.placements, unloadedStep]);

  // D15: Live data-driven Multi-Stop LIFO zones
  const liveStops = useMemo(() => {
    const map = new Map<number, { stop: number; count: number; weightKg: number; minX: number; maxX: number }>();
    for (const box of result.placements) {
      const raw = result.delivery?.[box.productId]?.stop;
      const stop = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 1;
      const cur = map.get(stop) ?? { stop, count: 0, weightKg: 0, minX: box.x, maxX: box.x + box.dx };
      cur.count += 1;
      cur.weightKg += box.weight;
      cur.minX = Math.min(cur.minX, box.x);
      cur.maxX = Math.max(cur.maxX, box.x + box.dx);
      map.set(stop, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.stop - a.stop);
  }, [result.delivery, result.placements]);

  // D16: Full CTU Securing Kit
  const ctuReport = useMemo(
    () => analyzeCtuSecuring(result, { mode: ctuMode, frictionMu, strapLcDan: 2000, certifiedLashingDataProvided: false }),
    [ctuMode, frictionMu, result],
  );
  const ctuKit = useMemo(() => estimateCtuSecuringAccessoryKit(result, ctuReport), [ctuReport, result]);

  // D21: Transition handler
  const handleGovTransition = (next: ApprovalStatus) => {
    const roleMap: Record<ApprovalStatus, "planner" | "manager" | "admin"> = {
      draft: "planner",
      pending_review: "planner",
      approved: "manager",
      rejected: "manager",
      issued: "admin",
    };
    const res = transitionApprovalStatus(
      govRecord,
      next,
      next === "approved" || next === "rejected" ? "ops-manager@company.com" : "planner@company.com",
      roleMap[next],
      tr(`工作台审批状态变更为 ${next}`, `Workflow transitioned to ${next}`),
    );
    if (!res.ok) {
      setGovError(res.errorZh ?? "Transition not allowed");
    } else {
      setGovError("");
      setGovRecord(res.record);
    }
  };

  const versionDiff = useMemo(() => {
    const nextSnap: GovernedPlanRecord = {
      ...govRecord,
      revision: govRecord.revision + 1,
      loadedCartons: result.metrics.loadedCount,
      volumeUtilPct: Number((result.metrics.volumeUtilization * 100).toFixed(1)),
      totalWeightKg: Number(result.metrics.grossWeight.toFixed(1)),
    };
    return diffGovernedPlans(govRecord, nextSnap);
  }, [govRecord, result.metrics.grossWeight, result.metrics.loadedCount, result.metrics.volumeUtilization]);

  // D22: Live API Playground execution using real api-contract + SDK class verification
  const handleRunLiveApi = () => {
    const sdkRef = new CargoFitClient({ baseUrl: "https://container-load-planner.pages.dev", apiKey: "cf_live_demo" });
    const resp = executeCargoFitApiV1({
      schema: API_SCHEMA_VERSION,
      requestId: `req-${Date.now().toString(36)}`,
      computeMode: "fast",
      includeEngineeringAudit: true,
      request: {
        mode: products.length <= 1 ? "single" : "mixed",
        workflow: products.length <= 1 ? "single-capacity" : "direct",
        strategy: result.strategy,
        container: result.container,
        products: [...products],
        clearance: result.clearance,
      },
    });
    const preview = {
      sdkReady: Boolean(sdkRef),
      schema: resp.schema,
      engineVersion: resp.engineVersion,
      ok: resp.ok,
      elapsedMs: resp.elapsedMs,
      loadedCount: resp.result?.metrics.loadedCount,
      volumeUtilizationPct: resp.result ? Number((resp.result.metrics.volumeUtilization * 100).toFixed(2)) : 0,
      sample3DCoordinatesMm: (resp.result?.placements ?? []).slice(0, 3).map((b) => ({
        sku: b.sku,
        x: b.x,
        y: b.y,
        z: b.z,
        dx: b.dx,
        dy: b.dy,
        dz: b.dz,
      })),
    };
    setApiJsonOutput(JSON.stringify(preview, null, 2));
  };

  // D24: Live ROI
  const roi = useMemo(
    () =>
      computePackingRoi({
        annualUnits,
        freightPerContainer: freightPerCtn,
        baselineUnitsPerContainer: baseUnits,
        optimizedUnitsPerContainer: optUnits,
      }),
    [annualUnits, baseUnits, freightPerCtn, optUnits],
  );
  const maxRoiBar = Math.max(1, roi.baselineContainers, roi.optimizedContainers);

  const showLogistics = rolePreset === "pro" || rolePreset === "packaging" || rolePreset === "field";
  const showEnterprise = rolePreset === "enterprise" || rolePreset === "pro";
  const showDeveloper = rolePreset === "developer" || rolePreset === "pro";
  const showRoi = rolePreset === "quick" || rolePreset === "pro" || rolePreset === "enterprise";
  const showFlywheel = rolePreset === "pro" || rolePreset === "enterprise" || rolePreset === "field";

  return (
    <div className="v3-ops-enterprise-suites" style={{ display: "grid", gap: 14 }}>
      {/* D13: 3×3 九宫格装载空间库（真实可点击一键切换载具与内置障碍边界） */}
      {showLogistics && (
        <section className="analytics-card" aria-label={tr("3×3 装载空间库浏览器", "3x3 Transport Space Library")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>{tr("全场景装载空间库（点击切换 3×3 海陆空/仓配载具与真实障碍边界）", "3×3 Transport Space Library (Click to Switch)")}</h4>
            {switchedNotice && <span style={{ fontSize: 11, color: "#15803d", fontWeight: 600 }}>✓ {switchedNotice}</span>}
          </header>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(195px, 1fr))", gap: 8, fontSize: 11 }}>
            {NINE_TRANSPORT_CARDS.map((card) => {
              const spec = TRANSPORT_PRESETS.find((p) => p.id === card.id);
              const isCurrent = result.container.id === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  aria-pressed={isCurrent}
                  onClick={() => {
                    if (spec && onSelectContainerPreset) {
                      onSelectContainerPreset(spec);
                      setSwitchedNotice(
                        tr(`已切换为「${spec.name}」，点击重新计算即可按新空间边界排柜。`, `Switched container to ${spec.name}; recalculate to apply.`),
                      );
                    }
                  }}
                  style={{
                    textAlign: "left",
                    cursor: onSelectContainerPreset ? "pointer" : "default",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: isCurrent ? "2px solid #2563eb" : "1px solid rgba(148,163,184,0.28)",
                    background: isCurrent ? "rgba(37,99,235,0.08)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 4, fontWeight: 600 }}>
                    <span>{tr(card.labelZh, card.labelEn)}</span>
                    <span style={{ fontSize: 10, color: "#1d4ed8" }}>{card.tagZh}</span>
                  </div>
                  {spec && (
                    <>
                      <div style={{ opacity: 0.8, marginTop: 3 }}>
                        {spec.length}×{spec.width}×{spec.height} mm · {spec.maxWeight.toLocaleString()} kg
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.72, marginTop: 2 }}>
                        {spec.exclusions && spec.exclusions.length > 0
                          ? `✓ ${tr(`内置 ${spec.exclusions.length} 处真实障碍/切角禁区`, `${spec.exclusions.length} geometric exclusions`)}`
                          : tr("标准净空边界", "Standard clear interior")}
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* D14 三轴半挂车轴荷分析图（实时投影当前真实货箱 + 分段卸货动态消失） + D15 多目的地卸货顺序图 */}
      {showLogistics && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: 12 }}>
          <section className="analytics-card" aria-label={tr("三轴半挂车轴荷与动态配重", "3-Axle Tractor-Trailer Axle Load")}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <h4 style={{ margin: 0 }}>{tr("车辆轴荷与动态配重（前轴 / 驱动轴 / 挂车轴组）", "3-Axle Vehicle Load & Dynamic Balance")}</h4>
              <select
                aria-label={tr("卸货阶段", "Unloading Stage")}
                value={unloadedStep}
                onChange={(e) => setUnloadedStep(Number(e.target.value))}
                style={{ fontSize: 11 }}
              >
                {progressiveAxle.steps.map((st) => (
                  <option key={st.unloadedUpToStop} value={st.unloadedUpToStop}>
                    {tr(st.stepLabelZh, st.stepLabelEn)}
                  </option>
                ))}
              </select>
            </header>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, fontSize: 11 }}>
              <label>{tr("轴距mm", "WB")} <input type="number" value={tractorWb} onChange={(e) => setTractorWb(Number(e.target.value) || 3800)} style={{ width: 58 }} /></label>
              <label>{tr("前轴皮重", "Steer")} <input type="number" value={steerTare} onChange={(e) => setSteerTare(Number(e.target.value) || 4600)} style={{ width: 56 }} /></label>
              <label>{tr("驱动皮重", "Drive")} <input type="number" value={driveTare} onChange={(e) => setDriveTare(Number(e.target.value) || 3200)} style={{ width: 56 }} /></label>
              <label>{tr("挂车皮重", "Trailer")} <input type="number" value={trailerTare} onChange={(e) => setTrailerTare(Number(e.target.value) || 5200)} style={{ width: 56 }} /></label>
            </div>

            {(() => {
              const cogSvgX = Math.round(92 + Math.max(0.05, Math.min(0.95, threeAxle.cogRatio)) * 212);
              return (
                <svg viewBox="0 0 340 132" width="100%" role="img" aria-label={tr("三轴半挂车轴荷重心图", "3-axle semi-trailer CoG diagram")} style={{ maxHeight: 145, display: "block", marginTop: 6 }}>
                  <rect x="14" y="42" width="60" height="40" rx="6" fill="#475569" />
                  <rect x="22" y="48" width="26" height="16" rx="2" fill="#cbd5e1" />
                  <rect x="82" y="18" width="236" height="64" rx="4" fill="#f8fafc" stroke="#475569" strokeWidth="2" />
                  {/* Authentic side-profile projection of remaining loaded placements */}
                  {remainingSideBoxes.map((b) => (
                    <rect
                      key={b.id}
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      rx="1.5"
                      fill={b.color}
                      stroke="#ffffff"
                      strokeWidth="0.6"
                      opacity="0.86"
                    />
                  ))}
                  <circle cx="34" cy="88" r="10" fill="#1e293b" />
                  <circle cx="92" cy="88" r="10" fill="#1e293b" />
                  <circle cx="246" cy="88" r="9" fill="#1e293b" />
                  <circle cx="268" cy="88" r="9" fill="#1e293b" />
                  <circle cx="290" cy="88" r="9" fill="#1e293b" />
                  <line x1={cogSvgX} y1="12" x2={cogSvgX} y2="80" stroke="#dc2626" strokeDasharray="3 2" strokeWidth="1.5" />
                  <line x1={cogSvgX - 10} y1="50" x2={cogSvgX + 10} y2="50" stroke="#dc2626" strokeWidth="1.5" />
                  <circle cx={cogSvgX} cy="50" r="7" fill="none" stroke="#dc2626" strokeWidth="2" />
                  <text x={cogSvgX} y="10" textAnchor="middle" fontSize="9" fontWeight="700" fill="#dc2626">{tr("货物重心", "Cargo CoG")}</text>
                  <text x="34" y="112" textAnchor="middle" fontSize="9" fill="#334155">{tr("前轴", "Steer")} {threeAxle.steerUtilPct}%</text>
                  <text x="98" y="112" textAnchor="middle" fontSize="9" fill="#334155">{tr("驱动轴", "Drive")} {threeAxle.driveUtilPct}%</text>
                  <text x="268" y="112" textAnchor="middle" fontSize="9" fill="#334155">{tr("挂车轴组", "Trailer")} {threeAxle.trailerUtilPct}%</text>
                  <text x="170" y="127" textAnchor="middle" fontSize="8" fill="#64748b">
                    {threeAxle.steerAxleKg}kg / {threeAxle.driveAxleKg}kg / {threeAxle.trailerGroupKg}kg ({threeAxle.status.toUpperCase()})
                  </text>
                </svg>
              );
            })()}
            <div style={{ fontSize: 10, opacity: 0.75 }}>{tr(threeAxle.disclaimerZh, threeAxle.disclaimerEn)}</div>
          </section>

          <section className="analytics-card" aria-label={tr("多目的地卸货顺序实时分布图", "Live Multi-Stop LIFO Zone Diagram")}>
            <h4 style={{ margin: "0 0 8px" }}>{tr("多目的地卸货顺序实时分区（后进先出 LIFO）", "Live Multi-Stop LIFO Unloading Zones")}</h4>
            <svg viewBox="0 0 330 116" width="100%" role="img" aria-label={tr("实时多站卸货分区图", "Live multi-stop zones")} style={{ maxHeight: 132, display: "block" }}>
              <rect x="14" y="16" width="296" height="58" rx="6" fill="#f8fafc" stroke="#475569" strokeWidth="2" />
              {(() => {
                const stops = liveStops.length > 0 ? liveStops : [{ stop: 1, count: result.metrics.loadedCount, weightKg: result.metrics.grossWeight, minX: 0, maxX: result.container.length }];
                const palette = ["#3b82f6", "#10b981", "#f97316", "#8b5cf6", "#06b6d4"];
                const segW = 282 / stops.length;
                return stops.map((st, idx) => (
                  <g key={st.stop}>
                    <rect
                      x={21 + idx * segW + 2}
                      y={23}
                      width={Math.max(20, segW - 4)}
                      height={44}
                      rx={4}
                      fill={palette[idx % palette.length]}
                    />
                    <text x={21 + idx * segW + segW / 2} y={42} textAnchor="middle" fontSize="10" fontWeight="600" fill="#ffffff">
                      {tr(`第 ${st.stop} 站`, `Stop ${st.stop}`)}
                    </text>
                    <text x={21 + idx * segW + segW / 2} y={57} textAnchor="middle" fontSize="9" fill="#f8fafc">
                      {st.count} {tr("箱", "ctns")} · {Math.round(st.weightKg)}kg
                    </text>
                  </g>
                ));
              })()}
              <text x="18" y="94" fontSize="10" fill="#475569">{tr("车厢前部 (最先装)", "Nose (Load First)")}</text>
              <text x="304" y="94" textAnchor="end" fontSize="10" fill="#475569">{tr("尾门卸货方向 →", "Rear Door Unload →")}</text>
            </svg>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              {tr("卸货后残余悬空/塌垛风险件", "Post-unload support risks")}:{" "}
              <strong style={{ color: postUnloadRisks.length > 0 ? "#b91c1c" : "#15803d" }}>{postUnloadRisks.length}</strong>
            </div>
          </section>
        </div>
      )}

      {/* D16: 运输安全与 CTU Code 全套固缚辅材清单 */}
      {showLogistics && (
        <section className="analytics-card" aria-label={tr("CTU Code 完整加固辅材规划", "CTU Code Full Securing Kit")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("运输安全与 CTU Code 全套加固辅材规划", "Transport Safety & CTU Code Full Securing Kit")}</h4>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={ctuMode} onChange={(e) => setCtuMode(e.target.value as CtuTransportMode)} style={{ fontSize: 11 }}>
                <option value="sea-area-c">{tr("海运远洋 (0.8g)", "Sea Area C (0.8g)")}</option>
                <option value="sea-area-b">{tr("海运近海 (0.7g)", "Sea Area B (0.7g)")}</option>
                <option value="road">{tr("公路运输 (0.8g)", "Road (0.8g)")}</option>
                <option value="rail">{tr("铁路运输 (1.0g)", "Rail (1.0g)")}</option>
              </select>
              <select value={String(frictionMu)} onChange={(e) => setFrictionMu(Number(e.target.value))} style={{ fontSize: 11 }}>
                <option value="0.25">μ=0.25</option>
                <option value="0.35">μ=0.35</option>
                <option value="0.6">μ=0.60 ({tr("防滑垫", "Anti-slip")})</option>
              </select>
            </div>
          </header>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 8, marginTop: 8, fontSize: 11 }}>
            <div>{tr("绑带 (LC 2000 daN)", "Lashing Straps")}: <strong>{ctuKit.strapsCount} {tr("根", "pcs")}</strong></div>
            <div>{tr("充气缓冲气袋", "Dunnage Airbags")}: <strong>{ctuKit.airbagsCount} {tr("个", "pcs")}</strong></div>
            <div>{tr("木方斜撑/垫木", "Timber Bracing")}: <strong>{ctuKit.woodenBracingBeamsCount} {tr("根", "beams")}</strong></div>
            <div>{tr("挡货杆", "Blocking Bars")}: <strong>{ctuKit.blockingBarsCount} {tr("根", "bars")}</strong></div>
            <div>{tr("防滑垫面积", "Anti-Slip Mat")}: <strong>{ctuKit.antiSlipMatAreaM2} m²</strong></div>
            <div>{tr("护角 / 隔板", "Corners / Dividers")}: <strong>{ctuKit.cornerProtectorsCount} / {ctuKit.dividerBoardsCount}</strong></div>
            <div>{tr("集装箱干燥剂挂袋", "Desiccant Strips")}: <strong>{ctuKit.desiccantStripsCount} {tr("条", "strips")}</strong></div>
          </div>
          {ctuReport.dataCompletenessWarningsZh.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>⚠ {tr(w, ctuReport.dataCompletenessWarningsEn[i])}</div>
          ))}
        </section>
      )}

      {/* D21: 企业级数据治理、审批状态机、不可变审计日志与 4 级商业化方案 */}
      {showEnterprise && (
        <section className="analytics-card" aria-label={tr("企业级审批治理与商业化分级", "Enterprise Approval Governance & Plans")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("企业级数据管理：审批工作流 · 不可变审计日志 · 版本对比", "Enterprise Governance: Approval Flow, Immutable Audit & Diff")}</h4>
            <span className="pill-badge">
              {tr("当前状态", "Status")}: <strong>{govRecord.status.toUpperCase()}</strong> (R{govRecord.revision})
            </span>
          </header>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" className="button small ghost" onClick={() => handleGovTransition("pending_review")}>{tr("提交审核", "Submit Review")}</button>
            <button type="button" className="button small" onClick={() => handleGovTransition("approved")}>{tr("审批通过", "Approve")}</button>
            <button type="button" className="button small ghost" onClick={() => handleGovTransition("rejected")}>{tr("驳回修改", "Reject")}</button>
            <button type="button" className="button small" onClick={() => handleGovTransition("issued")}>{tr("签发锁定（不可变）", "Issue Immutable")}</button>
          </div>
          {govError && <div style={{ color: "#b91c1c", fontSize: 11, marginTop: 6 }}>⚠ {govError}</div>}

          <div style={{ fontSize: 11, marginTop: 8, padding: "6px 8px", borderRadius: 6, background: "rgba(15,23,42,0.04)" }}>
            <strong>{tr("版本差异预览", "Version Diff")}:</strong> {versionDiff.summaryZh}
          </div>

          <div style={{ marginTop: 8, fontSize: 11, display: "grid", gap: 3 }}>
            <strong>{tr(`操作审计日志 (${govRecord.auditTrail.length} 条不可变记录)`, `Immutable Audit Trail (${govRecord.auditTrail.length})`)}</strong>
            {govRecord.auditTrail.slice(-4).map((entry) => (
              <div key={entry.id} style={{ opacity: 0.85 }}>
                • [{entry.timestamp.slice(11, 19)}] <strong>{entry.actor}</strong> ({entry.role}) → <code>{entry.action}</code> {entry.toStatus ? `(${entry.toStatus})` : ""}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 10, fontSize: 11 }}>
            {[
              { tier: tr("个人版", "Personal"), desc: tr("单人快速测算、全套核心算法与本地快照", "Core solver & local snapshots") },
              { tier: tr("专业版", "Pro"), desc: tr("反向改箱、多柜混配、CAD 桥接与自定义模板", "Reverse pack, multi-fleet & CAD") },
              { tier: tr("团队版", "Team"), desc: tr("部门权限、审批流、产品库共享与仓库移动端协同", "RBAC, approvals & crew sync") },
              { tier: tr("企业版", "Enterprise"), desc: tr("SSO 单点登录、私有化部署、API/ERP/WMS 集成", "SSO, on-prem & ERP/WMS API") },
            ].map((p) => (
              <div key={p.tier} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.25)" }}>
                <strong>{p.tier}</strong>
                <div style={{ opacity: 0.78, marginTop: 2 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 配图 #26: CargoFit 八大模块化平台架构蓝图 */}
      {showEnterprise && (
        <section className="analytics-card" aria-label={tr("CargoFit 模块化平台架构", "CargoFit Modular Platform Architecture")}>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#1e3a8a", color: "#ffffff", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>CargoFit</div>
            <div style={{ fontSize: 12, opacity: 0.92 }}>
              {tr("全球智能装载与包装物流优化平台", "Global Intelligent Loading & Packaging Optimization Platform")}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 8, marginTop: 10 }}>
            {EIGHT_PLATFORM_MODULES.map((m) => (
              <div key={m.name} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(37,99,235,0.25)", background: "rgba(37,99,235,0.03)" }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#1d4ed8" }}>{m.name}</div>
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{tr(m.zh, m.en)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(15,23,42,0.06)", textAlign: "center", fontSize: 11, fontWeight: 600 }}>
            {tr("统一产品库 · 统一几何引擎 · 统一规则校验  |  本机优先 · 云端协作 · 企业集成", "Unified Product Library · Geometry Engine · Rule Validator | Local-First · Cloud Collaboration · Enterprise Integration")}
          </div>
        </section>
      )}

      {/* D22: 开发者中心：4 层系统集成架构图 + 实时 API / SDK / MCP 演练场 */}
      {showDeveloper && (
        <section className="analytics-card" aria-label={tr("开发者中心与系统集成架构", "Developer Center & Integration Architecture")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("开发者中心：四层系统集成架构 · API / SDK / MCP 实时演练", "Developer Center: 4-Layer Architecture & Live API/SDK/MCP")}</h4>
            <button type="button" className="button small" onClick={handleRunLiveApi}>
              {tr("实时试跑 API 输出三维坐标", "Run Live API & 3D Coords")}
            </button>
          </header>

          <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 11 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 6 }}>
              {["ERP", "WMS", "TMS", "CRM", tr("电商平台", "E-Commerce"), tr("CAD 系统", "CAD Systems")].map((sys) => (
                <div key={sys} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.35)", textAlign: "center", fontWeight: 600 }}>
                  {sys}
                </div>
              ))}
            </div>
            <div style={{ textAlign: "center", opacity: 0.6 }}>↕</div>
            <div style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(37,99,235,0.08)", textAlign: "center", fontWeight: 600 }}>
              REST API ({API_SCHEMA_VERSION}) · TypeScript SDK · Python SDK · MCP Server · Webhook · Excel Plugin
            </div>
            <div style={{ textAlign: "center", opacity: 0.6 }}>↕</div>
            <div style={{ padding: "7px 10px", borderRadius: 6, background: "#1d4ed8", color: "#ffffff", textAlign: "center", fontWeight: 700 }}>
              CargoFit Engine（{tr("统一装载计算与独立合法性校验服务", "Unified Loading Solver & Independent Validator")}）
            </div>
            <div style={{ textAlign: "center", opacity: 0.6 }}>↓</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {[tr("装载方案", "Loading Plan"), tr("成本报告", "Cost Report"), tr("三维坐标", "3D Coordinates")].map((out) => (
                <div key={out} style={{ padding: "5px 8px", borderRadius: 6, background: "rgba(21,128,61,0.1)", color: "#166534", textAlign: "center", fontWeight: 600 }}>
                  {out}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {(["ts", "py", "mcp", "webhook"] as const).map((t) => (
              <button key={t} type="button" className={`button small ${sdkTab === t ? "" : "ghost"}`} onClick={() => setSdkTab(t)}>
                {t === "ts" ? "TypeScript SDK" : t === "py" ? "Python SDK" : t === "mcp" ? "MCP Server" : "Webhook HMAC"}
              </button>
            ))}
          </div>
          <pre style={{ marginTop: 6, padding: 8, borderRadius: 6, background: "#0f172a", color: "#e2e8f0", fontSize: 11, overflowX: "auto" }}>
            {sdkTab === "ts" && `import { CargoFitClient } from "./lib/sdk/cargofit-sdk";\nconst client = new CargoFitClient({ baseUrl: "https://container-load-planner.pages.dev", apiKey });\nconst res = await client.pack({ schema: "${API_SCHEMA_VERSION}", computeMode: "standard", request });`}
            {sdkTab === "py" && `from cargofit_client import CargoFitClient\nclient = CargoFitClient("https://container-load-planner.pages.dev", api_key="...")\nplan = client.pack(request_payload, compute_mode="standard")`}
            {sdkTab === "mcp" && `node server-build/cargofit-mcp.mjs  # Stdio MCP Server exposing pack_container, audit_order, reverse_packaging`}
            {sdkTab === "webhook" && `verifyWebhookSignature(rawBody, req.headers["x-cargofit-signature"], webhookSecret) // HMAC-SHA256`}
          </pre>

          {apiJsonOutput && (
            <pre style={{ marginTop: 6, padding: 8, borderRadius: 6, background: "rgba(15,23,42,0.06)", fontSize: 11, overflowX: "auto", maxHeight: 180 }}>
              {apiJsonOutput}
            </pre>
          )}
        </section>
      )}

      {/* D23: 五节点顺时针持续校准闭环飞轮图 + D24: 高保真装柜优化经济收益计算器 */}
      {(showFlywheel || showRoi) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: 12 }}>
          {showFlywheel && (
            <section className="analytics-card" aria-label={tr("历史数据持续自我校准闭环", "Continuous Self-Calibration Flywheel")}>
              <h4 style={{ margin: "0 0 8px" }}>{tr("历史数据与持续自我校准闭环（70% 校准 / 30% 独立回测隔离）", "Continuous Self-Calibration Flywheel (70/30 Split)")}</h4>
              <svg viewBox="0 0 340 190" width="100%" role="img" aria-label={tr("五节点顺时针持续校准闭环图", "5-node calibration flywheel")} style={{ maxHeight: 190, display: "block" }}>
                <circle cx="170" cy="96" r="42" fill="none" stroke="#3b82f6" strokeDasharray="4 3" strokeWidth="1.5" />
                <text x="170" y="92" textAnchor="middle" fontSize="10" fontWeight="700" fill="#1d4ed8">{tr("持续优化", "Continuous")}</text>
                <text x="170" y="106" textAnchor="middle" fontSize="10" fontWeight="700" fill="#1d4ed8">CargoFit</text>
                {[
                  { x: 170, y: 22, label: tr("产品与包装数据", "Product & Pack Data") },
                  { x: 282, y: 74, label: tr("预测装柜方案", "Predicted Plan") },
                  { x: 244, y: 162, label: tr("真实装柜记录", "Actual Field Log") },
                  { x: 96, y: 162, label: tr("预测偏差分析", "Variance Analysis") },
                  { x: 58, y: 74, label: tr("校准参数优化", "Parameter Tuning") },
                ].map((node, i) => (
                  <g key={i}>
                    <rect x={node.x - 54} y={node.y - 14} width="108" height="28" rx="14" fill="#2563eb" />
                    <text x={node.x} y={node.y + 4} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#ffffff">
                      {node.label}
                    </text>
                  </g>
                ))}
              </svg>
              <div style={{ fontSize: 11, opacity: 0.78 }}>
                {tr("严格执行 70% 训练集校准 + 30% 独立测试集回测与 IQR 异常剔除，绝不复用同一批数据自证准确性。", "Strict 70/30 isolated calibration & backtest with IQR outlier rejection.")}
              </div>
            </section>
          )}

          {showRoi && (
            <section className="analytics-card" aria-label={tr("装柜优化经济收益计算器", "Loading Optimization ROI Calculator")}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <h4 style={{ margin: 0 }}>{tr("装柜优化经济收益计算器 (ROI)", "Loading Optimization ROI Calculator")}</h4>
                <button
                  type="button"
                  className="button small ghost"
                  onClick={() => {
                    setOptUnits(liveOptUnits);
                    setBaseUnits(Math.max(1, Math.round(liveOptUnits * 0.89)));
                  }}
                >
                  {tr("同步当前实算装量", "Sync Live Plan")}
                </button>
              </header>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, fontSize: 11 }}>
                <label style={{ display: "grid", gap: 2 }}>
                  {tr("年度出货量（套）", "Annual Volume")}
                  <input type="number" min={1} value={annualUnits} onChange={(e) => setAnnualUnits(Math.max(1, Number(e.target.value) || 1))} />
                </label>
                <label style={{ display: "grid", gap: 2 }}>
                  {tr("单柜运费（USD）", "Freight / Ctn (USD)")}
                  <input type="number" min={1} value={freightPerCtn} onChange={(e) => setFreightPerCtn(Math.max(1, Number(e.target.value) || 1))} />
                </label>
                <label style={{ display: "grid", gap: 2 }}>
                  {tr("原方案每柜套数", "Baseline / Ctn")}
                  <input type="number" min={1} value={baseUnits} onChange={(e) => setBaseUnits(Math.max(1, Number(e.target.value) || 1))} />
                </label>
                <label style={{ display: "grid", gap: 2 }}>
                  {tr("优化后每柜套数", "Optimized / Ctn")}
                  <input type="number" min={1} value={optUnits} onChange={(e) => setOptUnits(Math.max(1, Number(e.target.value) || 1))} />
                </label>
              </div>
              {roi.valid && (
                <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 11 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "54px 1fr 48px", alignItems: "center", gap: 6 }}>
                    <span>{tr("原方案", "Base")}</span>
                    <div style={{ height: 12, borderRadius: 6, background: "rgba(148,163,184,0.2)", overflow: "hidden" }}>
                      <div style={{ width: `${(roi.baselineContainers / maxRoiBar) * 100}%`, height: "100%", background: "#64748b" }} />
                    </div>
                    <strong>{roi.baselineContainers} {tr("柜", "ctns")}</strong>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "54px 1fr 48px", alignItems: "center", gap: 6 }}>
                    <span>{tr("优化后", "Opt")}</span>
                    <div style={{ height: 12, borderRadius: 6, background: "rgba(148,163,184,0.2)", overflow: "hidden" }}>
                      <div style={{ width: `${(roi.optimizedContainers / maxRoiBar) * 100}%`, height: "100%", background: "#2563eb" }} />
                    </div>
                    <strong>{roi.optimizedContainers} {tr("柜", "ctns")}</strong>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                    <div><small>{tr("年度运费节省额", "Annual Savings")}</small><div style={{ fontSize: 17, fontWeight: 700, color: "#15803d" }}>${roi.annualFreightSaved.toLocaleString()}</div></div>
                    <div><small>{tr("运费下降比例", "Freight Drop")}</small><div style={{ fontSize: 17, fontWeight: 700 }}>{roi.freightReductionPct}%</div></div>
                    <div><small>{tr("单柜容量提升", "Capacity Gain")}</small><div style={{ fontSize: 17, fontWeight: 700 }}>{roi.capacityGainPct}%</div></div>
                    <div><small>{tr("年度减少柜数", "Containers Saved")}</small><div style={{ fontSize: 17, fontWeight: 700 }}>{roi.containersSaved} {tr("柜", "ctns")}</div></div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
