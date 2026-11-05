import {siteExclusionBoxes} from "./site-exclusions";
import {palletLoadEnvelope} from "./unit-envelope";
import { certifiedModelGaps,modelClearanceBounds } from "./solid-space";
import { cargoBodyParts, bodyContactArea,bodiesOverlap } from "./cargo-body";
import { applyTypeSupport } from "./loading-rules";
import { getOrientations, validatePacking } from "./engine";
import { packagingReservations } from "./packaging";
import { validatePalletizedCargo } from "./prebuilt-pallets";
import type { BoundsBox } from "./inspection";
import type { PackingResult, PlacedBox, ProductInput } from "./types";

export type EmptySpace = BoundsBox & { id: string };
const EPS=.0001;
export const volume=(b:BoundsBox)=>b.dx*b.dy*b.dz;
export function intersects(a:BoundsBox,b:BoundsBox){return a.x<b.x+b.dx-EPS&&b.x<a.x+a.dx-EPS&&a.y<b.y+b.dy-EPS&&b.y<a.y+a.dy-EPS&&a.z<b.z+b.dz-EPS&&b.z<a.z+a.dz-EPS;}
/** Six disjoint slabs: volumes can be summed, unlike overlapping maximal-space lists. */
export function subtractSpace(s:BoundsBox,b:BoundsBox):BoundsBox[]{
  if(!intersects(s,b))return [s];
  const x=Math.max(s.x,b.x),X=Math.min(s.x+s.dx,b.x+b.dx),y=Math.max(s.y,b.y),Y=Math.min(s.y+s.dy,b.y+b.dy),z=Math.max(s.z,b.z),Z=Math.min(s.z+s.dz,b.z+b.dz);
  return [{...s,dx:x-s.x},{...s,x:X,dx:s.x+s.dx-X},{x,y:s.y,z:s.z,dx:X-x,dy:y-s.y,dz:s.dz},{x,y:Y,z:s.z,dx:X-x,dy:s.y+s.dy-Y,dz:s.dz},{x,y,z:s.z,dx:X-x,dy:Y-y,dz:z-s.z},{x,y,z:Z,dx:X-x,dy:Y-y,dz:s.z+s.dz-Z}].filter(a=>a.dx>EPS&&a.dy>EPS&&a.dz>EPS);
}
function mergeSpaces(input:BoundsBox[]){
  let spaces=input;
  for(let pass=0;pass<3;pass++)for(const axis of ["x","y","z"] as const){
    const size=({x:"dx",y:"dy",z:"dz"} as const)[axis],others=(["x","y","z"] as const).filter(a=>a!==axis),groups=new Map<string,BoundsBox[]>();
    for(const s of spaces){const key=others.map(a=>`${s[a].toFixed(4)}/${s[({x:"dx",y:"dy",z:"dz"} as const)[a]].toFixed(4)}`).join("|");groups.set(key,[...(groups.get(key)??[]),s]);}
    spaces=[...groups.values()].flatMap(group=>{const out:BoundsBox[]=[];for(const s of group.sort((a,b)=>a[axis]-b[axis])){const last=out.at(-1);if(last&&Math.abs(last[axis]+last[size]-s[axis])<EPS)last[size]+=s[size];else out.push({...s});}return out;});
  }
  return spaces;
}
/** Full-plan geometry always participates, even when boxes are hidden or playback is incomplete. */
export function analyzeEmptySpaces(plan:PackingResult,limit=600){
  if(plan.metrics.loadedCount!==plan.placements.length)return {spaces:[] as EmptySpace[],truncated:true,incomplete:true,coveredVolume:0};
  let spaces:BoundsBox[]=[{x:0,y:0,z:0,dx:plan.container.length-2*plan.clearance,dy:plan.container.width-2*plan.clearance,dz:plan.container.height-plan.clearance}],truncated=false;
  for(const b of siteExclusionBoxes(plan.container,plan.clearance))spaces=spaces.flatMap(s=>subtractSpace(s,b));
  let approximate=false;
  for(const p of plan.pallets??[])if(p.measuredEnvelope){const envelope=palletLoadEnvelope(p,plan.placements.filter(b=>b.palletIds?.includes(p.id)));spaces=spaces.flatMap(s=>subtractSpace(s,envelope));}
  for(const p of plan.pallets??[])for(const b of packagingReservations(p))spaces=spaces.flatMap(s=>subtractSpace(s,b));
  for(const b of plan.placements){
    const p=plan.cargoDetails?.[b.productId];
    if(p?.solidModel){
      const bounds=modelClearanceBounds(b,p);
      spaces=spaces.flatMap(s=>{if(!intersects(s,bounds))return [s];const x=Math.max(s.x,bounds.x),y=Math.max(s.y,bounds.y),z=Math.max(s.z,bounds.z),inside={x,y,z,dx:Math.min(s.x+s.dx,bounds.x+bounds.dx)-x,dy:Math.min(s.y+s.dy,bounds.y+bounds.dy)-y,dz:Math.min(s.z+s.dz,bounds.z+bounds.dz)-z};const gaps=certifiedModelGaps(inside,b,p,Math.max(200,Math.floor(2400/Math.max(1,spaces.length))));approximate||=gaps.approximate;return [...subtractSpace(s,bounds),...gaps.spaces];});
    }else for(const box of cargoBodyParts(b,p))spaces=spaces.flatMap(s=>subtractSpace(s,box));
    if(spaces.length>limit){truncated=true;spaces.sort((a,b)=>volume(b)-volume(a));spaces.length=limit;}
  }
  spaces=mergeSpaces(spaces).sort((a,b)=>volume(b)-volume(a));
  return {spaces:spaces.map((s,i)=>({...s,id:`gap-${i+1}`})),truncated,incomplete:false,approximate,coveredVolume:spaces.reduce((n,s)=>n+volume(s),0)};
}
type ProbeRoute={axis:"rear"|"top";state:"clear"|"unverified";blockers:string[];envelopeExitMm:number};
export type SpaceProbe={candidate:PlacedBox|null;status:"fits"|"kit"|"weight"|"door"|"size"|"not-found"|"invalid";errors:string[];tested:number;route?:ProbeRoute};
function inspectProbeRoute(plan:PackingResult,candidate:PlacedBox,product:ProductInput):ProbeRoute{
 const open=plan.container.loadingAccess==="open",axis=open?"top":"rear",left=(plan.container.width-plan.container.doorWidth)/2;
 const {clearance,container}=plan;
 const blockers:string[]=[];
 if(!open&&(candidate.y<left-EPS||candidate.y+candidate.dy>left+container.doorWidth-2*clearance+EPS||candidate.z+candidate.dz>container.doorHeight-clearance+EPS))blockers.push("door");
 const sweep=open?{...candidate,dz:container.height-clearance-candidate.z}:{...candidate,dx:container.length-2*clearance-candidate.x};
 let envelopeExitMm=0;
 for(const b of plan.placements){
  const p=plan.cargoDetails?.[b.productId];
  if(p?.solidModel&&intersects(candidate,b))envelopeExitMm=Math.max(envelopeExitMm,open?b.z+b.dz-candidate.z:b.x+b.dx-candidate.x);
  if(bodiesOverlap(sweep,b,{protectionGap:product.protectionGap},p)&&blockers.length<12)blockers.push(b.id);
 }
 for(const zone of siteExclusionBoxes(container,clearance))if(intersects(sweep,zone)&&blockers.length<12)blockers.push(zone.id);
 for(const pallet of plan.pallets??[]){
  const occupied=plan.palletization?[palletLoadEnvelope(pallet,plan.placements.filter(b=>b.palletIds?.includes(pallet.id)))]:packagingReservations(pallet);
  if(occupied.some(b=>intersects(sweep,b))&&blockers.length<12)blockers.push(pallet.id);
 }
 return {axis,state:blockers.length?"unverified":"clear",blockers,envelopeExitMm};
}
/** Feasibility witness only. Increasing the order is explicit; kits may never be added as loose components. */
export function probeEmptySpace(plan:PackingResult,inputs:ProductInput[],productId:string,spaces:EmptySpace[],selectedId?:string):SpaceProbe{
  const products=applyTypeSupport(inputs,plan.loadingRules),p=products.find(p=>p.id===productId);
  const result=(status:SpaceProbe["status"],errors:string[]=[],tested=0):SpaceProbe=>({candidate:null,status,errors,tested});
  if(plan.workflow === "pallet-only")return result("invalid",["只打托请修改订单后重新生成托盘"]);
  if(!p||!plan.validation.valid||plan.metrics.loadedCount!==plan.placements.length)return result("invalid");
  if(p.setCode?.trim())return result("kit");
  if(plan.metrics.grossWeight+p.weight>plan.container.maxWeight+EPS)return result("weight");
  const all=getOrientations(p,false).filter(o=>plan.strategy!=="practical"||p.allowedOrientations||Math.abs(o.dz-p.height)<EPS);
  const variants=all.filter(o=>plan.container.loadingAccess==="open"||(o.dy<=plan.container.doorWidth-2*plan.clearance+EPS&&o.dz<=plan.container.doorHeight-plan.clearance+EPS));
  if(!variants.length)return result("door");
  const checkedProducts=products.map(q=>q.id===p.id?{...q,quantity:Math.max(q.quantity,plan.placements.filter(b=>b.productId===q.id).length+1)}:q);
  const errors=new Set<string>();let tested=0;
  for(const s of spaces.filter(s=>!selectedId||s.id===selectedId))for(const o of variants){
    if(o.dx>s.dx+EPS||o.dy>s.dy+EPS||o.dz>s.dz+EPS)continue;
    for(const x of [...new Set([s.x,s.x+s.dx-o.dx])])for(const y of [...new Set([s.y,s.y+s.dy-o.dy])]){
      if(++tested>240)return result("not-found",[...errors].slice(0,3),tested-1);
      const b:PlacedBox={id:"space-probe",productId:p.id,sku:p.sku,name:p.name,color:p.color,x,y,z:s.z,dx:o.dx,dy:o.dy,dz:o.dz,weight:p.weight,orientation:o.label,layer:1};
      const supporters=plan.placements.filter(a=>bodyContactArea(b,a,p,products.find(p=>p.id===a.productId))>EPS);
      b.layer=supporters.length?Math.max(...supporters.map(a=>a.layer))+1:1;
      const validation=validatePacking([...plan.placements,b].sort((a,b)=>a.z-b.z||a.x-b.x),plan.container,plan.clearance,checkedProducts,plan.strategy,plan.mode,plan.pallets,plan.floorPallets,plan.palletization);
      if(validation.valid&&plan.palletization)validation.errors.push(...validatePalletizedCargo([...plan.placements,b],plan.pallets??[],plan.container,plan.clearance,plan.palletization,checkedProducts));
      if(validation.valid&&!validation.errors.length)return {candidate:b,status:"fits",errors:[],tested,route:inspectProbeRoute(plan,b,p)};
      validation.errors.forEach(e=>errors.add(e));
    }
  }
  return result(tested?"not-found":"size",[...errors].slice(0,3),tested);
}
