"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {adoptFleetOptimization,buildFleetOptimizationCsv,createFleetOptimizationSearch,minimumFleetPrefix,prepareFleetOptimization,type FleetOptimizationReport,type FleetOptimizationSettings} from "../lib/packing/fleet-optimization";
import type {FleetSnapshot} from "../lib/packing/fleet-tail";
import {NumericInput} from "./numeric-input";
import {tr,useLanguage} from "./language";

type Props={value:FleetSnapshot;sourceKey:string;enabled:boolean;canApply:boolean;onApply?:(next:FleetSnapshot)=>boolean};
export function useFleetOptimization(props:Props&{settings:FleetOptimizationSettings}){
 const key=JSON.stringify([props.value,props.sourceKey,props.enabled,props.canApply,props.settings]),identity=useMemo(()=>({key}),[key]),latest=useRef<typeof identity|null>(identity),generation=useRef(0),worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [state,setState]=useState<{identity:typeof identity;generation:number;status:"running"|"done"|"error"|"timeout"|"cancelled";completed:number;total:number;report?:FleetOptimizationReport}|null>(null);
 const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
 useLayoutEffect(()=>{latest.current=identity;return()=>{latest.current=null;worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);};},[identity]);
 const current=state?.identity===identity?state:null,running=current?.status==="running",observed=state?.generation??0;
 const run=()=>{
  if(!props.enabled||running||latest.current!==identity||observed!==generation.current)return;
  stop();const revision=++generation.current;
  try{
   const prepared=prepareFleetOptimization(props.value,props.settings),search=createFleetOptimizationSearch(prepared),deadline=Date.now()+30000,w=new Worker(new URL("../lib/packing/fleet-optimization.worker.ts",import.meta.url),{type:"module"});worker.current=w;let completed=0,ready=false;
   const active=()=>latest.current===identity&&worker.current===w&&generation.current===revision;
   const fail=(status:"error"|"timeout")=>{if(!active())return;stop();setState({identity,generation:revision,status,completed,total:search.total});};
   const advance=()=>{if(Date.now()>=deadline){fail("timeout");return;}const next=search.next();if(next){w.postMessage({type:"solve",...next});return;}const report=search.finish();stop();setState({identity,generation:revision,status:"done",completed,total:completed,report});};
   setState({identity,generation:revision,status:"running",completed,total:search.total});timer.current=setTimeout(()=>fail("timeout"),30000);
   w.onmessage=e=>{
    if(!active())return;
    try{
     if(Date.now()>=deadline){fail("timeout");return;}
     if(e.data.type==="error")throw Error("Optimization worker failed");
     if(e.data.type==="ready"&&!ready){ready=true;advance();return;}
     if(!ready||e.data.type!=="result"||e.data.index!==completed)throw Error("Invalid optimization reply");
     completed=search.accept(e.data.index,e.data.result);if(Date.now()>=deadline){fail("timeout");return;}
     setState({identity,generation:revision,status:"running",completed,total:search.total});advance();
    }catch{fail("error");}
   };
   w.onerror=()=>fail("error");w.postMessage({type:"initialize",source:prepared.source,settings:prepared.settings});
  }catch{stop();setState({identity,generation:revision,status:"error",completed:0,total:0});}
 };
 const cancel=()=>{if(latest.current!==identity||!running||observed!==generation.current)return;stop();setState({identity,generation:++generation.current,status:"cancelled",completed:current?.completed??0,total:current?.total??0});};
 const getReport=()=>latest.current===identity&&props.enabled&&current?.generation===generation.current&&current.status==="done"?current.report:undefined;
 const apply=()=>{const report=getReport();if(!report||!props.canApply||!props.onApply)return false;try{return props.onApply(adoptFleetOptimization(prepareFleetOptimization(props.value,props.settings),report));}catch{return false;}};
 return {current,running,run,cancel,getReport,apply};
}

