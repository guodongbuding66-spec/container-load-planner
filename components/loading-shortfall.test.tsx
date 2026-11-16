import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { packLoadingWorkflow } from "../lib/packing/pack-loading";
import { inspectLoadShortfall } from "../lib/packing/load-shortfall";
import { oneLayerCrateFixture } from "../tests/one-layer-crate-fixture";
import { orderCapacityFixture } from "../tests/order-capacity-fixture";
import { setAppLanguage } from "./language";
import { LoadingShortfall } from "./loading-shortfall";

afterEach(() => {
  vi.stubGlobal("document", {documentElement: {lang: ""}});
  setAppLanguage("zh");
  vi.unstubAllGlobals();
});

it("explains the reconstructed 16-carton result with different carton and pallet restrictions", () => {
  const request = oneLayerCrateFixture();
  const plan = packLoadingWorkflow(request);
  const report = inspectLoadShortfall(plan, request.products);
  expect(plan.metrics.loadedCount).toBe(16);
  expect(report).toMatchObject({remaining: 580, loadedPallets: 4, prepared: 50, waiting: 46, totalLimit: 50, ceiling: {current: 125}, floorOnly: {id: "primary"}});
  const props = {plan, products: request.products, onDetails: vi.fn(), onGuide: vi.fn()};
  const html = renderToStaticMarkup(<LoadingShortfall {...props}/>);
  expect(html).toContain("580 箱未装柜");
  expect(html).toContain("托内净高 125 mm，REAL-1CTN 只够一层纸箱");
  expect(html).toContain("当前整托规则仅允许底置");
  expect(html).toContain("查看详细诊断");
  vi.stubGlobal("document", {documentElement: {lang: ""}});
  setAppLanguage("en");
  const en = renderToStaticMarkup(<LoadingShortfall {...props}/>);
  expect(en).toContain("580 cartons still to load");
  expect(en).toContain("46 awaiting loading");
});

it("reports the prepared limit without suggesting a pallet is waiting when every prepared pallet loaded", () => {
  const request = oneLayerCrateFixture();
  request.palletBuild!.maxPallets = 1;
  const report = inspectLoadShortfall(packLoadingWorkflow(request), request.products);
  expect(report).toMatchObject({prepared: 1, waiting: 0, totalLimit: 1});
  expect(report?.floorOnly).toBeUndefined();
});

it("explains proven direct-load limits and leaves a complete order without a warning", () => {
  const base = orderCapacityFixture(3);
  const request = {...base, workflow: "direct" as const, palletBuild: undefined};
  const complete = packLoadingWorkflow(request);
  expect(inspectLoadShortfall(complete, request.products)).toBeNull();
  const blockedByWeight = packLoadingWorkflow({...request, container: {...request.container, maxWeight: 100}});
  expect(inspectLoadShortfall(blockedByWeight, request.products)).toMatchObject({remaining: 1, remainingKg: 16, weightBlocked: {weight: 42}});
  const tooShort = packLoadingWorkflow({...request, container: {...request.container, doorHeight: 100}});
  expect(inspectLoadShortfall(tooShort, request.products)?.fitBlocked?.reason).toContain("门洞");
});
