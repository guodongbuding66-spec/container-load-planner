import { buildAllFiveAcademicSuites } from "./academic-benchmarks";
import { buildPublicBenchmarkSuite } from "./public-benchmarks";
import { packLoadingWorkflow } from "./pack-loading";
import { CONTAINER_PRESETS } from "./presets";
import { verifyPackingOracle } from "./public-benchmarks";
import type { PackingRequest, PackingStrategy, ProductInput } from "./types";

/**
 * Independent Test Corpus Framework & 10,000+ Roadmap Tracker + 100+ Factory Case Registry.
 * Strictly separates PLANNED TARGETS (10,000 synthetic/public + 100 real factory cases)
 * from CURRENTLY VERIFIED COUNTS — never claiming target counts as completed.
 */
export type CorpusCategoryId =
  | "public-standard"
  | "random-extreme"
  | "unpack-kit"
  | "pallet-crate"
  | "engineering-irregular"
  | "multi-container-cost";

export interface CorpusCategoryTarget {
  id: CorpusCategoryId;
  labelZh: string;
  labelEn: string;
  plannedTarget: number;
}

export const INDEPENDENT_CORPUS_ROADMAP: readonly CorpusCategoryTarget[] = [
  { id: "public-standard", labelZh: "公开标准算例（BR / OR-Library / ESICUP / Q4RealBPP / PackingSolver）", labelEn: "Public Standard Benchmarks", plannedTarget: 1600 },
  { id: "random-extreme", labelZh: "随机及极端几何案例", labelEn: "Random & Extreme Geometry", plannedTarget: 4000 },
  { id: "unpack-kit", labelZh: "拆箱与多箱套装案例", labelEn: "Unpack & Multi-Carton Kits", plannedTarget: 1500 },
  { id: "pallet-crate", labelZh: "托盘、木箱与带托装载", labelEn: "Pallet, Crate & Unitized", plannedTarget: 1000 },
  { id: "engineering-irregular", labelZh: "工程约束与异形件", labelEn: "Engineering Constraints & Irregular", plannedTarget: 1000 },
  { id: "multi-container-cost", labelZh: "多柜及成本优化", labelEn: "Multi-Container & Landed Cost", plannedTarget: 900 },
];

export const PLANNED_CORPUS_TOTAL_TARGET = 10000;
export const PLANNED_FACTORY_CASES_TARGET = 100;

export interface FactoryBenchmarkCase {
  caseId: string;
  factoryNameOrCode: string;
  recordedDate: string;
  containerType: string;
  measuredInteriorMm: { length: number; width: number; height: number };
  originalCartonSpecs: Array<{
    sku: string;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    weightKg: number;
    plannedQty: number;
  }>;
  actualLoadedCartons: number;
  weighbridgeGrossKg?: number;
  loadingDurationMinutes?: number;
  photoEvidencePaths: string[];
  verifiedByOperator: boolean;
}

export interface FactoryCaseValidationResult {
  valid: boolean;
  missingFields: string[];
}

/** Validates whether a real factory loading record meets independent audit evidence standards. */
export function validateFactoryCaseRecord(record: Partial<FactoryBenchmarkCase>): FactoryCaseValidationResult {
  const missing: string[] = [];
  if (!record.caseId?.trim()) missing.push("caseId");
  if (!record.recordedDate?.trim()) missing.push("recordedDate");
  if (!record.measuredInteriorMm || record.measuredInteriorMm.length <= 0 || record.measuredInteriorMm.width <= 0 || record.measuredInteriorMm.height <= 0) {
    missing.push("measuredInteriorMm");
  }
  if (!record.originalCartonSpecs?.length) missing.push("originalCartonSpecs");
  if (!Number.isFinite(record.actualLoadedCartons) || (record.actualLoadedCartons ?? 0) <= 0) {
    missing.push("actualLoadedCartons");
  }
  if (!record.photoEvidencePaths?.length) missing.push("photoEvidencePaths");
  if (!record.verifiedByOperator) missing.push("verifiedByOperator");
  return { valid: missing.length === 0, missingFields: missing };
}

export interface CorpusCase {
  id: string;
  category: CorpusCategoryId;
  request: PackingRequest;
}

