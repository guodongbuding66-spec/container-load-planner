"use client";
import {tr, tt, useLanguage, trText} from "./language";
import { ToolSummary } from "./workflow-tools";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ARCHIVE_KEY, addArchive, parseArchive, type ArchiveEntry } from "../lib/packing/archive";
import { parseWorkspaceBackup } from "../lib/packing/workspace-file";
import { explainUnloaded, diagnoseUnloadedPosition } from "../lib/packing/engine";
import { reviewFleet,fleetEconomics, type FleetComparison, type FleetOption, type FleetResult } from "../lib/packing/fleet";
import type { ContainerSpec, PackingRequest, PackingResult, ProductInput } from "../lib/packing/types";
import { TRANSPORT_PRESETS } from "../lib/packing/transport-library";
import { PlanViewer } from "./plan-viewer";
import type { CameraView } from "../lib/packing/camera-fit";
import { RemainingCapacity } from "./remaining-capacity";
import { NumericInput } from "./numeric-input";
import { SceneErrorBoundary } from "./scene-error-boundary";

import { OptimizationPanel } from "./optimization-panel";
import { offlineFieldHtml } from "../lib/packing/field-report";
import { usePlanEditor, type PlanEditor } from "./use-plan-editor";
import { SceneEditPanel } from "./scene-edit-panel";
import { fieldBlocks, fieldPlanFingerprint } from "../lib/packing/execution";
const Scene=dynamic(()=>import("./container-scene").then(m=>m.ContainerScene),{ssr:false});
function download(name:string, content:string, type="application/json") {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement("a"); a.href=url; a.download=name; a.hidden=true; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const errorMessage=(e:unknown)=>e instanceof Error?e.message:tr("操作未完成，请重试。");

export function ArchiveLibrary({backup,disabled,onRestore,onProducts}:{backup:string;disabled:boolean;onRestore:(backup:string)=>void;onProducts:(products:ProductInput[])=>void}) {
  useLanguage();
  const [entries,setEntries]=useState<ArchiveEntry[]>([]);
  const [name,setName]=useState("");
  const [message,setMessage]=useState("");
  const refresh=()=>{try { const list=parseArchive(localStorage.getItem(ARCHIVE_KEY)??"[]");setEntries(list);return list; }catch(e){setMessage(errorMessage(e));return null;}};
  const save=(kind:ArchiveEntry["kind"])=>{
    try { const current=refresh();if(!current)return;const next=addArchive(current,name,kind,backup);localStorage.setItem(ARCHIVE_KEY,JSON.stringify(next));setEntries(next);setMessage(tr("新版本已保存，旧版本仍保留。请定期导出工作区备份。")); }catch(e){setMessage(tt`保存失败，旧版本未覆盖：${errorMessage(e)}`);}
  };
  return <details className="upgrade-panel" onToggle={e=>{if(e.currentTarget.open)refresh();}}><ToolSummary kind="archive" title={tr("方案归档与产品版本库")} description={tr("保存、复制和恢复整套方案，让下一次报价从这里开始。")}/><div className="upgrade-body">
    <p>{tr("同名保存会新建版本。方案保留输入和已完成箱位，恢复时按当前规则重新校验；产品版本只替换箱规列表。数据保存在本浏览器，跨站点请使用备份文件。")}</p>
    <div className="upgrade-actions"><input aria-label={tr("归档名称")} maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder={tr("客户／订单／产品系列名称")}/><button className="button primary" disabled={disabled||!name.trim()} onClick={()=>save("project")}>{tr("保存方案版本")}</button><button className="button" disabled={disabled||!name.trim()} onClick={()=>save("products")}>{tr("保存产品版本")}</button></div>
    <p role="status">{trText(message)}</p>
    {!entries.length?<p>{tr("尚无归档。")}</p>:<div className="upgrade-table-wrap"><table><thead><tr><th>{tr("名称")}</th><th>{tr("类型／版本")}</th><th>{tr("时间")}</th><th>{tr("操作")}</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.id}><td>{entry.name}</td><td>{entry.kind==="project"?tr("方案"):tr("产品")} v{entry.version}</td><td>{new Date(entry.date).toLocaleString()}</td><td><button className="button small" disabled={disabled} onClick={()=>{try{const parsed=parseWorkspaceBackup(entry.backup);if(entry.kind==="project")onRestore(entry.backup);else if(window.confirm(tr("用此产品版本替换当前箱规？柜型和目标保持当前设置。")))onProducts(parsed.products);}catch(e){setMessage(errorMessage(e));}}}>{tr("恢复此版本")}</button> <button className="button small" onClick={()=>download(tt`工作区_${entry.kind}_v${entry.version}.json`,entry.backup)}>{tr("导出备份")}</button> <button className="button small" disabled={disabled||!name.trim()} onClick={()=>{try{const current=refresh();if(!current)return;const next=addArchive(current,name,"project",entry.backup);localStorage.setItem(ARCHIVE_KEY,JSON.stringify(next));setEntries(next);setMessage(tr("已复制为指定名称的新方案。"));}catch(e){setMessage(errorMessage(e));}}}>{tr("复制为上方名称")}</button> <button className="button small" onClick={()=>{if(!window.confirm(tr("删除这个本机版本？请先导出需要保留的数据。")))return;try{const current=refresh();if(!current)return;const next=current.filter(x=>x.id!==entry.id);localStorage.setItem(ARCHIVE_KEY,JSON.stringify(next));setEntries(next);}catch(e){setMessage(errorMessage(e));}}}>{tr("删除")}</button></td></tr>)}</tbody></table></div>}
  </div></details>;
}

