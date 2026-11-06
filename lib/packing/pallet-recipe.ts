import { deckSupportHeight } from "./deck-support";
import { containerAccessoryWeight } from "./container-accessories";
import { getPracticalOrientations } from "./engine";
import { palletCargoCeiling } from "./floor-pallets";
import { packagingHeight, packagingInterior } from "./packaging";
import { packagingGroupKey, packagingPriorityGroups } from "./packaging-choice";
import { MAX_CARTONS_PER_PALLET, palletSpecifications, parsePalletCartonLimit } from "./pallet-specifications";
import { loadedPalletDirections, loadedPalletFits, packPalletCargo } from "./palletize";
import { normalizedSetCode, normalizedUnitsPerSet } from "./set-utils";
import type { FloorPalletConfig, PackingRequest, PalletBuildOptions, PalletBuildSpecification, PlacedBox, ProductInput } from "./types";

const EPS = .0001;
const MAX_TRIALS = 18;

export type PalletRecipeInput = {
  request: PackingRequest;
  spec: PalletBuildSpecification;
  groupKey: string;
  cartons: number;
  mode: "suggest" | "current";
};

export type PalletRecipePreview = {
  config: FloorPalletConfig;
  placements: PlacedBox[];
  height: number;
  grossWeight: number;
  layerCount: number;
  orderCartons: number;
  sampleCartons: number;
};

export function canSuggestPalletSize(config: FloorPalletConfig) {
  return !config.packaging?.measurements &&
    !config.packaging?.deckSupports?.length && !config.forkInterface && !config.crateBearing;
}

export function palletRecipeGroups(products: readonly ProductInput[], eligible?: readonly string[], loose?: Readonly<Record<string, number>>) {
  const allowed = eligible ? new Set(eligible) : undefined;
  return packagingPriorityGroups(products).filter(group => group.every(p =>
    p.quantity - (loose?.[p.id] ?? 0) >= (normalizedSetCode(p) ? normalizedUnitsPerSet(p) : 1) && (!allowed || allowed.has(p.id))));
}

/** A starting quantity for a preview, never a certified packing capacity. */
export function initialPalletRecipeCartons(request: PackingRequest, spec: PalletBuildSpecification): number | undefined {
  if (spec.cartonLimit) return spec.cartonLimit;
  const group = palletRecipeGroups(request.products, spec.productIds, request.palletBuild?.looseQuantities)[0];
  if (!group) return undefined;
  const units = group.map(p => normalizedSetCode(p) ? normalizedUnitsPerSet(p) : 1);
  const perSet = units.reduce((n,v) => n+v, 0);
  const weight = group.reduce((n,p,i) => n+p.weight*units[i], 0);
  const available = Math.min(...group.map((p,i) => Math.floor((p.quantity-(request.palletBuild?.looseQuantities?.[p.id]??0))/units[i])));
  const sets = Math.min(available, Math.floor(MAX_CARTONS_PER_PALLET/perSet),
    weight > 0 ? Math.floor((spec.config.maxLoad+EPS)/weight) : Math.floor(100/perSet));
  return sets > 0 ? sets*perSet : undefined;
}

/** Apply the displayed recipe to the selected specification in one transaction. */
export function withPalletRecipe(build: PalletBuildOptions, id: string, patch: Partial<Pick<PalletBuildSpecification,"config"|"cartonLimit">>): PalletBuildOptions {
  const spec = palletSpecifications(build).find(s => s.id === id);
  if (!spec) throw new Error("包装规格已变化，请重新预览 / Packaging specification changed. Preview again");
  const next = {...spec, ...patch};
  if (id === "primary") return {...build, config:next.config,
    primaryRule:{...build.primaryRule, maxPallets:next.maxPallets, productIds:next.productIds, cartonLimit:next.cartonLimit}};
  return {...build, additionalSpecs:build.additionalSpecs?.map(s => s.id === id ? next : s)};
}

type Size = { length: number; width: number; cargoHeight: number };
const roundedUp = (n: number) => Math.ceil((n - EPS) * 10) / 10;

