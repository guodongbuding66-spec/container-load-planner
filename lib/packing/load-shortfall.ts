import { crateAutoEnabled, isCrate } from "./crate-auto-stack";
import { inspectCargoFit } from "./engine";
import { oneLayerPalletCeilings } from "./pallet-height";
import { palletSpecifications } from "./pallet-specifications";
import { declaredTopLoad, openUnitLayers } from "./unit-stacking";
import type { PackingResult, PalletBuildSpecification, ProductInput } from "./types";

function configuredForFloor(spec: PalletBuildSpecification) {
  const {config} = spec;
  if (isCrate(config)) return !crateAutoEnabled(config) || config.unitStacking?.maxLayers === 1 || config.unitStacking?.maxTopLoadKg === 0;
  const topLoad = config.unitStacking?.enabled ? declaredTopLoad(config) : spec.maxTopLoadKg;
  return openUnitLayers(spec) === 1 || topLoad === 0 || !!config.packaging?.deckSupports?.length;
}

/** Report observed quantities and binding configuration. Never infer infeasibility from a search result. */
export function inspectLoadShortfall(plan: PackingResult, products: ProductInput[]) {
  const remaining = plan.metrics.requestedCount - plan.metrics.loadedCount;
  if (plan.mode !== "mixed" || !plan.validation.valid || remaining <= 0) return null;
  const missing = new Set(plan.summaries.filter(row => row.unloaded > 0).map(row => row.productId));
  const unplaced = products.filter(product => missing.has(product.id));
  const only = plan.workflow === "pallet-only";
  const packed = plan.palletization;
  const build = packed ? plan.palletBuild : undefined;
  const specifications = build ? palletSpecifications(build) : [];
  const loadedPallets = plan.pallets?.length ?? 0;
  const loadedSpecs = new Set(plan.pallets?.map(pallet => pallet.specificationId ?? "primary"));
  const prepared = packed?.preparedCount;
  const waiting = !only && prepared !== undefined ? Math.max(0, prepared - loadedPallets) : 0;
  const reachedTotal = !!packed?.bounded && !!build && prepared === build.maxPallets;
  const usedStock = !reachedTotal && !packed?.manualPreparation ? specifications.find(spec => {
    const used = packed?.preparedBySpecification?.[spec.id];
    return spec.maxPallets > 0 && used === spec.maxPallets && unplaced.some(product =>
      (!spec.productIds || spec.productIds.includes(product.id)) && product.quantity > (packed?.looseQuantities?.[product.id] ?? 0));
  }) : undefined;
  const floorOnly = !only && waiting > 0 && plan.pallets?.every(pallet => pallet.z <= .0001)
    ? specifications.find(spec => loadedSpecs.has(spec.id) && configuredForFloor(spec)) : undefined;
  const lowCeilings = build && !only ? oneLayerPalletCeilings({
    workflow: "palletized", mode: plan.mode, strategy: plan.strategy, palletBuild: build,
    container: plan.container, clearance: plan.clearance, products,
  }, plan) : [];
  let ceiling: {name: string; current: number; sku: string} | undefined;
  for (const spec of lowCeilings) {
    const product = spec.products.find(row => missing.has(row.productId) && row.heightLayers === 1 && row.configuredLayers !== 1);
    if (product) {ceiling = {name: spec.name, current: spec.current, sku: product.sku}; break;}
  }
  const remainingKg = Math.max(0, plan.container.maxWeight - plan.metrics.grossWeight);
  const weightBlocked = only ? undefined : unplaced.find(product => product.weight > remainingKg + .0001);
  let fitBlocked: { sku: string; reason: string } | undefined;
  if (!packed && !only) {
    for (const product of unplaced) {
      const [reason] = inspectCargoFit(product, plan.container, plan.clearance, plan.strategy).reasons;
      if (reason) { fitBlocked = {sku: product.sku, reason}; break; }
    }
  }
  return {
    remaining, only, loadedPallets, prepared, waiting, totalLimit: reachedTotal ? build?.maxPallets : undefined,
    limitedSearch: !!packed?.bounded && !reachedTotal, usedStock, floorOnly, ceiling, remainingKg, weightBlocked, fitBlocked,
  };
}
