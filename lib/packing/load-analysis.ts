import { bearingLimit, bearingLoads } from "./bearing";
import { palletAnchors } from "./floor-pallets";
import type { PackingResult, ProductInput } from "./types";
export type LoadStatus="verified"|"unknown"|"overload"|"no-load";
export type LoadCell={id:string;load:number;limit?:number;ratio?:number;status:LoadStatus;color:string};
export type HeatMode="off"|"top"|"pallet"|"zone";
export const loadColor=(ratio:number)=>ratio>1?"#c23832":ratio>.75?"#d58425":ratio>.5?"#d7ae38":"#2b8d83";
export function analyzeLoads(plan:PackingResult,products:ProductInput[]){
  const loads=bearingLoads([...palletAnchors(plan.pallets??[]),...plan.placements]),byId=new Map(products.map(p=>[p.id,p]));
  const cell=(id:string,limit:number|undefined):LoadCell=>{const load=loads.get(id)??0,ratio=limit===undefined?undefined:limit===0?(load>0?Infinity:0):load/limit,status=limit===undefined?(load>0?"unknown":"no-load"):load>limit+.0001?"overload":"verified";return {id,load,limit,ratio,status,color:status==="unknown"?"#7d8393":status==="no-load"?"#98bbb5":loadColor(ratio??0)};};
  const boxes=plan.placements.map(b=>cell(b.id,byId.get(b.productId)?bearingLimit(b,byId.get(b.productId)!):undefined));
  const pallets=(plan.pallets??[]).map(p=>cell(p.id,p.maxLoad));
  const length=plan.container.length-plan.clearance*2;
  const zones=Array.from({length:4},(_,i)=>({id:`zone-${i+1}`,x:i*length/4,dx:length/4,weight:0,color:"#2b8d83"}));
  for(const b of [...plan.placements,...palletAnchors(plan.pallets??[])])for(const zone of zones)zone.weight+=b.weight*Math.max(0,Math.min(b.x+b.dx,zone.x+zone.dx)-Math.max(b.x,zone.x))/b.dx;
  const max=Math.max(1,...zones.map(z=>z.weight));zones.forEach(z=>z.color=loadColor(z.weight/max));
  return {boxes,pallets,zones,unknown:boxes.filter(b=>b.status==="unknown").length};
}
export type LoadAnalysis=ReturnType<typeof analyzeLoads>;
