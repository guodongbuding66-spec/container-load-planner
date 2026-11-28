import type { PackingResult } from "./types";

export type SecuringItemKind = "airbag" | "timber-blocking" | "tail-lashing" | "cargo-bar";

export interface SecuringVoidRecommendation {
  id: string;
  zone: "lateral" | "tail-gate";
  xStartMm: number;
  xEndMm: number;
  gapWidthMm: number;
  stackHeightMm: number;
  kind: SecuringItemKind;
  specLabelZh: string;
  specLabelEn: string;
  estimatedQty: number;
  severity: "info" | "warn" | "critical";
  rationaleZh: string;
  rationaleEn: string;
}

export interface SecuringAnalysisReport {
  containerLengthMm: number;
  containerWidthMm: number;
  containerHeightMm: number;
  maxLoadedXMm: number;
  tailVoidLengthMm: number;
  maxLateralGapMm: number;
  airbagCount: number;
  timberBlockingCount: number;
  tailSecuringCount: number;
  recommendations: SecuringVoidRecommendation[];
  engineeringDisclaimerZh: string;
  engineeringDisclaimerEn: string;
}

const SLICE_STEP_MM = 1200; // 1.2m longitudinal inspection bay (matches standard pallet/dunnage spacing)

function pickAirbagSpec(gapMm: number, heightMm: number): { zh: string; en: string } {
  if (heightMm >= 1600) {
    return {
      zh: `充气袋 1000×1800 mm（适配 ${Math.round(gapMm)} mm 缝隙）`,
      en: `Dunnage airbag 1000×1800 mm (for ${Math.round(gapMm)} mm void)`,
    };
  }
  return {
    zh: `充气袋 900×1200 mm（适配 ${Math.round(gapMm)} mm 缝隙）`,
    en: `Dunnage airbag 900×1200 mm (for ${Math.round(gapMm)} mm void)`,
  };
}

/**
 * Scans real 3D placement geometry to detect lateral voids per longitudinal bay
 * and tail-gate free space, generating an engineering securing & dunnage list.
 */
