import { pack, restorePackingSnapshot, getOrientations, MAX_VISIBLE_PLACEMENTS } from "./engine";
import { quarterTurnOrientation, bodyContactArea } from "./cargo-body";
import { bearingLoads, bearingLimit } from "./bearing";
import { parseFloorPalletConfig, palletCargoCeiling } from "./floor-pallets";
import { DEFAULT_PALLET_BUILD, parsePalletBuild, palletInspectionContainer } from "./loading-workflow";
import type { PackingRequest, PackingResult, PlacedBox, PlacedPallet, ProductInput, FloorPalletConfig, PalletBuildOptions } from "./types";

export type PreparedUnit = { id: string; cargo: PlacedBox[]; height: number; weight: number; tail: boolean; topCapacity: number };

/** A flat, complete top and the tightest known residual load limit are required. */
function topCapacity(cargo: PlacedBox[], request: PackingRequest, config: FloorPalletConfig, options: PalletBuildOptions) {
  if (options.stackLayers === 1 || options.maxTopLoadKg <= 0) return 0;
  const top = Math.max(...cargo.map(b => b.z + b.dz));
  const deck: PlacedBox = { id: "__test-top__", productId: "__test-top__", sku: "__loaded-pallet__", name: "Pallet", color: "#997947", x: 0, y: 0, z: top, dx: config.length, dy: config.width, dz: config.height, weight: 1, layer: 1, orientation: "LWH" };
  const rules = new Map(request.products.map(p => [p.id, p]));
  const touching = cargo.filter(b => bodyContactArea(deck, b, undefined, rules.get(b.productId)) > .0001);
  const area = touching.reduce((n, b) => n + bodyContactArea(deck, b, undefined, rules.get(b.productId)), 0);
  if (area < config.length * config.width - .0001 || touching.some(b => rules.get(b.productId)?.stackable === false || rules.get(b.productId)?.allowedAboveSkus !== undefined)) return 0;
  const baseline = bearingLoads(cargo, request.products), unit = bearingLoads([...cargo, deck], request.products);
  let capacity = Math.min(options.maxTopLoadKg, config.maxLoad - cargo.reduce((n, b) => n + b.weight, 0));
  for (const b of cargo) {
    const fraction = (unit.get(b.id) ?? 0) - (baseline.get(b.id) ?? 0), limit = bearingLimit(b, rules.get(b.productId));
    if (fraction > 0 && limit !== undefined) capacity = Math.min(capacity, (limit - (baseline.get(b.id) ?? 0)) / fraction);
  }
  return Math.max(0, capacity);
}

