import { deckSupportHeight } from "./deck-support";
import { containerAccessoryWeight } from "./container-accessories";
import { getPracticalOrientations } from "./engine";
import { palletCargoCeiling } from "./floor-pallets";
import { packagingHeight, packagingInterior } from "./packaging";
import { packagingGroupKey, packagingPriorityGroups } from "./packaging-choice";
import { MAX_CARTONS_PER_PALLET, MAX_PACKAGING_SPECIFICATIONS, palletSpecifications, parsePalletCartonLimit } from "./pallet-specifications";
import { loadedPalletDirections, loadedPalletFits, packPalletCargo, packSingleKit } from "./palletize";
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

export type PalletRecipePatch = Partial<Pick<PalletBuildSpecification,"config"|"cartonLimit">> & {redesigned?:boolean;automaticQuantity?:boolean};

/** A new design draft, never a claim that the existing measured structure changed. */
export function redesignPalletRecipeSpec(spec: PalletBuildSpecification): PalletBuildSpecification {
  const config = structuredClone(spec.config);
  delete config.forkInterface;
  if(config.crateBearing?.policy==="prohibited"&&config.unitStacking)config.unitStacking={...config.unitStacking,enabled:false};
  delete config.crateBearing;
  if (config.packaging) {
    delete config.packaging.measurements;
    delete config.packaging.deckSupports;
  }
  return {...spec, config, cartonLimit:undefined, stackLayers:1, maxTopLoadKg:0};
}

export function palletRecipeGroups(products: readonly ProductInput[], eligible?: readonly string[], loose?: Readonly<Record<string, number>>) {
  const allowed = eligible ? new Set(eligible) : undefined;
  return packagingPriorityGroups(products).filter(group => group.every(p =>
    p.quantity - (loose?.[p.id] ?? 0) >= (normalizedSetCode(p) ? normalizedUnitsPerSet(p) : 1) && (!allowed || allowed.has(p.id))));
}

/** A starting quantity for a preview, never a certified packing capacity. */
export function initialPalletRecipeCartons(request: PackingRequest, spec: PalletBuildSpecification): number | undefined {
  const group = palletRecipeGroups(request.products, spec.productIds, request.palletBuild?.looseQuantities)[0];
  if (!group) return spec.cartonLimit;
  const units = group.map(p => normalizedSetCode(p) ? normalizedUnitsPerSet(p) : 1);
  const perSet = units.reduce((n,v) => n+v, 0);
  if(request.palletBuild?.oneKitPerPallet&&normalizedSetCode(group[0]))return perSet;
  if(spec.cartonLimit)return spec.cartonLimit;
  const weight = group.reduce((n,p,i) => n+p.weight*units[i], 0);
  const available = Math.min(...group.map((p,i) => Math.floor((p.quantity-(request.palletBuild?.looseQuantities?.[p.id]??0))/units[i])));
  const sets = Math.min(available, Math.floor(MAX_CARTONS_PER_PALLET/perSet),
    weight > 0 ? Math.floor((spec.config.maxLoad+EPS)/weight) : Math.floor(100/perSet));
  return sets > 0 ? sets*perSet : undefined;
}

/** Apply the displayed recipe to the selected specification in one transaction. */
export function withPalletRecipe(build: PalletBuildOptions, id: string, patch: PalletRecipePatch): PalletBuildOptions {
  const spec = palletSpecifications(build).find(s => s.id === id);
  if (!spec) throw new Error("包装规格已变化，请重新预览 / Packaging specification changed. Preview again");
  const {redesigned, automaticQuantity, ...changes} = patch;
  const next = {...spec, ...changes, ...(automaticQuantity?{maxPallets:200}:{})};
  if(automaticQuantity)build={...build,maxPallets:200};
  let additionalSpecs = build.additionalSpecs;
  if (redesigned) {
    const specs = palletSpecifications(build);
    if (specs.length >= MAX_PACKAGING_SPECIFICATIONS) throw new Error("请先腾出一个包装规格位置以保留旧包装 / Free one specification slot to retain the old packaging");
    if (!changes.config || !canSuggestPalletSize(changes.config)) throw new Error("请先生成新包装预览 / Generate a new packaging preview first");
    let archiveId = `previous-${id}`;
    while (specs.some(s=>s.id===archiveId)) archiveId += "-old";
    additionalSpecs = [...build.additionalSpecs??[], {...structuredClone(spec),id:archiveId,maxPallets:0}];
    next.stackLayers = 1;
    next.maxTopLoadKg = 0;
  }
  if (id === "primary") return {...build, config:next.config,
    ...(redesigned?{additionalSpecs,stackLayers:1,maxTopLoadKg:0}:{}),
    primaryRule:{...build.primaryRule, maxPallets:next.maxPallets, productIds:next.productIds, cartonLimit:next.cartonLimit}};
  return {...build, additionalSpecs:additionalSpecs?.map(s => s.id === id ? next : s)};
}