export function analyzeSecuringVoids(result: PackingResult): SecuringAnalysisReport {
  const L = result.container.length;
  const W = result.container.width;
  const H = result.container.height;
  const boxes = result.placements;

  const disclaimerZh =
    "本清单基于当前 3D 装载坐标的真实几何空隙自动测算；充气袋耐压等级、绑带额定拉力（LC）与防滑摩擦系数须按实际运输方式及现场加固规范复核。";
  const disclaimerEn =
    "Generated from real 3D placement void geometry. Airbag pressure rating, lashing capacity (LC), and friction mats must be verified against actual transport securing standards.";

  if (!boxes.length) {
    return {
      containerLengthMm: L,
      containerWidthMm: W,
      containerHeightMm: H,
      maxLoadedXMm: 0,
      tailVoidLengthMm: L,
      maxLateralGapMm: W,
      airbagCount: 0,
      timberBlockingCount: 0,
      tailSecuringCount: 0,
      recommendations: [],
      engineeringDisclaimerZh: disclaimerZh,
      engineeringDisclaimerEn: disclaimerEn,
    };
  }

  const maxLoadedXMm = Math.max(...boxes.map((b) => b.x + b.dx));
  const tailVoidLengthMm = Math.max(0, Math.round(L - maxLoadedXMm));
  const recommendations: SecuringVoidRecommendation[] = [];

  let maxLateralGapMm = 0;
  let airbagCount = 0;
  let timberBlockingCount = 0;
  let tailSecuringCount = 0;

  // 1. Scan longitudinal bays (1.2m segments up to maxLoadedXMm) for lateral voids
  const bayCount = Math.max(1, Math.ceil(maxLoadedXMm / SLICE_STEP_MM));
  for (let bIdx = 0; bIdx < bayCount; bIdx++) {
    const x0 = bIdx * SLICE_STEP_MM;
    const x1 = Math.min(maxLoadedXMm, (bIdx + 1) * SLICE_STEP_MM);
    const inBay = boxes.filter((b) => b.x < x1 - 1 && b.x + b.dx > x0 + 1);
    if (!inBay.length) continue;

    // Merge Y intervals to compute exact uncovered lateral width in this bay
    const intervals = inBay
      .map((b) => [Math.max(0, b.y), Math.min(W, b.y + b.dy)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let coveredY = 0;
    let curStart = intervals[0][0];
    let curEnd = intervals[0][1];
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i][0] <= curEnd) {
        curEnd = Math.max(curEnd, intervals[i][1]);
      } else {
        coveredY += curEnd - curStart;
        curStart = intervals[i][0];
        curEnd = intervals[i][1];
      }
    }
    coveredY += curEnd - curStart;

    const lateralGap = Math.max(0, Math.round(W - coveredY));
    const stackHeight = Math.round(Math.max(...inBay.map((b) => b.z + b.dz)));
    if (lateralGap > maxLateralGapMm) maxLateralGapMm = lateralGap;

    if (lateralGap >= 80 && lateralGap <= 450) {
      const spec = pickAirbagSpec(lateralGap, stackHeight);
      const qty = stackHeight >= 1800 ? 2 : 1;
      airbagCount += qty;
      recommendations.push({
        id: `void-lat-${bIdx + 1}`,
        zone: "lateral",
        xStartMm: Math.round(x0),
        xEndMm: Math.round(x1),
        gapWidthMm: lateralGap,
        stackHeightMm: stackHeight,
        kind: "airbag",
        specLabelZh: spec.zh,
        specLabelEn: spec.en,
        estimatedQty: qty,
        severity: lateralGap >= 250 ? "warn" : "info",
        rationaleZh: `区段 ${Math.round(x0)}–${Math.round(x1)} mm 横向净余隙 ${lateralGap} mm（垛高 ${stackHeight} mm），建议置入充气袋防侧移。`,
        rationaleEn: `Bay ${Math.round(x0)}–${Math.round(x1)} mm has ${lateralGap} mm lateral void (stack ${stackHeight} mm); insert dunnage airbag(s).`,
      });
    } else if (lateralGap > 450) {
      const qty = Math.max(1, Math.ceil((x1 - x0) / 1000));
      timberBlockingCount += qty;
      recommendations.push({
        id: `void-lat-${bIdx + 1}`,
        zone: "lateral",
        xStartMm: Math.round(x0),
        xEndMm: Math.round(x1),
        gapWidthMm: lateralGap,
        stackHeightMm: stackHeight,
        kind: "timber-blocking",
        specLabelZh: `横向挡木／框架支撑（跨度 ${lateralGap} mm）`,
        specLabelEn: `Lateral timber blocking / frame brace (${lateralGap} mm span)`,
        estimatedQty: qty,
        severity: "critical",
        rationaleZh: `区段 ${Math.round(x0)}–${Math.round(x1)} mm 横向空隙达 ${lateralGap} mm（超过单气囊安全填充上限 450 mm），需使用挡木或横向撑杆加固。`,
        rationaleEn: `Bay ${Math.round(x0)}–${Math.round(x1)} mm lateral void is ${lateralGap} mm (>450 mm airbag cap); use timber blocking or cargo bars.`,
      });
    }
  }

  // 2. Tail-gate void analysis (anti-collapse toward container doors)
  const tailBoxes = boxes.filter((b) => b.x + b.dx >= maxLoadedXMm - 600);
  const tailHeight = tailBoxes.length ? Math.round(Math.max(...tailBoxes.map((b) => b.z + b.dz))) : 0;

  if (tailVoidLengthMm >= 150) {
    const isLargeTail = tailVoidLengthMm >= 600 || tailHeight >= 1500;
    const strapQty = tailHeight >= 1600 ? 2 : 1;
    tailSecuringCount += strapQty;
    recommendations.push({
      id: "void-tail-lashing",
      zone: "tail-gate",
      xStartMm: Math.round(maxLoadedXMm),
      xEndMm: Math.round(L),
      gapWidthMm: tailVoidLengthMm,
      stackHeightMm: tailHeight,
      kind: isLargeTail ? "cargo-bar" : "tail-lashing",
      specLabelZh: isLargeTail
        ? `尾门防倾倒挡杆 + 交叉绑带（尾隙 ${tailVoidLengthMm} mm）`
        : `尾门横向绑带／防坠网（尾隙 ${tailVoidLengthMm} mm）`,
      specLabelEn: isLargeTail
        ? `Tail-gate cargo bar + cross lashing (${tailVoidLengthMm} mm void)`
        : `Tail-gate lashing strap / safety net (${tailVoidLengthMm} mm void)`,
      estimatedQty: strapQty,
      severity: isLargeTail ? "warn" : "info",
      rationaleZh: `柜尾剩余纵向空隙 ${tailVoidLengthMm} mm（尾排垛高 ${tailHeight} mm），开门作业前需设置尾门防倾倒加固。`,
      rationaleEn: `${tailVoidLengthMm} mm free space at container door (tail stack ${tailHeight} mm); install tail-gate restraint before closing doors.`,
    });
  }

  return {
    containerLengthMm: L,
    containerWidthMm: W,
    containerHeightMm: H,
    maxLoadedXMm: Math.round(maxLoadedXMm),
    tailVoidLengthMm,
    maxLateralGapMm,
    airbagCount,
    timberBlockingCount,
    tailSecuringCount,
    recommendations,
    engineeringDisclaimerZh: disclaimerZh,
    engineeringDisclaimerEn: disclaimerEn,
  };
}


