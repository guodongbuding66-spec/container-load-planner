"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {prepareEconomicTailTrial,reviewEconomicTailTrial,buildEconomicTailCsv,type EconomicTailReport} from "../lib/packing/tail-economy";
import type {TailReportInput,TailComparisonRow} from "../lib/packing/pallet-tail-report";
import type {TailCostQuote} from "../lib/packing/tail-cost-quote";
import {tr,useLanguage} from "./language";

type Props={sourceKey:string;quote:TailCostQuote;enabled:boolean;canApply:boolean;getInput:()=>TailReportInput|undefined;onAdopt?:(row:TailComparisonRow)=>boolean};
export function useTailEconomicPreview({sourceKey,quote,enabled,canApply,getInput,onAdopt}:Props){
 const key=JSON.stringify([sourceKey,quote,enabled,canApply]),identity=useMemo(()=>({key}),[key]),latest=useRef<typeof identity|null>(identity),worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const generation=useRef(0);
 const [state,setState]=useState<{identity:typeof identity;generation:number;status:"running"|"done"|"error"|"cancelled"|"timeout";report?:EconomicTailReport}|null>(null);
 const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
 useLayoutEffect(()=>{latest.current=identity;return()=>{latest.current=null;worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);};},[identity]);
 const current=state?.identity===identity?state:null,running=current?.status==="running",observedGeneration=state?.generation??0;
 const run=()=>{
  if(!enabled||running||latest.current!==identity||observedGeneration!==generation.current)return;stop();const revision=++generation.current;
  try{
   const input=getInput();if(!input)throw Error("Stale tail batch");
   const prepared=prepareEconomicTailTrial(input,quote),w=new Worker(new URL("../lib/packing/pallet-tail.worker.ts",import.meta.url),{type:"module"});worker.current=w;
   setState({identity,generation:revision,status:"running"});const active=()=>latest.current===identity&&worker.current===w&&generation.current===revision;
   timer.current=setTimeout(()=>{if(!active())return;stop();setState({identity,generation:revision,status:"timeout"});},30000);
   w.onmessage=e=>{
    if(!active())return;
    try{if(e.data.index!==0||e.data.error)throw Error("Economic recheck failed");const report=reviewEconomicTailTrial(prepared,e.data.plan);stop();setState({identity,generation:revision,status:"done",report});}
    catch{stop();setState({identity,generation:revision,status:"error"});}
   };
   w.onerror=()=>{if(!active())return;stop();setState({identity,generation:revision,status:"error"});};
   w.postMessage({trials:[prepared.trial]});
  }catch{stop();setState({identity,generation:revision,status:"error"});}
 };
 const cancel=()=>{if(latest.current!==identity||!running||observedGeneration!==generation.current)return;stop();setState({identity,generation:++generation.current,status:"cancelled"});};
 const getReport=()=>latest.current===identity&&enabled&&current?.generation===generation.current&&current.status==="done"?current.report:undefined;
 const adopt=()=>{
  const report=getReport();if(!report||!canApply||!onAdopt)return false;
  try{const input=getInput();if(!input)return false;const prepared=prepareEconomicTailTrial(input,quote);if(prepared.allocation!==report.economicCandidate.allocation||prepared.economicTotal!==report.economicCandidate.configuredTotal||prepared.quantityTotal!==report.quantityCandidate.configuredTotal)return false;return onAdopt(input.rows[prepared.rowIndex]);}catch{return false;}
 };
 return {current,running,run,cancel,adopt,getReport};
}

