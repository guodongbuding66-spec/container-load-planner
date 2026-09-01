import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /目标利用率倒推/);
  assert.match(html, /另存为自定义柜型/);
  assert.doesNotMatch(html, /container-scene/);
});

test("includes result-only progress and three-view interfaces", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  assert.match(source, /码垛进度/);
  assert.match(source, /三视图同步复核/);
  assert.match(source, /OrthographicViews/);
});

test("prints three-view diagrams as undistorted vector artwork", async () => {
  const source = await readFile(new URL("../components/orthographic-views.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(source, /className="projection-print-svg"/);
  assert.match(source, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(styles, /\.viewer-projections \.projection-canvas \{ display: none !important; \}/);
  assert.match(styles, /\.viewer-projections \.projection-print-svg \{ display: block;/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
});

test("includes arbitrary multi-carton set creation and traceability", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");
  const csv = await readFile(new URL("../lib/packing/csv.ts", import.meta.url), "utf8");

  assert.match(source, /多箱套装助手/);
  assert.match(source, /\[2, 3, 4, 5\]/);
  assert.match(source, /增加箱型/);
  assert.match(source, /向下对齐/);
  assert.match(csv, /套装编码,套号,套内序号/);
  assert.match(engine, /box\.setNumber = batch\.setNumber/);
  assert.match(engine, /box\.setItemNumber = itemIndex \+ 1/);
});

test("blocks stale or invalid exports and discards obsolete worker results", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const calculationState = await readFile(new URL("../lib/packing/calculation-state.ts", import.meta.url), "utf8");

  assert.match(source, /const canExport = Boolean\(result\?\.validation\.valid && !dirty/);
  assert.match(source, /disabled=\{!canExport\}/);
  assert.match(source, /discardObsoleteCalculation/);
  assert.match(source, /旧结果或旧错误已安全丢弃/);
  assert.match(source, /selectedPlanOnly = \{ \.\.\.result, strategyPlans: undefined \}/);
  assert.match(calculationState, /activeRevision !== null && activeRevision !== inputRevision/);
});

test("keeps every prediction label on the selected cached coordinate plan", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");

  assert.match(source, /const selectedCachedPlan = strategy === "practical" \? cachedPracticalPlan : cachedMaximumPlan/);
  assert.match(source, /selectedCachedPlan\?\.metrics\.loadedCount \?\? reversePlan\.recommendedTotal/);
  assert.match(source, /selectedCachedPlan\.summaries\.map/);
  assert.match(source, /已按当前\$\{strategy === "practical" \? "现场" : "极限"\}算法生成并独立校验/);
});

test("debounces draft persistence and recognizes a one-code multi-carton CSV as one product", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const setUtils = await readFile(new URL("../lib/packing/set-utils.ts", import.meta.url), "utf8");

  assert.match(source, /STORAGE_SAVE_DELAY_MS = 320/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*?localStorage\.setItem[\s\S]*?STORAGE_SAVE_DELAY_MS/);
  assert.match(source, /inferImportedPackingMode\(parsed\)/);
  assert.match(setUtils, /export function inferImportedPackingMode/);
});

test("defers the heavy 3D bundle until a result exists and isolates render failures", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const boundary = await readFile(new URL("../components/scene-error-boundary.tsx", import.meta.url), "utf8");

  assert.match(source, /\{result \? \([\s\S]*?<SceneErrorBoundary[\s\S]*?<ContainerScene/);
  assert.match(source, /等待计算方案/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /重新加载三维视图/);
});

test("provides accessible names for mode, ranges, and product data fields", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");

  assert.match(source, /role="group" aria-label="计算模式"/);
  assert.match(source, /aria-pressed=\{mode === "single"\}/);
  assert.match(source, /aria-label="安全间隙"/);
  assert.match(source, /aria-label="目标体积利用率滑块"/);
  assert.match(source, /aria-label=\{`\$\{product\.sku\} 外箱长`\}/);
  assert.match(source, /aria-label=\{`\$\{product\.sku\} 层数上限`\}/);
});

test("keeps a multi-carton product in single-product mode without carton demand input", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");

  assert.match(source, /loadTwoCartonSetTest[\s\S]*?setMode\("single"\)/);
  assert.match(source, /不需要填写需求箱数/);
  assert.match(source, /mode === "mixed" \? <th>需求箱数<\/th> : null/);
  assert.doesNotMatch(source, /const addCartonSet[\s\S]{0,160}setMode\("mixed"\)/);
  assert.match(engine, /function packSingleSet/);
  assert.match(engine, /products: selectProductsForMode\(normalizedProducts, request\.mode\)/);
});

test("keeps the two-column workspace contained and provides Liquid Glass fallbacks", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(styles, /\.workspace-grid \{[^}]*minmax\(0, 1fr\)/s);
  assert.match(styles, /\.workspace-grid > \*, \.config-column, \.viewer-column \{ min-width: 0; max-width: 100%; \}/);
  assert.match(styles, /\.target-control \{[^}]*grid-template-columns: minmax\(0, \.95fr\) minmax\(0, 1\.05fr\)/s);
  assert.match(styles, /@media \(max-width: 1100px\) \{[^}]*\.workspace-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/s);
  assert.match(styles, /backdrop-filter: blur\(24px\) saturate\(155%\)/);
  assert.match(styles, /@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)/);
});