/* ==================== Direction 16: IMO/ILO/UNECE CTU Code Securing Mechanics ==================== */
export type CtuTransportMode = "sea-area-c" | "sea-area-b" | "road" | "rail";

export interface CtuSecuringInput {
  mode: CtuTransportMode;
  /** Friction coefficient mu between cargo base and floor (e.g. 0.25 steel-wood, 0.30 wood-wood, 0.45 carton-wood, 0.60 anti-slip mat). */
  frictionMu: number;
  /** Rated Lashing Capacity (LC) per strap in daN (default 2000 daN = 20 kN). */
  strapLcDan?: number;
  /** Whether rated lashing points & certified friction test report have been verified on site. */
  certifiedLashingDataProvided?: boolean;
}

export interface CtuSecuringReport {
  mode: CtuTransportMode;
  modeLabelZh: string;
  modeLabelEn: string;
  accelLongitudinalG: number;
  accelTransverseG: number;
  accelVerticalMinG: number;
  frictionMu: number;
  totalCargoMassKg: number;
  longitudinalResidualForceDan: number;
  transverseResidualForceDan: number;
  requiredLashingCapacityDan: number;
  recommendedStrapsCount: number;
  antiSlipMatAreaM2: number;
  cornerProtectorsCount: number;
  dividerBoardsCount: number;
  tippingRiskItemsCount: number;
  maxAspectRatioHB: number;
  status: "ok" | "warn" | "critical";
  dataCompletenessWarningsZh: string[];
  dataCompletenessWarningsEn: string[];
  referenceStandard: string;
}

const CTU_ACCELERATION_TABLE: Record<
  CtuTransportMode,
  { zh: string; en: string; cx: number; cy: number; czMin: number }
> = {
  "sea-area-c": { zh: "海运（远洋无限制航区 CTU Area C）", en: "Sea Transport (Unrestricted Area C)", cx: 0.4, cy: 0.8, czMin: 0.2 },
  "sea-area-b": { zh: "海运（近海航区 CTU Area B）", en: "Sea Transport (Coastal Area B)", cx: 0.4, cy: 0.7, czMin: 0.5 },
  road: { zh: "公路运输（CTU Road）", en: "Road Transport (CTU Road)", cx: 0.8, cy: 0.5, czMin: 1.0 },
  rail: { zh: "铁路运输（CTU Rail）", en: "Rail Transport (CTU Rail)", cx: 1.0, cy: 0.5, czMin: 0.7 },
};

