import { estimateAxleLoad } from "./axle-load-estimator";
import { analyzeSecuringVoids } from "./securing-void-analyzer";
import type { PackingResult } from "./types";

export interface FieldFeedbackRecord {
  id: string;
  recordedAt: string;
  containerName: string;
  containerNo: string;
  plannedCartons: number;
  actualCartons: number;
  plannedWeightKg: number;
  actualWeighedKg: number | null;
  plannedTailVoidMm: number;
  actualTailVoidMm: number | null;
  discrepancyCount: number;
  note: string;
  /** Optional product category / family for segmented error modeling (v2.0). */
  category?: string;
  /** Optional packaging revision tag (e.g. 'V2-5ply') (v2.0). */
  packagingVersion?: string;
  /** Optional factory or loading crew site identifier (v2.0). */
  factorySite?: string;
}

export interface CalibrationSummary {
  sampleCount: number;
  meanFillAchievementPct: number;
  meanWeightBiasPct: number | null;
  meanTailVoidDeltaMm: number | null;
  recommendedClearanceDeltaMm: number;
  recommendedPracticalCapPct: number;
  guidanceZh: string;
  guidanceEn: string;
}

export interface ParsedCrewCsvSummary {
  containerNo: string;
  plannedCartons: number;
  actualCartons: number;
  discrepancyCount: number;
}

export interface PlanSnapshotEntry {
  id: string;
  savedAt: string;
  label: string;
  containerName: string;
  strategy: "practical" | "maximum";
  loadedCount: number;
  volumeUtilPct: number;
  payloadKg: number;
  palletCount: number;
  lateralOffsetPct: number;
  airbagCount: number;
}

export const FIELD_CALIBRATION_STORAGE_KEY = "cargofit-field-calibration-v1";
export const PLAN_SNAPSHOTS_STORAGE_KEY = "cargofit-plan-snapshots-v1";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Parses CSV exported by /crew (buildCrewAuditCsv) into aggregated actuals. */
export function parseCrewAuditCsv(csvText: string): ParsedCrewCsvSummary {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let containerNo = "";
  let plannedCartons = 0;
  let actualCartons = 0;
  let discrepancyCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const recType = cols[0];
    if (!containerNo && cols[1] && cols[1] !== "TBD") containerNo = cols[1];
    if (recType === "SKU_SCAN") {
      const p = Number.parseInt(cols[4] ?? "0", 10);
      const a = Number.parseInt(cols[5] ?? "0", 10);
      if (Number.isFinite(p) && p > 0) plannedCartons += p;
      if (Number.isFinite(a) && a >= 0) actualCartons += a;
    } else if (recType === "DISCREPANCY") {
      discrepancyCount += 1;
    }
  }

  return { containerNo, plannedCartons, actualCartons, discrepancyCount };
}

