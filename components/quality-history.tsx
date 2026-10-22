"use client";
import {useEffect,useRef,useState} from "react";
import type {QualityReport} from "../lib/packing/quality-benchmarks";
import {compareQualityReports,mergeQualityHistory,parseQualityArchive,QUALITY_ARCHIVE_BYTES,QUALITY_HISTORY_KEY,QUALITY_HISTORY_LIMIT,qualityReportKey,serializeQualityHistory,type QualityScope} from "../lib/packing/quality-history";
import {tr,trText,useLanguage} from "./language";

function download(name:string,contents:string){const url=URL.createObjectURL(new Blob([contents],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function scopeLabel(scope:QualityScope){switch(scope){
  case "same-input":return tr("输入记录一致","Input records match");
  case "legacy-no-input":return tr("旧报告缺少输入记录","Legacy report has no input record");
  case "input-changed":return tr("案例输入或参考依据不同","Case inputs or reference differ");
  case "case-version-changed":return tr("案例版本不匹配","Case versions do not match");
  default:return tr("缺少对应运行结果","Corresponding run is missing");
}}
const signed=(n:number|null,digits=0)=>n===null?"—":`${n>0?"+":""}${n.toFixed(digits)}`;
export function QualityComparison({baseline,current}:{baseline:QualityReport;current:QualityReport}){
  useLanguage();const c=compareQualityReports(baseline,current);
  return <section aria-label={tr("基准报告版本比较","Benchmark report comparison")}>
    <h3>{tr("历史报告与本次结果","Historical report and current result")}</h3>
    <p>{baseline.engineVersion} · {baseline.createdAt} → {current.engineVersion} · {current.createdAt}</p>
    <p>{baseline.caseVersion} → {current.caseVersion}</p>
    <p>{tr("基准设备备注","Benchmark device note")}: {baseline.environment||tr("未记录","Not recorded")} → {current.environment||tr("未记录","Not recorded")}</p>
    <p>{c.sameEnvironment?tr("设备备注相同，单次耗时仍会波动，不能据此证明性能提升。","Device notes match. Single-run timings still vary and do not prove a performance improvement."):tr("设备备注缺失或不同，耗时仅作记录，不据此判断性能优劣。","Device notes are missing or differ. Timings are records only, not a performance ranking.")}</p>
    <p>{tr("仅对相同案例版本和完整一致的输入记录计算增减。旧报告仍可查看原值；报告中的校验标记不等于重新核验箱位，箱数增加也不代表每个 SKU 均改善。","Deltas require matching case versions and complete matching input records. Legacy values remain visible. Reported validation flags do not revalidate coordinates, and more cartons do not imply an improvement for every SKU.")}</p>
    <p>{tr("输入一致的运行","Runs with matching inputs")}: {c.sameInputRows} / {c.rows.length} · {tr("新增失败标记","New failure flags")}: {c.newFailures}</p>
    <div className="upgrade-table-wrap"><table><caption>{tr("左侧为历史值，右侧为本次值","Historical values on the left, current values on the right")}</caption><thead><tr>
      <th>{tr("案例／策略","Case / strategy")}</th><th>{tr("比较范围","Comparison scope")}</th><th>{tr("箱数与变化","Cartons and delta")}</th><th>{tr("套数与变化","Kits and delta")}</th><th>{tr("载重 kg 与变化","Payload kg and delta")}</th><th>{tr("报告校验标记","Reported validation flag")}</th><th>{tr("耗时 ms（仅记录）","Duration ms (record only)")}</th>
    </tr></thead><tbody>{c.rows.map(r=><tr key={r.key}>
      <td>{tr(...r.name)} / {r.strategy==="practical"?tr("现场","Practical"):tr("高密度","Maximum")}</td><td>{scopeLabel(r.scope)}</td>
      <td>{r.baseline?.loaded??"—"} → {r.current?.loaded??"—"}<small> · {signed(r.cartonDelta)}</small></td>
      <td>{r.baseline?.sets??"—"} → {r.current?.sets??"—"}<small> · {signed(r.kitDelta)}</small></td>
      <td>{r.baseline?.payloadKg.toFixed(2)??"—"} → {r.current?.payloadKg.toFixed(2)??"—"}<small> · {signed(r.payloadDelta,2)}</small></td>
      <td>{r.baseline?(r.baseline.valid?tr("通过","Passed"):tr("失败","Failed")):"—"} → {r.current?(r.current.valid?tr("通过","Passed"):tr("失败","Failed")):"—"}{r.newFailure?<strong> · {tr("新增失败标记","New failure flag")}</strong>:null}</td>
      <td>{r.baseline?.elapsedMs.toFixed(1)??"—"} → {r.current?.elapsedMs.toFixed(1)??"—"}<small> · {signed(r.elapsedDeltaMs,1)}</small></td>
    </tr>)}</tbody></table></div>
  </section>;
}

export function QualityHistory({report,running}:{report:QualityReport|null;running:boolean}){
  useLanguage();const [reports,setReports]=useState<QualityReport[]>([]),[selected,setSelected]=useState(""),[ready,setReady]=useState(false),[mode,setMode]=useState<"saved"|"session"|"corrupt">("saved"),[raw,setRaw]=useState(""),[message,setMessage]=useState(""),[importing,setImporting]=useState(false);
  const history=useRef<QualityReport[]>([]),blocked=useRef(false),input=useRef<HTMLInputElement>(null),lifecycle=useRef({mounted:false,sequence:0});
  useEffect(()=>{
    const instance=lifecycle.current;let active=true;instance.mounted=true;
    queueMicrotask(()=>{if(!active)return;try{const value=localStorage.getItem(QUALITY_HISTORY_KEY);if(value){try{const parsed=parseQualityArchive(value);history.current=parsed;setReports(parsed);setSelected(parsed[0]?qualityReportKey(parsed[0]):"");}catch{blocked.current=true;setMode("corrupt");setRaw(value);}}}catch{setMode("session");}setReady(true);});
    return()=>{active=false;instance.mounted=false;instance.sequence++;};
  },[]);
  const commit=(incoming:QualityReport[])=>{
    let base=history.current,latest:QualityReport[]|undefined;
    if(!blocked.current){
      try{const value=localStorage.getItem(QUALITY_HISTORY_KEY);if(value){try{latest=parseQualityArchive(value);}catch{blocked.current=true;setMode("corrupt");setRaw(value);}}}catch{setMode("session");}
      if(latest)base=mergeQualityHistory(latest,base);
    }
    const next=mergeQualityHistory(base,incoming),serialized=serializeQualityHistory(next);
    history.current=next;setReports(next);setSelected(incoming[0]?qualityReportKey(incoming[0]):"");
    if(blocked.current){setMessage("本页已接收报告；原损坏历史未覆盖，请下载当前报告和原始记录。");return;}
    try{localStorage.setItem(QUALITY_HISTORY_KEY,serialized);setMode("saved");setMessage("基准历史已保存。");}catch{setMode("session");setMessage("本机存储未写入，本页报告仍保留；请下载备份。");}
  };
  const baseline=reports.find(r=>qualityReportKey(r)===selected);
  return <section aria-label={tr("基准历史与版本比较","Benchmark history and version comparison")}>
    <h3>{tr("基准历史与版本比较","Benchmark history and version comparison")}</h3>
    <p>{tr("最多保留最近保存的 8 份报告，超过后移出最早保存的一份；重要记录请下载。历史保存在当前浏览器，不会修改订单。","Keeps the last eight saved reports, removing the oldest saved entry when full. Download important records. History stays in this browser and does not change the order.")}</p>
    {mode==="corrupt"?<><p role="status">{tr("本机基准历史无法读取；已阻止覆盖原始内容，新报告仅保留在本页。","Local benchmark history cannot be read. Its original contents are protected; new reports stay on this page only.")}</p><button className="button" onClick={()=>download("benchmark-history-unreadable.json",raw)}>{tr("下载无法读取的原始基准历史","Download unreadable original benchmark history")}</button></>:mode==="session"?<p role="status">{tr("本机存储不可用或额度不足；本页仍可比较和下载，刷新前请备份。","Local storage is unavailable or full. You can compare and download on this page; back up before refreshing.")}</p>:null}
    <div className="upgrade-actions">
      <button className="button" disabled={!ready||running||!report?.rows.length} onClick={()=>{try{commit([report!]);}catch(e){setMessage(e instanceof Error?e.message:String(e));}}}>{tr("保存本次基准报告","Save current benchmark report")}</button>
      <button className="button" disabled={!report} onClick={()=>download("quality-benchmark-report.json",JSON.stringify(report,null,2))}>{tr("下载本次基准报告","Download current benchmark report")}</button>
      <button className="button" disabled={!ready||importing} onClick={()=>input.current?.click()}>{tr("导入历史基准报告","Import historical benchmark report")}</button>
      <button className="button" disabled={!ready||!reports.length} onClick={()=>download("quality-benchmark-history.json",serializeQualityHistory(history.current))}>{tr("下载基准历史备份","Download benchmark history backup")}</button>
      <span>{reports.length} / {QUALITY_HISTORY_LIMIT}</span>
    </div>
    <input ref={input} type="file" accept="application/json,.json" hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;const seq=++lifecycle.current.sequence;setImporting(true);try{if(file.size>QUALITY_ARCHIVE_BYTES)throw new Error("基准文件超过大小限制 / Benchmark file exceeds the size limit");const contents=await file.text();if(seq!==lifecycle.current.sequence||!lifecycle.current.mounted)return;commit(parseQualityArchive(contents));}catch(error){if(seq===lifecycle.current.sequence&&lifecycle.current.mounted)setMessage("导入未采用，现有历史保留。 "+(error instanceof Error?error.message:String(error)));}finally{if(seq===lifecycle.current.sequence&&lifecycle.current.mounted)setImporting(false);}}}/>
    {reports.length?<label>{tr("选择比较基准","Select comparison baseline")}<select aria-label={tr("选择比较基准","Select comparison baseline")} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{tr("请选择历史报告","Choose a historical report")}</option>{reports.map(r=><option key={qualityReportKey(r)} value={qualityReportKey(r)}>{r.engineVersion} · {r.createdAt} · {r.rows.length} {tr("组运行","runs")} · {r.complete?tr("完整报告","Complete report"):tr("部分报告","Partial report")}</option>)}</select></label>:<p>{tr("运行基准后保存本次报告，或导入以前下载的报告开始比较。","Run benchmarks and save the report, or import a previously downloaded report to start comparing.")}</p>}
    {baseline&&report?<QualityComparison baseline={baseline} current={report}/>:null}<p role="status">{trText(message)}</p>
  </section>;
}