export function BearingRules({products,disabled,onChange}:{products:ProductInput[];disabled:boolean;onChange:(products:ProductInput[])=>void}) {
  useLanguage();
  const [draft,setDraft]=useState<Record<string,Record<string,string>>>({});
  const [message,setMessage]=useState("");
  const change=(id:string,key:string,value:string)=>setDraft(d=>({...d,[id]:{...d[id],[key]:value}}));
  const apply=()=>{try{const parse=(s:string)=>{if(!s.trim())return undefined;const n=Number(s);if(!Number.isFinite(n)||n<0)throw new Error(tr("承重必须为非负数字"));return n;};const next=products.map(p=>{const d=draft[p.id];if(!d)return p;const n={...p,topLoadByVerticalAxis:{...p.topLoadByVerticalAxis}};if(d.total!==undefined)n.maxTopLoadKg=parse(d.total);for(const axis of ["length","width","height"] as const)if(d[axis]!==undefined){const v=parse(d[axis]);if(v===undefined)delete n.topLoadByVerticalAxis[axis];else n.topLoadByVerticalAxis[axis]=v;}if(d.allowed!==undefined)n.allowedAboveSkus=d.allowed.trim()?d.allowed.split(/[,，]/).map(x=>x.trim()).filter(Boolean):undefined;return n;});onChange(next);setDraft({});setMessage(tr("承重规则已提交，将重新计算。"));}catch(e){setMessage(errorMessage(e));}};
  return <details className="upgrade-panel"><ToolSummary kind="bearing" title={tr("包装承重规则")} description={tr("按箱型设置上压重量、摆放朝向和叠放要求。")}/><div className="upgrade-body"><p>{tr("累计上压重量包含所有上层箱。留空为承重未核验；0 禁止上压。朝向以哪条原始尺寸成为竖直方向确定，累计和朝向限制取较小值。白名单留空不限制，填写 SKU 后只允许这些箱型直接叠放。")}</p><div className="upgrade-rule-grid">{products.map(p=><fieldset key={p.id}><legend>{p.sku}</legend>{[["total",tr("累计上压"),p.maxTopLoadKg],["height",tr("平放（高朝上）"),p.topLoadByVerticalAxis?.height],["width",tr("侧放（宽朝上）"),p.topLoadByVerticalAxis?.width],["length",tr("立放（长朝上）"),p.topLoadByVerticalAxis?.length]].map(([key,label,value])=><label key={key}>{label} kg<input aria-label={`${p.sku} ${label} kg`} inputMode="decimal" value={draft[p.id]?.[key as string]??(value===undefined?"":String(value))} placeholder={tr("未核验")} onChange={e=>change(p.id,key as string,e.target.value)}/></label>)}<label>{tr("允许上方 SKU（逗号分隔）")}<input value={draft[p.id]?.allowed??p.allowedAboveSkus?.join(",")??""} onChange={e=>change(p.id,"allowed",e.target.value)}/></label></fieldset>)}</div><button className="button" onClick={apply} disabled={disabled||!Object.keys(draft).length}>{tr("应用承重规则并重算")}</button><p role="status">{trText(message)}</p></div></details>;
}

