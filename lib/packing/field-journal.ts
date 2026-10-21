import {deliveryIdentityState,deliveryUnitBindings} from "./delivery-identity";
import type {PackingResult} from "./types";

export type FieldState={loaded:boolean;condition:"none"|"missing"|"damaged"};
export type FieldAction="load"|"unload"|"missing"|"damage"|"clear"|"resolve";
export type FieldAtom={id:string;kind:"carton"|"pallet";sourceId:string;weightKg:number;witness:string;children:string[]};
export type FieldContext={planId:string;revision:number;revisionId:string;signature:string;atoms:FieldAtom[]};
export type FieldPhoto={name:string;mime:"image/png"|"image/jpeg"|"image/webp";dataUrl:string};
export type FieldChange={id:string;parents:string[];state:FieldState};
export type FieldEvent={id:string;at:string;deviceId:string;unitId:string;action:FieldAction;changes:FieldChange[];note:string;photos:FieldPhoto[]};
export type FieldJournal={format:"cargo-fit-field-events";version:1;context:FieldContext;events:FieldEvent[]};
export type UnitTicket={format:"cargo-fit-unit-v1";planId:string;revision:number;revisionId:string;signature:string;unitId:string};
export const MAX_FIELD_BYTES=50*1024*1024;
const initial:FieldState={loaded:false,condition:"none"};
const fail=(zh="现场记录格式或关系无效",en="Invalid field-event data or relationships")=>new Error(`${zh} / ${en}`);
const rec=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw fail();return v as Record<string,unknown>;};
const txt=(v:unknown,n:number)=>{if(typeof v!=="string"||v.length>n)throw fail();return v;};
const token=(v:unknown)=>{const s=txt(v,120);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(s)||["constructor","prototype","__proto__"].includes(s))throw fail();return s;};
const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical)}]`:v&&typeof v==="object"?`{${Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`:JSON.stringify(v);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const state=(v:unknown):FieldState=>{const s=rec(v);if(typeof s.loaded!=="boolean"||!["none","missing","damaged"].includes(String(s.condition))||s.loaded&&s.condition==="missing")throw fail();return {loaded:s.loaded,condition:s.condition as FieldState["condition"]};};
const targets=(c:FieldContext,id:string,action:FieldAction)=>{const a=c.atoms.find(a=>a.id===id);if(!a)throw fail("编号不属于当前版本","Unit does not belong to this revision");return [id,...(["load","unload","missing"].includes(action)?a.children:[])];};
function applyAction(s:FieldState,action:FieldAction):FieldState {
 if(action==="load"){if(s.condition==="missing")throw fail("请先处理缺箱异常，再确认装载","Clear the missing-cargo exception before confirming loading");return {...s,loaded:true};}
 if(action==="unload")return {...s,loaded:false};
 if(action==="missing")return {loaded:false,condition:"missing"};
 if(action==="damage")return {...s,condition:"damaged"};
 if(action==="clear")return {...s,condition:"none"};
 throw fail();
}
export function fieldContext(plan:PackingResult):FieldContext {
 if(deliveryIdentityState(plan)!=="current")throw fail("请先登记当前交付版本","Issue the current delivery revision first");
 const id=plan.deliveryIdentity!,boxes=new Map(plan.placements.map(b=>[b.id,b])),pallets=new Map((plan.pallets??[]).map(p=>[p.id,p]));
 const bindings=deliveryUnitBindings(plan),cartonIds=new Map(bindings.filter(b=>b.kind==="carton").map(b=>[b.localId,b.unitId!]));
 const atoms=bindings.map(u=>{const b=u.kind==="carton"?boxes.get(u.localId)!:pallets.get(u.localId)!;
  const children=u.kind==="pallet"&&plan.palletization?plan.placements.filter(b=>b.palletIds?.length===1&&b.palletIds[0]===u.localId).map(b=>cartonIds.get(b.id)!):[];
  return {id:u.unitId!,kind:u.kind,sourceId:u.sourceId,weightKg:b.weight,witness:canonical([u.fingerprint,b.x,b.y,b.z,b.dx,b.dy,b.dz,b.orientation,"orientationSigns" in b?b.orientationSigns:null,"palletIds" in b?b.palletIds:null]),children};});
 return {planId:id.planId,revision:id.revision,revisionId:id.revisionId,signature:id.signature,atoms};
}
export function emptyFieldJournal(plan:PackingResult):FieldJournal{return {format:"cargo-fit-field-events",version:1,context:fieldContext(plan),events:[]};}
export function assertFieldContext(plan:PackingResult,j:FieldJournal){if(!same(fieldContext(plan),j.context))throw fail("现场记录属于其他计划、版本或箱位","Field records belong to another plan, revision or layout");}
export function unitTicket(plan:PackingResult,unitId:string):UnitTicket {const c=fieldContext(plan);if(!c.atoms.some(a=>a.id===unitId))throw fail();return {format:"cargo-fit-unit-v1",planId:c.planId,revision:c.revision,revisionId:c.revisionId,signature:c.signature,unitId};}
export function unitTicketUrl(ticket:UnitTicket,origin:string){const u=new URL(origin);if(!["https:","http:"].includes(u.protocol))throw fail();return `${u.origin}/#unit=${encodeURIComponent(JSON.stringify(ticket))}`;}
export function parseUnitTicket(text:string):UnitTicket {
 if(text.length>4096)throw fail("二维码内容过长","QR payload is too long");
 let raw=text.trim();if(raw.startsWith("http://")||raw.startsWith("https://")){const u=new URL(raw),hash=new URLSearchParams(u.hash.slice(1));raw=hash.get("unit")??"";}else if(raw.startsWith("#unit="))raw=new URLSearchParams(raw.slice(1)).get("unit")??"";
 const v=rec(JSON.parse(raw));if(v.format!=="cargo-fit-unit-v1"||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||Number(v.revision)>1_000_000||typeof v.signature!=="string"||! /^[0-9a-f]{16}$/.test(v.signature))throw fail();return {format:"cargo-fit-unit-v1",planId:token(v.planId),revision:Number(v.revision),revisionId:token(v.revisionId),signature:v.signature,unitId:token(v.unitId)};
}
export function verifyUnitTicket(plan:PackingResult,text:string){const t=parseUnitTicket(text),c=fieldContext(plan);if(t.planId!==c.planId||t.revisionId!==c.revisionId||t.revision!==c.revision||t.signature!==c.signature)throw fail("二维码属于其他或旧交付版本，请恢复对应备份","QR belongs to another or older delivery revision; restore its matching backup");if(!c.atoms.some(a=>a.id===t.unitId))throw fail("二维码单元已不存在","The QR unit no longer exists");return t;}
export function parseFieldJournal(text:string):FieldJournal {
 if(new TextEncoder().encode(text).length>MAX_FIELD_BYTES)throw fail("现场记录超过 50 MB","Field records exceed 50 MB");
 const v=rec(JSON.parse(text)),raw=rec(v.context);if(v.format!=="cargo-fit-field-events"||v.version!==1||!Array.isArray(raw.atoms)||raw.atoms.length>20_200||!Array.isArray(v.events)||v.events.length>50_000||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1||Number(raw.revision)>1_000_000||typeof raw.signature!=="string"||! /^[0-9a-f]{16}$/.test(raw.signature))throw fail();
 const atoms:FieldAtom[]=raw.atoms.map(x=>{const a=rec(x);if(!["carton","pallet"].includes(String(a.kind))||typeof a.weightKg!=="number"||!Number.isFinite(a.weightKg)||a.weightKg<0||!Array.isArray(a.children)||a.children.length>20_000)throw fail();return {id:token(a.id),kind:a.kind as FieldAtom["kind"],sourceId:txt(a.sourceId,300),weightKg:a.weightKg,witness:txt(a.witness,3000),children:a.children.map(token)};});
 const map=new Map(atoms.map(a=>[a.id,a]));if(map.size!==atoms.length||atoms.some(a=>a.kind==="carton"&&a.children.length||new Set(a.children).size!==a.children.length||a.children.some(id=>map.get(id)?.kind!=="carton")))throw fail();
 const context:FieldContext={planId:token(raw.planId),revision:Number(raw.revision),revisionId:token(raw.revisionId),signature:raw.signature,atoms};
 const events:FieldEvent[]=v.events.map(x=>{const e=rec(x);if(!["load","unload","missing","damage","clear","resolve"].includes(String(e.action))||typeof e.at!=="string"||!Number.isFinite(Date.parse(e.at))||new Date(e.at).toISOString()!==e.at||!Array.isArray(e.changes)||e.changes.length>20_200||!Array.isArray(e.photos)||e.photos.length>3)throw fail();
  const changes=e.changes.map(x=>{const r=rec(x);if(!Array.isArray(r.parents)||r.parents.length>50_000)throw fail();const parents=r.parents.map(token);if(new Set(parents).size!==parents.length)throw fail();return {id:token(r.id),parents,state:state(r.state)};});
  const photos=e.photos.map(x=>{const p=rec(x),mime=String(p.mime);if(!["image/png","image/jpeg","image/webp"].includes(mime)||typeof p.dataUrl!=="string"||p.dataUrl.length>1_500_000||!p.dataUrl.startsWith(`data:${mime};base64,`)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.dataUrl.split(",")[1]??"")||!p.dataUrl.split(",")[1])throw fail();return {name:txt(p.name,120),mime:mime as FieldPhoto["mime"],dataUrl:p.dataUrl};});
  const event:FieldEvent={id:token(e.id),at:e.at,deviceId:token(e.deviceId),unitId:token(e.unitId),action:e.action as FieldAction,changes,note:txt(e.note,1000),photos};const affected=new Set(targets(context,event.unitId,event.action));if(changes.length!==affected.size||new Set(changes.map(c=>c.id)).size!==changes.length||changes.some(c=>!affected.has(c.id))||event.action==="resolve"&&!event.note.trim())throw fail();return event;});
 const unique=new Map<string,FieldEvent>();for(const e of events){if(unique.has(e.id)&&!same(unique.get(e.id),e))throw fail("同一事件 ID 内容冲突","Conflicting content for the same event ID");unique.set(e.id,e);}
 const journal:FieldJournal={format:"cargo-fit-field-events",version:1,context,events:[...unique.values()]};analyzeFieldJournal(journal);return journal;
}
export function analyzeFieldJournal(j:FieldJournal) {
 const byId=new Map(j.events.map(e=>[e.id,e])),changes=new Map(j.events.map(e=>[e.id,new Map(e.changes.map(c=>[c.id,c]))]));
 const heads=new Map(j.context.atoms.map(a=>[a.id,new Set<string>()])),deps=new Map<string,Set<string>>(),children=new Map<string,Set<string>>();
 for(const e of j.events){const parents=new Set<string>();for(const c of e.changes){if(!heads.has(c.id))throw fail();heads.get(c.id)!.add(e.id);for(const p of c.parents){if(!byId.has(p)||!changes.get(p)?.has(c.id)||p===e.id)throw fail("事件缺少来源或形成循环","Event ancestry is missing or cyclic");parents.add(p);const list=children.get(p)??new Set();list.add(e.id);children.set(p,list);}
   if(e.action!=="resolve"){if(c.parents.length>1)throw fail("并行冲突须明确解决","Concurrent conflicts require explicit resolution");const before=c.parents.length?changes.get(c.parents[0])!.get(c.id)!.state:initial;if(!same(c.state,applyAction(before,e.action)))throw fail();if((e.action==="unload"||e.action==="missing")&&before.loaded&&!e.note.trim())throw fail("撤回已装确认须填写原因","A reason is required to reverse loaded confirmation");}
  }deps.set(e.id,parents);}
 for(const e of j.events)for(const c of e.changes)for(const p of c.parents)heads.get(c.id)!.delete(p);
 const queue=j.events.filter(e=>!deps.get(e.id)!.size).map(e=>e.id);let visited=0;
 for(let i=0;i<queue.length;i++){visited++;for(const id of children.get(queue[i])??[]){deps.get(id)!.delete(queue[i]);if(!deps.get(id)!.size)queue.push(id);}}
 if(visited!==j.events.length)throw fail("事件形成循环","Cyclic field events");
 return new Map(j.context.atoms.map(a=>{const ids=[...heads.get(a.id)!].sort();return [a.id,{atom:a,heads:ids,state:ids.length===0?{...initial}:ids.length===1?changes.get(ids[0])!.get(a.id)!.state:null,conflict:ids.length>1}];}));
}
export function appendFieldEvent(plan:PackingResult,j:FieldJournal,unitId:string,action:FieldAction,options:{deviceId:string;note?:string;photos?:FieldPhoto[];resolution?:FieldState;id?:string;at?:string}) {
 assertFieldContext(plan,j);const all=analyzeFieldJournal(j),ids=targets(j.context,unitId,action),note=options.note??"",photos=options.photos??[];
 const changes:FieldChange[]=ids.map(id=>{const old=all.get(id)!;if(old.conflict&&action!=="resolve")throw fail("此单元存在并行冲突，请先解决","This unit has concurrent conflicts; resolve them first");if(action==="resolve"&&!note.trim())throw fail("解决冲突须填写原因","A reason is required to resolve a conflict");const next=action==="resolve"?state(options.resolution):applyAction(old.state!,action);if((action==="missing"||action==="unload")&&old.state?.loaded&&!note.trim())throw fail("撤回已装确认须填写原因","A reason is required to reverse loaded confirmation");return {id,parents:old.heads,state:next};});
 if(!note.trim()&&!photos.length&&changes.every(c=>same(c.state,all.get(c.id)!.state)))return {journal:j,duplicate:true};
 const event:FieldEvent={id:options.id??`event-${crypto.randomUUID()}`,at:options.at??new Date().toISOString(),deviceId:options.deviceId,unitId,action,changes,note,photos};
 const journal=parseFieldJournal(JSON.stringify({...j,events:[...j.events,event]}));return {journal,duplicate:false};
}
export function mergeFieldJournals(plan:PackingResult,a:FieldJournal,b:FieldJournal){assertFieldContext(plan,a);assertFieldContext(plan,b);return parseFieldJournal(JSON.stringify({...a,events:[...a.events,...b.events]}));}
export function fieldTotals(plan:PackingResult,j:FieldJournal){assertFieldContext(plan,j);const all=[...analyzeFieldJournal(j).values()],cartons=all.filter(s=>s.atom.kind==="carton");return {cartons:cartons.length,loadedCartons:cartons.filter(s=>s.state?.loaded).length,missingCartons:cartons.filter(s=>s.state?.condition==="missing").length,damagedCartons:cartons.filter(s=>s.state?.condition==="damaged").length,loadedPackaging:all.filter(s=>s.atom.kind==="pallet"&&s.state?.loaded).length,conflicts:all.filter(s=>s.conflict).length,confirmedPlannedKg:all.filter(s=>s.state?.loaded).reduce((n,s)=>n+s.atom.weightKg,0)};}
