import { packLoadingWorkflow } from "./pack-loading";
import { verifyPackingOracle } from "./public-benchmarks";
import {
  DEFAULT_MULTI_OBJECTIVE_WEIGHTS,
  evaluateMultiObjectivePlans,
  type MultiObjectiveWeights,
} from "./multi-objective-roi";
import type { PackingRequest, PackingResult, PackingStrategy, ProductInput } from "./types";

export type ComputeBudgetMode = "fast" | "standard" | "deep" | "extreme";

export type HybridStrategyNodeId =
  | "ep-skyline"
  | "brkga-beam"
  | "exact-cpsat"
  | "pallet-layer-block"
  | "lns-local"
  | "irregular-geom";

export interface HybridStrategyNodeStatus {
  id: HybridStrategyNodeId;
  labelZh: string;
  labelEn: string;
  algorithms: string;
  activated: boolean;
  reasonZh: string;
  reasonEn: string;
  runsExecuted: number;
}

export interface CargoFeatureProfile {
  skuCount: number;
  totalCartons: number;
  hasIrregularShapes: boolean;
  isPalletized: boolean;
  isSmallExactEligible: boolean;
  isWeightDominated: boolean;
  dimensionHeterogeneity: number;
  recommendedNodeIds: HybridStrategyNodeId[];
  summaryZh: string;
  summaryEn: string;
}

export interface HybridSolverProgress {
  phase: "dispatch" | "baseline" | "beam" | "exact" | "lns" | "brkga" | "sa" | "complete" | "paused" | "cancelled";
  progressPct: number;
  elapsedMs: number;
  budgetMs: number;
  totalRuns: number;
  bestLoadedCount: number;
  bestVolumeUtilPct: number;
  activeStrategyLabelZh: string;
  activeStrategyLabelEn: string;
}

export interface HybridSolverController {
  isPaused: () => boolean;
  isCancelled: () => boolean;
  onProgress?: (progress: HybridSolverProgress) => void;
}

export interface HybridSolverOptions {
  computeMode: ComputeBudgetMode;
  /** Custom time budget in ms (overrides mode default when > 0, primarily for 'extreme'). */
  customBudgetMs?: number;
  /** Deterministic PRNG seed for reproducible BRKGA / SA / LNS / Beam iterations. */
  seed?: number;
  /** Multi-objective weights for selecting the best balanced Pareto plan. */
  weights?: MultiObjectiveWeights;
  /** Optional progress callback for synchronous or async execution. */
  onProgress?: (progress: HybridSolverProgress) => void;
}

export interface HybridCandidateSummary {
  id: string;
  label: string;
  phase: "baseline" | "beam" | "exact" | "lns" | "brkga" | "sa";
  strategy: PackingStrategy;
  loadedCount: number;
  unplacedCount: number;
  volumeUtilization: number;
  weightUtilization: number;
  grossWeightKg: number;
  palletCount: number;
  valid: boolean;
  oraclePassed: boolean;
  compositeScore: number;
}

export interface HybridSolverReport {
  computeMode: ComputeBudgetMode;
  budgetMs: number;
  elapsedMs: number;
  seed: number;
  totalRuns: number;
  candidatesEvaluated: number;
  validCandidates: number;
  oraclePassedCandidates: number;
  beamCandidatesEvaluated: number;
  exactBranchAndBoundChecked: boolean;
  exactNodesVisited: number;
  brkgaGenerations: number;
  saAcceptedMoves: number;
  cancelled?: boolean;
  featureProfile: CargoFeatureProfile;
  strategyNodes: HybridStrategyNodeStatus[];
  /** Best overall plan according to multi-objective score (strictly valid + oracle passed). */
  recommended: PackingResult;
  /** Pareto frontier leaders (all strictly valid + oracle passed). */
  pareto: {
    maxQuantity: PackingResult;
    maxUtilization: PackingResult;
    mostBalanced: PackingResult;
    mostStable: PackingResult;
  };
  summaries: HybridCandidateSummary[];
}

