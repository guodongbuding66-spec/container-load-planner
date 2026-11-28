"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookmarkPlus,
  Bot,
  Columns2,
  Download,
  History,
  Layers,
  MapPin,
  PackagePlus,
  Ruler,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { ROLE_WORKBENCH_CARDS, V21EngineeringSuites } from "./v21-engineering-suites";
import type { RoleWorkbenchPreset } from "./v3-visual-suites";
import {
  analyzeFactoryCalibrationV2,
  buildPlanSnapshot,
  FIELD_CALIBRATION_STORAGE_KEY,
  parseCrewAuditCsv,
  PLAN_SNAPSHOTS_STORAGE_KEY,
  summarizeFieldCalibration,
  type FieldFeedbackRecord,
  type PlanSnapshotEntry,
} from "../lib/packing/field-calibration";
import {
  auditCartonBct,
  ENVIRONMENT_PROFILES,
  FLUTE_GRADES,
  type EnvironmentProfileId,
  type FluteGradeId,
} from "../lib/packing/bct-estimator";
import { comparePackingPlans, planComparisonToCsv } from "../lib/packing/plan-comparator";
import { auditMultiStopLifo, multiStopReportToCsv } from "../lib/packing/multi-stop-auditor";
import {
  askCargoFitCopilot,
  COPILOT_SUGGESTIONS,
  type CopilotAnswer,
} from "../lib/packing/copilot-assistant";
import {
  computePackagingBom,
  DEFAULT_PACKAGING_BOM_CONFIG,
  packagingBomToCsv,
  type PackagingBomConfig,
} from "../lib/packing/packaging-bom";
import { recommendCatalogGapFill } from "../lib/packing/catalog-gap-recommender";
import {
  DEFAULT_REVERSE_RANGE,
  runReversePackagingOptimizer,
  type ReversePackagingReport,
} from "../lib/packing/reverse-packaging-optimizer";
import { auditOrderInputs, autoFixOrderInputs } from "../lib/packing/order-data-auditor";
import type { ContainerSpec, PackingResult, ProductInput } from "../lib/packing/types";
import { tr, useLanguage } from "./language";

const orderUnitReviewKey = (p: ProductInput) => JSON.stringify([p.id, p.sku, p.length, p.width, p.height]);

const ROLE_STORAGE_KEY = "cargofit.workbench.rolePreset";

