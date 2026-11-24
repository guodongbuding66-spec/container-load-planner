import {assertDeckSupportStacking} from "./deck-support";
import { parseFloorPalletConfig } from "./floor-pallets";
import { packagingHeight } from "./packaging";
import type { ContainerSpec, FloorPalletConfig, PalletBuildOptions, PalletBuildSpecification, PlacedPallet } from "./types";

export const PRIMARY_SPECIFICATION = "primary";
export const MAX_PACKAGING_SPECIFICATIONS = 8;
export const MAX_CARTONS_PER_PALLET = 1000;
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
export function parsePalletCartonLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_CARTONS_PER_PALLET) {
    throw new Error("每托箱数须为 1–1000 的整数 / Cartons per pallet must be an integer from 1 to 1000");
  }
  return value;
}
export function parsePackagingSpecifications(value: unknown, draft=false): PalletBuildSpecification[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PACKAGING_SPECIFICATIONS) throw new Error("Use 1–8 packaging specifications / 包装规格须为 1–8 种");
  const specifications = value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid packaging specification");
    const s = raw as PalletBuildSpecification;
    if (typeof s.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || ["__proto__","constructor","prototype"].includes(s.id) || !Number.isInteger(s.stackLayers) || s.stackLayers < 1 || s.stackLayers > 20 || !Number.isFinite(s.maxTopLoadKg) || s.maxTopLoadKg < 0 || s.maxTopLoadKg > 100000) throw new Error("Invalid packaging identifier or stacking rule");
    const config=parseFloorPalletConfig(s.config,draft);
    if(!draft)assertDeckSupportStacking(config,s.stackLayers,s.maxTopLoadKg);
    const productIds = parsePackagingSelection(s.productIds);
    const cartonLimit = parsePalletCartonLimit(s.cartonLimit);
    return { id:s.id, config:{...config,count:0,allowFloorCargo:false}, maxPallets:parsePackagingLimit(s.maxPallets), ...(productIds ? {productIds} : {}), ...(cartonLimit === undefined ? {} : {cartonLimit}), stackLayers:s.stackLayers, maxTopLoadKg:s.maxTopLoadKg };
  });
  if (new Set(specifications.map(s => s.id)).size !== specifications.length) throw new Error("Duplicate packaging specification / 包装规格标识重复");
  return specifications;
}
export function palletSpecifications(options: PalletBuildOptions): PalletBuildSpecification[] {
  const {maxPallets = options.maxPallets, productIds, cartonLimit} = options.primaryRule ?? {};
  return [{
    id:PRIMARY_SPECIFICATION, config:options.config, maxPallets,
    ...(productIds ? {productIds} : {}), ...(cartonLimit === undefined ? {} : {cartonLimit}),
    stackLayers:options.stackLayers, maxTopLoadKg:options.maxTopLoadKg,
  }, ...options.additionalSpecs ?? []];
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
export function mixedInspectionContainer(configs:FloorPalletConfig[],retained?:{pallets:readonly PlacedPallet[];specifications:readonly FloorPalletConfig[]}):ContainerSpec {
  if(!configs.length||configs.some(c=>!c.maxCargoHeight))throw new Error("Pallet-only specifications require cargo height limits / 只打托的规格须填写货物限高");
  const count=configs.length,columns=Math.min(5,Math.ceil(Math.sqrt(count))),rows=Math.ceil(count/columns);
  const height=Math.max(...configs.map(packagingHeight));
  let length=columns*Math.max(...configs.map(c=>c.length))+(columns-1)*200;
  let width=rows*Math.max(...configs.map(c=>c.width))+(rows-1)*200;
  if(retained){
    // A released unit leaves a hole in the inspection grid. Keep the remaining origins, including locked units.
    length=Math.max(length,...retained.pallets.map(p=>p.x+p.dx));
    width=Math.max(width,...retained.pallets.map(p=>p.y+p.dy));
    const maxCell=Math.max(...retained.specifications.flatMap(c=>[c.length,c.width]))+200;
    if(!Number.isFinite(length)||!Number.isFinite(width)||length>5*maxCell-200||width>40*maxCell-200)throw Error("托盘超出编组展示范围 / Pallet is outside the inspection grid");
  }
  return {id:"pallet-inspection",name:"托盘编组区",category:"other",loadingAccess:"open",length,width,height,doorWidth:width,doorHeight:height,maxWeight:configs.reduce((n,c)=>n+c.maxLoad+c.weight,0)};
}
