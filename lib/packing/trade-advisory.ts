import type { UiLanguage } from "./ui-locales";
import type { PackingResult, ProductInput } from "./types";
import { estimateDunnageBom } from "./trade-compliance";

/* ==================== 1. FCL vs LCL 盈亏平衡决策器 ==================== */
export interface FclLclPricing {
  lclRatePerWm: number;        // LCL 单方/单吨海运费 (e.g. $85/CBM)
  lclFixedFees: number;        // LCL 固定单证/拆箱/港杂费 (CFS + DDC + DOC, e.g. $450)
  fcl20gpAllIn: number;        // 20GP 整柜全包参考价 (e.g. $1850)
  fcl40gpAllIn: number;        // 40GP 整柜全包参考价 (e.g. $2600)
  fcl40hqAllIn: number;        // 40HQ 整柜全包参考价 (e.g. $2750)
  currency?: string;
}

export interface FclLclDecision {
  chargeableWm: number;
  lclTotal: number;
  fcl20gpTotal: number;
  fcl40gpTotal: number;
  fcl40hqTotal: number;
  recommended: "LCL" | "20GP" | "40GP" | "40HQ";
  savingsVsLcl: number;
  breakEvenCbm20gp: number;
  reasonZh: string;
  reasonEn: string;
}

export function compareFclVsLcl(
  totalCbm: number,
  totalWeightKg: number,
  pricing: FclLclPricing,
): FclLclDecision {
  const wm = Number(Math.max(1, totalCbm, totalWeightKg / 1000).toFixed(2));
  const lclTotal = Number((wm * pricing.lclRatePerWm + pricing.lclFixedFees).toFixed(2));
  const breakEvenCbm20gp =
    pricing.lclRatePerWm > 0
      ? Number(Math.max(1, (pricing.fcl20gpAllIn - pricing.lclFixedFees) / pricing.lclRatePerWm).toFixed(1))
      : 0;

  const fits20gp = totalCbm <= 28 && totalWeightKg <= 28000;
  const fits40gp = totalCbm <= 58 && totalWeightKg <= 28500;
  const fits40hq = totalCbm <= 68 && totalWeightKg <= 28600;

  let recommended: FclLclDecision["recommended"] = "LCL";
  let bestCost = lclTotal;

  if (fits20gp && pricing.fcl20gpAllIn < bestCost) {
    recommended = "20GP";
    bestCost = pricing.fcl20gpAllIn;
  }
  if (!fits20gp && fits40gp && pricing.fcl40gpAllIn < bestCost) {
    recommended = "40GP";
    bestCost = pricing.fcl40gpAllIn;
  }
  if (!fits40gp && fits40hq && pricing.fcl40hqAllIn < bestCost) {
    recommended = "40HQ";
    bestCost = pricing.fcl40hqAllIn;
  }
  // If cargo exceeds 28 CBM, even if LCL looks close, compare against 40GP/40HQ
  if (fits40gp && pricing.fcl40gpAllIn < bestCost) {
    recommended = "40GP";
    bestCost = pricing.fcl40gpAllIn;
  }
  if (fits40hq && pricing.fcl40hqAllIn < bestCost) {
    recommended = "40HQ";
    bestCost = pricing.fcl40hqAllIn;
  }

  const savingsVsLcl = Number(Math.max(0, lclTotal - bestCost).toFixed(2));
  const cur = pricing.currency || "USD";

  const reasonZh =
    recommended === "LCL"
      ? `按计费重 ${wm} W/M 测算，走 LCL 拼箱总价约 ${cur} ${lclTotal}，${fits40hq ? "在可承载的参考柜型中未发现更低整柜报价" : "超过单个参考柜型容量，请比较多柜或拼箱方案"}（20GP 价格临界点约 ${breakEvenCbm20gp} CBM）。`
      : `推荐走 ${recommended} 整柜：比 LCL 拼箱直接节省约 ${cur} ${savingsVsLcl}，且避免目的港高额 CFS 拆箱费与货损风险（20GP 盈亏临界点约 ${breakEvenCbm20gp} CBM）。`;
  const reasonEn =
    recommended === "LCL"
      ? `At ${wm} W/M, LCL (${cur} ${lclTotal}) ${fits40hq ? "has no lower FCL quote among reference container types that fit" : "exceeds single-container reference capacity; compare multiple containers or LCL"} (20GP price break-even ~${breakEvenCbm20gp} CBM).`
      : `Recommend ${recommended} FCL: saves ~${cur} ${savingsVsLcl} vs. LCL while eliminating CFS deconsolidation delays and damage risk (20GP break-even ~${breakEvenCbm20gp} CBM).`;

  return {
    chargeableWm: wm,
    lclTotal,
    fcl20gpTotal: pricing.fcl20gpAllIn,
    fcl40gpTotal: pricing.fcl40gpAllIn,
    fcl40hqTotal: pricing.fcl40hqAllIn,
    recommended,
    savingsVsLcl,
    breakEvenCbm20gp,
    reasonZh,
    reasonEn,
  };
}