export function UnloadedReasons({result,products,onFocus}:{result:PackingResult;products:ProductInput[];onFocus?:(id:string)=>void}) {
  useLanguage();
  const [focused,setFocused]=useState<string|null>(null);
  const diagnosis=useMemo(()=>focused?diagnoseUnloadedPosition(result,products,focused):null,[result,products,focused]);
  const items=useMemo(()=>explainUnloaded(result,products),[result,products]);
  return <details className="upgrade-panel"><ToolSummary kind="diagnosis" title={result.mode==="single"&&result.metrics.loadedCount===0?tr("零装载原因","Zero-load diagnosis"):tt`未装入原因 · ${items.reduce((n,p)=>n+p.unloaded,0)} 箱`} description={tr("查看余货受到的限制，定位对应货物与空间。")}/><div className="upgrade-body">{focused?<figure><p>{trText(diagnosis?.detail??"")}</p><figcaption>{tr("当前 SKU 高亮；其他箱体灰显，空白仅代表俯视投影未占用，不代表完整可装空间。")}</figcaption><svg role="img" aria-label={tr("未装入货物位置与已占空间")} viewBox={`0 0 ${result.container.length} ${result.container.width}`} style={{width:"100%",maxHeight:220}}><rect width={result.container.length} height={result.container.width} fill="#f0f6f7"/>{[...result.placements].sort((a,b)=>Number(a.productId===focused)-Number(b.productId===focused)).map(b=><rect key={b.id} x={b.x} y={b.y} width={b.dx} height={b.dy} fill={b.productId===focused?b.color:"#b9cbd0"} stroke="white" strokeWidth={4}><title>{b.sku} · Z {b.z} mm</title></rect>)}{diagnosis?.candidate?<rect x={diagnosis.candidate.x} y={diagnosis.candidate.y} width={diagnosis.candidate.dx} height={diagnosis.candidate.dy} fill="none" stroke="#c04527" strokeWidth={12} strokeDasharray="30 15"><title>{tr("仅候选区域，尚未验证可装；Z ")}{diagnosis.candidate.z} mm</title></rect>:null}</svg><small>{tr("红色虚线仅表示诊断候选投影，尚未加入方案。")}</small></figure>:null}{!items.length?<p>{tr("本方案的需求已全部装入。")}</p>:items.map(p=><article key={p.productId}><strong>{p.sku}{result.mode==="single"&&p.loaded===0?tr(" · 当前容量为 0 件"," · Current capacity is zero"): <>{tr(" · 未装 ")}{p.unloaded}{tr(" 箱")}</>}</strong> <button className="button small" onClick={()=>{setFocused(p.productId);onFocus?.(p.productId);}}>{tr("定位货物与空间")}</button><ul>{p.reasons.map(reason=><li key={trText(reason)}>{trText(reason)}</li>)}</ul></article>)}</div></details>;
}

