import { packLoadingWorkflow } from "./pack-loading";
import {
  BR_CONTAINER_20FT,
  buildPublicBenchmarkSuite,
  verifyPackingOracle,
  type PublicBenchmarkCase,
} from "./public-benchmarks";
import { CONTAINER_PRESETS } from "./presets";
import type { PackingStrategy, ProductInput } from "./types";

export interface ExtendedBenchmarkCase {
  id: string;
  label: string;
  family: "academic-br" | "extreme" | "random" | "multi-carton-kit" | "heavy-mixed";
  request: PublicBenchmarkCase["request"];
}

export interface BenchmarkFamilyMetrics {
  family: ExtendedBenchmarkCase["family"];
  total: number;
  passed: number;
  meanVolUtilPct: number;
  p50Ms: number;
  p95Ms: number;
}

export interface BenchmarkSuiteV2Report {
  totalCases: number;
  passedCases: number;
  zeroViolations: boolean;
  overallMeanVolUtilPct: number;
  brAcademicMeanVolUtilPct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  totalElapsedMs: number;
  families: BenchmarkFamilyMetrics[];
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

function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

const CONTAINER_40HQ = CONTAINER_PRESETS.find((c) => c.id === "40hq") ?? BR_CONTAINER_20FT;

/**
 * Pillar 1B: Builds a deterministic 112-case comprehensive benchmark suite:
 *  - 7 Bischoff-Ratcliff (1995) BR1–BR7 academic instances
 *  - 5 Extreme geometry & payload stress cases
 *  - 60 Seeded random heterogeneous instances
 *  - 20 Multi-carton matched-set (kit) export manufacturing cases
 *  - 20 Heavy / mixed-density 40HQ industrial cargo cases
 */
export function buildBenchmarkSuiteV2(seed = 20261128): ExtendedBenchmarkCase[] {
  const base = buildPublicBenchmarkSuite(60, seed);
  const cases: ExtendedBenchmarkCase[] = base.map((c) => ({
    id: c.id,
    label: c.id,
    family:
      c.id.toLowerCase().startsWith("br")
        ? "academic-br"
        : c.id.toLowerCase().includes("extreme")
          ? "extreme"
          : "random",
    request: c.request,
  }));

  const rng = mulberry32(seed ^ 0x5f3759df);

  // 20 multi-carton kit scenarios (2-box and 3-box matched sets)
  for (let i = 0; i < 20; i++) {
    const setQty = 8 + Math.floor(rng() * 14);
    const boxCount = i % 2 === 0 ? 2 : 3;
    const setCode = `KIT-${i + 1}`;
    const products: ProductInput[] = [];
    for (let b = 0; b < boxCount; b++) {
      products.push({
        id: `kit-${i}-b${b}`,
        sku: `${setCode}-B${b + 1}`,
        name: `Kit ${i + 1} Box ${b + 1}`,
        length: 800 + Math.floor(rng() * 1000),
        width: 450 + Math.floor(rng() * 450),
        height: 150 + Math.floor(rng() * 350),
        weight: 12 + Math.floor(rng() * 30),
        quantity: setQty,
        priority: b + 1,
        rotationPolicy: b === 0 ? "upright" : "any",
        stackable: true,
        maxStackLayers: 8,
        setCode,
        unitsPerSet: 1,
        color: "#2563eb",
      });
    }
    cases.push({
      id: `v2-kit-${i + 1}`,
      label: `Kit Export Order #${i + 1} (${boxCount}-box set)`,
      family: "multi-carton-kit",
      request: {
        container: CONTAINER_40HQ,
        clearance: 10,
        products,
        mode: "mixed",
        workflow: "direct",
        strategy: "maximum",
      },
    });
  }

  // 20 heavy / mixed-density industrial cases (testing payload caps + bottom-heavy constraints)
  for (let i = 0; i < 20; i++) {
    const nTypes = 3 + (i % 5);
    const products: ProductInput[] = [];
    for (let t = 0; t < nTypes; t++) {
      const heavy = t === 0;
      products.push({
        id: `hvy-${i}-t${t}`,
        sku: `HVY-${i + 1}-${t + 1}`,
        name: heavy ? `Heavy Steel Crate ${t + 1}` : `Light Accessory Box ${t + 1}`,
        length: heavy ? 1100 + Math.floor(rng() * 500) : 450 + Math.floor(rng() * 400),
        width: heavy ? 800 + Math.floor(rng() * 300) : 350 + Math.floor(rng() * 300),
        height: heavy ? 600 + Math.floor(rng() * 400) : 250 + Math.floor(rng() * 300),
        weight: heavy ? 320 + Math.floor(rng() * 260) : 10 + Math.floor(rng() * 25),
        quantity: heavy ? 12 + Math.floor(rng() * 16) : 30 + Math.floor(rng() * 50),
        priority: t + 1,
        rotationPolicy: heavy ? "upright" : "any",
        stackable: true,
        maxStackLayers: heavy ? 2 : 8,
        bottomOnly: heavy,
        color: heavy ? "#dc2626" : "#0891b2",
      });
    }
    cases.push({
      id: `v2-heavy-${i + 1}`,
      label: `Heavy Mixed Industrial #${i + 1}`,
      family: "heavy-mixed",
      request: {
        container: i % 2 === 0 ? BR_CONTAINER_20FT : CONTAINER_40HQ,
        clearance: 10,
        products,
        mode: "mixed",
        workflow: "direct",
        strategy: "maximum",
      },
    });
  }

  return cases;
}

/**
 * Executes all cases in the V2 suite and verifies EVERY placement via the independent 3D physical oracle.
 */
export function runBenchmarkSuiteV2(
  strategy: PackingStrategy = "maximum",
  seed = 20261128,
): BenchmarkSuiteV2Report {
  const suiteStart = performance.now();
  const cases = buildBenchmarkSuiteV2(seed);
  const allTimes: number[] = [];
  const allUtils: number[] = [];
  const brUtils: number[] = [];

  const familyBuckets = new Map<
    ExtendedBenchmarkCase["family"],
    { total: number; passed: number; utils: number[]; times: number[] }
  >();

  let passedCases = 0;

  for (const c of cases) {
    const t0 = performance.now();
    const req = { ...c.request, strategy };
    const res = packLoadingWorkflow(req);
    const dt = performance.now() - t0;
    const oracle = verifyPackingOracle(res, req);
    const ok = res.validation.valid && oracle.passed;
    if (ok) passedCases++;

    const utilPct = res.metrics.volumeUtilization * 100;
    allTimes.push(dt);
    allUtils.push(utilPct);
    if (c.family === "academic-br") brUtils.push(utilPct);

    const b = familyBuckets.get(c.family) ?? { total: 0, passed: 0, utils: [], times: [] };
    b.total++;
    if (ok) b.passed++;
    b.utils.push(utilPct);
    b.times.push(dt);
    familyBuckets.set(c.family, b);
  }

  const sortedAll = [...allTimes].sort((a, b) => a - b);
  const mean = (arr: readonly number[]) =>
    arr.length ? Number((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2)) : 0;

  const families: BenchmarkFamilyMetrics[] = [...familyBuckets.entries()].map(([family, b]) => {
    const st = [...b.times].sort((a, v) => a - v);
    return {
      family,
      total: b.total,
      passed: b.passed,
      meanVolUtilPct: mean(b.utils),
      p50Ms: percentile(st, 50),
      p95Ms: percentile(st, 95),
    };
  });

  return {
    totalCases: cases.length,
    passedCases,
    zeroViolations: passedCases === cases.length,
    overallMeanVolUtilPct: mean(allUtils),
    brAcademicMeanVolUtilPct: mean(brUtils),
    p50Ms: percentile(sortedAll, 50),
    p95Ms: percentile(sortedAll, 95),
    p99Ms: percentile(sortedAll, 99),
    totalElapsedMs: Number((performance.now() - suiteStart).toFixed(1)),
    families,
  };
}
