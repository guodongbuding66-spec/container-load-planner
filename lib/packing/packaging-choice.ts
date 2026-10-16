import { normalizedSetCode, normalizedUnitsPerSet } from "./set-utils";
import type { PackingResult, PlacedBox, ProductInput } from "./types";
export type PackagingSelection = "ordered" | "compact";
export type PackagingCandidate = { specificationId:string; cartons:number; loads:Record<string,number>; exterior:[number,number,number]; tareKg:number };
export type PackagingChoiceReason = "only-fit" | "priority-load" | "smaller-envelope" | "smaller-footprint" | "lower-tare" | "stable-order";
export type PackagingChoice = { palletId:string; chosenSpecificationId:string; reason:PackagingChoiceReason; candidates:PackagingCandidate[] };
export const CHOICE_REASON_TEXT:Record<PackagingChoiceReason,[string,string]>={
  "only-fit":["仅一个当前可用候选","Only one available candidate"],
  "priority-load":["按优先顺序可装更多货物","More cargo in priority order"],
  "smaller-envelope":["同优先货量，外包络更小","Same priority load, smaller envelope"],
  "smaller-footprint":["同货量和体积，占地更小","Same load and volume, smaller footprint"],
  "lower-tare":["同货量和外形，包装更轻","Same load and exterior, lighter packaging"],
  "stable-order":["候选等效，沿用列表顺序","Equivalent candidates; retain list order"]
};
export const packagingGroupKey=(p:ProductInput)=>normalizedSetCode(p)?`kit:${normalizedSetCode(p)}`:`sku:${p.id}`;
export function packagingPriorityGroups(products:readonly ProductInput[]){
  const groups=new Map<string,ProductInput[]>();for(const p of [...products].sort((a,b)=>Number(b.mustLoad!==false)-Number(a.mustLoad!==false)||b.priority-a.priority)){const key=packagingGroupKey(p);groups.set(key,[...groups.get(key)??[],p]);}return [...groups.values()];
}
export function packagingLoads(cargo:readonly PlacedBox[],groups:readonly ProductInput[][]){
  const counts=new Map<string,number>();for(const b of cargo)counts.set(b.productId,(counts.get(b.productId)??0)+1);
  const loads:Record<string,number>={};for(const group of groups){const first=group[0];const count=normalizedSetCode(first)?Math.min(...group.map(p=>Math.floor((counts.get(p.id)??0)/normalizedUnitsPerSet(p)))):counts.get(first.id)??0;if(count)loads[packagingGroupKey(first)]=count;}
  return loads;
}
const volume=(c:PackagingCandidate)=>c.exterior[0]*c.exterior[1]*c.exterior[2];
const area=(c:PackagingCandidate)=>c.exterior[0]*c.exterior[1];
/** Priority loads dominate every size or tare saving. This is a local heuristic. */
export function choosePackaging(candidates:readonly PackagingCandidate[],groupOrder:readonly string[]){
  if(!candidates.length)throw new Error("No eligible packaging candidates");
  let tied=[...candidates],reason:PackagingChoiceReason="only-fit";
  for(const key of groupOrder){const most=Math.max(...tied.map(c=>c.loads[key]??0));const next=tied.filter(c=>(c.loads[key]??0)===most);if(next.length<tied.length)reason="priority-load";tied=next;}
  for(const [metric,label] of [[volume,"smaller-envelope"],[area,"smaller-footprint"],[(c:PackagingCandidate)=>c.tareKg,"lower-tare"]] as const){
    const least=Math.min(...tied.map(metric)),next=tied.filter(c=>Math.abs(metric(c)-least)<=.0001);if(next.length<tied.length)reason=label;tied=next;
  }
  if(tied.length>1)reason="stable-order";
  return {candidate:tied[0],reason};
}
/** Descriptive generation notes; independent physical validation remains authoritative. */
export function parsePackagingChoices(value:unknown,specIds:Set<string>):PackagingChoice[]|undefined{
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>200)throw new Error("Invalid packaging choice records");
  const ids=new Set<string>();return value.map(raw=>{
    if(!raw||typeof raw!=="object")throw new Error("Invalid packaging choice");const v=raw as PackagingChoice;
    if(typeof v.palletId!=="string"||!v.palletId.trim()||v.palletId.length>300||ids.has(v.palletId)||!specIds.has(v.chosenSpecificationId)||!Object.hasOwn(CHOICE_REASON_TEXT,v.reason)||!Array.isArray(v.candidates)||!v.candidates.length||v.candidates.length>8)throw new Error("Invalid packaging choice identity");ids.add(v.palletId);
    const candidateIds=new Set<string>(),candidates=v.candidates.map(c=>{
      if(!c||!specIds.has(c.specificationId)||candidateIds.has(c.specificationId)||!Number.isInteger(c.cartons)||c.cartons<1||c.cartons>20000||!Array.isArray(c.exterior)||c.exterior.length!==3||!c.exterior.every(n=>Number.isFinite(n)&&n>0&&n<=300000)||!Number.isFinite(c.tareKg)||c.tareKg<0||c.tareKg>10000||!c.loads||typeof c.loads!=="object"||Array.isArray(c.loads))throw new Error("Invalid packaging candidate");candidateIds.add(c.specificationId);
      const entries=Object.entries(c.loads);if(!entries.length||entries.length>10000||entries.some(([k,n])=>(!k.startsWith("sku:")&&!k.startsWith("kit:"))||k.length>250||!Number.isInteger(n)||n<1||n>20000))throw new Error("Invalid candidate load quantities");
      return {specificationId:c.specificationId,cartons:c.cartons,loads:Object.fromEntries(entries),exterior:[...c.exterior] as [number,number,number],tareKg:c.tareKg};
    });if(!candidateIds.has(v.chosenSpecificationId))throw new Error("Chosen packaging candidate is missing");
    return {palletId:v.palletId,chosenSpecificationId:v.chosenSpecificationId,reason:v.reason,candidates};
  });
}

/** The same selection scope accompanies HTML and PDF delivery reports. */
export function packagingSelectionNotes(plan:PackingResult,en=false):string[]{
  if(plan.palletization?.selection!=="compact")return [];
  const count=plan.palletization.selectionChoices?.length??0;
  return en?[
    "Packaging selection: per-unit candidate comparison",
    "Priority load, then envelope, footprint and tare; no global minimum-unit or cost guarantee.",
    count?`${count} generation records; full candidate details are in the workspace / CSV.`:"Generation records cleared or unavailable; rebuild pallets to compare again."
  ]:[
    "包装选择：逐托自动比选",
    "先比较优先货量，再比较外包络、占地和自重；不保证全局最少托数或费用。",
    count?`${count} 条生成记录；完整候选依据见工作区／CSV。`:"生成记录已清除或不可用；须重新打托才能重新比选。"
  ];
}
