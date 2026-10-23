import { palletEnvelopeTop } from "./deck-support";
import type { PlacedBox, PlacedPallet } from "./types";

/** Measured loading space; it never enlarges the physical deck or usable interior. */
export type MeasuredUnitEnvelope = {
  version: 1; length: number; width: number; height: number;
  noseProtrusion: number; leftProtrusion: number; source: string; date: string; contentsKey: string;
};
const failure = () => Error("实测包络资料无效或托内货物已改变，请重新测量 / Measured envelope is invalid or unit contents changed; measure again");
/** Translation-independent change detector, not authentication or a physical certificate. */
export function unitContentsKey(p: PlacedPallet, cargo: readonly PlacedBox[]) {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const rows = [...cargo].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(b => [b.id,b.productId,b.sku,...[b.x-p.x,b.y-p.y,b.z-p.z,b.dx,b.dy,b.dz,b.weight].map(round),b.orientation,b.orientationSigns??null,b.setCode??null,b.setNumber??null,b.setItemNumber??null]);
  const text = JSON.stringify([p.id,p.dx,p.dy,p.dz,p.weight,p.maxLoad,p.orientation,p.quarterTurns??null,p.enclosureHeight??null,p.packaging??null,rows]);
  let a=2166136261,b=2246822507;
  for(const c of text){const n=c.codePointAt(0)!;a=Math.imul(a^n,16777619);b=Math.imul(b^n,3266489909);}
  return [a,b].map(n=>(n>>>0).toString(16).padStart(8,"0")).join("");
}
export function parseMeasuredUnitEnvelope(value: unknown): MeasuredUnitEnvelope | undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=="object"||Array.isArray(value))throw failure();
  const r=value as MeasuredUnitEnvelope;
  if(r.version!==1||![r.length,r.width,r.height].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=1&&n<=100000)||![r.noseProtrusion,r.leftProtrusion].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=10000)||typeof r.source!=="string"||!r.source.trim()||r.source.length>500||typeof r.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date||typeof r.contentsKey!=="string"||! /^[0-9a-f]{16}$/.test(r.contentsKey))throw failure();
  return {version:1,length:r.length,width:r.width,height:r.height,noseProtrusion:r.noseProtrusion,leftProtrusion:r.leftProtrusion,source:r.source.trim(),date:r.date,contentsKey:r.contentsKey};
}
export function palletLoadEnvelope(p: PlacedPallet, cargo: readonly PlacedBox[]) {
  const r=parseMeasuredUnitEnvelope(p.measuredEnvelope);
  if(r&&r.contentsKey!==unitContentsKey(p,cargo))throw failure();
  const x=p.x-(r?.noseProtrusion??0),y=p.y-(r?.leftProtrusion??0);
  return {x,y,z:p.z,dx:Math.max(p.x+p.dx,x+(r?.length??p.dx))-x,dy:Math.max(p.y+p.dy,y+(r?.width??p.dy))-y,dz:Math.max(palletEnvelopeTop(p,cargo)-p.z,r?.height??0)};
}