/* ==================== 2. IMDG 危险品与敏感货隔离自检 ==================== */
export type HazmatClass =
  | "general"
  | "foodstuffs"
  | "class2_gas"
  | "class3_flammable"
  | "class5_oxidizer"
  | "class6_toxic"
  | "class8_corrosive"
  | "class9_lithium";

export interface HazmatConflict {
  pair: [HazmatClass, HazmatClass];
  severity: "incompatible" | "separated" | "away_from";
  noteZh: string;
  noteEn: string;
}

export interface HazmatAuditReport {
  safe: boolean;
  conflicts: HazmatConflict[];
  requiredDocsZh: string[];
  requiredDocsEn: string[];
}

const IMDG_RULES: Array<{ a: HazmatClass; b: HazmatClass; severity: HazmatConflict["severity"]; zh: string; en: string }> = [
  { a: "class3_flammable", b: "class5_oxidizer", severity: "incompatible", zh: "第 3 类易燃液体与第 5 类氧化剂严禁同柜混装（剧烈助燃风险）。", en: "Class 3 flammable liquids and Class 5 oxidizers are strictly incompatible in the same container." },
  { a: "class2_gas", b: "class5_oxidizer", severity: "incompatible", zh: "第 2 类气体/气雾剂与第 5 类氧化剂严禁同柜混装。", en: "Class 2 gases/aerosols and Class 5 oxidizers must not share a container." },
  { a: "class6_toxic", b: "foodstuffs", severity: "incompatible", zh: "第 6 类有毒物质严禁与食品/饲料同柜混装。", en: "Class 6 toxics are strictly forbidden with foodstuffs." },
  { a: "class8_corrosive", b: "foodstuffs", severity: "separated", zh: "第 8 类腐蚀品与食品不得同柜混装，需分柜隔离。", en: "Class 8 corrosives must be separated from foodstuffs." },
  { a: "class3_flammable", b: "class8_corrosive", severity: "away_from", zh: "第 3 类易燃液体与第 8 类腐蚀品需保持水平间距（Away From）并防泄漏。", en: "Class 3 flammables and Class 8 corrosives require horizontal separation (Away From)." },
  { a: "class9_lithium", b: "class3_flammable", severity: "away_from", zh: "第 9 类锂电池与第 3 类易燃液体同柜需远离隔离并确认船司审批。", en: "Class 9 lithium batteries with Class 3 flammables require carrier approval and separation." },
];

export function auditHazmatSegregation(classes: readonly HazmatClass[]): HazmatAuditReport {
  const unique = new Set<HazmatClass>(classes.filter((c) => c !== "general"));
  const conflicts: HazmatConflict[] = [];
  for (const rule of IMDG_RULES) {
    if (unique.has(rule.a) && unique.has(rule.b)) {
      conflicts.push({ pair: [rule.a, rule.b], severity: rule.severity, noteZh: rule.zh, noteEn: rule.en });
    }
  }

  const docsZh = new Set<string>();
  const docsEn = new Set<string>();
  if (unique.has("class9_lithium")) {
    docsZh.add("UN38.3 测试报告");
    docsZh.add("海运货物运输条件鉴定书");
    docsZh.add("MSDS (16项安全数据表)");
    docsEn.add("UN38.3 Test Summary");
    docsEn.add("Sea Transport Identification Report");
    docsEn.add("MSDS (16-section SDS)");
  }
  if (
    unique.has("class2_gas") ||
    unique.has("class3_flammable") ||
    unique.has("class5_oxidizer") ||
    unique.has("class6_toxic") ||
    unique.has("class8_corrosive")
  ) {
    docsZh.add("MSDS (16项安全数据表)");
    docsZh.add("危包证 / 出境危险货物运输包装使用鉴定结果单");
    docsZh.add("IMO Dangerous Goods Declaration (DGD)");
    docsEn.add("MSDS (16-section SDS)");
    docsEn.add("UN Packaging Performance Certificate");
    docsEn.add("IMO Dangerous Goods Declaration (DGD)");
  }

  return {
    safe: conflicts.every((c) => c.severity !== "incompatible" && c.severity !== "separated"),
    conflicts,
    requiredDocsZh: [...docsZh],
    requiredDocsEn: [...docsEn],
  };
}

