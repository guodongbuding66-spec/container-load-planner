import { deliveryIdentityState } from "./delivery-identity";
import { orderedAccessories } from "./container-accessories";
import { toCsvCell } from "./csv";
import type { PackingResult } from "./types";

export type OperationTask={id:string;phase:"loading"|"unloading";label:[string,string];requires:string[];accessoryId?:string};
export type OperationContext={planId:string;revision:number;revisionId:string;signature:string};
export type OperationEvent={id:string;taskId:string;parents:string[];action:"confirm"|"exception"|"reopen";at:string;operator:string;note:string;prerequisites:{taskId:string;heads:string[]}[]};
export type OperationRecords={format:"cargo-fit-operations";version:1;context:OperationContext;events:OperationEvent[]};
export type OperationState={task:OperationTask;heads:string[];event?:OperationEvent;status:"pending"|"confirmed"|"exception"|"reopened"|"conflict"|"stale"};
export const MAX_OPERATION_BYTES=2*1024*1024;
export class OperationError extends Error {constructor(readonly zh:string,readonly en:string){super(`${zh} / ${en}`);}}
const fail=(zh="作业记录格式或依赖无效",en="Invalid operation records or dependencies")=>new OperationError(zh,en);
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw fail();return v as Record<string,unknown>;}
function text(v:unknown,max:number,required=false){if(typeof v!=="string"||v.length>max||required&&!v.trim())throw fail();return v.trim();}
function token(v:unknown){const s=text(v,120,true);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s)||["__proto__","constructor","prototype"].includes(s))throw fail();return s;}
function iso(v:unknown){const s=text(v,24,true);if(!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)throw fail();return s;}
const same=(a:string[],b:string[])=>{const right=[...b].sort();return a.length===b.length&&[...a].sort().every((x,i)=>x===right[i]);};