export interface CorpusCategoryResult {
  id: CorpusCategoryId;
  labelZh: string;
  plannedTarget: number;
  executedCount: number;
  passedCount: number;
  violationCount: number;
  meanVolUtilPct: number;
  p50Ms: number;
  p95Ms: number;
  completionPctOfTarget: number;
}

export interface IndependentCorpusRunReport {
  plannedTotalTarget: number;
  executedTotal: number;
  passedTotal: number;
  totalPhysicalViolations: number;
  overallMeanVolUtilPct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  categories: CorpusCategoryResult[];
  factoryCasesVerifiedCount: number;
  factoryCasesTarget: number;
  honestStatusNoteZh: string;
  honestStatusNoteEn: string;
}

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

const COLORS = ["#2563eb", "#0f766e", "#d97706", "#7c3aed", "#dc2626", "#0284c7"];

/**
 * Deterministically builds a balanced multi-category batch of independent test cases.
 * Default batch size = 120 for fast CI/UI runs; pass 1000+ for full CLI stress verification.
 */
export function buildIndependentCorpusBatch(totalCases = 120, seed = 20261128): CorpusCase[] {
  const rng = makeRng(seed);
  const c20 = CONTAINER_PRESETS.find((c) => c.id === "20gp") ?? CONTAINER_PRESETS[0];
  const c40 = CONTAINER_PRESETS.find((c) => c.id === "40hq") ?? CONTAINER_PRESETS[2];
  const cases: CorpusCase[] = [];

  // Proportional allocation matching the 10,000 roadmap weights
  const alloc = (target: number) => Math.max(2, Math.round((totalCases * target) / PLANNED_CORPUS_TOTAL_TARGET));

  // 1. Public Standard (All 5 Academic Families + BR1-BR7 & Extreme Geometry Benchmarks)
  const pubTarget = alloc(1600);
  const academic = buildAllFiveAcademicSuites();
  const publicPool: PackingRequest[] = [
    ...academic.map((a) => a.request),
    ...buildPublicBenchmarkSuite(0, seed).map((b) => b.request),
  ];
  for (let i = 0; i < pubTarget; i++) {
    const baseReq = publicPool[i % publicPool.length];
    cases.push({
      id: `pub-${String(i + 1).padStart(4, "0")}`,
      category: "public-standard",
      request: baseReq,
    });
  }

  // 2. Random & Extreme Geometry
  const randTarget = alloc(4000);
  for (let i = 0; i < randTarget; i++) {
    const isExtreme = i % 5 === 0;
    const skuCount = isExtreme ? 2 : 2 + Math.floor(rng() * 4);
    const products: ProductInput[] = [];
    for (let k = 0; k < skuCount; k++) {
      const l = isExtreme ? 1800 + Math.round(rng() * 1400) : 320 + Math.round(rng() * 680);
      const w = isExtreme ? 180 + Math.round(rng() * 240) : 260 + Math.round(rng() * 480);
      const h = 240 + Math.round(rng() * 440);
      products.push({
        id: `re-${i}-${k}`,
        sku: `RE-${k + 1}`,
        name: `RandGeo ${k + 1}`,
        length: l,
        width: w,
        height: h,
        weight: Math.max(2, Math.round(((l * w * h) / 1e9) * (120 + rng() * 180))),
        quantity: isExtreme ? 8 + Math.floor(rng() * 12) : 12 + Math.floor(rng() * 35),
        color: COLORS[k % COLORS.length],
        rotationPolicy: rng() > 0.45 ? "upright" : "any",
        stackable: true,
        maxStackLayers: 0,
        priority: 50,
      });
    }
    cases.push({
      id: `rand-${String(i + 1).padStart(4, "0")}`,
      category: "random-extreme",
      request: { container: i % 2 === 0 ? c20 : c40, products, mode: "mixed", strategy: "maximum", clearance: 0 },
    });
  }

  // 3. Unpack & Multi-Carton Kits
  const kitTarget = alloc(1500);
  for (let i = 0; i < kitTarget; i++) {
    const highFill = i % 2 === 0;
    const sets = highFill ? 65 + Math.floor(rng() * 45) : 18 + Math.floor(rng() * 28);
    const products: ProductInput[] = [
      { id: `kit-${i}-a`, sku: `KIT${i}-A`, name: "Kit Box A", length: 720 + Math.round(rng() * 200), width: 480 + Math.round(rng() * 120), height: 420 + Math.round(rng() * 120), weight: 18, quantity: sets, setCode: `SET-${i}`, unitsPerSet: 1, color: COLORS[0], rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 70 },
      { id: `kit-${i}-b`, sku: `KIT${i}-B`, name: "Kit Box B", length: 420 + Math.round(rng() * 140), width: 320 + Math.round(rng() * 100), height: 280 + Math.round(rng() * 100), weight: 8, quantity: sets * 2, setCode: `SET-${i}`, unitsPerSet: 2, color: COLORS[1], rotationPolicy: "any", stackable: true, maxStackLayers: 0, priority: 60 },
    ];
    cases.push({
      id: `kit-${String(i + 1).padStart(4, "0")}`,
      category: "unpack-kit",
      request: { container: c40, products, mode: "mixed", strategy: "maximum", clearance: 0 },
    });
  }

  // 4. Pallet, Crate & Unitized
  const palTarget = alloc(1000);
  for (let i = 0; i < palTarget; i++) {
    const products: ProductInput[] = [
      { id: `pal-${i}-1`, sku: `PAL-${i}`, name: "Palletized Carton", length: 580 + Math.round(rng() * 60), width: 390 + Math.round(rng() * 40), height: 350 + Math.round(rng() * 80), weight: 16, quantity: i % 2 === 0 ? 320 + Math.floor(rng() * 180) : 60 + Math.floor(rng() * 70), color: COLORS[2], rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 50 },
    ];
    cases.push({
      id: `pal-${String(i + 1).padStart(4, "0")}`,
      category: "pallet-crate",
      request: { container: c40, products, mode: "mixed", strategy: "practical", clearance: 5 },
    });
  }

  // 5. Engineering Constraints & Irregular (heavy bottom, fragile top, LIFO stops)
  const engTarget = alloc(1000);
  for (let i = 0; i < engTarget; i++) {
    const products: ProductInput[] = [
      { id: `eng-${i}-h`, sku: "HEAVY-BASE", name: "Heavy Base", length: 700, width: 550, height: 480, weight: 48, quantity: i % 2 === 0 ? 70 + Math.floor(rng() * 40) : 20 + Math.floor(rng() * 18), color: COLORS[3], rotationPolicy: "upright", stackable: true, maxStackLayers: 0, maxTopLoadKg: 300, priority: 80 },
      { id: `eng-${i}-f`, sku: "FRAGILE-TOP", name: "Fragile Top", length: 500, width: 400, height: 320, weight: 8, quantity: 20 + Math.floor(rng() * 20), color: COLORS[4], rotationPolicy: "upright", stackable: false, maxStackLayers: 0, maxTopLoadKg: 0, priority: 30 },
    ];
    cases.push({
      id: `eng-${String(i + 1).padStart(4, "0")}`,
      category: "engineering-irregular",
      request: { container: c20, products, mode: "mixed", strategy: "maximum", clearance: 0 },
    });
  }

  // 6. Multi-Container & Cost Overflow
  const mcTarget = alloc(900);
  for (let i = 0; i < mcTarget; i++) {
    const products: ProductInput[] = [
      { id: `mc-${i}-1`, sku: "MC-MAIN", name: "Bulk Order A", length: 650, width: 450, height: 420, weight: 20, quantity: 120 + Math.floor(rng() * 80), color: COLORS[5], rotationPolicy: "upright", stackable: true, maxStackLayers: 0, priority: 60 },
      { id: `mc-${i}-2`, sku: "MC-SUB", name: "Bulk Order B", length: 480, width: 360, height: 340, weight: 12, quantity: 80 + Math.floor(rng() * 60), color: COLORS[0], rotationPolicy: "any", stackable: true, maxStackLayers: 0, priority: 40 },
    ];
    cases.push({
      id: `mc-${String(i + 1).padStart(4, "0")}`,
      category: "multi-container-cost",
      request: { container: c40, products, mode: "mixed", strategy: "maximum", clearance: 0 },
    });
  }

  return cases;
}

