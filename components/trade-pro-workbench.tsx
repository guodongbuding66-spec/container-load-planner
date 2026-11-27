"use client";
import { useMemo, useState } from "react";
import { Sparkles, Ruler, Ship, ShieldCheck, Copy, Check, FileSpreadsheet, Scale, Printer } from "lucide-react";
import { buildShippingMarksHtml, buildVgmDeclarationHtml, computeCenterOfGravity, rebalanceProductsForCoG } from "../lib/packing/vgm-cog";
import { computeLandedCostBreakdown } from "../lib/packing/landed-cost";
import { analyzeOogCargo } from "../lib/packing/oog-calculator";
import { SUPPORTED_LANGUAGES, type UiLanguage } from "./language";
import type { PackingResult, ProductInput } from "../lib/packing/types";
import {
  analyzePinwheelPallets,
  calculateConsigneeFreightSplit,
  optimizeCartonDimensions,
  optimizeMasterCartonFromUnit,
  suggestGapFill,
  type FreightSplitMethod,
} from "../lib/packing/trade-optimizers";
import {
  auditHumidityBct,
  compareCylinderPacking,
  estimateDunnageBom,
  inspectReeferAirflow,
  ROAD_WEIGHT_PRESETS,
  recommendedPayloadLimitKg,
  type RoadWeightPreset,
} from "../lib/packing/trade-compliance";
import {
  auditHazmatSegregation,
  buildClientSummaryEmail,
  compareFclVsLcl,
  inspectIppmCompliance,
  type HazmatClass,
} from "../lib/packing/trade-advisory";
import { tr, useLanguage } from "./language";

type TabId = "gapfill" | "carton" | "freight" | "compliance" | "advisory" | "vgm";

