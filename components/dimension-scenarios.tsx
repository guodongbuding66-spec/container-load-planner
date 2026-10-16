"use client";
import { useEffect, useRef, useState } from "react";
import { parseDimensionComparisonReport } from "../lib/packing/dimension-report";
import { DIMENSION_AXES, emptyDimensionAllowance, parseDimensionAllowance, type DimensionAllowance, type DimensionSize } from "../lib/packing/dimension-allowance";
import { conservativeProduct, dimensionComparisonRows, scenarioMargins, type DimensionComparison } from "../lib/packing/dimension-scenarios";
import type { CameraView } from "../lib/packing/camera-fit";
import type { PackingRequest, PackingResult, ProductInput } from "../lib/packing/types";
import { fromMillimeters, toMillimeters, type LengthUnit } from "../lib/packing/units";
import { buildPlacementCsv } from "../lib/packing/csv";
import { auditPackingResult } from "../lib/packing/result-audit";
import { reviewPlan } from "../lib/packing/plan-review";
import { ResultAuditPanel, PlanReviewPanel } from "./result-audit-panel";
import { OrthographicViews } from "./orthographic-views";
import { PlanViewer } from "./plan-viewer";
import { NumericInput } from "./numeric-input";
import { ToolSummary } from "./workflow-tools";
import { tr, trText, useLanguage } from "./language";

