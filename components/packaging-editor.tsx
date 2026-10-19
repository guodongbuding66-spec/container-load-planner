"use client";
import {DeckSupportSettings} from "./deck-support-settings";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_PACKAGING, packagingInterior, packagingHeight, type PackagingSpec } from "../lib/packing/packaging";
import { parseFloorPalletConfig } from "../lib/packing/floor-pallets";
import { TRANSPORT_PRESETS } from "../lib/packing/transport-library";
import type { FloorPalletConfig } from "../lib/packing/types";
import { ForkInterfaceSettings } from "./fork-interface-settings";
import { CrateBearingSettings } from "./crate-bearing-settings";
import { NumericInput } from "./numeric-input";
import { SpaceModelPreview } from "./space-model-preview";
import { tr, trText, useLanguage } from "./language";

const STORAGE="cargofit-packaging-templates-v1";
type Template={name:string;config:FloorPalletConfig};
function readTemplates(){try{return localStorage.getItem(STORAGE)??"[]";}catch{return "[]";}}
function subscribeTemplates(callback:()=>void){window.addEventListener("storage",callback);return()=>window.removeEventListener("storage",callback);}

export function PackagingEditor({value,onChange,onValidityChange,resetToken=0,onReset,invalid=false}:{value:FloorPalletConfig;onChange:(v:FloorPalletConfig)=>void;onValidityChange:(key:string,valid:boolean)=>void;resetToken?:number;onReset?:()=>void;invalid?:boolean}) {
  useLanguage();
  const spec=value.packaging??{...DEFAULT_PACKAGING,opacity:1},inner=packagingInterior(value);
  const [sessionTemplates,setTemplates]=useState<Template[]|null>(null),[name,setName]=useState(""),[notice,setNotice]=useState("");
  const raw=useSyncExternalStore(subscribeTemplates,readTemplates,()=>"[]");
  const templates=useMemo(()=>{if(sessionTemplates)return sessionTemplates;try{const values=JSON.parse(raw);return Array.isArray(values)?values.slice(0,30).flatMap(v=>{try{return typeof v.name==="string"&&v.name.length<=80?[{name:v.name,config:parseFloorPalletConfig(v.config)}]:[];}catch{return [];}}):[];}catch{return [];}},[raw,sessionTemplates]);
  const error=useMemo(()=>{try{parseFloorPalletConfig(value);return "";}catch(e){return e instanceof Error?e.message:String(e);}},[value]);
  useEffect(()=>{onValidityChange("pallet-build:structure",!error);return()=>onValidityChange("pallet-build:structure",true);},[error,onValidityChange]);
  useEffect(()=>{if(spec.base==="solid"||spec.base==="corner-feet")for(const key of ["boards","runners"])onValidityChange("pallet-build:"+key,true);if(spec.enclosure==="none")onValidityChange("pallet-build:wall",true);},[spec.base,spec.enclosure,onValidityChange]);
  useEffect(()=>()=>{for(const key of ["boards","runners","wall"])onValidityChange("pallet-build:"+key,true);},[onValidityChange]);
  const patch=(v:Partial<PackagingSpec>)=>onChange({...value,packaging:{...spec,...v,...(v.base==="solid"?{measurements:undefined}:{})}});
  const presets=TRANSPORT_PRESETS.filter(p=>p.category==="pallet");
  const save=()=>{const label=name.trim();if(!label||error)return;const next=[{name:label,config:parseFloorPalletConfig({...value,name:label})},...templates.filter(t=>t.name!==label)].slice(0,30);setTemplates(next);try{localStorage.setItem(STORAGE,JSON.stringify(next));setNotice(tr("模板已保存；当前规格也会随工作区备份。","Template saved; the current specification is included in workspace backups."));}catch{setNotice(tr("模板仅保留本次会话；可备份工作区保留当前规格。","Template retained for this session; back up the workspace to keep its current specification."));}};
  return <div className="packaging-editor"><section className="packaging-fields">
    <div className="pallet-build-grid">
      <label>{tr("托盘预设","Pallet preset")}<select aria-label={tr("打托托盘预设","Build pallet preset")} value="" onChange={e=>{const p=presets.find(p=>p.id===e.target.value);if(p){onReset?.();onChange({...value,presetId:p.id,name:p.name,length:p.length,width:p.width,height:p.baseHeight??144});}}}><option value="">{tr("自定义 / 选择预设","Custom / choose preset")}</option>{presets.map(p=><option key={p.id} value={p.id}>{tr(p.name)} · {p.length} × {p.width}</option>)}</select></label>
      <label>{tr("底座结构","Base structure")}<select aria-label={tr("底座结构","Base structure")} value={spec.base} onChange={e=>patch({base:e.target.value as PackagingSpec["base"]})}>{[["block","墩式叉孔托盘","Block pallet"],["stringer","纵梁托盘","Stringer pallet"],["solid","实心底板","Solid base"],["corner-feet","四角承压脚","Four corner feet"]].map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>
      <label>{tr("围护结构","Enclosure")}<select aria-label={tr("围护结构","Enclosure")} value={spec.enclosure} onChange={e=>onChange({...value,maxCargoHeight:value.maxCargoHeight||1000,packaging:{...spec,enclosure:e.target.value as PackagingSpec["enclosure"]}})}>{[["none","开放托盘","Open pallet"],["slatted","条板木箱","Slatted crate"],["panel","封板木箱","Panel crate"],["frame","框架木箱","Frame crate"]].map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>
      <label>{tr("外观材质","Appearance material")}<select aria-label={tr("包装材质","Packaging material")} value={spec.material} onChange={e=>patch({material:e.target.value as PackagingSpec["material"]})}>{[["wood","实木","Timber"],["plywood","胶合板","Plywood"],["plastic","塑料","Plastic"],["steel","钢材","Steel"]].map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>
      {spec.base!=="solid"&&spec.base!=="corner-feet"&&<><label>{tr("面板根数","Deck boards")}<NumericInput resetToken={resetToken} ariaLabel={tr("面板根数","Deck boards")} value={spec.deckBoards} integer min={2} max={12} onValueChange={v=>patch({deckBoards:v})} onValidityChange={v=>onValidityChange("pallet-build:boards",v)}/></label><label>{tr("底梁排数","Runner rows")}<NumericInput resetToken={resetToken} ariaLabel={tr("底梁排数","Runner rows")} value={spec.runners} integer min={2} max={5} onValueChange={v=>patch({runners:v})} onValidityChange={v=>onValidityChange("pallet-build:runners",v)}/></label></>}
      {inner.crate&&<><label>{tr("围板 / 框架厚度 mm","Wall / frame thickness mm")}<NumericInput resetToken={resetToken} ariaLabel={tr("围板厚度","Wall thickness")} value={spec.wallThickness} min={1} max={200} onValueChange={v=>patch({wallThickness:v})} onValidityChange={v=>onValidityChange("pallet-build:wall",v)}/></label><label className="packaging-check"><input type="checkbox" checked={spec.lid} onChange={e=>patch({lid:e.target.checked})}/>{tr("加装箱盖","Add lid")}</label></>}
      <label>{tr("结构颜色","Structure color")}<input type="color" aria-label={tr("结构颜色","Structure color")} value={spec.color} onChange={e=>patch({color:e.target.value})}/></label>
      <label>{tr("模型不透明度","Model opacity")} · {Math.round(spec.opacity*100)}%<input type="range" aria-label={tr("包装模型不透明度","Packaging model opacity")} min={5} max={100} value={Math.round(spec.opacity*100)} onChange={e=>patch({opacity:Number(e.target.value)/100})}/></label>
    </div>
    <div className="packaging-template-row"><input aria-label={tr("包装模板名称","Packaging template name")} value={name} maxLength={80} placeholder={tr("自定义模板名称","Custom template name")} onChange={e=>setName(e.target.value)}/><button type="button" className="button small" disabled={invalid||!name.trim()||!!error} onClick={save}>{tr("保存模板","Save template")}</button>{templates.length>0&&<select aria-label={tr("已保存包装模板","Saved packaging templates")} value="" onChange={e=>{const t=e.target.value===""?undefined:templates[Number(e.target.value)];if(t){onReset?.();onChange(structuredClone(t.config));}}}><option value="">{tr("载入模板","Load template")}</option>{templates.map((t,i)=><option key={t.name} value={i}>{t.name}</option>)}</select>}</div>
    <DeckSupportSettings value={value} onChange={onChange} onValidityChange={onValidityChange} resetToken={resetToken} invalid={invalid}/>
    <ForkInterfaceSettings value={value} onChange={onChange} onValidityChange={onValidityChange} resetToken={resetToken} invalid={invalid}/>
    {inner.crate&&<CrateBearingSettings value={value} onChange={onChange} onValidityChange={onValidityChange} resetToken={resetToken} invalid={invalid}/>}
    {notice&&<small role="status">{notice}</small>}
    <p className="helper-text">{tr("输入的长宽为外尺寸；原包装自重包含底座、围板和箱盖；新增托内支承件自重另填并自动合计。材质用于显示，额定承重采用实测数据。","Length and width are exterior dimensions. Base tare includes the deck, enclosure and lid; added deck-support mass is entered separately and summed automatically. Material controls appearance; use measured load ratings.")}</p>
    {error&&<p role="alert">{trText(error)}</p>}
  </section><aside className="packaging-preview">{!error&&<SpaceModelPreview pallet={value}/>}<strong>{inner.crate?tr("木箱外形 / 可用内部","Crate exterior / usable interior"):tr("托盘尺寸","Pallet dimensions")}</strong><span>{value.length} × {value.width} × {inner.crate?packagingHeight(value):value.height} mm</span>{inner.crate&&<span>{inner.length} × {inner.width} × {value.maxCargoHeight} mm</span>}</aside></div>;
}