/** Pack cargo first, then solve rigid loaded-pallet envelopes, or keep independent pallets. */
export function palletizeThenPack(request: PackingRequest, input: FloorPalletConfig, mix: "single" | "mixed", maxPallets = 20, build?: PalletBuildOptions) {
  const started = performance.now();
  const config = parseFloorPalletConfig(input);
  const options = parsePalletBuild(build ?? { ...DEFAULT_PALLET_BUILD, config, mix, maxPallets });
  const only = request.workflow === "pallet-only", strategy = request.strategy ?? "practical";
  if (request.mode !== "mixed") throw new Error("打托需要明确订单数量");
  if (only && !config.maxCargoHeight) throw new Error("只打托模式请设置货物限高");
  const cargoHeight = only ? config.maxCargoHeight! : palletCargoCeiling(request.container, request.clearance, config) - config.height;
  if (cargoHeight <= 0) throw new Error("托盘上方没有可用净高");
  const remaining = request.products.map(p => ({ ...p })).sort((a,b)=>Number(b.mustLoad!==false)-Number(a.mustLoad!==false)||b.priority-a.priority), prepared: PreparedUnit[] = [], failed = new Set<string>();
  let cartonCount = 0;
  while (prepared.length < options.maxPallets && cartonCount < MAX_VISIBLE_PLACEMENTS) {
    const first = remaining.find(p => p.quantity > 0 && !failed.has(p.id));
    if (!first) break;
    const products = remaining.filter(p => p.quantity > 0 && (mix === "mixed" || (first.setCode?.trim() ? p.setCode === first.setCode : p.id === first.id)));
    const local = pack({ ...request, palletBuildStage:true, workflow: undefined, palletBuild: undefined, floorPallets: undefined, mode: "mixed", strategy, practicalTargetUtilization: .95,
      container: { id: "build-pallet", name: config.name, category: "pallet", loadingAccess: "open", length: config.length, width: config.width, height: cargoHeight, doorWidth: config.width, doorHeight: cargoHeight, maxWeight: config.maxLoad }, clearance: 0, products });
    if (!local.validation.valid) throw new Error(local.validation.errors.join("; "));
    if (!local.placements.length) { products.forEach(p => failed.add(p.id)); if (mix === "mixed") break; continue; }
    if (cartonCount + local.placements.length > MAX_VISIBLE_PLACEMENTS) break;
    const height = Math.max(...local.placements.map(b => b.z + b.dz));
    prepared.push({ id: `unit-${prepared.length + 1}`, cargo: local.placements, height: height + config.height, weight: local.metrics.grossWeight + config.weight,
      tail: local.summaries.every(s => s.unloaded === 0), topCapacity: only ? 0 : topCapacity(local.placements, request, config, options) });
    cartonCount += local.placements.length;
    const counts = new Map<string, number>(); for (const b of local.placements) counts.set(b.productId, (counts.get(b.productId) ?? 0) + 1);
    for (const p of remaining) p.quantity -= counts.get(p.id) ?? 0;
  }
  if (!prepared.length) throw new Error("没有货物能按当前尺寸、限高、载重、朝向或完整套装规则放上托盘");
  const units: ProductInput[] = prepared.map(p => ({ id: p.id, sku: p.id, name: config.name, length: config.length, width: config.width, height: p.height, weight: p.weight, quantity: 1, priority: Math.max(...p.cargo.map(b=>request.products.find(q=>q.id===b.productId)!.priority)), mustLoad: p.cargo.some(b=>request.products.find(q=>q.id===b.productId)!.mustLoad!==false), rotationPolicy: "upright",
    allowedOrientations: p.cargo.every(b => {
      const input = request.products.find(q => q.id === b.productId)!;
      return getOrientations(input, false).some(o => o.dx === b.dy && o.dy === b.dx && o.dz === b.dz && (!input.allowedOrientations || o.label === `${b.orientation[1]}${b.orientation[0]}${b.orientation[2]}`));
    }) ? config.layout === "long" ? ["LWH"] : config.layout === "cross" ? ["WLH"] : ["LWH", "WLH"] : ["LWH"], stackable: p.topCapacity > 0, maxTopLoadKg: p.topCapacity, maxStackLayers: options.stackLayers,
    bottomOnly: options.stackLayers === 1, minimumSupportRatio: 1, protectionGap: config.gap, cargoType: "pallet", palletBaseHeight: config.height, color: "#997947" }));
  // Independent pallets are laid out for inspection; this area is not a vehicle.
  const columns = Math.min(5, Math.ceil(Math.sqrt(prepared.length))), spacing = 200;
  const container = only ? palletInspectionContainer(config, prepared.length) : request.container;
  const outer = only ? null : pack({ ...request, workflow: undefined, palletBuild: undefined, floorPallets: undefined, products: units.some(p=>config.layout!=="cross"||p.allowedOrientations?.includes("WLH")) ? units.filter(p=>config.layout!=="cross"||p.allowedOrientations?.includes("WLH")) : units.map(p=>({...p,quantity:0})),
    loadingRules: request.loadingRules ? { ...request.loadingRules, supportByType: undefined } : undefined, mode: "mixed", strategy });
  if (outer && !outer.validation.valid) throw new Error(outer.validation.errors.join("; "));
  const outerBoxes: PlacedBox[] = outer?.placements ?? prepared.map((u, i) => ({ id: u.id, productId: u.id, sku: u.id, name: config.name, color: "#997947",
    x: i % columns * (config.length + spacing), y: Math.floor(i / columns) * (config.width + spacing), z: 0, dx: config.length, dy: config.width, dz: u.height, weight: u.weight, layer: 1, orientation: "LWH" }));
  const placements: PlacedBox[] = [], pallets: PlacedPallet[] = [], setCounters = new Map<string, number>();
  for (const b of outerBoxes) {
    const unit = prepared.find(p => p.id === b.productId)!, cross = b.orientation === "WLH", palletId = `floor-pallet-${pallets.length + 1}`, setMap = new Map<string, number>();
    pallets.push({ id: palletId, presetId: config.presetId, name: config.name, x: b.x, y: b.y, z: b.z, dx: b.dx, dy: b.dy, dz: config.height, weight: config.weight, maxLoad: config.maxLoad, orientation: cross ? "WLH" : "LWH" });
    for (const c of unit.cargo) {
      let setNumber = c.setNumber;
      if (c.setCode) { const key = `${c.setCode}/${c.setNumber}`; if (!setMap.has(key)) { const next = (setCounters.get(c.setCode) ?? 0) + 1; setCounters.set(c.setCode, next); setMap.set(key, next); } setNumber = setMap.get(key); }
      placements.push({ ...c, id: `prebuilt-${placements.length + 1}`, x: b.x + (cross ? c.y : c.x), y: b.y + (cross ? config.length - c.x - c.dx : c.y), z: b.z + c.z + config.height,
        dx: cross ? c.dy : c.dx, dy: cross ? c.dx : c.dy, ...(cross ? quarterTurnOrientation(c) : {}), setNumber, palletIds: [palletId] });
    }
  }
  const palletization = { config, mix, ...(build ? { stackLayers: options.stackLayers, maxTopLoadKg: options.maxTopLoadKg, preparedCount: prepared.length, bounded: (prepared.length === options.maxPallets || cartonCount >= MAX_VISIBLE_PLACEMENTS) && remaining.some(p => p.quantity > 0), only } : {}) };
  const plan: PackingResult = restorePackingSnapshot({ ...request, floorPallets: undefined, container, clearance: only ? 0 : request.clearance, strategy }, { strategy, placements, pallets, palletization });
  plan.warnings = ["货物打托与整托坐标已通过独立校验"];
  if (palletization.bounded) plan.warnings.push("已达到托盘或箱位搜索上限，未完成订单仍保留");
  if (!pallets.length) plan.warnings.push("完整托盘无法在当前柜型、门洞、净空或载重条件下装入；请调整打托规格或柜型");
  plan.workflow = only ? "pallet-only" : "palletized"; plan.palletBuild = options;
  if (only) {
    plan.metrics.effectiveVolume = prepared.length * config.length * config.width * (config.height + cargoHeight);
    plan.metrics.volumeUtilization = plan.metrics.loadedVolume / plan.metrics.effectiveVolume;
    if (plan.metrics.envelopeVolume !== undefined) plan.metrics.envelopeUtilization = plan.metrics.envelopeVolume / plan.metrics.effectiveVolume;
    plan.warnings.unshift("仅生成独立托盘；三维编组位置用于查看，不代表柜内箱位。利用率按每托限高包络统计");
  }
  if (!only && options.stackLayers > 1) plan.warnings.unshift("整托堆叠按声明的整托上压和已提供的箱体承重核验；缺少箱体承重资料时不能视为逐箱承重已核验");
  plan.metrics.solveTimeMs = performance.now() - started;
  return { plan, prepared, loadedPallets: pallets.length, unloadedPallets: prepared.length - pallets.length, remaining: plan.summaries.filter(s => s.unloaded > 0), bounded: (prepared.length === options.maxPallets || cartonCount >= MAX_VISIBLE_PLACEMENTS) && remaining.some(p => p.quantity > 0) };
}