export function EngineeringAnalyticsPanel({
  plan,
  products,
  onAdoptPlan,
  onApplyQuantities,
  onReplaceProducts,
  onSelectContainerPreset,
}: {
  plan: PackingResult;
  products: readonly ProductInput[];
  onAdoptPlan?: (next: PackingResult) => void;
  onApplyQuantities?: (updates: Record<string, number>) => void;
  onReplaceProducts?: (next: ProductInput[], note?: string) => void;
  onSelectContainerPreset?: (spec: ContainerSpec) => void;
}) {
  useLanguage();

  // Hoisted 6-Role Workbench Preset (controls ALL sections cleanly — zero duplicate panels)
  const [rolePreset, setRolePreset] = useState<RoleWorkbenchPreset>(() => {
    if (typeof window === "undefined") return "pro";
    try {
      const saved = window.localStorage.getItem(ROLE_STORAGE_KEY) as RoleWorkbenchPreset | null;
      if (saved && ROLE_WORKBENCH_CARDS.some((c) => c.id === saved)) return saved;
    } catch {}
    return "pro";
  });

  const handleRoleChange = (next: RoleWorkbenchPreset) => {
    setRolePreset(next);
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, next);
    } catch {}
  };

  // D11: Order Data Sanity Audit & Safe Auto-Fixer
  const orderAudit = useMemo(
    () => auditOrderInputs(products, plan.container, plan.clearance),
    [plan.clearance, plan.container, products],
  );
  const [confirmedCmRows, setConfirmedCmRows] = useState<Record<string, string>>({});
  const suspectedCmRows = products.filter(p => !p.solidModel && (!p.cargoShape || p.cargoShape === "box") && Math.max(p.length,p.width,p.height) < 80 && orderAudit.issues.some(i => i.code === "unit_mismatch_suspected" && i.productId === p.id));
  const autoFixPreview = useMemo(() => autoFixOrderInputs(products, products.filter(p => confirmedCmRows[p.id] === orderUnitReviewKey(p)).map(p => p.id)), [products, confirmedCmRows]);
  const [autoFixNotice, setAutoFixNotice] = useState<string>("");

  // D12: Deterministic Engine-Backed CargoFit Smart Copilot
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotAnswer, setCopilotAnswer] = useState<CopilotAnswer | null>(null);

  // D03: Multi-Axis Reverse Packaging Optimizer (with SKU selector + one-click apply)
  const [revTargetSkuIdx, setRevTargetSkuIdx] = useState(0);
  const [revReport, setRevReport] = useState<ReversePackagingReport | null>(null);
  const [revAppliedNotice, setRevAppliedNotice] = useState("");

  // D04: 6-Level Packaging BOM & Cost Rollup
  const [bomCfg, setBomCfg] = useState<PackagingBomConfig>(DEFAULT_PACKAGING_BOM_CONFIG);
  const bomReport = useMemo(() => computePackagingBom(plan, products, bomCfg), [plan, products, bomCfg]);

  // D08: Corrugated Carton BCT & Crush Risk Auditor
  const [fluteGrade, setFluteGrade] = useState<FluteGradeId>("bc-double");
  const [envProfile, setEnvProfile] = useState<EnvironmentProfileId>("ocean-30d");
  const bctReport = useMemo(() => auditCartonBct(plan, fluteGrade, envProfile), [plan, fluteGrade, envProfile]);

  // D10: 3D Residual Void Catalog Gap-Fill Recommender
  const gapFillReport = useMemo(() => recommendCatalogGapFill(plan, products, 6), [plan, products]);
  const [gapAppliedNotice, setGapAppliedNotice] = useState("");

  // D15: Multi-Stop LIFO Per-SKU Editor
  const uniqueSkus = useMemo(() => {
    const map = new Map<string, { productId: string; sku: string; count: number }>();
    for (const p of plan.placements) {
      const cur = map.get(p.productId);
      if (cur) cur.count += 1;
      else map.set(p.productId, { productId: p.productId, sku: p.sku, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [plan.placements]);

  const [stopOverrides, setStopOverrides] = useState<Record<string, number>>({});
  const effectiveStopMap = useMemo(() => {
    const out: Record<string, number> = {};
    uniqueSkus.forEach((item, idx) => {
      out[item.productId] = stopOverrides[item.productId] ?? (uniqueSkus.length > 1 && idx > 0 ? 2 : 1);
    });
    return out;
  }, [uniqueSkus, stopOverrides]);
  const lifoReport = useMemo(() => auditMultiStopLifo(plan, effectiveStopMap), [plan, effectiveStopMap]);

  // D19: Dual-Strategy Side-by-Side Comparison
  const dualComparison = useMemo(() => {
    const p = plan.strategyPlans?.practical;
    const m = plan.strategyPlans?.maximum;
    if (!p || !m) return null;
    return comparePackingPlans(p, m);
  }, [plan.strategyPlans]);

  // D23: Field Actuals Feedback & 70/30 Calibration Backtest + Local Snapshots
  const currentPerContainer = Math.max(1, plan.metrics.loadedCount);
  const [fieldRecords, setFieldRecords] = useState<FieldFeedbackRecord[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(FIELD_CALIBRATION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [fbContainerNo, setFbContainerNo] = useState("");
  const [fbActualCartons, setFbActualCartons] = useState(String(currentPerContainer));
  const [fbActualWeight, setFbActualWeight] = useState("");
  const [fbNote, setFbNote] = useState("");

  const [snapshots, setSnapshots] = useState<PlanSnapshotEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(PLAN_SNAPSHOTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [snapLabel, setSnapLabel] = useState("");

  const persistFieldRecords = (next: FieldFeedbackRecord[]) => {
    setFieldRecords(next);
    try {
      localStorage.setItem(FIELD_CALIBRATION_STORAGE_KEY, JSON.stringify(next.slice(0, 50)));
    } catch {}
  };
  const persistSnapshots = (next: PlanSnapshotEntry[]) => {
    setSnapshots(next);
    try {
      localStorage.setItem(PLAN_SNAPSHOTS_STORAGE_KEY, JSON.stringify(next.slice(0, 20)));
    } catch {}
  };

  const calibrationSummary = useMemo(() => summarizeFieldCalibration(fieldRecords), [fieldRecords]);
  const calV2Report = useMemo(() => analyzeFactoryCalibrationV2(fieldRecords), [fieldRecords]);

  const downloadBlob = (content: string, mime: string, filename: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddProduct = (prod: ProductInput) => {
    if (!onReplaceProducts) return;
    onReplaceProducts([...products, prod], tr(`已新增 CAD 货物「${prod.sku}」`, `Added CAD SKU "${prod.sku}"`));
  };

  const showCopilot = rolePreset === "quick" || rolePreset === "pro" || rolePreset === "packaging" || rolePreset === "enterprise";
  const showPackagingDeep = rolePreset === "pro" || rolePreset === "packaging";
  const showGapFill = rolePreset === "quick" || rolePreset === "pro";
  const showLifoEditor = rolePreset === "pro" || rolePreset === "field";
  const showDualCompare = rolePreset === "quick" || rolePreset === "pro";
  const showFieldCal = rolePreset === "pro" || rolePreset === "field" || rolePreset === "enterprise";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Top 6-Role Workbench Selector (Master Complexity Isolation) */}
      <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("六大角色专业工作台矩阵", "6 Role Workbench Matrix")}>
        <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{tr("六大角色专业工作台（按岗位隔离模块复杂度）", "Six Role-Based Workbenches (Role Complexity Isolation)")}</h3>
          <span className="pill-badge">
            {tr("当前角色", "Active Role")}: <strong>{rolePreset.toUpperCase()}</strong>
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
          {ROLE_WORKBENCH_CARDS.map((card) => {
            const active = rolePreset === card.id;
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={active}
                onClick={() => handleRoleChange(card.id)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: active ? "2px solid #2563eb" : "1px solid var(--border-subtle, rgba(148,163,184,0.3))",
                  background: active ? "rgba(37,99,235,0.08)" : "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
                  <span>{tr(card.titleZh, card.titleEn)}</span>
                  <span style={{ fontSize: 10, opacity: 0.72 }}>{tr(card.audienceZh, card.audienceEn)}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 3 }}>{tr(card.descZh, card.descEn)}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* D11: Order Data Sanity Audit & One-Click Auto-Fixer Banner */}
      {(!orderAudit.healthy || autoFixNotice) && (
        <section className="v1-panel" style={{ marginTop: 0, borderColor: "rgba(217,119,6,0.45)" }} aria-label={tr("订单数据智能体检与纠错", "Order Data Sanity Auditor")}>
          <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <AlertTriangle size={16} aria-hidden="true" />
              {tr(
                `订单数据智能体检：发现 ${orderAudit.errorCount} 项错误 · ${orderAudit.warnCount} 项预警`,
                `Order Data Audit: ${orderAudit.errorCount} error(s) · ${orderAudit.warnCount} warning(s)`,
              )}
            </h3>
            {autoFixPreview.fixCount > 0 && onReplaceProducts && (
              <button
                type="button"
                className="button small primary"
                onClick={() => {
                  onReplaceProducts(
                    autoFixPreview.fixedProducts,
                    tr(`已应用 ${autoFixPreview.fixCount} 项预览修正，请重新计算装柜。`, `Applied ${autoFixPreview.fixCount} reviewed order data fixes; recalculate to verify.`),
                  );
                  setAutoFixNotice(tr(autoFixPreview.changesZh.join("；"), autoFixPreview.changesEn.join("; ")));
                }}
              >
                {tr(`应用预览修正 (${autoFixPreview.fixCount} 项)`, `Apply reviewed fixes (${autoFixPreview.fixCount})`)}
              </button>
            )}
          </div>
          {orderAudit.issues.slice(0, 4).map((iss) => (
            <div key={iss.id} style={{ fontSize: 12, color: iss.severity === "error" ? "#b91c1c" : "#b45309", marginBottom: 3 }}>
              • {tr(iss.messageZh, iss.messageEn)}
            </div>
          ))}
          {suspectedCmRows.map(p => <label key={p.id} style={{display:"flex",alignItems:"flex-start",gap:8,marginTop:8,fontSize:13}}>
            <input type="checkbox" checked={confirmedCmRows[p.id] === orderUnitReviewKey(p)} onChange={e => setConfirmedCmRows(previous => ({...previous,[p.id]:e.target.checked ? orderUnitReviewKey(p) : ""}))}/>
            <span>{tr(`${p.sku}：我已核对原始单位为厘米（cm），同意将本行三边乘10转换为毫米。`, `${p.sku}: I checked the original unit is cm; convert this row's three dimensions ×10 to mm.`)}</span>
          </label>)}
          {autoFixPreview.fixCount > 0 && <div className="helper-text" style={{marginTop:8}}><strong>{tr("待应用的改动预览", "Proposed changes")}</strong><ul>{autoFixPreview.changesZh.map((text,index) => <li key={index}>{tr(text, autoFixPreview.changesEn[index])}</li>)}</ul></div>}
          {autoFixNotice && <div style={{ fontSize: 12, color: "#15803d", fontWeight: 600, marginTop: 4 }}>✓ {autoFixNotice}</div>}
        </section>
      )}

      {/* D12: CargoFit AI Copilot (Reference Diagram #14 — 4 ↗ Quick Prompts + Deterministic Engine) */}
      {showCopilot && (
        <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("智能装柜诊断助手", "CargoFit Smart Copilot")}>
          <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Bot size={16} aria-hidden="true" />
              {tr("CargoFit AI 智能装柜助手（确定性引擎实时求解）", "CargoFit AI Copilot (Deterministic Engine)")}
            </h3>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {tr("零大模型猜测 · 100% 离线实时算得", "Zero LLM guessing · 100% deterministic")}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6, marginBottom: 10 }}>
            {COPILOT_SUGGESTIONS.map((s) => (
              <button
                key={s.intent}
                type="button"
                className="button small ghost"
                style={{ justifyContent: "space-between", textAlign: "left" }}
                onClick={() => {
                  const q = tr(s.promptZh, s.promptEn);
                  setCopilotInput(q);
                  setCopilotAnswer(askCargoFitCopilot(q, plan, products, 3500));
                }}
              >
                <span>{tr(s.promptZh, s.promptEn)}</span>
                <span aria-hidden="true" style={{ opacity: 0.65 }}>↗</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input
              type="text"
              aria-label={tr("输入装柜优化需求", "Ask a load-planning question")}
              value={copilotInput}
              onChange={(e) => setCopilotInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && copilotInput.trim()) {
                  setCopilotAnswer(askCargoFitCopilot(copilotInput, plan, products, 3500));
                }
              }}
              placeholder={tr("输入装柜优化需求（如：用几个高柜最划算 / 保持原订单尽量减托 / 改箱多装一层）...", "Ask about 40HQ count, pallet reduction, shortfall, carton resizing, or safety...")}
              style={{ flex: "1 1 240px", minWidth: 0, padding: "7px 10px", fontSize: 13 }}
            />
            <button
              type="button"
              className="button small primary"
              onClick={() => {
                const q = copilotInput.trim() || tr("全面概览当前方案", "Overview current plan");
                setCopilotAnswer(askCargoFitCopilot(q, plan, products, 3500));
              }}
            >
              {tr("运行引擎诊断 ↑", "Run Diagnostic ↑")}
            </button>
          </div>
          {copilotAnswer && (
            <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)" }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>
                {tr(copilotAnswer.summaryZh, copilotAnswer.summaryEn)}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 8 }}>
                {copilotAnswer.metrics.map((m, idx) => (
                  <div key={idx} style={{ padding: "6px 8px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{tr(m.labelZh, m.labelEn)}</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 12 }}>
                {(tr("zh", "en") === "zh" ? copilotAnswer.bulletsZh : copilotAnswer.bulletsEn).map((b, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{b}</li>
                ))}
              </ul>
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>
                {tr(copilotAnswer.disclaimerZh, copilotAnswer.disclaimerEn)} ({copilotAnswer.engineModules.join(" · ")})
              </p>
            </div>
          )}
        </section>
      )}

      {/* Unified V3 Visual, Ops, Enterprise & Developer Suites (Zero Duplicates, Controlled by Master Role) */}
      <V21EngineeringSuites
        result={plan}
        products={products}
        controlledRole={rolePreset}
        onRoleChange={handleRoleChange}
        hideRoleMatrix
        onAdoptPlan={onAdoptPlan}
        onAddProduct={handleAddProduct}
        onSelectContainerPreset={onSelectContainerPreset}
        tr={tr}
      />

      {/* D03: Multi-Axis Reverse Packaging & Carton Dimension Optimizer (With One-Click Apply to Order) */}
      {showPackagingDeep && (
        <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("多轴反向包装尺寸与包材海运综合优化", "Multi-Axis Reverse Packaging Optimizer")}>
          <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Ruler size={16} aria-hidden="true" />
              {tr("反向优化产品与纸箱尺寸（单轴 + 多轴联合真实 3D 求解 + 一键改箱）", "Multi-Axis Reverse Packaging & Freight ROI Optimizer")}
            </h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <select
                aria-label={tr("选择反推目标 SKU", "Target SKU")}
                value={revTargetSkuIdx}
                onChange={(e) => setRevTargetSkuIdx(Number(e.target.value))}
                style={{ fontSize: 12 }}
              >
                {products.map((p, idx) => (
                  <option key={p.id} value={idx}>{p.sku} ({p.length}×{p.width}×{p.height})</option>
                ))}
              </select>
              <button
                type="button"
                className="button small primary"
                onClick={() => {
                  const target = products[Math.min(revTargetSkuIdx, Math.max(0, products.length - 1))];
                  if (!target) return;
                  setRevAppliedNotice("");
                  setRevReport(
                    runReversePackagingOptimizer(
                      products,
                      plan.container,
                      plan.clearance,
                      target.id,
                      DEFAULT_REVERSE_RANGE,
                      { annualShippedCartons: Math.max(1000, currentPerContainer * 25), freightPerContainerUsd: 3500, corrugatedUsdPerM2: 1.15 },
                      "maximum",
                    ),
                  );
                }}
              >
                {tr("运行多轴反推优化", "Run Multi-Axis Search")}
              </button>
            </div>
          </div>
          {!revReport ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {tr("在长宽高允许公差区间内自动执行单轴 + 多轴联合真实 3D 求解，同时核算瓦楞纸板面积变化与年度省柜净收益。", "Searches single & multi-axis carton tolerances via the real 3D solver, balancing corrugated board cost against annual container savings.")}
            </p>
          ) : (
            <div>
              <p style={{ fontSize: 12, margin: "0 0 8px", color: "var(--text-muted)" }}>
                {tr(
                  `目标 SKU：${revReport.targetSku}（原尺寸 ${revReport.originalDimsMm.join("×")} mm，原装量 ${revReport.baselineLoadedCount} 箱）· 实测 ${revReport.candidatesEvaluated} 组候选`,
                  `Target: ${revReport.targetSku} (${revReport.originalDimsMm.join("×")} mm, baseline ${revReport.baselineLoadedCount}) · ${revReport.candidatesEvaluated} candidates tested`,
                )}
              </p>
              <div className="v1-table-scroll">
                <table className="v1-table">
                  <thead>
                    <tr>
                      <th>{tr("建议新尺寸 (mm)", "Proposed (mm)")}</th>
                      <th className="num">{tr("装量变化", "Cartons")}</th>
                      <th className="num">{tr("利用率", "Vol %")}</th>
                      <th className="num">{tr("年省柜", "Ctnrs Saved")}</th>
                      <th className="num">{tr("年净收益 (含包材)", "Net Benefit")}</th>
                      {onReplaceProducts && <th>{tr("闭环操作", "Action")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {revReport.topCandidates.slice(0, 6).map((c) => (
                      <tr key={c.id}>
                        <td>{c.proposedDimsMm.join(" × ")} ({c.deltasMm.map((d) => (d >= 0 ? `+${d}` : `${d}`)).join("/")})</td>
                        <td className="num">{c.loadedCount} ({c.gainCartons >= 0 ? `+${c.gainCartons}` : c.gainCartons})</td>
                        <td className="num">{c.volumeUtilPct}%</td>
                        <td className="num">{c.annualContainersSaved}</td>
                        <td className="num">${c.netAnnualBenefitUsd.toLocaleString("en-US")}</td>
                        {onReplaceProducts && (
                          <td>
                            <button
                              type="button"
                              className="button small"
                              onClick={() => {
                                const [nL, nW, nH] = c.proposedDimsMm;
                                const next = products.map((p) =>
                                  p.sku === revReport.targetSku ? { ...p, length: nL, width: nW, height: nH } : p,
                                );
                                onReplaceProducts(
                                  next,
                                  tr(
                                    `已将「${revReport.targetSku}」外箱尺寸更新为 ${nL}×${nW}×${nH} mm，请重新计算装柜验证 3D 终验。`,
                                    `Updated ${revReport.targetSku} dimensions to ${nL}×${nW}×${nH} mm; recalculate to verify in 3D.`,
                                  ),
                                );
                                setRevAppliedNotice(
                                  tr(`已采用 ${revReport.targetSku} 新尺寸 ${nL}×${nW}×${nH} mm`, `Applied ${nL}×${nW}×${nH} mm to ${revReport.targetSku}`),
                                );
                              }}
                            >
                              {tr("采用箱规", "Apply Size")}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {revAppliedNotice && <div style={{ fontSize: 12, color: "#15803d", fontWeight: 600, marginTop: 6 }}>✓ {revAppliedNotice}</div>}
            </div>
          )}
        </section>
      )}

      {/* D04: Detailed 6-Level Packaging BOM Cost & Tare Rollup + CSV */}
      {showPackagingDeep && (
        <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("六级包装 BOM 与自重成本核算", "6-Level Packaging BOM & Cost Rollup")}>
          <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Layers size={16} aria-hidden="true" />
              {tr("多级包装 BOM 成本与周转包装分摊核算", "6-Level Packaging BOM & Reusable Tare Rollup")}
            </h3>
            <button
              type="button"
              className="button small ghost"
              onClick={() => downloadBlob(packagingBomToCsv(bomReport), "text/csv;charset=utf-8", "cargofit-packaging-bom.csv")}
            >
              <Download size={14} /> {tr("导出 BOM CSV", "Export BOM CSV")}
            </button>
          </div>
          <div className="v1-grid-3" style={{ marginBottom: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              <span>{tr("外箱单价 (USD)", "Carton Cost ($)")}</span>
              <input type="number" min={0} step={0.1} value={bomCfg.masterCartonCostUsd} onChange={(e) => setBomCfg((p) => ({ ...p, masterCartonCostUsd: Math.max(0, Number(e.target.value) || 0) }))} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              <span>{tr("托盘单价 (USD)", "Pallet Cost ($)")}</span>
              <input type="number" min={0} step={0.5} value={bomCfg.palletUnitCostUsd} onChange={(e) => setBomCfg((p) => ({ ...p, palletUnitCostUsd: Math.max(0, Number(e.target.value) || 0) }))} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              <span>{tr("循环周转次数", "Reusable Cycles")}</span>
              <input type="number" min={1} value={bomCfg.palletReuseCycles} onChange={(e) => setBomCfg((p) => ({ ...p, palletReuseCycles: Math.max(1, Number(e.target.value) || 1) }))} />
            </label>
          </div>
          <div className="v1-kpi-row">
            <div className="v1-kpi"><small>{tr("包材总自重", "Total Pack Tare")}</small><strong>{bomReport.totalPackagingTareKg.toFixed(1)} kg</strong></div>
            <div className="v1-kpi"><small>{tr("包材总费用", "Total Pack Cost")}</small><strong>${bomReport.totalPackagingCostPerContainerUsd.toFixed(2)}</strong></div>
            <div className="v1-kpi"><small>{tr("单箱摊销包材费", "Pack Cost / Ctn")}</small><strong>${bomReport.packagingCostPerCartonUsd.toFixed(2)}</strong></div>
            <div className="v1-kpi"><small>{tr("包材皮重占比", "Tare Share")}</small><strong>{bomReport.tareRatioPct.toFixed(1)}%</strong></div>
          </div>
        </section>
      )}

      {/* D08: Corrugated Carton BCT & Crush Risk Auditor */}
      {showPackagingDeep && (
        <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("瓦楞纸箱抗压与堆码压溃风险估算", "Corrugated Carton BCT & Crush Risk Estimator")}>
          <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ShieldCheck size={16} aria-hidden="true" />
              {tr("瓦楞纸箱抗压强度 (McKee BCT) 与堆码压溃风险审计", "Corrugated Carton BCT & Stack Crush Auditor")}
            </h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <select aria-label={tr("瓦楞楞型", "Flute Grade")} value={fluteGrade} onChange={(e) => setFluteGrade(e.target.value as FluteGradeId)} style={{ fontSize: 12 }}>
                {Object.values(FLUTE_GRADES).map((g) => (
                  <option key={g.id} value={g.id}>{tr(g.labelZh, g.labelEn)}</option>
                ))}
              </select>
              <select aria-label={tr("海运与温湿度环境", "Environment Profile")} value={envProfile} onChange={(e) => setEnvProfile(e.target.value as EnvironmentProfileId)} style={{ fontSize: 12 }}>
                {Object.values(ENVIRONMENT_PROFILES).map((e) => (
                  <option key={e.id} value={e.id}>{tr(e.labelZh, e.labelEn)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="v1-kpi-row">
            <div className="v1-kpi"><small>{tr("受检 SKU 数", "SKUs Audited")}</small><strong>{bctReport.totalSkus}</strong></div>
            <div className="v1-kpi"><small>{tr("预警 SKU", "Warning SKUs")}</small><strong>{bctReport.warnSkus}</strong></div>
            <div className="v1-kpi"><small>{tr("高危压溃 SKU", "Crush Risk SKUs")}</small><strong style={{ color: bctReport.crushRiskSkus > 0 ? "#dc2626" : "#15803d" }}>{bctReport.crushRiskSkus}</strong></div>
            <div className="v1-kpi"><small>{tr("最高承压比", "Peak Load Ratio")}</small><strong>{(bctReport.rows.length ? Math.max(...bctReport.rows.map((r) => r.loadRatioPct)) : 0).toFixed(0)}%</strong></div>
          </div>
        </section>
      )}

      {/* D10: 3D Residual Void Smart Gap-Fill Recommender (With One-Click Apply) */}
      {showGapFill && (
        <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("3D 残余空隙智能补货推荐", "3D Void Smart Gap-Fill Recommender")}>
          <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PackagePlus size={16} aria-hidden="true" />
              {tr("3D 残余空隙智能补货推荐（精确几何匹配 + 一键补单）", "3D Residual Void Gap-Fill Recommender")}
            </h3>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {tr(
                `可用空隙块 ${gapFillReport.usableZones.length} 个 · 剩余载重 ${gapFillReport.remainingPayloadKg} kg`,
                `${gapFillReport.usableZones.length} usable voids · ${gapFillReport.remainingPayloadKg} kg payload left`,
              )}
            </span>
          </div>
          {gapFillReport.recommendations.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {tr("当前残余 3D 空隙块已无法装入候选整箱 SKU，或剩余载重已达上限。", "No candidate SKU fits cleanly inside the remaining 3D void cuboids or payload limit.")}
            </p>
          ) : (
            <div className="v1-table-scroll">
              <table className="v1-table">
                <thead>
                  <tr>
                    <th>{tr("推荐补装 SKU", "Candidate SKU")}</th>
                    <th className="num">{tr("最大可补箱数", "Max Add")}</th>
                    <th className="num">{tr("增重 (kg)", "+Weight")}</th>
                    <th className="num">{tr("利用率增益", "+Vol %")}</th>
                    <th className="num">{tr("主导瓶颈", "Limit")}</th>
                    {onApplyQuantities && <th>{tr("闭环操作", "Action")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {gapFillReport.recommendations.map((rec) => {
                    const matched = products.find((p) => p.id === rec.skuId || p.sku === rec.sku);
                    return (
                      <tr key={rec.skuId}>
                        <td><strong>{rec.sku}</strong> · {rec.name}</td>
                        <td className="num">+{rec.maxAdditionalUnits}</td>
                        <td className="num">+{rec.addedWeightKg}</td>
                        <td className="num">+{rec.utilizationGainPct}%</td>
                        <td className="num">{rec.limitingFactor === "weight" ? tr("载重上限", "Weight") : tr("3D 几何", "3D Fit")}</td>
                        {onApplyQuantities && (
                          <td>
                            {matched ? (
                              <button
                                type="button"
                                className="button small"
                                onClick={() => {
                                  onApplyQuantities({ [matched.id]: matched.quantity + rec.maxAdditionalUnits });
                                  setGapAppliedNotice(tr(`已为 ${matched.sku} 补增 +${rec.maxAdditionalUnits} 箱`, `Added +${rec.maxAdditionalUnits} cartons to ${matched.sku}`));
                                }}
                              >
                                {tr("一键补货", "Apply Fill")}
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, opacity: 0.6 }}>{tr("产品库候选", "Catalog")}</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {gapAppliedNotice && <div style={{ fontSize: 12, color: "#15803d", fontWeight: 600, marginTop: 6 }}>✓ {gapAppliedNotice}</div>}
        </section>
      )}

      {/* D15: Interactive Per-SKU Multi-Stop LIFO Editor + CSV */}
      {showLifoEditor && uniqueSkus.length > 0 && (
        <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("多卸货点 LIFO 顺序校验", "Multi-Stop LIFO Audit")}>
          <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <MapPin size={16} aria-hidden="true" />
              {tr("多目的地 LIFO 卸货站次配置与直卸校验", "Multi-Stop LIFO Stop Assignment & Audit")}
            </h3>
            <button
              type="button"
              className="button small ghost"
              onClick={() => downloadBlob(multiStopReportToCsv(lifoReport), "text/csv;charset=utf-8", "cargofit-lifo-audit.csv")}
            >
              <Download size={14} /> {tr("导出 LIFO 报告 CSV", "Export LIFO CSV")}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {uniqueSkus.slice(0, 8).map((item) => (
              <label key={item.productId} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
                <strong>{item.sku}</strong> ({item.count})
                <select
                  value={effectiveStopMap[item.productId] ?? 1}
                  onChange={(e) => setStopOverrides((prev) => ({ ...prev, [item.productId]: Number(e.target.value) }))}
                  style={{ fontSize: 11 }}
                >
                  {[1, 2, 3, 4].map((st) => (
                    <option key={st} value={st}>{tr(`第 ${st} 站`, `Stop ${st}`)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="v1-kpi-row">
            <div className="v1-kpi"><small>{tr("直卸无阻挡率", "Direct Unload %")}</small><strong>{lifoReport.directUnloadablePct}%</strong></div>
            <div className="v1-kpi"><small>{tr("被后续站次阻挡箱数", "Blocked Cartons")}</small><strong>{lifoReport.blockedBoxCount}</strong></div>
            <div className="v1-kpi"><small>{tr("规划卸货站数", "Stops")}</small><strong>{lifoReport.stops.length}</strong></div>
          </div>
        </section>
      )}

      {/* D19: Dual-Strategy Side-by-Side Comparison + CSV */}
      {showDualCompare && dualComparison && (
        <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("双策略全维度工程并排对比", "Dual-Strategy Engineering Comparison")}>
          <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Columns2 size={16} aria-hidden="true" />
              {tr("双策略并排工程对比（现场易执行 vs 高密度参考）", "Side-by-Side Strategy Comparison (Practical vs Maximum)")}
            </h3>
            <button
              type="button"
              className="button small ghost"
              onClick={() => downloadBlob(planComparisonToCsv(dualComparison), "text/csv;charset=utf-8", "cargofit-strategy-comparison.csv")}
            >
              <Download size={14} /> {tr("导出对比 CSV", "Export CSV")}
            </button>
          </div>
          <div className="v1-table-scroll">
            <table className="v1-table">
              <thead>
                <tr>
                  <th>{tr("核心指标", "Metric")}</th>
                  <th className="num">{tr("现场易执行", "Practical")}</th>
                  <th className="num">{tr("高密度参考", "Maximum")}</th>
                  <th className="num">{tr("差异", "Delta")}</th>
                </tr>
              </thead>
              <tbody>
                {dualComparison.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{tr(r.labelZh, r.labelEn)}</td>
                    <td className="num">{r.planAValue}</td>
                    <td className="num">{r.planBValue}</td>
                    <td className="num"><strong>{r.deltaLabel}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* D23: Field Actuals Feedback, 70/30 Calibration Backtest & Local Snapshots */}
      {showFieldCal && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: 12 }}>
          <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("现场实装偏差回流与经验余量校准", "Field Actuals Feedback & Calibration Loop")}>
            <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <History size={16} aria-hidden="true" />
                {tr("现场实装回填与 70/30 独立回测校准", "Field Actuals & 70/30 Calibration")}
              </h3>
              <label className="button small ghost" style={{ cursor: "pointer" }}>
                <Upload size={14} /> {tr("导入 /crew CSV", "Import /crew CSV")}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    const parsed = parseCrewAuditCsv(text);
                    if (parsed.actualCartons > 0 || parsed.plannedCartons > 0) {
                      const rec: FieldFeedbackRecord = {
                        id: `csv-${Date.now().toString(36)}`,
                        recordedAt: new Date().toISOString(),
                        containerNo: parsed.containerNo || `CSV-${fieldRecords.length + 1}`,
                        containerName: plan.container.name,
                        plannedCartons: parsed.plannedCartons || plan.metrics.loadedCount,
                        actualCartons: parsed.actualCartons,
                        plannedWeightKg: Number(plan.metrics.grossWeight.toFixed(1)),
                        actualWeighedKg: null,
                        plannedTailVoidMm: 0,
                        actualTailVoidMm: null,
                        discrepancyCount: parsed.discrepancyCount,
                        note: `Imported /crew CSV (${parsed.discrepancyCount} discrepancies)`,
                      };
                      persistFieldRecords([rec, ...fieldRecords]);
                    }
                  }}
                />
              </label>
            </div>
            <div className="v1-grid-2" style={{ marginBottom: 8 }}>
              <input placeholder={tr("柜号（如 MSCU1234567）", "Container No.")} value={fbContainerNo} onChange={(e) => setFbContainerNo(e.target.value)} />
              <input type="number" placeholder={tr("实装箱数", "Actual Cartons")} value={fbActualCartons} onChange={(e) => setFbActualCartons(e.target.value)} />
              <input type="number" placeholder={tr("实称毛重 kg", "Actual Gross kg")} value={fbActualWeight} onChange={(e) => setFbActualWeight(e.target.value)} />
              <input placeholder={tr("现场备注", "Field Note")} value={fbNote} onChange={(e) => setFbNote(e.target.value)} />
            </div>
            <button
              type="button"
              className="button small primary"
              onClick={() => {
                const actualCartons = Math.max(0, Number(fbActualCartons) || 0);
                const rec: FieldFeedbackRecord = {
                  id: `fb-${Date.now().toString(36)}`,
                  recordedAt: new Date().toISOString(),
                  containerNo: fbContainerNo.trim() || `CTN-${fieldRecords.length + 1}`,
                  containerName: plan.container.name,
                  plannedCartons: plan.metrics.loadedCount,
                  actualCartons,
                  plannedWeightKg: Number(plan.metrics.grossWeight.toFixed(1)),
                  actualWeighedKg: fbActualWeight ? Number(fbActualWeight) : null,
                  plannedTailVoidMm: 0,
                  actualTailVoidMm: null,
                  discrepancyCount: 0,
                  note: fbNote.trim() || "",
                };
                persistFieldRecords([rec, ...fieldRecords]);
                setFbContainerNo("");
                setFbNote("");
              }}
            >
              {tr("登记实装样本", "Log Field Actual")}
            </button>
            <div style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>
              {tr(
                `已归档 ${calibrationSummary.sampleCount} 条实装记录 · 平均达成率 ${calibrationSummary.meanFillAchievementPct.toFixed(1)}% · 70/30 独立回测 MAE ${calV2Report.holdoutMaePct !== null ? `${calV2Report.holdoutMaePct.toFixed(1)}%` : "样本不足"}`,
                `${calibrationSummary.sampleCount} records · Mean fill ${calibrationSummary.meanFillAchievementPct.toFixed(1)}% · 70/30 holdout MAE ${calV2Report.holdoutMaePct !== null ? `${calV2Report.holdoutMaePct.toFixed(1)}%` : "N/A"}`,
              )}
            </div>
          </section>

          <section className="v1-panel" style={{ marginTop: 0 }} aria-label={tr("本地工程快照与版本对比", "Local Plan Snapshots & Version Diff")}>
            <div className="v1-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <BookmarkPlus size={16} aria-hidden="true" />
                {tr("本地工程快照与历史留档", "Local Engineering Snapshots")}
              </h3>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input
                style={{ flex: 1 }}
                placeholder={tr("快照标签（如：初版报价 / 改箱后方案）", "Snapshot label")}
                value={snapLabel}
                onChange={(e) => setSnapLabel(e.target.value)}
              />
              <button
                type="button"
                className="button small primary"
                onClick={() => {
                  const snap = buildPlanSnapshot(plan, snapLabel.trim() || `${plan.container.name} #${snapshots.length + 1}`);
                  persistSnapshots([snap, ...snapshots]);
                  setSnapLabel("");
                }}
              >
                {tr("保存快照", "Save Snapshot")}
              </button>
            </div>
            {snapshots.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{tr("尚未保存本地工程快照。", "No local snapshots saved yet.")}</p>
            ) : (
              <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
                {snapshots.slice(0, 5).map((s) => (
                  <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 6px", borderRadius: 4, background: "var(--bg-subtle)" }}>
                    <span><strong>{s.label}</strong> ({s.containerName})</span>
                    <span>{s.loadedCount} {tr("箱", "ctns")} · {s.volumeUtilPct}%</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
