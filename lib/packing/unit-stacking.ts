import type { FloorPalletConfig, PalletBuildSpecification, PalletBuildOptions } from "./types";

/** User-declared stackability for space planning, distinct from structural certification. */
export type UnitStacking = { enabled:boolean; maxLayers:number; maxTopLoadKg?:number };
export function parseUnitStacking(value:unknown):UnitStacking {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid loaded-pallet stacking rule");
  const v=value as UnitStacking;
  if(typeof v.enabled!=="boolean"||!Number.isInteger(v.maxLayers)||v.maxLayers<0||v.maxLayers>99||v.maxTopLoadKg!==undefined&&(!Number.isFinite(v.maxTopLoadKg)||v.maxTopLoadKg<0||v.maxTopLoadKg>100000))throw Error("Invalid loaded-pallet stacking limit");
  return {enabled:v.enabled,maxLayers:v.maxLayers,...(v.maxTopLoadKg===undefined?{}:{maxTopLoadKg:v.maxTopLoadKg})};
}
export function declaredUnitStacking(c:FloorPalletConfig) {
  return c.unitStacking?.enabled===true&&!c.packaging?.deckSupports?.length&&c.crateBearing?.policy!=="prohibited"&&c.crateBearing?.policy!=="rated";
}
export function declaredStackLayers(c:FloorPalletConfig) { return Math.min(c.unitStacking?.maxLayers||99,(c.crateBearing?.maxLayers??1)>1?c.crateBearing!.maxLayers:99); }
export function declaredTopLoad(c:FloorPalletConfig) { return Math.min(c.unitStacking?.maxTopLoadKg??100000,(c.crateBearing?.maxTopLoadKg??0)>0?c.crateBearing!.maxTopLoadKg:100000); }
export function openUnitLayers(s:Pick<PalletBuildSpecification,"config"|"stackLayers">) {
  return s.config.unitStacking ? s.config.unitStacking.enabled ? declaredStackLayers(s.config) : 1 : s.stackLayers;
}
/** Preserve geometry and known ratings; only the displayed stacking/supply choices change. */
export function enableWholePalletStacking(build:PalletBuildOptions,id:string,automaticQuantity:boolean):PalletBuildOptions {
 const enable=(config:FloorPalletConfig)=>({...config,unitStacking:{...config.unitStacking,enabled:true,maxLayers:config.unitStacking?.maxLayers??0}});
 if(id==="primary")return {...build,config:enable(build.config),...(automaticQuantity?{maxPallets:200,primaryRule:{...build.primaryRule,maxPallets:200}}:{})};
 if(!build.additionalSpecs?.some(s=>s.id===id))throw Error("Unknown packaging specification");
 return {...build,...(automaticQuantity?{maxPallets:200}:{}),additionalSpecs:build.additionalSpecs.map(s=>s.id===id?{...s,config:enable(s.config),...(automaticQuantity?{maxPallets:200}:{})}:s)};
}
