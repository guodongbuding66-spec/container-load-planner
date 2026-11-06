import {parseLooseQuantities,looseReservationErrors,looseOutsideUnit,type LooseQuantities} from "./loose-cargo";
import {palletLoadEnvelope} from "./unit-envelope";
import {crateAutoEnabled,inspectCrateStacks,isCrate} from "./crate-auto-stack";
import {completePackagingTare,palletEnvelopeTop,assertDeckSupportStacking} from "./deck-support";
import {siteExclusionBoxes} from "./site-exclusions";
import { choosePackaging, packagingGroupKey, packagingPriorityGroups, packagingLoads, parsePackagingChoices, type PackagingChoice, type PackagingSelection } from "./packaging-choice";
import { parseFloorPalletConfig } from "./floor-pallets";
import { packagingInterior, packagingHeight } from "./packaging";
import { bearingLoads } from "./bearing";
import { bodyContactArea } from "./cargo-body";
import { parsePackagingSpecifications, specificationForPallet } from "./pallet-specifications";
import type { ContainerSpec, FloorPalletConfig, PackingResult, PlacedBox, PlacedPallet, PalletBuildSpecification, ProductInput } from "./types";
/** A prebuilt deck appears when its unit begins; floor-laid decks are present from the start. */
export function visiblePlanPallets(plan: PackingResult, visibleCount: number): PlacedPallet[] {
  if (!plan.palletization) return plan.pallets ?? [];
  const ids = new Set(plan.placements.slice(0, Math.max(0, Math.floor(visibleCount))).flatMap(b=>b.palletIds ?? []));
  return (plan.pallets ?? []).filter(p=>ids.has(p.id)||!!plan.palletization?.editRevision&&visibleCount>=plan.placements.length&&!plan.placements.some(b=>b.palletIds?.includes(p.id)));
}
/** Keep each prebuilt unit complete in playback/exports, below before above. */
export function orderPalletizedCargo(boxes: PlacedBox[], pallets: PlacedPallet[]) {
  const groups=new Map<string,PlacedBox[]>(),loose:PlacedBox[]=[];
  for(const b of boxes){const id=b.palletIds?.[0];if(id){const list=groups.get(id);if(list)list.push(b);else groups.set(id,[b]);}else loose.push(b);}
  const ordered:PlacedBox[]=[];let i=0;
  for(const p of [...pallets].sort((a,b)=>a.x-b.x||a.z-b.z||a.y-b.y)){
    while(i<loose.length&&loose[i].x<=p.x)ordered.push(loose[i++]);
    ordered.push(...groups.get(p.id)??[]);groups.delete(p.id);
  }
  ordered.push(...loose.slice(i),...[...groups.values()].flat());return ordered;
}
export type Palletization = { looseQuantities?:LooseQuantities; selection?:PackagingSelection;selectionChoices?:PackagingChoice[]; editRevision?:number; config: FloorPalletConfig; mix: "single" | "mixed"; stackLayers?: number; maxTopLoadKg?: number; preparedCount?: number; bounded?: boolean; only?: boolean; specifications?:PalletBuildSpecification[]; preparedBySpecification?:Record<string,number> };
export function parsePalletization(value: unknown): Palletization | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid prebuilt pallets");
  const p = value as Palletization;
  const looseQuantities=parseLooseQuantities(p.looseQuantities);
  if(looseQuantities&&p.only)throw Error("Pallet-only plans cannot contain loose reservations / 只打托不接受散箱");
  if(p.editRevision!==undefined&&(!Number.isSafeInteger(p.editRevision)||p.editRevision<1))throw new Error("Invalid pallet edit revision");
  if (!["single", "mixed"].includes(p.mix)) throw new Error("Invalid pallet mix");
  if (p.stackLayers !== undefined && (!Number.isInteger(p.stackLayers) || p.stackLayers < 1 || p.stackLayers > 20)) throw new Error("Invalid pallet stack layers");
  if (p.maxTopLoadKg !== undefined && (!Number.isFinite(p.maxTopLoadKg) || p.maxTopLoadKg < 0 || p.maxTopLoadKg > 100000)) throw new Error("Invalid pallet top load");
  if (p.preparedCount !== undefined && (!Number.isInteger(p.preparedCount) || p.preparedCount < 0 || p.preparedCount > 200)) throw new Error("Invalid prepared pallet count");
  for (const k of ["bounded", "only"] as const) if (p[k] !== undefined && typeof p[k] !== "boolean") throw new Error("Invalid pallet metadata");
  if(p.selection!==undefined&&p.selection!=="ordered"&&p.selection!=="compact")throw new Error("Invalid packaging selection mode");
  const config=parseFloorPalletConfig(p.config);assertDeckSupportStacking(config,p.stackLayers??1,p.maxTopLoadKg??0);const specifications=p.specifications===undefined?undefined:parsePackagingSpecifications(p.specifications);
  let preparedBySpecification:Record<string,number>|undefined;
  if(specifications){
    const primary=specifications[0];
    if(primary.id!=="primary"||JSON.stringify(primary.config)!==JSON.stringify({...config,count:0,allowFloorCargo:false})||primary.stackLayers!==(p.stackLayers??1)||primary.maxTopLoadKg!==(p.maxTopLoadKg??0))throw new Error("Primary packaging definitions disagree");
    if(!p.preparedBySpecification||typeof p.preparedBySpecification!=="object"||Array.isArray(p.preparedBySpecification))throw new Error("Prepared packaging counts are missing");
    const entries=Object.entries(p.preparedBySpecification),ids=new Map(specifications.map(s=>[s.id,s]));
    if(entries.length!==specifications.length||entries.some(([id,n])=>!ids.has(id)||!Number.isInteger(n)||n<0||n>ids.get(id)!.maxPallets)||entries.reduce((n,[,v])=>n+v,0)!==p.preparedCount)throw new Error("Prepared packaging counts disagree with availability");
    preparedBySpecification=Object.fromEntries(entries);
  }else if(p.preparedBySpecification!==undefined)throw new Error("Prepared packaging definitions are missing");
  const selectionChoices=parsePackagingChoices(p.selectionChoices,new Set(specifications?.map(s=>s.id)??["primary"]));
  if(selectionChoices&&p.selection!=="compact")throw new Error("Packaging choice records require compact selection");
  return { ...(looseQuantities?{looseQuantities}:{}), ...(p.selection===undefined?{}:{selection:p.selection}),...(selectionChoices?{selectionChoices}:{}), config, mix: p.mix, ...(p.editRevision===undefined?{}:{editRevision:p.editRevision}), ...(p.stackLayers === undefined ? {} : { stackLayers: p.stackLayers }), ...(p.maxTopLoadKg === undefined ? {} : { maxTopLoadKg: p.maxTopLoadKg }), ...(p.preparedCount === undefined ? {} : { preparedCount: p.preparedCount }), ...(p.bounded === undefined ? {} : { bounded: p.bounded }), ...(p.only === undefined ? {} : { only: p.only }),...(specifications?{specifications,preparedBySpecification}:{}) };
}
export function validatePalletizedCargo(boxes: PlacedBox[], pallets: PlacedPallet[], container: ContainerSpec, clearance: number, value: Palletization, products:readonly ProductInput[] = []) {
  value=parsePalletization(value)!;
  const errors: string[] = [], EPS = .0001, productMap=new Map(products.map(p=>[p.id,p]));
  const specifications=new Map(pallets.map(p=>[p.id,specificationForPallet(value,p)]));
  const used=new Map<string,number>();
  const allowedProducts=new Map((value.specifications??[]).map(s=>[s.id,s.productIds?new Set(s.productIds):undefined]));
  if(products.length)errors.push(...looseReservationErrors(value.looseQuantities,products,!!value.only));
  const loose=boxes.filter(b=>!b.palletIds?.length),looseCounts=new Map<string,number>(),unitCounts=new Map<string,number>();
  for(const b of boxes){const counts=b.palletIds?.length?unitCounts:looseCounts;counts.set(b.productId,(counts.get(b.productId)??0)+1);}
  if([...looseCounts].some(([id,n])=>n>(value.looseQuantities?.[id]??0))||products.some(p=>(unitCounts.get(p.id)??0)>p.quantity-(value.looseQuantities?.[p.id]??0)))errors.push("Cargo exceeds its loose or palletized allocation / 箱数超过散装或打托分配");
  const cargoByPallet = new Map(pallets.map(p => [p.id, boxes.filter(b => b.palletIds?.length === 1 && b.palletIds[0] === p.id)]));
  if(pallets.some(p=>p.measuredEnvelope)&&pallets.some(p=>p.z!==0))errors.push("Measured loading envelopes require floor-only complete units / 实测装载包络仅支持整托底置");
  for (const b of boxes) {
    if(!b.palletIds?.length){if(!((value.looseQuantities?.[b.productId]??0)>0))errors.push(`${b.sku}: loose cargo was not reserved / 未预留散装`);continue;}
    const p = b.palletIds?.length === 1 ? pallets.find(p => p.id === b.palletIds![0]) : undefined;
    const interior=packagingInterior(p?specifications.get(p.id)!.config:value.config);
    if (!p || b.x < p.x + interior.inset - EPS || b.y < p.y + interior.inset - EPS || b.x + b.dx > p.x + p.dx - interior.inset + EPS || b.y + b.dy > p.y + p.dy - interior.inset + EPS || b.z < p.z + p.dz - EPS) errors.push(`${b.sku}: cargo must remain within one complete pallet`);
  }
  const envelopes: PlacedBox[] = [];
  for (const p of pallets) {
    const specification=specifications.get(p.id)!,config=specification.config,interior=packagingInterior(config);
    used.set(specification.id,(used.get(specification.id)??0)+1);
    if(used.get(specification.id)!>specification.maxPallets||value.preparedBySpecification&&used.get(specification.id)!>(value.preparedBySpecification[specification.id]??0))errors.push("Packaging availability exceeded");
    const expected = p.orientation === "LWH" ? [config.length, config.width] : [config.width, config.length];
    if (Math.abs(p.dx - expected[0]) > EPS || Math.abs(p.dy - expected[1]) > EPS || Math.abs(p.dz - config.height) > EPS || p.weight !== completePackagingTare(config) || p.maxLoad !== config.maxLoad || !value.only && config.layout === "long" && p.orientation !== "LWH" || !value.only && config.layout === "cross" && p.orientation !== "WLH") errors.push("Prebuilt pallet specification mismatch");
    if(JSON.stringify(p.packaging)!==JSON.stringify(config.packaging)||p.enclosureHeight!==(interior.crate?packagingHeight(config):undefined))errors.push("Packaging structure does not match its specification");
    const cargo = cargoByPallet.get(p.id)!;
    if(!cargo.length&&!value.editRevision)errors.push("Loaded pallet has no cargo");
    if(specification.cartonLimit !== undefined && cargo.length > specification.cartonLimit) errors.push("每托箱数超过设定上限 / Pallet exceeds its carton limit");
    if(allowedProducts.get(specification.id)&&cargo.some(b=>!allowedProducts.get(specification.id)!.has(b.productId)))errors.push("Cargo is not eligible for this packaging specification");
    const cargoTop=palletEnvelopeTop({...p,enclosureHeight:undefined},cargo);
    if(interior.crate&&cargoTop>p.z+config.height+config.maxCargoHeight!+EPS)errors.push("Cargo exceeds crate interior height");
    const top = Math.max(cargoTop,p.z+(p.enclosureHeight??0)), height = top - p.z;
    if (config.maxCargoHeight && height > packagingHeight(config) + EPS || !value.only && height > Math.min(container.height, container.loadingAccess === "open" ? container.height : container.doorHeight) - clearance + EPS) errors.push("Loaded pallet exceeds door or cargo height limit");
    if (value.mix === "single" && new Set(cargo.map(b => b.setCode ? `set:${b.setCode}` : `sku:${b.productId}`)).size > 1) errors.push("Single-product pallet contains mixed cargo");
    const envelope=palletLoadEnvelope(p,cargo);
    if(p.measuredEnvelope&&(envelope.x< -EPS||envelope.y< -EPS||envelope.x+envelope.dx>container.length-2*clearance+EPS||envelope.y+envelope.dy>container.width-2*clearance+EPS||envelope.z+envelope.dz>container.height-clearance+EPS||container.loadingAccess!=="open"&&(envelope.dy>container.doorWidth-2*clearance+EPS||envelope.dz>container.doorHeight-clearance+EPS)))errors.push("Measured unit envelope exceeds container or door / 实测整托包络超过柜内或门洞限制");
    envelopes.push({ ...p, ...envelope, weight: p.weight + cargo.reduce((n, b) => n + b.weight, 0), productId: p.id, sku: p.id, color: "#997947", layer: 1, orientation: p.orientation });
  }
  if(value.selectionChoices){const groups=packagingPriorityGroups(products),groupKeys=groups.map(g=>packagingGroupKey(g[0]));
    for(const choice of value.selectionChoices){
      const p=pallets.find(p=>p.id===choice.palletId),candidate=choice.candidates.find(c=>c.specificationId===choice.chosenSpecificationId),cargo=p?cargoByPallet.get(p.id)!:[];
      if(!p||choice.chosenSpecificationId!==(p.specificationId??"primary")||!candidate||candidate.cartons!==cargo.length||candidate.tareKg!==p.weight){errors.push("Packaging choice record does not match its loaded unit");continue;}
      const config=specifications.get(p.id)!.config,actualHeight=palletEnvelopeTop(p,cargo)-p.z;
      if(candidate.exterior[0]!==config.length||candidate.exterior[1]!==config.width||Math.abs(candidate.exterior[2]-actualHeight)>EPS)errors.push("Chosen packaging envelope disagrees with its loaded unit");
      if(products.length&&JSON.stringify(Object.entries(packagingLoads(cargo,groups)).sort())!==JSON.stringify(Object.entries(candidate.loads).sort()))errors.push("Chosen packaging quantities disagree with its cargo");
      for(const item of choice.candidates){const definition=value.specifications?.find(s=>s.id===item.specificationId)?.config??(item.specificationId==="primary"?value.config:undefined);if(!definition||item.exterior[0]!==definition.length||item.exterior[1]!==definition.width||item.tareKg!==completePackagingTare(definition))errors.push("Packaging candidate disagrees with its source specification");}
      if(products.length){const winner=choosePackaging(choice.candidates,groupKeys);if(winner.candidate.specificationId!==choice.chosenSpecificationId||winner.reason!==choice.reason)errors.push("Packaging choice does not follow its recorded comparison");}
    }
  }
  const sets = new Map<string, Set<string>>();
  for (const b of boxes) if (b.setCode) { const key = `${b.setCode}/${b.setNumber}`, ids = sets.get(key) ?? new Set<string>(); for (const id of b.palletIds?.length?b.palletIds:["__loose__"]) ids.add(b.palletIds?.length?`pallet:${id}`:"loose"); sets.set(key, ids); }
  if ([...sets.values()].some(ids => ids.size !== 1)) errors.push("A complete kit must stay on one pallet or entirely loose / 套装不能跨托或拆成打托和散装");
  for(const b of loose)for(const e of envelopes)if(!looseOutsideUnit(b,e,Math.max(productMap.get(b.productId)?.protectionGap??0,specifications.get(e.id)!.config.gap)))errors.push("Loose cargo intersects, supports or violates the gap of a complete unit / 散箱与整托包络相交、互相承托或保护间隙不足");
  const stackLimit=(id:string)=>{const s=specifications.get(id)!;return isCrate(s.config)?crateAutoEnabled(s.config)?20:1:s.stackLayers;};
  const crateReview=inspectCrateStacks(pallets.filter(p=>isCrate(specifications.get(p.id)!.config)).map(p=>({pallet:p,config:specifications.get(p.id)!.config,cargoKg:cargoByPallet.get(p.id)!.reduce((n,b)=>n+b.weight,0)})),envelopes);
  const layers = new Map<string, number>(), ancestors=new Map<string,string[]>();
  for (const e of [...envelopes].sort((a, b) => a.z - b.z)) {
    const lower = envelopes.filter(p => p.id !== e.id && Math.abs(p.z + p.dz - e.z) < EPS && e.x >= p.x - EPS && e.y >= p.y - EPS && e.x + e.dx <= p.x + p.dx + EPS && e.y + e.dy <= p.y + p.dy + EPS);
    const bridge=crateReview.bridgeParents.get(e.id);
    const layer = e.z <= EPS ? 1 : bridge ? 2 : lower.length === 1 ? (layers.get(lower[0].id) ?? 0) + 1 : 0;
    if (!layer || layer > (value.only ? 1 : stackLimit(e.id))) errors.push("Loaded pallet stack exceeds layer limit or lacks one complete supporting unit");
    layers.set(e.id, layer);
    const chain=bridge??(lower.length===1?[lower[0].id,...ancestors.get(lower[0].id)??[]]:[]);ancestors.set(e.id,chain);
    if(chain.some(id=>layer-(layers.get(id)??0)+1>stackLimit(id)))errors.push("A supporting packaging unit exceeds its stack-layer limit");
    if(lower.length===1&&!isCrate(specifications.get(lower[0].id)!.config)){const cargo=cargoByPallet.get(lower[0].id)??[],area=cargo.reduce((n,b)=>n+bodyContactArea(e,b,undefined,productMap.get(b.productId)),0);if(area<e.dx*e.dy-EPS)errors.push("Loaded pallet requires a complete flat cargo top");}
    for (const other of envelopes) if (other.id !== e.id && Math.min(e.x + e.dx, other.x + other.dx) - Math.max(e.x, other.x) > EPS && Math.min(e.y + e.dy, other.y + other.dy) - Math.max(e.y, other.y) > EPS && Math.min(e.z + e.dz, other.z + other.dz) - Math.max(e.z, other.z) > EPS) errors.push("Complete loaded-pallet envelopes overlap");
  }
  if(!value.only)for(let i=0;i<envelopes.length;i++)for(let j=i+1;j<envelopes.length;j++){
    const a=envelopes[i],b=envelopes[j],zOverlap=Math.min(a.z+a.dz,b.z+b.dz)-Math.max(a.z,b.z);
    const gap=Math.max(specifications.get(a.id)!.config.gap,specifications.get(b.id)!.config.gap);
    const xGap=Math.max(a.x-b.x-b.dx,b.x-a.x-a.dx),yGap=Math.max(a.y-b.y-b.dy,b.y-a.y-a.dy);
    if(zOverlap>EPS&&Math.max(xGap,yGap)<gap-EPS)errors.push("Loaded pallets violate the protection gap");
  }
  for(const e of envelopes)for(const b of siteExclusionBoxes(container,clearance))if(Math.min(e.x+e.dx,b.x+b.dx)-Math.max(e.x,b.x)>EPS&&Math.min(e.y+e.dy,b.y+b.dy)-Math.max(e.y,b.y)>EPS&&Math.min(e.z+e.dz,b.z+b.dz)-Math.max(e.z,b.z)>EPS)errors.push(`Complete pallet intersects site region: ${b.name}`);
  const loads = bearingLoads(envelopes);
  for (const e of envelopes) if (!isCrate(specifications.get(e.id)!.config) && (loads.get(e.id) ?? 0) > specifications.get(e.id)!.maxTopLoadKg + EPS) errors.push("Loaded pallet exceeds declared top-load limit");
  errors.push(...crateReview.errors);
  return errors;
}
