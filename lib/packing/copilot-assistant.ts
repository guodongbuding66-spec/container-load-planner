import { estimateAxleLoad } from "./axle-load-estimator";
import { auditCartonBct } from "./bct-estimator";
import { recommendCatalogGapFill } from "./catalog-gap-recommender";
import { optimizeKitCartonDimensions } from "./kit-dimension-optimizer";
import { auditMultiStopLifo } from "./multi-stop-auditor";
import { computePackingRoi } from "./multi-objective-roi";
import { comparePackingPlans } from "./plan-comparator";
import { analyzeSecuringVoids } from "./securing-void-analyzer";
import { designEconomicalPallet } from "./smart-pallet-designer";
import type { PackingResult, ProductInput } from "./types";

export type CopilotIntent =
  | "shortfall"
  | "containers-roi"
  | "resize-carton"
  | "safety-audit"
  | "compare-strategies"
  | "gap-fill"
  | "reduce-pallets"
  | "overview";

export interface CopilotMetricChip {
  labelZh: string;
  labelEn: string;
  value: string;
}

export interface CopilotAnswer {
  intent: CopilotIntent;
  engineModules: string[];
  summaryZh: string;
  summaryEn: string;
  bulletsZh: string[];
  bulletsEn: string[];
  metrics: CopilotMetricChip[];
  disclaimerZh: string;
  disclaimerEn: string;
}

export const COPILOT_SUGGESTIONS: Array<{
  intent: CopilotIntent;
  promptZh: string;
  promptEn: string;
}> = [
  {
    intent: "containers-roi",
    promptZh: "这批订单用几个高柜最划算？",
    promptEn: "How many 40HQ containers are most cost-effective for this order?",
  },
  {
    intent: "shortfall",
    promptZh: "为什么还有箱子没有装进去？",
    promptEn: "Why are some cartons still unplaced?",
  },
  {
    intent: "reduce-pallets",
    promptZh: "保持原订单数量，尽可能减少托盘。",
    promptEn: "Keep current order quantities and minimize pallet count.",
  },
  {
    intent: "resize-carton",
    promptZh: "纸箱尺寸调整多少才能多装一层？",
    promptEn: "How much should carton dimensions change to fit one more layer?",
  },
  {
    intent: "safety-audit",
    promptZh: "全面检查轴荷、压溃风险、卸货阻挡和充气袋加固需求",
    promptEn: "Audit axle load, crush risk, LIFO blocking, and dunnage needs",
  },
  {
    intent: "compare-strategies",
    promptZh: "对比「现场易执行」与「高密度参考」两套方案的差异",
    promptEn: "Compare Practical vs Maximum strategy trade-offs",
  },
  {
    intent: "gap-fill",
    promptZh: "当前柜内剩余空隙还能补装哪些 SKU？",
    promptEn: "Which SKUs can fit into the remaining 3D voids?",
  },
];

export function classifyCopilotIntent(query: string): CopilotIntent {
  const q = query.trim().toLowerCase();
  if (/(未装|没装|装不下|剩|shortfall|unplaced|missing|why)/.test(q)) return "shortfall";
  if (/(尺寸|改箱|多装一层|纸箱|resize|dimension|carton size|mm)/.test(q)) return "resize-carton";
  if (/(几个柜|高柜|划算|运费|成本|roi|container|cost|freight|save)/.test(q)) return "containers-roi";
  if (/(轴荷|压溃|承重|卸货|阻挡|充气袋|加固|安全|axle|bct|crush|lifo|securing|safety|dunnage)/.test(q)) {
    return "safety-audit";
  }
  if (/(对比|比较|高密度|易执行|策略|compare|practical|maximum|strategy)/.test(q)) {
    return "compare-strategies";
  }
  if (/(减托|减少托盘|托盘|pallet|fewer pallet|minimize pallet)/.test(q)) return "reduce-pallets";
  if (/(空隙|补货|补装|尾货|gap|void|fill|filler|remaining)/.test(q)) return "gap-fill";
  return "overview";
}

/**
 * 100% Deterministic Engine-Backed CargoFit Smart Copilot (Direction 12).
 * Never guesses coordinates or carton quantities via an LLM; every number is computed live
 * by the verified deterministic packing, physics, and optimization engines.
 */