test("offers a worker-executable strategy and a unit-safe real loading benchmark", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");
  const presets = await readFile(new URL("../lib/packing/presets.ts", import.meta.url), "utf8");
  const estimator = await readFile(new URL("../lib/packing/quote-estimator.ts", import.meta.url), "utf8");

  assert.match(source, /aria-label="装柜执行策略"/);
  assert.match(source, /现场易执行/);
  assert.match(source, /极限理论/);
  assert.match(source, /载入真实 A64M/);
  assert.match(source, /报价轨按已确认的 396 套/);
  assert.match(source, /报价经验预测/);
  assert.match(source, /局部支撑箱体/);
  assert.match(source, /载入用户提供的真实装柜记录/);
  assert.match(engine, /function buildPracticalLayeredSet/);
  assert.match(engine, /function buildPracticalZonedSet/);
  assert.match(engine, /function buildPracticalSingleSideStrip/);
  assert.match(engine, /function orderForPracticalLoading/);
  assert.match(engine, /PRACTICAL_SUPPORT_RATIO = 0\.995/);
  assert.match(presets, /"40hq": \{ cartons: 792, sets: 396 \}/);
  assert.match(estimator, /loadingSets: \{ "20gp": 110, "40gp": 230, "40hq": 275 \}/);
});

test("runs two independent solvers and exposes actionable strategy guidance", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../lib/packing/packing.worker.ts", import.meta.url), "utf8");
  const views = await readFile(new URL("../components/orthographic-views.tsx", import.meta.url), "utf8");

  assert.match(worker, /packWithComparison/);
  assert.match(engine, /export function packWithComparison/);
  assert.match(engine, /function maximumMultiplierBySlabDp/);
  assert.match(source, /className="strategy-comparison"/);
  assert.match(source, /现场算法 × 极限理论算法/);
  assert.match(source, /计算一次会缓存两套完整坐标/);
  assert.match(source, /switchStrategy\("practical"\)/);
  assert.match(source, /switchStrategy\("maximum"\)/);
  assert.match(source, /result\?\.strategyPlans\?\./);
  assert.match(source, /tippedCartonCount/);
  assert.match(engine, /const strategyPlans/);
  assert.match(engine, /practical: practicalPlan/);
  assert.match(engine, /maximum: maximumPlan/);
  assert.match(views, /<button[\s\S]*?className=\{`projection-card/);
  assert.doesNotMatch(views, /role="button"/);
});

test("separates utilization planning from the selected strategy capacity ceiling", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");
  const types = await readFile(new URL("../lib/packing/types.ts", import.meta.url), "utf8");

  assert.match(source, /计划目标与装载上限/);
  assert.match(source, /计划量 ≠ 最大量/);
  assert.match(source, /按目标生成 \$\{formatNumber\(reversePlan\.recommendedDisplay\)\}/);
  assert.match(source, /singleCartonLimit: mode === "single" \? reversePlan\.recommendedTotal/);
  assert.match(source, /现场方案预测/);
  assert.match(source, /极限理论预测/);
  assert.match(source, /className="planning-comparison"/);
  assert.match(source, /className=\{`plan-context-chip/);
  assert.match(source, /极限理论方案/);
  assert.match(source, /实际体积 \{formatPercent\(result\.metrics\.volumeUtilization\)\} · 实际载重/);
  assert.match(source, /setTargetWeightPercent[\s\S]{0,180}markDirty\(\)/);
  assert.match(types, /singleCartonLimit\?: number/);
  assert.match(engine, /planningSetBound/);
  assert.match(engine, /singleCartonLimit: request\.mode === "single" \? undefined/);
});

test("uses sets as the primary visualization unit for a single multi-carton product", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const views = await readFile(new URL("../components/orthographic-views.tsx", import.meta.url), "utf8");
  const progress = await readFile(new URL("../lib/packing/progress.ts", import.meta.url), "utf8");

  assert.match(source, /整套 \{formatNumber\(progressSummary\.completedSets\)\}/);
  assert.match(source, /箱级进度 \{formatNumber\(progressSummary\.visibleCartons\)\}/);
  assert.match(source, /已完成 \$\{formatNumber\(progressSummary\.completedSets\)\}\/\$\{formatNumber\(progressSummary\.totalSets\)\} 套/);
  assert.match(source, /本步第 \$\{formatNumber\(progressSummary\.currentSetNumber\)\} 套/);
  assert.match(source, /primaryCountLabel=\{progressSummary\?\.isSetMode/);
  assert.match(views, /<b>\{primaryCountLabel\}<\/b>/);
  assert.match(views, /secondaryCountLabel/);
  assert.match(progress, /A set is counted as completed only after every carton/);
});

test("ships Cloudflare security headers without blocking the static Next bootstrap or packing worker", async () => {
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");

  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /script-src 'self' 'unsafe-inline'/);
  assert.match(headers, /worker-src 'self' blob:/);
  assert.match(headers, /object-src 'none'/);
});

test("auto-calculates CBM and displays complete sets before carton details", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");

  assert.match(source, /<th>CBM 自动<\/th>/);
  assert.match(source, /className="cbm-auto-value"/);
  assert.match(source, /精确值 \{calculatedCbm\.toFixed\(4\)\}/);
  assert.doesNotMatch(source, /aria-label=\{`\$\{product\.sku\} 标称 CBM`\}/);
  assert.match(source, /reversePlan\.volumeLimitedDisplay/);
  assert.match(source, /reversePlan\.displayUnit === "set" \? "套" : "箱"/);
  assert.match(engine, /displayUnit: displayAsSets \? "set" : "carton"/);
});
