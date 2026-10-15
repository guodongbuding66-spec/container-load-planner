import { packagingReservedVolume,packagingMassCenter } from "./packaging";
import {modelMassCenter} from "./model-body";
import type { PackingResult } from "./types";
/** Rebase an intact unit onto a local floor; no vehicle or neighbouring units remain. */
export function isolatePalletPlan(plan:PackingResult,id:string):PackingResult {
  const p=plan.pallets?.find(p=>p.id===id);
  if(!p)throw new Error("Pallet not found");
  const cargo=plan.placements.filter(b=>b.palletIds?.includes(id)).map(b=>({...b,x:b.x-p.x,y:b.y-p.y,z:b.z-p.z}));
  const height=Math.max(p.enclosureHeight??p.dz,...cargo.map(b=>b.z+b.dz));
  const container={id:"unit-inspection",name:p.name,category:"other" as const,loadingAccess:"open" as const,length:p.dx,width:p.dy,height,doorWidth:p.dy,doorHeight:height,maxWeight:p.maxLoad+p.weight};
  const summaries=plan.summaries.filter(s=>cargo.some(b=>b.productId===s.productId)).map(s=>{const loaded=cargo.filter(b=>b.productId===s.productId).length;return {...s,requested:loaded,loaded,unloaded:0,loadedWeight:loaded*(s.loadedWeight/s.loaded),loadedVolume:loaded*(s.loadedVolume/s.loaded)};});
  const loadedVolume=summaries.reduce((n,s)=>n+s.loadedVolume,0)+packagingReservedVolume(p),grossWeight=p.weight+cargo.reduce((n,b)=>n+b.weight,0),effectiveVolume=p.dx*p.dy*height;
  const points=[{center:packagingMassCenter({...p,x:0,y:0,z:0}),weight:p.weight},...cargo.map(b=>({center:modelMassCenter(b,{...plan.cargoDetails?.[b.productId],weight:b.weight}),weight:b.weight}))];
  const mass=points.reduce((n,p)=>n+p.weight,0),center=[0,1,2].map(i=>mass?points.reduce((n,p)=>n+p.center[i]*p.weight,0)/mass:0),ratios=center.map((n,i)=>n/[p.dx,p.dy,height][i]);
  const centerOfGravity={x:center[0],y:center[1],z:center[2],longitudinalRatio:ratios[0],lateralRatio:ratios[1],heightRatio:ratios[2],balanced:ratios[0]>=.4&&ratios[0]<=.6&&ratios[1]>=.4&&ratios[1]<=.6};
  return {...plan,id:plan.id+"/"+id,workflow:"pallet-only",container,clearance:0,placements:cargo,pallets:[{...p,x:0,y:0,z:0}],summaries,setSummaries:[],metrics:{...plan.metrics,centerOfGravity,envelopeVolume:effectiveVolume,envelopeUtilization:1,loadedCount:cargo.length,requestedCount:cargo.length,loadedVolume,grossWeight,effectiveVolume,volumeUtilization:loadedVolume/effectiveVolume,weightUtilization:grossWeight/container.maxWeight},warnings:[]};
}