export function ManualPlan({result,products,onAdopt,disabled,editor:shared}:{result:PackingResult;products:ProductInput[];onAdopt:(result:PackingResult)=>void;disabled:boolean;editor?:PlanEditor}) {
  useLanguage();const own=usePlanEditor(result,products,disabled,onAdopt),editor=shared??own;
  const [open,setOpen]=useState(false),drag=useRef<{x:number;y:number;id:string}|null>(null);
  const draft=(editor.enabled||editor.changed)&&editor.plan?editor.plan:result;
  return <details className="upgrade-panel" onToggle={e=>setOpen(e.currentTarget.open)}><ToolSummary kind="manual" title={tr("手动调整箱位与锁定")} description={tr("与主三维共用多选、整组移动、吸附、撤销和校验。","Shared with the main 3D editor: multi-selection, group movement, snapping, undo and validation.")}/>{open&&<div className="upgrade-body"><SceneEditPanel editor={editor}/>
    <svg className="manual-map" viewBox={`0 0 ${draft.container.length-draft.clearance*2} ${draft.container.width-draft.clearance*2}`} role="img" aria-label={tr("可拖动箱位俯视图")} onPointerUp={e=>{const start=drag.current;drag.current=null;if(!start)return;const svg=e.currentTarget,matrix=svg.getScreenCTM();if(!matrix)return;const point=svg.createSVGPoint();point.x=start.x;point.y=start.y;const a=point.matrixTransform(matrix.inverse());point.x=e.clientX;point.y=e.clientY;const b=point.matrixTransform(matrix.inverse());editor.move({x:b.x-a.x,y:b.y-a.y,z:0});}} onPointerCancel={()=>{drag.current=null;}}><rect width={draft.container.length-draft.clearance*2} height={draft.container.width-draft.clearance*2} fill="#eff7f8"/>{[...draft.placements].sort((a,b)=>a.z-b.z).map(b=><rect key={b.id} x={b.x} y={b.y} width={b.dx} height={b.dy} fill={b.color} fillOpacity={.75} stroke={editor.selected.some(s=>s.id===b.id)?"#102f39":"white"} strokeWidth={editor.selected.some(s=>s.id===b.id)?18:4} onPointerDown={e=>{editor.select(b.id,e.shiftKey);if(editor.enabled&&!editor.disabled){drag.current={x:e.clientX,y:e.clientY,id:b.id};e.currentTarget.setPointerCapture(e.pointerId);}}}><title>{b.sku}</title></rect>)}</svg>
    {!draft.palletization?<OptimizationPanel key={draft.id} plan={draft} products={products} disabled={disabled} onAdopt={onAdopt}/>:<p>{tr("预打托方案请在整托工具中重新生成；散箱优化不会拆开完整托盘。","Regenerate prebuilt loads in the pallet tool; loose-carton optimization does not split complete pallets.")}</p>}
  </div>}</details>;
}