export function summarizeFieldCalibration(records: readonly FieldFeedbackRecord[]): CalibrationSummary {
  if (!records.length) {
    return {
      sampleCount: 0,
      meanFillAchievementPct: 100,
      meanWeightBiasPct: null,
      meanTailVoidDeltaMm: null,
      recommendedClearanceDeltaMm: 0,
      recommendedPracticalCapPct: 95,
      guidanceZh: "尚无实装回传样本。导入 /crew 核验 CSV 或手工登记实装数据后，系统将自动计算装量达成率与安全间隙补偿建议。",
      guidanceEn: "No field feedback samples yet. Import a /crew scan-audit CSV or log actual load results to compute clearance calibration guidance.",
    };
  }

  const fillPcts = records
    .filter((r) => r.plannedCartons > 0)
    .map((r) => (r.actualCartons / r.plannedCartons) * 100);
  const meanFillAchievementPct = fillPcts.length
    ? Number((fillPcts.reduce((a, b) => a + b, 0) / fillPcts.length).toFixed(1))
    : 100;

  const weightBiases = records
    .filter((r) => r.actualWeighedKg !== null && r.plannedWeightKg > 0)
    .map((r) => (((r.actualWeighedKg! - r.plannedWeightKg) / r.plannedWeightKg) * 100));
  const meanWeightBiasPct = weightBiases.length
    ? Number((weightBiases.reduce((a, b) => a + b, 0) / weightBiases.length).toFixed(2))
    : null;

  const voidDeltas = records
    .filter((r) => r.actualTailVoidMm !== null)
    .map((r) => r.actualTailVoidMm! - r.plannedTailVoidMm);
  const meanTailVoidDeltaMm = voidDeltas.length
    ? Number((voidDeltas.reduce((a, b) => a + b, 0) / voidDeltas.length).toFixed(0))
    : null;

  // Conservative engineering heuristic: if actual cartons fall short (<98%) or actual tail void shrinks significantly (boxes bulged), suggest adding clearance
  let recommendedClearanceDeltaMm = 0;
  if (meanFillAchievementPct < 95) recommendedClearanceDeltaMm = 6;
  else if (meanFillAchievementPct < 98) recommendedClearanceDeltaMm = 3;
  else if (meanTailVoidDeltaMm !== null && meanTailVoidDeltaMm < -120) recommendedClearanceDeltaMm = 4;

  const recommendedPracticalCapPct = Math.min(
    96,
    Math.max(85, Math.round(95 * Math.min(1, meanFillAchievementPct / 100))),
  );

  const guidanceZh =
    recommendedClearanceDeltaMm > 0
      ? `基于 ${records.length} 柜实装样本（平均达成率 ${meanFillAchievementPct}%），建议下柜将安全间隙调增 +${recommendedClearanceDeltaMm} mm，现场实用利用率上限参考 ${recommendedPracticalCapPct}%。`
      : `基于 ${records.length} 柜实装样本（平均达成率 ${meanFillAchievementPct}%），当前装柜间隙模型与现场实装吻合度良好，可维持现有参数。`;
  const guidanceEn =
    recommendedClearanceDeltaMm > 0
      ? `Based on ${records.length} field sample(s) (mean fill ${meanFillAchievementPct}%), consider increasing clearance by +${recommendedClearanceDeltaMm} mm and setting practical cap near ${recommendedPracticalCapPct}%.`
      : `Based on ${records.length} field sample(s) (mean fill ${meanFillAchievementPct}%), current clearance aligns well with on-site execution.`;

  return {
    sampleCount: records.length,
    meanFillAchievementPct,
    meanWeightBiasPct,
    meanTailVoidDeltaMm,
    recommendedClearanceDeltaMm,
    recommendedPracticalCapPct,
    guidanceZh,
    guidanceEn,
  };
}

export function buildPlanSnapshot(plan: PackingResult, label?: string): PlanSnapshotEntry {
  const axle = estimateAxleLoad(plan, "container-chassis");
  const sec = analyzeSecuringVoids(plan);
  return {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    savedAt: new Date().toISOString(),
    label: label?.trim() || `${plan.container.name} · ${plan.strategy === "practical" ? "现场" : "高密度"}`,
    containerName: plan.container.name,
    strategy: plan.strategy,
    loadedCount: plan.metrics.loadedCount,
    volumeUtilPct: Number((plan.metrics.volumeUtilization * 100).toFixed(2)),
    payloadKg: Number(axle.cargoWeightKg.toFixed(1)),
    palletCount: plan.pallets?.length ?? 0,
    lateralOffsetPct: axle.lateralOffsetPct,
    airbagCount: sec.airbagCount,
  };
}


/* ==================== Pillar 5 (v2.0): Isolated Calibration vs Validation Loop ==================== */

export interface CategoryErrorProfile {
  key: string;
  sampleCount: number;
  meanFillRatioPct: number;
  meanAbsErrorPct: number;
  recommendedClearanceDeltaMm: number;
}