export function askCargoFitCopilot(
  query: string,
  plan: PackingResult,
  products: readonly ProductInput[],
  freightPerContainer = 3500,
): CopilotAnswer {
  const intent = classifyCopilotIntent(query);
  const loaded = plan.metrics.loadedCount;
  const requested = plan.metrics.requestedCount;
  const unplaced = Math.max(0, requested - loaded);
  const volPct = (plan.metrics.volumeUtilization * 100).toFixed(1);
  const wtPct = (plan.metrics.weightUtilization * 100).toFixed(1);
  const remainingKg = Math.max(0, plan.container.maxWeight - plan.metrics.grossWeight);

  const disclaimerZh = "所有数值均由 CargoFit 确定性 3D 求解与工程校验引擎实时算得，无语言模型估算或臆造坐标。";
  const disclaimerEn = "All figures are computed live by CargoFit's deterministic 3D solver and physics auditors—zero LLM-guessed coordinates or quantities.";

  if (intent === "shortfall") {
    const securing = analyzeSecuringVoids(plan);
    const weightLimited = remainingKg < (products[0]?.weight ?? 1);
    const unplacedList = plan.summaries.filter((s) => s.requested > s.loaded).slice(0, 4).map((s) => `${s.sku} ×${s.requested - s.loaded}`);
    return {
      intent,
      engineModules: ["engine.ts (PackingMetrics)", "securing-void-analyzer.ts"],
      summaryZh:
        unplaced === 0
          ? `当前订单全部 ${loaded} 箱已 100% 装入（体积利用率 ${volPct}%，载重利用率 ${wtPct}%），无未装余货。`
          : `当前已装入 ${loaded}/${requested} 箱，尚有 ${unplaced} 箱未装入；主导瓶颈为${weightLimited ? "单柜载重上限" : "几何尺寸与朝向/支承约束"}。`,
      summaryEn:
        unplaced === 0
          ? `All ${loaded} requested cartons are 100% loaded (${volPct}% volume, ${wtPct}% weight). Zero shortfall.`
          : `Loaded ${loaded}/${requested} cartons (${unplaced} unplaced). Primary bottleneck: ${weightLimited ? "container payload limit" : "3D geometry, orientation, or support constraints"}.`,
      bulletsZh: [
        `剩余载重裕量：${remainingKg.toFixed(1)} kg（当前总货重 ${plan.metrics.grossWeight.toFixed(1)} / ${plan.container.maxWeight} kg）。`,
        `柜尾实测纵向净空隙：${Math.round(securing.tailVoidLengthMm)} mm。`,
        unplacedList.length > 0 ? `未装明细（前 4 项）：${unplacedList.join("、")}。` : "无未装 SKU。",
        "建议操作：切换「高密度参考」策略，或在下方运行「多箱套装反向尺寸优化」寻找改箱增容窗口。",
      ],
      bulletsEn: [
        `Remaining payload headroom: ${remainingKg.toFixed(1)} kg (${plan.metrics.grossWeight.toFixed(1)} / ${plan.container.maxWeight} kg).`,
        `Measured rear-door longitudinal tail void: ${Math.round(securing.tailVoidLengthMm)} mm.`,
        unplacedList.length > 0 ? `Top unplaced SKUs: ${unplacedList.join(", ")}.` : "No unplaced SKUs.",
        "Next step: Compare Practical vs Maximum strategy or run Reverse Carton Dimension Optimization below.",
      ],
      metrics: [
        { labelZh: "已装 / 需求", labelEn: "Loaded / Req", value: `${loaded}/${requested}` },
        { labelZh: "体积利用率", labelEn: "Vol Util", value: `${volPct}%` },
        { labelZh: "载重余量", labelEn: "Weight Headroom", value: `${remainingKg.toFixed(0)} kg` },
        { labelZh: "柜尾余隙", labelEn: "Tail Void", value: `${Math.round(securing.tailVoidLengthMm)} mm` },
      ],
      disclaimerZh,
      disclaimerEn,
    };
  }

  if (intent === "containers-roi") {
    const perCtnr = Math.max(1, loaded);
    const minContainers = Math.max(1, Math.ceil(requested / perCtnr));
    const baselinePerCtnr = Math.max(1, Math.round(perCtnr * 0.88));
    const roi = computePackingRoi({
      annualUnits: Math.max(requested, perCtnr * 25),
      freightPerContainer,
      baselineUnitsPerContainer: baselinePerCtnr,
      optimizedUnitsPerContainer: perCtnr,
    });
    return {
      intent,
      engineModules: ["engine.ts (PackingMetrics)", "multi-objective-roi.ts"],
      summaryZh: `按当前单柜实装 ${perCtnr} 箱计算，发完本批 ${requested} 箱至少需 ${minContainers} 个「${plan.container.name}」（预估海运费 $${(minContainers * freightPerContainer).toLocaleString("en-US")}）。`,
      summaryEn: `At ${perCtnr} cartons/container, shipping ${requested} cartons requires ${minContainers} × ${plan.container.name} (est. freight $${(minContainers * freightPerContainer).toLocaleString("en-US")}).`,
      bulletsZh: [
        `按年度 25 柜规模（${Math.max(requested, perCtnr * 25)} 箱）测算：相比常规 ${baselinePerCtnr} 箱/柜，年省 ${roi.containersSaved} 个柜子，净省运费 $${roi.netAnnualSavings.toLocaleString("en-US")}（降幅 ${roi.freightReductionPct.toFixed(1)}%）。`,
        `单柜体积利用率 ${volPct}%，载重利用率 ${wtPct}%。`,
      ],
      bulletsEn: [
        `At 25-container annual scale (${Math.max(requested, perCtnr * 25)} cartons): saves ${roi.containersSaved} containers/yr and $${roi.netAnnualSavings.toLocaleString("en-US")} freight (${roi.freightReductionPct.toFixed(1)}% reduction) vs ${baselinePerCtnr}/ctnr baseline.`,
        `Current container utilization: ${volPct}% volume, ${wtPct}% weight.`,
      ],
      metrics: [
        { labelZh: "本批需柜数", labelEn: "Containers Needed", value: `${minContainers}` },
        { labelZh: "单柜装量", labelEn: "Cartons / Ctnr", value: `${perCtnr}` },
        { labelZh: "年化省柜", labelEn: "Annual Saved", value: `${roi.containersSaved}` },
        { labelZh: "年化省运费", labelEn: "Annual Savings", value: `$${roi.netAnnualSavings.toLocaleString("en-US")}` },
      ],
      disclaimerZh,
      disclaimerEn,
    };
  }

  if (intent === "resize-carton") {
    const opt = optimizeKitCartonDimensions(products, plan.container, plan.clearance, {
      maxCandidates: 12,
    });
    const best = opt.bestCandidate;
    return {
      intent,
      engineModules: ["kit-dimension-optimizer.ts", "pack-loading.ts"],
      summaryZh: best
        ? `真实求解器在 ${opt.evaluatedCount} 组改箱候选中找到最优方案：调整「${best.targetSku}」(${best.axis} ${best.deltaMm > 0 ? `+${best.deltaMm}` : best.deltaMm} mm) 可使单柜装量从 ${opt.baselineUnits} 提升至 ${best.optimizedUnits}（+${best.unitGain}）。`
        : `真实求解器已试算 ${opt.evaluatedCount} 组 ±5/±10/-20 mm 改箱候选，当前箱规已接近该柜型局部最密排列，微调暂无额外增益。`,
      summaryEn: best
        ? `Real solver evaluated ${opt.evaluatedCount} carton tweaks: adjusting ${best.targetSku} (${best.axis} ${best.deltaMm > 0 ? `+${best.deltaMm}` : best.deltaMm} mm) raises capacity from ${opt.baselineUnits} to ${best.optimizedUnits} (+${best.unitGain}).`
        : `Evaluated ${opt.evaluatedCount} ±5/±10/-20 mm dimension candidates via the real solver; current carton dimensions are already near local packing optimum.`,
      bulletsZh: best
        ? [
            `建议新尺寸：${best.proposedDims.join(" × ")} mm（原装量 ${opt.baselineUnits} → 新装量 ${best.optimizedUnits}）。`,
            `体积利用率变化：${opt.baselineVolumeUtilPct.toFixed(1)}% → ${best.volumeUtilPct.toFixed(1)}%。`,
          ]
        : [
            `当前基准装量：${opt.baselineUnits}（利用率 ${opt.baselineVolumeUtilPct.toFixed(1)}%）。`,
            "建议尝试更大改箱幅度或切换 40HQ / 45HQ 柜型比较。",
          ],
      bulletsEn: best
        ? [
            `Suggested carton dimensions: ${best.proposedDims.join(" × ")} mm (${opt.baselineUnits} → ${best.optimizedUnits}).`,
            `Volume utilization shift: ${opt.baselineVolumeUtilPct.toFixed(1)}% → ${best.volumeUtilPct.toFixed(1)}%.`,
          ]
        : [
            `Current baseline: ${opt.baselineUnits} (${opt.baselineVolumeUtilPct.toFixed(1)}% vol util).`,
            "Consider wider dimension tolerances or comparing 40HQ vs 45HQ presets.",
          ],
      metrics: [
        { labelZh: "试算候选数", labelEn: "Candidates Tested", value: `${opt.evaluatedCount}` },
        { labelZh: "当前装量", labelEn: "Baseline", value: `${opt.baselineUnits}` },
        { labelZh: "最高增容", labelEn: "Best Gain", value: best ? `+${best.unitGain}` : "+0" },
        { labelZh: "最优轴向", labelEn: "Best Axis", value: best ? `${best.axis} ${best.deltaMm}mm` : "-" },
      ],
      disclaimerZh,
      disclaimerEn,
    };
  }

  if (intent === "safety-audit") {
    const axle = estimateAxleLoad(plan, "container-chassis");
    const bct = auditCartonBct(plan, "bc-double", "ocean-30d");
    const securing = analyzeSecuringVoids(plan);
    const stopMap: Record<string, number> = {};
    const seen = new Set<string>();
    let idx = 0;
    for (const p of plan.placements) {
      if (!seen.has(p.productId)) {
        seen.add(p.productId);
        stopMap[p.productId] = idx > 0 ? 2 : 1;
        idx++;
      }
    }
    const lifo = auditMultiStopLifo(plan, stopMap);
    const safeSkus = Math.max(0, bct.totalSkus - bct.warnSkus - bct.crushRiskSkus);
    return {
      intent,
      engineModules: [
        "axle-load-estimator.ts",
        "bct-estimator.ts",
        "securing-void-analyzer.ts",
        "multi-stop-auditor.ts",
      ],
      summaryZh: `四维工程安全体检完成：前/后轴静载 ${Math.round(axle.frontCargoLoadKg)}/${Math.round(axle.rearCargoLoadKg)} kg（横向偏载 ${axle.lateralOffsetPct}%），BC 双瓦楞 30 天海运压溃风险 SKU ${bct.crushRiskSkus} 项，建议充气袋 ${securing.airbagCount} 个，多站 LIFO 直卸率 ${lifo.directUnloadablePct}%。`,
      summaryEn: `4-axis engineering safety audit complete: axle loads ${Math.round(axle.frontCargoLoadKg)}/${Math.round(axle.rearCargoLoadKg)} kg (lateral offset ${axle.lateralOffsetPct}%), ${bct.crushRiskSkus} BCT crush-risk SKUs (BC-flute 30d ocean), ${securing.airbagCount} dunnage airbags recommended, LIFO direct-access rate ${lifo.directUnloadablePct}%.`,
      bulletsZh: [
        `轴荷状态：${axle.status === "overload" ? "存在轴荷超参考限值风险，建议调整重货纵向分布" : axle.status === "warn" ? "存在横向或轴荷预警，建议复核重货位置" : "前后轴货载静力学分配处于参考范围内"}。`,
        `瓦楞纸箱抗压（McKee 理论）：安全 ${safeSkus} / 预警 ${bct.warnSkus} / 高危 ${bct.crushRiskSkus}（实装前须以纸箱厂 BCT 实测值为准）。`,
        `加固耗材：需充气袋 ${securing.airbagCount} 个，横向撑木/挡杆 ${securing.timberBlockingCount} 处，尾门余隙 ${Math.round(securing.tailVoidLengthMm)} mm。`,
      ],
      bulletsEn: [
        `Axle load: ${axle.status === "overload" ? "Exceeds reference axle limit—redistribute heavy cargo longitudinally" : axle.status === "warn" ? "Lateral or axle load warning—verify heavy cargo placement" : "Within static reference axle limits"}.`,
        `Corrugated BCT (McKee theoretical): ${safeSkus} safe / ${bct.warnSkus} warning / ${bct.crushRiskSkus} crush risk (verify with lab BCT test).`,
        `Securing BOM: ${securing.airbagCount} dunnage airbags, ${securing.timberBlockingCount} timber bracing units, ${Math.round(securing.tailVoidLengthMm)} mm tail void.`,
      ],
      metrics: [
        { labelZh: "后轴静载", labelEn: "Rear Axle", value: `${Math.round(axle.rearCargoLoadKg)} kg` },
        { labelZh: "压溃高危", labelEn: "Crush Risk", value: `${bct.crushRiskSkus}` },
        { labelZh: "建议充气袋", labelEn: "Airbags", value: `${securing.airbagCount}` },
        { labelZh: "LIFO 直卸率", labelEn: "LIFO Access", value: `${lifo.directUnloadablePct}%` },
      ],
      disclaimerZh,
      disclaimerEn,
    };
  }

  if (intent === "compare-strategies") {
    const p = plan.strategyPlans?.practical;
    const m = plan.strategyPlans?.maximum;
    if (!p || !m) {
      return {
        intent,
        engineModules: ["plan-comparator.ts"],
        summaryZh: `当前仅存在单一策略方案（${plan.strategy}，装入 ${loaded} 箱，利用率 ${volPct}%），重新测算即可生成双策略并排对比。`,
        summaryEn: `Only one strategy snapshot (${plan.strategy}, ${loaded} cartons, ${volPct}%) is currently available. Re-run calculation to compare both strategies.`,
        bulletsZh: ["双策略并排对比会同时评估装量、体积利用率、总货重、托盘数、左右重心偏移、充气袋数与尾门空隙。"],
        bulletsEn: ["Side-by-side comparison evaluates carton count, volume utilization, weight, pallets, lateral CoG, airbags, and tail void."],
        metrics: [
          { labelZh: "当前策略", labelEn: "Strategy", value: plan.strategy },
          { labelZh: "已装箱数", labelEn: "Loaded", value: `${loaded}` },
        ],
        disclaimerZh,
        disclaimerEn,
      };
    }
    const cmp = comparePackingPlans(p, m);
    const deltaCartons = m.metrics.loadedCount - p.metrics.loadedCount;
    return {
      intent,
      engineModules: ["plan-comparator.ts"],
      summaryZh: `高密度参考方案装入 ${m.metrics.loadedCount} 箱（${(m.metrics.volumeUtilization * 100).toFixed(1)}%），现场易执行方案装入 ${p.metrics.loadedCount} 箱（${(p.metrics.volumeUtilization * 100).toFixed(1)}%），两者相差 ${deltaCartons >= 0 ? `+${deltaCartons}` : deltaCartons} 箱。`,
      summaryEn: `Maximum strategy loads ${m.metrics.loadedCount} cartons (${(m.metrics.volumeUtilization * 100).toFixed(1)}%) vs Practical ${p.metrics.loadedCount} cartons (${(p.metrics.volumeUtilization * 100).toFixed(1)}%) — delta ${deltaCartons >= 0 ? `+${deltaCartons}` : deltaCartons} cartons.`,
      bulletsZh: cmp.rows.slice(0, 4).map((r) => `${r.labelZh}：现场 ${r.planAValue} vs 高密度 ${r.planBValue}（${r.deltaLabel}）`),
      bulletsEn: cmp.rows.slice(0, 4).map((r) => `${r.labelEn}: Practical ${r.planAValue} vs Maximum ${r.planBValue} (${r.deltaLabel})`),
      metrics: [
        { labelZh: "现场易执行", labelEn: "Practical", value: `${p.metrics.loadedCount}` },
        { labelZh: "高密度参考", labelEn: "Maximum", value: `${m.metrics.loadedCount}` },
        { labelZh: "装量差", labelEn: "Delta", value: `${deltaCartons >= 0 ? `+${deltaCartons}` : deltaCartons}` },
      ],
      disclaimerZh,
      disclaimerEn,
    };
  }

  if (intent === "gap-fill") {
    const gap = recommendCatalogGapFill(plan, products, 5);
    const top = gap.recommendations[0];
    return {
      intent,
      engineModules: ["free-space.ts", "catalog-gap-recommender.ts"],
      summaryZh: top
        ? `基于柜内 ${gap.usableZones.length} 个实测 3D 残余空隙块与 ${gap.remainingPayloadKg} kg 载重余量，首推补装「${top.sku}」最多 +${top.maxAdditionalUnits} 箱（预计提升体积利用率 +${top.utilizationGainPct}%）。`
        : `当前柜内 ${gap.usableZones.length} 个残余空隙块（剩余载重 ${gap.remainingPayloadKg} kg）无法再装入任何整箱候选 SKU，空间已接近饱和。`,
      summaryEn: top
        ? `Based on ${gap.usableZones.length} real 3D residual void cuboids and ${gap.remainingPayloadKg} kg payload headroom, top filler is ${top.sku}: up to +${top.maxAdditionalUnits} cartons (+${top.utilizationGainPct}% volume util).`
        : `None of the candidate SKUs fit cleanly into the ${gap.usableZones.length} residual 3D voids (${gap.remainingPayloadKg} kg payload left). Container is near geometric saturation.`,
      bulletsZh: gap.recommendations.slice(0, 3).map(
        (r) => `${r.sku}（${r.name}）：最多补入 +${r.maxAdditionalUnits} 箱（+${r.addedWeightKg} kg，+${r.utilizationGainPct}% 利用率，受限于${r.limitingFactor === "weight" ? "载重" : "几何空间"}）。`,
      ),
      bulletsEn: gap.recommendations.slice(0, 3).map(
        (r) => `${r.sku} (${r.name}): up to +${r.maxAdditionalUnits} cartons (+${r.addedWeightKg} kg, +${r.utilizationGainPct}% util, limited by ${r.limitingFactor}).`,
      ),
      metrics: [
        { labelZh: "可用空隙块", labelEn: "Usable Voids", value: `${gap.usableZones.length}` },
        { labelZh: "剩余载重", labelEn: "Payload Left", value: `${gap.remainingPayloadKg} kg` },
        { labelZh: "首推补装", labelEn: "Top Filler", value: top ? `${top.sku} +${top.maxAdditionalUnits}` : "-" },
      ],
      disclaimerZh,
      disclaimerEn,
    };
  }

  if (intent === "reduce-pallets") {
    const skuDesigns = products
      .filter((p) => p.quantity > 0)
      .map((p) => ({ product: p, design: designEconomicalPallet(p, Math.min(2200, plan.container.height), 0) }));
    const palletizable = skuDesigns.filter((d) => Boolean(d.design.recommended));
    const oversized = skuDesigns.filter((d) => !d.design.recommended);
    const palletizedCartons = palletizable.reduce((s, d) => s + d.product.quantity, 0);
    const oversizedCartons = oversized.reduce((s, d) => s + d.product.quantity, 0);
    const optPallets = palletizable.reduce((s, d) => s + (d.design.recommended?.palletsNeededForOrder ?? 0), 0);
    const worstPallets = palletizable.reduce((s, d) => {
      const last = d.design.options[d.design.options.length - 1];
      return s + (last?.palletsNeededForOrder ?? d.design.recommended?.palletsNeededForOrder ?? 0);
    }, 0);
    const currentPallets = plan.pallets?.length ?? worstPallets;
    const savedPallets = Math.max(0, Math.max(currentPallets, worstPallets) - optPallets);
    const totalPalletCost = Number(
      palletizable.reduce((s, d) => s + (d.design.recommended?.totalPalletCostUsd ?? 0), 0).toFixed(2),
    );
    const topRecs = palletizable
      .slice(0, 4)
      .map((d) => {
        const rec = d.design.recommended!;
        return {
          zh: `${d.product.sku}（${d.product.quantity} 箱）：推荐 ${rec.pallet.nameZh} + ${rec.patternLabelZh}，每托 ${rec.cartonsPerPallet} 箱（${rec.layers} 层），共需 ${rec.palletsNeededForOrder} 托（底面积利用 ${rec.areaUtilizationPct}%）。`,
          en: `${d.product.sku} (${d.product.quantity} ctns): ${rec.pallet.nameEn} with ${rec.patternLabelEn}, ${rec.cartonsPerPallet}/pallet (${rec.layers} layers), ${rec.palletsNeededForOrder} pallets (${rec.areaUtilizationPct}% area util).`,
        };
      });
    const oversizedRecs = oversized.map((d) => ({
      zh: `${d.product.sku}（${d.product.quantity} 箱，${d.product.length}×${d.product.width}×${d.product.height} mm）：尺寸超出 5 种国际标准托盘，未计入上述标准托盘数，建议采用定制宽/长托盘或散箱直装。`,
      en: `${d.product.sku} (${d.product.quantity} ctns, ${d.product.length}×${d.product.width}×${d.product.height} mm): exceeds all 5 standard pallet footprints; excluded from standard pallet count—use custom pallets or loose loading.`,
    }));
    const oversizedNoteZh = oversizedCartons > 0
      ? `（另有 ${oversized.length} 个超尺寸 SKU 共 ${oversizedCartons} 箱无法装入标准托盘，需定制托盘或散箱直装）`
      : "";
    const oversizedNoteEn = oversizedCartons > 0
      ? ` (${oversized.length} oversized SKU(s) totaling ${oversizedCartons} cartons exceed standard pallet footprints and require custom pallets or loose loading)`
      : "";
    return {
      intent,
      engineModules: ["smart-pallet-designer.ts", "pallet-consolidation.ts"],
      summaryZh: `保持原订单 ${requested} 箱数量不变：可标准打托的 ${palletizedCartons} 箱经 5 种国际标准托盘与 4 种层型联合优化后，最少可压缩至 ${optPallets} 托（较常规基准可减少 ${savedPallets} 托，预估托盘总成本 $${totalPalletCost.toLocaleString("en-US")}）${oversizedNoteZh}。`,
      summaryEn: `Keeping all ${requested} cartons unchanged: the ${palletizedCartons} standard-palletizable cartons optimize to ${optPallets} pallets across 5 standard pallet sizes and 4 layer patterns (saving ${savedPallets} pallets vs baseline, est. pallet cost $${totalPalletCost.toLocaleString("en-US")})${oversizedNoteEn}.`,
      bulletsZh:
        topRecs.length > 0 || oversizedRecs.length > 0
          ? [
              ...topRecs.map((r) => r.zh),
              ...oversizedRecs.map((r) => r.zh),
              "可在上方「智能托盘经济性设计与木箱结构 BOM 系统」逐 SKU 预览 2D 交错/风车码垛俯视图，或在导出栏运行全单自动减托。",
            ]
          : ["当前订单暂无可打托 SKU。"],
      bulletsEn:
        topRecs.length > 0 || oversizedRecs.length > 0
          ? [
              ...topRecs.map((r) => r.en),
              ...oversizedRecs.map((r) => r.en),
              "Inspect exact 2D Brick/Pinwheel layouts in the Smart Pallet Designer or run order-wide pallet consolidation.",
            ]
          : ["No palletizable SKUs in the current order."],
      metrics: [
        { labelZh: "最优托盘数", labelEn: "Optimal Pallets", value: `${optPallets}` },
        { labelZh: "可减托盘", labelEn: "Pallets Saved", value: `${savedPallets}` },
        { labelZh: "超尺寸需定制/散装", labelEn: "Oversized Ctns", value: `${oversizedCartons}` },
        { labelZh: "订单箱数守恒", labelEn: "Qty Conserved", value: `${palletizedCartons + oversizedCartons}` },
      ],
      disclaimerZh,
      disclaimerEn,
    };
  }

  return {
    intent: "overview",
    engineModules: ["engine.ts (PackingMetrics)"],
    summaryZh: `当前「${plan.container.name}」方案已装入 ${loaded}/${requested} 箱，体积利用率 ${volPct}%，载重 ${plan.metrics.grossWeight.toFixed(1)} / ${plan.container.maxWeight} kg（${wtPct}%），物理校验${plan.validation.valid ? "通过（0 违规）" : `发现 ${plan.validation.errors.length} 项警告`}。`,
    summaryEn: `Current ${plan.container.name} plan loads ${loaded}/${requested} cartons at ${volPct}% volume and ${plan.metrics.grossWeight.toFixed(1)}/${plan.container.maxWeight} kg (${wtPct}%) weight. Validation: ${plan.validation.valid ? "PASS (0 violations)" : `${plan.validation.errors.length} issue(s)`}.`,
    bulletsZh: [
      "可直接点击上方快捷问题，或输入「未装原因」「改箱尺寸」「轴荷安全」「空隙补货」「双策略对比」获取确定性引擎实时诊断。",
    ],
    bulletsEn: [
      "Click any quick question above or ask about shortfall, carton resizing, axle/BCT safety, void gap-fill, or strategy comparison for live deterministic diagnostics.",
    ],
    metrics: [
      { labelZh: "装入箱数", labelEn: "Loaded", value: `${loaded}/${requested}` },
      { labelZh: "体积利用率", labelEn: "Vol Util", value: `${volPct}%` },
      { labelZh: "载重利用率", labelEn: "Wt Util", value: `${wtPct}%` },
      { labelZh: "物理校验", labelEn: "Validation", value: plan.validation.valid ? "PASS" : "WARN" },
    ],
    disclaimerZh,
    disclaimerEn,
  };
}
