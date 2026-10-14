import type { DimensionStyle, DimensionUnit } from "./scene-dimensions";
import type { SnapMode } from "./inspection";
import type { TransportDisplayMode } from "./transport-model";
export type ViewPreferences={collisionProxy:boolean;mode:TransportDisplayMode;transparency:number;dimensions:boolean;labels:boolean;skuSummaries:boolean;dimensionUnit:DimensionUnit;dimensionFontSize:number;dimensionStyle:DimensionStyle;dimensionLineColor:string;dimensionTextColor:string;measureSnap:SnapMode;measurePrecision:number;leftOpen:boolean;rightOpen:boolean;leftWidth:number;rightWidth:number};
export const DEFAULT_VIEW_PREFERENCES:ViewPreferences={collisionProxy:false,mode:"model",transparency:65,dimensions:true,labels:true,skuSummaries:false,dimensionUnit:"mm",dimensionFontSize:18,dimensionStyle:"ruler",dimensionLineColor:"#467ee6",dimensionTextColor:"#137d83",measureSnap:"vertex",measurePrecision:3,leftOpen:true,rightOpen:true,leftWidth:192,rightWidth:256};
export function parseViewPreferences(value:unknown):ViewPreferences {
  const next={...DEFAULT_VIEW_PREFERENCES};if(!value||typeof value!=="object"||Array.isArray(value))return next;
  const v=value as Record<string,unknown>;
  const choices={mode:["model","wireframe"],dimensionUnit:["mm","cm","m"],dimensionStyle:["ruler","dimensions"],measureSnap:["vertex","edge","face"]};
  for(const [key,values] of Object.entries(choices))if(values.includes(v[key] as string))Object.assign(next,{[key]:v[key]});
  for(const key of ["collisionProxy","dimensions","labels","skuSummaries","leftOpen","rightOpen"] as const)if(typeof v[key]==="boolean")next[key]=v[key];
  for(const key of ["dimensionLineColor","dimensionTextColor"] as const)if(typeof v[key]==="string"&&/^#[\da-f]{6}$/i.test(v[key]))next[key]=v[key];
  const ranges={transparency:[0,100],leftWidth:[160,300],rightWidth:[220,380],measurePrecision:[0,3]};
  for(const [key,[min,max]] of Object.entries(ranges))if(typeof v[key]==="number"&&Number.isFinite(v[key]))Object.assign(next,{[key]:Math.max(min,Math.min(max,Math.round(v[key] as number)))});
  if([14,18,22,26].includes(v.dimensionFontSize as number))next.dimensionFontSize=v.dimensionFontSize as number;
  return next;
}