export interface FactoryCalibrationV2Report {
  totalRawSamples: number;
  outlierIds: string[];
  cleanSampleCount: number;
  calibrationSetCount: number;
  validationSetCount: number;
  /** Learned scale factor from calibration set only (e.g. 0.975 means actuals average 97.5% of planned). */
  learnedFillScaleFactor: number;
  /** 95% confidence interval for mean fill achievement on calibration set (%). */
  confidenceInterval95Pct: [number, number];
  /** Unbiased error metrics evaluated strictly on the HELD-OUT 30% validation set. */
  holdoutMaePct: number | null;
  holdoutP90ErrorPct: number | null;
  holdoutMaxErrorPct: number | null;
  meets3PctTarget: boolean | null;
  byCategory: CategoryErrorProfile[];
  byPackagingVersion: CategoryErrorProfile[];
  status: "insufficient-data" | "calibrating" | "verified-within-3pct" | "needs-tuning";
  guidanceZh: string;
  guidanceEn: string;
}

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function buildGroupProfiles(
  records: readonly FieldFeedbackRecord[],
  keyFn: (r: FieldFeedbackRecord) => string,
): CategoryErrorProfile[] {
  const groups = new Map<string, FieldFeedbackRecord[]>();
  for (const r of records) {
    const k = keyFn(r);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const ratios = list.map((r) => (r.plannedCartons > 0 ? r.actualCartons / r.plannedCartons : 1));
      const meanRatio = ratios.reduce((s, v) => s + v, 0) / ratios.length;
      const mae = (ratios.reduce((s, v) => s + Math.abs(v - 1), 0) / ratios.length) * 100;
      const deltaMm = meanRatio < 0.96 ? 4 : meanRatio < 0.985 ? 2 : meanRatio > 1.01 ? -1 : 0;
      return {
        key,
        sampleCount: list.length,
        meanFillRatioPct: Number((meanRatio * 100).toFixed(2)),
        meanAbsErrorPct: Number(mae.toFixed(2)),
        recommendedClearanceDeltaMm: deltaMm,
      };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount);
}

/**
 * Scientifically Isolated Factory Calibration & Holdout Backtest Engine (Pillar 5 / D23).
 * - Filters extreme IQR outliers so data entry typos never corrupt calibration parameters.
 * - Splits clean samples deterministically into 70% Calibration Set and 30% Independent Holdout Validation Set.
 * - Never validates accuracy on training/calibration samples.
 */
