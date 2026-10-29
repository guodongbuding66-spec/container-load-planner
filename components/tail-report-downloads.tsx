"use client";
import {useState} from "react";
import {buildTailTrialCsv,type TailTrialReport} from "../lib/packing/pallet-tail-report";
import {tr,useLanguage} from "./language";

export function TailReportDownloads({enabled,hasCandidate,getReport}:{enabled:boolean;hasCandidate:boolean;getReport:()=>TailTrialReport|undefined}){
 const language=useLanguage(),[failed,setFailed]=useState(false);
 const download=(format:"json"|"csv")=>{setFailed(false);try{const report=getReport();if(!report)return;const text=format==="json"?JSON.stringify(report,null,2):buildTailTrialCsv(report,language==="en"),url=URL.createObjectURL(new Blob([text],{type:format==="json"?"application/json;charset=utf-8":"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=`tail-trial-${report.engineVersion}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setFailed(true);}};
 return <div className="tail-report-downloads"><div className="upgrade-actions"><button type="button" className="button" disabled={!enabled} onClick={()=>download("json")}>{tr("下载试算报告 JSON","Download trial report JSON")}</button><button type="button" className="button" disabled={!enabled||!hasCandidate} onClick={()=>download("csv")}>{tr("下载候选逐行 CSV","Download candidate row CSV")}</button></div><small>{tr("报告记录当前完整试算，并标记为未采用预览；包含搜索上限、所有候选结果及选中候选的逐行数量。正式交付请采用后另存工作区。","The report records this complete batch as an unapplied preview, including ceilings, every candidate outcome and selected row quantities. Apply and save a workspace for formal delivery.")}</small>{failed&&<p role="alert">{tr("报告导出失败，请重新运行当前试算后重试。","Report export failed; rerun the current trial and try again.")}</p>}</div>;
}
