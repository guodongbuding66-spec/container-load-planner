"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {adoptFleetTail,buildFleetTailCsv,finishFleetTail,fleetTailGroups,prepareFleetTail,reviewFleetTailCandidate,type FleetSnapshot,type FleetTailReport} from "../lib/packing/fleet-tail";
import type {FleetResult} from "../lib/packing/fleet";
import {NumericInput} from "./numeric-input";
import {tr,useLanguage} from "./language";

type Props={value:FleetSnapshot;sourceKey:string;enabled:boolean;canApply:boolean;onApply?:(value:FleetSnapshot)=>boolean};
type TaskProps=Props&{groupId:string;limit:number};
export function useFleetTailPreview({value,sourceKey,enabled,canApply,onApply,groupId,limit}:TaskProps){
 const key=JSON.stringify([value,sourceKey,enabled,canApply,groupId,limit]),identity=useMemo(()=>({key}),[key]),latest=useRef<typeof identity|null>(identity),generation=useRef(0),worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [state,setState]=useState<{identity:typeof identity;generation:number;status:"running"|"done"|"error"|"cancelled"|"timeout";completed:number;total:number;report?:FleetTailReport}|null>(null);
 const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
 useLayoutEffect(()=>{latest.current=identity;return()=>{latest.current=null;worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);};},[identity]);
 const current=state?.identity===identity?state:null,running=current?.status==="running",observedGeneration=state?.generation??0;
 const run=()=>{
  if(!enabled||running||latest.current!==identity||observedGeneration!==generation.current)return;
  stop();const revision=++generation.current;
  try{
   const prepared=prepareFleetTail(value,groupId,limit),results:FleetResult[]=[],w=new Worker(new URL("../lib/packing/fleet-tail.worker.ts",import.meta.url),{type:"module"});worker.current=w;
   setState({identity,generation:revision,status:"running",completed:0,total:prepared.trials.length});
   const active=()=>latest.current===identity&&worker.current===w&&generation.current===revision;
   const fail=(status:"error"|"timeout")=>{if(!active())return;stop();setState({identity,generation:revision,status,completed:results.length,total:prepared.trials.length});};
   timer.current=setTimeout(()=>fail("timeout"),30000);
   w.onmessage=e=>{
    if(!active())return;
    try{
     if(e.data.error||e.data.index!==results.length)throw Error("Invalid fleet trial reply");
     reviewFleetTailCandidate(prepared,e.data.index,e.data.result);results.push(e.data.result);
     if(results.length===prepared.trials.length){const report=finishFleetTail(prepared,results);stop();setState({identity,generation:revision,status:"done",completed:results.length,total:results.length,report});}
     else setState({identity,generation:revision,status:"running",completed:results.length,total:prepared.trials.length});
    }catch{fail("error");}
   };
   w.onerror=()=>fail("error");w.postMessage({trials:prepared.trials});
  }catch{stop();setState({identity,generation:revision,status:"error",completed:0,total:0});}
 };
 const cancel=()=>{if(latest.current!==identity||!running||observedGeneration!==generation.current)return;stop();setState({identity,generation:++generation.current,status:"cancelled",completed:current?.completed??0,total:current?.total??0});};
 const getReport=()=>latest.current===identity&&enabled&&current?.generation===generation.current&&current.status==="done"?current.report:undefined;
 const apply=()=>{const report=getReport();if(!report||!canApply||!onApply)return false;try{return onApply(adoptFleetTail(prepareFleetTail(value,groupId,limit),report));}catch{return false;}};
 return {current,running,run,cancel,getReport,apply};
}