export function analyzeFactoryCalibrationV2(records: readonly FieldFeedbackRecord[]): FactoryCalibrationV2Report {
  const valid = records.filter((r) => r.plannedCartons > 0 && r.actualCartons >= 0);
  if (valid.length < 4) {
    return {
      totalRawSamples: valid.length,
      outlierIds: [],
      cleanSampleCount: valid.length,
      calibrationSetCount: valid.length,
      validationSetCount: 0,
      learnedFillScaleFactor: 1,
      confidenceInterval95Pct: [0, 0],
      holdoutMaePct: null,
      holdoutP90ErrorPct: null,
      holdoutMaxErrorPct: null,
      meets3PctTarget: null,
      byCategory: buildGroupProfiles(valid, (r) => r.category?.trim() || "未分类 / General"),
      byPackagingVersion: buildGroupProfiles(valid, (r) => r.packagingVersion?.trim() || "默认版本 / Default"),
      status: "insufficient-data",
      guidanceZh: `当前仅 ${valid.length} 条实装样本，至少需 ≥4 条（推荐 ≥30 条、独立工厂验证 ≥100 条）才能启动 70%/30% 隔离校准与独立回测。`,
      guidanceEn: `Only ${valid.length} field record(s) present. At least 4 records (30+ recommended, 100+ for factory certification) are required for isolated 70/30 calibration & holdout backtesting.`,
    };
  }

  // Step 1: IQR outlier detection on fill ratio (actual / planned)
  const ratiosAll = valid.map((r) => r.actualCartons / r.plannedCartons);
  const sortedRatios = [...ratiosAll].sort((a, b) => a - b);
  const q1 = quantile(sortedRatios, 0.25);
  const q3 = quantile(sortedRatios, 0.75);
  const iqr = Math.max(0.02, q3 - q1);
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;

  const outlierIds: string[] = [];
  const clean: FieldFeedbackRecord[] = [];
  for (const r of valid) {
    const ratio = r.actualCartons / r.plannedCartons;
    if (ratio < lowFence || ratio > highFence) {
      outlierIds.push(r.id);
    } else {
      clean.push(r);
    }
  }
  const effective = clean.length >= 4 ? clean : valid;

  // Step 2: Deterministic chronological/index 70% calibration / 30% independent holdout split
  const splitIdx = Math.max(2, Math.min(effective.length - 1, Math.floor(effective.length * 0.7)));
  const calSet = effective.slice(0, splitIdx);
  const valSet = effective.slice(splitIdx);

  const calRatios = calSet.map((r) => r.actualCartons / r.plannedCartons);
  const meanCal = calRatios.reduce((s, v) => s + v, 0) / calRatios.length;
  const variance =
    calRatios.length > 1
      ? calRatios.reduce((s, v) => s + (v - meanCal) ** 2, 0) / (calRatios.length - 1)
      : 0;
  const se = Math.sqrt(variance / Math.max(1, calRatios.length));
  const halfWidth = 1.96 * se;
  const ci95: [number, number] = [
    Number(Math.max(0, (meanCal - halfWidth) * 100).toFixed(2)),
    Number(Math.min(120, (meanCal + halfWidth) * 100).toFixed(2)),
  ];

  // Step 3: Evaluate calibrated predictions strictly on the held-out 30% validation set
  const holdoutErrorsPct = valSet.map((r) => {
    const calibratedPred = r.plannedCartons * meanCal;
    return (Math.abs(calibratedPred - r.actualCartons) / Math.max(1, r.actualCartons)) * 100;
  });
  const sortedErrs = [...holdoutErrorsPct].sort((a, b) => a - b);
  const holdoutMaePct = Number(
    (holdoutErrorsPct.reduce((s, v) => s + v, 0) / Math.max(1, holdoutErrorsPct.length)).toFixed(2),
  );
  const holdoutP90ErrorPct = Number(quantile(sortedErrs, 0.9).toFixed(2));
  const holdoutMaxErrorPct = Number((sortedErrs.at(-1) ?? 0).toFixed(2));
  const meets3PctTarget = effective.length >= 10 ? holdoutMaePct <= 3.0 : null;

  const status: FactoryCalibrationV2Report["status"] =
    effective.length < 10
      ? "calibrating"
      : holdoutMaePct <= 3.0
        ? "verified-within-3pct"
        : "needs-tuning";

  const guidanceZh =
    status === "verified-within-3pct"
      ? `独立 30% 验收集回测 MAE 为 ${holdoutMaePct}%（≤3% 目标达成），校准系数 ${meanCal.toFixed(3)}（95% CI: ${ci95[0]}%–${ci95[1]}%），已隔离 ${outlierIds.length} 条异常样本。`
      : status === "calibrating"
        ? `当前已完成 70%/30% 隔离试算（独立回测 MAE ${holdoutMaePct}%），但有效样本仅 ${effective.length} 条（<10），暂不宣称满足 ≤3% 工业精度认证。`
        : `独立 30% 验收集回测 MAE 为 ${holdoutMaePct}%（高于 3% 目标），建议按产品类别与包装版本细分余隙并复核现场装柜工艺。`;

  const guidanceEn =
    status === "verified-within-3pct"
      ? `Held-out 30% validation MAE is ${holdoutMaePct}% (within <=3% target), scale factor ${meanCal.toFixed(3)} (95% CI: ${ci95[0]}%–${ci95[1]}%), ${outlierIds.length} outlier(s) isolated.`
      : status === "calibrating"
        ? `Isolated 70/30 trial complete (holdout MAE ${holdoutMaePct}%), but only ${effective.length} clean samples (<10)—insufficient to certify <=3% industrial precision.`
        : `Held-out 30% validation MAE is ${holdoutMaePct}% (above 3% target). Segment clearance by product category and packaging revision.`;

  return {
    totalRawSamples: valid.length,
    outlierIds,
    cleanSampleCount: effective.length,
    calibrationSetCount: calSet.length,
    validationSetCount: valSet.length,
    learnedFillScaleFactor: Number(meanCal.toFixed(4)),
    confidenceInterval95Pct: ci95,
    holdoutMaePct,
    holdoutP90ErrorPct,
    holdoutMaxErrorPct,
    meets3PctTarget,
    byCategory: buildGroupProfiles(calSet, (r) => r.category?.trim() || "未分类 / General"),
    byPackagingVersion: buildGroupProfiles(calSet, (r) => r.packagingVersion?.trim() || "默认版本 / Default"),
    status,
    guidanceZh,
    guidanceEn,
  };
}