export function FieldGuide({result}:{result:PackingResult}) {
  useLanguage();
  const [step,setStep]=useState(0);
  const [open,setOpen]=useState(false);
  const [message,setMessage]=useState("");
  const box=result.placements[step];
  const fingerprint=fieldPlanFingerprint(result);
  const key=`cargo-fit-field-${result.container.id}-${result.placements.reduce((hash,b)=>{const s=`${b.id}:${b.x}:${b.y}:${b.z}`;for(let i=0;i<s.length;i++)hash=Math.imul(hash^s.charCodeAt(i),16777619);return hash;},2166136261)}`;
  const setProgress=(value:number)=>{setStep(value);try{localStorage.setItem(key,JSON.stringify({fingerprint,step:value}));setMessage(tr("现场进度已保存。"));}catch{setMessage(tr("现场进度未能保存，请保持此页面开启。"));}};
  const exportGuide=()=>download(tr("装柜离线作业.html"),offlineFieldHtml(result),"text/html;charset=utf-8");
  const [blockMode,setBlockMode]=useState(false);
  const [fullscreen,setFullscreen]=useState(false);
  const block=fieldBlocks(result).find(g=>g.indices.includes(step));
  return <details className="upgrade-panel" onToggle={e=>{setOpen(e.currentTarget.open);if(e.currentTarget.open){try{const saved=JSON.parse(localStorage.getItem(key)??"null");if(saved?.fingerprint===fingerprint&&Number.isInteger(saved.step)&&saved.step>=0&&saved.step<=result.placements.length)setStep(saved.step);}catch{setMessage(tr("本机进度不可用。"));}}}}><ToolSummary kind="field" title={tr("仓库作业模式与离线指导书")} description={tr("按箱或区块确认进度，在现场照着方案装柜。")}/><div className={fullscreen?"upgrade-body field-fullscreen":"upgrade-body"}>{open?<>{result.palletization&&<p>{tr("先在柜外完成每托货物，再按完整托盘装入柜内。逐箱进度用于核对托内清单，不能拆成逐箱入柜执行。","Build every pallet load outside the container, then load complete pallets. Carton progress checks pallet contents; it is not a loose-carton loading sequence.")}</p>}<p>{result.strategy==="practical"?tr("按已校验的现场方案执行。"):tr("当前为高密度参考方案，侧翻和局部承托须由现场确认。")}</p><div className="field-step"><button className="button" onClick={()=>setFullscreen(!fullscreen)}>{fullscreen?tr("退出仓库全屏"):tr("进入手机仓库全屏")}</button><label><input type="checkbox" checked={blockMode} onChange={e=>setBlockMode(e.target.checked)}/>{tr("按区块确认")}</label><strong>{tr("已确认 ")}{step} / {result.placements.length}{tr(" 箱")}</strong>{box?<><h3>{tr("下一箱：")}{box.sku}</h3><p>{box.setCode?tt`${box.setCode} · 第 ${box.setNumber} 套`:tr("散箱")}{tr(" · 第 ")}{box.layer}{tr(" 层")}</p><p>{tr("第 ")}{block?.zone}{tr(" 区 · 本区块待装 ")}{block?.indices.filter(i=>i>=step).length}{tr(" 箱 · 此 SKU 剩余 ")}{result.placements.slice(step).filter(b=>b.sku===box.sku).length}{tr(" 箱")}</p><p>{tr("位置 ")}{box.x} / {box.y} / {box.z} mm</p><p>{tr("摆放 ")}{box.dx} × {box.dy} × {box.dz} mm · {box.weight} kg</p></>:<h3>{tr("本柜已确认完成")}</h3>}</div><div className="upgrade-actions"><button className="button" disabled={step===0} onClick={()=>setProgress(Math.max(0,step-1))}>{tr("返回上一箱")}</button><button className="button primary" disabled={!box} onClick={()=>setProgress(blockMode&&block?block.indices.at(-1)!+1:step+1)}>{blockMode?tr("确认此区块已装"):tr("确认此箱已装")}</button><button className="button" onClick={exportGuide}>{tr("下载离线指导书")}</button></div><p role="status">{trText(message)}</p></>:null}</div></details>;
}