export function TailEconomicPreview(props:Props){
 const task=useTailEconomicPreview(props),language=useLanguage(),[failed,setFailed]=useState(false),report=task.current?.report;
 const download=(format:"json"|"csv")=>{setFailed(false);try{const report=task.getReport();if(!report)return;const text=format==="json"?JSON.stringify(report,null,2):buildEconomicTailCsv(report,language==="en"),url=URL.createObjectURL(new Blob([text],{type:format==="json"?"application/json;charset=utf-8":"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=`tail-economic-${report.engineVersion}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setFailed(true);}};
 return <section className="tail-economic-preview tabular-nums" aria-label={tr("同量经济尾数预览","Economic tail preview for equal delivery")}>
  <h4 className="text-balance">{tr("自动选择同量经济尾数","Choose economic tails for equal delivery")}</h4>
  <p className="helper-text text-pretty">{tr("保持数量优先候选的每个源订单行已装数量，从当前完整批次的同量候选中自动选择最低配置费用，再独立复算。费用并列时保留当前候选，否则优先较少新增散箱预留。","Keep every source row's loaded quantity from the quantity-first candidate, choose the lowest configured cost in this complete batch, then independently recalculate. Keep the current candidate on a cost tie; otherwise prefer fewer added loose reservations.")}</p>
  <div className="upgrade-actions"><button type="button" className="button" disabled={!props.enabled||task.running} onClick={()=>{setFailed(false);task.run();}}>{tr("预览同量最低费用候选","Preview lowest-cost equal-delivery candidate")}</button>{task.running&&<button type="button" className="button" onClick={task.cancel}>{tr("停止经济候选复核","Stop economic candidate recheck")}</button>}</div>
  {!props.enabled&&<p role="status">{tr("先完成至少两个同量候选的全部报价与用量复核。","First complete quotes and usage review for at least two equal-delivery candidates.")}</p>}
  {task.current&&<p role="status">{task.running?tr("正在独立复算经济候选，原方案保持。","Independently recalculating the economic candidate; the original plan is retained."):task.current.status==="done"?tr("经济候选复核完成，尚未采用。","Economic candidate recheck complete; not applied."):task.current.status==="timeout"?tr("30 秒复核预算已结束，经济预览不可采用。","The 30-second recheck budget expired; the economic preview cannot be applied."):task.current.status==="cancelled"?tr("经济复核已停止，原方案保持。","Economic recheck stopped; the original plan is retained."):tr("经济复核未通过，请重新运行当前试算并核对报价。","Economic recheck failed; rerun the current trial and review quotes.")}</p>}
  {report&&<>
   <p><strong>{tr("各源订单行已装数量一致","Every source row retains identical loaded quantities")}</strong> · {report.costReport.comparison.after.loaded} {tr("箱","cartons")} · {report.comparableCount} {tr("个可比候选","comparable candidates")}</p>
   <div className="upgrade-table-wrap" tabIndex={0} role="region" aria-label={tr("经济尾数复核结果","Economic tail recheck results")}><table><thead><tr><th>{tr("候选","Candidate")}</th><th>{tr("配置费用合计","Configured total")}</th><th>{tr("实际包装","Actual packaging")}</th><th>{tr("实际散箱","Actual loose cartons")}</th></tr></thead><tbody>
    <tr><th>{tr("数量优先候选","Quantity-first candidate")}</th><td>{report.quantityCandidate.configuredTotal.toFixed(2)} {report.currency}</td><td>{report.quantityCandidate.pallets}</td><td>{report.quantityCandidate.loose}</td></tr>
    <tr><th>{tr("同量经济候选","Equal-delivery economic candidate")}</th><td>{report.economicCandidate.configuredTotal.toFixed(2)} {report.currency}</td><td>{report.costReport.comparison.after.pallets}</td><td>{report.costReport.comparison.after.loose}</td></tr>
   </tbody></table></div>
   <p><strong>{tr("配置费用节省","Configured savings")}: {report.savings.toFixed(2)} {report.currency}</strong> · {report.savings===0?tr("当前候选已是本批次同量最低（含并列）。","The current candidate already has the batch's lowest equal-delivery cost, including ties."):tr("数量不变，包装与散箱配额按复算预览调整。","Delivery quantities are unchanged; packaging and loose quotas follow the recalculated preview.")}</p>
   <div className="upgrade-actions"><button type="button" className="button primary" disabled={!props.canApply||!props.onAdopt} onClick={()=>setFailed(!task.adopt())}>{tr("采用经济配额并重新计算","Apply economic allocation and recalculate")}</button><button type="button" className="button" onClick={()=>download("json")}>{tr("下载经济尾数 JSON","Download economic tail JSON")}</button><button type="button" className="button" onClick={()=>download("csv")}>{tr("下载经济尾数 CSV","Download economic tail CSV")}</button></div>
  </>}
  <small>{tr("仅限当前已评估批次与已配置报价；未配置费用、余货后续运费和税费不在范围内。修改报价或试算输入后须重新预览，正式结果以采用后的重新计算为准。","Limited to this evaluated batch and configured quotes. Unconfigured costs, later freight for remaining cargo and taxes are outside scope. Quote or trial-input changes require a new preview; the recalculated applied plan is authoritative.")}</small>
  {failed&&<p role="alert">{tr("经济预览已失效或导出失败，请重新预览。","The economic preview is stale or export failed; preview again.")}</p>}
 </section>;
}