export function FleetOptimization(props:Props){
 const language=useLanguage(),[mode,setMode]=useState<FleetOptimizationSettings["mode"]>("reallocate"),minimum=minimumFleetPrefix(props.value,mode),[keepPrefix,setKeepPrefix]=useState(()=>minimumFleetPrefix(props.value)),[cartonBudget,setCartonBudget]=useState(64),[comparePackaging,setComparePackaging]=useState(true);
 const [quoted,setQuoted]=useState({dismantle:false,rebuild:false}),[prices,setPrices]=useState({dismantle:0,rebuild:0}),[source,setSource]=useState(""),[valid,setValid]=useState<Record<string,boolean>>({}),[failed,setFailed]=useState(false);
 const unitFill=mode==="fill-units",hasRemainder=props.value.result.remaining.some(p=>p.quantity>0),inventory=props.value.result.inventory;
 const hasStock=!!inventory&&inventory.totalUsed<inventory.totalLimit&&inventory.packages.some(p=>p.remaining>0);
 const quoteKeys:readonly (keyof typeof quoted)[]=unitFill?["rebuild"]:["dismantle","rebuild"];
 const quotesReady=mode==="fill"||quoteKeys.every(k=>!quoted[k]||valid[k]!==false)&&(!quoteKeys.some(k=>quoted[k])||!!source.trim())&&(props.value.objective!=="cost"||quoteKeys.every(k=>quoted[k]));
 const ready=valid.prefix!==false&&valid.budget!==false&&keepPrefix>=minimum&&keepPrefix<=props.value.result.loads.length&&quotesReady
  &&(mode==="reallocate"||hasRemainder&&keepPrefix<props.value.result.loads.length)&&(!unitFill||hasStock);
 const settings:FleetOptimizationSettings={mode,keepPrefix,cartonBudget,comparePackaging,rework:mode==="fill"?{dismantle:null,rebuild:null,source:""}:{dismantle:!unitFill&&quoted.dismantle?prices.dismantle:null,rebuild:quoted.rebuild?prices.rebuild:null,source}},task=useFleetOptimization({...props,enabled:props.enabled&&ready,settings}),report=task.current?.report;
 const budgetLabel=unitFill?tr("整托试算箱数上限","Complete-unit trial carton ceiling"):tr("新增散箱上限","Additional loose ceiling");
 const download=(format:"json"|"csv")=>{try{const r=task.getReport();if(!r)return;const text=format==="json"?JSON.stringify(r,null,2):buildFleetOptimizationCsv(r,language==="en"),url=URL.createObjectURL(new Blob([text],{type:format==="json"?"application/json;charset=utf-8":"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=`fleet-optimization-${r.engineVersion}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setFailed(false);}catch{setFailed(true);}};
 const money=(n:number|null)=>n===null?tr("未完整报价","Incomplete quote"):n.toFixed(2);
 return <section className="tail-economic-preview tabular-nums" aria-label={tr("自动整单优化","Automatic fleet optimization")}>
  <h4 className="text-balance">{tr("自动整单优化","Automatic fleet optimization")}</h4>
  <p className="helper-text text-pretty">{tr("自动选择多个订单行／完整套装的散箱配额，并比较现有包装。原订单、已装柜和共享库存受到独立校验保护，预览不会修改工作区。","Automatically choose loose quotas for multiple order rows / whole kits and compare existing packaging. Independent checks protect demand, committed containers and shared stock. Previewing does not change the workspace.")}</p>
  <fieldset disabled={task.running} className="fleet-optimization-controls">
   <legend className="sr-only">{tr("本轮优化设置","Optimization settings")}</legend>
   <div className="upgrade-actions">
    <label>{tr("优化方式","Operation")}<select aria-label={tr("自动整单优化方式","Automatic fleet operation")} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setFailed(false);}}><option value="reallocate">{tr("重排未封存柜","Reallocate open containers")}</option><option value="fill" disabled={!hasRemainder}>{tr("只补现有柜散箱，原箱托不动","Fill gaps with loose cartons; retain positions")}</option><option value="fill-units" disabled={!hasRemainder||!hasStock}>{tr("只补完整整托，原箱托不动","Fill gaps with complete units; retain positions")}</option></select></label>
    <label>{tr("保留前几柜","Committed prefix")}<NumericInput ariaLabel={tr("自动优化保留前几柜","Optimization committed prefix")} integer min={minimum} max={props.value.result.loads.length} value={keepPrefix} onValueChange={setKeepPrefix} onValidityChange={v=>setValid(s=>({...s,prefix:v}))}/></label>
    <label>{budgetLabel}<NumericInput ariaLabel={unitFill?budgetLabel:tr("自动优化新增散箱上限","Optimization additional loose ceiling")} integer min={1} max={64} value={cartonBudget} onValueChange={setCartonBudget} onValidityChange={v=>setValid(s=>({...s,budget:v}))}/></label>
   </div>
   <small>{tr("当前模式至少保留前","The current operation requires at least ")}{minimum}{tr("柜的完整箱位与编号。补货时保留其余原箱托。"," committed containers with all positions and IDs. Gap filling retains the other original cartons and units.")}</small>
   {unitFill&&<p>{tr("只用原订单余货和剩余包装，在已开柜的地板空隙补入完整单元。按顺序核对后门直线净空或敞口顶部净空。","Prepare intact units from order remainders and available packaging for open-container floor gaps. Check straight rear-door or open-top clearance in insertion order.")}</p>}
   <label className="fleet-optimization-check"><input type="checkbox" checked={comparePackaging} disabled={mode!=="reallocate"} onChange={e=>setComparePackaging(e.target.checked)}/>{tr("比较现有包装的列表顺序与紧凑选择","Compare ordered and compact selection of existing packaging")}</label>
   <fieldset disabled={mode==="fill"} className="fleet-optimization-rework">
    <legend>{unitFill?tr("本轮新增打托报价","New unit preparation quote"):tr("本轮拆托与重打报价","Dismantling and rebuilding quotes")}</legend>
    <div className="upgrade-rule-grid">{quoteKeys.map(k=><div key={k}><label><input aria-label={k==="dismantle"?tr("拆托已报价","Dismantling quoted"):unitFill?tr("新增打托已报价","Unit preparation quoted"):tr("重打已报价","Rebuilding quoted")} type="checkbox" checked={quoted[k]} onChange={e=>{setQuoted(s=>({...s,[k]:e.target.checked}));setValid(s=>({...s,[k]:true}));}}/>{k==="dismantle"?tr("每个原托拆托费已报价","Dismantling per original unit quoted"):unitFill?tr("每个新增整托的打托费已报价","Preparation per new unit quoted"):tr("每个新托重打费已报价","Rebuilding per new unit quoted")}</label>{quoted[k]?<label>{tr("单价（免费填 0）","Unit price (zero for free)")}<NumericInput ariaLabel={k==="dismantle"?tr("自动优化拆托单价","Optimization dismantling unit price"):unitFill?tr("新增打托单价","Unit preparation price"):tr("自动优化重打单价","Optimization rebuilding unit price")} value={prices[k]} max={1e7} onValueChange={n=>setPrices(s=>({...s,[k]:n}))} onValidityChange={v=>setValid(s=>({...s,[k]:v}))}/></label>:<small>{tr("未报价，费用保持未知","Unquoted; cost remains unknown")}</small>}</div>)}</div>
    <label>{tr("报价来源","Quote source")}<input aria-label={tr("自动优化报价来源","Optimization quote source")} maxLength={500} value={source} onChange={e=>setSource(e.target.value)}/></label>
    <small>{unitFill?tr("新整托按实际采用的打托数计费。费用优先需要报价和来源。","Preparation is charged for actual new units. Cost priority requires a quote and source."):tr("重排时，拆托按原未封存托数计费，重打按实际新托数计费。只补散箱时，两项工作量均为零。","Reallocation charges dismantling for original open units and rebuilding for actual new units. Loose gap filling has zero preparation work.")}</small>
   </fieldset>
  </fieldset>
  <div className="upgrade-actions"><button type="button" className="button" disabled={!props.enabled||!ready||task.running} onClick={()=>{setFailed(false);task.run();}}>{tr("预览自动整单优化","Preview automatic fleet optimization")}</button>{task.running&&<button type="button" className="button" onClick={task.cancel}>{tr("停止自动优化","Stop automatic optimization")}</button>}</div>
  <small>{tr("最多 64 个源行／完整套装、64 个候选、每候选 64 箱、4000 箱订单／20 柜、30 秒。小网格完整比较，较大范围采用有界搜索。","Limits are 64 rows / whole kits, 64 candidates, 64 trial cartons per candidate, 4000 order cartons / 20 containers and 30 seconds. Small grids are exhausted and larger searches are bounded.")}</small>
  {!props.enabled&&<p role="status">{tr("请先运行当前设置的整单分配；修改库存、报价或目标后须重新分配。","Run allocation for the current settings first; reallocate after changing stock, quotes or objectives.")}</p>}
  {props.enabled&&!ready&&<p role="status">{tr("请检查可用余货、包装库存、前缀、上限及所需报价。","Check available demand, packaging stock, prefix, ceiling and the required quotes.")}</p>}
  {task.current&&<p role="status">{task.running?tr("正在逐候选独立复核，尚未采用。","Independently reviewing candidates; not applied."):task.current.status==="done"?tr("自动整单优化完成，候选尚未采用。","Automatic fleet optimization complete; candidate not applied."):task.current.status==="timeout"?tr("30 秒预算结束，部分结果不能采用。","The 30-second budget expired; partial results cannot be applied."):task.current.status==="cancelled"?tr("已停止，正式多柜方案保持。","Stopped; the formal fleet is retained."):tr("本轮未通过，请核对设置后重新预览。","This batch failed; check the settings and preview again.")} {task.current.completed} / {task.current.total}</p>}
  {report&&<>
   <p>{report.search.kind==="complete-grid"?tr("完整网格","Complete grid"):tr("有界自适应搜索","Bounded adaptive search")} · {report.groups.length}{tr(" 组"," groups")} · {report.search.evaluated}{tr(" 个完整候选"," complete candidates")}{!report.best?tr("；没有逐行不减量且改善当前目标的候选。","; no candidate retains every row and improves the objective."):""}</p>
   <div className="upgrade-table-wrap" tabIndex={0} role="region" aria-label={tr("自动整单候选比较","Automatic fleet candidate comparison")}><table><thead><tr>{[tr("候选／新增箱数","Candidate / added cartons"),tr("包装选择","Packaging selection"),tr("柜数","Containers"),tr("已装／余货","Loaded / remaining"),tr("包装／散箱","Packaging / loose"),tr("拆托／重打","Dismantled / rebuilt"),tr("拆托重打费","Rework cost"),tr("配置费用合计","Configured total"),tr("逐行不减量","Retains every row")].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody><tr><th>{tr("原整单","Baseline fleet")}</th><td>—</td><td>{props.value.result.loads.length}</td><td>{props.value.result.loads.reduce((n,l)=>n+l.plan.placements.length,0)} / {props.value.result.remaining.reduce((n,p)=>n+p.quantity,0)}</td><td>{props.value.result.inventory?.totalUsed??0} / {props.value.result.inventory?.loose.reduce((n,r)=>n+r.used,0)??0}</td><td>0 / 0</td><td>0</td><td>{money(props.value.result.costs?.total??null)}</td><td>—</td></tr>{report.candidates.map(c=><tr key={c.index}><th>{c.index+1} · +{c.addedCartons}{report.bestIndex===c.index?tr(" · 本轮选中"," · Selected in batch"):""}</th><td>{c.spec.selection==="compact"?tr("紧凑","Compact"):tr("列表顺序","Ordered")}</td><td>{c.containers}</td><td>{c.loaded} / {c.remaining}</td><td>{c.packaging} / {c.loose}</td><td>{c.dismantled} / {c.rebuilt}</td><td>{money(c.reworkTotal)}</td><td>{money(c.configuredTotal)}</td><td>{c.retainsRows?tr("通过","Pass"):tr("未通过","Fail")}</td></tr>)}</tbody></table></div>
   {report.best&&<div className="upgrade-table-wrap" tabIndex={0} role="region" aria-label={tr("自动优化选中候选源行","Selected automatic candidate source rows")}><table><thead><tr>{[tr("源订单行","Source row"),tr("需求","Requested"),tr("原已装","Before"),tr("候选已装","After"),tr("全单配额","Global quota"),tr("散箱／托内","Loose / palletized")].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{report.candidates[report.bestIndex!].rows.map(r=><tr key={r.id}><th>{r.label}<small> · {r.id}</small></th><td>{r.requested}</td><td>{r.before}</td><td>{r.loaded}</td><td>{r.reserved}</td><td>{r.loose} / {r.palletized}</td></tr>)}</tbody></table></div>}
   <div className="upgrade-actions"><button type="button" className="button primary" disabled={!report.best||!props.canApply||!props.onApply} onClick={()=>setFailed(!task.apply())}>{unitFill?tr("采用整托补入","Adopt complete-unit fill"):tr("采用自动优化并更新工作区","Apply automatic optimization and update workspace")}</button><button type="button" className="button" onClick={()=>download("json")}>{tr("下载自动优化 JSON","Download automatic optimization JSON")}</button><button type="button" className="button" onClick={()=>download("csv")}>{tr("下载自动优化 CSV","Download automatic optimization CSV")}</button></div>
  </>}
  <small>{tr("采用会保存已复核的完整多柜方案及已装前缀。配额或包装配置改变时，主柜按新配置独立重算。请另存多柜备份以保留各柜坐标及费用。","Applying retains the reviewed full fleet and committed prefix. The main container recalculates if quotas or packaging settings change. Save a fleet backup for all container positions and costs.")}</small>
  {failed&&<p role="alert">{tr("候选已失效或导出失败，请重新预览。","The candidate is stale or export failed; preview again.")}</p>}
 </section>;
}
