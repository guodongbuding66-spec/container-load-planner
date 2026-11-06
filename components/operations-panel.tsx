"use client";
import { useEffect, useRef, useState } from "react";
import { deliveryIdentityState } from "../lib/packing/delivery-identity";
import { orderedAccessories, ACCESSORY_TYPE_TEXT } from "../lib/packing/container-accessories";
import { appendOperation, emptyOperationRecords, MAX_OPERATION_BYTES, mergeOperationRecords, OperationError, operationCsv, operationKey, operationStates, parseOperationRecords, persistOperationRecords, type OperationEvent, type OperationRecords, type OperationState } from "../lib/packing/operations";
import type { PackingResult } from "../lib/packing/types";
import { FieldReadiness } from "./field-readiness";
import { ToolSummary } from "./workflow-tools";
import { tr, useLanguage } from "./language";

type Message=[string,string];
type Props={plan:PackingResult;disabled:boolean;getRecords?:(key:string)=>OperationRecords|undefined;onRecords?:(key:string,records:OperationRecords)=>void};
const labels:Record<OperationState["status"],Message>={pending:["未核对","Pending"],confirmed:["已人工确认","Manually confirmed"],exception:["存在异常","Exception"],reopened:["已撤回，待重查","Reopened"],conflict:["并行记录冲突","Concurrent conflict"],stale:["前置已变，需复核","Prerequisite changed; review needed"]};
const actions:Record<OperationEvent["action"],Message>={confirm:["确认","Confirm"],exception:["异常","Exception"],reopen:["撤回重查","Reopen"]};
const errorMessage=(e:unknown):Message=>e instanceof OperationError?[e.zh,e.en]:["操作失败，当前记录未被替换。请检查文件和必填资料。","Operation failed; current records were retained. Check the file and required evidence."];
function download(name:string,data:string,type="application/json"){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
export function OperationsPanel(props:Props){
  useLanguage();const current=deliveryIdentityState(props.plan)==="current"&&props.plan.validation.valid;
  return <details className="upgrade-panel"><ToolSummary kind="field" title={tr("防潮、唛头与作业核对","Moisture, marks and operation checks")} description={tr("按当前附件依赖核对安装与拆除，保留前置变更和并行冲突。","Check installation and removal against material dependencies; retain prerequisite changes and concurrent conflicts.")}/><div className="upgrade-body">
    <p>{tr("这是人工作业核对，不能代替防潮计算、固定强度或现场安全认证；不模拟叉车动作，不改写已装标记。记录需独立备份，不包含在工作区和现场事件文件内。","These are manual operation checks, not moisture calculations, securing strength or site safety certification. They do not simulate forklift actions or change loaded flags. Back up records separately; workspace and field-event files do not contain them.")}</p>
    {current?<><FieldReadiness key={props.plan.deliveryIdentity!.revisionId} plan={props.plan} disabled={props.disabled}/><OperationsWorkspace key={operationKey(props.plan)} {...props}/></>:<p>{tr("请先登记完整有效的当前交付版本，再登记作业核对。","Issue a complete valid current delivery revision before recording operation checks.")}</p>}
  </div></details>;
}
export function OperationsWorkspace({plan,disabled,getRecords,onRecords}:Props){
  const lang=useLanguage(),key=operationKey(plan),input=useRef<HTMLInputElement>(null);
  const [initial]=useState(()=>{
    let raw:string|null=null;let memory:OperationRecords|undefined;
    try{memory=getRecords?.(key);if(memory)return {records:parseOperationRecords(plan,JSON.stringify(memory)),raw:null,blocked:false,message:["",""] as Message};}catch(e){return {records:emptyOperationRecords(plan),raw:memory?JSON.stringify(memory):null,blocked:true,message:errorMessage(e)};}
    try{raw=localStorage.getItem(key);}catch{return {records:emptyOperationRecords(plan),raw:null,blocked:false,message:["无法读取本机存储；记录仅留在本页，请独立备份。","Local storage is unavailable; records remain on this page only. Save a separate backup."] as Message};}
    try{return {records:raw?parseOperationRecords(plan,raw):emptyOperationRecords(plan),raw:null,blocked:false,message:["",""] as Message};}catch(e){return {records:emptyOperationRecords(plan),raw,blocked:true,message:errorMessage(e)};}
  });
  const [records,setRecords]=useState(initial.records),[message,setMessage]=useState<Message>(initial.message),[phase,setPhase]=useState<"loading"|"unloading">("loading"),[selected,setSelected]=useState("load:inspect"),[operator,setOperator]=useState(""),[note,setNote]=useState(""),[resolve,setResolve]=useState(false),[busy,setBusy]=useState(false),[showBackup,setShowBackup]=useState(false);
  const blocked=initial.blocked,unavailable=disabled||blocked||busy,audit=operationStates(plan,records),items=[...audit.values()],active=audit.get(selected)!,dependencies=active.task.requires.map(id=>audit.get(id)!),ready=dependencies.every(s=>s.status==="confirmed"),conflict=active.status==="conflict",materials=orderedAccessories(plan.container.exclusions??[]);
  useEffect(()=>{if(!blocked)onRecords?.(key,records);},[key,records,blocked,onRecords]);
  function commit(next:OperationRecords){
    let saved=false;try{const result=persistOperationRecords(plan,next,localStorage);next=result.records;saved=result.saved;}catch{/* Retain validated page records even if the storage getter itself is denied. */}
    setRecords(next);onRecords?.(key,next);setResolve(false);
    setMessage(saved?["记录已保存到本机；并行记录已合并，请检查冲突并保存独立备份。","Records saved locally; concurrent records were merged. Review conflicts and save a separate backup."]:["本机存储无法安全写入，记录仍保留本页。请立即下载或复制完整作业备份；切勿覆盖损坏的原记录。","Local storage could not be written safely; records remain on this page. Download or copy a complete operation backup now; preserve damaged originals."]);
  }
  function record(action:OperationEvent["action"]){try{commit(appendOperation(plan,records,selected,action,operator,note,{resolve}));setNote("");}catch(e){setMessage(errorMessage(e));}}
  const status=(s:OperationState)=>tr(...labels[s.status]);
  return <section className="operations-workspace" aria-label={tr("当前版本作业核对","Operation checks for this revision")}>
    <p><strong>{tr("交付版本","Delivery revision")} {plan.deliveryIdentity!.revision}</strong> · {plan.deliveryIdentity!.revisionId}</p>
    <p>{tr("未登记即未核对。前置项被撤回、出现异常或换成新确认后，依赖它的旧确认必须重新复核。装货和到货核对分别登记；不按时间自动覆盖多人记录。","Unrecorded means unchecked. If a prerequisite is reopened, has an exception or receives a new confirmation, dependent old confirmations require review. Loading and arrival checks are independent; timestamps never overwrite concurrent evidence.")}</p>
    <details><summary>{tr("本版本附件与防潮依据","Materials and moisture basis for this revision")} ({materials.length})</summary>
      {materials.length?<ul>{materials.map(z=><li key={z.id}><strong>{z.name}</strong> · {tr(...ACCESSORY_TYPE_TEXT[z.accessory.type])} · {tr("数量","Quantity")} {z.accessory.quantity} · {z.kind==="reserved"?tr("仅预留区域，0 kg；核对区域释放","Reserved space only, 0 kg; check release"):tr("计划重量","Planned mass")+` ${z.accessory.quantity*(z.accessory.unitWeightKg??0)} kg`} · {z.accessory.phase==="before-cargo"?tr("装货前","Before cargo"):tr("装货后","After cargo")}<p>{tr("来源／版次","Source / revision")}: {z.accessory.source||tr("未填写","Not entered")} / {z.accessory.revision||tr("未填写","Not entered")} · {z.accessory.note}</p></li>)}</ul>:<p>{tr("当前方案未配置附件。是否无需防潮措施仍须人工说明依据，不能由零附件自动判定。","No materials are configured. Explain why moisture measures are unnecessary if applicable; zero materials do not establish that conclusion.")}</p>}
      <p>{tr("清单只引用方案中已计入的尺寸、重量和依赖，不重复增加材料。拆除顺序按安装依赖反向列出，是否需要临时支承、何时可拆须由现场依据确认。","The checklist references dimensions, mass and dependencies already in the plan, without adding materials twice. Removal reverses installation dependencies; site instructions must establish temporary support and when removal is permitted.")}</p>
    </details>
    <label>{tr("核对阶段","Check phase")}<select value={phase} onChange={e=>{const value=e.target.value as typeof phase;setPhase(value);setSelected(value==="loading"?"load:inspect":"unload:arrival");setResolve(false);setNote("");}}><option value="loading">{tr("装货与封柜","Loading and closure")}</option><option value="unloading">{tr("到货与卸货","Arrival and unloading")}</option></select></label>
    <ul className="operations-task-list">{items.filter(s=>s.task.phase===phase).map(s=><li key={s.task.id} data-status={s.status}><span>{tr(...s.task.label)}</span><strong>{status(s)}</strong></li>)}</ul>
    <fieldset className="operations-fields" disabled={unavailable}><legend>{tr("人工核对登记","Manual check entry")}</legend>
      <label>{tr("核对项目","Check item")}<select value={selected} onChange={e=>{setSelected(e.target.value);setResolve(false);setNote("");}}>{items.filter(s=>s.task.phase===phase).map(s=><option key={s.task.id} value={s.task.id}>{tr(...s.task.label)}</option>)}</select></label>
      <p>{tr("当前状态","Current status")}: <strong>{status(active)}</strong></p>
      <div><strong>{tr("前置检查","Prerequisite checks")}</strong>{dependencies.length?<ul>{dependencies.map(s=><li key={s.task.id}>{tr(...s.task.label)} · {status(s)}</li>)}</ul>:<p>{tr("无前置项；仍需填写实查说明。","No prerequisite; actual check evidence is still required.")}</p>}</div>
      {!ready&&<p role="alert">{tr("前置项尚未全部确认，可登记异常或撤回，暂不能确认此项。","Prerequisites are not all confirmed. Record an exception or reopen; confirmation is currently blocked.")}</p>}
      <label>{tr("核对人（必填）","Inspector (required)")}<input maxLength={100} value={operator} onChange={e=>setOperator(e.target.value)}/></label>
      <label>{tr("实查说明／来源／封号（必填）","Check evidence / source / seal reference (required)")}<textarea maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      {conflict&&<label className="operations-resolve"><input type="checkbox" checked={resolve} onChange={e=>setResolve(e.target.checked)}/>{tr("我已查看此项全部并行记录，明确复核并合并这些分支。","I reviewed all concurrent records for this task and explicitly resolve these branches.")}</label>}
      <div className="upgrade-actions"><button className="button" disabled={!ready||!operator.trim()||!note.trim()||conflict&&!resolve} onClick={()=>record("confirm")}>{tr("登记确认","Record confirmation")}</button><button className="button" disabled={!operator.trim()||!note.trim()||conflict&&!resolve} onClick={()=>record("exception")}>{tr("登记异常","Record exception")}</button><button className="button" disabled={!operator.trim()||!note.trim()||conflict&&!resolve} onClick={()=>record("reopen")}>{tr("撤回并要求重查","Reopen for review")}</button></div>
    </fieldset>
    <details className="operations-history"><summary>{tr("完整核对历史（含异常、撤回与并行分支）","Full check history (including exceptions, reopens and concurrent branches)")} ({records.events.length})</summary>{records.events.length?<ol>{records.events.map(e=><li key={e.id}><strong>{tr(...audit.get(e.taskId)!.task.label)} · {tr(...actions[e.action])}</strong><p>{e.operator} · <time dateTime={e.at}>{new Date(e.at).toLocaleString(lang)}</time></p><p>{e.note}</p><small>{tr("事件编号","Event ID")}: {e.id} · {tr("承接事件","Parent events")}: {e.parents.join(", ")||"—"}</small></li>)}</ol>:<p>{tr("尚无人工核对记录。","No manual checks recorded.")}</p>}</details>
    <div className="upgrade-actions"><button className="button" disabled={blocked||busy} onClick={()=>{download(`CargoFit_operations_v${records.context.revision}.json`,JSON.stringify(records,null,2));setMessage(["已发起下载，请确认文件保存成功。","Download started; confirm the file was saved."]);}}>{tr("下载完整作业备份","Download complete operation backup")}</button><button className="button" disabled={blocked||busy} onClick={()=>setShowBackup(v=>!v)}>{tr("显示完整作业备份文本","Show complete operation backup text")}</button><button className="button" disabled={blocked||busy||!records.events.length} onClick={()=>download("CargoFit_operations.csv","\ufeff"+operationCsv(plan,records),"text/csv;charset=utf-8")}>{tr("导出作业 CSV","Export operation CSV")}</button><button className="button" disabled={unavailable} onClick={()=>input.current?.click()}>{tr("导入并合并作业备份","Import and merge operation backup")}</button></div>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={async e=>{const file=e.target.files?.[0];e.currentTarget.value="";if(!file)return;setBusy(true);try{if(file.size>MAX_OPERATION_BYTES)throw new OperationError("作业备份超过 2 MB","Operation backup exceeds 2 MB");commit(mergeOperationRecords(plan,records,parseOperationRecords(plan,await file.text())));}catch(e){setMessage(errorMessage(e));}finally{setBusy(false);}}}/>
    {showBackup&&!blocked&&<label>{tr("完整作业备份 JSON","Complete operation backup JSON")}<textarea className="operations-backup" readOnly value={JSON.stringify(records,null,2)}/></label>}
    {blocked&&initial.raw!==null&&<button className="button" onClick={()=>download("CargoFit_unreadable_operations.txt",initial.raw!,"text/plain")}>{tr("下载无法读取的原始作业记录","Download unreadable original operation records")}</button>}
    <p role="status">{tr(...message)}</p>
  </section>;
}
