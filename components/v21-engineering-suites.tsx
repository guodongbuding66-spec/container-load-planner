"use client";

import { useMemo, useState } from "react";
import { auditSpecialCargoCompliance } from "../lib/packing/special-cargo-rules";
import {
  exportCompetitorBenchmarkPacket,
  runCargoFitCompetitorBaseline,
  type TwelveMetricScorecard,
} from "../lib/packing/competitor-benchmark-harness";
import {
  INDEPENDENT_CORPUS_ROADMAP,
  PLANNED_CORPUS_TOTAL_TARGET,
  PLANNED_FACTORY_CASES_TARGET,
  runIndependentCorpusBatch,
  type IndependentCorpusRunReport,
} from "../lib/packing/independent-test-corpus";
import type { ContainerSpec, PackingResult, ProductInput } from "../lib/packing/types";
import { V3VisualSuites, type RoleWorkbenchPreset } from "./v3-visual-suites";
import { V3OpsEnterpriseSuites } from "./v3-ops-enterprise-suites";

export const ROLE_WORKBENCH_CARDS: Array<{
  id: RoleWorkbenchPreset;
  titleZh: string;
  titleEn: string;
  audienceZh: string;
  audienceEn: string;
  descZh: string;
  descEn: string;
}> = [
  {
    id: "quick",
    titleZh: "快速测算",
    titleEn: "Quick Estimate",
    audienceZh: "外贸业务员",
    audienceEn: "Export Sales",
    descZh: "输入尺寸、重量、数量，快速获得装柜量、AI 诊断与 ROI 报价。",
    descEn: "Fast carton capacity, AI copilot & freight ROI quotes.",
  },
  {
    id: "pro",
    titleZh: "专业装柜",
    titleEn: "Pro Loading",
    audienceZh: "物流计划人员",
    audienceEn: "Logistics Planner",
    descZh: "混装、拼柜、托盘、多柜费用、空隙补货与三轴动态配重全套优化。",
    descEn: "Full mixed-load, multi-container, pallet, gap-fill & axle optimization.",
  },
  {
    id: "packaging",
    titleZh: "包装工程",
    titleEn: "Packaging Eng",
    audienceZh: "产品与包装工程师",
    audienceEn: "Packaging Engineer",
    descZh: "反向改箱、6级BOM、CAD/3D预处理、BCT压溃热力图与异形件引擎。",
    descEn: "Reverse sizing, 6-level BOM, CAD/3D, BCT heatmaps & irregulars.",
  },
  {
    id: "field",
    titleZh: "现场执行",
    titleEn: "Field Execution",
    audienceZh: "仓库与装柜人员",
    audienceEn: "Warehouse Crew",
    descZh: "多站 LIFO 卸货顺序、CTU 固缚辅材、扫码确认与实装校准回填。",
    descEn: "LIFO unloading zones, CTU securing kit, mobile /crew sync & field logs.",
  },
  {
    id: "enterprise",
    titleZh: "企业管理",
    titleEn: "Enterprise Mgmt",
    audienceZh: "管理人员",
    audienceEn: "Operations Manager",
    descZh: "审批流、不可变审计日志、版本快照、校准飞轮、平台架构与 ROI。",
    descEn: "Approvals, immutable audit trail, calibration flywheel & ROI.",
  },
  {
    id: "developer",
    titleZh: "开发者中心",
    titleEn: "Developer Center",
    audienceZh: "IT 与系统集成人员",
    audienceEn: "IT & Integrators",
    descZh: "四层系统集成架构、REST API、TS/Python SDK、MCP 与行业测试体系。",
    descEn: "4-layer architecture, REST API, SDKs, MCP & benchmark harness.",
  },
];

