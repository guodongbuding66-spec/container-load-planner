import {planCrateStackReview} from "./crate-auto-stack";
import {palletDeckSupportGeometry,deckSupportMass,DECK_SUPPORT_PREFIX} from "./deck-support";
import {accessorySupportGeometry} from "./accessory-support";
import {accessoryMassBoxes} from "./container-accessories";
import { planCrateUnits, crateEvidence } from "./crate-bearing";
import { bearingLimit, bearingLoads } from "./bearing";
import { palletAnchors } from "./floor-pallets";
import type { PackingResult, ProductInput } from "./types";
export type LoadStatus="verified"|"unknown"|"overload"|"no-load";
export type LoadCell={id:string;load:number;limit?:number;ratio?:number;status:LoadStatus;color:string};
export type HeatMode="off"|"top"|"pallet"|"zone"|"crate";
export const loadColor=(ratio:number)=>ratio>1?"#c23832":ratio>.75?"#d58425":ratio>.5?"#d7ae38":"#2b8d83";
export function analyzeLoads(plan:PackingResult,products:ProductInput[]){
  const fixed=palletDeckSupportGeometry(plan.pallets??[]),site=accessorySupportGeometry(plan.container,plan.clearance);
  const loads=bearingLoads([...palletAnchors(plan.pallets??[]),...fixed.boxes,...site.boxes,...plan.placements],[...products,...fixed.products,...site.products]),byId=new Map(products.map(p=>[p.id,p]));
  for(const p of plan.pallets??[])loads.set(p.id,(loads.get(p.id)??0)+deckSupportMass(p));
  const cell=(id:string,limit:number|undefined):LoadCell=>{const load=loads.get(id)??0,ratio=limit===undefined?undefined:limit===0?(load>0?Infinity:0):load/limit,status=limit===undefined?(load>0?"unknown":"no-load"):load>limit+.0001?"overload":"verified";return {id,load,limit,ratio,status,color:status==="unknown"?"#7d8393":status==="no-load"?"#98bbb5":loadColor(ratio??0)};};
  const boxes=plan.placements.map(b=>cell(b.id,byId.get(b.productId)?bearingLimit(b,byId.get(b.productId)!):undefined));
  const pallets=(plan.pallets??[]).map(p=>cell(p.id,p.maxLoad));
  const length=plan.container.length-plan.clearance*2;
  const zones=Array.from({length:4},(_,i)=>({id:`zone-${i+1}`,x:i*length/4,dx:length/4,weight:0,color:"#2b8d83"}));
  const supportMass=new Map<string,number>((plan.pallets??[]).flatMap(p=>(p.packaging?.deckSupports??[]).map(s=>[`${DECK_SUPPORT_PREFIX}${p.id}/${s.id}`,s.weightKg??0] as const)));
  const attachedMass=new Map((plan.pallets??[]).map(p=>[p.id,deckSupportMass(p)]));
  const baseMasses=palletAnchors(plan.pallets??[]).map(p=>({...p,weight:p.weight-(attachedMass.get(p.id)??0)}));
  const supportMasses=fixed.boxes.map(b=>({...b,weight:supportMass.get(b.id)??0}));
  for(const b of [...plan.placements,...baseMasses,...supportMasses,...accessoryMassBoxes(plan.container,plan.clearance)]){
    // Conserve total mass when a physical accessory lies partly inside a safety margin.
    const overlaps=zones.map(zone=>Math.max(0,Math.min(b.x+b.dx,zone.x+zone.dx)-Math.max(b.x,zone.x))),covered=overlaps.reduce((n,v)=>n+v,0);
    if(covered>0)zones.forEach((zone,i)=>zone.weight+=b.weight*overlaps[i]/covered);
    else zones[Math.max(0,Math.min(3,Math.floor((b.x+b.dx/2)/length*4)))].weight+=b.weight;
  }
  const max=Math.max(1,...zones.map(z=>z.weight));zones.forEach(z=>z.color=loadColor(z.weight/max));
  const staticCells=new Map(planCrateStackReview(plan).cells.map(c=>[c.id,c]));
  const crates=planCrateUnits(plan).map(u=>{const evidence=crateEvidence(u.config);return {id:u.pallet.id,grossKg:u.pallet.weight+u.cargoKg,stack:staticCells.get(u.pallet.id)!,evidence,profile:u.config.crateBearing,color:staticCells.get(u.pallet.id)?.state==="passed"?"#2b8d83":staticCells.get(u.pallet.id)?.state==="failed"||evidence.state==="prohibited"?"#c23832":"#7d8393"};});
  return {boxes,pallets,zones,crates,unknown:boxes.filter(b=>b.status==="unknown").length};
}
export type LoadAnalysis=ReturnType<typeof analyzeLoads>;
