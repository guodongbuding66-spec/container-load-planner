import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("declares preview metadata without relying on a stale local build", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");

  assert.match(layout, /["']codex-preview["']\s*:\s*["']development["']/);
  assert.match(source, /目标利用率倒推/);
  assert.match(source, /另存为自定义柜型/);
});

test("includes result-only progress and three-view interfaces", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  assert.match(source, /码垛进度/);
  const preview = await readFile(new URL("../components/pallet-unit-viewer.tsx", import.meta.url), "utf8");
  const views = await readFile(new URL("../components/plan-views.tsx", import.meta.url), "utf8");
  assert.match(source, /<PlanViews result=\{result\}/);
  assert.match(preview, /<PlanViews result=\{plan\}/);
  assert.match(views, /三视图/);
  assert.match(views, /<OrthographicViews/);
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

  assert.match(source, /const canExport = Boolean\(result\?\.validation\.valid && result\.metrics\.loadedCount > 0 && !resultAudit\?\.hasErrors && !dirty && !hasPendingDimensionChanges\)/);
  assert.match(source, /disabled=\{!canExport\}/);
  assert.match(source, /discardObsoleteCalculation/);
  assert.match(source, /旧结果已安全丢弃/);
  assert.match(source, /selectedPlanOnly = \{ \.\.\.result, strategyPlans: undefined \}/);
  assert.match(calculationState, /activeRevision !== null && activeRevision !== inputRevision/);
});

test("keeps every prediction label on the selected immutable coordinate plan", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");

  assert.match(source, /const selectedCachedPlan = strategy === "practical" \? cachedPracticalPlan : cachedMaximumPlan/);
  assert.match(source, /const selectedPlanCartons = selectedCachedPlan\?\.metrics\.loadedCount \?\? selectedFeasibleRecommendation\.totalCartons/);
  assert.match(source, /const selectedFeasibleRecommendation = feasibleRecommendation\(reversePlan, selectedCachedPlan\)/);
  assert.match(source, /selectedCachedPlan\.summaries\.map/);
  assert.match(source, /已按当前\$\{strategy === "practical" \? tr\("现场"\) : tr\("极限"\)\}算法生成并独立校验/);
});