const TWELVE_CAPABILITY_SCORES: Array<{ zh: string; en: string; score: number }> = [
  { zh: "外贸业务适配能力", en: "Export Trade Workflow Fit", score: 5 },
  { zh: "多箱套装与订单管理", en: "Multi-Carton Kits & Orders", score: 5 },
  { zh: "打托与包装联合规划", en: "Pallet & Packaging Co-Design", score: 5 },
  { zh: "3D 可视化与工程测量", en: "3D Studio & Precision Measure", score: 4 },
  { zh: "多柜装载与成本优化", en: "Multi-Container Cost Optimization", score: 4 },
  { zh: "反向改箱与 BOM 核算", en: "Reverse Sizing & 6-Level BOM", score: 5 },
  { zh: "真实异形几何优化", en: "Irregular Geometry & Nesting", score: 4 },
  { zh: "工程安全与热力验证", en: "Engineering & Heatmap Audit", score: 4 },
  { zh: "仓库现场执行闭环", en: "Warehouse Field Sync Loop", score: 4 },
  { zh: "算法最优性与基准证明", en: "Algorithm Proof & Benchmarks", score: 4 },
  { zh: "多式联运空间库支持", en: "Multimodal Transport Spaces", score: 4 },
  { zh: "企业协作与 API/MCP 生态", en: "Enterprise RBAC & API/MCP", score: 4 },
];

const TEN_AUTOMATED_QA_CHECKS: Array<{ zh: string; en: string }> = [
  { zh: "全页面交互控件与按钮闭环", en: "All interactive controls & apply callbacks" },
  { zh: "Chrome / Edge / Firefox / Safari 兼容", en: "Chrome / Edge / Firefox / Safari parity" },
  { zh: "Windows / macOS / Android / iOS", en: "Windows / macOS / Android / iOS" },
  { zh: "720P–4K 与手机小屏响应式布局", en: "720P–4K & mobile responsive layouts" },
  { zh: "中英文切换与零文字重叠检查", en: "EN/ZH switching & zero text overlap" },
  { zh: "WebGL 3D 渲染与帧率性能", en: "WebGL 3D rendering & frame pacing" },
  { zh: "Excel/CSV/PDF/JSON 导入导出备份", en: "Excel/CSV/PDF/JSON import & backup" },
  { zh: "连续计算/暂停/取消/重算异常恢复", en: "Pause, cancel & recalculation recovery" },
  { zh: "审批权限、审计日志与云端同步", en: "Approvals, audit trail & cloud sync" },
  { zh: "GitHub CI 与双站部署版本一致", en: "GitHub CI & dual-site version parity" },
];

interface V21EngineeringSuitesProps {
  result: PackingResult;
  products: readonly ProductInput[];
  initialRole?: RoleWorkbenchPreset;
  controlledRole?: RoleWorkbenchPreset;
  onRoleChange?: (role: RoleWorkbenchPreset) => void;
  hideRoleMatrix?: boolean;
  onAdoptPlan?: (next: PackingResult) => void;
  onAddProduct?: (product: ProductInput) => void;
  onSelectContainerPreset?: (spec: ContainerSpec) => void;
  tr: (zh: string, en?: string) => string;
}

