import {deckSupportMass,palletDeckSupportGeometry} from "./deck-support";
import {parseUnitStacking} from "./unit-stacking";
import {containerAccessoryWeight} from "./container-accessories";
import {parseForkInterface} from "./fork-interface";
import {availablePackingVolume,siteExclusionBoxes,SITE_EXCLUSION_PREFIX} from "./site-exclusions";
import { parseCrateBearing } from "./crate-bearing";
import type { ContainerSpec, FloorPalletConfig, PlacedBox, PlacedPallet, ProductInput } from "./types";

import { parsePackaging, packagingInterior, packagingReservedVolume, validateBaseMeasurements,validateDeckSupports } from "./packaging";
import { bodyContactArea, bodyTopLevels } from "./cargo-body";

export const PALLET_PRODUCT_ID = "__floor-pallet__";
export function parseFloorPalletConfig(value: unknown): FloorPalletConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("底层托盘设置无效。");
  const v = value as Record<string, unknown>;
  for (const k of ["presetId", "name"]) if (typeof v[k] !== "string" || !(v[k] as string).trim() || (v[k] as string).length > 120) throw new Error("托盘名称无效。");
  for (const k of ["length", "width", "height", "maxLoad"]) if (typeof v[k] !== "number" || !Number.isFinite(v[k]) || Number(v[k]) <= 0 || Number(v[k]) > 100000) throw new Error("托盘尺寸及承重必须为有效正数。");
  if (["length","width","height"].some(k=>Number(v[k])<1)) throw new Error("托盘尺寸不能小于 1 mm。");
  for (const k of ["weight", "gap"]) if (typeof v[k] !== "number" || !Number.isFinite(v[k]) || Number(v[k]) < 0 || Number(v[k]) > 10000) throw new Error("托盘自重和间隙必须为有效非负数。");
  if (!Number.isInteger(v.count) || Number(v.count) < 0 || Number(v.count) > 200) throw new Error("底层托盘数量必须为 0–200 的整数。");
  if (!["auto", "long", "cross"].includes(String(v.layout)) || typeof v.allowFloorCargo !== "boolean") throw new Error("托盘布局规则无效。");
  if (v.maxCargoHeight !== undefined && (typeof v.maxCargoHeight !== "number" || !Number.isFinite(v.maxCargoHeight) || v.maxCargoHeight < 0 || v.maxCargoHeight > 100000)) throw new Error("托盘货物限高必须为 0–100000 mm；0 表示按柜高及门洞自动限制。");
  const packaging=v.packaging===undefined?undefined:parsePackaging(v.packaging);
  validateBaseMeasurements(Number(v.length),Number(v.width),Number(v.height),packaging);
  if(packaging){const inner=packagingInterior({...v,packaging} as FloorPalletConfig);if(inner.length<1||inner.width<1||inner.crate&&!Number(v.maxCargoHeight))throw new Error("木箱壁厚或内高无效 / Invalid crate wall thickness or inner height");}
  const parsed:FloorPalletConfig={ ...(v.forkInterface===undefined?{}:{forkInterface:parseForkInterface(v.forkInterface)}), ...(v.crateBearing===undefined?{}:{crateBearing:parseCrateBearing(v.crateBearing)}), ...(packaging?{packaging}:{}), presetId: v.presetId as string, name: v.name as string, length: v.length as number, width: v.width as number, height: v.height as number, weight: v.weight as number, maxLoad: v.maxLoad as number, count: v.count as number, gap: v.gap as number, layout: v.layout as FloorPalletConfig["layout"], allowFloorCargo: v.allowFloorCargo, ...(v.maxCargoHeight === undefined ? {} : {maxCargoHeight:v.maxCargoHeight as number}) };
  if(v.unitStacking!==undefined)parsed.unitStacking=parseUnitStacking(v.unitStacking);
  validateDeckSupports(parsed);return parsed;
}

