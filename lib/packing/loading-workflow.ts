import {assertDeckSupportStacking} from "./deck-support";
import {parseLooseQuantities} from "./loose-cargo";
import { parseFloorPalletConfig } from "./floor-pallets";
import { DEFAULT_PACKAGING, packagingHeight } from "./packaging";
import { parsePackagingLimit, parsePackagingSelection, parsePackagingSpecifications, parsePalletCartonLimit } from "./pallet-specifications";
import type { ContainerSpec, FloorPalletConfig, LoadingWorkflow, PalletBuildOptions, PackingMode } from "./types";

export const DEFAULT_PALLET_BUILD: PalletBuildOptions = {
  config: { packaging: {...DEFAULT_PACKAGING}, presetId: "eur-1200-800", name: "EUR", length: 1200, width: 800, height: 144, weight: 25, maxLoad: 1000, count: 0, gap: 0, layout: "auto", allowFloorCargo: false, maxCargoHeight: 1000 },
  mix: "single", maxPallets: 50, stackLayers: 1, maxTopLoadKg: 0,
};
export function parseLoadingWorkflow(value: unknown, mode: PackingMode = "mixed"): LoadingWorkflow {
  if (value === undefined) return mode === "single" ? "single-capacity" : "direct";
  if (!["direct", "pallet-only", "palletized", "single-capacity"].includes(value as string)) throw new Error("装载方式无效");
  return value as LoadingWorkflow;
}
export function parsePalletBuild(value: unknown, draft=false): PalletBuildOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("打托配置无效");
  const p = value as PalletBuildOptions;
  if(p.oneKitPerPallet!==undefined&&typeof p.oneKitPerPallet!=="boolean")throw Error("Invalid one-kit pallet rule");
  const looseQuantities=parseLooseQuantities(p.looseQuantities);
  if (!["single", "mixed"].includes(p.mix) || !Number.isInteger(p.maxPallets) || p.maxPallets < 1 || p.maxPallets > 200 || !Number.isInteger(p.stackLayers) || p.stackLayers < 1 || p.stackLayers > 20 || !Number.isFinite(p.maxTopLoadKg) || p.maxTopLoadKg < 0 || p.maxTopLoadKg > 100000) throw new Error("托盘数量、堆叠层数或承重无效");
  if(p.selection!==undefined&&p.selection!=="ordered"&&p.selection!=="compact")throw new Error("Invalid packaging selection mode");
  let primaryRule: PalletBuildOptions["primaryRule"];
  if (p.primaryRule !== undefined) {
    if (!p.primaryRule || typeof p.primaryRule !== "object" || Array.isArray(p.primaryRule)) throw new Error("Invalid primary packaging rule");
    const productIds = parsePackagingSelection(p.primaryRule.productIds);
    const cartonLimit = parsePalletCartonLimit(p.primaryRule.cartonLimit);
    primaryRule = {
      maxPallets: parsePackagingLimit(p.primaryRule.maxPallets),
      ...(productIds ? {productIds} : {}),
      ...(cartonLimit === undefined ? {} : {cartonLimit}),
    };
  }
  let additionalSpecs: PalletBuildOptions["additionalSpecs"];
  if(p.additionalSpecs!==undefined){if(!Array.isArray(p.additionalSpecs)||p.additionalSpecs.length>7)throw new Error("Use at most 8 packaging specifications");if(p.additionalSpecs.length){additionalSpecs=parsePackagingSpecifications(p.additionalSpecs,draft);if(additionalSpecs.some(s=>s.id==="primary"))throw new Error("Primary packaging identifier is reserved");}}
  const config=parseFloorPalletConfig(p.config,draft);
  if(!draft)assertDeckSupportStacking(config,p.stackLayers,p.maxTopLoadKg);
  return { ...(p.oneKitPerPallet?{oneKitPerPallet:true}:{}), ...(looseQuantities?{looseQuantities}:{}), ...(p.selection===undefined?{}:{selection:p.selection}), config: { ...config, count: 0, allowFloorCargo: false }, mix: p.mix, maxPallets: p.maxPallets, stackLayers: p.stackLayers, maxTopLoadKg: p.maxTopLoadKg, ...(primaryRule?{primaryRule}:{}),...(additionalSpecs?{additionalSpecs}:{}) };
}
export function palletInspectionContainer(config: FloorPalletConfig, count: number): ContainerSpec {
  const columns = Math.min(5, Math.ceil(Math.sqrt(count))), rows = Math.ceil(count / columns), spacing = 200;
  return { id: "pallet-inspection", name: "托盘编组区", category: "other", loadingAccess: "open",
    length: columns * config.length + (columns - 1) * spacing, width: rows * config.width + (rows - 1) * spacing,
    height: packagingHeight(config), doorWidth: rows * config.width + (rows - 1) * spacing,
    doorHeight: packagingHeight(config), maxWeight: count * (config.maxLoad + config.weight) };
}
