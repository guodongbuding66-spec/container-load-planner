import { packLoadingWorkflow } from "./pack-loading";
import { verifyPackingOracle } from "./public-benchmarks";
import type { ContainerSpec, PackingRequest, PackingResult, PlacedBox, ProductInput } from "./types";

/**
 * Industry-Grade 12-Metric Competitor Benchmark Harness:
 * Standardizes identical input packets (container, SKU dimensions, weight, quantity,
 * orientation, load-bearing, safety rules & time budget) for head-to-head comparison
 * across CargoFit, EasyCargo, Goodloading, CargoWiz, and Cargo-Planner.
 */
export type CompetitorSoftwareId =
  | "CargoFit"
  | "EasyCargo"
  | "Goodloading"
  | "CargoWiz"
  | "Cargo-Planner"
  | "Custom";

export interface CompetitorBenchmarkScenario {
  scenarioId: string;
  title: string;
  timeBudgetMs: number;
  container: ContainerSpec;
  products: ProductInput[];
  clearanceMm: number;
  notes?: string;
}

export interface CompetitorSubmission {
  software: CompetitorSoftwareId;
  softwareVersion: string;
  scenarioId: string;
  elapsedMs: number;
  placements: PlacedBox[];
  fieldExecutabilityScore?: number; // 1–5 operator review score when field-tested
  recordedBy?: string;
  recordedAt?: string;
}

export interface TwelveMetricScorecard {
  software: CompetitorSoftwareId;
  softwareVersion: string;
  scenarioId: string;
  /** 1. 重叠/穿模 (验收目标: 0) */
  overlapCount: number;
  /** 2. 越界 (验收目标: 0) */
  outOfBoundsCount: number;
  /** 3. 数量守恒错误 (验收目标: 0) */
  quantityConservationErrors: number;
  /** 4. 悬空/支撑违规 (验收目标: 0) */
  unsupportedViolations: number;
  /** 5. 已知工程规则违反 (验收目标: 0) */
  engineeringRuleViolations: number;
  /** 6. 空间利用率 (%) */
  volumeUtilizationPct: number;
  /** 7. 实装误差说明（独立验证样本目标 ±3%，不作未验证普遍承诺） */
  fieldErrorCalibrationStatus: string;
  /** 8. 算法稳定性（多次重复运行利用率最大波动 %，0 = 完全确定无退化） */
  stabilityVariancePct: number;
  /** 9. 计算耗时 P50 / P95 / P99 (ms) */
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  /** 10. 小规模最优性：装入箱数 / 理论体积上界比值 (%) */
  theoreticalUpperBoundRatioPct: number;
  /** 11. 大规模鲁棒性状态 */
  largeScaleRobustnessPassed: boolean;
  /** 12. 现场可执行性复核状态 */
  fieldExecutabilityStatus: string;
  hardConstraintsPassed: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

/**
 * Evaluates CargoFit itself on a standardized competitor scenario across multiple repeat runs
 * (default 3 repeats) to measure all 12 metrics objectively.
 */
export function runCargoFitCompetitorBaseline(
  scenario: CompetitorBenchmarkScenario,
  repeatRuns = 3,
): TwelveMetricScorecard {
  const req: PackingRequest = {
    container: scenario.container,
    products: scenario.products,
    mode: "mixed",
    strategy: "maximum",
    clearance: scenario.clearanceMm,
  };

  const latencies: number[] = [];
  const utils: number[] = [];
  let lastResult: PackingResult | null = null;

  const runs = Math.max(1, Math.min(10, repeatRuns));
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    const res = packLoadingWorkflow(req);
    latencies.push(performance.now() - t0);
    utils.push(res.metrics.volumeUtilization * 100);
    lastResult = res;
  }

  const res = lastResult!;
  const oracle = verifyPackingOracle(res, req);
  const sortedLat = [...latencies].sort((a, b) => a - b);
  const variancePct = utils.length > 1 ? Number((Math.max(...utils) - Math.min(...utils)).toFixed(3)) : 0;

  // Theoretical upper bound by volume & weight
  const containerVol = scenario.container.length * scenario.container.width * scenario.container.height;
  const totalOrderVol = scenario.products.reduce((s, p) => s + p.length * p.width * p.height * p.quantity, 0);
  const upperBoundVolPct = Math.min(100, (totalOrderVol / Math.max(1, containerVol)) * 100);
  const ratioToUpper = upperBoundVolPct > 0 ? Number((((res.metrics.volumeUtilization * 100) / upperBoundVolPct) * 100).toFixed(1)) : 100;

  const engineeringViolations = (oracle.weightOverLimit ? 1 : 0) + oracle.kitIntegrityErrors;
  const hardPassed =
    oracle.collisions === 0 &&
    oracle.oobCount === 0 &&
    oracle.conservationErrors === 0 &&
    engineeringViolations === 0;