/** Loaded pallets must clear the door as a unit; heights are measured from the vehicle floor. */
export function palletCargoCeiling(container: ContainerSpec, clearance: number, config: FloorPalletConfig) {
  const netHeight = Math.min(container.height, container.loadingAccess === "open" ? container.height : container.doorHeight) - clearance;
  return Math.min(netHeight, config.maxCargoHeight ? config.height + config.maxCargoHeight : netHeight);
}

export function supportingPalletIds(box: Pick<PlacedBox,"x"|"y"|"dx"|"dy">, supporters: PlacedBox[]) {
  const ids = new Set<string>();
  for (const below of supporters) {
    if(below.id.startsWith(SITE_EXCLUSION_PREFIX))continue;
    if (Math.min(box.x+box.dx,below.x+below.dx)-Math.max(box.x,below.x) <= .0001 || Math.min(box.y+box.dy,below.y+below.dy)-Math.max(box.y,below.y) <= .0001) continue;
    for (const id of below.supportOnly ? [below.id] : below.palletIds ?? []) ids.add(id);
  }
  return [...ids].sort();
}

/** Pallets reserve their full envelopes, including fork openings; subtract exactly once. */
export function palletSpaceSummary(container: ContainerSpec, clearance: number, pallets: PlacedPallet[], cargoVolume = 0, cargoWeight = 0) {
  const effectiveVolume = availablePackingVolume(container,clearance);
  const reservedVolume = pallets.reduce((n,p)=>n+packagingReservedVolume(p),0);
  const tareWeight = pallets.reduce((n,p)=>n+p.weight,0);
  return {effectiveVolume,reservedVolume,tareWeight,cargoVolume,cargoCapacity:Math.max(0,effectiveVolume-reservedVolume),remainingVolume:Math.max(0,effectiveVolume-reservedVolume-cargoVolume),cargoPayload:Math.max(0,container.maxWeight-tareWeight-containerAccessoryWeight(container)),remainingWeight:Math.max(0,container.maxWeight-tareWeight-containerAccessoryWeight(container)-cargoWeight)};
}

