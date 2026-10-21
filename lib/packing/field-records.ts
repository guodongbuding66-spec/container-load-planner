import {analyzeFieldJournal,assertFieldContext,emptyFieldJournal,fieldContext,FieldEventError,MAX_FIELD_BYTES,mergeFieldJournals,parseFieldJournal,type FieldAtom,type FieldJournal} from "./field-journal";
import {revisePackingResult} from "./engine";
import type {DeliveryIdentity} from "./delivery-identity";
import type {PackingResult,ProductInput} from "./types";

export type FieldHandover={id:string;fromRevisionId:string;toRevisionId:string;at:string;deviceId:string;reason:string;carries:{unitId:string;sourceHeads:string[];eventId:string}[]};
export type FieldRecords={format:"cargo-fit-field-records";version:1;current:FieldJournal;history:FieldJournal[];handovers:FieldHandover[]};
const fail=(zh:string,en:string)=>new FieldEventError(zh,en);
const invalid=()=>fail("现场版本迁移文件或来源关系无效","Invalid field handover or provenance");
const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical)}]`:v&&typeof v==="object"?`{${Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`:JSON.stringify(v);
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw invalid();return v as Record<string,unknown>;};
const text=(v:unknown,max:number)=>{if(typeof v!=="string"||!v.trim()||v.length>max)throw invalid();return v;};
const token=(v:unknown)=>{const t=text(v,120);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(t)||["__proto__","constructor","prototype"].includes(t))throw invalid();return t;};
const iso=(v:unknown)=>{const s=text(v,40);if(!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)throw invalid();return s;};
export const fieldRecordsKey=(id:Pick<DeliveryIdentity,"planId"|"revisionId">)=>`cargo-fit-records-v1/${id.planId}/${id.revisionId}`;
export const legacyFieldJournalKey=(id:Pick<DeliveryIdentity,"planId"|"revisionId">)=>`cargo-fit-events-v1/${id.planId}/${id.revisionId}`;
export const recordsFromJournal=(current:FieldJournal):FieldRecords=>({format:"cargo-fit-field-records",version:1,current,history:[],handovers:[]});
export const emptyFieldRecords=(plan:PackingResult)=>recordsFromJournal(emptyFieldJournal(plan));
const substantive=(s:{loaded:boolean;condition:string})=>s.loaded||s.condition!=="none";
function matchingUnit(a:FieldAtom,b:FieldAtom){
 // v0.50 witnesses are opaque canonical strings, including empty optional slots.
 const left=/^\["([0-9a-f]{16})",/.exec(a.witness)?.[1],right=/^\["([0-9a-f]{16})",/.exec(b.witness)?.[1];
 return !!left&&left===right&&a.kind===b.kind&&a.sourceId===b.sourceId&&a.weightKg===b.weightKg;
}
function checkLoaded(source:FieldJournal,target:FieldJournal["context"]){
 const previous=analyzeFieldJournal(source),next=new Map(target.atoms.map(a=>[a.id,a]));
 for(const [id,s] of previous){if(s.conflict)throw fail("请先处理上一版的并行冲突","Resolve conflicts in the previous revision first");if(s.state?.loaded){const a=next.get(id);if(!a||!matchingUnit(s.atom,a)||s.atom.witness!==a.witness||!equal([...s.atom.children].sort(),[...a.children].sort()))throw fail(`已装单元 ${id} 的箱位、规格或组成已变化，请先在原版本记录撤回并说明原因`,`Loaded unit ${id} changed position, specification or contents; reverse its confirmation with a reason in the original revision first`);}}
 return previous;
}
/** Checks the candidate after explicit issue, before publishing or downloading it. */
export function assertLoadedUnitsUnchanged(source:FieldJournal,candidate:PackingResult){
 const target=fieldContext(candidate);if(source.context.planId!==target.planId)throw invalid();checkLoaded(source,target);
}
function validateHandover(source:FieldJournal,target:FieldJournal,h:FieldHandover){
 if(source.context.planId!==target.context.planId||target.context.revision!==source.context.revision+1||h.fromRevisionId!==source.context.revisionId||h.toRevisionId!==target.context.revisionId)throw invalid();
 const states=checkLoaded(source,target.context),targets=new Map(target.context.atoms.map(a=>[a.id,a])),events=new Map(target.events.map(e=>[e.id,e]));
 const expected=[...states.values()].filter(s=>substantive(s.state!));if(h.carries.length!==expected.length||new Set(h.carries.map(c=>c.unitId)).size!==h.carries.length||new Set(h.carries.map(c=>c.eventId)).size!==h.carries.length)throw invalid();
 const carries=new Map(h.carries.map(c=>[c.unitId,c]));
 for(const s of expected){const c=carries.get(s.atom.id),atom=targets.get(s.atom.id);if(!c||!atom||!matchingUnit(s.atom,atom)||!equal(c.sourceHeads,s.heads))throw invalid();const e=events.get(c.eventId);if(!e||e.action!=="resolve"||e.unitId!==s.atom.id||e.at!==h.at||e.deviceId!==h.deviceId||e.note!==h.reason||e.photos.length||e.changes.length!==1||e.changes[0].id!==s.atom.id||e.changes[0].parents.length||!equal(e.changes[0].state,s.state))throw invalid();}
}
export function parseFieldRecords(contents:string):FieldRecords{
 if(new TextEncoder().encode(contents).length>MAX_FIELD_BYTES)throw fail("完整现场记录超过 50 MB","Complete field records exceed 50 MB");
 const v=object(JSON.parse(contents));if(v.format==="cargo-fit-field-events")return recordsFromJournal(parseFieldJournal(contents));
 if(v.format!=="cargo-fit-field-records"||v.version!==1||!Array.isArray(v.history)||v.history.length>8||!Array.isArray(v.handovers)||v.handovers.length!==v.history.length)throw invalid();
 const current=parseFieldJournal(JSON.stringify(v.current)),history=v.history.map(j=>parseFieldJournal(JSON.stringify(j)));
 const handovers:FieldHandover[]=v.handovers.map(x=>{const h=object(x);if(!Array.isArray(h.carries)||h.carries.length>20_200)throw invalid();return {id:token(h.id),fromRevisionId:token(h.fromRevisionId),toRevisionId:token(h.toRevisionId),at:iso(h.at),deviceId:token(h.deviceId),reason:text(h.reason,1000),carries:h.carries.map(x=>{const c=object(x);if(!Array.isArray(c.sourceHeads)||c.sourceHeads.length>50_000)throw invalid();return {unitId:token(c.unitId),sourceHeads:c.sourceHeads.map(token),eventId:token(c.eventId)};})};});
 const chain=[...history,current];if(new Set(chain.map(j=>j.context.revisionId)).size!==chain.length||new Set(handovers.map(h=>h.id)).size!==handovers.length)throw invalid();
 for(let i=0;i<handovers.length;i++)validateHandover(chain[i],chain[i+1],handovers[i]);
 return {format:"cargo-fit-field-records",version:1,current,history,handovers};
}
export function assertFieldRecordsContext(plan:PackingResult,records:FieldRecords){
 assertFieldContext(plan,records.current);const h=records.handovers.at(-1);if(h&&plan.deliveryIdentity!.previousRevisionId!==h.fromRevisionId)throw invalid();
}
export function readVersionFieldRecords(id:DeliveryIdentity,storage:Pick<Storage,"getItem">){
 const raw=storage.getItem(fieldRecordsKey(id))??storage.getItem(legacyFieldJournalKey(id));if(raw===null)return null;
 const records=parseFieldRecords(raw),c=records.current.context;if(c.planId!==id.planId||c.revisionId!==id.revisionId||c.revision!==id.revision||c.signature!==id.signature)throw invalid();return records;
}
/** Migrations retain complete old event/photo history and never overwrite target events. */
export function migrateFieldRecords(plan:PackingResult,previous:FieldRecords,current:FieldRecords,options:{reason:string;deviceId:string;at?:string;id?:string}):FieldRecords{
 assertFieldRecordsContext(plan,current);if(current.history.length||current.handovers.length)throw fail("此版本已有迁移来源，请使用同版本文件合并","This revision already has handover provenance; merge same-revision files instead");
 const identity=plan.deliveryIdentity!,source=previous.current,target=current.current.context;
 if(identity.planId!==source.context.planId||identity.previousRevisionId!==source.context.revisionId||identity.revision!==source.context.revision+1)throw fail("只能从同一计划的直接上一版迁移，不能跨计划或跳过版本","Handover requires the direct previous revision of the same plan; copying or skipping revisions is not allowed");
 if(previous.history.length>=8)throw fail("现场迁移历史已达 8 次上限，请保留完整档案另行管理","Field history reached the 8-handover limit; retain the full archive for separate management");
 const states=checkLoaded(source,target),nextAtoms=new Map(target.atoms.map(a=>[a.id,a])),reason=text(options.reason,1000),at=iso(options.at??new Date().toISOString()),deviceId=token(options.deviceId),events=[...current.current.events],carries:FieldHandover["carries"]=[];
 for(const s of states.values()){if(!substantive(s.state!))continue;const atom=nextAtoms.get(s.atom.id);if(!atom||!matchingUnit(s.atom,atom))throw fail(`带现场状态的单元 ${s.atom.id} 已撤出或规格变化，不能静默丢弃原记录`,`Unit ${s.atom.id} with field status was removed or changed; its records cannot be silently discarded`);const eventId=`event-${crypto.randomUUID()}`;events.push({id:eventId,at,deviceId,unitId:s.atom.id,action:"resolve",changes:[{id:s.atom.id,parents:[],state:{...s.state!}}],note:reason,photos:[]});carries.push({unitId:s.atom.id,sourceHeads:s.heads,eventId});}
 const h:FieldHandover={id:token(options.id??`handover-${crypto.randomUUID()}`),fromRevisionId:source.context.revisionId,toRevisionId:target.revisionId,at,deviceId,reason,carries};
 const result=parseFieldRecords(JSON.stringify({format:"cargo-fit-field-records",version:1,current:{...current.current,events},history:[...previous.history,source],handovers:[...previous.handovers,h]}));assertFieldRecordsContext(plan,result);return result;
}
export function mergeFieldRecords(plan:PackingResult,a:FieldRecords,b:FieldRecords){
 assertFieldRecordsContext(plan,a);assertFieldRecordsContext(plan,b);
 const normalizedHistory=(r:FieldRecords)=>r.history.map(j=>({...j,events:[...j.events].sort((a,b)=>a.id.localeCompare(b.id))}));
 if(!equal(normalizedHistory(a),normalizedHistory(b))||!equal(a.handovers,b.handovers))throw fail("迁移来源历史不同，不能自动合并；请先使用同一份迁移备份","Handover provenance differs and cannot be merged automatically; start from the same handover backup");
 return parseFieldRecords(JSON.stringify({...a,current:mergeFieldJournals(plan,a.current,b.current)}));
}
export function lockLoadedFieldPositions(plan:PackingResult,records:FieldRecords,products:readonly ProductInput[]):PackingResult{
 assertFieldRecordsContext(plan,records);const states=analyzeFieldJournal(records.current);if([...states.values()].some(s=>s.conflict))throw fail("请先处理现场冲突，再锁定箱位","Resolve field conflicts before locking positions");
 const loaded=[...states.values()].filter(s=>s.state?.loaded);if(!loaded.length)throw fail("尚无已装确认","No loaded confirmations yet");
 const bindings=new Map(plan.deliveryIdentity!.units.map(u=>[u.unitId,u])),cartons=new Set(loaded.filter(s=>s.atom.kind==="carton").map(s=>bindings.get(s.atom.id)!.localId)),pallets=new Set(loaded.filter(s=>s.atom.kind==="pallet").map(s=>bindings.get(s.atom.id)!.localId));
 if(plan.palletization)for(const box of plan.placements)if(cartons.has(box.id))for(const id of box.palletIds??[])pallets.add(id);
 const boxes=plan.placements.map(b=>cartons.has(b.id)||plan.palletization&&b.palletIds?.some(id=>pallets.has(id))?{...b,locked:true}:b);
 const bases=plan.palletization?(plan.pallets??[]).map(p=>pallets.has(p.id)?{...p,locked:true}:p):plan.pallets??[];
 return revisePackingResult(plan,boxes,[...products],bases);
}