/**
 * IMO/ILO/UNECE CTU Code Annex 7 engineering securing helper.
 * Computes sliding residual forces, tipping risk (H/B vs cy), lashing strap count,
 * anti-slip mat area, corner protectors & divider boards, and explicitly warns when
 * certified friction/lashing-point data is incomplete (never auto-claiming compliance).
 */
export function analyzeCtuSecuring(
  result: PackingResult,
  input: CtuSecuringInput = { mode: "sea-area-c", frictionMu: 0.35, strapLcDan: 2000, certifiedLashingDataProvided: false },
): CtuSecuringReport {
  const coeff = CTU_ACCELERATION_TABLE[input.mode];
  const mu = Math.max(0.1, Math.min(0.8, Number.isFinite(input.frictionMu) ? input.frictionMu : 0.35));
  const strapLc = Math.max(250, input.strapLcDan ?? 2000);
  const g = 9.81; // N/kg -> /10 for daN
  const boxes = result.placements;
  const totalCargoMassKg = Number(boxes.reduce((s, b) => s + Math.max(0, b.weight), 0).toFixed(1));

  // Sliding equilibrium per CTU Code: F_res = m * g * (c_dir - mu * c_z_min) [in daN = N/10]
  const lonCoeff = Math.max(0, coeff.cx - mu * coeff.czMin);
  const latCoeff = Math.max(0, coeff.cy - mu * coeff.czMin);
  const longitudinalResidualForceDan = Number(((totalCargoMassKg * g * lonCoeff) / 10).toFixed(1));
  const transverseResidualForceDan = Number(((totalCargoMassKg * g * latCoeff) / 10).toFixed(1));

  // Tipping risk: single placement or column where H / min(dx, dy) > 1 / cy (simplified static tipping limit)
  let tippingRiskItemsCount = 0;
  let maxAspectRatioHB = 0;
  let floorFootprintMm2 = 0;
  for (const b of boxes) {
    const baseMin = Math.max(1, Math.min(b.dx, b.dy));
    const ratio = b.dz / baseMin;
    if (ratio > maxAspectRatioHB) maxAspectRatioHB = ratio;
    if (ratio * coeff.cy > 1.0) tippingRiskItemsCount++;
    if (b.z <= 5) floorFootprintMm2 += b.dx * b.dy;
  }

  const requiredLashingCapacityDan = Number(
    Math.max(longitudinalResidualForceDan, transverseResidualForceDan).toFixed(1),
  );
  // Assuming 25% efficiency factor for top-over/direct lashing safety margin
  const effectiveStrapDan = strapLc * 0.75;
  const recommendedStrapsCount =
    requiredLashingCapacityDan > 0 ? Math.max(2, Math.ceil(requiredLashingCapacityDan / effectiveStrapDan)) : 2;
  const antiSlipMatAreaM2 = Number(((floorFootprintMm2 / 1_000_000) * 0.35).toFixed(2));
  const cornerProtectorsCount = recommendedStrapsCount * 2;
  const dividerBoardsCount = Math.max(0, Math.floor(result.container.length / 2400) - 1);

  const dataCompletenessWarningsZh: string[] = [];
  const dataCompletenessWarningsEn: string[] = [];
  if (!input.certifiedLashingDataProvided) {
    dataCompletenessWarningsZh.push(
      "未录入实测静摩擦系数与箱体绑扎环额定载荷（MSL），当前结果仅作工程辅助估算，不能替代正式 CTU Code 合规签发。",
    );
    dataCompletenessWarningsEn.push(
      "Verified friction test & container lashing-point MSL data not provided; output is an engineering aid and does not certify full CTU Code compliance.",
    );
  }
  if (tippingRiskItemsCount > 0) {
    dataCompletenessWarningsZh.push(
      `检测到 ${tippingRiskItemsCount} 件高宽比偏大货物（最大 H/B=${maxAspectRatioHB.toFixed(2)}），在 ${coeff.cy}g 横向加速度下存在倾覆风险，需加装挡木/护角或降高堆码。`,
    );
    dataCompletenessWarningsEn.push(
      `${tippingRiskItemsCount} items have high aspect ratio (max H/B=${maxAspectRatioHB.toFixed(2)}) with tipping risk at ${coeff.cy}g lateral acceleration.`,
    );
  }

  const status: CtuSecuringReport["status"] =
    tippingRiskItemsCount > 0 || requiredLashingCapacityDan > strapLc * 8
      ? "critical"
      : !input.certifiedLashingDataProvided || requiredLashingCapacityDan > 0
        ? "warn"
        : "ok";

  return {
    mode: input.mode,
    modeLabelZh: coeff.zh,
    modeLabelEn: coeff.en,
    accelLongitudinalG: coeff.cx,
    accelTransverseG: coeff.cy,
    accelVerticalMinG: coeff.czMin,
    frictionMu: mu,
    totalCargoMassKg,
    longitudinalResidualForceDan,
    transverseResidualForceDan,
    requiredLashingCapacityDan,
    recommendedStrapsCount,
    antiSlipMatAreaM2,
    cornerProtectorsCount,
    dividerBoardsCount,
    tippingRiskItemsCount,
    maxAspectRatioHB: Number(maxAspectRatioHB.toFixed(2)),
    status,
    dataCompletenessWarningsZh,
    dataCompletenessWarningsEn,
    referenceStandard: "IMO/ILO/UNECE Code of Practice for Packing of Cargo Transport Units (CTU Code, Annex 7)",
  };
}