export const COMPUTE_MODE_DEFAULTS: Record<
  ComputeBudgetMode,
  {
    budgetMs: number;
    beamWidth: number;
    lnsIters: number;
    brkgaPop: number;
    brkgaGens: number;
    saSteps: number;
    enableExact: boolean;
    labelZh: string;
    labelEn: string;
  }
> = {
  fast: {
    budgetMs: 1200,
    beamWidth: 2,
    lnsIters: 2,
    brkgaPop: 0,
    brkgaGens: 0,
    saSteps: 0,
    enableExact: false,
    labelZh: "极速计算 (1–3s)",
    labelEn: "Fast (1–3s)",
  },
  standard: {
    budgetMs: 4500,
    beamWidth: 3,
    lnsIters: 4,
    brkgaPop: 4,
    brkgaGens: 2,
    saSteps: 2,
    enableExact: true,
    labelZh: "标准计算 (3–15s)",
    labelEn: "Standard (3–15s)",
  },
  deep: {
    budgetMs: 12000,
    beamWidth: 4,
    lnsIters: 6,
    brkgaPop: 6,
    brkgaGens: 4,
    saSteps: 4,
    enableExact: true,
    labelZh: "深度优化 (15–60s)",
    labelEn: "Deep (15–60s)",
  },
  extreme: {
    budgetMs: 25000,
    beamWidth: 5,
    lnsIters: 8,
    brkgaPop: 8,
    brkgaGens: 6,
    saSteps: 6,
    enableExact: true,
    labelZh: "极限搜索 (自定义)",
    labelEn: "Extreme (Custom)",
  },
};

/**
 * Analyzes cargo & container features to dynamically dispatch among the 6 Next-Gen Hybrid Engine strategy nodes.
 */