/** Checklist dependencies only: no equipment actions, strength certificate or installer reachability. */
export function operationTasks(plan:PackingResult):OperationTask[]{
  const accessories=orderedAccessories(plan.container.exclusions??[]),before=accessories.filter(z=>z.accessory.phase==="before-cargo"),after=accessories.filter(z=>z.accessory.phase==="after-cargo");
  const install=(id:string)=>`load:install:${id}`,remove=(id:string)=>`unload:remove:${id}`;
  const tasks:OperationTask[]=[{id:"load:inspect",phase:"loading",label:["装货前：柜况、清洁与干燥检查","Before loading: condition, cleanliness and dryness"],requires:[]}];
  for(const z of accessories)tasks.push({id:install(z.id),phase:"loading",accessoryId:z.id,label:z.kind==="reserved"?[`核对预留区域：${z.name}`,`Check reserved region: ${z.name}`]:[`安装附件：${z.name}`,`Install material: ${z.name}`],requires:[z.accessory.phase==="before-cargo"?"load:inspect":"load:cargo",...z.accessory.afterAccessoryIds.map(install)]});
  tasks.push({id:"load:cargo",phase:"loading",label:["核对整单箱数、套装与包装清单","Verify complete cargo, kits and packaging manifest"],requires:["load:inspect",...before.map(z=>install(z.id))]},
    {id:"load:marks",phase:"loading",label:["核对整单唛头、可读朝向与箱托编号","Check all shipping marks, readable faces and unit IDs"],requires:["load:cargo"]},
    {id:"load:moisture",phase:"loading",label:["核对防潮措施、材料与依据","Review moisture measures, materials and instructions"],requires:["load:cargo",...accessories.filter(z=>z.accessory.type==="desiccant").map(z=>install(z.id))]},
    {id:"load:closure",phase:"loading",label:["封柜复核：附件完成、临时物移除与封号记录","Closure review: materials, temporary items and seal reference"],requires:["load:marks","load:moisture",...after.map(z=>install(z.id))]},
    {id:"unload:arrival",phase:"unloading",label:["到货：核对封号、外观与异常","Arrival: inspect seal, condition and exceptions"],requires:[]});
  for(const z of accessories){const dependents=accessories.filter(x=>x.accessory.afterAccessoryIds.includes(z.id));tasks.push({id:remove(z.id),phase:"unloading",accessoryId:z.id,label:z.kind==="reserved"?[`核对区域释放：${z.name}`,`Check reserved region release: ${z.name}`]:[`拆除附件：${z.name}`,`Remove material: ${z.name}`],requires:[z.accessory.phase==="after-cargo"?"unload:arrival":"unload:cargo",...dependents.map(x=>remove(x.id))]});}
  tasks.push({id:"unload:cargo",phase:"unloading",label:["核对卸货清单、数量与临时支承安排","Check unloading manifest, counts and temporary support arrangements"],requires:["unload:arrival",...after.map(z=>remove(z.id))]},
    {id:"unload:clear",phase:"unloading",label:["卸货结束：材料清场与异常交接","After unloading: clear materials and hand over exceptions"],requires:["unload:cargo",...before.map(z=>remove(z.id))]});
  const map=new Map(tasks.map(t=>[t.id,t]));if(map.size!==tasks.length)throw fail();
  const seen=new Set<string>(),active=new Set<string>(),ordered:OperationTask[]=[];
  const visit=(id:string)=>{if(active.has(id)||!map.has(id))throw fail();if(seen.has(id))return;active.add(id);const t=map.get(id)!;t.requires=[...new Set(t.requires)];t.requires.forEach(visit);active.delete(id);seen.add(id);ordered.push(t);};tasks.forEach(t=>visit(t.id));return ordered;
}
function context(plan:PackingResult):OperationContext {
  if(deliveryIdentityState(plan)!=="current"||!plan.validation.valid)throw fail("请先登记完整有效的当前交付版本","Issue a complete valid current delivery revision first");
  const {planId,revision,revisionId,signature}=plan.deliveryIdentity!;return {planId,revision,revisionId,signature};
}
export function operationKey(plan:PackingResult){const c=context(plan);return `cargo-fit-operations-v1/${c.planId}/${c.revisionId}`;}
export function emptyOperationRecords(plan:PackingResult):OperationRecords {operationTasks(plan);return {format:"cargo-fit-operations",version:1,context:context(plan),events:[]};}
export function parseOperationRecords(plan:PackingResult,contents:string):OperationRecords {
  if(new TextEncoder().encode(contents).length>MAX_OPERATION_BYTES)throw fail("作业备份超过 2 MB","Operation backup exceeds 2 MB");
  const v=obj(JSON.parse(contents)),c=obj(v.context),expected=context(plan),tasks=new Map(operationTasks(plan).map(t=>[t.id,t]));
  if(v.format!=="cargo-fit-operations"||v.version!==1||!Array.isArray(v.events)||v.events.length>500)throw fail();
  if(c.planId!==expected.planId||c.revision!==expected.revision||c.revisionId!==expected.revisionId||c.signature!==expected.signature)throw fail("作业记录属于其他计划或旧版本，请恢复对应方案","Operation records belong to another plan or revision; restore the matching plan");
  const events:OperationEvent[]=v.events.map(raw=>{const r=obj(raw),taskId=text(r.taskId,200,true),task=tasks.get(taskId);
    if(!task||!["confirm","exception","reopen"].includes(String(r.action))||!Array.isArray(r.parents)||r.parents.length>500||!Array.isArray(r.prerequisites))throw fail();
    const parents=r.parents.map(token),prerequisites=r.prerequisites.map(x=>{const d=obj(x);if(!Array.isArray(d.heads)||d.heads.length!==1)throw fail();return {taskId:text(d.taskId,200,true),heads:d.heads.map(token)};});
    if(new Set(parents).size!==parents.length||new Set(prerequisites.map(d=>d.taskId)).size!==prerequisites.length||r.action==="confirm"&&!same(prerequisites.map(d=>d.taskId),task.requires)||r.action!=="confirm"&&prerequisites.length)throw fail();
    return {id:token(r.id),taskId,action:r.action as OperationEvent["action"],parents,prerequisites,at:iso(r.at),operator:text(r.operator,100,true),note:text(r.note,1000,true)};
  });
  const map=new Map(events.map(e=>[e.id,e]));if(map.size!==events.length)throw fail();
  for(const e of events){for(const p of e.parents)if(!map.has(p)||map.get(p)!.taskId!==e.taskId)throw fail();for(const d of e.prerequisites)for(const h of d.heads)if(map.get(h)?.taskId!==d.taskId||map.get(h)?.action!=="confirm")throw fail();}
  const seen=new Set<string>(),active=new Set<string>();const visit=(id:string)=>{if(active.has(id))throw fail();if(seen.has(id))return;active.add(id);map.get(id)!.parents.forEach(visit);active.delete(id);seen.add(id);};events.forEach(e=>visit(e.id));
  return {format:"cargo-fit-operations",version:1,context:expected,events:events.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};
}
function states(plan:PackingResult,records:OperationRecords):Map<string,OperationState>{
  const events=new Map(records.events.map(e=>[e.id,e])),parentIds=new Set(records.events.flatMap(e=>e.parents)),result=new Map<string,OperationState>();
  for(const task of operationTasks(plan)){
    const heads=records.events.filter(e=>e.taskId===task.id&&!parentIds.has(e.id)).map(e=>e.id).sort(),event=heads.length===1?events.get(heads[0]):undefined;
    let status:OperationState["status"]=!heads.length?"pending":heads.length>1?"conflict":event!.action==="confirm"?"confirmed":event!.action==="exception"?"exception":"reopened";
    if(status==="confirmed"&&event!.prerequisites.some(d=>{const prior=result.get(d.taskId)!;return prior.status!=="confirmed"||!same(prior.heads,d.heads);}))status="stale";
    result.set(task.id,{task,heads,event,status});
  }return result;
}
export function operationStates(plan:PackingResult,records:OperationRecords){return states(plan,parseOperationRecords(plan,JSON.stringify(records)));}
export function appendOperation(plan:PackingResult,records:OperationRecords,taskId:string,action:OperationEvent["action"],operator:string,note:string,options:{resolve?:boolean;id?:string;at?:string}={}):OperationRecords {
  const current=parseOperationRecords(plan,JSON.stringify(records)),audit=states(plan,current),s=audit.get(taskId);if(!s)throw fail();
  if(s.heads.length>1&&!options.resolve)throw fail("此项存在并行冲突，请明确复核并合并后再登记","This task has concurrent conflicts; explicitly review and resolve before recording");
  if(action==="confirm"&&s.task.requires.some(id=>audit.get(id)?.status!=="confirmed"))throw fail("前置检查未完成、已撤回或存在异常，不能确认此项","A prerequisite is incomplete, reopened or has an exception; this task cannot be confirmed");
  const event={id:options.id??`operation-${crypto.randomUUID()}`,taskId,action,operator,note,at:options.at??new Date().toISOString(),parents:s.heads,prerequisites:action==="confirm"?s.task.requires.map(id=>({taskId:id,heads:audit.get(id)!.heads})):[]};
  return parseOperationRecords(plan,JSON.stringify({...current,events:[...current.events,event]}));
}
export function mergeOperationRecords(plan:PackingResult,a:OperationRecords,b:OperationRecords){
  const left=parseOperationRecords(plan,JSON.stringify(a)),right=parseOperationRecords(plan,JSON.stringify(b)),all=new Map(left.events.map(e=>[e.id,e]));
  for(const e of right.events){const prev=all.get(e.id);if(prev&&JSON.stringify(prev)!==JSON.stringify(e))throw fail("相同作业事件编号内容冲突，未合并","Conflicting content for the same operation event ID; nothing was merged");all.set(e.id,e);}
  return parseOperationRecords(plan,JSON.stringify({...left,events:[...all.values()]}));
}
/** A concurrent tab is merged; denied / corrupt storage never replaces existing bytes. */
export function persistOperationRecords(plan:PackingResult,records:OperationRecords,storage:{getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void}):{records:OperationRecords;saved:boolean}{
  const current=parseOperationRecords(plan,JSON.stringify(records));let next=current;
  try{const old=storage.getItem(operationKey(plan));if(old)next=mergeOperationRecords(plan,current,parseOperationRecords(plan,old));storage.setItem(operationKey(plan),JSON.stringify(next));return {records:next,saved:true};}catch{return {records:next,saved:false};}
}
export function operationCsv(plan:PackingResult,records:OperationRecords){
  const r=parseOperationRecords(plan,JSON.stringify(records)),audit=states(plan,r);
  return [["planId","revision","revisionId","eventId","taskId","phase","taskZh","taskEn","currentStatus","action","at","operator","note","parents","prerequisiteWitnesses"],...r.events.map(e=>{const s=audit.get(e.taskId)!;return [r.context.planId,r.context.revision,r.context.revisionId,e.id,e.taskId,s.task.phase,...s.task.label,s.status,e.action,e.at,e.operator,e.note,JSON.stringify(e.parents),JSON.stringify(e.prerequisites)];})].map(row=>row.map(toCsvCell).join(",")).join("\r\n");
}
