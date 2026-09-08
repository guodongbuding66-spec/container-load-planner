"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ARCHIVE_KEY, addArchive, parseArchive, type ArchiveEntry } from "../lib/packing/archive";
import { parseWorkspaceBackup } from "../lib/packing/workspace-file";
import { bearingLoads } from "../lib/packing/bearing";
import { explainUnloaded, revisePackingResult } from "../lib/packing/engine";
import type { FleetOption, FleetResult } from "../lib/packing/fleet";
import type { ContainerSpec, PackingRequest, PackingResult, ProductInput } from "../lib/packing/types";
import { CONTAINER_PRESETS } from "../lib/packing/presets";
import { RemainingCapacity } from "./remaining-capacity";
import { NumericInput } from "./numeric-input";
import { SceneErrorBoundary } from "./scene-error-boundary";

const Scene=dynamic(()=>import("./container-scene").then(m=>m.ContainerScene),{ssr:false});
function download(name:string, content:string, type="application/json") {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement("a"); a.href=url; a.download=name; a.hidden=true; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const errorMessage=(e:unknown)=>e instanceof Error?e.message:"操作未完成，请重试。";

export function ArchiveLibrary({backup,disabled,onRestore,onProducts}:{backup:string;disabled:boolean;onRestore:(backup:string)=>void;onProducts:(products:ProductInput[])=>void}) {
  const [entries,setEntries]=useState<ArchiveEntry[]>([]);
  const [name,setName]=useState("");
  const [message,setMessage]=useState("");
  const refresh=()=>{try { const list=parseArchive(localStorage.getItem(ARCHIVE_KEY)??"[]");setEntries(list);return list; }catch(e){setMessage(errorMessage(e));return null;}};
  const save=(kind:ArchiveEntry["kind"])=>{
    try { const current=refresh();if(!current)return;const next=addArchive(current,name,kind,backup);localStorage.setItem(ARCHIVE_KEY,JSON.stringify(next));setEntries(next);setMessage("新版本已保存，旧版本仍保留。请定期导出工作区备份。"); }catch(e){setMessage(`保存失败，旧版本未覆盖：${errorMessage(e)}`);}
  };
  return <details className="upgrade-panel" onToggle={e=>{if(e.currentTarget.open)refresh();}}><summary>方案归档与产品版本库</summary><div className="upgrade-body">
    <p>同名保存会新建版本。方案保留输入和已完成箱位，恢复时按当前规则重新校验；产品版本只替换箱规列表。数据保存在本浏览器，跨站点请使用备份文件。</p>
    <div className="upgrade-actions"><input aria-label="归档名称" maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="客户／订单／产品系列名称"/><button className="button" disabled={disabled||!name.trim()} onClick={()=>save("project")}>保存方案版本</button><button className="button" disabled={disabled||!name.trim()} onClick={()=>save("products")}>保存产品版本</button></div>
    <p role="status">{message}</p>
    {!entries.length?<p>尚无归档。</p>:<div className="upgrade-table-wrap"><table><thead><tr><th>名称</th><th>类型／版本</th><th>时间</th><th>操作</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.id}><td>{entry.name}</td><td>{entry.kind==="project"?"方案":"产品"} v{entry.version}</td><td>{new Date(entry.date).toLocaleString()}</td><td><button className="button small" disabled={disabled} onClick={()=>{try{const parsed=parseWorkspaceBackup(entry.backup);if(entry.kind==="project")onRestore(entry.backup);else if(window.confirm("用此产品版本替换当前箱规？柜型和目标保持当前设置。"))onProducts(parsed.products);}catch(e){setMessage(errorMessage(e));}}}>恢复此版本</button> <button className="button small" onClick={()=>download(`工作区_${entry.kind}_v${entry.version}.json`,entry.backup)}>导出备份</button> <button className="button small" onClick={()=>{if(!window.confirm("删除这个本机版本？请先导出需要保留的数据。"))return;try{const current=refresh();if(!current)return;const next=current.filter(x=>x.id!==entry.id);localStorage.setItem(ARCHIVE_KEY,JSON.stringify(next));setEntries(next);}catch(e){setMessage(errorMessage(e));}}}>删除</button></td></tr>)}</tbody></table></div>}
  </div></details>;
}

