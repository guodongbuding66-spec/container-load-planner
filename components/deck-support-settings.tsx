"use client";
import {useEffect,useRef,useState} from "react";
import {MAX_DECK_SUPPORTS,deckSupportMass,completePackagingTare,type DeckSupport} from "../lib/packing/deck-support";
import {DEFAULT_PACKAGING,packagingInterior} from "../lib/packing/packaging";
import type {FloorPalletConfig} from "../lib/packing/types";
import {NumericInput} from "./numeric-input";
import {tr,useLanguage} from "./language";
const numeric=["x","y","dx","dy","dz","weightKg","maxLoadKg"] as const;
type Validity=(key:string,valid:boolean)=>void;
function SupportRow({s,index,onChange,onRemove,onValidityChange,resetToken}:{s:DeckSupport;index:number;onChange:(patch:Partial<DeckSupport>)=>void;onRemove:()=>void;onValidityChange:Validity;resetToken?:number}){
 const key=`deck-support-${s.id}`;const [massReset,setMassReset]=useState(0);
 useEffect(()=>()=>{for(const field of numeric)onValidityChange(`${key}-${field}`,true);},[key,onValidityChange]);
 const label=`${tr("托内支承","Deck support")} ${index+1}`;
 return <fieldset><legend>{label}</legend><label>{tr("名称","Name")}<input aria-label={`${label} ${tr("名称","name")}`} maxLength={100} value={s.name} onChange={e=>onChange({name:e.target.value})}/></label>
 <div className="pallet-build-grid">{([['x','X'],['y','Y'],['dx',tr('长','Length')],['dy',tr('宽','Width')],['dz',tr('厚度','Thickness')]] as const).map(([field,name])=><label key={field}>{name} mm<NumericInput ariaLabel={`${label} ${field}`} resetToken={resetToken} min={field==='x'||field==='y'?0:1} max={100000} value={s[field]} onValueChange={n=>onChange({[field]:n})} onValidityChange={v=>onValidityChange(`${key}-${field}`,v)}/></label>)}
 <label>{tr("新增自重 kg","Added tare kg")}<NumericInput key={massReset} ariaLabel={`${label} ${tr("新增自重","added tare")}`} resetToken={resetToken} min={0} max={10000} showError value={s.weightKg??0} onValueChange={weightKg=>onChange({weightKg})} onValidityChange={v=>onValidityChange(`${key}-weightKg`,v)}/>{s.weightKg===null&&<><small>{tr("尚未填写，不自动当作零。","Not entered; not assumed zero.")}</small><button className="button small" type="button" onClick={()=>{onValidityChange(`${key}-weightKg`,true);setMassReset(v=>v+1);onChange({weightKg:0});}}>{tr("确认零自重","Confirm zero tare")}</button></>}</label></div>
 <label><input type="checkbox" aria-label={`${label} ${tr("已知静载上限","known static load limit")}`} checked={s.maxLoadKg!==null} onChange={e=>{onValidityChange(`${key}-maxLoadKg`,true);onChange({maxLoadKg:e.target.checked?0:null});}}/>{tr("填写上方静载上限；0 表示禁止承载","Enter upper static load limit; 0 prohibits load")}</label>
 {s.maxLoadKg!==null&&<label>{tr("上方静载上限 kg","Upper static load limit kg")}<NumericInput ariaLabel={`${label} ${tr("静载上限","static load limit")}`} resetToken={resetToken} min={0} max={100000} value={s.maxLoadKg} onValueChange={maxLoadKg=>onChange({maxLoadKg})} onValidityChange={v=>onValidityChange(`${key}-maxLoadKg`,v)}/></label>}
 <div className="pallet-build-grid"><label>{tr("支承件及底座接触实测来源","Support and deck-contact measurement source")}<input aria-label={`${label} ${tr("来源","source")}`} maxLength={500} value={s.source} onChange={e=>onChange({source:e.target.value})}/></label><label>{tr("版本","Revision")}<input aria-label={`${label} ${tr("版本","revision")}`} maxLength={120} value={s.revision} onChange={e=>onChange({revision:e.target.value})}/></label></div>
 <button type="button" className="button small" onClick={onRemove}>{tr("删除托内支承","Remove deck support")} {index+1}</button></fieldset>;
}
export function DeckSupportSettings({value,onChange,onValidityChange,resetToken,invalid=false}:{value:FloorPalletConfig;onChange:(v:FloorPalletConfig)=>void;onValidityChange:Validity;resetToken?:number;invalid?:boolean}){
 useLanguage();const rows=value.packaging?.deckSupports??[],spec=value.packaging??DEFAULT_PACKAGING,inside=packagingInterior(value),mass=deckSupportMass(value);
 const details=useRef<HTMLDetailsElement>(null),missingTare=rows.some(s=>s.weightKg===null);
 useEffect(()=>{if(missingTare&&details.current)details.current.open=true;},[missingTare]);
 const update=(next:DeckSupport[])=>onChange({...value,packaging:{...spec,deckSupports:next.length?next:undefined}});
 const add=()=>update([...rows,{id:crypto.randomUUID(),name:`${tr("实心垫木","Solid timber")} ${rows.length+1}`,x:inside.inset,y:inside.inset,dx:Math.max(1,Math.min(100,inside.length)),dy:Math.max(1,Math.min(100,inside.width)),dz:Math.max(1,Math.min(50,value.maxCargoHeight||50)),weightKg:null,maxLoadKg:null,source:"",revision:""}]);
 return <details ref={details} className="panel deck-support-settings"><summary>{tr("托内实心支承件","Solid supports inside packaging")} · {rows.length}</summary>
 <p>{tr("每行是一件直接贴合实际底座顶面的实心平顶垫木／支承块，X/Y 从原始托盘左前角起算，单位 mm。厚度占用货物限高；底部须完整贴合实际面板，暂不支持跨板缝、架空、叠垫木或空心框架。","Each row is one solid, flat-top piece resting directly on the actual deck. X/Y use the original pallet corner, in mm. Thickness consumes cargo height. Full contact with real deck boards is required; bridging gaps, floating, stacked pieces and hollow frames are not supported.")}</p>
 <p>{tr("新增支承自重与下方原包装自重分开填写，两者合计为整托包装自重；支承件也占用底座额定载荷，请勿在原包装自重中重复填写。首阶段仅预打托，整托单层底置。缺来源、版本或静载上限保持未核验，已填数值仍执行。","Enter added support mass separately from the existing packaging tare; their sum is complete tare. Supports also consume the deck payload rating: do not duplicate their mass in the base tare. Prebuilt, floor-only units in this stage. Missing source, revision or load rating remains unverified; entered numeric limits still apply.")}</p>
 <p>{tr("新增自重 / 完整包装自重 kg","Added / complete packaging tare kg")}: {Number.isFinite(mass)?`${mass} / ${completePackagingTare(value)}`:tr("未填写完整","Incomplete")}</p>
 {rows.map((s,index)=><SupportRow key={s.id} s={s} index={index} resetToken={resetToken} onValidityChange={onValidityChange} onChange={patch=>update(rows.map(r=>r.id===s.id?{...r,...patch}:r))} onRemove={()=>update(rows.filter(r=>r.id!==s.id))}/>)}
 <button type="button" className="button small" disabled={invalid||rows.length>=MAX_DECK_SUPPORTS||rows.some(s=>s.weightKg===null)} onClick={add}>{tr("新增托内支承","Add deck support")}</button>
 </details>;
}
