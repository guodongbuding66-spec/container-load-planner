import { describe, expect, it } from "vitest";
import { buildPublicBenchmarkSuite, runPublicBenchmarkSuite } from "./public-benchmarks";

describe("P0 Public Academic (BR1-BR7), Extreme Geometry & Seeded Random Benchmarks", () => {
  it("passes 100% of BR1-BR7, extreme stress, and 25 seeded random instances with 0 physical violations", () => {
    const suite = buildPublicBenchmarkSuite(25, 20261127);
    const summary = runPublicBenchmarkSuite(suite, "maximum");

    expect(summary.totalRuns).toBe(37); // 7 BR + 5 extreme + 25 random
    expect(summary.totalCollisions).toBe(0);
    expect(summary.totalOob).toBe(0);
    expect(summary.totalFloating).toBe(0);
    expect(summary.totalWeightViolations).toBe(0);
    expect(summary.totalConservationErrors).toBe(0);
    expect(summary.passedRuns).toBe(summary.totalRuns);

    // Check BR1-BR7 average utilization is competitive (> 70%)
    const brRows = summary.rows.filter((r) => r.suite === "BR-weak" || r.suite === "BR-strong");
    const brMean = brRows.reduce((s, r) => s + r.volumeUtilPct, 0) / brRows.length;
    expect(brMean).toBeGreaterThan(70);

    // Log factual metrics for QA report
    console.log(
      `[P0 PUBLIC BENCHMARK] runs=${summary.passedRuns}/${summary.totalRuns} BR_mean_util=${brMean.toFixed(2)}% overall_mean=${summary.meanVolumeUtilPct}% P50=${summary.p50Ms}ms P95=${summary.p95Ms}ms P99=${summary.p99Ms}ms`,
    );
    for (const r of brRows) {
      console.log(`  ${r.id}: loaded=${r.loadedCount}/${r.requestedCount} util=${r.volumeUtilPct}% time=${r.elapsedMs}ms oracle=${r.oracle.passed}`);
    }
  }, 60000);
});
