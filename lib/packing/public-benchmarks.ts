import { packLoadingWorkflow } from "./pack-loading";
import { auditPackingResult } from "./result-audit";
import type { ContainerSpec, PackingRequest, PackingResult, ProductInput } from "./types";

/**
 * Classic Bischoff–Ratcliff (1995) ISO 20ft container inner dimensions (mm)
 * used across OR-Library / ESICUP 3D-CLP benchmarks (5870 x 2330 x 2200 mm).
 */
export const BR_CONTAINER_20FT: ContainerSpec = {
  id: "br-20ft",
  name: "BR-20ft (5870×2330×2200)",
  length: 5870,
  width: 2330,
  height: 2200,
  doorWidth: 2330,
  doorHeight: 2200,
  maxWeight: 28000,
};

export interface PublicBenchmarkCase {
  id: string;
  suite: "BR-weak" | "BR-strong" | "extreme" | "random";
  title: string;
  request: PackingRequest;
}

export interface OracleCheckResult {
  collisions: number;
  oobCount: number;
  floatingCount: number;
  weightOverLimit: boolean;
  conservationErrors: number;
  kitIntegrityErrors: number;
  passed: boolean;
}

export interface BenchmarkRunRow {
  id: string;
  suite: PublicBenchmarkCase["suite"];
  title: string;
  strategy: "practical" | "maximum";
  requestedCount: number;
  loadedCount: number;
  volumeUtilPct: number;
  elapsedMs: number;
  oracle: OracleCheckResult;
  engineValid: boolean;
  auditErrors: number;
}

export interface BenchmarkSuiteSummary {
  totalRuns: number;
  passedRuns: number;
  totalCollisions: number;
  totalOob: number;
  totalFloating: number;
  totalWeightViolations: number;
  totalConservationErrors: number;
  meanVolumeUtilPct: number;
  minVolumeUtilPct: number;
  maxVolumeUtilPct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  rows: BenchmarkRunRow[];
}

/** Deterministic Mulberry32 PRNG for reproducible benchmark generation. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSku(
  id: string,
  L: number,
  W: number,
  H: number,
  weight: number,
  quantity: number,
  extra: Partial<ProductInput> = {},
): ProductInput {
  return {
    id,
    sku: id.toUpperCase(),
    name: id.toUpperCase(),
    length: L,
    width: W,
    height: H,
    weight,
    quantity,
    priority: 50,
    rotationPolicy: "any",
    stackable: true,
    maxStackLayers: 0,
    maxTopLoadKg: 100000,
    color: "#2b8d83",
    ...extra,
  };
}

/**
 * Independent zero-trust 3D physical & mathematical oracle:
 * verifies AABB non-overlap, strict container boundary containment,
 * gravity bottom-support, payload limit, quantity conservation, and kit atomicity.
 */
export function verifyPackingOracle(
  result: PackingResult,
  request: PackingRequest,
): OracleCheckResult {
  const EPS = 0.5;
  const boxes = result.placements;
  const cL = result.container.length;
  const cW = result.container.width;
  const cH = result.container.height;
  const maxW = result.container.maxWeight;

  let collisions = 0;
  let oobCount = 0;
  let floatingCount = 0;
  let totalCargoWeight = 0;

  for (const b of boxes) {
    totalCargoWeight += b.weight;
    if (
      b.x < -EPS ||
      b.y < -EPS ||
      b.z < -EPS ||
      b.x + b.dx > cL + EPS ||
      b.y + b.dy > cW + EPS ||
      b.z + b.dz > cH + EPS
    ) {
      oobCount++;
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
      const oz = Math.min(a.z + a.dz, b.z + b.dz) - Math.max(a.z, b.z);
      if (ox > EPS && oy > EPS && oz > EPS) {
        collisions++;
      }
    }
  }

  const palletDecks = (result.pallets ?? []).map((pl) => ({
    x: pl.x,
    y: pl.y,
    topZ: pl.z + pl.dz,
    dx: pl.dx,
    dy: pl.dy,
  }));

  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (a.z <= 2) continue;
    let supportedArea = 0;
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue;
      const b = boxes[j];
      if (Math.abs(b.z + b.dz - a.z) <= 5) {
        const ox = Math.max(0, Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y));
        supportedArea += ox * oy;
      }
    }
    for (const pd of palletDecks) {
      if (Math.abs(pd.topZ - a.z) <= 5) {
        const ox = Math.max(0, Math.min(a.x + a.dx, pd.x + pd.dx) - Math.max(a.x, pd.x));
        const oy = Math.max(0, Math.min(a.y + a.dy, pd.y + pd.dy) - Math.max(a.y, pd.y));
        supportedArea += ox * oy;
      }
    }
    const baseArea = a.dx * a.dy;
    if (baseArea > 0 && supportedArea / baseArea < 0.25) {
      floatingCount++;
    }
  }

  const grossWeight = result.metrics.grossWeight ?? totalCargoWeight;
  const weightOverLimit = grossWeight > maxW + 0.1;

  // Quantity conservation check
  let conservationErrors = 0;
  const placedByProduct = new Map<string, number>();
  for (const b of boxes) {
    placedByProduct.set(b.productId, (placedByProduct.get(b.productId) ?? 0) + 1);
  }
  for (const p of request.products) {
    const placed = placedByProduct.get(p.id) ?? 0;
    const summary = result.summaries.find((s) => s.productId === p.id);
    if (!summary || summary.loaded !== placed || placed > p.quantity) {
      conservationErrors++;
    }
  }

  // Kit atomicity check
  let kitIntegrityErrors = 0;
  const kits = new Map<string, ProductInput[]>();
  for (const p of request.products) {
    const code = p.setCode?.trim();
    if (code) kits.set(code, [...(kits.get(code) ?? []), p]);
  }
  for (const [, members] of kits) {
    const ratios = members.map((m) => (placedByProduct.get(m.id) ?? 0) / (m.unitsPerSet ?? 1));
    if (!ratios.every((r) => Number.isInteger(r) && r === ratios[0])) {
      kitIntegrityErrors++;
    }
  }

  return {
    collisions,
    oobCount,
    floatingCount,
    weightOverLimit,
    conservationErrors,
    kitIntegrityErrors,
    passed:
      collisions === 0 &&
      oobCount === 0 &&
      floatingCount === 0 &&
      !weightOverLimit &&
      conservationErrors === 0 &&
      kitIntegrityErrors === 0,
  };
}