export function TradeProWorkbench({
  plan,
  products,
  onApplyQuantities,
  onApplyPayloadLimit,
  onApplyProducts,
}: {
  plan: PackingResult;
  products: readonly ProductInput[];
  onApplyQuantities?: (updates: Record<string, number>) => void;
  onApplyPayloadLimit?: (maxWeightKg: number) => void;
  onApplyProducts?: (next: ProductInput[]) => void;
}) {
  useLanguage();
  const [tab, setTab] = useState<TabId>("gapfill");
  const [strategy, setStrategy] = useState<"max_volume" | "max_value" | "balanced_ratio">("max_volume");
  const [targetPct, setTargetPct] = useState(94);
  const [skuPrices, setSkuPrices] = useState<Record<string, number>>({});
  const [skuIncrements, setSkuIncrements] = useState<Record<string, number>>({});
  const [copiedScript, setCopiedScript] = useState(false);

  const [selectedSkuId, setSelectedSkuId] = useState(products[0]?.id ?? "");
  // Mode B (Unit -> Master Carton) inputs
  const [unitL, setUnitL] = useState(180);
  const [unitW, setUnitW] = useState(120);
  const [unitH, setUnitH] = useState(100);
  const [unitWt, setUnitWt] = useState(0.85);
  const [maxCtnWt, setMaxCtnWt] = useState(22.5);

  const [freightTotal, setFreightTotal] = useState(3200);
  const [freightCurrency, setFreightCurrency] = useState("USD");
  const [splitMethod, setSplitMethod] = useState<FreightSplitMethod>("cbm");
  const [exportingFreight, setExportingFreight] = useState(false);

  const [roadPreset, setRoadPreset] = useState<RoadWeightPreset["id"]>("us_ipi_road");
  const [bctFactor, setBctFactor] = useState<1.5 | 2.5 | 3.0>(2.5);
  const [cylinderDiaMm, setCylinderDiaMm] = useState(580);
  const [lclRate, setLclRate] = useState(85);
  const [lclFixed, setLclFixed] = useState(450);
  const [fcl20, setFcl20] = useState(1850);
  const [fcl40, setFcl40] = useState(2600);
  const [fcl40h, setFcl40h] = useState(2750);
  const [hazmatSelected, setHazmatSelected] = useState<HazmatClass[]>(["general"]);
  const [emailLang, setEmailLang] = useState<UiLanguage>("en");
  const [copiedMail, setCopiedMail] = useState(false);
  const [deliveryUnit, setDeliveryUnit] = useState<"metric" | "imperial">("metric");
  const [rebalancedNotice, setRebalancedNotice] = useState(false);
  const [vgmBookingNo, setVgmBookingNo] = useState("");
  const [vgmContainerNo, setVgmContainerNo] = useState("");
  const [vgmSealNo, setVgmSealNo] = useState("");
  const [vgmTareKg, setVgmTareKg] = useState<number>(3800);
  const [vgmShipper, setVgmShipper] = useState("");
  const [markConsignee, setMarkConsignee] = useState("BUYER IMPORT LLC");
  const [markDest, setMarkDest] = useState("LOS ANGELES, USA");
  const [markPo, setMarkPo] = useState("PO-2026-001");
  const [truckingFee, setTruckingFee] = useState(450);
  const [portCustomsFee, setPortCustomsFee] = useState(380);
  const [insuranceFee, setInsuranceFee] = useState(120);
  const [dutyRatePct, setDutyRatePct] = useState(6.5);
  const cogReport = useMemo(() => computeCenterOfGravity(plan), [plan]);
  const oogReport = useMemo(() => analyzeOogCargo(plan.container, products), [plan.container, products]);
  const landedCost = useMemo(
    () =>
      computeLandedCostBreakdown(
        plan,
        products,
        {
          currency: freightCurrency,
          oceanFreight: freightTotal,
          truckingFee,
          customsAndPortFee: portCustomsFee,
          insuranceFee,
          dutyRatePercent: dutyRatePct,
          allocationBasis: splitMethod === "wm" ? "wm" : "cbm",
        },
      ),
    [plan, products, freightCurrency, freightTotal, truckingFee, portCustomsFee, insuranceFee, dutyRatePct, splitMethod],
  );
  const openHtmlSheet = (html: string, filename: string) => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank", "noopener");
    if (!w) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };
  const [exportingBundle, setExportingBundle] = useState(false);

  const gapFill = useMemo(
    () =>
      suggestGapFill(plan, products, {
        strategy,
        targetUtilizationPct: targetPct,
        skuUnitPrices: skuPrices,
        minAddIncrement: skuIncrements,
      }),
    [plan, products, strategy, targetPct, skuPrices, skuIncrements],
  );

  const selectedProduct = products.find((p) => p.id === selectedSkuId) ?? products[0];
  const cartonOpt = useMemo(
    () =>
      selectedProduct
        ? optimizeCartonDimensions(selectedProduct, plan.container, plan.clearance, {
            maxDeltaMm: 30,
            stepMm: 5,
            containerFreightUsd: freightTotal,
          })
        : { baselineCount: 0, candidates: [] },
    [selectedProduct, plan.container, plan.clearance, freightTotal],
  );

  const unitToCarton = useMemo(
    () =>
      optimizeMasterCartonFromUnit(
        {
          unitLengthMm: unitL,
          unitWidthMm: unitW,
          unitHeightMm: unitH,
          unitWeightKg: unitWt,
          maxCartonWeightKg: maxCtnWt,
          minPcsPerCarton: 4,
          maxPcsPerCarton: 24,
        },
        plan.container,
        plan.clearance,
      ),
    [unitL, unitW, unitH, unitWt, maxCtnWt, plan.container, plan.clearance],
  );

  const pinwheel = useMemo(() => analyzePinwheelPallets(plan.container, 1200, 1000, plan.clearance), [plan.container, plan.clearance]);
  const freightSplit = useMemo(
    () => calculateConsigneeFreightSplit(plan, products, freightTotal, freightCurrency, splitMethod),
    [plan, products, freightTotal, freightCurrency, splitMethod],
  );
  const dunnage = useMemo(() => estimateDunnageBom(plan, plan.container.rearDoorClearanceMm ?? 100), [plan]);
  const reefer = useMemo(() => inspectReeferAirflow(plan), [plan]);
  const bctWarnings = useMemo(() => auditHumidityBct(plan, products, bctFactor), [plan, products, bctFactor]);
  const cylinderCmp = useMemo(
    () => compareCylinderPacking(plan.container.length - 2 * plan.clearance, plan.container.width - 2 * plan.clearance, cylinderDiaMm),
    [plan.container, plan.clearance, cylinderDiaMm],
  );
  const roadLimitKg = recommendedPayloadLimitKg(plan.container, roadPreset);
  const fclLcl = useMemo(
    () => compareFclVsLcl(plan.metrics.loadedVolume / 1e9, plan.metrics.grossWeight, { lclRatePerWm: lclRate, lclFixedFees: lclFixed, fcl20gpAllIn: fcl20, fcl40gpAllIn: fcl40, fcl40hqAllIn: fcl40h, currency: freightCurrency }),
    [plan.metrics.loadedVolume, plan.metrics.grossWeight, lclRate, lclFixed, fcl20, fcl40, fcl40h, freightCurrency],
  );
  const hazmatReport = useMemo(() => auditHazmatSegregation(hazmatSelected), [hazmatSelected]);
  const ippcReport = useMemo(
    () => inspectIppmCompliance(plan, products.map((pr) => pr.orderLine?.destination ?? "").filter(Boolean)),
    [plan, products],
  );
  const clientEmail = useMemo(
    () => buildClientSummaryEmail(plan, products, { lang: emailLang, containerFreight: freightTotal, currency: freightCurrency }),
    [plan, products, emailLang, freightTotal, freightCurrency],
  );
  const downloadTradeBundle = async () => {
    setExportingBundle(true);
    try {
      const { createTradeDocBundleWorkbook } = await import("../lib/packing/packing-list-export");
      const bytes = await createTradeDocBundleWorkbook(plan, products, { currency: freightCurrency, unitPrices: skuPrices });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `CargoFit_CI_PL_Bundle_${plan.container.id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      setExportingBundle(false);
    }
  };

  const copyUpsellScript = async () => {
    const text = tr(gapFill.messageZh, gapFill.messageEn);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
    } catch {}
  };

  const downloadFreightExcel = async () => {
    setExportingFreight(true);
    try {
      const { createFreightSplitWorkbook } = await import("../lib/packing/packing-list-export");
      const bytes = await createFreightSplitWorkbook(plan, products, freightTotal, freightCurrency, splitMethod);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `CargoFit_Freight_Split_${plan.container.id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      setExportingFreight(false);
    }
  };

  return (
    <section className="v1-panel" aria-label={tr("外贸增效工具箱", "Foreign-Trade Pro Workbench")}>
      <div className="v1-panel-head">
        <h3>{tr("外贸实战增效工具箱（凑满柜 · 改箱/彩盒反推 · 多客户运费分摊 · 合规与耗材 BOM）", "Foreign-Trade Pro Suite (Gap-Fill · Carton Fit · Freight Split · Compliance BOM)")}</h3>
        <div className="v1-actions" style={{ marginTop: 0 }}>
          <button type="button" className={`button small ${tab === "gapfill" ? "primary" : "ghost"}`} onClick={() => setTab("gapfill")}>
            <Sparkles size={14} />{tr("一键凑满柜", "Gap-Fill")}
          </button>
          <button type="button" className={`button small ${tab === "carton" ? "primary" : "ghost"}`} onClick={() => setTab("carton")}>
            <Ruler size={14} />{tr("改箱增容 & 彩盒反推", "Carton & Unit Fit")}
          </button>
          <button type="button" className={`button small ${tab === "freight" ? "primary" : "ghost"}`} onClick={() => setTab("freight")}>
            <Ship size={14} />{tr("多客户 LIFO 运费分摊", "LIFO & Freight Split")}
          </button>
          <button type="button" className={`button small ${tab === "compliance" ? "primary" : "ghost"}`} onClick={() => setTab("compliance")}>
            <ShieldCheck size={14} />{tr("限重 / 耗材 BOM", "Compliance & BOM")}
          </button>
          <button type="button" className={`button small ${tab === "advisory" ? "primary" : "ghost"}`} onClick={() => setTab("advisory")}>
            <FileSpreadsheet size={14} />{tr("整拼对比 · 危品/IPPC · 客户邮件", "FCL/LCL · IMDG · Email")}
          </button>
          <button type="button" className={`button small ${tab === "vgm" ? "primary" : "ghost"}`} onClick={() => setTab("vgm")}>
            <Scale size={14} aria-hidden="true" />{tr("重心偏载 · VGM · 批量箱唛", "CoG · VGM & Marks")}
          </button>
        </div>
      </div>

      {tab === "gapfill" && (
        <div>
          <div className="v1-actions" style={{ marginTop: 0 }}>
            <label style={{ fontSize: 13 }}>
              {tr("补单策略：", "Strategy: ")}
              <select value={strategy} onChange={(e) => setStrategy(e.target.value as "max_volume" | "max_value" | "balanced_ratio")}>
                <option value="max_volume">{tr("空间利用率最大化", "Maximize volume")}</option>
                <option value="max_value">{tr("按单箱 FOB 产值最大化", "Maximize FOB value")}</option>
                <option value="balanced_ratio">{tr("按现有订单比例同步增补", "Proportional to current order")}</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              {tr("目标装满率：", "Target fill: ")}
              <input type="number" min={60} max={98} value={targetPct} onChange={(e) => setTargetPct(Number(e.target.value) || 94)} style={{ width: 68 }} />%
            </label>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--text-muted)" }}>
              {tr("可选：设置各 SKU 单箱 FOB 价格（用于产值最大化）与最小起订增量", "Optional: set SKU FOB price (for value maximization) & min order increment")}
            </summary>
            <div className="v1-table-scroll"><table className="v1-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th className="num">{tr("单箱 FOB 单价 (USD)", "FOB / Carton (USD)")}</th>
                  <th className="num">{tr("起订增量 (箱倍数)", "Min Increment (ctns)")}</th>
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 12).map((p) => (
                  <tr key={p.id}>
                    <td>{p.sku}</td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        style={{ width: 90 }}
                        value={skuPrices[p.id] ?? ""}
                        placeholder="0"
                        onChange={(e) => setSkuPrices((prev) => ({ ...prev, [p.id]: Number(e.target.value) || 0 }))}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        style={{ width: 76 }}
                        value={skuIncrements[p.id] ?? 1}
                        onChange={(e) => setSkuIncrements((prev) => ({ ...prev, [p.id]: Math.max(1, Math.round(Number(e.target.value) || 1)) }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </details>
          <div className="v1-kpi-row">
            <div className="v1-kpi"><small>{tr("当前体积利用率", "Current volume")}</small><strong>{gapFill.beforeVolumePct}%</strong></div>
            <div className="v1-kpi"><small>{tr("补单后预估利用率", "Projected volume")}</small><strong>{gapFill.afterVolumePct}%</strong></div>
            <div className="v1-kpi"><small>{tr("补单后载重占比", "Projected payload")}</small><strong>{gapFill.afterWeightPct}%</strong></div>
          </div>
          <p style={{ fontSize: 13 }}>{tr(gapFill.messageZh, gapFill.messageEn)}</p>
          {gapFill.suggestions.length > 0 && (
            <>
              <div className="v1-table-scroll"><table className="v1-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th className="num">{tr("当前箱数", "Current")}</th>
                    <th className="num">{tr("建议增补", "Add Qty")}</th>
                    <th className="num">{tr("补单后总计", "New Total")}</th>
                    <th className="num">{tr("增补体积 (CBM)", "Added CBM")}</th>
                    <th className="num">{tr("增补重量 (kg)", "Added kg")}</th>
                    {strategy === "max_value" && <th className="num">{tr("增补货值 (USD)", "Added USD")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {gapFill.suggestions.map((s) => (
                    <tr key={s.productId}>
                      <td>{s.sku}</td>
                      <td className="num">{s.currentQty}</td>
                      <td className="num">+{s.recommendedAddQty}</td>
                      <td className="num">{s.newTotalQty}</td>
                      <td className="num">{s.addedVolumeCbm}</td>
                      <td className="num">{s.addedWeightKg}</td>
                      {strategy === "max_value" && <td className="num">${s.addedValueUsd}</td>}
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="v1-actions">
                {onApplyQuantities && (
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() =>
                      onApplyQuantities(
                        Object.fromEntries(gapFill.suggestions.map((s) => [s.productId, s.newTotalQty])),
                      )
                    }
                  >
                    {tr("一键应用补单数量并重算", "Apply Quantities & Recalculate")}
                  </button>
                )}
                <button type="button" className="button ghost small" onClick={() => void copyUpsellScript()}>
                  {copiedScript ? <Check size={14} /> : <Copy size={14} />}
                  {copiedScript ? tr("已复制客户话术", "Copied") : tr("复制给客户的补单话术", "Copy Client Upsell Note")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "carton" && (
        <div>
          <div className="v1-grid-2">
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("模式 A：纸箱外箱尺寸微调增容（±30 mm 反推）", "Mode A: Outer Carton Trim-to-Gain (±30 mm)")}</h4>
              <label style={{ fontSize: 13 }}>
                {tr("分析 SKU：", "SKU: ")}
                <select value={selectedProduct?.id ?? ""} onChange={(e) => setSelectedSkuId(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{`${p.sku} (${p.length}×${p.width}×${p.height} mm)`}</option>
                  ))}
                </select>
              </label>
              <p className="helper-text" style={{ marginTop: 6 }}>
                {tr(`当前规格理论整柜装量：${cartonOpt.baselineCount} 箱`, `Baseline capacity: ${cartonOpt.baselineCount} ctns`)}
              </p>
              {cartonOpt.candidates.length > 0 ? (
                <div className="v1-table-scroll"><table className="v1-table">
                  <thead>
                    <tr>
                      <th>{tr("建议外箱 (mm)", "Suggested (mm)")}</th>
                      <th>{tr("微调", "Delta")}</th>
                      <th className="num">{tr("装量", "Cap.")}</th>
                      <th className="num">{tr("增容", "Gain")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cartonOpt.candidates.map((c, idx) => (
                      <tr key={idx}>
                        <td className="num">{`${c.lengthMm}×${c.widthMm}×${c.heightMm}`}</td>
                        <td>{[c.deltaL && `L${c.deltaL}`, c.deltaW && `W${c.deltaW}`, c.deltaH && `H${c.deltaH}`].filter(Boolean).join("/")}</td>
                        <td className="num">{c.cartonsPerContainer}</td>
                        <td className="num">+{c.gainCartons} (+{c.gainPercent}%)</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              ) : (
                <p className="helper-text">{tr("30 mm 微调范围内暂无更高装量组合。", "No higher capacity found within 30 mm trim.")}</p>
              )}

              <h4 style={{ margin: "16px 0 8px", fontSize: 14 }}>{tr("风车排托 & 圆柱蜂窝密排测算", "Pinwheel & Cylinder Hex Packing")}</h4>
              <p className="helper-text">
                {tr(
                  `1200×1000 托盘：常规同向 ${Math.max(pinwheel.alignedLongCount, pinwheel.alignedCrossCount)} 托 vs 风车式交错 ${pinwheel.pinwheelCount} 托（第 2/4 步可直接选择“风车式交错排托”生效）。`,
                  `1200×1000 pallets: Aligned ${Math.max(pinwheel.alignedLongCount, pinwheel.alignedCrossCount)} vs Pinwheel ${pinwheel.pinwheelCount} (selectable in pallet layout settings).`,
                )}
              </p>
              <label style={{ fontSize: 12 }}>
                {tr("圆桶外径 (mm)：", "Drum Ø (mm): ")}
                <input type="number" min={100} max={2000} value={cylinderDiaMm} onChange={(e) => setCylinderDiaMm(Number(e.target.value) || 580)} style={{ width: 76 }} />
              </label>
              <span className="helper-text" style={{ marginLeft: 8 }}>
                {tr(`矩阵 ${cylinderCmp.matrixCount} 桶 → 蜂窝密排 ${cylinderCmp.hexStaggeredCount} 桶 (+${cylinderCmp.gainPercent}%)`, `Matrix ${cylinderCmp.matrixCount} → Hex ${cylinderCmp.hexStaggeredCount} (+${cylinderCmp.gainPercent}%)`)}
              </span>
            </div>

            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("模式 B：内件彩盒 → 最佳外箱装率反推（含 FBA 限重）", "Mode B: Retail Unit → Master Carton Optimizer (FBA Limit)")}</h4>
              <div className="v1-grid-2" style={{ gap: 8 }}>
                <label style={{ fontSize: 12 }}>{tr("彩盒长 (mm)", "Unit L (mm)")}<input type="number" min={20} value={unitL} onChange={(e) => setUnitL(Number(e.target.value) || 180)} style={{ width: "100%" }} /></label>
                <label style={{ fontSize: 12 }}>{tr("彩盒宽 (mm)", "Unit W (mm)")}<input type="number" min={20} value={unitW} onChange={(e) => setUnitW(Number(e.target.value) || 120)} style={{ width: "100%" }} /></label>
                <label style={{ fontSize: 12 }}>{tr("彩盒高 (mm)", "Unit H (mm)")}<input type="number" min={20} value={unitH} onChange={(e) => setUnitH(Number(e.target.value) || 100)} style={{ width: "100%" }} /></label>
                <label style={{ fontSize: 12 }}>{tr("单件重 (kg)", "Unit Wt (kg)")}<input type="number" min={0.05} step={0.05} value={unitWt} onChange={(e) => setUnitWt(Number(e.target.value) || 0.85)} style={{ width: "100%" }} /></label>
              </div>
              <label style={{ fontSize: 12, display: "block", marginTop: 6 }}>
                {tr("单箱限重上限 (kg，如 FBA 22.5 kg)：", "Max carton weight (kg, e.g. FBA 22.5): ")}
                <input type="number" min={1} step={0.5} value={maxCtnWt} onChange={(e) => setMaxCtnWt(Number(e.target.value) || 22.5)} style={{ width: 80 }} />
              </label>
              {unitToCarton.length > 0 ? (
                <div className="v1-table-scroll"><table className="v1-table">
                  <thead>
                    <tr>
                      <th>{tr("装率 (排布)", "Pcs (Grid)")}</th>
                      <th className="num">{tr("外箱 (mm)", "Carton (mm)")}</th>
                      <th className="num">{tr("箱重", "Wt")}</th>
                      <th className="num">{tr("整柜总件数", "Total Units")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unitToCarton.map((c, i) => (
                      <tr key={i}>
                        <td>{`${c.pcsPerCarton} (${c.nx}×${c.ny}×${c.nz})`}</td>
                        <td className="num">{`${c.cartonLengthMm}×${c.cartonWidthMm}×${c.cartonHeightMm}`}</td>
                        <td className="num">{c.cartonWeightKg} kg</td>
                        <td className="num"><strong>{c.totalUnitsPerContainer.toLocaleString()}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              ) : (
                <p className="helper-text">{tr("当前单件重量或尺寸超限，请放宽限重。", "No valid master carton under current limits.")}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "freight" && (
        <div>
          <div className="v1-actions" style={{ marginTop: 0 }}>
            <label style={{ fontSize: 13 }}>
              {tr("整柜总运费：", "Total freight: ")}
              <input type="number" min={0} value={freightTotal} onChange={(e) => setFreightTotal(Number(e.target.value) || 0)} style={{ width: 96 }} />
            </label>
            <select value={freightCurrency} onChange={(e) => setFreightCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="CNY">CNY</option>
              <option value="EUR">EUR</option>
            </select>
            <select value={splitMethod} onChange={(e) => setSplitMethod(e.target.value as FreightSplitMethod)}>
              <option value="cbm">{tr("按体积占比 (CBM)", "By Volume (CBM)")}</option>
              <option value="wm">{tr("按计费重 (W/M 取大)", "By W/M (CBM vs Ton)")}</option>
              <option value="ldm">{tr("按占地长度 (LDM)", "By Loading Meter (LDM)")}</option>
            </select>
            <button type="button" className="button primary small" disabled={exportingFreight} onClick={() => void downloadFreightExcel()}>
              <FileSpreadsheet size={14} />
              {tr("导出运费分摊与单品成本表 (.xlsx)", "Export Freight Split Excel")}
            </button>
            <span className={`status-badge ${freightSplit.lifoCompliant ? "status-badge-success" : "status-badge-warning"}`}>
              {tr(freightSplit.lifoNoteZh, freightSplit.lifoNoteEn)}
            </span>
          </div>
          <div className="v1-table-scroll"><table className="v1-table">
            <thead>
              <tr>
                <th>{tr("卸货站", "Stop")}</th>
                <th>{tr("客户 / 收货人", "Consignee")}</th>
                <th>{tr("目的港", "Destination")}</th>
                <th className="num">{tr("箱数", "Ctns")}</th>
                <th className="num">CBM</th>
                <th className="num">{tr("毛重 (kg)", "Gross kg")}</th>
                <th className="num">{tr("占比", "Share")}</th>
                <th className="num">{tr(`分摊运费 (${freightCurrency})`, `Allocated (${freightCurrency})`)}</th>
              </tr>
            </thead>
            <tbody>
              {freightSplit.rows.map((r) => (
                <tr key={r.groupKey}>
                  <td>#{r.unloadStop}</td>
                  <td>{r.customer}</td>
                  <td>{r.destination}</td>
                  <td className="num">{r.cartons}</td>
                  <td className="num">{r.volumeCbm}</td>
                  <td className="num">{r.weightKg}</td>
                  <td className="num">{r.sharePercent}%</td>
                  <td className="num">{r.allocatedFreight.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "freight" && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-divider)" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("DDP / CIF 全链路落地成本分摊（含拖车、报关港杂、保费与关税）", "Full DDP / CIF Landed Cost Allocation")}</h4>
          <div className="v1-grid-3" style={{ marginBottom: 10 }}>
            <label>{tr("拖车费", "Trucking")} ({freightCurrency})<input type="number" min={0} value={truckingFee} onChange={(e) => setTruckingFee(Number(e.target.value) || 0)} /></label>
            <label>{tr("报关 + 港杂 THC/VGM", "Customs & Port THC")} ({freightCurrency})<input type="number" min={0} value={portCustomsFee} onChange={(e) => setPortCustomsFee(Number(e.target.value) || 0)} /></label>
            <label>{tr("保费 / 关税率 (%)", "Insurance / Duty %")}<div style={{ display: "flex", gap: 6 }}><input type="number" min={0} value={insuranceFee} onChange={(e) => setInsuranceFee(Number(e.target.value) || 0)} aria-label="Insurance" /><input type="number" min={0} step={0.5} value={dutyRatePct} onChange={(e) => setDutyRatePct(Number(e.target.value) || 0)} aria-label="Duty rate %" /></div></label>
          </div>
          <div className="v1-kpi-row">
            <div className="v1-kpi"><small>{tr("全链路物流总费用", "Total Landed Logistics")}</small><strong>{landedCost.currency} {landedCost.totalLogisticsCost.toLocaleString()}</strong></div>
            <div className="v1-kpi"><small>{tr("每立方米综合运费", "Landed Cost / CBM")}</small><strong>{landedCost.currency} {landedCost.costPerCbm.toFixed(2)}</strong></div>
            <div className="v1-kpi"><small>{tr("分摊 SKU 数", "Allocated SKUs")}</small><strong>{landedCost.rows.length}</strong></div>
          </div>
          <div className="v1-table-scroll"><table className="v1-table">
            <thead><tr><th>SKU</th><th className="num">{tr("箱数", "Ctns")}</th><th className="num">CBM</th><th className="num">{tr("占比", "Share")}</th><th className="num">{tr("分摊总物流费", "Allocated")}</th><th className="num">{tr("单箱物流费", "Per Carton")}</th></tr></thead>
            <tbody>
              {landedCost.rows.map((r) => (
                <tr key={r.sku}>
                  <td><strong>{r.sku}</strong></td>
                  <td className="num">{r.cartons}</td>
                  <td className="num">{r.cbm.toFixed(3)}</td>
                  <td className="num">{r.sharePct.toFixed(1)}%</td>
                  <td className="num">{landedCost.currency} {r.allocatedLogistics.toFixed(2)}</td>
                  <td className="num"><strong>{landedCost.currency} {r.logisticsPerCarton.toFixed(2)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "compliance" && (
        <div className="v1-grid-2">
          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("加固与防潮耗材 BOM 估算（EN 12195-1 参考）", "Dunnage & Securing BOM Estimate")}</h4>
            <div className="v1-kpi-row">
              <div className="v1-kpi"><small>{tr("充气袋推荐", "Dunnage airbags")}</small><strong>{dunnage.airbagsRecommended} {tr("个", "pcs")}</strong></div>
              <div className="v1-kpi"><small>{tr("集装箱干燥剂", "Desiccant poles")}</small><strong>{dunnage.desiccantPoles} {tr("条", "poles")}</strong></div>
              <div className="v1-kpi"><small>{tr("紧固拉带", "Lashing straps")}</small><strong>{dunnage.lashingStraps} {tr("条", "straps")}</strong></div>
              <div className="v1-kpi"><small>{tr("尾门预留净空", "Rear door void")}</small><strong>{dunnage.rearVoidMm} mm</strong></div>
            </div>
            <p className="helper-text">
              {tr(`侧向空隙约 ${dunnage.lateralGapMm} mm · 建议规格：${dunnage.airbagSpec}`, `Lateral gap ~${dunnage.lateralGapMm} mm · Spec: ${dunnage.airbagSpec}`)}
            </p>
            {reefer.isReefer && (
              <p className="helper-text">
                <span className={`status-badge ${reefer.violatesRedLine ? "status-badge-danger" : "status-badge-success"}`}>
                  {reefer.violatesRedLine
                    ? tr(`冷藏柜红线超限：装高 ${reefer.maxLoadedTopMm} mm > 红线 ${reefer.redLineHeightMm} mm`, `Reefer red-line exceeded: ${reefer.maxLoadedTopMm} > ${reefer.redLineHeightMm} mm`)
                    : tr(`冷藏柜回风红线合规（${reefer.maxLoadedTopMm} / ${reefer.redLineHeightMm} mm）`, `Reefer airflow OK (${reefer.maxLoadedTopMm} / ${reefer.redLineHeightMm} mm)`)}
                </span>
              </p>
            )}
          </div>
          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("目的地公路限重与高湿 BCT 抗压安全系数", "Road Payload Presets & Sea-Freight BCT Factor")}</h4>
            <div className="v1-actions" style={{ marginTop: 0 }}>
              <select value={roadPreset} onChange={(e) => setRoadPreset(e.target.value as RoadWeightPreset["id"])}>
                {ROAD_WEIGHT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{tr(p.labelZh, p.labelEn)}</option>
                ))}
              </select>
              {onApplyPayloadLimit && (
                <button type="button" className="button small" onClick={() => onApplyPayloadLimit(roadLimitKg)}>
                  {tr(`套用限重 ${roadLimitKg} kg`, `Apply ${roadLimitKg} kg`)}
                </button>
              )}
            </div>
            <p className="helper-text" style={{ marginTop: 6 }}>
              {plan.metrics.grossWeight > roadLimitKg
                ? tr(`⚠️ 当前总重 ${plan.metrics.grossWeight.toFixed(0)} kg 超过所选公路限重 ${roadLimitKg} kg`, `Warning: Gross weight ${plan.metrics.grossWeight.toFixed(0)} kg exceeds ${roadLimitKg} kg road limit`)
                : tr(`✓ 当前总重 ${plan.metrics.grossWeight.toFixed(0)} kg 符合所选限重（≤ ${roadLimitKg} kg）`, `OK: Gross weight ${plan.metrics.grossWeight.toFixed(0)} kg within ${roadLimitKg} kg limit`)}
            </p>
            <div className="v1-actions">
              <label style={{ fontSize: 13 }}>
                {tr("海运纸箱高湿安全系数：", "Sea-freight BCT factor: ")}
                <select value={bctFactor} onChange={(e) => setBctFactor(Number(e.target.value) as 1.5 | 2.5 | 3.0)}>
                  <option value={1.5}>{tr("1.5× 干燥内陆", "1.5× Dry inland")}</option>
                  <option value={2.5}>{tr("2.5× 标准海运", "2.5× Standard sea")}</option>
                  <option value={3.0}>{tr("3.0× 跨赤道高湿", "3.0× High humidity")}</option>
                </select>
              </label>
            </div>
            {bctWarnings.length > 0 ? (
              <ul style={{ margin: "6px 0", paddingLeft: 18, fontSize: 12 }}>
                {bctWarnings.map((w) => (
                  <li key={w.sku}>
                    <b>{w.sku}</b>: {tr(`底层静载 ${w.bottomLoadKg} kg × ${w.safetyFactor} = ${w.requiredSafeCapacityKg} kg > 额定 ${w.ratedMaxTopLoadKg} kg`, `Bottom load ${w.bottomLoadKg} kg × ${w.safetyFactor} = ${w.requiredSafeCapacityKg} kg > rated ${w.ratedMaxTopLoadKg} kg`)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="helper-text">{tr("当前已填承压资料的底层纸箱均满足所选安全系数。", "All bottom cartons with rated top-load data satisfy the selected BCT factor.")}</p>
            )}
          </div>
        </div>
      )}
      {tab === "compliance" && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-divider)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: 14 }}>{tr("特种柜 OOG 超限检测与绑扎建议（40OT 开顶柜 / 40FR 框架柜）", "OOG Special Container Check & Lashing (40OT / 40FR)")}</h4>
            <span className={`status-badge ${oogReport.hasOogCargo ? "status-badge-warning" : "status-badge-success"}`}>
              {oogReport.hasOogCargo ? tr(`需特种柜：${oogReport.recommendedEquipment}`, `OOG Required: ${oogReport.recommendedEquipment}`) : tr("常规柜尺寸合规", "Standard Envelope OK")}
            </span>
          </div>
          <div className="v1-kpi-row">
            <div className="v1-kpi"><small>{tr("最大超高 (+OH)", "Max Over-Height")}</small><strong>+{oogReport.maxOverHeightMm} mm</strong></div>
            <div className="v1-kpi"><small>{tr("最大超宽 (+OW)", "Max Over-Width")}</small><strong>+{oogReport.maxOverWidthMm} mm</strong></div>
            <div className="v1-kpi"><small>{tr("预估额外占舱位", "Est. Lost Slots")}</small><strong>{oogReport.totalEstimatedLostSlots} slots</strong></div>
            <div className="v1-kpi"><small>{tr("建议柜型", "Recommended")}</small><strong>{oogReport.recommendedEquipment}</strong></div>
          </div>
        </div>
      )}

            {tab === "advisory" && (
        <div className="v1-grid-2">
          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("整柜 vs 拼箱（FCL vs LCL）盈亏平衡决策", "FCL vs LCL Break-Even Advisor")}</h4>
            <div className="v1-grid-2" style={{ gap: 8 }}>
              <label style={{ fontSize: 12 }}>{tr(`LCL 单价 (${freightCurrency}/W/M)`, `LCL Rate (${freightCurrency}/WM)`)}<input type="number" min={0} value={lclRate} onChange={(e) => setLclRate(Number(e.target.value) || 0)} style={{ width: "100%" }} /></label>
              <label style={{ fontSize: 12 }}>{tr("LCL 固定港杂/CFS", "LCL Fixed CFS/DOC")}<input type="number" min={0} value={lclFixed} onChange={(e) => setLclFixed(Number(e.target.value) || 0)} style={{ width: "100%" }} /></label>
              <label style={{ fontSize: 12 }}>{tr("20GP 整柜全包价", "20GP All-In")}<input type="number" min={0} value={fcl20} onChange={(e) => setFcl20(Number(e.target.value) || 0)} style={{ width: "100%" }} /></label>
              <label style={{ fontSize: 12 }}>{tr("40GP 整柜全包价", "40GP All-In")}<input type="number" min={0} value={fcl40} onChange={(e) => setFcl40(Number(e.target.value) || 0)} style={{ width: "100%" }} /></label>
              <label style={{ fontSize: 12 }}>{tr("40HQ 整柜全包价", "40HQ All-In")}<input type="number" min={0} value={fcl40h} onChange={(e) => setFcl40h(Number(e.target.value) || 0)} style={{ width: "100%" }} /></label>
            </div>
            <div className="v1-kpi-row">
              <div className="v1-kpi"><small>{tr("推荐方式", "Recommended")}</small><strong>{fclLcl.recommended}</strong></div>
              <div className="v1-kpi"><small>{tr("相比 LCL 预计节省", "Savings vs LCL")}</small><strong>{freightCurrency} {fclLcl.savingsVsLcl}</strong></div>
              <div className="v1-kpi"><small>{tr("20GP 盈亏平衡点", "20GP Break-Even")}</small><strong>{fclLcl.breakEvenCbm20gp} CBM</strong></div>
            </div>
            <p className="helper-text">{tr(fclLcl.reasonZh, fclLcl.reasonEn)}</p>

            <h4 style={{ margin: "14px 0 8px", fontSize: 14 }}>{tr("IMDG 危品隔离 & IPPC 熏蒸自检", "IMDG Segregation & IPPC Check")}</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, marginBottom: 8 }}>
              {([
                ["foodstuffs", "食品", "Food"],
                ["class2_gas", "2类气体", "Class 2"],
                ["class3_flammable", "3类易燃", "Class 3"],
                ["class5_oxidizer", "5类氧化", "Class 5"],
                ["class6_toxic", "6类有毒", "Class 6"],
                ["class8_corrosive", "8类腐蚀", "Class 8"],
                ["class9_lithium", "9类锂电", "Class 9 Li-Ion"],
              ] as const).map(([cls, zh, en]) => (
                <label key={cls} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={hazmatSelected.includes(cls)}
                    onChange={(e) =>
                      setHazmatSelected((prev) => (e.target.checked ? [...prev, cls] : prev.filter((x) => x !== cls)))
                    }
                  />
                  {tr(zh, en)}
                </label>
              ))}
            </div>
            {hazmatReport.conflicts.length > 0 ? (
              <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 12, color: "var(--status-fail-fg)" }}>
                {hazmatReport.conflicts.map((c, idx) => <li key={idx}>{tr(c.noteZh, c.noteEn)}</li>)}
              </ul>
            ) : (
              <p className="helper-text">{tr("✓ 所选货物类别无 IMDG 强制同柜隔离冲突。", "✓ No IMDG container segregation conflict detected.")}</p>
            )}
            {hazmatReport.requiredDocsZh.length > 0 && (
              <p className="helper-text">
                <strong>{tr("必备单证：", "Required Docs: ")}</strong>
                {tr(hazmatReport.requiredDocsZh.join(" · "), hazmatReport.requiredDocsEn.join(" · "))}
              </p>
            )}
            <p className="helper-text" style={{ marginTop: 6 }}>
              <span className={`status-badge ${ippcReport.requiresIppcStamp ? "status-badge-warning" : "status-badge-success"}`}>
                {ippcReport.requiresIppcStamp ? tr("IPPC 熏蒸提醒", "IPPC Alert") : tr("IPPC 无风险", "IPPC Clear")}
              </span>{" "}
              {tr(ippcReport.noteZh, ippcReport.noteEn)}
            </p>
          </div>

          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("一键生成客户装柜确认邮件 & 全套外贸单证", "Client Confirmation Email & Full Trade Doc Pack")}</h4>
            <div className="v1-actions" style={{ marginTop: 0, marginBottom: 8 }}>
              <select aria-label="Email language" value={emailLang} onChange={(e) => setEmailLang(e.target.value as UiLanguage)} style={{ padding: "5px 8px", border: "1px solid var(--border-card)", borderRadius: 6, fontSize: 12, background: "var(--bg-surface)", color: "var(--text-primary)" }}>{SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
              <button
                type="button"
                className="button small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(clientEmail);
                    setCopiedMail(true);
                    setTimeout(() => setCopiedMail(false), 2000);
                  } catch {}
                }}
              >
                {copiedMail ? <Check size={14} /> : <Copy size={14} />}
                {copiedMail ? tr("已复制邮件", "Copied") : tr("复制邮件正文", "Copy Email")}
              </button>
              <select aria-label="Export unit" value={deliveryUnit} onChange={(e) => setDeliveryUnit(e.target.value as "metric" | "imperial")} style={{ padding: "5px 8px", border: "1px solid var(--border-card)", borderRadius: 6, fontSize: 12, background: "var(--bg-surface)", color: "var(--text-primary)" }}><option value="metric">CBM + kg</option><option value="imperial">CFT + lb</option></select>
              <button type="button" className="button primary small" disabled={exportingBundle} onClick={() => void downloadTradeBundle()}>
                <FileSpreadsheet size={14} />
                {tr("导出 CI + PL + 耗材三合一 Excel", "Export CI + PL + BOM Pack")}
              </button>
            </div>
            <textarea className="v1-textarea" readOnly value={clientEmail} style={{ minHeight: 240 }} />
          </div>
        </div>
      )}

      {tab === "vgm" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14 }}>{tr("3D 重心分布与桥轴偏载预警（防止美欧拖车偏载罚款）", "3D Center of Gravity & Axle Load Balance")}</h4>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className={`status-badge ${cogReport.status === "balanced" ? "status-badge-success" : "status-badge-warning"}`}>
                  {cogReport.status === "balanced" ? tr("重心均衡 · 通过", "Balanced · Pass") : cogReport.status === "caution" ? tr("轻度偏移 · 关注", "Minor Shift · Caution") : tr("偏载预警 · 需调整", "Imbalance Alert")}
                </span>
                <button
                  type="button"
                  className="button small"
                  onClick={() => {
                    const bias = cogReport.cogXPct < 48 ? "front-heavy" : cogReport.cogXPct > 52 ? "rear-heavy" : "balanced";
                    const next = rebalanceProductsForCoG(products, bias);
                    onApplyProducts?.(next);
                    setRebalancedNotice(true);
                    setTimeout(() => setRebalancedNotice(false), 3000);
                  }}
                >
                  {rebalancedNotice ? tr("✓ 已重排配重，请重算", "✓ Rebalanced") : tr("一键平衡配重重排", "Auto-Rebalance CoG")}
                </button>
              </div>
            </div>
            <div className="v1-kpi-row">
              <div className="v1-kpi"><small>{tr("前桥 / 车头承重", "Front / Nose Axle")}</small><strong>{cogReport.frontAxlePct}% ({cogReport.frontAxleKg.toLocaleString()} kg)</strong></div>
              <div className="v1-kpi"><small>{tr("后桥 / 柜门承重", "Rear / Door Axle")}</small><strong>{cogReport.rearAxlePct}% ({cogReport.rearAxleKg.toLocaleString()} kg)</strong></div>
              <div className="v1-kpi"><small>{tr("左右平衡 (左 / 右)", "Lateral (L / R)")}</small><strong>{cogReport.leftPct}% / {cogReport.rightPct}%</strong></div>
              <div className="v1-kpi"><small>{tr("重心高度占比", "CoG Height")}</small><strong>{cogReport.cogZPct}% ({cogReport.cogZMm} mm)</strong></div>
            </div>
            <svg viewBox="0 0 600 130" role="img" aria-label={tr("集装箱俯视重心分布图", "Top-down container center of gravity diagram")} style={{ width: "100%", maxWidth: 600, height: "auto", display: "block", border: "1px solid var(--border-card)", borderRadius: 8, background: "var(--bg-subtle)" }}>
              <rect x="30" y="20" width="540" height="84" rx="4" fill="none" stroke="var(--border-card)" strokeWidth="2" />
              <rect x="219" y="53.6" width="162" height="16.8" fill="var(--teal-soft)" stroke="var(--brand-primary)" strokeDasharray="4 3" strokeWidth="1" />
              <line x1="300" y1="20" x2="300" y2="104" stroke="var(--border-divider)" strokeDasharray="3 3" />
              <line x1="30" y1="62" x2="570" y2="62" stroke="var(--border-divider)" strokeDasharray="3 3" />
              <circle cx={30 + (cogReport.cogXPct / 100) * 540} cy={20 + (cogReport.cogYPct / 100) * 84} r="7" fill={cogReport.status === "balanced" ? "#0F766E" : "#D97706"} />
              <text x="34" y="14" fontSize="10" fill="var(--text-muted)">{tr("车头 / 柜内深处 (0%)", "Front / Nose (0%)")}</text>
              <text x="480" y="14" fontSize="10" fill="var(--text-muted)">{tr("柜门侧 (100%)", "Rear Door (100%)")}</text>
              <text x="34" y="120" fontSize="10" fill="var(--text-secondary)">CoG: X={cogReport.cogXMm}mm ({cogReport.cogXPct}%), Y={cogReport.cogYMm}mm ({cogReport.cogYPct}%), Z={cogReport.cogZMm}mm ({cogReport.cogZPct}%)</text>
            </svg>
            {cogReport.warningsZh.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--status-warn-fg)" }}>
                {cogReport.warningsZh.map((w, i) => <li key={i}>{tr(w, cogReport.warningsEn[i])}</li>)}
              </ul>
            )}
          </div>

          <div className="v1-grid-2" style={{ paddingTop: 12, borderTop: "1px solid var(--border-divider)" }}>
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("SOLAS VGM 集装箱核实总重申报单", "SOLAS VGM Declaration")}</h4>
              <div className="v1-grid-2" style={{ marginBottom: 8 }}>
                <label>{tr("订舱号 / 提单号", "Booking / B/L No.")}<input placeholder="BK-2026-001" value={vgmBookingNo} onChange={(e) => setVgmBookingNo(e.target.value)} /></label>
                <label>{tr("柜号", "Container No.")}<input placeholder="MSCU1234567" value={vgmContainerNo} onChange={(e) => setVgmContainerNo(e.target.value)} /></label>
                <label>{tr("封条号", "Seal No.")}<input placeholder="SL882910" value={vgmSealNo} onChange={(e) => setVgmSealNo(e.target.value)} /></label>
                <label>{tr("空箱皮重 (kg，CSC 铭牌)", "Container Tare (kg, CSC)")}<input type="number" min={1} value={vgmTareKg} onChange={(e) => { const n = Number(e.target.value); setVgmTareKg(Number.isFinite(n) ? n : 0); }} /></label>
                <label>{tr("发货人", "Shipper")}<input placeholder="Shipper Legal Name" value={vgmShipper} onChange={(e) => setVgmShipper(e.target.value)} /></label>
              </div>
              {Number.isFinite(vgmTareKg) && vgmTareKg > 0 ? (
                <p className="helper-text" style={{ marginBottom: 8 }}>
                  VGM = {(Math.round((plan.metrics.grossWeight + vgmTareKg) * 10) / 10).toLocaleString()} kg ({tr("货重", "Cargo")} {plan.metrics.grossWeight.toFixed(1)} kg + {tr("箱皮重", "Tare")} {vgmTareKg} kg)
                </p>
              ) : (
                <p className="helper-text" role="alert" style={{ marginBottom: 8, color: "var(--status-warn-fg)" }}>
                  {tr("空箱皮重必须大于 0 kg（请按集装箱 CSC 铭牌实填），否则不可导出 VGM。", "Container tare weight must be > 0 kg (per CSC plate) before exporting VGM.")}
                </p>
              )}
              <button type="button" className="button primary small" disabled={!Number.isFinite(vgmTareKg) || vgmTareKg <= 0} onClick={() => openHtmlSheet(buildVgmDeclarationHtml(plan, { containerNo: vgmContainerNo, sealNo: vgmSealNo, bookingNo: vgmBookingNo, shipper: vgmShipper, tareWeightKg: vgmTareKg, method: "Method 2" }), `VGM_${vgmContainerNo.trim() || "DRAFT"}.html`)}>
                <Printer size={14} aria-hidden="true" />{tr("打印 / 导出 SOLAS VGM 申报单", "Print / Export VGM Declaration")}
              </button>
            </div>

            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{tr("外箱正唛 / 侧唛批量 PDF 生成（自动连号）", "Batch Shipping Marks PDF (Sequential C/NO.)")}</h4>
              <div className="v1-grid-2" style={{ marginBottom: 8 }}>
                <label>{tr("收货人 / 唛头", "Consignee")}<input value={markConsignee} onChange={(e) => setMarkConsignee(e.target.value)} /></label>
                <label>{tr("目的港", "Destination")}<input value={markDest} onChange={(e) => setMarkDest(e.target.value)} /></label>
                <label>{tr("订单号 PO", "PO No.")}<input value={markPo} onChange={(e) => setMarkPo(e.target.value)} /></label>
              </div>
              <button type="button" className="button primary small" onClick={() => openHtmlSheet(buildShippingMarksHtml(plan, products, { consignee: markConsignee, destination: markDest, poNo: markPo, origin: "MADE IN CHINA" }), `Shipping_Marks_${markPo}.html`)}>
                <Printer size={14} aria-hidden="true" />{tr("一键生成批量箱唛 PDF", "Generate Batch Shipping Marks PDF")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