function candidateSizes(input: PalletRecipeInput, group: ProductInput[], heightLimit: number): Size[] {
  const {request, spec: {config}, cartons} = input;
  const only = request.workflow === "pallet-only";
  const vehicle = request.container, margin = 2 * request.clearance;
  const usableLength = only ? 100000 : vehicle.length - margin;
  const usableWidth = only ? 100000 : Math.min(vehicle.width, vehicle.loadingAccess === "open" ? vehicle.width : vehicle.doorWidth) - margin;
  const {inset, lid} = packagingInterior(config);
  const sizes = new Map<string, Size>();
  const add = (length: number, width: number, cargoHeight: number) => {
    const size = {length:roundedUp(length + 2*inset), width:roundedUp(width + 2*inset), cargoHeight:Math.min(heightLimit, roundedUp(cargoHeight))};
    if (size.length < 1 || size.width < 1 || size.cargoHeight <= 0) return;
    const direct = config.layout !== "cross" && size.length <= usableLength + EPS && size.width <= usableWidth + EPS;
    const cross = config.layout !== "long" && size.width <= usableLength + EPS && size.length <= usableWidth + EPS;
    if (only ? size.length > 100000 || size.width > 100000 : !direct && !cross) return;
    sizes.set(`${size.length}/${size.width}/${size.cargoHeight}`, size);
  };
  if (group.length === 1) {
    const product = group[0], gap = product.protectionGap ?? 0;
    for (const {dx,dy,dz} of getPracticalOrientations(product)) {
      const layers = Math.min(cartons, Math.floor((heightLimit + EPS) / dz),
        product.bottomOnly || product.stackable === false ? 1 : product.maxStackLayers || cartons);
      for (let nz = 1; nz <= layers; nz++) {
        const perLayer = Math.ceil(cartons / nz);
        for (let nx = 1; nx <= perLayer; nx++) {
          const ny = Math.ceil(perLayer / nx);
          add(nx * dx + (nx - 1) * gap, ny * dy + (ny - 1) * gap, nz * dz);
        }
      }
    }
  } else {
    // Kits use the real mixed-carton solver in bounded seed envelopes.
    const largestLength = Math.max(...group.map(p => p.length));
    const largestWidth = Math.max(...group.map(p => p.width));
    const rowLength = group.reduce((n,p) => n + normalizedUnitsPerSet(p) * (p.length + (p.protectionGap ?? 0)), 0);
    const rowWidth = group.reduce((n,p) => n + normalizedUnitsPerSet(p) * (p.width + (p.protectionGap ?? 0)), 0);
    for (const length of [largestLength, rowLength, config.length - 2*inset, usableLength / 4 - 2*inset]) {
      for (const width of [largestWidth, rowWidth, config.width - 2*inset, usableWidth / 2 - 2*inset]) add(length, width, heightLimit);
    }
  }
  const floorSlots = ({length,width}: Size) => {
    if (only) return 0;
    const slots = (dx: number, dy: number) => Math.floor((usableLength + config.gap + EPS) / (dx + config.gap)) *
      Math.floor((usableWidth + config.gap + EPS) / (dy + config.gap));
    return Math.max(config.layout === "cross" ? 0 : slots(length,width), config.layout === "long" ? 0 : slots(width,length));
  };
  const tall = (s: Size) => Math.max(0, (s.cargoHeight + config.height + lid) / Math.min(s.length,s.width) - 1.5);
  return [...sizes.values()].sort((a,b) => tall(a)-tall(b) || floorSlots(b)-floorSlots(a) ||
    a.length*a.width*(a.cargoHeight+config.height)-b.length*b.width*(b.cargoHeight+config.height) ||
    a.length*a.width-b.length*b.width || a.cargoHeight-b.cargoHeight).slice(0, MAX_TRIALS);
}

