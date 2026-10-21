"use client";
import {useMemo,useState} from "react";
import {deliveryIdentityState,deliveryUnitBindings,issueDeliveryIdentity} from "../lib/packing/delivery-identity";
import {FieldEventError} from "../lib/packing/field-journal";
import type {PackingResult} from "../lib/packing/types";
import {ToolSummary} from "./workflow-tools";
import {tr,trText,useLanguage} from "./language";

export function DeliveryVersionPanel({plan,disabled,onIssue,backup}:{plan:PackingResult;disabled:boolean;onIssue:(plan:PackingResult)=>void;backup?:string}){
 useLanguage();const [error,setError]=useState(""),[showBackup,setShowBackup]=useState(false);
 const state=useMemo(()=>deliveryIdentityState(plan),[plan]);
 const units=useMemo(()=>deliveryUnitBindings(plan),[plan]);
 const id=plan.deliveryIdentity,blocked=disabled||!plan.validation.valid||plan.metrics.loadedCount!==plan.placements.length||!plan.placements.length;
 const issue=(fork:boolean)=>{try{onIssue(issueDeliveryIdentity(plan,fork));setError("");}catch(e){setError(e instanceof FieldEventError?tr(e.zh,e.en):e instanceof Error?e.message:String(e));}};
 return <details className="upgrade-panel"><ToolSummary kind="report" title={tr("交付版本与箱托编号","Delivery versions and unit IDs")} description={tr("登记、更新和复制交付版本","Issue, revise and copy delivery versions")}/><div className="upgrade-body">
  <p>{tr("登记当前单柜或独立打托方案，并下载含箱位和编号的版本备份。恢复备份保留编号；普通输入草稿不保存交付版本。","Register the current single-vehicle or pallet-only plan and download a version backup with positions and IDs. Restoring that backup preserves IDs; ordinary input drafts do not store delivery versions.")}</p>
  <strong role="status">{state==="unissued"?tr("尚未登记交付版本","No delivery version issued"):state==="current"?tr("当前箱位与登记版本一致","Current positions match the issued version"):tr("方案已变化，需登记下一版","Plan changed; issue the next revision")}</strong>
  {id&&<><div className="tool-form-grid"><label className="field">{tr("交付计划 ID","Delivery plan ID")}<input aria-label={tr("交付计划 ID","Delivery plan ID")} value={id.planId} readOnly/></label><label className="field">{tr("已登记版本","Issued revision")}<input aria-label={tr("已登记版本","Issued revision")} value={id.revision} readOnly/></label></div><p style={{overflowWrap:"anywhere"}}>{tr("交付版本 ID","Delivery revision ID")}: {id.revisionId}</p><p>{tr("登记时间","Issued at")}: {id.issuedAt}</p>{id.forkedFrom&&<p>{tr("复制来源","Copied from")}: {id.forkedFrom.planId} v{id.forkedFrom.revision}</p>}</>}
  <div className="upgrade-actions"><button className="button primary" disabled={blocked||state==="current"} onClick={()=>issue(false)}>{id?tr("发布下一版并下载","Issue next revision and download"):tr("登记并下载版本备份","Issue and download version backup")}</button>{id&&<button className="button" disabled={blocked} onClick={()=>issue(true)}>{tr("复制为新计划并下载","Copy as a new plan and download")}</button>}</div>
  <p>{tr("移动、旋转、转托及局部重排保留可确认的编号；新增箱体使用新编号，移出当前方案的编号记为撤出。整单重算不沿用登记。复制新计划会创建全部新编号，不代表复制了实物。","Movement, rotation, transfers and local repacking retain confirmed IDs. New cartons receive new IDs; removed units are recorded as withdrawn. A full recalculation does not carry registration forward. Copying a new plan creates all-new IDs and does not duplicate physical cargo.")}</p>
  {backup&&<><button className="button" disabled={blocked||state!=="current"} onClick={()=>setShowBackup(v=>!v)}>{tr("显示版本备份文本","Show version backup text")}</button>{showBackup&&state==="current"&&<label className="field">{tr("下载失败时，可复制全部文本保存为 .json，再用恢复工作区导入。","If downloading fails, copy all text into a .json file and use Restore workspace.")}<textarea aria-label={tr("完整版本备份文本","Complete version backup text")} readOnly spellCheck={false} rows={8} value={backup}/></label>}</>}
  <p>{tr("登记是计划编号，未确认制作、实装或运输安全；现场扫描与事件在下方面板登记；多柜贯通身份仍待实现。请保留下载文件，修改后重新登记并向现场提供新版本。","Registration identifies a plan; it does not confirm manufacture, actual loading or transport safety. Use the field panel below for scanning and events; cross-vehicle identity remains future work. Keep the download and issue updated instructions after changes.")}</p>
  {id&&<><p>{tr("登记单元","Registered units")}: {id.units.length} · {tr("已撤出编号","Withdrawn IDs")}: {id.withdrawn.length}</p><div className="upgrade-table-wrap"><table><thead><tr><th>{tr("类型","Kind")}</th><th>{tr("当前局部编号／源行","Current local ID / source row")}</th><th>{tr("实物登记 ID","Unit registry ID")}</th></tr></thead><tbody>{units.slice(0,50).map(u=><tr key={`${u.kind}/${u.localId}`}><td>{u.kind==="carton"?tr("箱","Carton"):tr("托／包装","Pallet / packaging")}</td><td style={{whiteSpace:"normal",overflowWrap:"anywhere"}}>{u.localId}<br/>{u.sourceId}</td><td style={{whiteSpace:"normal",overflowWrap:"anywhere"}}>{u.unitId??tr("下一版分配","Assigned on next issue")}</td></tr>)}</tbody></table></div>{units.length>50&&<p>{tr("显示前 50 条；备份及坐标 CSV 包含全部记录。","Showing the first 50; backup and coordinate CSV contain all records.")}</p>}</>}
  <p role="alert">{trText(error)}</p>
 </div></details>;
}