type Size = { length: number; width: number; cargoHeight: number };
const roundedUp = (n: number) => Math.ceil((n - EPS) * 10) / 10;

function floorPalletSlots(request:PackingRequest,length:number,width:number,gap:number,directions:readonly ("LWH"|"WLH")[]){
  if(request.workflow==="pallet-only")return 0;
  const {container,clearance}=request;
  const l=container.length-2*clearance,w=container.width-2*clearance;
  const slots=(dx:number,dy:number)=>Math.floor((l+gap+EPS)/(dx+gap))*Math.floor((w+gap+EPS)/(dy+gap));
  return Math.max(0,...directions.map(code=>code==="LWH"?slots(length,width):slots(width,length)));
}

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
    const lengths=[largestLength,rowLength,config.length-2*inset,usableLength/4-2*inset];
    const widths=[largestWidth,rowWidth,config.width-2*inset,(usableWidth-config.gap)/2-2*inset];
    if(request.palletBuild?.oneKitPerPallet){
      const lanes=(vehicle.width-margin-config.gap)/2-2*inset;
      widths.push(lanes);
      const longest=group.reduce((a,b)=>a.length>=b.length?a:b);
      const sameHeight=group.filter(p=>p!==longest&&p.height===longest.height);
      for(const p of sameHeight)widths.push(longest.width+p.width+(longest.protectionGap??0));
    }
    for(const length of lengths)for(const width of widths)add(length,width,heightLimit);
  }
  const directions:("LWH"|"WLH")[]=config.layout==="long"?["LWH"]:config.layout==="cross"?["WLH"]:["LWH","WLH"];
  const floorSlots=({length,width}:Size)=>floorPalletSlots(request,length,width,config.gap,directions);
  const tall = (s: Size) => Math.max(0, (s.cargoHeight + config.height + lid) / Math.min(s.length,s.width) - 1.5);
  return [...sizes.values()].sort((a,b) => (!request.palletBuild?.oneKitPerPallet?tall(a)-tall(b):0) || floorSlots(b)-floorSlots(a) ||
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
  const oneKit=!!request.palletBuild?.oneKitPerPallet&&!!normalizedSetCode(group[0]);
  if(oneKit&&cartons!==perSet)throw Error(`一套一托时，每托须放 ${perSet} 箱 / One kit per pallet requires exactly ${perSet} cartons`);
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
    const localRequest={...request,strategy:"practical" as const};
    const {plan,violation}=oneKit?packSingleKit(localRequest,candidate,candidate.maxCargoHeight!,products):packPalletCargo(localRequest,candidate,candidate.maxCargoHeight!,products,cartons);
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
  let best:PalletRecipePreview|undefined;
  const envelopeVolume=(preview:PalletRecipePreview)=>preview.config.length*preview.config.width*preview.height;
  const slots=(preview:PalletRecipePreview)=>floorPalletSlots(request,preview.config.length,preview.config.width,preview.config.gap,
    loadedPalletDirections(preview.config,preview.placements,productMap));
  for (const size of candidateSizes(input, group, heightLimit)) {
    const proposal = trial({...config, length:size.length, width:size.width, maxCargoHeight:size.cargoHeight});
    if (proposal?.placements.length !== cartons) continue;
    const trimmed = {...proposal.config,
      length:roundedUp(Math.max(...proposal.placements.map(b => b.x + b.dx)) + interior.inset),
      width:roundedUp(Math.max(...proposal.placements.map(b => b.y + b.dy)) + interior.inset),
      maxCargoHeight:Math.min(heightLimit, roundedUp(Math.max(...proposal.placements.map(b=>b.z+b.dz)))),
    };
    const checked = trial(trimmed);
    const candidate=checked?.placements.length===cartons?checked:proposal;
    if(!oneKit)return candidate;
    if(!best||slots(candidate)>slots(best)||slots(candidate)===slots(best)&&envelopeVolume(candidate)<envelopeVolume(best))best=candidate;
  }
  if(best)return best;
  throw new Error("在当前柜门、朝向、层数和承重条件下未找到目标尺寸，请减少每托箱数或微调包装 / No size was found for this target under the current door, orientation, layer and payload rules. Reduce the target or adjust packaging");
}
