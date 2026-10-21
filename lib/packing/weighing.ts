import { deliveryIdentityState } from "./delivery-identity";
import { containerAccessoryWeight } from "./container-accessories";
import { toCsvCell } from "./csv";
import type { PackingResult } from "./types";

export type WeighingContext = { planId:string; revision:number; revisionId:string; signature:string };
export type WeightMeasurement = {
  id:string; method:"payload"|"gross-minus-tare"; scope:"complete-load";
  measuredAt:string; recordedAt:string; source:string; reference:string; note:string;
  readingKg:number; tareKg:number|null; tareSource:string;
};
export type WeighingRecords = {format:"cargo-fit-weighing";version:1;context:WeighingContext;measurements:WeightMeasurement[]};
export const MAX_WEIGHING_BYTES=1024*1024;
export class WeighingError extends Error {
  constructor(readonly zh:string,readonly en:string){super(`${zh} / ${en}`);}
}
const fail=(zh="核重文件、数值或来源无效",en="Invalid weighing file, values or provenance")=>new WeighingError(zh,en);
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw fail();return v as Record<string,unknown>;};
function text(v:unknown,max:number,required=false){if(typeof v!=="string"||v.length>max||required&&!v.trim())throw fail();return v.trim();}
function kg(v:unknown){if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>10_000_000)throw fail();return v;}
function token(v:unknown){const s=text(v,120,true);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s)||["__proto__","prototype","constructor"].includes(s))throw fail();return s;}
function iso(v:unknown){const s=text(v,24,true);if(!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)throw fail();return s;}
function context(plan:PackingResult):WeighingContext {
  if(deliveryIdentityState(plan)!=="current"||!plan.validation.valid)throw fail("请先登记完整有效的当前交付版本","Issue a complete valid current delivery revision first");
  const {planId,revision,revisionId,signature}=plan.deliveryIdentity!;return {planId,revision,revisionId,signature};
}
export function weighingKey(plan:PackingResult){const c=context(plan);return `cargo-fit-weighing-v1/${c.planId}/${c.revisionId}`;}
export function emptyWeighingRecords(plan:PackingResult):WeighingRecords {return {format:"cargo-fit-weighing",version:1,context:context(plan),measurements:[]};}
export function plannedWeightBreakdown(plan:PackingResult){
  const cargoKg=plan.summaries.reduce((n,s)=>n+s.loadedWeight,0),packagingKg=(plan.pallets??[]).reduce((n,p)=>n+p.weight,0),accessoriesKg=containerAccessoryWeight(plan.container),payloadKg=cargoKg+packagingKg+accessoriesKg;
  const consistent=[cargoKg,packagingKg,accessoriesKg,payloadKg,plan.metrics.grossWeight].every(n=>Number.isFinite(n)&&n>=0)&&Math.abs(payloadKg-plan.metrics.grossWeight)<=Math.max(0.00001,payloadKg*1e-9);
  return {cargoKg,packagingKg,accessoriesKg,payloadKg,consistent};
}
export function parseWeighingRecords(plan:PackingResult,contents:string):WeighingRecords {
  if(new TextEncoder().encode(contents).length>MAX_WEIGHING_BYTES)throw fail("核重文件超过 1 MB","Weighing file exceeds 1 MB");
  const v=obj(JSON.parse(contents)),c=obj(v.context),expected=context(plan);
  if(v.format!=="cargo-fit-weighing"||v.version!==1||!Array.isArray(v.measurements)||v.measurements.length>100)throw fail();
  if(c.planId!==expected.planId||c.revision!==expected.revision||c.revisionId!==expected.revisionId||c.signature!==expected.signature)throw fail("核重记录属于其他计划或旧版本，请恢复对应方案","Weighing records belong to another plan or revision; restore the matching plan");
  const measurements=v.measurements.map((raw):WeightMeasurement=>{
    const r=obj(raw);if(!["payload","gross-minus-tare"].includes(String(r.method))||r.scope!=="complete-load")throw fail();
    const readingKg=kg(r.readingKg),tareSource=text(r.tareSource,300,r.method==="gross-minus-tare"),tareKg=r.method==="gross-minus-tare"?kg(r.tareKg):null;
    if(r.method==="payload"&&(r.tareKg!==null||tareSource)||tareKg!==null&&tareKg>readingKg)throw fail("总重不能小于皮重，净载荷读数不得重复扣皮重","Gross weight must cover tare; payload readings must not subtract tare again");
    return {id:token(r.id),method:r.method as WeightMeasurement["method"],scope:"complete-load",measuredAt:iso(r.measuredAt),recordedAt:iso(r.recordedAt),source:text(r.source,300,true),reference:text(r.reference,300,true),note:text(r.note,1000),readingKg,tareKg,tareSource};
  });
  if(new Set(measurements.map(m=>m.id)).size!==measurements.length)throw fail();
  return {format:"cargo-fit-weighing",version:1,context:expected,measurements};
}
export function appendWeightMeasurement(plan:PackingResult,records:WeighingRecords,input:Omit<WeightMeasurement,"id"|"recordedAt"|"scope">,options:{id?:string;at?:string}={}):WeighingRecords {
  const current=parseWeighingRecords(plan,JSON.stringify(records));
  if(!plannedWeightBreakdown(plan).consistent)throw fail("计划重量明细不一致，不能据此对账","Planned weight components disagree; reconciliation is blocked");
  return parseWeighingRecords(plan,JSON.stringify({...current,measurements:[...current.measurements,{...input,scope:"complete-load",id:options.id??`weigh-${crypto.randomUUID()}`,recordedAt:options.at??new Date().toISOString()}]}));
}
export function mergeWeighingRecords(plan:PackingResult,a:WeighingRecords,b:WeighingRecords){
  const left=parseWeighingRecords(plan,JSON.stringify(a)),right=parseWeighingRecords(plan,JSON.stringify(b)),all=new Map(left.measurements.map(m=>[m.id,m]));
  for(const m of right.measurements){const previous=all.get(m.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(m))throw fail("同一核重编号内容冲突，未合并","Conflicting content for the same weighing ID; nothing was merged");all.set(m.id,m);}
  return parseWeighingRecords(plan,JSON.stringify({...left,measurements:[...all.values()]}));
}
export function reconcileMeasurement(plan:PackingResult,m:WeightMeasurement){
  const planned=plannedWeightBreakdown(plan),payloadKg=m.readingKg-(m.tareKg??0),differenceKg=payloadKg-planned.payloadKg;
  return {payloadKg,differenceKg,differencePercent:planned.payloadKg>0?differenceKg/planned.payloadKg*100:null,overPayloadKg:Math.max(0,payloadKg-plan.container.maxWeight),planned};
}
export function weighingCsv(plan:PackingResult,records:WeighingRecords){
  const r=parseWeighingRecords(plan,JSON.stringify(records)),p=plannedWeightBreakdown(plan);
  return [["planId","revision","revisionId","measurementId","method","scope","measuredAt","recordedAt","source","reference","readingKg","tareKg","tareSource","measuredPayloadKg","plannedCargoKg","plannedPackagingKg","plannedAccessoriesKg","plannedPayloadKg","differenceKg","differencePercent","overPayloadKg","note"],...r.measurements.map(m=>{const v=reconcileMeasurement(plan,m);return [r.context.planId,r.context.revision,r.context.revisionId,m.id,m.method,m.scope,m.measuredAt,m.recordedAt,m.source,m.reference,m.readingKg,m.tareKg,m.tareSource,v.payloadKg,p.cargoKg,p.packagingKg,p.accessoriesKg,p.payloadKg,v.differenceKg,v.differencePercent,v.overPayloadKg,m.note];})].map(row=>row.map(toCsvCell).join(",")).join("\r\n");
}
