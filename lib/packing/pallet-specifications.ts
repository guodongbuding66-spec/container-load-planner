import {assertDeckSupportStacking} from "./deck-support";
import { parseFloorPalletConfig } from "./floor-pallets";
import { packagingHeight } from "./packaging";
import type { ContainerSpec, FloorPalletConfig, PalletBuildOptions, PalletBuildSpecification, PlacedPallet } from "./types";

export const PRIMARY_SPECIFICATION = "primary";
export const MAX_PACKAGING_SPECIFICATIONS = 8;
/** Copy dimensions for a new specification without transferring operational consent. */
export function newPackagingConfig(config: FloorPalletConfig): FloorPalletConfig {
  const copy = structuredClone(config);
  if (copy.crateBearing) copy.crateBearing = {...copy.crateBearing,automaticStacking:false,reviewed:false,reviewedFor:""};
  return copy;
}
export function parsePackagingSelection(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 10000 || value.some(id => typeof id !== "string" || !id.trim() || id.length > 120) || new Set(value).size !== value.length) throw new Error("Invalid packaging SKU selection / 包装适用 SKU 无效");
  return [...value];
}
export function parsePackagingLimit(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 200) throw new Error("Packaging availability must be 0–200 / 包装可用数量须为 0–200");
  return value as number;
}
export function parsePackagingSpecifications(value: unknown): PalletBuildSpecification[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PACKAGING_SPECIFICATIONS) throw new Error("Use 1–8 packaging specifications / 包装规格须为 1–8 种");
  const specifications = value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid packaging specification");
    const s = raw as PalletBuildSpecification;
    if (typeof s.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || ["__proto__","constructor","prototype"].includes(s.id) || !Number.isInteger(s.stackLayers) || s.stackLayers < 1 || s.stackLayers > 20 || !Number.isFinite(s.maxTopLoadKg) || s.maxTopLoadKg < 0 || s.maxTopLoadKg > 100000) throw new Error("Invalid packaging identifier or stacking rule");
    assertDeckSupportStacking(parseFloorPalletConfig(s.config),s.stackLayers,s.maxTopLoadKg);
    const productIds = parsePackagingSelection(s.productIds);
    return { id:s.id, config:{...parseFloorPalletConfig(s.config),count:0,allowFloorCargo:false}, maxPallets:parsePackagingLimit(s.maxPallets), ...(productIds ? {productIds} : {}), stackLayers:s.stackLayers, maxTopLoadKg:s.maxTopLoadKg };
  });
  if (new Set(specifications.map(s => s.id)).size !== specifications.length) throw new Error("Duplicate packaging specification / 包装规格标识重复");
  return specifications;
}
export function palletSpecifications(options: PalletBuildOptions): PalletBuildSpecification[] {
  return [{id:PRIMARY_SPECIFICATION,config:options.config,maxPallets:options.primaryRule?.maxPallets??options.maxPallets,...(options.primaryRule?.productIds?{productIds:options.primaryRule.productIds}:{}),stackLayers:options.stackLayers,maxTopLoadKg:options.maxTopLoadKg},...options.additionalSpecs??[]];
}
type UnitSpecifications = {config:FloorPalletConfig;stackLayers?:number;maxTopLoadKg?:number;specifications?:PalletBuildSpecification[]};
export function specificationForPallet(value:UnitSpecifications,pallet:Pick<PlacedPallet,"specificationId">):PalletBuildSpecification {
  if(value.specifications){const found=value.specifications.find(s=>s.id===pallet.specificationId);if(!found)throw new Error("Pallet refers to an unknown packaging specification / 托盘引用了未知包装规格");return found;}
  if(pallet.specificationId!==undefined)throw new Error("Packaging specification definitions are missing");
  return {id:PRIMARY_SPECIFICATION,config:value.config,maxPallets:200,stackLayers:value.stackLayers??1,maxTopLoadKg:value.maxTopLoadKg??0};
}
export function independentPalletVolume(value:UnitSpecifications,pallets:PlacedPallet[]) {
  return pallets.reduce((n,p)=>{const c=specificationForPallet(value,p).config;return n+c.length*c.width*packagingHeight(c);},0);
}
/** Fixed cells use the largest specification; their spacing is never cargo capacity. */
export function mixedInspectionContainer(configs:FloorPalletConfig[]):ContainerSpec {
  if(!configs.length||configs.some(c=>!c.maxCargoHeight))throw new Error("Pallet-only specifications require cargo height limits / 只打托的规格须填写货物限高");
  const count=configs.length,columns=Math.min(5,Math.ceil(Math.sqrt(count))),rows=Math.ceil(count/columns),length=Math.max(...configs.map(c=>c.length)),width=Math.max(...configs.map(c=>c.width)),height=Math.max(...configs.map(packagingHeight));
  return {id:"pallet-inspection",name:"托盘编组区",category:"other",loadingAccess:"open",length:columns*length+(columns-1)*200,width:rows*width+(rows-1)*200,height,doorWidth:rows*width+(rows-1)*200,doorHeight:height,maxWeight:configs.reduce((n,c)=>n+c.maxLoad+c.weight,0)};
}