const axisLabels={length:["长","L"],width:["宽","W"],height:["高","H"]} as const;
function saveFile(name:string,text:string,type="application/json"){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function DimensionAllowanceFields({value,onChange,unit,invalid,onValidity,measuredDefault}:{value:DimensionAllowance;onChange:(value:DimensionAllowance)=>void;unit:LengthUnit;invalid:boolean;measuredDefault?:DimensionSize;onValidity:(key:string,valid:boolean)=>void}){
  useLanguage();
  const dimensions=(group:string,size:DimensionSize,change:(size:DimensionSize)=>void,keyPrefix=group)=><div className="dimension-size-inputs">{DIMENSION_AXES.map(axis=><label key={axis}>{tr(axisLabels[axis][0],axisLabels[axis][1])} ({unit})<NumericInput ariaLabel={`${group} ${tr(axisLabels[axis][0],axisLabels[axis][1])} (${unit})`} value={fromMillimeters(size[axis],unit)} min={group===tr("实测尺寸","Measured size")?Number.MIN_VALUE:0} max={fromMillimeters(100000,unit)} precision={5} onValueChange={n=>change({...size,[axis]:toMillimeters(n,unit)})} onValidityChange={valid=>onValidity(`${keyPrefix}-${axis}`,valid)}/></label>)}</div>;
  const attachment=(index:number,patch:Partial<DimensionAllowance["attachments"][number]>)=>onChange({...value,attachments:value.attachments.map((a,i)=>i===index?{...a,...patch}:a)});
  return <div className="dimension-allowance-fields">
    <div className="dimension-source-inputs"><label>{tr("尺寸来源","Dimension source")}<input maxLength={160} value={value.source} onChange={e=>onChange({...value,source:e.target.value})}/></label><label>{tr("批次","Batch")}<input maxLength={160} value={value.batch} onChange={e=>onChange({...value,batch:e.target.value})}/></label><label>{tr("实测日期","Measurement date")}<input type="date" value={value.measuredAt} onChange={e=>onChange({...value,measuredAt:e.target.value})}/></label></div>
    <label><input type="checkbox" checked={!!value.measured} disabled={invalid} onChange={e=>onChange({...value,measured:e.target.checked?(measuredDefault??{length:1,width:1,height:1}):undefined})}/>{tr("录入批次实测尺寸","Enter measured batch dimensions")}</label>
    {value.measured&&<><p className="feature-note">{tr("保守基准取标称与实测各轴较大值，再加以下增量。","The conservative base uses the larger nominal or measured size on each axis, then adds the allowances below.")}</p>{dimensions(tr("实测尺寸","Measured size"),value.measured,measured=>onChange({...value,measured}),"measured")}</>}
    <label>{tr("鼓包／公差增量口径","Bulge / tolerance basis")}<select value={value.incrementMode} onChange={e=>onChange({...value,incrementMode:e.target.value as DimensionAllowance["incrementMode"]})}><option value="total">{tr("每个尺寸的总增量","Total increase per dimension")}</option><option value="per-face">{tr("两侧每面增量（自动 ×2）","Increase per face, both sides (×2)")}</option></select></label>
    {dimensions(tr("公差增量","Tolerance increment"),value.increment,increment=>onChange({...value,increment}),"tolerance")}
    <h4>{tr("随箱包装附件","Accessories per carton")}</h4><p className="feature-note">{tr("附件填写三围总增量与单箱新增重量。已包含在标称／实测尺寸或现有毛重中的部分，请分别勾选已计入。托盘、木箱自重仍由包装设置计算。","Enter total dimensional increases and added weight per carton. Mark dimensions and weight separately when already included in nominal / measured sizes or existing gross weight. Pallet / crate tare remains in packaging settings.")}</p>
    {value.attachments.map((a,index)=><fieldset key={index}><legend>{tr("附件","Accessory")} {index+1}</legend><div className="dimension-source-inputs"><label>{tr("附件来源 ID","Accessory source ID")}<input maxLength={80} value={a.sourceId} onChange={e=>attachment(index,{sourceId:e.target.value})}/></label><label>{tr("附件名称","Accessory name")}<input maxLength={160} value={a.name} onChange={e=>attachment(index,{name:e.target.value})}/></label><label>{tr("新增重量 kg／箱","Added kg / carton")}<NumericInput ariaLabel={`${tr("附件","Accessory")} ${index+1} kg`} value={a.weightKg} max={100000} onValueChange={weightKg=>attachment(index,{weightKg})} onValidityChange={valid=>onValidity(`accessory-${index}-weight`,valid)}/></label></div>
      {dimensions(`${tr("附件","Accessory")} ${index+1}`,a.increment,increment=>attachment(index,{increment}),`accessory-${index}`)}
      <div className="upgrade-actions"><label><input type="checkbox" checked={a.dimensionsIncluded} onChange={e=>attachment(index,{dimensionsIncluded:e.target.checked})}/>{tr("尺寸已计入","Dimensions already included")}</label><label><input type="checkbox" checked={a.weightIncluded} onChange={e=>attachment(index,{weightIncluded:e.target.checked})}/>{tr("重量已计入","Weight already included")}</label><button type="button" className="button small" disabled={invalid} onClick={()=>onChange({...value,attachments:value.attachments.filter((_,i)=>i!==index)})}>{tr("移除此附件","Remove accessory")}</button></div>
    </fieldset>)}
    <button type="button" className="button small" disabled={value.attachments.length>=12||invalid} onClick={()=>onChange({...value,attachments:[...value.attachments,{sourceId:`accessory-${Date.now()}-${value.attachments.length}`,name:"",increment:{length:0,width:0,height:0},weightKg:0,dimensionsIncluded:false,weightIncluded:false}]})}>{tr("添加附件来源","Add accessory source")}</button>
  </div>;
}

export function DimensionComparisonResults({comparison,disabled=false}:{comparison:DimensionComparison;disabled?:boolean}){
  useLanguage();const [view,setView]=useState<CameraView>("perspective");const [kind,setKind]=useState<"nominal"|"conservative">("conservative"),[viewer,setViewer]=useState(false);
  const selected=comparison[kind],plan=selected.plan,rows=dimensionComparisonRows(comparison),margins=scenarioMargins(plan);
  const label=(k:typeof kind)=>k==="nominal"?tr("标称方案","Nominal plan"):tr("保守方案","Conservative plan");
  return <div className="dimension-comparison-results">
    <p><strong>{tr("原箱位复核（箱体起点固定）","Original positions, carton minimum corners fixed")}: {comparison.originalPositions.valid?tr("通过","Passed"):tr("不通过","Failed")}</strong></p>
    {!comparison.originalPositions.valid&&<p className="feature-note" role="status">{comparison.originalPositions.errors.map(trText).join(" · ")}</p>}
    <p className="feature-note">{tr("原位复核扩大箱体后检查旧位置；下表保守方案重新排布。数量增减由启发式计算给出，不代表固定少装比例或全局最优。","The position check expands cartons at their old positions; the conservative plan below is repacked. Quantity changes are heuristic solver results, not a fixed loss rate or proof of global optimality.")}</p>
    <div className="upgrade-table-wrap"><table><caption>{tr("同一订单的独立方案","Independent plans for the same order")}</caption><thead><tr><th>{tr("尺寸口径","Dimension basis")}</th><th>{tr("箱数","Cartons")}</th><th>{tr("完整套数","Complete sets")}</th><th>{tr("毛重 kg","Gross kg")}</th><th>{tr("利用率","Utilization")}</th></tr></thead><tbody>{(["nominal","conservative"] as const).map(k=>{const p=comparison[k].plan;return <tr key={k}><th>{label(k)}</th><td>{p.metrics.loadedCount}</td><td>{p.setSummaries.length?p.setSummaries.reduce((n,s)=>n+s.loadedSets,0):"—"}</td><td>{p.metrics.grossWeight.toLocaleString()}</td><td>{(100*p.metrics.volumeUtilization).toFixed(1)}%</td></tr>;})}</tbody></table></div>
    <div className="upgrade-table-wrap"><table><caption>{tr("各 SKU 箱数变化","Carton changes by SKU")}</caption><thead><tr><th>SKU</th><th>{tr("标称三围 mm","Nominal L/W/H mm")}</th><th>{tr("保守三围 mm","Conservative L/W/H mm")}</th><th>{label("nominal")}</th><th>{label("conservative")}</th><th>{tr("变化","Change")}</th></tr></thead><tbody>{rows.map(r=><tr key={r.productId}><th>{r.sku}</th><td>{r.nominalSize.join(" × ")}</td><td>{r.conservativeSize.join(" × ")}</td><td>{r.nominal}</td><td>{r.conservative}</td><td>{r.conservative-r.nominal>0?"+":""}{r.conservative-r.nominal}</td></tr>)}</tbody></table></div>
    <div className="upgrade-actions" role="group" aria-label={tr("切换尺寸方案","Select dimension scenario")}>{(["nominal","conservative"] as const).map(k=><button key={k} className="button" aria-pressed={kind===k} onClick={()=>setKind(k)}>{label(k)}</button>)}</div>
    <p><strong>{plan.dimensionScenario?.id}</strong> · {tr("引擎","Engine")} {plan.engineVersion}</p>
    {!!plan.dimensionScenario?.proxyProductIds.length&&<p className="feature-note">{tr("当前异型件使用保守外包络占位，禁用承重叠放；可落地面与真实表面公差未核验，不能作为现场指导书。","Affected irregular cargo uses conservative bounding boxes with stacking disabled. Resting faces and true surface tolerances remain unverified; this is not a field loading instruction.")}</p>}
    {margins&&plan.workflow!=="pallet-only"&&<p>{tr("远端余量（长／宽／高）","Far-wall margins (L/W/H)")}: {DIMENSION_AXES.map(a=>margins.farWall[a].toFixed(1)).join(" / ")} mm · {tr("门洞尺寸余量（宽／高）","Door size margins (W/H)")}: {margins.door?`${margins.door.width.toFixed(1)} / ${margins.door.height.toFixed(1)} mm`:tr("不适用","Not applicable")}<br/><small>{tr("余量仅比较尺寸，不代表转向、抬升或搬运设备可以通过。","Size margins do not verify turning, lifting or handling-equipment passage.")}</small></p>}
    <PlanReviewPanel report={reviewPlan(plan,selected.request.products)}/>
    <ResultAuditPanel report={auditPackingResult(plan,selected.request.products)}/>
    <OrthographicViews key={plan.id} result={plan} visibleProducts={new Set(plan.summaries.map(s=>s.productId))} visibleCount={plan.placements.length} primaryCountLabel={`${plan.placements.length}`} activeView={view} onViewSelect={next=>{setView(next);setViewer(true);}} renderPrintSvg/>
    <div className="upgrade-actions"><button className="button" disabled={disabled} onClick={()=>{setView("perspective");setViewer(true);}}>{tr("查看当前方案三维","View selected plan in 3D")}</button><button className="button" disabled={disabled} onClick={()=>saveFile(`${plan.dimensionScenario!.id}.csv`,buildPlacementCsv(plan),"text/csv;charset=utf-8")}>{tr("导出当前方案坐标 CSV","Export selected coordinates CSV")}</button><button className="button" disabled={disabled} onClick={()=>saveFile("dimension-comparison.json",JSON.stringify(comparison,null,2))}>{tr("导出双方案与来源 JSON","Export both plans and sources JSON")}</button></div>
    {viewer&&<PlanViewer plans={[plan]} initialView={view} exportsBlocked={disabled||!!plan.dimensionScenario?.proxyProductIds.length} onClose={()=>setViewer(false)}/>}
  </div>;
}

export function DimensionScenarios({request,result,disabled,unit,onProducts}:{request:PackingRequest;result:PackingResult|null;disabled:boolean;unit:LengthUnit;onProducts:(products:ProductInput[])=>void}){
  useLanguage();const [selectedId,setSelectedId]=useState(request.products[0]?.id??"");
  const [draft,setDraft]=useState<Record<string,DimensionAllowance>>(()=>Object.fromEntries(request.products.map(p=>[p.id,structuredClone(p.dimensionAllowance??emptyDimensionAllowance())])));
  const [editorReset,setEditorReset]=useState(0);
  const [invalid,setInvalid]=useState<Set<string>>(new Set()),[changed,setChanged]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [comparison,setComparison]=useState<DimensionComparison|null>(null);const worker=useRef<Worker|null>(null);
  useEffect(()=>()=>worker.current?.terminate(),[]);
  const product=request.products.find(p=>p.id===selectedId)??request.products[0];
  if(!product)return null;
  const value=draft[product.id]??emptyDimensionAllowance();
  let preview:ProductInput|undefined,previewError="";
  try{preview=conservativeProduct({...product,dimensionAllowance:value}).product;}catch(e){previewError=e instanceof Error?e.message:String(e);}
  const edit=(next:DimensionAllowance)=>{setDraft(d=>({...d,[product.id]:next}));setChanged(true);setComparison(null);setMessage("");};
  const run=()=>{
    if(!result||disabled||changed||invalid.size||busy)return;
    try{setMessage("");setBusy(true);setComparison(null);const w=new Worker(new URL("../lib/packing/dimension-scenarios.worker.ts",import.meta.url),{type:"module"});worker.current=w;
      w.onmessage=e=>{w.terminate();if(worker.current!==w)return;worker.current=null;setBusy(false);if(e.data.type==="result")setComparison(e.data.payload);else setMessage(e.data.message);};
      w.onerror=()=>{w.terminate();if(worker.current!==w)return;worker.current=null;setBusy(false);setMessage(tr("对比计算失败，请重试。","Comparison failed. Please retry."));};
      w.postMessage({request,nominal:result});
    }catch(e){worker.current?.terminate();worker.current=null;setBusy(false);setMessage(e instanceof Error?e.message:String(e));}
  };
  return <details className="upgrade-panel dimension-scenarios"><ToolSummary kind="diagnosis" title={tr("标称尺寸与保守尺寸对比","Nominal and conservative dimensions")} description={tr("按批次实测、鼓包、公差和随箱附件评估原箱位及重新排布。","Review existing positions and repack for batch measurements, bulge, tolerance and accessories.")}/><div className="upgrade-body">
    <p>{tr("标称主方案始终使用货物清单的尺寸；保守方案在此独立计算与查看，不覆盖主方案。保存规则后，请先重新计算标称方案，再运行对比。","The main nominal plan uses the cargo-list dimensions. Conservative plans are computed and viewed independently here. After saving rules, recalculate the nominal plan before comparing.")}</p>
    <fieldset disabled={disabled||busy}><legend>{tr("尺寸来源与附件","Dimension sources and accessories")}</legend><label>SKU<select aria-label={tr("尺寸偏差 SKU","Dimension allowance SKU")} value={product.id} disabled={invalid.size>0} onChange={e=>setSelectedId(e.target.value)}>{request.products.map(p=><option key={p.id} value={p.id}>{p.sku}</option>)}</select></label>
      <DimensionAllowanceFields key={`${product.id}-${editorReset}`} measuredDefault={{length:product.length,width:product.width,height:product.height}} value={value} onChange={edit} unit={unit} invalid={invalid.size>0} onValidity={(key,valid)=>{setComparison(null);setInvalid(current=>{const next=new Set(current);if(valid)next.delete(key);else next.add(key);return next;});}}/>
      {preview&&!invalid.size&&<p><strong>{tr("保守外尺寸与单箱毛重","Conservative exterior and carton gross weight")}: {DIMENSION_AXES.map(a=>fromMillimeters(preview![a],unit).toFixed(3)).join(" × ")} {unit} · {preview.weight.toFixed(3)} kg</strong></p>}
      {previewError&&<p role="alert">{trText(previewError)}</p>}
      <button className="button" disabled={!changed||invalid.size>0||!!previewError} onClick={()=>{try{const next=request.products.map(p=>({...p,dimensionAllowance:parseDimensionAllowance(draft[p.id])}));onProducts(next);}catch(e){setMessage(e instanceof Error?e.message:String(e));}}}>{tr("保存偏差与附件规则","Save dimension and accessory rules")}</button> <button className="button" disabled={!changed&&!invalid.size} onClick={()=>{setDraft(Object.fromEntries(request.products.map(p=>[p.id,structuredClone(p.dimensionAllowance??emptyDimensionAllowance())])));setInvalid(new Set());setChanged(false);setEditorReset(n=>n+1);setComparison(null);setMessage("");}}>{tr("放弃未保存规则","Discard unsaved rules")}</button>
    </fieldset>
    <div className="upgrade-actions"><button className="button primary" disabled={disabled||busy||changed||invalid.size>0||!result?.validation.valid} onClick={run}>{tr("计算保守方案并对比","Compute conservative comparison")}</button>{busy&&<button className="button" onClick={()=>{worker.current?.terminate();worker.current=null;setBusy(false);setMessage(tr("已停止对比计算。","Comparison stopped."));}}>{tr("停止计算","Stop calculation")}</button>}</div>
    <label>{tr("恢复双方案报告（独立查看）","Restore comparison report (independent view)")}<input type="file" accept=".json,application/json" disabled={busy||disabled||changed||invalid.size>0} onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;try{if(file.size>50*1024*1024)throw new Error(tr("对比报告超过 50 MB","Comparison report exceeds 50 MB"));setComparison(parseDimensionComparisonReport(await file.text()));setMessage(tr("已按各自输入重新校验历史双方案；当前订单未改变。","Historical scenarios were revalidated against their own inputs; the current order is unchanged."));}catch(error){setComparison(null);setMessage(error instanceof Error?error.message:String(error));}}}/></label>
    <p role="status">{busy?tr("正在独立重排保守方案…","Repacking the conservative plan…"):trText(message)}</p>
    {comparison&&<DimensionComparisonResults comparison={comparison} disabled={disabled}/>}
  </div></details>;
}