test("only auto-recalculates in the result step and hides stale visual data", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const calculationState = await readFile(new URL("../lib/packing/calculation-state.ts", import.meta.url), "utf8");

  assert.match(source, /AUTO_CALCULATE_DELAY_MS = 280/);
  assert.match(source, /workflowStep !== 4/);
  assert.match(source, /const \[autoCalculate, setAutoCalculate\] = useState\(false\)/);
  assert.match(source, /window\.setTimeout\(calculate, AUTO_CALCULATE_DELAY_MS\)/);
  assert.match(source, /\(\) => dirty \? null : selectStrategyResult\(resultBundle, strategy\)/);
  assert.match(source, /calculateReverseCounts\([\s\S]*?strategy: "practical"/);
  assert.match(source, /\[floorPallets, activeProducts, clearance, container, mode, practicalTargetPercent, targetVolumePercent, targetWeightPercent\]/);
  assert.match(source, /const acceptedPlan = selectStrategyResult\(nextResult, strategyRef\.current\) \?\? nextResult/);
  assert.match(source, /presentPlan\(acceptedPlan\)/);
  assert.match(source, /displayedPlanIdRef\.current === plan\.id/);
  assert.match(source, /strategyRef\.current = nextStrategy/);
  assert.match(source, /strategy: "practical"/);
  assert.match(source, /统一生成双算法快照/);
  assert.match(source, /当前统一输入快照/);
  assert.match(source, /现场与极限方案统一对比/);
  assert.doesNotMatch(source, /setResult\(\{ \.\.\.cachedPlan/);
  assert.doesNotMatch(source, /点击“开始计算装柜方案”/);
  assert.match(calculationState, /Math\.min\(reversePlan\.recommendedTotal, verifiedCartons\)/);
  assert.match(calculationState, /Math\.floor\(rawCartons \/ Math\.max\(1, reversePlan\.cartonsPerSet\)\)/);
});

test("batches all dimension fields into one committed recalculation", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const numericInput = await readFile(new URL("../components/numeric-input.tsx", import.meta.url), "utf8");

  assert.match(numericInput, /onFocusChange\?: \(focused: boolean\) => void/);
  assert.match(numericInput, /onFocusChange\?\.\(true\)/);
  assert.match(numericInput, /onFocusChange\?\.\(false\)/);
  assert.match(source, /pendingDimensionChangesRef/);
  assert.match(source, /stageProductDimension\(product\.id, "length"/);
  assert.match(source, /stageProductDimension\(product\.id, "width"/);
  assert.match(source, /stageProductDimension\(product\.id, "height"/);
  assert.match(source, /onFocusChange=\{handleDimensionFocusChange\}/);
  assert.match(source, /workflowStep !== 4 \|\| manualRun \|\| status === "working" \|\| !autoCalculate \|\| !hydrated \|\| isEditingDimensions \|\| hasPendingDimensionChanges/);
  assert.match(source, /if \(!dirty && resultBundle\) return/);
  assert.match(source, /完成所有长、宽、高并离开尺寸输入区后，统一提交完整箱规/);
  assert.match(source, /离开尺寸字段后统一提交长、宽、高，再确认托内布置和计算/);
});

test("debounces draft persistence and recognizes a one-code multi-carton CSV as one product", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const setUtils = await readFile(new URL("../lib/packing/set-utils.ts", import.meta.url), "utf8");

  assert.match(source, /STORAGE_SAVE_DELAY_MS = 320/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*?localStorage\.setItem[\s\S]*?STORAGE_SAVE_DELAY_MS/);
  assert.match(source, /inferImportedPackingMode\(next\)/);
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

  assert.match(source, /role="group" aria-label=\{tr\("装载方式", "Loading workflow"\)\}/);
  assert.match(source, /aria-pressed=\{workflow === value\}/);
  assert.match(source, /aria-label=\{tr\("安全间隙"\)\}/);
  assert.match(source, /aria-label=\{tr\("目标体积利用率滑块"\)\}/);
  assert.match(source, /ariaLabel=\{tt`\$\{rowLabel\} 外箱长`\}/);
  assert.match(source, /ariaLabel=\{tt`\$\{rowLabel\} 层数上限`\}/);
});

test("keeps unit switching canonical and removes implicit layer caps and leading-zero coercion", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const numericInput = await readFile(new URL("../components/numeric-input.tsx", import.meta.url), "utf8");
  const units = await readFile(new URL("../lib/packing/units.ts", import.meta.url), "utf8");
  const presets = await readFile(new URL("../lib/packing/presets.ts", import.meta.url), "utf8");
  const csv = await readFile(new URL("../lib/packing/csv.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(source, /maxStackLayers: 0/);
  assert.doesNotMatch(source, /item\.maxStackLayers, item\.unitsPerSet\]\.every\(Number\.isFinite\)/);
  assert.doesNotMatch(presets, /maxStackLayers: [1-9]/);
  assert.match(source, /0 = 自动按柜高/);
  assert.match(source, /aria-label=\{tr\("箱规录入单位"\)\}/);
  assert.match(source, /toMillimeters\(value, lengthUnit\)/);
  assert.match(source, /toKilograms\(value, weightUnit\)/);
  assert.match(numericInput, /type="text"/);
  assert.match(numericInput, /parsed\.state !== "valid"/);
  assert.match(units, /mm: 1/);
  assert.match(units, /kg: 1/);
  assert.match(csv, /get\("lengthUnit"\)/);
  assert.match(csv, /get\("weightUnit"\)/);
  assert.match(styles, /\.product-table td \.cell-unit[^}]*text-align: center/s);
});

test("keeps a multi-carton product in single-product mode without carton demand input", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");

  assert.match(source, /loadTwoCartonSetTest[\s\S]*?setMode\("single"\)/);
  assert.match(source, /不需要填写需求箱数/);
  assert.match(source, /mode === "mixed" \? <th>\{tr\("需求箱数"\)\}<\/th> : null/);
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

  assert.match(source, /aria-label=\{tr\("装柜执行策略"\)\}/);
  assert.match(source, /现场易执行/);
  assert.match(source, /高密度参考/);
  assert.match(source, /载入真实 A64M/);
  assert.match(source, /报价轨按已确认的 396 套/);
  assert.match(source, /报价经验预测/);
  assert.match(source, /局部支撑箱体/);
  assert.match(source, /载入用户提供的真实装柜记录/);
  assert.match(engine, /function buildPracticalLayeredSet/);
  assert.match(engine, /function buildPracticalZonedSet/);
  assert.match(engine, /function buildPracticalSingleSideStrip/);
  assert.match(engine, /function orderForLoading/);
  assert.match(engine, /assignPalletReferences\(orderForLoading\(output\.placements\.filter/);
  assert.match(engine, /PRACTICAL_SUPPORT_RATIO = 0\.995/);
  assert.match(presets, /"40hq": \{ cartons: 792, sets: 396 \}/);
  assert.match(estimator, /loadingSets: \{ "20gp": 110, "40gp": 230, "40hq": 275 \}/);
});

test("runs two independent solvers and exposes actionable strategy guidance", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../lib/packing/packing.worker.ts", import.meta.url), "utf8");
  const views = await readFile(new URL("../components/orthographic-views.tsx", import.meta.url), "utf8");

  assert.match(worker, /packLoadingWorkflow\(\{/);
  assert.match(worker, /type !== "pack-strategy"/);
  assert.match(engine, /export function packWithComparison/);
  assert.match(engine, /export function combineStrategyResults/);
  assert.match(engine, /function maximumMultiplierBySlabDp/);
  assert.match(source, /className="strategy-comparison"/);
  assert.match(source, /现场算法 × 高密度参考算法/);
  assert.match(source, /完成录入后统一生成双算法快照/);
  assert.match(source, /switchStrategy\("practical"\)/);
  assert.match(source, /switchStrategy\("maximum"\)/);
  assert.match(source, /resultBundle\?\.strategyPlans\?\./);
  assert.match(source, /selectStrategyResult\(resultBundle, strategy\)/);
  assert.match(source, /terminateActiveWorkers\(\)/);
  assert.match(source, /detectRuntimePolicy\(\)/);
  assert.match(source, /runtimePolicy\.calculationTimeoutMs/);
  assert.match(source, /startStrategyWorker\("practical"\)/);
  assert.match(source, /runtimePolicy\.schedule === "parallel"\) startStrategyWorker\("maximum"\)/);
  assert.match(source, /runtimePolicy\.schedule === "practical-first" && solverStrategy === "practical"/);
  assert.match(source, /completeWithAvailablePlan\(tr\("后台算法达到设备保护时限，"\)\)/);
  assert.match(source, /const partialBundle: PackingResult/);
  assert.match(source, /strategyPlans: \{ \.\.\.workerResultsRef\.current \}/);
  assert.match(source, /方案已完成并可查看；另一套算法仍在后台独立计算/);
  assert.match(source, /当前所选算法已完成并可查看、打印或导出/);
  assert.match(source, /const finishActiveCalculation = useCallback/);
  assert.match(source, /if \(activeRequestRef\.current\) clearActiveCalculation\(\)/);
  assert.match(source, /let worker = workersRef\.current\[solverStrategy\]/);
  assert.match(source, /finishActiveCalculation\(\);/);
  const selectedResult = source.slice(source.indexOf("const result = useMemo"), source.indexOf("const terminateActiveWorkers"));
  assert.doesNotMatch(selectedResult, /status/); // Background work must not hide a completed plan.
  assert.match(source, /tippedCartonCount/);
  assert.match(engine, /const strategyPlans/);
  assert.match(engine, /practical: practicalPlan/);
  assert.match(engine, /maximum: maximumPlan/);
  assert.match(views, /<button[\s\S]*?className=\{`projection-card/);
  assert.doesNotMatch(views, /role="button"/);
});

test("protects mobile calculations and enforces a readable typography floor", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const scene = await readFile(new URL("../components/container-scene.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const runtimePolicy = await readFile(new URL("../lib/packing/runtime-policy.ts", import.meta.url), "utf8");

  assert.match(runtimePolicy, /schedule: "practical-first"/);
  assert.match(runtimePolicy, /calculationTimeoutMs: 35_000/);
  assert.match(runtimePolicy, /viewportWidth <= 680/);
  assert.match(source, /设备节能计算已启用/);
  assert.match(source, /高密度超时或失败不会清空现场结果/);
  assert.match(scene, /shadows=\{!reducedRendering\}/);
  assert.match(scene, /dpr=\{reducedRendering \? \[1, 1\.1\] : \[1, 1\.6\]\}/);
  assert.match(styles, /--type-caption: 12px/);
  assert.match(styles, /--type-control: 13px/);
  assert.match(styles, /Readability floor/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?font-size: 16px/s);
  assert.match(styles, /\.set-summary-grid > article:only-child \{ grid-column: 1 \/ -1; \}/);
});

test("separates utilization planning from the selected strategy capacity ceiling", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");
  const types = await readFile(new URL("../lib/packing/types.ts", import.meta.url), "utf8");

  assert.match(source, /计划目标与装载上限/);
  assert.match(source, /计划量 ≠ 最大量/);
  assert.match(source, /统一建议量/);
  assert.match(source, /feasibleRecommendation\(reversePlan, selectedCachedPlan\)/);
  assert.match(source, /现场计划方案 · \$\{formatNumber\(resultLoadedDisplay\)\}/);
  assert.match(source, /算术上限 \$\{formatNumber\(resultPlanLimitDisplay\)\}/);
  assert.match(source, /singleCartonLimit: mode === "single" \? reversePlan\.recommendedTotal/);
  assert.match(source, /现场方案预测/);
  assert.match(source, /高密度参考预测/);
  assert.match(source, /className="planning-comparison"/);
  assert.match(source, /className=\{`plan-context-chip/);
  assert.match(source, /高密度参考方案/);
  assert.match(source, /tr\("实际体积 "\)\}\{formatPercent\(result\.metrics\.volumeUtilization\)\}\{tr\(" · 实际载重 "\)/);
  assert.match(source, /setTargetWeightPercent[\s\S]{0,180}markDirty\(\)/);
  assert.match(types, /singleCartonLimit\?: number/);
  assert.match(engine, /planningSetBound/);
  assert.match(engine, /singleCartonLimit: request\.mode === "single" \? undefined/);
});

test("uses sets as the primary visualization unit for a single multi-carton product", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const views = await readFile(new URL("../components/orthographic-views.tsx", import.meta.url), "utf8");
  const progress = await readFile(new URL("../lib/packing/progress.ts", import.meta.url), "utf8");

  assert.match(source, /tr\("整套 "\)\}\{formatNumber\(progressSummary\.completedSets\)\}/);
  assert.match(source, /tr\("箱级进度 "\)\}\{formatNumber\(progressSummary\.visibleCartons\)\}/);
  assert.match(source, /柜内 → 箱门/);
  assert.match(source, /已完成 \$\{formatNumber\(progressSummary\.completedSets\)\}\/\$\{formatNumber\(progressSummary\.totalSets\)\} 套/);
  assert.match(source, /当前箱归属套号 \$\{formatNumber\(progressSummary\.currentSetNumber\)\}/);
  assert.match(source, /cachedPracticalPlan[\s\S]{0,180}formatNumber\(practicalPredictionDisplay \?\? 0\)/);
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
  assert.match(headers, /\/_next\/static\/\*/);
  assert.match(headers, /Cache-Control: public, max-age=31556952, immutable/);
});

test("auto-calculates CBM and displays complete sets before carton details", async () => {
  const source = await readFile(new URL("../components/packing-app.tsx", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/packing/engine.ts", import.meta.url), "utf8");

  assert.match(source, /<th>\{tr\("CBM 自动"\)\}<\/th>/);
  assert.match(source, /className="cbm-auto-value"/);
  assert.match(source, /volumePending\?"—":roundedCbm/);
  assert.match(source, /精确值 "\)\}\{calculatedCbm\.toFixed\(4\)\}/);
  assert.doesNotMatch(source, /aria-label=\{`\$\{product\.sku\} 标称 CBM`\}/);
  assert.match(source, /reversePlan\.volumeLimitedDisplay/);
  assert.match(source, /reversePlan\.displayUnit === "set" \? tr\("套"\) : tr\("箱"\)/);
  assert.match(engine, /displayUnit: displayAsSets \? "set" : "carton"/);
});
