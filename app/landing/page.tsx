"use client";
import Link from "next/link";
import { setAppLanguage, SUPPORTED_LANGUAGES, tr, useLanguage, type UiLanguage } from "../../components/language";

export default function LandingPage() {
  const language = useLanguage();
  return (
    <main style={{ minHeight: "100dvh", background: "#FFFFFF", color: "#0F172A", fontFamily: "sans-serif" }}>
      <header style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderBottom: "1px solid #E2E8F0" }}>
        <strong style={{ fontSize: 20, color: "#0F766E" }}>CargoFit v1.0</strong>
        <nav style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <select
            aria-label="Language"
            value={language}
            onChange={(e) => setAppLanguage(e.target.value as UiLanguage)}
            style={{ padding: "7px 10px", border: "1px solid #CBD5E1", borderRadius: 8, background: "#F8FAFC", color: "#0F172A", fontSize: 13 }}
          >
            {SUPPORTED_LANGUAGES.map((opt) => (
              <option key={opt.code} value={opt.code}>{opt.label}</option>
            ))}
          </select>
          <Link href="/crew" style={{ color: "#334155", textDecoration: "none", fontSize: 14 }}>
            {tr("现场扫码页", "Crew View")}
          </Link>
          <Link href="/" style={{ padding: "8px 16px", background: "#0F766E", color: "#FFFFFF", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
            {tr("免费进入装柜工作台 →", "Launch Free Load Planner →")}
          </Link>
        </nav>
      </header>

      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "64px 24px 48px" }}>
        <h1 style={{ fontSize: "clamp(32px, 4.5vw, 52px)", lineHeight: 1.15, margin: "0 0 18px", maxWidth: "24ch" }}>
          {tr(
            "为外贸业务、跟单与工厂打造的 3D 装柜与单证协同平台",
            "3D Container Loading & Trade Document Workspace for Exporters, Merchandisers & Warehouses",
          )}
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.65, color: "#475569", maxWidth: "62ch", margin: "0 0 28px" }}>
          {tr(
            "3 秒粘贴 Excel 导入订单，支持打托/散箱混装、一键凑满柜补单、纸箱改箱增容、北美 IPI 公路限重、多客户 LIFO 运费分摊、标准外贸 Packing List 导出与码头免登录扫码装柜。",
            "Paste Excel orders in 3 seconds. Mix pallets and loose cartons, auto-fill container gaps, optimize master cartons, enforce road weight limits, split LIFO freight, export formula Packing Lists, and scan Crew View on any phone.",
          )}
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" style={{ padding: "12px 24px", background: "#0F766E", color: "#FFFFFF", borderRadius: 8, textDecoration: "none", fontWeight: 600 }}>
            {tr("立即开始免费算柜", "Start Planning Free")}
          </Link>
        </div>
      </section>

      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 24px 72px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24, borderTop: "1px solid #E2E8F0" }}>
        <div>
          <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>
            {tr("外贸业务员：凑满柜多卖货", "Export Sales: Fill Every Cubic Meter")}
          </h2>
          <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
            {tr(
              "自动测算剩余空间可补装的精确箱数，一键生成多语言客户补单话术与单品海运费分摊报价表。",
              "Calculate exact top-up cartons for unused space and generate multilingual client upsell emails plus landed freight breakdowns.",
            )}
          </p>
        </div>
        <div>
          <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>
            {tr("外贸跟单：3 秒导表出装箱单", "Merchandisers: 3-Second Import to Packing List")}
          </h2>
          <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
            {tr(
              "直接 Ctrl+V 粘贴任意客户表格，支持门洞前置预警、纸箱改箱增容反推，一键导出带公式的标准 Packing List Excel。",
              "Ctrl+V any customer table, catch door-height blockers upfront, optimize carton sizes, and export formula-driven Packing Lists.",
            )}
          </p>
        </div>
        <div>
          <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>
            {tr("工厂现场：扫码逐排装柜留档", "Warehouse Crew: Scan & Load Row by Row")}
          </h2>
          <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
            {tr(
              "免登录手机扫码打开大字逐排步进清单，内置空柜/半柜/满柜/封条五图水印打卡并一键打印验货报告。",
              "Open large-print row slices on any phone without login, check off rows, stamp 5 inspection photos, and print the loading report.",
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