function fleetLabel(label:string){if(label==="混合柜型")return tr("混合柜型","Mixed vehicles");if(label.startsWith("全部 "))return `${tr("全部","All")} ${tr(label.slice(3))}`;return label.split(" + ").map(name=>tr(name)).join(" + ");}
export function FleetPlanner({request,disabled,customContainers=[]}:{request:PackingRequest;disabled:boolean;customContainers?:ContainerSpec[]}) {
  useLanguage();
  const [open,setOpen]=useState(false);
  const [runSettings,setRunSettings]=useState<{options:FleetOption[];objective:string;limit:number;topUp:number;compare:boolean}|null>(null);
  const [viewer,setViewer]=useState(false);
  const [options,setOptions]=useState<FleetOption[]>(()=>[...new Map([...TRANSPORT_PRESETS.filter(c=>(c.category??"container")===(request.container.category??"container")),...customContainers.filter(c=>(c.category??"container")===(request.container.category??"container")),request.container].map(c=>[c.id,c])).values()].map(container=>({container,cost:0,available:10})));
  const [enabled,setEnabled]=useState(()=>options.map(o=>o.container.id===request.container.id || ((request.container.category??"container")==="container" && ["20gp","40gp","40hq"].includes(o.container.id))));
  const [limit,setLimit]=useState(10);
  const [comparisons,setComparisons]=useState<FleetComparison[]>([]);
  const [topUp,setTopUp]=useState(0);
  const [proposal,setProposal]=useState<{result:FleetResult;additions:{sku:string;quantity:number}[]}|null>(null);
  const [objective,setObjective]=useState<"count"|"cost">("count");
  const [state,setState]=useState<FleetResult|null>(null);
  const [running,setRunning]=useState(false);
  const [message,setMessage]=useState("");
  const [selected,setSelected]=useState(0);
  const [view,setView]=useState<CameraView>("perspective");
  const [projection,setProjection]=useState<"perspective"|"orthographic">("perspective");
  const [validity,setValidity]=useState<Record<string,boolean>>({});
  const worker=useRef<Worker|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;setRunning(false);};
  useEffect(()=>()=>{worker.current?.terminate();if(timer.current)clearTimeout(timer.current);},[]);
  const calculate=(compare=false)=>{stop();setComparisons([]);setProposal(null);setRunSettings({options:options.filter((_,i)=>enabled[i]).map(o=>({...o})),objective,limit,topUp,compare});setState(null);setSelected(0);setMessage(tr("正在逐柜分配，每完成一柜即可查看。费用按同一币种输入。"));try{
    const w=new Worker(new URL("../lib/packing/fleet.worker.ts",import.meta.url),{type:"module"});worker.current=w;setRunning(true);
    w.onmessage=e=>{if(worker.current!==w)return;if(e.data.type==="comparisons"||e.data.type==="comparison-result"){setComparisons(e.data.comparisons);setState(e.data.comparisons[0]?.result??null);setSelected(0);if(e.data.type==="comparison-result"){setState(e.data.comparisons[0]?.result??null);setProposal(e.data.proposal);stop();setMessage(e.data.proposalError?tt`柜型组合已完成，加货建议未生成：${e.data.proposalError}`:tr("柜型组合比较完成；增加数量仅为建议，不会修改原订单。"));}return;}if(e.data.type==="error"){stop();setMessage(e.data.message);return;}setState(e.data.result);if(e.data.type==="result"){stop();setMessage(e.data.result.reason);}};
    w.onerror=()=>{if(worker.current!==w)return;stop();setMessage(tr("计算线程异常，已完成的柜仍可查看和导出。"));};
    timer.current=setTimeout(()=>{stop();setMessage(tr("已达到 120 秒时限，保留已完成柜。可减少候选柜型或分批计算。"));},120000);
    w.postMessage({request,options:options.filter((_,i)=>enabled[i]),limit,objective,compare,topUp});
  }catch(e){stop();setMessage(errorMessage(e));}};
  const invalidOptions=validity.limit===false||enabled.some((use,i)=>use&&(validity[`cost${i}`]===false||validity[`count${i}`]===false));
  const selectedPlan=state?.loads[selected]?.plan;
  return <details className="upgrade-panel" onToggle={e=>setOpen(e.currentTarget.open)}>{viewer && state && <PlanViewer plans={state.loads.map(l=>l.plan)} onClose={()=>setViewer(false)}/>}<ToolSummary kind="fleet" title={tr("整单多柜分配与费用比较")} description={tr("设置可用柜型和运费，比较整单分配与尾柜方案。")}/><div className="upgrade-body">{state?.loads.length?<button className="button" onClick={()=>setViewer(true)}>{tr("多柜三维查看器")}</button>:null}<p>{tr("逐柜比较可用柜型，保留完整套装；柜数优先选择当前能多装货的方案，费用优先按已装体积比较单柜费用。属于启发式分配，不保证全局最低费用。费用使用同一币种。费用优先模式必须填写各候选柜型的实际费用；更改设置在下次分配时生效。")}</p>
    <div className="upgrade-rule-grid">{options.map((o,i)=><div key={o.container.id}><label><input disabled={running} type="checkbox" checked={enabled[i]} onChange={e=>setEnabled(a=>a.map((v,j)=>i===j?e.target.checked:v))}/>{tr(o.container.name)}</label><label>{tr("每柜费用")}<NumericInput ariaLabel={tt`${tr(o.container.name)} 每柜费用`} value={o.cost} onValueChange={cost=>setOptions(a=>a.map((v,j)=>i===j?{...v,cost}:v))} onValidityChange={valid=>setValidity(a=>({...a,[`cost${i}`]:valid}))}/></label><label>{tr("可用柜数")}<NumericInput ariaLabel={tt`${tr(o.container.name)} 可用柜数`} integer min={1} max={50} value={o.available} onValueChange={available=>setOptions(a=>a.map((v,j)=>i===j?{...v,available}:v))} onValidityChange={valid=>setValidity(a=>({...a,[`count${i}`]:valid}))}/></label></div>)}</div>
    <div className="upgrade-actions"><label>{tr("最多分配柜数")}<NumericInput ariaLabel={tr("最多分配柜数")} integer min={1} max={50} value={limit} onValueChange={setLimit} onValidityChange={valid=>setValidity(a=>({...a,limit:valid}))}/></label><label>{tr("优化目标")}<select aria-label={tr("多柜优化目标")} value={objective} onChange={e=>setObjective(e.target.value as "count"|"cost")}><option value="count">{tr("柜数优先")}</option><option value="cost">{tr("费用优先")}</option></select></label><button className="button primary" disabled={disabled||running||!enabled.some(Boolean)||invalidOptions} onClick={()=>calculate()}>{tr("分配整张订单")}</button><button className="button" disabled={!running} onClick={()=>{stop();setMessage(tr("已停止，保留已完成柜；剩余订单尚未全部处理。"));}}>{tr("停止并保留已完成柜")}</button></div><div className="upgrade-actions"><label>{tr("允许增加数量 %")}<NumericInput ariaLabel={tr("订单允许增加比例")} min={0} max={20} value={topUp} onValueChange={setTopUp} onValidityChange={valid=>setValidity(a=>({...a,topUp:valid}))}/></label><button className="button" disabled={disabled||running||!enabled.some(Boolean)||invalidOptions||validity.topUp===false} onClick={()=>calculate(true)}>{tr("比较柜型组合与尾柜")}</button></div><p role="status">{trText(message)}</p>
    {comparisons.length?<div className="upgrade-table-wrap"><table><thead><tr><th>{tr("组合")}</th><th>{tr("柜数")}</th><th>{tr("完整套／散箱单位")}</th><th>{tr("余货箱")}</th><th>{tr("总费／每单位")}</th><th>{tr("装卸／配重复核","Access / balance review")}</th><th>{tr("约束因素","Constraints")}</th><th>{tr("查看")}</th></tr></thead><tbody>{comparisons.map((c,i)=><tr key={i}><td>{fleetLabel(c.label)}</td><td>{c.result.loads.length}</td><td>{c.allocatedSets}</td><td>{c.result.remaining.reduce((n,p)=>n+p.quantity,0)}</td><td>{c.costPerSet===null?tr("费用未填写"):`${c.result.totalCost.toFixed(2)} / ${c.costPerSet.toFixed(2)}`}</td><td>{c.review.pathIssues} / {c.review.balanceWarnings}<small> · {c.review.unassigned} {tr("站次未填","unassigned stops")}</small></td><td>{c.review.constraints.map(k=>({payload:tr("载重","Payload"),space:tr("空间","Space"),door:tr("门洞","Door"),sequence:tr("装卸顺序","Sequence"),support:tr("承托","Support"),"stock / dimensions / orientation / kit / support":tr("柜型库存／尺寸／朝向／整套／承托限制","Stock / size / orientation / kit / support"),"unassigned stops":tr("缺少站次","Unassigned stops")} as Record<string,string>)[k]??k).join(" · ")||"—"}</td><td><button className="button small" disabled={running} onClick={()=>{setState(c.result);setSelected(0);}}>{tr("查看组合 ")}{i+1}</button></td></tr>)}</tbody></table></div>:null}
    {proposal?<p>{tr("不增加柜数和总费用的加货建议：")}{proposal.additions.filter(a=>a.quantity>0).map(a=>tt`${a.sku} +${a.quantity} 箱`).join("；")}。<button className="button" onClick={()=>download(tr("加货建议.json"),JSON.stringify(proposal,null,2))}>{tr("导出建议与校验箱位")}</button></p>:comparisons.length&&!running&&runSettings?.topUp?<p>{tr("未找到在允许范围内、不增加费用且保留原订单全部数量的加货方案。")}</p>:null}
    {state?<><p>{tr("直线路径待复核","Straight-path review")}: {reviewFleet(state).pathIssues} · {tr("配重提示","Balance notices")}: {reviewFleet(state).balanceWarnings} · {tr("缺少卸货站次","Unassigned unload stops")}: {reviewFleet(state).unassigned}</p><p className="feature-note">{tr("路径列先比较保守直线通道；选中柜可在三维工作台运行抬升／转向检查。站次缺失时不评定卸货便利性，未知费用不作最低费用结论。","Path columns compare conservative straight corridors; run lifting / turning checks in the selected plan workbench. Missing stops leave unload convenience ungraded; unknown costs cannot establish minimum cost.")}</p><p><strong>{state.loads.length}{tr(" 柜 · ")}{state.loads.some(l=>l.cost===0)?tr("费用未完整填写"):tt`费用合计 ${state.totalCost.toFixed(2)}`}{tr(" · 剩余 ")}{state.remaining.reduce((n,p)=>n+p.quantity,0)}{tr(" 箱")}</strong></p><p>{tr("运费按每柜实际占用体积分摊：")}{fleetEconomics(state).map(a=>tt`${a.code} ${a.sets} 单位，${state.loads.some(l=>l.cost===0)?tr("费用未完整填写"):tt`${a.costPerSet?.toFixed(2)} /单位`}`).join("；")}</p><div className="upgrade-actions"><button className="button" onClick={()=>download(tr("多柜分配方案.json"),JSON.stringify({request,...runSettings,...state},null,2))}>{tr("导出全部柜方案")}</button></div><div className="upgrade-table-wrap"><table><thead><tr><th>{tr("柜号")}</th><th>{tr("柜型")}</th><th>{tr("箱数")}</th><th>{tr("利用率")}</th><th>{tr("费用")}</th><th>{tr("方案")}</th></tr></thead><tbody>{state.loads.map((l,i)=><tr key={i}><td>{i+1}</td><td>{tr(l.plan.container.name)}</td><td>{l.plan.metrics.loadedCount}</td><td>{(l.plan.metrics.volumeUtilization*100).toFixed(1)}%</td><td>{l.cost===0?tr("未填写"):l.cost.toFixed(2)}</td><td><button className="button small" onClick={()=>setSelected(i)}>{tr("查看第 ")}{i+1}{tr(" 柜")}</button></td></tr>)}</tbody></table></div>{state.remaining.some(p=>p.quantity>0)?<p>{tr("未分配：")}{state.remaining.filter(p=>p.quantity>0).map(p=>tt`${p.sku} ${p.quantity} 箱`).join("；")}</p>:null}</>:null}
    {selectedPlan&&open?<section aria-label={tr("多柜选中方案")}><h3>{tr("第 ")}{selected+1}{tr(" 柜 · ")}{tr(selectedPlan.container.name)}</h3><RemainingCapacity result={selectedPlan}/><SceneErrorBoundary resetKey={selectedPlan.id}><Scene result={selectedPlan} visibleProducts={new Set(selectedPlan.summaries.map(s=>s.productId))} visibleCount={selectedPlan.placements.length} cameraView={view} projectionMode={projection} onCameraViewChange={v=>setView(v as typeof view)} onProjectionModeChange={setProjection}/></SceneErrorBoundary><FieldGuide key={selectedPlan.id} result={selectedPlan}/></section>:null}
  </div></details>;
}