/**
 * Executes an independent corpus batch with zero-trust physical oracle verification.
 */
export function runIndependentCorpusBatch(
  totalCases = 120,
  strategy: PackingStrategy = "maximum",
  seed = 20261128,
  verifiedFactoryCases: readonly FactoryBenchmarkCase[] = [],
): IndependentCorpusRunReport {
  const cases = buildIndependentCorpusBatch(totalCases, seed);
  const allLatencies: number[] = [];
  const byCat = new Map<
    CorpusCategoryId,
    { executed: number; passed: number; violations: number; utils: number[]; latencies: number[] }
  >();

  for (const t of INDEPENDENT_CORPUS_ROADMAP) {
    byCat.set(t.id, { executed: 0, passed: 0, violations: 0, utils: [], latencies: [] });
  }

  let totalViolations = 0;
  let passedTotal = 0;
  const allUtils: number[] = [];

  for (const c of cases) {
    const t0 = performance.now();
    const res = packLoadingWorkflow({ ...c.request, strategy });
    const elapsed = performance.now() - t0;
    const oracle = verifyPackingOracle(res, c.request);

    const bucket = byCat.get(c.category)!;
    bucket.executed++;
    bucket.latencies.push(elapsed);
    bucket.utils.push(res.metrics.volumeUtilization * 100);
    allLatencies.push(elapsed);
    allUtils.push(res.metrics.volumeUtilization * 100);

    if (oracle.passed) {
      bucket.passed++;
      passedTotal++;
    } else {
      const vCount =
        oracle.collisions +
        oracle.oobCount +
        oracle.conservationErrors +
        oracle.floatingCount +
        (oracle.weightOverLimit ? 1 : 0);
      bucket.violations += Math.max(1, vCount);
      totalViolations += Math.max(1, vCount);
    }
  }

  const sortedAll = [...allLatencies].sort((a, b) => a - b);
  const categories: CorpusCategoryResult[] = INDEPENDENT_CORPUS_ROADMAP.map((target) => {
    const b = byCat.get(target.id)!;
    const sLat = [...b.latencies].sort((a, b2) => a - b2);
    const meanU = b.utils.length ? b.utils.reduce((s, u) => s + u, 0) / b.utils.length : 0;
    return {
      id: target.id,
      labelZh: target.labelZh,
      plannedTarget: target.plannedTarget,
      executedCount: b.executed,
      passedCount: b.passed,
      violationCount: b.violations,
      meanVolUtilPct: Number(meanU.toFixed(2)),
      p50Ms: percentile(sLat, 50),
      p95Ms: percentile(sLat, 95),
      completionPctOfTarget: Number(((b.executed / target.plannedTarget) * 100).toFixed(2)),
    };
  });

  const validFactoryCount = verifiedFactoryCases.filter((r) => validateFactoryCaseRecord(r).valid).length;
  const overallMean = allUtils.length ? allUtils.reduce((s, u) => s + u, 0) / allUtils.length : 0;

  return {
    plannedTotalTarget: PLANNED_CORPUS_TOTAL_TARGET,
    executedTotal: cases.length,
    passedTotal,
    totalPhysicalViolations: totalViolations,
    overallMeanVolUtilPct: Number(overallMean.toFixed(2)),
    p50Ms: percentile(sortedAll, 50),
    p95Ms: percentile(sortedAll, 95),
    p99Ms: percentile(sortedAll, 99),
    categories,
    factoryCasesVerifiedCount: validFactoryCount,
    factoryCasesTarget: PLANNED_FACTORY_CASES_TARGET,
    honestStatusNoteZh: `当前批次已实跑验证 ${cases.length} / ${PLANNED_CORPUS_TOTAL_TARGET.toLocaleString()}（阶段性规划目标），物理违规 ${totalViolations} 项；独立工厂实装案例已验证 ${validFactoryCount} / ${PLANNED_FACTORY_CASES_TARGET}（需导入带实测尺寸与现场照片的原始工厂样本）。`,
    honestStatusNoteEn: `Executed & oracle-verified ${cases.length} / ${PLANNED_CORPUS_TOTAL_TARGET.toLocaleString()} planned target cases (${totalViolations} physical violations); real factory cases verified: ${validFactoryCount} / ${PLANNED_FACTORY_CASES_TARGET}.`,
  };
}