export function BearingRules({products,disabled,onChange}:{products:ProductInput[];disabled:boolean;onChange:(products:ProductInput[])=>void}) {
  const [draft,setDraft]=useState<Record<string,string>>({});
  const [message,setMessage]=useState("");
  const apply=()=>{try{const next=products.map(p=>{const raw=draft[p.id];if(raw===undefined)return p; if(!raw.trim()){const copy={...p};delete copy.maxTopLoadKg;return copy;}const value=Number(raw);if(!Number.isFinite(value)||value<0)throw new Error(`${p.sku} 的承重必须为非负数字。`);return {...p,maxTopLoadKg:value};});onChange(next);setDraft({});setMessage("承重规则已提交，将重新计算。");}catch(e){setMessage(errorMessage(e));}};
  return <details className="upgrade-panel"><summary>包装承重规则</summary><div className="upgrade-body"><p>每箱可承受的上方累计重量（kg），包含所有上层箱。留空为未指定；0 表示禁止上方负载。重量按接触面积向下分配，需使用包装供应商确认的参数。</p><div className="upgrade-rule-grid">{products.map(p=><label key={p.id}>{p.sku}<input aria-label={`${p.sku} 上方承重 kg`} inputMode="decimal" value={draft[p.id]??(p.maxTopLoadKg===undefined?"":String(p.maxTopLoadKg))} placeholder="未指定" onChange={e=>setDraft(d=>({...d,[p.id]:e.target.value}))}/></label>)}</div><button className="button" onClick={apply} disabled={disabled||!Object.keys(draft).length}>应用承重规则并重算</button><p role="status">{message}</p></div></details>;
}