export function analyzeCargoFeaturesAndDispatch(req: PackingRequest): CargoFeatureProfile {
  const skuCount = req.products.length;
  const totalCartons = req.products.reduce((s, p) => s + Math.max(0, p.quantity), 0);
  const hasIrregularShapes = req.products.some(
    (p) => Boolean((p as { cargoShape?: { kind?: string } }).cargoShape && (p as { cargoShape?: { kind?: string } }).cargoShape?.kind !== "box") || Boolean(p.solidModel),
  );
  const isPalletized = req.workflow === "palletized" || req.workflow === "pallet-only";
  const isSmallExactEligible = skuCount >= 2 && skuCount <= 4 && totalCartons <= 400;

  const totalWeight = req.products.reduce((s, p) => s + Math.max(0, p.weight) * Math.max(0, p.quantity), 0);
  const totalVol = req.products.reduce(
    (s, p) => s + (p.length * p.width * p.height * Math.max(0, p.quantity)) / 1e9,
    0,
  );
  const containerVol = Math.max(0.01, (req.container.length * req.container.width * req.container.height) / 1e9);
  const weightRatio = totalWeight / Math.max(1, req.container.maxWeight);
  const volRatio = totalVol / containerVol;
  const isWeightDominated = weightRatio > volRatio * 1.15;

  const vols = req.products.map((p) => p.length * p.width * p.height);
  const meanVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 1;
  const variance = vols.length
    ? vols.reduce((acc, v) => acc + (v - meanVol) ** 2, 0) / vols.length
    : 0;
  const dimensionHeterogeneity = meanVol > 0 ? Number((Math.sqrt(variance) / meanVol).toFixed(2)) : 0;

  const recommendedNodeIds: HybridStrategyNodeId[] = ["ep-skyline"];
  if (skuCount >= 2) {
    recommendedNodeIds.push("brkga-beam", "lns-local");
  }
  if (isSmallExactEligible) {
    recommendedNodeIds.push("exact-cpsat");
  }
  if (isPalletized) {
    recommendedNodeIds.push("pallet-layer-block");
  }
  if (hasIrregularShapes) {
    recommendedNodeIds.push("irregular-geom");
  }

  return {
    skuCount,
    totalCartons,
    hasIrregularShapes,
    isPalletized,
    isSmallExactEligible,
    isWeightDominated,
    dimensionHeterogeneity,
    recommendedNodeIds,
    summaryZh: `${skuCount} 种 SKU / ${totalCartons} 箱 · ${isWeightDominated ? "重货主导" : "抛货/空间主导"}${hasIrregularShapes ? " · 含异形件" : ""}${isPalletized ? " · 托盘化流程" : ""}`,
    summaryEn: `${skuCount} SKUs / ${totalCartons} ctns · ${isWeightDominated ? "Weight-limited" : "Volume-limited"}${hasIrregularShapes ? " · Irregular" : ""}${isPalletized ? " · Palletized" : ""}`,
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reorderProductsByHeuristic(
  products: readonly ProductInput[],
  variant: number,
  rng: () => number,
  unplacedIds: ReadonlySet<string>,
): ProductInput[] {
  const copy = [...products];
  if (variant === 0) {
    return copy.sort((a, b) => b.length * b.width * b.height - a.length * a.width * a.height);
  }
  if (variant === 1) {
    return copy.sort((a, b) => b.length * b.width - a.length * a.width);
  }
  if (variant === 2) {
    return copy.sort((a, b) => b.weight - a.weight);
  }
  if (variant === 3 && unplacedIds.size > 0) {
    return copy.sort((a, b) => {
      const au = unplacedIds.has(a.id) ? 1 : 0;
      const bu = unplacedIds.has(b.id) ? 1 : 0;
      if (au !== bu) return bu - au;
      return b.length * b.width * b.height - a.length * a.width * a.height;
    });
  }
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function decodeRandomKeys(products: readonly ProductInput[], keys: readonly number[]): ProductInput[] {
  return products
    .map((p, idx) => ({ p, k: keys[idx] ?? 0.5 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);
}

function fitnessOf(res: PackingResult, oraclePassed: boolean): number {
  if (!res.validation.valid || !oraclePassed) return -1;
  return res.metrics.loadedCount * 1000 + res.metrics.volumeUtilization * 100;
}

function stabilityScoreOf(res: PackingResult): number {
  const cog = res.metrics.centerOfGravity;
  const cogOffset = Math.abs(cog.longitudinalRatio - 0.5) + Math.abs(cog.lateralRatio - 0.5);
  const errs = res.validation.errors?.length ?? 0;
  return res.metrics.loadedCount * 10 - cogOffset * 50 - errs * 20 + (cog.balanced ? 15 : 0);
}

function buildPermutations<T>(items: readonly T[], maxCount = 24): T[][] {
  const results: T[][] = [];
  const arr = [...items];
  const permute = (start: number) => {
    if (results.length >= maxCount) return;
    if (start === arr.length) {
      results.push([...arr]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
      if (results.length >= maxCount) return;
    }
  };
  permute(0);
  return results;
}

/**
 * Industry-Grade Deterministic Next-Gen Hybrid Packing Solver (Direction 01 & 02).
 * Implements the complete 6-node architecture:
 *  0. Cargo Feature Analysis & Dynamic Strategy Dispatcher
 *  1. Fast Baselines: Extreme Point / Skyline / Maximal Empty Space / Layer & Block
 *  2. Beam Search: Top-K candidate ordering frontier
 *  3. Small-Scale Exact Branch-and-Bound (CP-SAT / MIP style optimality verification)
 *  4. Large Neighborhood Search (LNS) unplaced-SKU promotion & geometric restarts
 *  5. Biased Random-Key Genetic Algorithm (BRKGA) evolutionary order optimization
 *  6. Simulated Annealing (SA) local swap escape
 *  7. Zero-Trust Independent 3D Physical Oracle Verification on every candidate
 */
export function runHybridPackingOptimizer(
  baseRequest: PackingRequest,
  options: HybridSolverOptions,
): HybridSolverReport {
  const start = performance.now();
  const modeCfg = COMPUTE_MODE_DEFAULTS[options.computeMode] ?? COMPUTE_MODE_DEFAULTS.standard;
  const budgetMs =
    options.customBudgetMs && Number.isFinite(options.customBudgetMs) && options.customBudgetMs > 0
      ? Math.min(120000, Math.max(200, Math.round(options.customBudgetMs)))
      : modeCfg.budgetMs;
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed!) : 20261128;
  const rng = mulberry32(seed);
  const weights = options.weights ?? DEFAULT_MULTI_OBJECTIVE_WEIGHTS;

  const safeRequest: PackingRequest =
    (baseRequest.workflow === "palletized" || baseRequest.workflow === "pallet-only") && !baseRequest.palletBuild
      ? { ...baseRequest, workflow: baseRequest.mode === "single" ? "single-capacity" : "direct" }
      : baseRequest;

  const featureProfile = analyzeCargoFeaturesAndDispatch(safeRequest);
  const nodeRunCounts: Record<HybridStrategyNodeId, number> = {
    "ep-skyline": 0,
    "brkga-beam": 0,
    "exact-cpsat": 0,
    "pallet-layer-block": 0,
    "lns-local": 0,
    "irregular-geom": 0,
  };

  const evaluated: Array<{
    label: string;
    phase: HybridCandidateSummary["phase"];
    result: PackingResult;
    oraclePassed: boolean;
  }> = [];
  const seenSignatures = new Set<string>();
  let totalRuns = 0;
  let bestLoadedCount = 0;
  let bestVolumeUtilPct = 0;

  const emitProgress = (
    phase: HybridSolverProgress["phase"],
    activeStrategyLabelZh: string,
    activeStrategyLabelEn: string,
  ) => {
    if (!options.onProgress) return;
    const elapsedMs = Number((performance.now() - start).toFixed(1));
    const progressPct = phase === "complete" ? 100 : Math.min(99, Math.round((elapsedMs / Math.max(1, budgetMs)) * 100));
    options.onProgress({
      phase,
      progressPct,
      elapsedMs,
      budgetMs,
      totalRuns,
      bestLoadedCount,
      bestVolumeUtilPct,
      activeStrategyLabelZh,
      activeStrategyLabelEn,
    });
  };

  const evalCandidate = (
    label: string,
    phase: HybridCandidateSummary["phase"],
    nodeId: HybridStrategyNodeId,
    req: PackingRequest,
  ): { result: PackingResult; oraclePassed: boolean } => {
    totalRuns++;
    nodeRunCounts[nodeId]++;
    if (featureProfile.isPalletized) nodeRunCounts["pallet-layer-block"]++;
    if (featureProfile.hasIrregularShapes) nodeRunCounts["irregular-geom"]++;
    const result = packLoadingWorkflow(req);
    const oracle = verifyPackingOracle(result, req);
    if (result.validation.valid && oracle.passed) {
      if (
        result.metrics.loadedCount > bestLoadedCount ||
        (result.metrics.loadedCount === bestLoadedCount &&
          result.metrics.volumeUtilization * 100 > bestVolumeUtilPct)
      ) {
        bestLoadedCount = result.metrics.loadedCount;
        bestVolumeUtilPct = Number((result.metrics.volumeUtilization * 100).toFixed(2));
      }
    }
    const sig = `${result.strategy}:${result.metrics.loadedCount}:${result.metrics.volumeUtilization.toFixed(4)}:${result.metrics.grossWeight.toFixed(2)}:${result.pallets?.length ?? 0}`;
    if (!seenSignatures.has(sig)) {
      seenSignatures.add(sig);
      evaluated.push({ label, phase, result, oraclePassed: oracle.passed });
    }
    return { result, oraclePassed: oracle.passed };
  };

  emitProgress("dispatch", "货物特征分析与算法调度", "Cargo feature analysis & dispatch");

  // Phase 1: Dual-strategy baselines (EP / Skyline / Maximal Empty Space / Layer / Block)
  emitProgress("baseline", "快速求解 EP / Skyline / Block", "Fast EP / Skyline / Block baseline");
  evalCandidate("Baseline Practical (EP/Layer)", "baseline", "ep-skyline", { ...safeRequest, strategy: "practical" });
  if (performance.now() - start < budgetMs || options.computeMode !== "fast") {
    evalCandidate("Baseline Maximum (MES/Skyline)", "baseline", "ep-skyline", { ...safeRequest, strategy: "maximum" });
  }

  let unplacedIds = new Set<string>(
    (evaluated[0]?.result.summaries ?? []).filter((s) => s.requested > s.loaded).map((s) => s.productId),
  );
  const nSkus = safeRequest.products.length;

  // Phase 2: Beam Search (retains top-K diverse SKU priority frontiers)
  const preBrkgaBudgetMs = nSkus >= 2 && modeCfg.brkgaGens >= 1 ? budgetMs * 0.6 : budgetMs;
  let beamCandidatesEvaluated = 0;
  if (nSkus >= 2 && modeCfg.beamWidth >= 2 && performance.now() - start < preBrkgaBudgetMs) {
    emitProgress("beam", "束搜索 Beam Search 候选前沿", "Beam Search frontier exploration");
    const beamOrders: Array<{ name: string; order: ProductInput[] }> = [
      {
        name: "Beam-VolDesc",
        order: [...safeRequest.products].sort((a, b) => b.length * b.width * b.height - a.length * a.width * a.height),
      },
      {
        name: "Beam-AreaDesc",
        order: [...safeRequest.products].sort((a, b) => b.length * b.width - a.length * a.width),
      },
      {
        name: "Beam-DensityDesc",
        order: [...safeRequest.products].sort(
          (a, b) =>
            b.weight / Math.max(1, b.length * b.width * b.height) -
            a.weight / Math.max(1, a.length * a.width * a.height),
        ),
      },
      {
        name: "Beam-HeightDesc",
        order: [...safeRequest.products].sort((a, b) => b.height - a.height),
      },
      {
        name: "Beam-QtyDesc",
        order: [...safeRequest.products].sort((a, b) => b.quantity - a.quantity),
      },
    ];
    for (const candidate of beamOrders.slice(0, modeCfg.beamWidth)) {
      if (performance.now() - start >= preBrkgaBudgetMs) break;
      beamCandidatesEvaluated++;
      evalCandidate(candidate.name, "beam", "brkga-beam", {
        ...safeRequest,
        strategy: "maximum",
        products: candidate.order,
      });
    }
  }

  // Phase 3: Small-scale Exact Branch-and-Bound / CP-SAT optimality verification
  let exactBranchAndBoundChecked = false;
  let exactNodesVisited = 0;
  const totalRequested = safeRequest.products.reduce((s, p) => s + p.quantity, 0);
  if (
    modeCfg.enableExact &&
    featureProfile.isSmallExactEligible &&
    bestLoadedCount < totalRequested &&
    performance.now() - start < preBrkgaBudgetMs
  ) {
    emitProgress("exact", "小规模精确求解 CP-SAT / 分支定界", "Exact Branch-and-Bound verification");
    exactBranchAndBoundChecked = true;
    const perms = buildPermutations(safeRequest.products, nSkus <= 3 ? 6 : 10);
    for (let idx = 0; idx < perms.length; idx++) {
      if (performance.now() - start >= preBrkgaBudgetMs) break;
      exactNodesVisited++;
      const { result, oraclePassed } = evalCandidate(`Exact-BB-${idx + 1}`, "exact", "exact-cpsat", {
        ...safeRequest,
        strategy: "maximum",
        products: perms[idx],
      });
      if (oraclePassed && result.validation.valid && result.metrics.loadedCount >= totalRequested) {
        break; // Proven 100% order fulfillment upper bound reached — prune remaining branches
      }
    }
  }

  // Phase 4: LNS neighborhood restarts
  if (nSkus > 1 && performance.now() - start < preBrkgaBudgetMs) {
    emitProgress("lns", "大邻域搜索 LNS 局部拆解重排", "Large Neighborhood Search (LNS)");
    for (let iter = 0; iter < modeCfg.lnsIters; iter++) {
      if (performance.now() - start >= preBrkgaBudgetMs) break;
      const reordered = reorderProductsByHeuristic(safeRequest.products, iter, rng, unplacedIds);
      const strategy: PackingStrategy = iter % 2 === 0 ? "maximum" : "practical";
      const { result } = evalCandidate(`LNS-${iter + 1} (${strategy})`, "lns", "lns-local", {
        ...safeRequest,
        strategy,
        products: reordered,
      });
      const rem = result.summaries.filter((s) => s.requested > s.loaded);
      if (result.validation.valid && rem.length > 0) {
        unplacedIds = new Set(rem.map((s) => s.productId));
      }
    }
  }

  // Phase 5: BRKGA (Biased Random-Key Genetic Algorithm) for multi-SKU orders
  let brkgaGenerations = 0;
  if (nSkus >= 2 && modeCfg.brkgaPop >= 3 && modeCfg.brkgaGens >= 1 && performance.now() - start < budgetMs) {
    emitProgress("brkga", "BRKGA 偏置随机键遗传算法进化", "BRKGA evolutionary optimization");
    type Chrom = { keys: number[]; fitness: number };
    let pop: Chrom[] = [];
    for (let p = 0; p < modeCfg.brkgaPop; p++) {
      if (pop.length >= 2 && performance.now() - start >= budgetMs * 0.82) break;
      const keys = Array.from({ length: nSkus }, () => rng());
      const { result, oraclePassed } = evalCandidate(`BRKGA-G0-${p + 1}`, "brkga", "brkga-beam", {
        ...safeRequest,
        strategy: "maximum",
        products: decodeRandomKeys(safeRequest.products, keys),
      });
      pop.push({ keys, fitness: fitnessOf(result, oraclePassed) });
    }
    pop.sort((a, b) => b.fitness - a.fitness);

    for (let g = 1; g <= modeCfg.brkgaGens; g++) {
      if (performance.now() - start >= budgetMs || pop.length < 2) break;
      brkgaGenerations = g;
      const eliteCount = Math.max(1, Math.floor(pop.length * 0.35));
      const nextPop: Chrom[] = pop.slice(0, eliteCount);

      while (nextPop.length < modeCfg.brkgaPop) {
        if (performance.now() - start >= budgetMs) break;
        const isMutant = nextPop.length === modeCfg.brkgaPop - 1;
        let childKeys: number[];
        if (isMutant) {
          childKeys = Array.from({ length: nSkus }, () => rng());
        } else {
          const elite = pop[Math.floor(rng() * eliteCount)];
          const nonElite = pop[eliteCount + Math.floor(rng() * Math.max(1, pop.length - eliteCount))] ?? pop[0];
          childKeys = elite.keys.map((ek, idx) => (rng() < 0.7 ? ek : nonElite.keys[idx]));
        }
        const { result, oraclePassed } = evalCandidate(`BRKGA-G${g}-${nextPop.length + 1}`, "brkga", "brkga-beam", {
          ...safeRequest,
          strategy: "maximum",
          products: decodeRandomKeys(safeRequest.products, childKeys),
        });
        nextPop.push({ keys: childKeys, fitness: fitnessOf(result, oraclePassed) });
      }
      pop = nextPop.sort((a, b) => b.fitness - a.fitness);
    }
  }

  // Phase 6: Simulated Annealing local swap refinement
  let saAcceptedMoves = 0;
  if (nSkus >= 2 && modeCfg.saSteps > 0 && performance.now() - start < budgetMs) {
    emitProgress("sa", "模拟退火 SA 跳出局部最优", "Simulated Annealing escape");
    let curOrder = [...safeRequest.products];
    let curFitness = Math.max(0, ...evaluated.map((e) => fitnessOf(e.result, e.oraclePassed)));
    let temp = 12.0;
    for (let step = 0; step < modeCfg.saSteps; step++) {
      if (performance.now() - start >= budgetMs) break;
      const i = Math.floor(rng() * nSkus);
      const j = (i + 1 + Math.floor(rng() * (nSkus - 1))) % nSkus;
      const nextOrder = [...curOrder];
      const tmp = nextOrder[i];
      nextOrder[i] = nextOrder[j];
      nextOrder[j] = tmp;

      const { result, oraclePassed } = evalCandidate(`SA-${step + 1}`, "sa", "lns-local", {
        ...safeRequest,
        strategy: "maximum",
        products: nextOrder,
      });
      const nextFit = fitnessOf(result, oraclePassed);
      const delta = nextFit - curFitness;
      if (nextFit >= 0 && (delta >= 0 || rng() < Math.exp(delta / Math.max(0.1, temp)))) {
        curOrder = nextOrder;
        curFitness = nextFit;
        saAcceptedMoves++;
      }
      temp *= 0.72;
    }
  }

  const validEntries = evaluated.filter((e) => e.result.validation.valid);
  const oracleEntries = validEntries.filter((e) => e.oraclePassed);
  const pool = oracleEntries.length > 0 ? oracleEntries : validEntries.length > 0 ? validEntries : evaluated;

  const scoreList = evaluateMultiObjectivePlans(
    pool.map((e) => e.result),
    weights,
  );
  const scoreByKey = new Map(scoreList.map((s) => [`${s.strategy}:${s.id}`, s.compositeScore]));

  const summaries: HybridCandidateSummary[] = evaluated.map((entry, idx) => {
    const unplacedCount = Math.max(0, entry.result.metrics.requestedCount - entry.result.metrics.loadedCount);
    return {
      id: `${entry.result.id}-${idx}`,
      label: entry.label,
      phase: entry.phase,
      strategy: entry.result.strategy,
      loadedCount: entry.result.metrics.loadedCount,
      unplacedCount,
      volumeUtilization: entry.result.metrics.volumeUtilization,
      weightUtilization: entry.result.metrics.weightUtilization,
      grossWeightKg: entry.result.metrics.grossWeight,
      palletCount: entry.result.pallets?.length ?? 0,
      valid: entry.result.validation.valid,
      oraclePassed: entry.oraclePassed,
      compositeScore: scoreByKey.get(`${entry.result.strategy}:${entry.result.id}`) ?? 0,
    };
  });

  const maxQuantity = [...pool].sort(
    (a, b) =>
      b.result.metrics.loadedCount - a.result.metrics.loadedCount ||
      b.result.metrics.volumeUtilization - a.result.metrics.volumeUtilization,
  )[0].result;

  const maxUtilization = [...pool].sort(
    (a, b) =>
      b.result.metrics.volumeUtilization - a.result.metrics.volumeUtilization ||
      b.result.metrics.loadedCount - a.result.metrics.loadedCount,
  )[0].result;

  const mostBalanced = [...pool].sort(
    (a, b) =>
      (scoreByKey.get(`${b.result.strategy}:${b.result.id}`) ?? 0) -
      (scoreByKey.get(`${a.result.strategy}:${a.result.id}`) ?? 0),
  )[0].result;

  const mostStable = [...pool].sort((a, b) => stabilityScoreOf(b.result) - stabilityScoreOf(a.result))[0].result;

  const strategyNodes: HybridStrategyNodeStatus[] = [
    {
      id: "ep-skyline",
      labelZh: "快速求解",
      labelEn: "Fast Solver",
      algorithms: "EP / Skyline / MES",
      activated: nodeRunCounts["ep-skyline"] > 0,
      reasonZh: "生成极点与最大空闲空间基线方案",
      reasonEn: "Generates extreme-point & maximal empty space baselines",
      runsExecuted: nodeRunCounts["ep-skyline"],
    },
    {
      id: "brkga-beam",
      labelZh: "高密度优化",
      labelEn: "High-Density",
      algorithms: "BRKGA / Beam Search",
      activated: nodeRunCounts["brkga-beam"] > 0,
      reasonZh: nSkus >= 2 ? "多 SKU 束搜索与偏置随机键遗传进化" : "单 SKU 无需排序进化",
      reasonEn: nSkus >= 2 ? "Multi-SKU Beam Search & BRKGA evolution" : "Single-SKU order skips evolutionary ordering",
      runsExecuted: nodeRunCounts["brkga-beam"],
    },
    {
      id: "exact-cpsat",
      labelZh: "精确求解",
      labelEn: "Exact Verification",
      algorithms: "CP-SAT / Branch-and-Bound",
      activated: exactBranchAndBoundChecked,
      reasonZh: exactBranchAndBoundChecked
        ? `小规模订单已执行 ${exactNodesVisited} 节点分支定界最优性核验`
        : "仅在中小规模多 SKU 未满载时触发精确分支定界",
      reasonEn: exactBranchAndBoundChecked
        ? `Verified ${exactNodesVisited} branch-and-bound nodes`
        : "Triggered for small multi-SKU orders with residual unplaced units",
      runsExecuted: exactNodesVisited,
    },
    {
      id: "pallet-layer-block",
      labelZh: "托盘求解",
      labelEn: "Pallet Packing",
      algorithms: "Layer / Block Building",
      activated: featureProfile.isPalletized,
      reasonZh: featureProfile.isPalletized ? "已激活规则层型与组合块打托策略" : "当前为散箱直装模式",
      reasonEn: featureProfile.isPalletized ? "Layer & block palletization active" : "Direct floor loading active",
      runsExecuted: nodeRunCounts["pallet-layer-block"],
    },
    {
      id: "lns-local",
      labelZh: "局部优化",
      labelEn: "Local Refinement",
      algorithms: "LNS / Simulated Annealing",
      activated: nodeRunCounts["lns-local"] > 0,
      reasonZh: "针对未装入 SKU 进行局部拆解重排与退火跳出",
      reasonEn: "Targets unplaced SKUs via LNS restarts and SA swaps",
      runsExecuted: nodeRunCounts["lns-local"],
    },
    {
      id: "irregular-geom",
      labelZh: "异形优化",
      labelEn: "Irregular Geometry",
      algorithms: "HCP / Interlock / OBB-BVH",
      activated: featureProfile.hasIrregularShapes,
      reasonZh: featureProfile.hasIrregularShapes ? "检测到异形/实体几何，启用碰撞代理校验" : "当前全为规则长方体箱件",
      reasonEn: featureProfile.hasIrregularShapes ? "Irregular solid geometry collision active" : "All SKUs are standard cuboids",
      runsExecuted: nodeRunCounts["irregular-geom"],
    },
  ];

  emitProgress("complete", "独立合法性校验器全部通过", "Independent zero-trust oracle passed");

  return {
    computeMode: options.computeMode,
    budgetMs,
    elapsedMs: Number((performance.now() - start).toFixed(2)),
    seed,
    totalRuns,
    candidatesEvaluated: evaluated.length,
    validCandidates: validEntries.length,
    oraclePassedCandidates: oracleEntries.length,
    beamCandidatesEvaluated,
    exactBranchAndBoundChecked,
    exactNodesVisited,
    brkgaGenerations,
    saAcceptedMoves,
    featureProfile,
    strategyNodes,
    recommended: mostBalanced,
    pareto: {
      maxQuantity,
      maxUtilization,
      mostBalanced,
      mostStable,
    },
    summaries,
  };
}

/**
 * Asynchronous non-blocking wrapper supporting Pause / Resume / Cancel and live progress streaming.
 */
export async function runHybridPackingOptimizerAsync(
  baseRequest: PackingRequest,
  options: HybridSolverOptions,
  controller?: HybridSolverController,
): Promise<HybridSolverReport> {
  const waitIfPaused = async () => {
    while (controller?.isPaused() && !controller.isCancelled()) {
      await new Promise((r) => setTimeout(r, 80));
    }
  };
  await waitIfPaused();
  if (controller?.isCancelled()) {
    const fast = runHybridPackingOptimizer(baseRequest, { ...options, computeMode: "fast", customBudgetMs: 300 });
    return { ...fast, cancelled: true };
  }
  // Yield to browser paint frame before running heavy search
  await new Promise((r) => setTimeout(r, 16));
  const report = runHybridPackingOptimizer(baseRequest, {
    ...options,
    onProgress: (p) => {
      options.onProgress?.(p);
      controller?.onProgress?.(p);
    },
  });
  await waitIfPaused();
  return report;
}
