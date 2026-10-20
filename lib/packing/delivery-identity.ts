import type { PackingResult, PlacedBox, PlacedPallet } from "./types";

export type DeliveryUnit = { unitId: string; kind: "carton" | "pallet"; localId: string; fingerprint: string };
export type DeliveryIdentity = {
  schema: 1; planId: string; revision: number; revisionId: string; previousRevisionId?: string; issuedAt: string; signature: string;
  forkedFrom?: { planId: string; revision: number; revisionId: string };
  units: DeliveryUnit[];
  withdrawn: { unitId: string; kind: DeliveryUnit["kind"]; revision: number }[];
};
const error = () => new Error("交付身份或版本记录无效 / Invalid delivery identity or revision record");
function canonical(v: unknown): string {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
/** Change detector only, not a signature, authentication, or proof of physical manufacture. */
function checksum(v: unknown) {
  let a=2166136261,b=2246822507;
  for(const c of canonical(v)){const n=c.codePointAt(0)!;a=Math.imul(a^n,16777619);b=Math.imul(b^n,3266489909);}
  return [a,b].map(n=>(n>>>0).toString(16).padStart(8,"0")).join("");
}
function token(v:unknown):string {if(typeof v!=="string"||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(v)||["__proto__","constructor","prototype"].includes(v))throw error();return v;}
function revision(v:unknown):number {if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>1_000_000)throw error();return Number(v);}
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw error();return v as Record<string,unknown>;}
function digest(v:unknown):string{if(typeof v!=="string"||! /^[0-9a-f]{16}$/.test(v))throw error();return v;}
function kind(v:unknown):DeliveryUnit["kind"]{if(v!=="carton"&&v!=="pallet")throw error();return v;}
export function parseDeliveryIdentity(value:unknown):DeliveryIdentity|undefined {
  if(value===undefined)return undefined;
  const v=record(value);if(v.schema!==1||!Array.isArray(v.units)||v.units.length>20_200||!Array.isArray(v.withdrawn)||v.withdrawn.length>50_000)throw error();
  const planId=token(v.planId),rev=revision(v.revision),revisionId=token(v.revisionId),previousRevisionId=v.previousRevisionId===undefined?undefined:token(v.previousRevisionId);
  if(planId===revisionId||previousRevisionId===revisionId||rev===1&&previousRevisionId!==undefined||rev>1&&previousRevisionId===undefined)throw error();
  if(typeof v.issuedAt!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.issuedAt)||(!Number.isFinite(Date.parse(v.issuedAt))||new Date(v.issuedAt).toISOString()!==v.issuedAt))throw error();
  const units=v.units.map(x=>{const r=record(x);if(typeof r.localId!=="string"||!r.localId.trim()||r.localId.length>300)throw error();return {unitId:token(r.unitId),kind:kind(r.kind),localId:r.localId,fingerprint:digest(r.fingerprint)};});
  const withdrawn=v.withdrawn.map(x=>{const r=record(x),n=revision(r.revision);if(n<2||n>rev)throw error();return {unitId:token(r.unitId),kind:kind(r.kind),revision:n};});
  const all=[...units,...withdrawn].map(x=>x.unitId);
  if(new Set(all).size!==all.length||all.includes(planId)||all.includes(revisionId)||new Set(units.map(x=>`${x.kind}/${x.localId}`)).size!==units.length)throw error();
  let forkedFrom:DeliveryIdentity["forkedFrom"];
  if(v.forkedFrom!==undefined){const p=record(v.forkedFrom);forkedFrom={planId:token(p.planId),revision:revision(p.revision),revisionId:token(p.revisionId)};if(forkedFrom.planId===planId)throw error();}
  return {schema:1,planId,revision:rev,revisionId,...(previousRevisionId?{previousRevisionId}:{}),issuedAt:v.issuedAt,signature:digest(v.signature),...(forkedFrom?{forkedFrom}:{}),units,withdrawn};
}
function unitFingerprint(plan:PackingResult,b:PlacedBox|PlacedPallet,kind:DeliveryUnit["kind"]) {
  if(kind==="carton"){const c=b as PlacedBox,{orderLine,...details}=plan.cargoDetails?.[c.productId]??{};return checksum([c.productId,c.sku,c.weight,[c.dx,c.dy,c.dz].sort((a,b)=>a-b),c.setCode??"",c.setNumber??null,c.setItemNumber??null,details,orderLine?.batch??""]);}
  const p=b as PlacedPallet;return checksum([p.specificationId??"primary",p.presetId,[p.dx,p.dy].sort((a,b)=>a-b),p.dz,p.weight,p.maxLoad,p.packaging??null,p.enclosureHeight??null]);
}
export function deliveryEntities(plan:PackingResult) {
  return [...plan.placements.map(b=>({kind:"carton" as const,localId:b.id,sourceId:b.productId,label:b.sku,fingerprint:unitFingerprint(plan,b,"carton")})),...(plan.pallets??[]).map(p=>({kind:"pallet" as const,localId:p.id,sourceId:p.specificationId??p.presetId,label:p.name,fingerprint:unitFingerprint(plan,p,"pallet")}))];
}
/** Excludes transient solver IDs/timing and inactive direct-loading pallet defaults. */
export function deliveryPlanSignature(p:PackingResult) {
  return checksum([p.mode,p.strategy,p.workflow??"direct",p.container,p.clearance,p.singleCartonLimit??null,p.practicalTargetUtilization,p.placements,p.pallets??[],p.floorPallets??null,p.palletization??null,p.palletization?p.palletBuild??null:null,p.loadingRules??null,p.cargoDetails??null,p.delivery??null,p.accessConfig??null,p.handlingTasks??null,p.summaries,p.setSummaries]);
}
export function deliveryUnitBindings(plan:PackingResult) {
  const known=new Map(plan.deliveryIdentity?.units.map(u=>[`${u.kind}/${u.localId}`,u]));
  return deliveryEntities(plan).map(e=>{const old=known.get(`${e.kind}/${e.localId}`);return {...e,unitId:old?.fingerprint===e.fingerprint?old.unitId:undefined};});
}
export function deliveryIdentityState(plan:PackingResult):"unissued"|"current"|"draft" {
  const id=plan.deliveryIdentity;if(!id)return "unissued";
  return id.signature===deliveryPlanSignature(plan)&&id.units.length===plan.placements.length+(plan.pallets?.length??0)&&deliveryUnitBindings(plan).every(u=>!!u.unitId)?"current":"draft";
}
/** Metadata remains a draft after edits; restoration must never silently certify it as current. */
export function restoreDeliveryIdentity(plan:PackingResult,value:unknown):DeliveryIdentity|undefined {
  const id=parseDeliveryIdentity(value);if(id&&id.signature===deliveryPlanSignature(plan)&&deliveryIdentityState({...plan,deliveryIdentity:id})!=="current")throw error();return id;
}
export function issueDeliveryIdentity(plan:PackingResult,fork=false,makeId:()=>string=()=>crypto.randomUUID(),now=new Date().toISOString()):PackingResult {
  if(!plan.validation.valid||!plan.placements.length||plan.metrics.loadedCount!==plan.placements.length)throw new Error("登记需要完整有效箱位 / Issuing requires a complete valid coordinate plan");
  const old=parseDeliveryIdentity(plan.deliveryIdentity),entities=deliveryEntities(plan);
  if(new Set(entities.map(u=>u.localId)).size!==entities.length)throw error();
  if(old&&!fork&&deliveryIdentityState(plan)==="current")return plan;
  const rev=old&&!fork?revision(old.revision+1):1,used=new Set([...(old?.units??[]),...(old?.withdrawn??[])].map(u=>u.unitId));
  if(old){used.add(old.planId);used.add(old.revisionId);if(old.previousRevisionId)used.add(old.previousRevisionId);}
  const nextId=(prefix:string)=>{for(let n=0;n<10;n++){const id=token(`${prefix}-${makeId()}`);if(!used.has(id)){used.add(id);return id;}}throw error();};
  const planId=old&&!fork?old.planId:nextId("delivery"),known=new Map(!fork?old?.units.map(u=>[`${u.kind}/${u.localId}`,u]):[]);
  const revisionId=nextId("revision");
  const units=entities.map(e=>{const prev=known.get(`${e.kind}/${e.localId}`);return {unitId:prev?.fingerprint===e.fingerprint?prev.unitId:nextId(e.kind),kind:e.kind,localId:e.localId,fingerprint:e.fingerprint};});
  const retained=new Set(units.map(u=>u.unitId));
  const withdrawn=fork?[]:[...old?.withdrawn??[],...(old?.units??[]).filter(u=>!retained.has(u.unitId)).map(u=>({unitId:u.unitId,kind:u.kind,revision:rev}))];
  const identity=parseDeliveryIdentity({schema:1,planId,revision:rev,revisionId,...(old&&!fork?{previousRevisionId:old.revisionId}:{}),issuedAt:now,signature:deliveryPlanSignature(plan),units,withdrawn,...(fork&&old?{forkedFrom:{planId:old.planId,revision:old.revision,revisionId:old.revisionId}}:old?.forkedFrom?{forkedFrom:old.forkedFrom}:{})})!;
  return {...plan,deliveryIdentity:identity,strategyPlans:undefined,strategyComparison:undefined};
}