/**
 * Generates standard Bischoff–Ratcliff (BR1–BR7 style) + Extreme Geometry + Seeded Random cases.
 */
export function buildPublicBenchmarkSuite(randomCount = 30, seed = 20261127): PublicBenchmarkCase[] {
  const cases: PublicBenchmarkCase[] = [];
  const baseReq = (products: ProductInput[], container: ContainerSpec = BR_CONTAINER_20FT): PackingRequest => ({
    mode: "mixed",
    workflow: "direct",
    strategy: "maximum",
    clearance: 0,
    practicalTargetUtilization: 0.95,
    products,
    container,
  });

  // 1. BR1–BR3 Weakly Heterogeneous (3, 5, 8 box types)
  const brSpecs: Array<{ id: string; suite: "BR-weak" | "BR-strong"; title: string; types: number; s: number }> = [
    { id: "br1-3types", suite: "BR-weak", title: "BR1 弱异构（3 类箱型）", types: 3, s: 101 },
    { id: "br2-5types", suite: "BR-weak", title: "BR2 弱异构（5 类箱型）", types: 5, s: 202 },
    { id: "br3-8types", suite: "BR-weak", title: "BR3 弱异构（8 类箱型）", types: 8, s: 303 },
    { id: "br4-10types", suite: "BR-strong", title: "BR4 中强异构（10 类箱型）", types: 10, s: 404 },
    { id: "br5-12types", suite: "BR-strong", title: "BR5 强异构（12 类箱型）", types: 12, s: 505 },
    { id: "br6-15types", suite: "BR-strong", title: "BR6 强异构（15 类箱型）", types: 15, s: 606 },
    { id: "br7-20types", suite: "BR-strong", title: "BR7 极强异构（20 类箱型）", types: 20, s: 707 },
  ];

  const containerVol = BR_CONTAINER_20FT.length * BR_CONTAINER_20FT.width * BR_CONTAINER_20FT.height;
  for (const spec of brSpecs) {
    const rng = mulberry32(spec.s);
    const products: ProductInput[] = [];
    const targetPerTypeVol = (containerVol * 1.08) / spec.types;
    for (let i = 0; i < spec.types; i++) {
      const L = Math.round((300 + rng() * 900) / 10) * 10;
      const W = Math.round((250 + rng() * 650) / 10) * 10;
      const H = Math.round((200 + rng() * 600) / 10) * 10;
      const vol = L * W * H;
      const qty = Math.max(2, Math.min(45, Math.round(targetPerTypeVol / vol)));
      const wt = Math.max(2, Math.round((vol / 1e6) * 0.12 * 10) / 10);
      products.push(makeSku(`${spec.id}-t${i + 1}`, L, W, H, wt, qty));
    }
    cases.push({ id: spec.id, suite: spec.suite, title: spec.title, request: baseReq(products) });
  }

  // 2. Extreme Geometry & Hard-Constraint Stress Cases
  cases.push({
    id: "ext-long-rods",
    suite: "extreme",
    title: "极端细长型材混装（4800mm 长杆 + 填充箱）",
    request: baseReq([
      makeSku("rod-4800", 4800, 180, 160, 38, 24, { rotationPolicy: "upright" }),
      makeSku("filler-400", 400, 350, 300, 8, 60),
    ]),
  });
  cases.push({
    id: "ext-flat-sheets",
    suite: "extreme",
    title: "极端扁平大板叠放（2000×1100×45mm）",
    request: baseReq([
      makeSku("sheet-flat", 2000, 1100, 45, 22, 120, { rotationPolicy: "upright" }),
    ]),
  });
  cases.push({
    id: "ext-heavy-payload",
    suite: "extreme",
    title: "重货限载压力测试（单箱 950kg × 40 箱 vs 28t 上限）",
    request: baseReq([
      makeSku("steel-950", 500, 500, 450, 950, 40, { rotationPolicy: "upright" }),
    ]),
  });
  cases.push({
    id: "ext-kit-atomic",
    suite: "extreme",
    title: "多箱套装原子守恒（1:2:3 比例高密度压力）",
    request: baseReq([
      makeSku("kit-a", 1200, 600, 300, 28, 30, { setCode: "SET-X", unitsPerSet: 1, rotationPolicy: "upright" }),
      makeSku("kit-b", 600, 450, 300, 15, 60, { setCode: "SET-X", unitsPerSet: 2, rotationPolicy: "upright" }),
      makeSku("kit-c", 400, 350, 250, 9, 90, { setCode: "SET-X", unitsPerSet: 3, rotationPolicy: "upright" }),
    ]),
  });
  cases.push({
    id: "ext-door-clearance",
    suite: "extreme",
    title: "门洞高度受限拒装与混装（箱高 2180mm vs 门高 2100mm）",
    request: baseReq(
      [
        makeSku("too-tall", 800, 600, 2180, 40, 5, { rotationPolicy: "fixed", allowedOrientations: ["LWH"] }),
        makeSku("ok-box", 600, 500, 400, 14, 40),
      ],
      { ...BR_CONTAINER_20FT, doorHeight: 2100 },
    ),
  });

  // 3. Deterministic Seeded Random Stress Cases
  const rng = mulberry32(seed);
  for (let idx = 0; idx < randomCount; idx++) {
    const skuCount = 2 + Math.floor(rng() * 6); // 2..7 SKUs
    const products: ProductInput[] = [];
    for (let s = 0; s < skuCount; s++) {
      const L = Math.round((250 + rng() * 1150) / 10) * 10;
      const W = Math.round((200 + rng() * 750) / 10) * 10;
      const H = Math.round((150 + rng() * 700) / 10) * 10;
      const qty = 3 + Math.floor(rng() * 22);
      const wt = Math.max(1.5, Math.round((L * W * H / 1e6) * (0.08 + rng() * 0.16) * 10) / 10);
      products.push(makeSku(`rnd-${idx + 1}-s${s + 1}`, L, W, H, wt, qty));
    }
    cases.push({
      id: `rnd-${String(idx + 1).padStart(3, "0")}`,
      suite: "random",
      title: `随机混装案例 #${idx + 1}（${skuCount} SKU）`,
      request: baseReq(products),
    });
  }

  return cases;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

export function runPublicBenchmarkSuite(
  cases: readonly PublicBenchmarkCase[],
  strategy: "practical" | "maximum" = "maximum",
): BenchmarkSuiteSummary {
  const rows: BenchmarkRunRow[] = [];
  for (const c of cases) {
    const req: PackingRequest = { ...structuredClone(c.request), strategy };
    const start = performance.now();
    const res = packLoadingWorkflow(req);
    const elapsedMs = Number((performance.now() - start).toFixed(2));
    const oracle = verifyPackingOracle(res, req);
    const audit = auditPackingResult(res, req.products);
    const requestedCount = req.products.reduce((s, p) => s + p.quantity, 0);
    const volumeUtilPct = Number((res.metrics.volumeUtilization * 100).toFixed(2));
    rows.push({
      id: c.id,
      suite: c.suite,
      title: c.title,
      strategy,
      requestedCount,
      loadedCount: res.metrics.loadedCount,
      volumeUtilPct,
      elapsedMs,
      oracle,
      engineValid: res.validation.valid,
      auditErrors: audit.hasErrors ? 1 : 0,
    });
  }

  const times = rows.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const utils = rows.map((r) => r.volumeUtilPct);
  const passedRuns = rows.filter((r) => r.oracle.passed && r.engineValid && r.auditErrors === 0).length;

  return {
    totalRuns: rows.length,
    passedRuns,
    totalCollisions: rows.reduce((s, r) => s + r.oracle.collisions, 0),
    totalOob: rows.reduce((s, r) => s + r.oracle.oobCount, 0),
    totalFloating: rows.reduce((s, r) => s + r.oracle.floatingCount, 0),
    totalWeightViolations: rows.filter((r) => r.oracle.weightOverLimit).length,
    totalConservationErrors: rows.reduce((s, r) => s + r.oracle.conservationErrors + r.oracle.kitIntegrityErrors, 0),
    meanVolumeUtilPct: utils.length ? Number((utils.reduce((a, b) => a + b, 0) / utils.length).toFixed(2)) : 0,
    minVolumeUtilPct: utils.length ? Math.min(...utils) : 0,
    maxVolumeUtilPct: utils.length ? Math.max(...utils) : 0,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    rows,
  };
}
