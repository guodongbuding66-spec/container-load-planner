import {measureRegularSurfaceGap,parseRegularSurfaceSpec,regularSurfaceSpec,snapRegularSurface,type RegularSurfaceSpec} from "./surface-inspection";
import {deliveryPlanSignature} from "./delivery-identity";
import {boxBounds,measureBoxGap,measurePoints,measureWall,sectionBox,snapBoxPoint,type BoundsBox,type Measurement,type Point3,type Section,type SnapMode,type WallSide} from "./inspection";
import type {PackingResult,PlacedBox} from "./types";
import {visiblePlanPallets} from "./prebuilt-pallets";

export const MEASUREMENT_KEY="cargo-fit-measurements-v1";
export const MEASUREMENT_LIMIT=20;
export const MEASUREMENT_BYTES=256_000;
type Target={id:string;kind:"carton"|"pallet";source:BoundsBox;bounds:BoundsBox};
export type SavedMeasurement={id:string;name:string;createdAt:string;visible:boolean;scope:string;space:{length:number;width:number;height:number;clearance:number};mode:"points"|"gap"|"wall";targets:Target[];surface?:[RegularSurfaceSpec,RegularSurfaceSpec];points?:[Point3,Point3];snaps?:[SnapMode,SnapMode];wall?:WallSide};
export type MeasurementOverlay=Measurement&{label?:string;basis?:"envelope"|"surface"};
const fail=()=>new Error("Invalid measurement archive");
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw fail();return v as Record<string,unknown>;};
const finite=(n:unknown,positive=false)=>{if(typeof n!=="number"||!Number.isFinite(n)||Math.abs(n)>1e9||(positive&&n<=0))throw fail();return n;};
const text=(v:unknown,max:number,empty=false)=>{if(typeof v!=="string"||v.length>max||(!empty&&!v.trim())||/[\u0000-\u001f\u007f]/u.test(v)||["__proto__","prototype","constructor"].includes(v))throw fail();return v;};
const point=(v:unknown):Point3=>{if(!Array.isArray(v)||v.length!==3)throw fail();return v.map(n=>finite(n)) as Point3;};
const bounds=(v:unknown):BoundsBox=>{const b=record(v);return {x:finite(b.x),y:finite(b.y),z:finite(b.z),dx:finite(b.dx,true),dy:finite(b.dy,true),dz:finite(b.dz,true)};};
const cloneBounds=(b:BoundsBox):BoundsBox=>({x:b.x,y:b.y,z:b.z,dx:b.dx,dy:b.dy,dz:b.dz});
const sameBounds=(a:BoundsBox,b:BoundsBox)=>["x","y","z","dx","dy","dz"].every(k=>a[k as keyof BoundsBox]===b[k as keyof BoundsBox]);
const inside=(p:Point3,b:BoundsBox)=>{const [lo,hi]=boxBounds(b);return p.every((n,i)=>n>=lo[i]-1e-6&&n<=hi[i]+1e-6);};
export const sectionedMeasurement=(m:SavedMeasurement)=>m.targets.some(t=>!sameBounds(t.source,t.bounds));
function parseOne(value:unknown):SavedMeasurement{
  const v=record(value),id=text(v.id,100),name=text(v.name,80,true),createdAt=text(v.createdAt,30);
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt)||!Number.isFinite(Date.parse(createdAt))||new Date(createdAt).toISOString()!==createdAt||typeof v.visible!=="boolean"||typeof v.scope!=="string"||!/^[0-9a-f]{16}$/.test(v.scope))throw fail();
  const space=record(v.space),s={length:finite(space.length,true),width:finite(space.width,true),height:finite(space.height,true),clearance:finite(space.clearance)};
  if(s.clearance<0||s.clearance>=Math.min(s.length,s.width)/2||!["points","gap","wall"].includes(String(v.mode))||!Array.isArray(v.targets)||v.targets.length!==(v.mode==="wall"?1:2))throw fail();
  const targets:Target[]=v.targets.map(item=>{const t=record(item);if(t.kind!=="carton"&&t.kind!=="pallet")throw fail();const source=bounds(t.source),b=bounds(t.bounds),[lo,hi]=boxBounds(b);if(!inside(lo,source)||!inside(hi,source))throw fail();return {id:text(t.id,300),kind:t.kind,source,bounds:b};});
  const base={id,name,createdAt,visible:v.visible,scope:v.scope,space:s,targets};
  if(v.mode==="points"){
    if(!Array.isArray(v.snaps)||v.snaps.length!==2||v.snaps.some(s=>!["vertex","edge","face"].includes(String(s)))||!Array.isArray(v.points)||v.points.length!==2||v.wall!==undefined)throw fail();
    const points=v.points.map(point) as [Point3,Point3],snaps=v.snaps as [SnapMode,SnapMode];
    let surface:[RegularSurfaceSpec,RegularSurfaceSpec]|undefined;
    if(v.surface!==undefined){
      if(!Array.isArray(v.surface)||v.surface.length!==2||targets.some(t=>t.kind!=="carton"||!sameBounds(t.source,t.bounds)))throw fail();
      surface=v.surface.map(parseRegularSurfaceSpec) as [RegularSurfaceSpec,RegularSurfaceSpec];
    }
    if(points.some((p,i)=>!inside(p,targets[i].bounds)||measurePoints(p,surface?snapRegularSurface(targets[i].bounds,surface[i],p,snaps[i]):snapBoxPoint(targets[i].bounds,p,snaps[i])).distance>1e-5))throw fail();
    return {...base,mode:"points",points,snaps,...(surface?{surface}:{})};
  }
  if(v.points!==undefined||v.snaps!==undefined||targets.some(t=>!sameBounds(t.source,t.bounds)))throw fail();
  if(v.mode==="gap"){
    if(v.wall!==undefined||targets[0].id===targets[1].id&&targets[0].kind===targets[1].kind)throw fail();
    if(v.surface===undefined)return {...base,mode:"gap"};
    if(!Array.isArray(v.surface)||v.surface.length!==2||targets.some(t=>t.kind!=="carton"))throw fail();
    return {...base,mode:"gap",surface:v.surface.map(parseRegularSurfaceSpec) as [RegularSurfaceSpec,RegularSurfaceSpec]};
  }
  if(v.surface!==undefined||!["x-","x+","y-","y+","z-","z+"].includes(String(v.wall)))throw fail();
  return {...base,mode:"wall",wall:v.wall as WallSide};
}
export function parseMeasurements(contents:string):SavedMeasurement[]{
  if(new TextEncoder().encode(contents).length>MEASUREMENT_BYTES)throw fail();
  const v=record(JSON.parse(contents));
  if(v.format!=="cargo-fit-measurements"||![1,2,3].includes(v.version as number)||!Array.isArray(v.measurements)||v.measurements.length>MEASUREMENT_LIMIT)throw fail();
  if(v.version===1&&v.measurements.some(m=>record(m).surface!==undefined))throw fail();
  const items=v.measurements.map(parseOne);
  if(v.version!==3&&items.some(m=>m.mode==="gap"&&m.surface))throw fail();
  if(new Set(items.map(m=>m.id)).size!==items.length)throw fail();return items;
}
export function serializeMeasurements(items:SavedMeasurement[]){
  const version=items.some(m=>m.mode==="gap"&&m.surface)?3:2;
  const text=JSON.stringify({format:"cargo-fit-measurements",version,measurements:items},null,2);
  return JSON.stringify({format:"cargo-fit-measurements",version,measurements:parseMeasurements(text)},null,2);
}
export function mergeMeasurements(current:SavedMeasurement[],incoming:SavedMeasurement[]){
  const next=[...current];for(const item of incoming){const previous=next.find(m=>m.id===item.id);if(previous){if(JSON.stringify(previous)!==JSON.stringify(item))throw new Error("Conflicting measurement ID");}else next.push(item);}
  return parseMeasurements(serializeMeasurements(next));
}
export function savedMeasureValue(m:SavedMeasurement):Measurement{
  if(m.mode==="points")return measurePoints(m.points![0],m.points![1]);
  if(m.mode==="gap")return m.surface?measureRegularSurfaceGap(m.targets[0].source,m.surface[0],m.targets[1].source,m.surface[1]):measureBoxGap(m.targets[0].source,m.targets[1].source);
  return measureWall(m.targets[0].source,{container:m.space,clearance:m.space.clearance},m.wall!);
}
export function savedMeasureCurrent(m:SavedMeasurement,plan:PackingResult,scope=deliveryPlanSignature(plan)){
  if(m.scope!==scope||m.space.length!==plan.container.length||m.space.width!==plan.container.width||m.space.height!==plan.container.height||m.space.clearance!==plan.clearance)return false;
  return m.targets.every((t,i)=>{const b=(t.kind==="carton"?plan.placements:plan.pallets??[]).find(b=>b.id===t.id);return !!b&&sameBounds(t.source,b)&&(!m.surface||t.kind==="carton"&&JSON.stringify(regularSurfaceSpec(b as PlacedBox,plan.cargoDetails?.[(b as PlacedBox).productId]??{}))===JSON.stringify(m.surface[i]));});
}
export function captureMeasurement(plan:PackingResult,mode:SavedMeasurement["mode"],boxes:PlacedBox[],points:Point3[],snap:SnapMode|SnapMode[],wall:WallSide,section:Section,name="",id:string=crypto.randomUUID(),now=new Date().toISOString(),captureBounds?:BoundsBox[],surface?:RegularSurfaceSpec[]):SavedMeasurement{
  const targets=boxes.map((b,i)=>({id:b.id,kind:b.supportOnly?"pallet" as const:"carton" as const,source:cloneBounds(b),bounds:cloneBounds(mode==="points"?(captureBounds?.[i]??sectionBox(b,plan,section)??b):b)}));
  return parseOne({id,name:name.trim(),createdAt:now,visible:true,scope:deliveryPlanSignature(plan),space:{length:plan.container.length,width:plan.container.width,height:plan.container.height,clearance:plan.clearance},mode,targets,...(mode==="points"?{...(surface?{surface}:{}),points,snaps:Array.isArray(snap)?snap:[snap,snap]}:mode==="wall"?{wall}:surface?{surface}:{})});
}
/** Stale entries stay in the list, but never draw as if they belonged to the current plan. */
export function savedMeasureOverlays(items:SavedMeasurement[],plan:PackingResult,display:PlacedBox[],section:Section,visibleCount:number,scope?:string):MeasurementOverlay[]{
  if(!items.some(m=>m.visible))return [];
  const currentScope=scope??deliveryPlanSignature(plan),shown=new Map(display.map(b=>[b.id,b]));
  return items.filter(m=>m.visible&&savedMeasureCurrent(m,plan,currentScope)&&m.targets.every((t,i)=>{
    const b=t.kind==="carton"?shown.get(t.id):visiblePlanPallets(plan,visibleCount).find(p=>p.id===t.id&&(section.isolation==="all"||section.isolation==="pallet"&&section.target===p.id));
    const clipped=b&&sectionBox(b,plan,section);return !!clipped&&(!m.surface||section.axis==="off")&&(m.mode!=="points"||inside(m.points![i],clipped));
  })).map(m=>({...savedMeasureValue(m),label:m.name||undefined,basis:m.surface?"surface" as const:"envelope" as const}));
}