/* ==================== Direction 16 Complete Extension: Full CTU Securing Accessory Kit (Airbags, Bracing, Bars, Desiccants) ==================== */

export interface CtuSecuringAccessoryKit {
  strapsCount: number;
  airbagsCount: number;
  airbagSpecMm: string;
  woodenBracingBeamsCount: number;
  blockingBarsCount: number;
  antiSlipMatAreaM2: number;
  cornerProtectorsCount: number;
  dividerBoardsCount: number;
  desiccantStripsCount: number;
}

export function estimateCtuSecuringAccessoryKit(
  result: PackingResult,
  ctu: CtuSecuringReport,
): CtuSecuringAccessoryKit {
  const voids = analyzeSecuringVoids(result);
  const airbagsCount = Math.max(
    voids.airbagCount ?? 0,
    ctu.transverseResidualForceDan > 0 ? Math.max(2, Math.ceil(result.container.length / 3000)) : 0,
  );
  const airbagSpecMm = result.container.height >= 2500 ? "900×1800 mm (Level 2 牛皮纸气袋)" : "900×1200 mm (Level 1 牛皮纸气袋)";
  const woodenBracingBeamsCount =
    ctu.tippingRiskItemsCount > 0 || ctu.longitudinalResidualForceDan > 1500
      ? Math.max(2, Math.ceil(ctu.longitudinalResidualForceDan / 1200))
      : 0;
  const blockingBarsCount = ctu.longitudinalResidualForceDan > 0 ? Math.max(2, Math.ceil(result.container.height / 1200)) : 2;
  const desiccantStripsCount = result.container.length >= 10000 ? 12 : 6;

  return {
    strapsCount: ctu.recommendedStrapsCount,
    airbagsCount,
    airbagSpecMm,
    woodenBracingBeamsCount,
    blockingBarsCount,
    antiSlipMatAreaM2: ctu.antiSlipMatAreaM2,
    cornerProtectorsCount: ctu.cornerProtectorsCount,
    dividerBoardsCount: ctu.dividerBoardsCount,
    desiccantStripsCount,
  };
}
