"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, PanelLeft, PanelRight, RotateCcw, Search, X } from "lucide-react";
import type { PlanEditor } from "./use-plan-editor";
import type { PackingResult, PlacedBox } from "../lib/packing/types";
import { tr, useLanguage } from "./language";
import { useTransportAppearance } from "./transport-appearance";

function DockResize({side}:{side:"left"|"right"}){
  const a=useTransportAppearance(),key=side==="left"?"leftWidth":"rightWidth";
  const drag=useRef<{x:number;width:number}|null>(null);
  return <div className={`dock-resize dock-resize-${side}`} role="separator" tabIndex={0} aria-label={tr(side==="left"?"调整货物栏宽度":"调整属性栏宽度",side==="left"?"Resize cargo panel":"Resize inspector panel")} aria-orientation="vertical" aria-valuemin={side==="left"?160:220} aria-valuemax={side==="left"?300:380} aria-valuenow={a[key]}
    onPointerDown={e=>{drag.current={x:e.clientX,width:a[key]};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{if(drag.current)a.updatePreferences({[key]:drag.current.width+(e.clientX-drag.current.x)*(side==="left"?1:-1)});}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
    onKeyDown={e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();a.updatePreferences({[key]:a[key]+(e.key==="ArrowRight"?16:-16)*(side==="left"?1:-1)});}}}/>;
}
function CargoList({result,boxes,selected,onSelect,editor,palletMode}:{result:PackingResult;boxes:PlacedBox[];selected:PlacedBox|null;onSelect:(box:PlacedBox,point?:undefined,add?:boolean)=>void;editor?:PlanEditor;palletMode:boolean}){
  const [query,setQuery]=useState(""),[page,setPage]=useState(0);
  const filtered=useMemo(()=>boxes.filter(b=>`${b.sku} ${b.id}`.toLowerCase().includes(query.toLowerCase())),[boxes,query]);
  const current=Math.min(page,Math.max(0,Math.ceil(filtered.length/40)-1));
  const numbering=useMemo(()=>new Map((palletMode?result.pallets??[]:result.placements).map((b,i)=>[b.id,i+1])),[result,palletMode]);
  return <aside className="scene-cargo-dock" aria-label={tr("当前可见货物","Visible cargo")}>
    <div className="scene-dock-title"><strong>{palletMode?tr("整托","Pallet loads"):tr("货物","Cargo")}</strong><span>{boxes.length} / {palletMode?result.pallets?.length??0:result.placements.length}</span></div>
    <label className="scene-cargo-search"><Search size={14}/><input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder={tr("搜索 SKU 或箱号","Search SKU or box ID")} aria-label={tr("搜索三维货物","Search scene cargo")}/></label>
    <div className="scene-cargo-items">{filtered.slice(current*40,(current+1)*40).map(b=><button key={b.id} type="button" aria-pressed={editor?.enabled?editor.selected.some(s=>s.id===b.id):selected?.id===b.id} onClick={e=>onSelect(b,undefined,e.shiftKey)}><span className="scene-cargo-swatch" style={{background:b.color}}/><span><strong>{b.sku}</strong><small>#{numbering.get(b.id)} · {palletMode?`${b.z} mm`:`${tr("层","Layer")} ${b.layer}`}</small></span></button>)}{!filtered.length&&<p>{tr("没有匹配的可见货物","No matching visible cargo")}</p>}</div>
    {filtered.length>40&&<div className="scene-cargo-pages"><button disabled={current===0} aria-label={tr("上一页货物","Previous cargo page")} onClick={()=>setPage(current-1)}><ChevronLeft size={16}/></button><span>{current+1} / {Math.ceil(filtered.length/40)}</span><button disabled={(current+1)*40>=filtered.length} aria-label={tr("下一页货物","Next cargo page")} onClick={()=>setPage(current+1)}><ChevronRight size={16}/></button></div>}
  </aside>;
}
export function SceneWorkbench({result,boxes,selected,onSelect,inspector,children,editor,palletMode=false,selectionTools,onClearSelection}:{result:PackingResult|null;boxes:PlacedBox[];selected:PlacedBox|null;onSelect:(box:PlacedBox,point?:undefined,add?:boolean)=>void;inspector:ReactNode;children:ReactNode;editor?:PlanEditor;palletMode?:boolean;selectionTools?:ReactNode;onClearSelection?:()=>void}){
  useLanguage();const a=useTransportAppearance();
  const host=useRef<HTMLDivElement>(null),[compact,setCompact]=useState(false),[compactPanel,setCompactPanel]=useState<"cargo"|"inspector"|null>(null);
  useEffect(()=>{const element=host.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setCompact(entry.contentRect.width<860));observer.observe(element);return()=>observer.disconnect();},[]);
  const leftOpen=compact?compactPanel==="cargo":a.leftOpen,rightOpen=compact?compactPanel==="inspector":a.rightOpen;
  return <div ref={host} className="scene-workbench-container"><div className="scene-dock-toolbar"><div><button aria-pressed={leftOpen} onClick={()=>compact?setCompactPanel(leftOpen?null:"cargo"):a.updatePreferences({leftOpen:!a.leftOpen})}><PanelLeft size={15}/>{tr("货物栏","Cargo panel")}</button><button aria-pressed={rightOpen} onClick={()=>compact?setCompactPanel(rightOpen?null:"inspector"):a.updatePreferences({rightOpen:!a.rightOpen})}><PanelRight size={15}/>{tr("属性与测量","Inspect & measure")}</button></div><span className="scene-preference-status" data-failed={a.saveFailed} role="status">{a.saveFailed?tr("偏好仅保留本次会话","Preferences saved for this session only"):tr("查看偏好自动保存","View preferences save automatically")}</span><button aria-label={tr("恢复查看默认值","Reset view preferences")} title={tr("恢复查看默认值","Reset view preferences")} onClick={()=>{a.resetPreferences();setCompactPanel(null);}}><RotateCcw size={14}/><span className="scene-reset-label">{tr("恢复查看默认值","Reset view preferences")}</span></button></div>
    {selectionTools&&<div className="scene-selection-tools" role="group" aria-label={tr("选择与孤立查看","Selection and isolation")}>{selectionTools}{selected&&onClearSelection&&<button type="button" onClick={onClearSelection}><X size={14}/>{tr("取消选择","Clear selection")}</button>}</div>}
    <div className={`scene-workbench ${compact?"is-compact":""} ${leftOpen&&result?"has-cargo":""} ${rightOpen&&result?"has-inspector":""}`} style={{"--cargo-width":`${a.leftWidth}px`,"--inspector-width":`${a.rightWidth}px`} as CSSProperties}>
      {leftOpen&&result&&<><CargoList key={String(palletMode)} editor={editor} result={result} boxes={boxes} selected={selected} onSelect={onSelect} palletMode={palletMode}/><DockResize side="left"/></>}
      <div className="scene-workbench-view">{children}</div>
      {rightOpen&&result&&<><DockResize side="right"/><aside className="scene-inspector-dock" aria-label={tr("三维属性与测量","Scene inspector and measurements")}>{inspector}</aside></>}
    </div></div>;
}