/* ==================== 3. IPPC ISPM-15 实木托盘熏蒸合规提醒 ==================== */
export interface IppmComplianceReport {
  usesPalletsOrCrates: boolean;
  strictDestination: boolean;
  requiresIppcStamp: boolean;
  noteZh: string;
  noteEn: string;
}

const STRICT_IPPC_PATTERN = /(US|USA|LA|LONG BEACH|NEW YORK|SAVANNAH|EU|EUROPE|HAMBURG|ROTTERDAM|ANTWERP|FELIXSTOWE|UK|AU|AUSTRALIA|SYDNEY|MELBOURNE|NZ|CANADA|VANCOUVER|TORONTO|JAPAN|TOKYO|OSAKA|KOREA|BUSAN|美|欧|澳|加|日|韩|英)/i;

export function inspectIppmCompliance(plan: PackingResult, destinations: readonly string[] = []): IppmComplianceReport {
  const usesPalletsOrCrates = (plan.pallets?.length ?? 0) > 0;
  const joined = destinations.join(" ");
  const strictDestination = !joined.trim() || STRICT_IPPC_PATTERN.test(joined);
  const requiresIppcStamp = usesPalletsOrCrates && strictDestination;

  return {
    usesPalletsOrCrates,
    strictDestination,
    requiresIppcStamp,
    noteZh: requiresIppcStamp
      ? "当前方案含托盘/木箱：出口欧美澳加日韩等地区，如用实木必须加施 IPPC (ISPM-15) 热处理 HT 标识，或改用免熏蒸胶合板/塑料托盘，避免目的港退运或高额罚款。"
      : "当前未检测到木托盘/木箱熏蒸强制风险（若改用实木垫木/支撑条同样需 IPPC 标识）。",
    noteEn: requiresIppcStamp
      ? "Pallets/crates detected: solid wood packaging shipped to US/EU/AU/CA/JP/KR/UK requires IPPC ISPM-15 HT stamps, or switch to fumigation-free plywood/plastic pallets."
      : "No mandatory solid-wood IPPC pallet risk detected (verify any solid-wood dunnage separately).",
  };
}