/** Rows can use either horizontal orientation; no pallet may overlap or overhang. */
export function arrangeFloorPallets(container: ContainerSpec, clearance: number, input: FloorPalletConfig): PlacedPallet[] {
  const p = parseFloorPalletConfig(input);
  if(p.packaging?.deckSupports?.length)throw Error("Deck supports require the prebuilt pallet workflow / 托内支承件请使用先打托或只打托模式");
  if(packagingInterior(p).crate)throw new Error("木箱请使用先打托后装柜模式 / Use the pallet-building workflow for crates");
  const length = container.length - clearance * 2, width = container.width - clearance * 2;
  const doorWidth = (container.loadingAccess === "open" ? container.width : container.doorWidth) - clearance * 2;
  const height = Math.min(container.height, container.loadingAccess === "open" ? container.height : container.doorHeight) - clearance;
  if (container.category === "pallet") throw new Error("请先选择集装箱或货车，再加入柜内底层托盘。");
  if (p.height >= height) throw new Error("底层托盘高度已占满柜内或门洞净空。");
  const variants = ([{ dx: p.length, dy: p.width, orientation: "LWH" }, { dx: p.width, dy: p.length, orientation: "WLH" }] as const)
    .filter((v, i) => (p.layout === "auto" || (p.layout === "long" ? i === 0 : i === 1)) && v.dy <= doorWidth && v.dx <= length && v.dy <= width)
    .map(v => ({ ...v, columns: Math.floor((length + p.gap) / (v.dx + p.gap)) }));
  const make=(x:number,y:number,v:(typeof variants)[number],i:number):PlacedPallet=>({id:`floor-pallet-${i+1}`,presetId:p.presetId,name:p.name,x,y,z:0,dx:v.dx,dy:v.dy,dz:p.height,weight:p.weight,maxLoad:p.maxLoad,orientation:v.orientation,...(p.packaging?{packaging:p.packaging}:{})});
  const regions=siteExclusionBoxes(container,clearance).filter(z=>z.z<p.height-.0001);
  if(regions.length){
    const crosses=(a:PlacedPallet,b:Pick<PlacedBox,"x"|"y"|"dx"|"dy">,gap:number)=>a.x<b.x+b.dx+gap-.0001&&b.x<a.x+a.dx+gap-.0001&&a.y<b.y+b.dy+gap-.0001&&b.y<a.y+a.dy+gap-.0001;
    const coordinates=(rows:typeof variants,sideFirst:boolean)=>{
      const points=new Map<string,{x:number;y:number}>(),out:PlacedPallet[]=[];
      const add=(x:number,y:number)=>{if(x<length&&y<width)points.set(`${x}/${y}`,{x,y});};
      for(const x of [0,...regions.map(z=>z.x+z.dx)])for(const y of [0,...regions.map(z=>z.y+z.dy)])add(x,y);
      while(out.length<(p.count||200)){
        const ordered=[...points.values()].sort((a,b)=>sideFirst?a.y-b.y||a.x-b.x:a.x-b.x||a.y-b.y);
        let next:PlacedPallet|undefined;
        for(const {x,y} of ordered){
          for(const v of rows){
            const c=make(x,y,v,out.length);
            if(x+c.dx<=length+.0001&&y+c.dy<=width+.0001&&!regions.some(z=>crosses(c,z,0))&&!out.some(b=>crosses(c,b,p.gap))){next=c;break;}
          }
          if(next)break;
          points.delete(`${x}/${y}`);
        }
        if(!next)break;
        out.push(next);points.delete(`${next.x}/${next.y}`);
        const x=next.x+next.dx+p.gap,y=next.y+next.dy+p.gap;
        add(x,next.y);add(next.x,y);add(x,0);add(0,y);
      }
      return out;
    };
    const searched=[coordinates(variants,false),coordinates([...variants].reverse(),true)].sort((a,b)=>b.length-a.length)[0];
    if(!searched.length||searched.length<p.count)throw Error(`保留柜内区域后，当前搜索找到 ${searched.length} 个底层托盘位 / Floor search found ${searched.length} positions with the site regions retained`);
    return searched.sort((a,b)=>a.x-b.x||a.y-b.y).map((b,i)=>({...b,id:`floor-pallet-${i+1}`}));
  }
  let best: typeof variants = [], bestCount = 0, bestWidth = Infinity;
  const a = variants[0], b = variants[1];
  if (a) for (let na = 0; na <= Math.min(200, Math.floor((width + p.gap) / (a.dy + p.gap))); na++) {
    const used = na * (a.dy + p.gap);
    const nb = b ? Math.max(0, Math.min(200 - na, Math.floor((width + p.gap - used) / (b.dy + p.gap)))) : 0;
    const count = na * a.columns + nb * (b?.columns ?? 0), occupied = used + nb * ((b?.dy ?? 0) + p.gap) - p.gap;
    if (count > bestCount || count === bestCount && occupied < bestWidth) { bestCount = count; bestWidth = occupied; best = [...Array(na).fill(a), ...Array(nb).fill(b)] as typeof variants; }
  }
  const limit = p.count || Math.min(200, bestCount);
  if (!bestCount || p.count > bestCount) throw new Error(`当前净空最多放置 ${bestCount} 个底层托盘，请调整尺寸、数量或方向。`);
  const pallets: PlacedPallet[] = [];
  let y = 0;
  for (const row of best) { for (let i = 0; i < Math.min(row.columns, limit); i++) pallets.push(make(i*(row.dx+p.gap),y,row,pallets.length)); y += row.dy + p.gap; }
  return pallets.sort((a, b) => a.x - b.x || a.y - b.y).slice(0, limit).map((p,i)=>({...p,id:`floor-pallet-${i+1}`}));
}