export function previewPalletRecipe(input: PalletRecipeInput): PalletRecipePreview {
  const {request, spec, groupKey, mode} = input;
  const cartons = parsePalletCartonLimit(input.cartons);
  if (cartons === undefined) throw new Error("请填写每托箱数 / Enter cartons per pallet");
  const only = request.workflow === "pallet-only";
  const group = palletRecipeGroups(request.products, spec.productIds, request.palletBuild?.looseQuantities)
    .find(items => packagingGroupKey(items[0]) === groupKey);
  if (!group) throw new Error("请选择可打托的产品或完整套装 / Select a product or complete kit available to palletize");
  const perSet = normalizedSetCode(group[0]) ? group.reduce((n,p) => n + normalizedUnitsPerSet(p), 0) : 1;
  if (cartons % perSet) throw new Error(`每托箱数须为 ${perSet} 的倍数以保留完整套装 / Use a multiple of ${perSet} cartons to keep kits complete`);
  const orderCartons = perSet * Math.min(...group.map(p => Math.floor(
    (p.quantity - (request.palletBuild?.looseQuantities?.[p.id] ?? 0)) / (perSet > 1 ? normalizedUnitsPerSet(p) : 1),
  )));
  const sampleCartons = mode === "suggest" ? cartons : Math.min(cartons, orderCartons);
  const products = group.map(p => ({...p, quantity:sampleCartons / perSet * (perSet > 1 ? normalizedUnitsPerSet(p) : 1)}));
  const productMap = new Map(products.map(p => [p.id,p]));
  const {config} = spec, interior = packagingInterior(config);
  if (mode === "suggest" && !canSuggestPalletSize(config)) {
    throw new Error("此包装已关联结构资料，请手动核对尺寸 / Review dimensions manually for this documented packaging");
  }
  const doorCargo = only ? 100000 : palletCargoCeiling(request.container, request.clearance, {...config,maxCargoHeight:0}) - config.height - interior.lid;
  if (mode === "current" && interior.crate && (config.maxCargoHeight ?? 0) > doorCargo + EPS) {
    throw new Error("木箱外部总高超过柜门净高 / Crate exterior exceeds door clearance");
  }
  const heightLimit = mode === "suggest"
    ? Math.min(doorCargo, only ? Math.max(config.maxCargoHeight ?? 0, 1800) : doorCargo)
    : Math.min(doorCargo, config.maxCargoHeight || (only ? 0 : doorCargo));
  if (heightLimit <= deckSupportHeight(config)) throw new Error("请检查托内限高、底座和柜门净空 / Check the pallet height limit, deck and door clearance");
  if (mode === "suggest" && products.reduce((n,p) => n + p.quantity*p.weight,0) > config.maxLoad + EPS) {
    throw new Error("目标箱数超过每托承重，请减少每托箱数或核对额定载荷 / Target cartons exceed pallet payload. Reduce the target or verify the rated payload");
  }

  const trial = (candidate: FloorPalletConfig): PalletRecipePreview | undefined => {
    const {plan, violation} = packPalletCargo({...request, strategy:"practical"}, candidate, candidate.maxCargoHeight!, products, cartons);
    if (violation || !plan.placements.length) return undefined;
    const inside = packagingInterior(candidate);
    const cargoHeight = Math.max(...plan.placements.map(b => b.z + b.dz));
    const height = inside.crate ? packagingHeight(candidate) : candidate.height + cargoHeight;
    const directions = loadedPalletDirections(candidate, plan.placements, productMap);
    const grossWeight = plan.metrics.grossWeight + candidate.weight;
    if (!only && (!loadedPalletFits(request.container, request.clearance, candidate, height, directions) ||
      grossWeight + containerAccessoryWeight(request.container) > request.container.maxWeight + EPS)) return undefined;
    return {
      config:candidate, height, orderCartons, sampleCartons, grossWeight,
      placements:plan.placements.map(b => ({...b, x:b.x + inside.inset, y:b.y + inside.inset})),
      layerCount:Math.max(...plan.placements.map(b => b.layer)),
    };
  };
  if (mode === "current") {
    const preview = trial({...config, maxCargoHeight:heightLimit});
    if (preview) return preview;
    throw new Error("当前尺寸或限制下无法打托，请检查长宽、限高、承重和朝向 / Review deck dimensions, height, payload and orientations");
  }
  for (const size of candidateSizes(input, group, heightLimit)) {
    const proposal = trial({...config, length:size.length, width:size.width, maxCargoHeight:size.cargoHeight});
    if (proposal?.placements.length !== cartons) continue;
    const trimmed = {...proposal.config,
      length:roundedUp(Math.max(...proposal.placements.map(b => b.x + b.dx)) + interior.inset),
      width:roundedUp(Math.max(...proposal.placements.map(b => b.y + b.dy)) + interior.inset),
      maxCargoHeight:Math.min(heightLimit, roundedUp(Math.max(...proposal.placements.map(b=>b.z+b.dz)))),
    };
    const checked = trial(trimmed);
    return checked?.placements.length === cartons ? checked : proposal;
  }
  throw new Error("在当前柜门、朝向、层数和承重条件下未找到目标尺寸，请减少每托箱数或微调包装 / No size was found for this target under the current door, orientation, layer and payload rules. Reduce the target or adjust packaging");
}