/* ==================== 4. 一键生成给海外客户的装柜汇报邮件 ==================== */
export function buildClientSummaryEmail(
  plan: PackingResult,
  products: readonly ProductInput[],
  options: { lang: UiLanguage; containerFreight?: number; currency?: string; crewShareUrl?: string },
): string {
  const dunnage = estimateDunnageBom(plan, plan.container.rearDoorClearanceMm ?? 100);
  const loadedCbm = plan.metrics.loadedVolume / 1e9;
  const skuCount = Math.max(products.filter((p) => p.quantity > 0).length, new Set(plan.placements.map((b) => b.sku)).size);
  const volPct = plan.metrics.volumeUtilization ? (plan.metrics.volumeUtilization * 100).toFixed(1) : "0.0";
  const wtPct = plan.metrics.weightUtilization ? (plan.metrics.weightUtilization * 100).toFixed(1) : "0.0";
  const cur = options.currency || "USD";
  const freightLineZh = options.containerFreight
    ? `\n- 参考海运费分摊：${cur} ${(options.containerFreight / Math.max(0.01, loadedCbm)).toFixed(2)} / CBM`
    : "";
  const freightLineEn = options.containerFreight
    ? `\n- Est. Ocean Freight Allocation: ${cur} ${(options.containerFreight / Math.max(0.01, loadedCbm)).toFixed(2)} / CBM`
    : "";

  if (options.lang === "en") {
    return [
      `Subject: Container Loading Plan Summary — ${plan.container.name} (${plan.metrics.loadedCount} Cartons / ${loadedCbm.toFixed(2)} CBM)`,
      ``,
      `Dear Partner,`,
      ``,
      `Please find below the verified 3D container loading plan for your upcoming shipment (${skuCount} SKUs):`,
      `- Container Type: ${plan.container.name} (${plan.container.length} × ${plan.container.width} × ${plan.container.height} mm)`,
      `- Total Loaded: ${plan.metrics.loadedCount} cartons (${plan.pallets?.length ?? 0} pallets)`,
      `- Volume Utilization: ${loadedCbm.toFixed(2)} CBM (${volPct}%)`,
      `- Total Gross Weight: ${plan.metrics.grossWeight.toFixed(1)} kg (${wtPct}% of payload)${freightLineEn}`,
      `- Securing & Moisture Prep: ${dunnage.airbagsRecommended} dunnage airbags, ${dunnage.desiccantPoles} desiccant poles, ${dunnage.rearVoidMm} mm rear-door clearance`,
      options.crewShareUrl ? `- Live Warehouse Crew Link (no login required): ${options.crewShareUrl}` : "",
      ``,
      `Please review and confirm so our factory can proceed with stuffing and issue the final Packing List & inspection photos.`,
      ``,
      `Best regards,`,
    ]
      .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""))
      .join("\n");
  }

  const greetings: Partial<Record<UiLanguage, [string, string, string]>> = {
    es: ["Asunto: Resumen de Plan de Carga", "Estimado socio,", "Adjuntamos el resumen verificado del plan de carga 3D para su próximo envío:"],
    de: ["Betreff: Container-Ladeplan Übersicht", "Sehr geehrte Damen und Herren,", "Anbei finden Sie den geprüften 3D-Ladeplan für Ihre bevorstehende Sendung:"],
    fr: ["Objet : Résumé du Plan de Chargement", "Cher partenaire,", "Veuillez trouver ci-dessous le plan de chargement 3D vérifié pour votre expédition :"],
    ja: ["件名：コンテナ積載プランのご確認", "ご担当者様", "次回出荷の3Dコンテナ積載シミュレーション結果をご案内いたします。"],
    ko: ["제목: 컨테이너 적재 계획 안내", "담당자님께,", "예정된 선적 건의 3D 컨테이너 적재 계획을 공유드립니다."],
    pt: ["Assunto: Resumo do Plano de Carga", "Prezado parceiro,", "Segue abaixo o plano de carregamento 3D verificado para o seu próximo embarque:"],
  };
  const g = greetings[options.lang];
  if (g) {
    return [
      `${g[0]} — ${plan.container.name} (${plan.metrics.loadedCount} ctns / ${(plan.metrics.loadedVolume / 1e9).toFixed(2)} CBM)`,
      "",
      g[1],
      "",
      g[2],
      `- Container: ${plan.container.name} (${plan.container.length} × ${plan.container.width} × ${plan.container.height} mm)`,
      `- Total Loaded: ${plan.metrics.loadedCount} ctns`,
      `- Volume Utilization: ${(plan.metrics.loadedVolume / 1e9).toFixed(2)} CBM (${(plan.metrics.volumeUtilization * 100).toFixed(1)}%)`,
      `- Gross Weight: ${plan.metrics.grossWeight.toFixed(1)} kg (${wtPct}%)`,
      options.crewShareUrl ? `- Crew View QR Link: ${options.crewShareUrl}` : "",
      "",
      "Best regards / CargoFit",
    ].filter((line) => line !== "").join("\n");
  }
  return [
    `主题：装柜方案确认 — ${plan.container.name}（共 ${plan.metrics.loadedCount} 箱 / ${loadedCbm.toFixed(2)} CBM）`,
    ``,
    `您好，`,
    ``,
    `本票订单（共 ${skuCount} 个 SKU）的 3D 装柜方案已测算并完成核验，核心数据如下：`,
    `- 柜型规格：${plan.container.name}（${plan.container.length} × ${plan.container.width} × ${plan.container.height} mm）`,
    `- 装柜总量：${plan.metrics.loadedCount} 箱（含 ${plan.pallets?.length ?? 0} 托）`,
    `- 体积利用：${loadedCbm.toFixed(2)} CBM（利用率 ${volPct}%）`,
    `- 货物总毛重：${plan.metrics.grossWeight.toFixed(1)} kg（载重占比 ${wtPct}%）${freightLineZh}`,
    `- 现场加固防潮：建议充气袋 ${dunnage.airbagsRecommended} 个、干燥剂 ${dunnage.desiccantPoles} 条，尾门预留净空 ${dunnage.rearVoidMm} mm`,
    options.crewShareUrl ? `- 工厂免登录扫码装柜链接：${options.crewShareUrl}` : "",
    ``,
    `请您核对确认，确认后工厂将按此排布图装柜并提供装箱单（Packing List）及五图装柜留档报告。`,
    ``,
    `祝商祺！`,
  ]
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""))
    .join("\n");
}