export function palletSupportBoxes(pallets: PlacedPallet[]): PlacedBox[] {
  return pallets.map(p => ({ ...p, productId: PALLET_PRODUCT_ID, sku: p.id, color: "#b68d5d", layer: 1, supportOnly: true }));
}
export function palletSupportProducts(pallets: PlacedPallet[]): ProductInput[] {
  // One product per physical support keeps different dimensions, payloads and weights independently verifiable.
  return pallets.map(p => ({ id: p.id, sku: p.id, name: p.name, length: p.dx, width: p.dy, height: p.dz, weight: p.weight, quantity: 1, priority: 0, rotationPolicy: "fixed", stackable: true, maxStackLayers: 0, maxTopLoadKg: p.maxLoad-deckSupportMass(p), color: "#b68d5d" }));
}
export function palletAnchors(pallets: PlacedPallet[]): PlacedBox[] {
  return palletSupportBoxes(pallets).map(b => ({ ...b, productId: b.id }));
}

export function assignPalletReferences(boxes: PlacedBox[], pallets: PlacedPallet[], products: ProductInput[] = []): PlacedBox[] {
  const rules=new Map(products.map(p=>[p.id,p]));
  const levels = new Map<number, PlacedBox[]>(), refs = new Map<string, string[]>();
  const key = (z: number) => Math.round(z / .0001);
  for(const b of palletDeckSupportGeometry(pallets).boxes){refs.set(b.id,b.palletIds??[]);levels.set(key(b.z+b.dz),[...(levels.get(key(b.z+b.dz))??[]),b]);}
  for (const p of palletAnchors(pallets)) { refs.set(p.id, [p.id]); levels.set(key(p.z + p.dz), [...(levels.get(key(p.z + p.dz)) ?? []), p]); }
  const result = new Map<string, PlacedBox>();
  for (const box of [...boxes].sort((a, b) => a.z - b.z)) {
    const ids = new Set<string>();
    for (const below of levels.get(key(box.z)) ?? []) if (bodyContactArea(box,below,rules.get(box.productId),rules.get(below.productId))>.0001) for (const id of refs.get(below.id) ?? []) ids.add(id);
    refs.set(box.id, [...ids]); result.set(box.id, { ...box, palletIds: ids.size ? [...ids].sort() : undefined });
    for(const z of bodyTopLevels(box,rules.get(box.productId)))levels.set(key(z),[...(levels.get(key(z))??[]),box]);
  }
  return boxes.map(b => result.get(b.id)!);
}

/** Generic four-way block pallet: 5 deck boards, 3 cross boards, 9 blocks, 3 runners. */
export function palletParts(length: number, width: number, height: number) {
  if (height < 50) return [{x:0,y:0,z:0,dx:length,dy:width,dz:height,kind:"board" as const}];
  const t = height * 22 / 144, blockHeight = height - t * 3, runnerWidth = width * .145;
  const parts: Array<{ x: number; y: number; z: number; dx: number; dy: number; dz: number; kind: "board" | "block" }> = [];
  const add = (x: number, y: number, z: number, dx: number, dy: number, dz: number, kind: "board" | "block" = "board") => parts.push({ x, y, z, dx, dy, dz, kind });
  for (let i = 0; i < 3; i++) { const y = i * (width - runnerWidth) / 2; add(0, y, 0, length, runnerWidth, t); }
  for (let i = 0; i < 3; i++) { const x = i * (length - length * .12) / 2; add(x, 0, height - 2 * t, length * .12, width, t); for (let j = 0; j < 3; j++) add(x, j * (width - runnerWidth) / 2, t, length * .12, runnerWidth, blockHeight, "block"); }
  const deckWidth = width * .17;
  for (let i = 0; i < 5; i++) add(0, i * (width - deckWidth) / 4, height - t, length, deckWidth, t);
  return parts;
}
