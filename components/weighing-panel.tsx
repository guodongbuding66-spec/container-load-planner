"use client";
import { useEffect, useRef, useState } from "react";
import { deliveryIdentityState } from "../lib/packing/delivery-identity";
import { appendWeightMeasurement, emptyWeighingRecords, MAX_WEIGHING_BYTES, mergeWeighingRecords, parseWeighingRecords, plannedWeightBreakdown, reconcileMeasurement, weighingCsv, weighingKey, WeighingError, type WeighingRecords, type WeightMeasurement } from "../lib/packing/weighing";
import type { PackingResult } from "../lib/packing/types";
import { ToolSummary } from "./workflow-tools";
import { tr, useLanguage } from "./language";

function download(name:string,data:string,type="application/json"){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
type Props={plan:PackingResult;disabled:boolean;getRecords?:(key:string)=>WeighingRecords|undefined;onRecords?:(key:string,records:WeighingRecords)=>void};
export function WeighingPanel(props:Props){
  useLanguage();const current=deliveryIdentityState(props.plan)==="current"&&props.plan.validation.valid;
  return <details className="upgrade-panel"><ToolSummary kind="field" title={tr("计划重量与实际核重","Planned weight and actual weighing")} description={tr("分开核对货物、包装和固定材料，记录完整装载的实称来源与差额。","Separate cargo, packaging and materials; record complete-load readings, provenance and differences.")}/><div className="upgrade-body">
    <p>{tr("核重记录独立备份，不包含在工作区或现场事件文件中。读数为人工登记，不代表地磅认证；不会改写装箱数量或几何校验。","Weighing records use a separate backup, outside workspace and field-event files. Readings are manually entered, not scale certification; counts and geometry checks remain separate.")}</p>
    {current?<WeighingWorkspace key={weighingKey(props.plan)} {...props}/>:<p>{tr("请先登记完整有效的当前交付版本，再录入实称。","Issue a complete valid current delivery revision before entering readings.")}</p>}
  </div></details>;
}
export function WeighingWorkspace({plan,disabled,getRecords,onRecords}:Props){
  const lang=useLanguage(),key=weighingKey(plan),input=useRef<HTMLInputElement>(null);
  const [initial]=useState(()=>{let raw:string|null=null;try{const memory=getRecords?.(key);if(memory)return {records:parseWeighingRecords(plan,JSON.stringify(memory)),raw:null,error:""};raw=localStorage.getItem(key);return {records:raw?parseWeighingRecords(plan,raw):emptyWeighingRecords(plan),raw:null,error:""};}catch(e){return {records:emptyWeighingRecords(plan),raw,error:e instanceof WeighingError?tr(e.zh,e.en):tr("无法读取本机核重记录，请保留原始文件。","Unable to read local weighing records; retain the original file.")};}});
  const [records,setRecords]=useState(initial.records),[message,setMessage]=useState(initial.error),[showBackup,setShowBackup]=useState(false);
  const [method,setMethod]=useState<WeightMeasurement["method"]>("gross-minus-tare"),[reading,setReading]=useState(""),[tare,setTare]=useState(""),[tareSource,setTareSource]=useState(""),[source,setSource]=useState(""),[reference,setReference]=useState(""),[note,setNote]=useState(""),[measuredAt,setMeasuredAt]=useState(""),[complete,setComplete]=useState(false),[busy,setBusy]=useState(false);
  const blocked=!!initial.error;
  const planned=plannedWeightBreakdown(plan),unavailable=disabled||blocked||busy||!planned.consistent;
  useEffect(()=>{if(!blocked)onRecords?.(key,records);},[key,records,blocked,onRecords]);
  const error=(e:unknown)=>setMessage(e instanceof WeighingError?tr(e.zh,e.en):tr("核重操作失败，未替换当前记录。请检查文件、数值和来源。","Weighing operation failed; current records were retained. Check the file, values and provenance."));
  function commit(next:WeighingRecords){
    setRecords(next);onRecords?.(key,next);setMessage(tr("记录已加入本页，请下载或复制完整核重备份。","Record retained on this page; download or copy the complete weighing backup."));
    try{localStorage.setItem(key,JSON.stringify(next));}catch{setMessage(tr("本机存储写入失败，记录仍在本页。请立即下载或复制完整核重备份。","Local storage failed; records remain on this page. Download or copy a complete weighing backup now."));}
  }
  function save(){try{
    if(!complete||!reading.trim()||method==="gross-minus-tare"&&!tare.trim()||!measuredAt)throw new WeighingError("请填写读数、时间、来源、磅单，并确认完整装载范围。","Enter readings, time, source and ticket, and confirm complete-load scope.");
    const next=appendWeightMeasurement(plan,records,{method,readingKg:Number(reading),tareKg:method==="gross-minus-tare"?Number(tare):null,tareSource:method==="gross-minus-tare"?tareSource:"",source,reference,note,measuredAt:new Date(measuredAt).toISOString()});
    commit(next);setComplete(false);setReading("");setReference("");
  }catch(e){error(e);}}
  const fmt=(n:number|null)=>n===null?tr("未填写","Not entered"):Number(n.toFixed(3)).toLocaleString(lang);
  return <section className="weighing-workspace" aria-label={tr("当前版本核重","Weighing for this revision")}>
    <p><strong>{tr("交付版本","Delivery revision")} {plan.deliveryIdentity!.revision}</strong> · {plan.deliveryIdentity!.revisionId}</p>
    <div className="weighing-totals">{[[tr("计划货物毛重（含随箱包装）","Planned cargo gross (includes cargo packaging)"),planned.cargoKg],[tr("另计托盘／木箱自重","Additional pallet / crate tare"),planned.packagingKg],[tr("另计固定／防潮材料","Additional securing / moisture materials"),planned.accessoriesKg],[tr("计划装载总重（不含柜体皮重）","Planned payload (excludes container tare)"),planned.payloadKg]].map(([label,value])=><div key={label as string}><small>{label}</small><strong>{fmt(value as number)} kg</strong></div>)}</div>
    <p>{tr("货物毛重已含的包装、支架不再另加；柜体皮重仅用于总重减皮重法。缺少实称时保持未核重，不把计划值当作读数。","Packaging and fixtures included in cargo gross are not added again. Container tare is used only for gross-minus-tare. Without a reading, weight remains unmeasured; planned values are never used as readings.")}</p>
    {!planned.consistent&&<p role="alert">{tr("计划重量明细不一致，已阻止登记。","Planned weight components disagree; recording is blocked.")}</p>}
    <fieldset disabled={unavailable} className="weighing-fields"><legend>{tr("登记一次完整装载实称（kg）","Record one complete-load weighing (kg)")}</legend>
      <label>{tr("称重方式","Weighing method")}<select value={method} onChange={e=>{setMethod(e.target.value as WeightMeasurement["method"]);setComplete(false);}}><option value="gross-minus-tare">{tr("整柜总重减柜体皮重","Loaded gross minus container tare")}</option><option value="payload">{tr("已直接称得装载净重","Directly measured payload")}</option></select></label>
      <label>{method==="payload"?tr("实称装载净重（kg）","Measured payload (kg)"):tr("实称整柜总重（kg）","Measured loaded gross (kg)")}<input inputMode="decimal" value={reading} onChange={e=>setReading(e.target.value)}/></label>
      {method==="gross-minus-tare"&&<><label>{tr("柜体皮重（kg）","Container tare (kg)")}<input inputMode="decimal" value={tare} onChange={e=>setTare(e.target.value)}/></label><label>{tr("皮重来源（实称／铭牌及柜号）","Tare source (weighed / plate and container ID)")}<input value={tareSource} maxLength={300} onChange={e=>setTareSource(e.target.value)}/></label></>}
      <label>{tr("实称时间","Measurement time")}<input type="datetime-local" value={measuredAt} onChange={e=>setMeasuredAt(e.target.value)}/></label><label>{tr("称重来源／设备","Weighing source / equipment")}<input maxLength={300} value={source} onChange={e=>setSource(e.target.value)}/></label><label>{tr("磅单／记录编号","Scale ticket / record reference")}<input value={reference} maxLength={300} onChange={e=>setReference(e.target.value)}/></label><label>{tr("复称／差异说明","Reweighing / difference notes")}<input maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <label className="weighing-confirm"><input type="checkbox" checked={complete} onChange={e=>setComplete(e.target.checked)}/>{tr("确认读数覆盖本版本全部货物、包装和材料，且未计入车辆／人员重量。","I confirm the reading covers all cargo, packaging and materials in this revision and excludes vehicles / people.")}</label>
      <button className="button" type="button" disabled={!complete} onClick={save}>{tr("追加核重记录","Append weighing record")}</button>
    </fieldset>
    <p>{records.measurements.length?tr("所有复称均保留，以下差额不代表误差已解决。","Every reweighing is retained; the differences below do not mean discrepancies are resolved."):tr("未核重：尚无实际称重记录。","Not weighed: no actual measurement recorded.")}</p>
    <div className="weighing-history">{records.measurements.map(m=>{const r=reconcileMeasurement(plan,m);return <article key={m.id}><strong>{m.reference}</strong> · <time dateTime={m.measuredAt}>{new Date(m.measuredAt).toLocaleString(lang)}</time><p>{m.source} · {tr("实称净载荷","Measured payload")}: {fmt(r.payloadKg)} kg · {tr("与计划差额","Difference from plan")}: {fmt(r.differenceKg)} kg ({fmt(r.differencePercent)}%)</p>{m.tareKg!==null&&<p>{tr("总重／皮重","Gross / tare")}: {fmt(m.readingKg)} / {fmt(m.tareKg)} kg · {m.tareSource}</p>}{r.overPayloadKg>0&&<p role="alert">{tr("实称载荷超过方案载重上限","Measured payload exceeds the plan payload limit")}: {fmt(r.overPayloadKg)} kg</p>}<p>{m.note}</p></article>;})}</div>
    <div className="upgrade-actions"><button className="button" disabled={blocked||busy} onClick={()=>{download(`CargoFit_weighing_v${records.context.revision}.json`,JSON.stringify(records,null,2));setMessage(tr("已发起下载，请确认文件已保存。","Download started; confirm the file was saved."));}}>{tr("下载完整核重备份","Download complete weighing backup")}</button><button className="button" disabled={blocked||busy} onClick={()=>setShowBackup(v=>!v)}>{tr("显示完整核重备份文本","Show complete weighing backup text")}</button><button className="button" disabled={blocked||busy||!records.measurements.length} onClick={()=>download("CargoFit_weighing.csv","\ufeff"+weighingCsv(plan,records),"text/csv;charset=utf-8")}>{tr("导出核重 CSV","Export weighing CSV")}</button><button className="button" disabled={unavailable} onClick={()=>input.current?.click()}>{tr("导入并合并核重备份","Import and merge weighing backup")}</button></div>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={async e=>{const f=e.target.files?.[0];e.currentTarget.value="";if(!f)return;setBusy(true);try{if(f.size>MAX_WEIGHING_BYTES)throw Error();commit(mergeWeighingRecords(plan,records,parseWeighingRecords(plan,await f.text())));}catch(e){error(e);}finally{setBusy(false);}}}/>
    {showBackup&&!blocked&&<label>{tr("完整核重备份 JSON","Complete weighing backup JSON")}<textarea readOnly className="weighing-backup" value={JSON.stringify(records,null,2)}/></label>}
    {blocked&&initial.raw!==null&&<button className="button" onClick={()=>download("CargoFit_unreadable_weighing.txt",initial.raw!,"text/plain")}>{tr("下载无法读取的原始记录","Download unreadable original records")}</button>}
    <p role="status">{message}</p>
  </section>;
}