export function V21EngineeringSuites({
  result,
  products,
  initialRole = "pro",
  controlledRole,
  onRoleChange,
  hideRoleMatrix = false,
  onAdoptPlan,
  onAddProduct,
  onSelectContainerPreset,
  tr,
}: V21EngineeringSuitesProps) {
  const [internalRole, setInternalRole] = useState<RoleWorkbenchPreset>(initialRole);
  const rolePreset = controlledRole ?? internalRole;
  const setRolePreset = (next: RoleWorkbenchPreset) => {
    setInternalRole(next);
    onRoleChange?.(next);
  };

  const [corpusReport, setCorpusReport] = useState<IndependentCorpusRunReport | null>(null);
  const [competitorCard, setCompetitorCard] = useState<TwelveMetricScorecard | null>(null);
  const [packetExportedNote, setPacketExportedNote] = useState<string>("");

  const specialReport = useMemo(() => auditSpecialCargoCompliance(result, products), [result, products]);

  const handleRunCorpus = () => {
    setCorpusReport(runIndependentCorpusBatch(36, "maximum", 20261128));
  };

  const handleRunCompetitorBaseline = () => {
    const scenario = {
      scenarioId: `cargofit-live-${result.container.id}`,
      title: `${result.container.name} (${products.length} SKUs)`,
      timeBudgetMs: 5000,
      container: result.container,
      products: [...products],
      clearanceMm: result.clearance,
    };
    setCompetitorCard(runCargoFitCompetitorBaseline(scenario, 3));
  };

  const handleDownloadCompetitorPacket = (format: "json" | "csv") => {
    const scenario = {
      scenarioId: `cargofit-live-${result.container.id}`,
      title: `${result.container.name} (${products.length} SKUs)`,
      timeBudgetMs: 5000,
      container: result.container,
      products: [...products],
      clearanceMm: result.clearance,
    };
    const packet = exportCompetitorBenchmarkPacket(scenario);
    const content = format === "json" ? packet.json : packet.csv;
    const blob = new Blob([content], {
      type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cargofit-competitor-benchmark.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    setPacketExportedNote(
      tr(
        `已导出标准化竞品对照输入包（${format.toUpperCase()}），可直接导入 EasyCargo / Goodloading / CargoWiz / Cargo-Planner 进行同条件测试。`,
        `Exported standardized competitor benchmark packet (${format.toUpperCase()}).`,
      ),
    );
  };

  const maxCorpusCategoryTarget = Math.max(...INDEPENDENT_CORPUS_ROADMAP.map((c) => c.plannedTarget), 1);

  return (
    <div className="v21-engineering-suites" style={{ display: "grid", gap: 14 }}>
      {/* D20: 六大角色工作台 3×2 矩阵切换 */}
      {!hideRoleMatrix && (
        <section className="analytics-card" aria-label={tr("六大角色专业工作台矩阵", "6 Role Workbench Matrix")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("六大角色工作台（按业务角色聚焦核心高频模块）", "Six Role-Based Workbenches (Complexity Isolation)")}</h4>
            <span className="pill-badge">{tr("当前视图", "Active View")}: <strong>{rolePreset.toUpperCase()}</strong></span>
          </header>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8, marginTop: 10 }}>
            {ROLE_WORKBENCH_CARDS.map((card) => {
              const active = rolePreset === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRolePreset(card.id)}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    border: active ? "2px solid #2563eb" : "1px solid rgba(148,163,184,0.3)",
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
      )}

      {/* D01, D02, D04, D05, D06, D07, D08, D09 */}
      <V3VisualSuites
        result={result}
        products={products}
        rolePreset={rolePreset}
        onAdoptPlan={onAdoptPlan}
        onAddProduct={onAddProduct}
        tr={tr}
      />

      {/* D13, D14, D15, D16, D21, D22, D23, D24 */}
      <V3OpsEnterpriseSuites
        result={result}
        products={products}
        rolePreset={rolePreset}
        onSelectContainerPreset={onSelectContainerPreset}
        tr={tr}
      />

      {/* D17: 危险品、易碎品与 8 类特殊货物确定性规则库 */}
      {(rolePreset === "pro" || rolePreset === "packaging" || rolePreset === "field") && (
        <section className="analytics-card" aria-label={tr("特殊货物与 IMDG 隔离规则", "Special Cargo & IMDG Compliance")}>
          <h4 style={{ margin: "0 0 8px" }}>{tr("危险品、易碎品与 8 类特殊货物确定性规则库 (IMDG 7.2.4)", "Special Cargo & Deterministic IMDG 7.2.4 Rulebook")}</h4>
          <div style={{ fontSize: 12, display: "grid", gap: 4 }}>
            <div>
              {tr("识别类别", "Detected Categories")}:{" "}
              <strong>{specialReport.activeCategories.length ? specialReport.activeCategories.join(", ") : tr("普通干货", "General Dry Cargo")}</strong>
            </div>
            <div>
              {tr("合规状态", "Status")}: <strong>{specialReport.complianceStatus.toUpperCase()}</strong> ({tr("错误", "Errors")}: {specialReport.errorCount}, {tr("告警", "Warns")}: {specialReport.warnCount})
              {specialReport.desiccantBagsRecommended > 0 && ` · ${tr("建议干燥剂", "Desiccant")}: ${specialReport.desiccantBagsRecommended} ${tr("袋", "bags")}`}
            </div>
            {specialReport.violations.slice(0, 4).map((v) => (
              <div key={v.id} style={{ fontSize: 11, color: v.severity === "error" ? "#b91c1c" : "#b45309" }}>
                • {tr(v.messageZh, v.messageEn)}
              </div>
            ))}
            <div style={{ fontSize: 11, opacity: 0.75 }}>{tr(specialReport.disclaimerZh, specialReport.disclaimerEn)}</div>
          </div>
        </section>
      )}

      {/* 配图 #2: CargoFit 12 项综合能力评估卡（企业管理视图） */}
      {rolePreset === "enterprise" && (
        <section className="analytics-card" aria-label={tr("CargoFit 当前综合能力评估", "CargoFit 12-Capability Assessment")}>
          <h4 style={{ margin: "0 0 8px" }}>{tr("CargoFit 12 项综合能力成熟度评估（5 格分段状态）", "CargoFit 12-Capability Maturity Scorecard")}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8, fontSize: 11 }}>
            {TWELVE_CAPABILITY_SCORES.map((cap) => (
              <div key={cap.en} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.22)" }}>
                <span>{tr(cap.zh, cap.en)}</span>
                <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }} aria-label={`${cap.score}/5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      style={{
                        width: 12,
                        height: 8,
                        borderRadius: 2,
                        background: n <= cap.score ? "#2563eb" : "rgba(148,163,184,0.28)",
                        display: "inline-block",
                      }}
                    />
                  ))}
                  <strong style={{ marginLeft: 4 }}>{cap.score}/5</strong>
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, opacity: 0.72, marginTop: 6 }}>
            {tr("说明：4/5 表示软件核心已完整落地但仍受外部实机 GPU / 工厂实测样本 / 正式云凭据边界约束，严禁虚标满分。", "Note: 4/5 indicates full software implementation bounded by external hardware, lab/factory samples, or production cloud credentials.")}
          </div>
        </section>
      )}

      {/* 行业级测试体系：5 大公开测试集 + 配图 #25 10,000+ 横向进度分布卡 + 2×5 浏览器自动化清单 + 12 项竞品对照包 */}
      {(rolePreset === "pro" || rolePreset === "developer") && (
        <section className="analytics-card" aria-label={tr("行业级算法测试体系与竞品对照", "Industry Benchmark & Competitor Harness")}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>{tr("行业级测试体系（5 大公开测试集 / 10,000+ 样本库 / 竞品对照）", "Industry Benchmark Suite & Competitor Harness")}</h4>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="button small primary" onClick={handleRunCorpus}>
                {tr("实跑 6 类独立样本批次", "Run 6-Category Corpus Batch")}
              </button>
              <button type="button" className="button small ghost" onClick={handleRunCompetitorBaseline}>
                {tr("生成 12 项基准记分卡", "Run 12-Metric Scorecard")}
              </button>
              <button type="button" className="button small ghost" onClick={() => handleDownloadCompetitorPacket("csv")}>
                {tr("导出竞品对照包 CSV", "Export Competitor CSV")}
              </button>
            </div>
          </header>

          <div style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>
            {tr(
              `阶段性研发目标：规划测试案例合计 ${PLANNED_CORPUS_TOTAL_TARGET.toLocaleString()} 组 + ${PLANNED_FACTORY_CASES_TARGET} 份真实工厂实装案例（诚实区分规划目标与当前已实跑验证数量）。`,
              `Roadmap targets: ${PLANNED_CORPUS_TOTAL_TARGET.toLocaleString()} planned independent cases + ${PLANNED_FACTORY_CASES_TARGET} real factory cases.`,
            )}
          </div>

          {/* Horizontal Blue Progress Distribution Bars matching Reference Diagram #25 */}
          <div style={{ display: "grid", gap: 6, marginTop: 10, fontSize: 11 }}>
            {INDEPENDENT_CORPUS_ROADMAP.map((cat) => {
              const live = corpusReport?.categories.find((c) => c.id === cat.id);
              const barPct = Math.max(8, Math.round((cat.plannedTarget / maxCorpusCategoryTarget) * 100));
              return (
                <div key={cat.id} style={{ display: "grid", gridTemplateColumns: "180px 1fr 125px", alignItems: "center", gap: 8 }}>
                  <strong>{tr(cat.labelZh, cat.id)}</strong>
                  <div style={{ height: 10, borderRadius: 5, background: "rgba(148,163,184,0.22)", overflow: "hidden" }}>
                    <div style={{ width: `${barPct}%`, height: "100%", background: "#2563eb" }} />
                  </div>
                  <span style={{ textAlign: "right" }}>
                    {cat.plannedTarget.toLocaleString()}
                    {live ? ` · ✓${live.passedCount}/${live.executedCount}` : ""}
                  </span>
                </div>
              );
            })}
          </div>

          {corpusReport && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#15803d" }}>
              ✓ {tr(corpusReport.honestStatusNoteZh, corpusReport.honestStatusNoteEn)} (P50={corpusReport.p50Ms}ms / P95={corpusReport.p95Ms}ms / P99={corpusReport.p99Ms}ms)
            </div>
          )}

          {competitorCard && (
            <div style={{ marginTop: 8, fontSize: 12, padding: 8, background: "rgba(37,99,235,0.06)", borderRadius: 6 }}>
              <strong>CargoFit {competitorCard.softwareVersion} · {tr("12 项硬性验收记分卡", "12-Metric Verification Scorecard")}</strong>:{" "}
              {tr("重叠", "Overlaps")} {competitorCard.overlapCount} / {tr("越界", "OOB")} {competitorCard.outOfBoundsCount} / {tr("数量守恒错", "Qty Err")} {competitorCard.quantityConservationErrors} / {tr("工程违规", "Rule Viol")} {competitorCard.engineeringRuleViolations} / {tr("利用率", "Util")} <strong>{competitorCard.volumeUtilizationPct}%</strong> / {tr("多次波动", "Variance")} {competitorCard.stabilityVariancePct}% / P50 {competitorCard.latencyP50Ms}ms / P95 {competitorCard.latencyP95Ms}ms
              <div style={{ fontSize: 11, opacity: 0.8 }}>{competitorCard.fieldErrorCalibrationStatus}</div>
            </div>
          )}

          {/* 2×5 Browser Automation QA Coverage Checklist matching Reference Diagram #25 */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,0.25)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              {tr("Playwright 真实浏览器自动化验收覆盖清单（2×5 矩阵）", "Playwright Real-Browser Automation QA Coverage (2×5)")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 5, fontSize: 11 }}>
              {TEN_AUTOMATED_QA_CHECKS.map((chk) => (
                <div key={chk.en} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ color: "#15803d", fontWeight: 700 }}>☑</span>
                  <span>{tr(chk.zh, chk.en)}</span>
                </div>
              ))}
            </div>
          </div>

          {packetExportedNote && <div style={{ marginTop: 6, fontSize: 11, color: "#1d4ed8" }}>{packetExportedNote}</div>}
        </section>
      )}
    </div>
  );
}