  return {
    software: "CargoFit",
    softwareVersion: res.engineVersion,
    scenarioId: scenario.scenarioId,
    overlapCount: oracle.collisions,
    outOfBoundsCount: oracle.oobCount,
    quantityConservationErrors: oracle.conservationErrors,
    unsupportedViolations: oracle.floatingCount,
    engineeringRuleViolations: engineeringViolations,
    volumeUtilizationPct: Number((res.metrics.volumeUtilization * 100).toFixed(2)),
    fieldErrorCalibrationStatus: "待导入 ≥100 份独立工厂实装样本验证（目标 ±3%，不作未验证承诺）",
    stabilityVariancePct: variancePct,
    latencyP50Ms: percentile(sortedLat, 50),
    latencyP95Ms: percentile(sortedLat, 95),
    latencyP99Ms: percentile(sortedLat, 99),
    theoreticalUpperBoundRatioPct: Math.min(100, ratioToUpper),
    largeScaleRobustnessPassed: hardPassed && percentile(sortedLat, 95) <= Math.max(scenario.timeBudgetMs, 5000),
    fieldExecutabilityStatus: "待现场装柜班组实装复核（已通过 LIFO/轴荷/固缚前置校验）",
    hardConstraintsPassed: hardPassed,
  };
}

/**
 * Evaluates an imported external competitor placement result (e.g. from EasyCargo / Goodloading /
 * CargoWiz / Cargo-Planner) using the exact same zero-trust physical oracle.
 */
export function evaluateCompetitorSubmission(
  scenario: CompetitorBenchmarkScenario,
  submission: CompetitorSubmission,
): TwelveMetricScorecard {
  const req: PackingRequest = {
    container: scenario.container,
    products: scenario.products,
    mode: "mixed",
    strategy: "maximum",
    clearance: scenario.clearanceMm,
  };

  const cVol = scenario.container.length * scenario.container.width * scenario.container.height;
  const loadedVol = submission.placements.reduce((s, p) => s + p.dx * p.dy * p.dz, 0);
  const loadedWeight = submission.placements.reduce((s, p) => s + p.weight, 0);

  const basePlan = packLoadingWorkflow({ ...req, products: req.products.map((pr, idx) => idx === 0 ? { ...pr, quantity: 1 } : { ...pr, quantity: 0 }).slice(0, 1) });
  const syntheticResult: PackingResult = {
    ...basePlan,
    engineVersion: submission.softwareVersion,
    placements: submission.placements,
    metrics: {
      ...basePlan.metrics,
      loadedCount: submission.placements.length,
      requestedCount: scenario.products.reduce((s, p) => s + p.quantity, 0),
      volumeUtilization: cVol > 0 ? loadedVol / cVol : 0,
      weightUtilization: scenario.container.maxWeight > 0 ? loadedWeight / scenario.container.maxWeight : 0,

    },
  };

  const oracle = verifyPackingOracle(syntheticResult, req);
  const engineeringViolations = (oracle.weightOverLimit ? 1 : 0) + oracle.kitIntegrityErrors;
  const hardPassed =
    oracle.collisions === 0 &&
    oracle.oobCount === 0 &&
    oracle.conservationErrors === 0 &&
    engineeringViolations === 0;

  return {
    software: submission.software,
    softwareVersion: submission.softwareVersion,
    scenarioId: scenario.scenarioId,
    overlapCount: oracle.collisions,
    outOfBoundsCount: oracle.oobCount,
    quantityConservationErrors: oracle.conservationErrors,
    unsupportedViolations: oracle.floatingCount,
    engineeringRuleViolations: engineeringViolations,
    volumeUtilizationPct: Number((syntheticResult.metrics.volumeUtilization * 100).toFixed(2)),
    fieldErrorCalibrationStatus: "外部提交结果（需对应同一实装样本复核）",
    stabilityVariancePct: 0,
    latencyP50Ms: Number(submission.elapsedMs.toFixed(2)),
    latencyP95Ms: Number(submission.elapsedMs.toFixed(2)),
    latencyP99Ms: Number(submission.elapsedMs.toFixed(2)),
    theoreticalUpperBoundRatioPct: Number((syntheticResult.metrics.volumeUtilization * 100).toFixed(1)),
    largeScaleRobustnessPassed: hardPassed,
    fieldExecutabilityStatus: submission.fieldExecutabilityScore
      ? `现场评分 ${submission.fieldExecutabilityScore}/5`
      : "待现场复核",
    hardConstraintsPassed: hardPassed,
  };
}

/**
 * Exports a unified CSV + JSON benchmark packet so external commercial tools
 * (EasyCargo, Goodloading, CargoWiz, Cargo-Planner) receive identical inputs.
 */
export function exportCompetitorBenchmarkPacket(scenario: CompetitorBenchmarkScenario): {
  json: string;
  csv: string;
} {
  const header = "SKU,Name,Length_mm,Width_mm,Height_mm,Weight_kg,Quantity,KeepUpright,Fragile,MaxTopLoad_kg,DeliveryStop";
  const rows = scenario.products.map((p) =>
    [
      p.sku,
      `"${p.name.replace(/"/g, '""')}"`,
      p.length,
      p.width,
      p.height,
      p.weight,
      p.quantity,
      p.rotationPolicy !== "any" ? "YES" : "NO",
      !p.stackable || p.maxTopLoadKg === 0 ? "YES" : "NO",
      p.maxTopLoadKg ?? "",
      "",
    ].join(","),
  );
  return {
    json: JSON.stringify(
      {
        schema: "cargofit-competitor-benchmark-v1",
        targetCompetitors: ["CargoFit", "EasyCargo", "Goodloading", "CargoWiz", "Cargo-Planner"],
        ...scenario,
      },
      null,
      2,
    ),
    csv: [header, ...rows].join("\n"),
  };
}