export function UnloadedReasons({result,products}:{result:PackingResult;products:ProductInput[]}) {
  const items=useMemo(()=>explainUnloaded(result,products),[result,products]);
  return <details className="upgrade-panel"><summary>未装入原因 · {items.reduce((n,p)=>n+p.unloaded,0)} 箱</summary><div className="upgrade-body">{!items.length?<p>本方案的需求已全部装入。</p>:items.map(p=><article key={p.productId}><strong>{p.sku} · 未装 {p.unloaded} 箱</strong><ul>{p.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></article>)}</div></details>;
}

export function ManualPlan({result,products,onAdopt,disabled}:{result:PackingResult;products:ProductInput[];onAdopt:(result:PackingResult)=>void;disabled:boolean}) {
  const [draft,setDraft]=useState(result);
  const [open,setOpen]=useState(false);
  const [selected,setSelected]=useState(result.placements[0]?.id??"");
  const [delta,setDelta]=useState({x:0,y:0,z:0});
  const [group,setGroup]=useState(false);
  const [undo,setUndo]=useState<PackingResult[]>([]);
  const [redo,setRedo]=useState<PackingResult[]>([]);
  const [message,setMessage]=useState("");
  const [validInputs,setValidInputs]=useState<Record<string,boolean>>({});
  const drag=useRef<{x:number;y:number;id:string}|null>(null);
  const box=draft.placements.find(b=>b.id===selected);
  const loads=useMemo(()=>bearingLoads(open?draft.placements:[]),[draft.placements,open]);
  const commit=(next:PackingResult)=>{setUndo(h=>[...h.slice(-9),draft]);setRedo([]);setDraft(next);setMessage("调整通过校验。点击“采用手动方案”同步到三维、指标与导出。");};
  const move=(id:string,dx:number,dy:number,dz:number,rotate=false)=>{
    try { const target=draft.placements.find(b=>b.id===id);if(!target)return;
      const next=draft.placements.map(b=>{
        const affected=b.id===id||(group&&target.setCode&&b.setCode===target.setCode&&b.setNumber===target.setNumber);
        return affected?{...b,x:b.x+dx,y:b.y+dy,z:b.z+dz,...(rotate?{dx:b.dy,dy:b.dx,orientation:`${b.dy}×${b.dx}×${b.dz}`}:{})}:b;
      });commit(revisePackingResult(draft,next,products));
    }catch(e){setMessage(`调整未采用，原方案保持有效：${errorMessage(e)}`);}
  };
  const width=result.container.width-result.clearance*2;
  const length=result.container.length-result.clearance*2;
  return <details className="upgrade-panel" onToggle={e=>setOpen(e.currentTarget.open)}><summary>手动调整箱位与锁定</summary>{open?<div className="upgrade-body"><p>俯视图拖动可水平移箱；精确偏移和高度以 mm 输入。调整会重新检查边界、重叠、方向、承托、承重及成套关系。锁定仅作用于本手动方案，重新计算会创建新方案。</p>
    <div className="upgrade-actions"><select aria-label="选择调整箱体" value={selected} onChange={e=>setSelected(e.target.value)}>{draft.placements.map((b,i)=><option key={b.id} value={b.id}>{i+1}. {b.sku} · 第 {b.layer} 层{b.locked?" · 已锁定":""}</option>)}</select><label><input type="checkbox" checked={group} onChange={e=>setGroup(e.target.checked)}/>同步移动同一套箱体</label></div>
    <svg className="manual-map" viewBox={`0 0 ${length} ${width}`} role="img" aria-label="可拖动箱位俯视图" onPointerUp={e=>{const start=drag.current;drag.current=null;if(!start)return;const r=e.currentTarget.getBoundingClientRect();move(start.id,Math.round((e.clientX-start.x)*length/r.width/10)*10,Math.round((e.clientY-start.y)*width/r.height/10)*10,0);}} onPointerCancel={()=>{drag.current=null;}}>
      <rect width={length} height={width} fill="#eff7f8"/>{[...draft.placements].sort((a,b)=>a.z-b.z).map(b=><rect key={b.id} x={b.x} y={b.y} width={b.dx} height={b.dy} fill={b.color} fillOpacity={0.75} stroke={b.id===selected?"#102f39":"white"} strokeWidth={b.id===selected?18:4} onPointerDown={e=>{setSelected(b.id);if(disabled||b.locked){setMessage(b.locked?"请先解除此箱位锁定。":"请等待计算结束。");return;}drag.current={x:e.clientX,y:e.clientY,id:b.id};e.currentTarget.setPointerCapture(e.pointerId);}}><title>{b.sku} · 第 {b.layer} 层{b.locked?" · 已锁定":""}</title></rect>)}
    </svg>
    {box?<p>当前：{box.sku}，坐标 {box.x} / {box.y} / {box.z} mm，上方累计 {(loads.get(box.id)??0).toFixed(2)} kg。</p>:null}
    <div className="upgrade-actions">{(["x","y","z"] as const).map(axis=><label key={axis}>{axis.toUpperCase()} 偏移 mm<NumericInput ariaLabel={`${axis.toUpperCase()} 箱位偏移`} value={delta[axis]} min={-20000} max={20000} onValueChange={v=>setDelta(d=>({...d,[axis]:v}))} onValidityChange={valid=>setValidInputs(s=>({...s,[axis]:valid}))}/></label>)}<button className="button" disabled={disabled||!box||Object.values(validInputs).includes(false)} onClick={()=>move(selected,delta.x,delta.y,delta.z)}>验证移动</button><button className="button" disabled={disabled||!box||group} onClick={()=>move(selected,0,0,0,true)}>水平旋转 90°</button><button className="button" disabled={disabled||!box} onClick={()=>commit({...draft,placements:draft.placements.map(b=>b.id===selected?{...b,locked:!b.locked}:b)})}>{box?.locked?"解除锁定":"锁定箱位"}</button></div>
    <div className="upgrade-actions"><button className="button" disabled={!undo.length} onClick={()=>{setRedo(h=>[...h,draft]);setDraft(undo[undo.length-1]);setUndo(h=>h.slice(0,-1));}}>撤销</button><button className="button" disabled={!redo.length} onClick={()=>{setUndo(h=>[...h,draft]);setDraft(redo[redo.length-1]);setRedo(h=>h.slice(0,-1));}}>重做</button><button className="button primary" disabled={disabled||!undo.length} onClick={()=>onAdopt(draft)}>采用手动方案</button></div><p role="status">{message}</p>
  </div>:null}</details>;
}

function escapeHtml(s:string){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));}
export function FieldGuide({result}:{result:PackingResult}) {
  const [step,setStep]=useState(0);
  const [open,setOpen]=useState(false);
  const [message,setMessage]=useState("");
  const box=result.placements[step];
  const fingerprint=JSON.stringify({container:result.container,strategy:result.strategy,placements:result.placements});
  const key=`cargo-fit-field-${result.container.id}-${result.placements.reduce((hash,b)=>{const s=`${b.id}:${b.x}:${b.y}:${b.z}`;for(let i=0;i<s.length;i++)hash=Math.imul(hash^s.charCodeAt(i),16777619);return hash;},2166136261)}`;
  const setProgress=(value:number)=>{setStep(value);try{localStorage.setItem(key,JSON.stringify({fingerprint,step:value}));setMessage("现场进度已保存。");}catch{setMessage("现场进度未能保存，请保持此页面开启。");}};
  const exportGuide=()=>{const rows=result.placements.map((b,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(b.sku)}</td><td>${escapeHtml(b.setCode??"")} ${b.setNumber??""}</td><td>${b.x} / ${b.y} / ${b.z}</td><td>${b.dx} × ${b.dy} × ${b.dz}</td><td>${b.layer}</td><td>${b.weight}</td><td>□</td></tr>`).join("");download("装柜现场指导书.html",`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>装柜现场指导书</title><style>body{font:16px system-ui;margin:24px;color:#16363e}table{border-collapse:collapse;width:100%}td,th{border:1px solid #b7c8cc;padding:8px}thead{display:table-header-group}tr{break-inside:avoid}</style><h1>${escapeHtml(result.container.name)} 装柜指导书</h1><p>${escapeHtml(result.strategy==="practical"?"现场易执行":"高密度参考：含复杂方向或局部承托，须现场复核")} · ${result.metrics.loadedCount} 箱 · ${result.metrics.grossWeight} kg</p><p>顺序：柜内到箱门，先承托箱后上层箱。坐标与尺寸单位 mm；现场核对包装和柜型实测值。</p><table><thead><tr><th>顺序</th><th>SKU</th><th>套装／套号</th><th>X / Y / Z</th><th>摆放尺寸</th><th>层</th><th>kg</th><th>确认</th></tr></thead><tbody>${rows}</tbody></table></html>`,"text/html;charset=utf-8");};
  return <details className="upgrade-panel" onToggle={e=>{setOpen(e.currentTarget.open);if(e.currentTarget.open){try{const saved=JSON.parse(localStorage.getItem(key)??"null");if(saved?.fingerprint===fingerprint&&Number.isInteger(saved.step)&&saved.step>=0&&saved.step<=result.placements.length)setStep(saved.step);}catch{setMessage("本机进度不可用。");}}}}><summary>仓库作业模式与离线指导书</summary><div className="upgrade-body">{open?<><p>{result.strategy==="practical"?"按已校验的现场方案执行。":"当前为高密度参考方案，侧翻和局部承托须由现场确认。"}</p><div className="field-step"><strong>已确认 {step} / {result.placements.length} 箱</strong>{box?<><h3>下一箱：{box.sku}</h3><p>{box.setCode?`${box.setCode} · 第 ${box.setNumber} 套`:"散箱"} · 第 {box.layer} 层</p><p>位置 {box.x} / {box.y} / {box.z} mm</p><p>摆放 {box.dx} × {box.dy} × {box.dz} mm · {box.weight} kg</p></>:<h3>本柜已确认完成</h3>}</div><div className="upgrade-actions"><button className="button" disabled={step===0} onClick={()=>setProgress(Math.max(0,step-1))}>返回上一箱</button><button className="button primary" disabled={!box} onClick={()=>setProgress(step+1)}>确认此箱已装</button><button className="button" onClick={exportGuide}>下载离线指导书</button></div><p role="status">{message}</p></>:null}</div></details>;
}

export function FleetPlanner({request,disabled,customContainers=[]}:{request:PackingRequest;disabled:boolean;customContainers?:ContainerSpec[]}) {
  const [open,setOpen]=useState(false);
  const [runSettings,setRunSettings]=useState<{options:FleetOption[];objective:string}|null>(null);
  const [options,setOptions]=useState<FleetOption[]>(()=>[...new Map([...CONTAINER_PRESETS,...customContainers,request.container].map(c=>[c.id,c])).values()].map(container=>({container,cost:0,available:10})));
  const [enabled,setEnabled]=useState(()=>options.map((_,i)=>i<3));
  const [limit,setLimit]=useState(10);
  const [objective,setObjective]=useState<"count"|"cost">("count");
  const [state,setState]=useState<FleetResult|null>(null);
  const [running,setRunning]=useState(false);
  const [message,setMessage]=useState("");
  const [selected,setSelected]=useState(0);
  const [view,setView]=useState<"perspective"|"top"|"side"|"door">("perspective");
  const [projection,setProjection]=useState<"perspective"|"orthographic">("perspective");
  const [validity,setValidity]=useState<Record<string,boolean>>({});
  const worker=useRef<Worker|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;setRunning(false);};
  useEffect(()=>()=>{worker.current?.terminate();if(timer.current)clearTimeout(timer.current);},[]);
  const calculate=()=>{stop();setRunSettings({options:options.filter((_,i)=>enabled[i]).map(o=>({...o})),objective});setState(null);setSelected(0);setMessage("正在逐柜分配，每完成一柜即可查看。费用按同一币种输入。");try{
    const w=new Worker(new URL("../lib/packing/fleet.worker.ts",import.meta.url),{type:"module"});worker.current=w;setRunning(true);
    w.onmessage=e=>{if(worker.current!==w)return;if(e.data.type==="error"){stop();setMessage(e.data.message);return;}setState(e.data.result);if(e.data.type==="result"){stop();setMessage(e.data.result.reason);}};
    w.onerror=()=>{if(worker.current!==w)return;stop();setMessage("计算线程异常，已完成的柜仍可查看和导出。");};
    timer.current=setTimeout(()=>{stop();setMessage("已达到 120 秒时限，保留已完成柜。可减少候选柜型或分批计算。");},120000);
    w.postMessage({request,options:options.filter((_,i)=>enabled[i]),limit,objective});
  }catch(e){stop();setMessage(errorMessage(e));}};
  const selectedPlan=state?.loads[selected]?.plan;
  return <details className="upgrade-panel" onToggle={e=>setOpen(e.currentTarget.open)}><summary>整单多柜分配与费用比较</summary><div className="upgrade-body"><p>逐柜比较可用柜型，保留完整套装；柜数优先选择当前能多装货的方案，费用优先按已装体积比较单柜费用。属于启发式分配，不保证全局最低费用。费用使用同一币种。费用优先模式必须填写各候选柜型的实际费用；更改设置在下次分配时生效。</p>
    <div className="upgrade-rule-grid">{options.map((o,i)=><div key={o.container.id}><label><input disabled={running} type="checkbox" checked={enabled[i]} onChange={e=>setEnabled(a=>a.map((v,j)=>i===j?e.target.checked:v))}/>{o.container.name}</label><label>每柜费用<NumericInput ariaLabel={`${o.container.name} 每柜费用`} value={o.cost} onValueChange={cost=>setOptions(a=>a.map((v,j)=>i===j?{...v,cost}:v))} onValidityChange={valid=>setValidity(a=>({...a,[`cost${i}`]:valid}))}/></label><label>可用柜数<NumericInput ariaLabel={`${o.container.name} 可用柜数`} integer min={1} max={50} value={o.available} onValueChange={available=>setOptions(a=>a.map((v,j)=>i===j?{...v,available}:v))} onValidityChange={valid=>setValidity(a=>({...a,[`count${i}`]:valid}))}/></label></div>)}</div>
    <div className="upgrade-actions"><label>最多分配柜数<NumericInput ariaLabel="最多分配柜数" integer min={1} max={50} value={limit} onValueChange={setLimit} onValidityChange={valid=>setValidity(a=>({...a,limit:valid}))}/></label><select aria-label="多柜优化目标" value={objective} onChange={e=>setObjective(e.target.value as "count"|"cost")}><option value="count">柜数优先</option><option value="cost">费用优先</option></select><button className="button primary" disabled={disabled||running||!enabled.some(Boolean)||Object.values(validity).includes(false)} onClick={calculate}>分配整张订单</button><button className="button" disabled={!running} onClick={()=>{stop();setMessage("已停止，保留已完成柜；剩余订单尚未全部处理。");}}>停止并保留已完成柜</button></div><p role="status">{message}</p>
    {state?<><p><strong>{state.loads.length} 柜 · 费用合计 {state.totalCost.toFixed(2)} · 剩余 {state.remaining.reduce((n,p)=>n+p.quantity,0)} 箱</strong></p><div className="upgrade-actions"><button className="button" onClick={()=>download("多柜分配方案.json",JSON.stringify({request,...runSettings,...state},null,2))}>导出全部柜方案</button></div><div className="upgrade-table-wrap"><table><thead><tr><th>柜号</th><th>柜型</th><th>箱数</th><th>利用率</th><th>费用</th><th>方案</th></tr></thead><tbody>{state.loads.map((l,i)=><tr key={i}><td>{i+1}</td><td>{l.plan.container.name}</td><td>{l.plan.metrics.loadedCount}</td><td>{(l.plan.metrics.volumeUtilization*100).toFixed(1)}%</td><td>{l.cost.toFixed(2)}</td><td><button className="button small" onClick={()=>setSelected(i)}>查看第 {i+1} 柜</button></td></tr>)}</tbody></table></div>{state.remaining.some(p=>p.quantity>0)?<p>未分配：{state.remaining.filter(p=>p.quantity>0).map(p=>`${p.sku} ${p.quantity} 箱`).join("；")}</p>:null}</>:null}
    {selectedPlan&&open?<section aria-label="多柜选中方案"><h3>第 {selected+1} 柜 · {selectedPlan.container.name}</h3><RemainingCapacity result={selectedPlan}/><SceneErrorBoundary resetKey={selectedPlan.id}><Scene result={selectedPlan} visibleProducts={new Set(selectedPlan.summaries.map(s=>s.productId))} visibleCount={selectedPlan.placements.length} cameraView={view} projectionMode={projection} onCameraViewChange={v=>setView(v as typeof view)} onProjectionModeChange={setProjection}/></SceneErrorBoundary><FieldGuide key={selectedPlan.id} result={selectedPlan}/></section>:null}
  </div></details>;
}