export function FleetTailPreview(props:Props){
 const language=useLanguage(),groups=fleetTailGroups(props.value.request),[groupId,setGroupId]=useState(()=>groups[0]?.id??""),group=groups.find(g=>g.id===groupId),[limit,setLimit]=useState(()=>Math.min(8,groups[0]?.availableUnits??1)),[valid,setValid]=useState(true),[failed,setFailed]=useState(false);
 const task=useFleetTailPreview({...props,enabled:props.enabled&&valid&&!!group,groupId,limit}),report=task.current?.report;
 const download=(format:"json"|"csv")=>{try{const r=task.getReport();if(!r)return;const text=format==="json"?JSON.stringify(r,null,2):buildFleetTailCsv(r,language==="en"),url=URL.createObjectURL(new Blob([text],{type:format==="json"?"application/json;charset=utf-8":"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=`fleet-tail-${r.engineVersion}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setFailed(false);}catch{setFailed(true);}};
 return <section aria-label={tr("整单多柜尾数试算","Whole-fleet tail trial")} className="tail-economic-preview tabular-nums">
  <h4>{tr("整单共享库存尾数试算","Fleet tails with shared stock")}</h4>
  <p className="helper-text">{tr("保持原订单和托盘库存，增加一个订单行或完整套装的全单散箱配额，重新分配整张订单。先保证每个源行已装数量不减少，再按当前柜数／费用目标选择。","Keep the order and packaging stock, increase the global loose quota for one row or whole kit, and reallocate the entire order. Retain every source row's loaded quantity before ranking by the current container-count or cost objective.")}</p>
  <div className="upgrade-actions"><label>{tr("尾数订单行／套装","Tail row / kit")}<select aria-label={tr("多柜尾数订单行或套装","Fleet tail row or kit")} value={groupId} disabled={task.running} onChange={e=>{setGroupId(e.target.value);setLimit(Math.min(8,groups.find(g=>g.id===e.target.value)?.availableUnits??1));setValid(true);setFailed(false);}}>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>{tr("新增散箱上限（套／箱单位）","Additional loose ceiling (kits / cartons)")}<NumericInput ariaLabel={tr("多柜新增散箱单位上限","Fleet additional loose unit ceiling")} integer min={1} max={group?.availableUnits??1} value={limit} onValueChange={setLimit} onValidityChange={setValid}/></label><button type="button" className="button" disabled={!props.enabled||!valid||!group||task.running} onClick={()=>{setFailed(false);task.run();}}>{tr("预览整单尾数分配","Preview fleet tail allocation")}</button>{task.running&&<button type="button" className="button" onClick={task.cancel}>{tr("停止多柜尾数试算","Stop fleet tail trial")}</button>}</div>
  <small>{tr("试算 1、2、4、8 及所设上限（最多五个候选），全单新增散箱最多 64 箱、原单最多 4000 箱／10 柜，批次预算 30 秒。已有配额保持为下限；不拆已交付、锁定或实测单元。","Try 1, 2, 4, 8 and the selected ceiling, up to five candidates. Limits: 64 additional loose cartons, 4000 order cartons, 10 containers and 30 seconds per batch. Existing quotas remain a floor; issued, locked or measured units cannot be rebuilt.")}</small>
  {!props.enabled&&<p role="status">{tr("请先完成当前设置的整单分配；修改费用、库存或目标后须重新分配。","Complete allocation for the current settings first; reallocate after changing quotes, stock or objectives.")}</p>}
  {task.current&&<p role="status">{task.running?tr("正在逐候选复核，原订单和正式方案保持。","Reviewing candidates; the order and formal schedule are retained."):task.current.status==="done"?report?.best?tr("试算完成，候选尚未采用。","Trial complete; candidate not applied."):tr("本批次没有找到逐行不减量且改善目标的候选。","This batch found no candidate that retains every row and improves the objective."):task.current.status==="timeout"?tr("30 秒预算已结束，部分结果不能采用。","The 30-second budget expired; partial results cannot be applied."):task.current.status==="cancelled"?tr("已停止试算，正式方案保持。","Trial stopped; the formal schedule is retained."):tr("整单试算未通过，请检查报价、锁定、实测和数量后重新运行。","Fleet trial failed; check quotes, locks, measurements and quantities, then rerun.")} {task.current.completed} / {task.current.total}</p>}
  {report&&<><div className="upgrade-table-wrap" tabIndex={0} role="region" aria-label={tr("多柜尾数候选比较","Fleet tail candidate comparison")}><table><thead><tr>{[tr("新增单位","Added units"),tr("柜数","Containers"),tr("已装／余货箱","Loaded / remaining"),tr("实际包装／散箱","Packaging / loose"),tr("配置费用","Configured cost"),tr("逐行不减量","Retains every row"),tr("改善目标","Improves objective")].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody><tr><th>{tr("原整单","Baseline fleet")}</th><td>{props.value.result.loads.length}</td><td>{props.value.result.loads.reduce((n,l)=>n+l.plan.metrics.loadedCount,0)} / {props.value.result.remaining.reduce((n,p)=>n+p.quantity,0)}</td><td>{props.value.result.inventory?.totalUsed??0} / {props.value.result.inventory?.loose.reduce((n,p)=>n+p.used,0)??0}</td><td>{props.value.result.costs?.total??tr("未完整报价","Incomplete quote")}</td><td>—</td><td>—</td></tr>{report.candidates.map((c,i)=><tr key={i}><th>{c.units}{report.bestIndex===i?tr(" · 选中"," · Selected"):""}</th><td>{c.containers}</td><td>{c.loaded} / {c.remaining}</td><td>{c.packaging} / {c.loose}</td><td>{c.configuredTotal??tr("未完整报价","Incomplete quote")}</td><td>{c.retainsRows?tr("通过","Pass"):tr("未通过","Fail")}</td><td>{c.improves?tr("是","Yes"):tr("否","No")}</td></tr>)}</tbody></table></div>
   {report.best&&<div className="upgrade-table-wrap" tabIndex={0} role="region" aria-label={tr("选中多柜候选逐行数量","Selected fleet candidate source rows")}><table><thead><tr>{[tr("源订单行","Source row"),tr("原需求","Requested"),tr("原已装","Before"),tr("候选已装","After"),tr("全单配额","Global quota"),tr("散箱／托内","Loose / palletized")].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{report.candidates[report.bestIndex!].rows.map(r=><tr key={r.id}><th>{r.label}<small> · {r.id}</small></th><td>{r.requested}</td><td>{r.before}</td><td>{r.loaded}</td><td>{r.reserved}</td><td>{r.loose} / {r.palletized}</td></tr>)}</tbody></table></div>}
   <div className="upgrade-actions"><button type="button" className="button primary" disabled={!report.best||!props.canApply||!props.onApply} onClick={()=>setFailed(!task.apply())}>{tr("采用整单尾数并更新工作区","Apply fleet tails and update workspace")}</button><button type="button" className="button" onClick={()=>download("json")}>{tr("下载多柜尾数 JSON","Download fleet tail JSON")}</button><button type="button" className="button" onClick={()=>download("csv")}>{tr("下载多柜尾数 CSV","Download fleet tail CSV")}</button></div></>}
  <small>{tr("仅比较当前有限候选及已配置费用；采用会更新全单散箱配额，保留已复核多柜方案，并重算主柜。多柜方案请另存多柜备份；工作区备份保存输入与主柜。更广跨组搜索、拆托重打费用与全局最优仍待完成。","Comparison covers this bounded batch and configured quotes. Applying updates the global loose quota, retains the reviewed fleet and recalculates the main container. Save a fleet backup for all containers; a workspace backup contains inputs and the main container. Broader multi-group search, dismantling costs and global optimality remain open.")}</small>
  {failed&&<p role="alert">{tr("试算已失效或导出失败，请重新预览。","The trial is stale or export failed; preview again.")}</p>}
 </section>;
}
