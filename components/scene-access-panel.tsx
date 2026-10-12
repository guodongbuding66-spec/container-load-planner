"use client";
import { useMemo, useState } from "react";
import { auditAccess, parseDelivery, type DeliveryMap, type PathIssue } from "../lib/packing/access";
import type { PackingResult, ProductInput } from "../lib/packing/types";
import { NumericInput } from "./numeric-input";
import { tr, useLanguage } from "./language";
export function SceneAccessPanel({plan,products,onAdopt,onHighlight,disabled}:{plan:PackingResult;products:ProductInput[];onAdopt?:(plan:PackingResult)=>void;onHighlight:(ids:string[])=>void;disabled:boolean}){
  useLanguage();const [draft,setDraft]=useState<DeliveryMap>(plan.delivery??{}),[open,setOpen]=useState(false),[valid,setValid]=useState<Record<string,boolean>>({}),[message,setMessage]=useState("");
  const report=useMemo(()=>open?auditAccess(plan,draft):null,[open,plan,draft]);
  const labels:Record<PathIssue["reason"],string>={door:tr("最终 Y/Z 位置无法直线通过门洞","Final Y/Z cannot pass straight through the door"),blocked:tr("前方货物遮挡通道","Cargo ahead blocks the corridor"),support:tr("上方货物尚未卸下","Cargo above remains supported by this carton"),unassigned:tr("未设置卸货站次","Unload stop not assigned"),"mixed-stop":tr("整托含不同卸货站次，需要拆托复核","Complete pallet spans unload stops; depalletizing needs review")};
  const change=(id:string,patch:Partial<DeliveryMap[string]>)=>setDraft(s=>({...s,[id]:{...(s[id]??{customer:"",destination:"",stop:1}),...patch}}));
  return <details open className="scene-analysis-panel" onToggle={e=>{setOpen(e.currentTarget.open);if(!e.currentTarget.open)onHighlight([]);}}><summary>{tr("装卸顺序与路径","Loading and unloading access")}</summary><div className="scene-inspector-section">
    <p>{tr("站次 0 表示未设置，1 最先卸。检查保持最终 Y/Z、沿柜长穿过居中门洞的直线路径及上方承托依赖；抬升、转向、叉车和人员空间未模拟。","Stop 0 is unassigned; stop 1 unloads first. Checks straight travel at final Y/Z through the centered door, plus upper support dependencies. Lifting, turning, forklifts and personnel clearance are not simulated.")}</p>
    {open&&<>{products.map(p=><fieldset className="delivery-sku" key={p.id}><legend>{p.sku}</legend><label>{tr("客户","Customer")}<input aria-label={`${p.sku} ${tr("客户","customer")}`} maxLength={120} value={draft[p.id]?.customer??""} onChange={e=>change(p.id,{customer:e.target.value})}/></label><label>{tr("目的地","Destination")}<input aria-label={`${p.sku} ${tr("目的地","destination")}`} maxLength={120} value={draft[p.id]?.destination??""} onChange={e=>change(p.id,{destination:e.target.value})}/></label><label>{tr("卸货站次","Unload stop")}<NumericInput ariaLabel={`${p.sku} ${tr("卸货站次","unload stop")}`} value={draft[p.id]?.stop??0} min={0} max={999} integer onValueChange={v=>change(p.id,{stop:v})} onValidityChange={v=>setValid(s=>({...s,[p.id]:v}))}/></label></fieldset>)}
      {onAdopt&&<button disabled={disabled||Object.values(valid).some(v=>!v)||!Object.keys(draft).length&&!plan.delivery} onClick={()=>{try{const delivery=parseDelivery(draft,new Set(products.map(p=>p.id)));onAdopt({...plan,id:`delivery-${Date.now()}`,delivery,strategyPlans:undefined,strategyComparison:undefined});}catch(e){setMessage(String(e));}}}>{tr("保存装卸设置到方案","Save delivery settings to plan")}</button>}
      <p role="status">{message}</p>{report&&<><strong>{tr("待复核","Review required")}: {report.issues.filter(i=>i.reason!=="unassigned").length} · {tr("站次是否齐全","All stops assigned")}: {report.complete?tr("是","Yes"):tr("否","No")}</strong>
        <button onClick={()=>onHighlight(report.issues.filter(i=>i.reason!=="unassigned").flatMap(i=>[i.id,...i.obstacles]))}>{tr("高亮受阻货物","Highlight blocked cargo")}</button>
        <button onClick={()=>onHighlight([])}>{tr("清除路径高亮","Clear access highlight")}</button>
        <div className="scene-analysis-list">{report.issues.slice(0,60).map((i,n)=><p key={`${i.id}/${i.phase}/${i.reason}/${n}`}><strong>{i.id}</strong> · {tr(i.phase==="load"?"装入":"卸出",i.phase==="load"?"Load":"Unload")} · {labels[i.reason]}{i.obstacles.length>0&&<> · {i.obstacles.slice(0,5).join(", ")}</>}</p>)}</div>
        <small>{tr("首批卸货顺序","First unload steps")}: {report.order.slice(0,6).map(b=>b.id).join(" → ")}</small>
      </>}
    </>}
  </div></details>;
}
