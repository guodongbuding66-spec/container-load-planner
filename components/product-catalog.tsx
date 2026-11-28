"use client";
import {tr, tt, useLanguage} from "./language";
import { ToolSummary } from "./workflow-tools";
import { useMemo, useState } from "react";
import { MAX_CATALOG_BYTES, catalogStore, importCatalog, calibrationReport, fieldCalibrationSignature, packagingSignature, type PackagingRecord, type FieldRecord } from "../lib/packing/catalog";
import type { PreparedPalletLayout } from "../lib/packing/prepared-pallet-layout";
import type { PackingResult,ProductInput } from "../lib/packing/types";
import { customerReport } from "../lib/packing/field-report";
function download(name:string,s:string,type="application/json"){const u=URL.createObjectURL(new Blob([s],{type})),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);}
export function ProductCatalog({products,plan,preparedLayout,disabled,onProducts}:{products:ProductInput[];plan:PackingResult|null;preparedLayout?:PreparedPalletLayout;disabled:boolean;onProducts:(p:ProductInput[])=>void}){
  useLanguage();
  const [entries,setEntries]=useState<PackagingRecord[]>([]),[records,setRecords]=useState<FieldRecord[]>([]),[name,setName]=useState(""),[revision,setRevision]=useState(""),[date,setDate]=useState(""),[notes,setNotes]=useState(""),[actual,setActual]=useState(""),[minutes,setMinutes]=useState(""),[split,setSplit]=useState<FieldRecord["split"]>("acceptance"),[photos,setPhotos]=useState<string[]>([]),[message,setMessage]=useState("");
  const refresh=async()=>{try{setEntries(await catalogStore("packaging"));setRecords(await catalogStore("records"));}catch{setMessage(tr("当前浏览器无法打开产品档案存储。"));}};
  const savePackaging=async()=>{try{if(!name.trim()||!revision.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error(tr("请填写产品系列、包装版本和生效日期。"));const p=products.map(p=>({...p,packaging:{revision,effectiveDate:date,notes}}));const entry:PackagingRecord={id:crypto.randomUUID(),name,revision,effectiveDate:date,notes,products:p,createdAt:new Date().toISOString()};setEntries(await catalogStore("packaging",entry));onProducts(p);setMessage(tr("包装档案已保存为独立版本，旧版本保留。"));}catch(e){setMessage(String(e));}};
  const [saving,setSaving]=useState(false);
  const saveRecord=async()=>{
    if(disabled||saving)return;
    if(!plan?.validation.valid){setMessage(tr("请先生成通过校验的装载方案。","Calculate and validate a load plan first."));return;}
    if(!name.trim()||!actual.trim()||!Number.isInteger(Number(actual))||Number(actual)<=0||!minutes.trim()||!Number.isFinite(Number(minutes))||Number(minutes)<0){
      setMessage(tr("请填写名称、实际装载整数数量和耗时分钟。","Enter a name, a whole observed quantity and elapsed minutes."));return;
    }
    setSaving(true);
    try{
      const record:FieldRecord={
        id:crypto.randomUUID(),name,split,packagingSignature:packagingSignature(products),
        settingsSignature:await fieldCalibrationSignature(plan,products,preparedLayout),container:{...plan.container},
        predicted:plan.setSummaries.length?plan.setSummaries.reduce((n,s)=>n+s.loadedSets,0):plan.metrics.loadedCount,
        actual:Number(actual),minutes:Number(minutes),reason:notes,photos,createdAt:new Date().toISOString(),
      };
      setRecords(await catalogStore("records",record));
      setMessage(tr("实装记录已保存；验收数据不会参与校准拟合。","Field record saved. Acceptance data stays separate from calibration."));
    }catch(error){setMessage(String(error));}
    finally{setSaving(false);}
  };
  const report=useMemo(()=>calibrationReport(records),[records]);
  return <details className="upgrade-panel" onToggle={e=>{if(e.currentTarget.open)void refresh();}}><ToolSummary kind="catalog" title={tr("产品包装档案与实装验收")} description={tr("管理包装版本与实装记录，持续核对预测表现。")}/><div className="upgrade-body"><p>{tr("每个档案保存当前整组箱规。新包装独立建版本；实装照片在本机保存，不会自动上传。当前柜型尺寸作为实测记录保存，请先核对。")}</p><div className="tool-form-grid"><label>{tr("产品系列／记录名称")}<input value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label><label>{tr("包装版本")}<input value={revision} maxLength={100} onChange={e=>setRevision(e.target.value)}/></label><label>{tr("生效日期")}<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="tool-wide">{tr("变更／偏差原因")}<textarea value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)}/></label></div><button className="button primary" disabled={disabled} onClick={savePackaging}>{tr("保存包装档案并应用")}</button><div className="upgrade-table-wrap"><table><thead><tr><th>{tr("产品")}</th><th>{tr("版本")}</th><th>{tr("生效日")}</th><th>{tr("变更说明")}</th><th>{tr("操作")}</th></tr></thead><tbody>{!entries.length?<tr><td colSpan={5} className="tool-empty">{tr("尚无包装档案。填写上方信息，保存第一个版本。")}</td></tr>:null}{entries.map(e=><tr key={e.id}><td>{e.name}</td><td>{e.revision}</td><td>{e.effectiveDate}</td><td>{e.notes}</td><td><button className="button small" disabled={disabled} onClick={()=>onProducts(e.products)}>{tr("应用此包装版本")}</button></td></tr>)}</tbody></table></div><h3>{tr("新增实装记录")}</h3><p>{tr("本表数量单位：")}{plan?.setSummaries.length?tr("完整套数（多种套装合计）"):tr("箱数")}{tr("。新增数据默认作为独立验收，不参与校准。")}</p><div className="tool-form-grid"><label>{tr("数据用途")}<select value={split} onChange={e=>setSplit(e.target.value as FieldRecord["split"])}><option value="acceptance">{tr("独立验收集")}</option><option value="calibration">{tr("校准集")}</option></select></label><label>{tr("实际装载数量")}<input inputMode="numeric" value={actual} onChange={e=>setActual(e.target.value)}/></label><label>{tr("装载耗时（分钟）")}<input inputMode="decimal" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label><label className="tool-wide">{tr("实装照片（最多 4 张、每张 1 MB）")}<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={async e=>{try{const files=Array.from(e.target.files??[]);if(files.length>4||files.some(f=>f.size>1024*1024||!/^image\/(png|jpeg|webp)$/.test(f.type)))throw Error(tr("照片格式或大小超限"));const urls=await Promise.all(files.map(f=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(f);})));setPhotos(urls);}catch(e){setMessage(String(e));}}}/></label></div><button className="button" disabled={disabled||saving||!plan?.validation.valid} onClick={saveRecord}>{tr("保存实装记录")}</button><div className="tool-stats"><div><span>{tr("条件完整的校准记录","Calibration records with matched conditions")}</span><strong>{report.trainingCount}<small>{tr(" 条")}</small></strong></div><div><span>{tr("独立验收")}</span><strong>{report.acceptanceCount}<small>{tr(" 条")}</small></strong></div><div><span>{tr("验收平均误差（条件完整）","Mean acceptance error for complete records")}</span><strong>{report.meanErrorPct===null?"—":`${report.meanErrorPct.toFixed(2)}%`}</strong></div></div><p>{tr("修正参考按相同柜型净空、门洞、载重、货物、包装与算法设置匹配校准记录。","Forecast adjustment matches calibration records by interior and door clearance, payload, cargo, packaging and solver settings.")}</p>
  {report.legacyCount>0&&<p className="helper-text">{report.legacyCount} {tr("条旧记录缺少完整装载条件，保留原始预测与实装资料。","legacy records lack complete loading conditions. Their original forecasts and observations are retained.")}</p>}
  {report.evaluate.map(r=><p key={r.id}>
    <strong>{r.name}</strong> · {r.trainingCount?tr("修正参考","Adjusted forecast"):tr("原始预测","Original forecast")} {r.predicted}
    {" · "}{tr("实装","Observed")} {r.actual} · {tr("误差","Error")} {r.errorPct.toFixed(2)}%
    {" · "}{r.legacy?tr("旧记录 · 条件不足","Legacy record · incomplete conditions"):<>{tr("匹配校准样本","Matched calibration records")} {r.trainingCount}</>}
  </p>)}<details><summary>{tr("查看记录、照片和耗时")}</summary>{records.map(r=><article key={r.id}><strong>{r.name} · {r.split==="acceptance"?tr("验收"):tr("校准")}</strong><p>{r.actual} · {r.minutes}{tr(" 分钟 · ")}{r.reason}</p>{r.photos.map((src,i)=>(
      // eslint-disable-next-line @next/next/no-img-element
      <img key={i} src={src} alt={tt`${r.name} 实装照片 ${i+1}`} width={160}/>
    ))}</article>)}</details><button className="button" onClick={()=>download(tr("包装与实装档案.json"),JSON.stringify({format:"cargo-fit-catalog",version:1,entries,records},null,2))}>{tr("导出完整档案含照片")}</button><label>{tr("导入档案（追加，不覆盖现有版本）")}<input type="file" accept=".json" disabled={disabled} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>MAX_CATALOG_BYTES)throw Error(tr("档案文件超过 50 MB"));await importCatalog(await f.text());await refresh();setMessage(tr("档案已完整导入，现有数据未覆盖。"));}catch(e){setMessage(String(e));}e.target.value="";}}/></label><p role="status">{message}</p></div></details>;
}
export function CustomerReportPanel({plan,products,disabled=false}:{plan:PackingResult;products:ProductInput[];disabled?:boolean}){
  useLanguage();
  const [language,setLanguage]=useState<"zh"|"en">("zh"),[customer,setCustomer]=useState(""),[order,setOrder]=useState(""),[currency,setCurrency]=useState("USD"),[freight,setFreight]=useState("");
  return <details className="upgrade-panel"><ToolSummary kind="report" title={tr("客户中英文报告")} description={tr("填写客户与报价信息，生成可打印的装柜报告。")}/><div className="upgrade-body"><div className="tool-form-grid"><label>{tr("语言")}<select value={language} onChange={e=>setLanguage(e.target.value as "zh"|"en")}><option value="zh">{tr("中文")}</option><option value="en">English</option></select></label><label>{tr("客户")}<input value={customer} maxLength={150} onChange={e=>setCustomer(e.target.value)}/></label><label>{tr("订单号")}<input value={order} maxLength={100} onChange={e=>setOrder(e.target.value)}/></label><label>{tr("币种")}<input value={currency} maxLength={8} onChange={e=>setCurrency(e.target.value)}/></label><label>{tr("本柜运费（可留空）")}<input inputMode="decimal" value={freight} onChange={e=>setFreight(e.target.value)}/></label></div><button className="button primary" disabled={disabled||freight!==""&&(!Number.isFinite(Number(freight))||Number(freight)<0)} onClick={()=>{if(disabled)return;download(language==="zh"?tr("客户装柜报告.html"):"Container-Loading-Report.html",customerReport(plan,products,{language,customer,order,currency,freight:freight.trim()?Number(freight):null}),"text/html;charset=utf-8");}}>{tr("下载客户报告／打印 PDF")}</button></div></details>;
}
