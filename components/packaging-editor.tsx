"use client";
import {BottomDeckSettings} from "./bottom-deck-settings";
import {DeckSupportSettings} from "./deck-support-settings";
import { CrateExteriorHeight } from "./crate-exterior-height";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_PACKAGING, packagingInterior, packagingHeight, packagingLidThickness, packagingRailCount, type PackagingSpec } from "../lib/packing/packaging";
import { BASE_PRESETS, ENCLOSURE_PRESETS, withBasePreset, withEnclosurePreset } from "../lib/packing/packaging-presets";
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

export function PackagingEditor({value,onChange,onValidityChange,resetToken=0,onReset,invalid=false,children,recipe,preview}:{value:FloorPalletConfig;onChange:(v:FloorPalletConfig)=>void;onValidityChange:(key:string,valid:boolean)=>void;resetToken?:number;onReset?:()=>void;invalid?:boolean;children?:ReactNode;recipe?:ReactNode;preview?:(appearance:ReactNode,empty:ReactNode)=>ReactNode}) {
  useLanguage();
  const spec=value.packaging??{...DEFAULT_PACKAGING,opacity:1},inner=packagingInterior(value);
  const rails=spec.enclosure==="slatted"||spec.enclosure==="frame";
  const engineering = useRef<HTMLDetailsElement>(null);
  const railCount=packagingRailCount(spec), panelCount=spec.panelSegments??1;
  const [sessionTemplates,setTemplates]=useState<Template[]|null>(null),[name,setName]=useState(""),[notice,setNotice]=useState("");
  const raw=useSyncExternalStore(subscribeTemplates,readTemplates,()=>"[]");
  const templates=useMemo(()=>{if(sessionTemplates)return sessionTemplates;try{const values=JSON.parse(raw);return Array.isArray(values)?values.slice(0,30).flatMap(v=>{try{return typeof v.name==="string"&&v.name.length<=80?[{name:v.name,config:parseFloorPalletConfig(v.config)}]:[];}catch{return [];}}):[];}catch{return [];}},[raw,sessionTemplates]);
  const error=useMemo(()=>{try{parseFloorPalletConfig(value);return "";}catch(e){return e instanceof Error?e.message:String(e);}},[value]);
  useEffect(()=>{onValidityChange("pallet-build:structure",!error);return()=>onValidityChange("pallet-build:structure",true);},[error,onValidityChange]);
  useEffect(()=>{if(spec.base==="solid"||spec.base==="corner-feet")for(const key of ["boards","runners"])onValidityChange("pallet-build:"+key,true);if(spec.enclosure==="none")onValidityChange("pallet-build:wall",true);if(!rails)for(const key of ["rail-count","rail-height"])onValidityChange("pallet-build:"+key,true);if(spec.enclosure!=="panel")onValidityChange("pallet-build:panel-count",true);if(spec.enclosure!=="panel"||panelCount===1)onValidityChange("pallet-build:panel-height",true);if(!inner.crate||!spec.lid)onValidityChange("pallet-build:lid-thickness",true);},[spec.base,spec.enclosure,spec.lid,inner.crate,rails,panelCount,onValidityChange]);
  useEffect(()=>()=>{for(const key of ["boards","runners","wall","rail-count","rail-height","lid-thickness","panel-count","panel-height"])onValidityChange("pallet-build:"+key,true);},[onValidityChange]);
  const patch=(v:Partial<PackagingSpec>)=>onChange({...value,packaging:{...spec,...v}});
  const presets=TRANSPORT_PRESETS.filter(p=>p.category==="pallet");
  const save=()=>{const label=name.trim();if(!label||error)return;const next=[{name:label,config:parseFloorPalletConfig({...value,name:label})},...templates.filter(t=>t.name!==label)].slice(0,30);setTemplates(next);try{localStorage.setItem(STORAGE,JSON.stringify(next));setNotice(tr("模板已保存；当前规格也会随工作区备份。","Template saved; the current specification is included in workspace backups."));}catch{setNotice(tr("模板仅保留本次会话；可备份工作区保留当前规格。","Template retained for this session; back up the workspace to keep its current specification."));}};
  const basePreset=BASE_PRESETS.find(p=>p.base===spec.base&&(p.bottomDeck??"runners")===(spec.bottomDeck??"runners")&&p.topDeck===spec.topDeck&&p.deckBoards===spec.deckBoards&&p.runners===spec.runners&&!spec.measurements&&(spec.assembledBase||spec.base==="solid"||spec.base==="corner-feet"));
  const enclosurePreset=ENCLOSURE_PRESETS.find(p=>p.enclosure===spec.enclosure&&p.lid===spec.lid&&(p.railCount??railCount)===railCount&&(p.panelSegments??1)===panelCount&&!spec.railHeight);
  const hasSupports=!!spec.deckSupports?.length;
  const missingTare=spec.deckSupports?.some(s=>s.weightKg===null);
  useEffect(()=>{
    if(missingTare&&engineering.current)engineering.current.open=true;
  },[missingTare]);
  // Incomplete support data cannot enter the solver. The physical shell remains inspectable.
  const shell=error&&hasSupports?{...value,packaging:{...spec,deckSupports:undefined}}:value;
  const appearance=<label className="preview-opacity">
    <span>{tr("包装不透明度","Packaging opacity")}</span>
    <input type="range" aria-label={tr("包装模型不透明度","Packaging model opacity")} min={5} max={100} value={Math.round(spec.opacity*100)} onChange={e=>patch({opacity:Number(e.target.value)/100})}/>
    <output>{Math.round(spec.opacity*100)}%</output>
  </label>;
  return <div className={`packaging-editor${preview?" packaging-editor-with-preview":""}`}>
    {error&&<div className="packaging-fix" role="alert">
      <div><strong>{tr("请先修正包装资料","Correct the packaging details")}</strong><p>{trText(error)}</p></div>
      {hasSupports&&<button type="button" className="button small" onClick={()=>{
        const details=engineering.current;
        if(!details)return;
        details.open=true;
        const supports=details.querySelector<HTMLDetailsElement>(".deck-support-settings");
        if(supports){supports.open=true;supports.querySelector("summary")?.focus();}
      }}>{tr("打开托内支承件","Open deck supports")}</button>}
    </div>}
    <section className="packaging-fields">
    {children}
    <details className="packaging-structure-options">
    <summary>{tr("包装结构、材质与模板","Packaging structure, materials and templates")}</summary>
    <div className="pallet-build-grid">
      <label>{tr("托盘预设","Pallet preset")}<select aria-label={tr("打托托盘预设","Build pallet preset")} value="" onChange={e=>{const p=presets.find(p=>p.id===e.target.value);if(p){onReset?.();onChange({...value,presetId:p.id,name:p.name,length:p.length,width:p.width,height:p.baseHeight??144});}}}><option value="">{tr("自定义 / 选择预设","Custom / choose preset")}</option>{presets.map(p=><option key={p.id} value={p.id}>{tr(p.name)} · {p.length} × {p.width}</option>)}</select></label>
      <label>{tr("底座结构预设","Base construction preset")}<select aria-label={tr("底座结构","Base structure")} value={basePreset?.id??""} onChange={e=>{const preset=BASE_PRESETS.find(p=>p.id===e.target.value);if(preset){onReset?.();onChange(withBasePreset(value,preset));}}}><option value="">{tr("自定义底座","Custom base")}</option>{BASE_PRESETS.map(preset=><option key={preset.id} value={preset.id}>{tr(...preset.label)}</option>)}</select></label>
      <label>{tr("围护结构预设","Enclosure construction preset")}<select aria-label={tr("围护结构","Enclosure")} value={enclosurePreset?.id??""} onChange={e=>{const preset=ENCLOSURE_PRESETS.find(p=>p.id===e.target.value);if(preset){onReset?.();onChange(withEnclosurePreset(value,preset));}}}><option value="">{tr("自定义围护","Custom enclosure")}</option>{ENCLOSURE_PRESETS.map(preset=><option key={preset.id} value={preset.id}>{tr(...preset.label)}</option>)}</select></label>
      <label>{tr("外观材质","Appearance material")}<select aria-label={tr("包装材质","Packaging material")} value={spec.material} onChange={e=>{const material=e.target.value as PackagingSpec["material"];patch({material,color:material==="steel"?"#8797a2":material==="plastic"?"#375467":material==="plywood"?"#ccac7f":"#d4af7b"});}}>{[["wood","实木","Timber"],["plywood","胶合板","Plywood"],["plastic","塑料","Plastic"],["steel","钢材","Steel"]].map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>
      {spec.base!=="solid"&&spec.base!=="corner-feet"&&<><label>{tr("面板根数","Deck boards")}<NumericInput resetToken={resetToken} ariaLabel={tr("面板根数","Deck boards")} value={spec.deckBoards} integer min={2} max={12} onValueChange={v=>patch({deckBoards:v})} onValidityChange={v=>onValidityChange("pallet-build:boards",v)}/></label><label>{tr("底梁排数","Runner rows")}<NumericInput resetToken={resetToken} ariaLabel={tr("底梁排数","Runner rows")} value={spec.runners} integer min={2} max={5} onValueChange={v=>patch({runners:v})} onValidityChange={v=>onValidityChange("pallet-build:runners",v)}/></label></>}
      {inner.crate&&<><label>{tr("围板 / 框架厚度 mm","Wall / frame thickness mm")}<NumericInput resetToken={resetToken} ariaLabel={tr("围板厚度","Wall thickness")} value={spec.wallThickness} min={1} max={200} onValueChange={v=>patch({wallThickness:v})} onValidityChange={v=>onValidityChange("pallet-build:wall",v)}/></label><label className="packaging-check"><input type="checkbox" checked={spec.lid} onChange={e=>patch({lid:e.target.checked})}/>{tr("加装箱盖","Add lid")}</label></>}
      {inner.crate&&spec.lid&&<label>{tr("盖板厚度 mm","Lid thickness mm")}<NumericInput resetToken={resetToken} ariaLabel={tr("盖板厚度","Lid thickness")} value={packagingLidThickness(spec)} min={1} max={200} precision={1} onValueChange={lidThickness=>patch({lidThickness})} onValidityChange={v=>onValidityChange("pallet-build:lid-thickness",v)}/></label>}
      {spec.enclosure==="panel"&&<>
        <label>{tr("围板层数","Collar count")}<NumericInput resetToken={resetToken} ariaLabel={tr("围板层数","Collar count")} value={panelCount} integer min={1} max={6} onValueChange={panelSegments=>patch({panelSegments})} onValidityChange={v=>onValidityChange("pallet-build:panel-count",v)}/></label>
        {panelCount>1&&<label>{tr("单层围板高度 mm","Collar tier height mm")}<NumericInput resetToken={resetToken} ariaLabel={tr("单层围板高度","Collar tier height")} value={(value.maxCargoHeight??0)/panelCount} min={1} max={Math.floor(100000/panelCount)} precision={2} onValueChange={height=>onChange({...value,maxCargoHeight:Math.round(height*panelCount*100)/100})} onValidityChange={v=>onValidityChange("pallet-build:panel-height",v)}/></label>}
      </>}
      {rails&&<>
        <label>{tr("各面横档道数","Rails per side")}<NumericInput resetToken={resetToken} ariaLabel={tr("各面横档道数","Rails per side")} value={railCount} integer min={2} max={12} onValueChange={railCount=>patch({railCount})} onValidityChange={v=>onValidityChange("pallet-build:rail-count",v)}/></label>
        <label>{tr("横档高度 mm","Rail height mm")}<NumericInput resetToken={resetToken} ariaLabel={tr("横档高度","Rail height")} value={spec.railHeight??0} min={0} max={200} precision={1} onValueChange={railHeight=>patch({railHeight:railHeight||undefined})} onValidityChange={v=>onValidityChange("pallet-build:rail-height",v)}/><small>{tr("0 = 按围护净高自动","0 = automatic from interior height")}</small></label>
      </>}
      <label>{tr("结构颜色","Structure color")}<input type="color" aria-label={tr("结构颜色","Structure color")} value={spec.color} onChange={e=>patch({color:e.target.value})}/></label>

    </div>
    <p className="helper-text">{spec.base==="corner-feet"?tr("四角承压脚只有四个角脚，不是通长底梁。请按实物选择底座结构；具体部件尺寸可在下方底座实测资料中填写。", "Four corner feet are separate feet, not continuous runners. Choose the actual base structure and enter its component dimensions in the base measurements below."):tr("每个整托分别生成并保留自己的底座，底座随货组一起装柜；部件尺寸按实物录入。", "Each complete unit retains its own base and is loaded together with its cargo. Enter measured component dimensions for the actual base.")}</p>
    <div className="packaging-template-row"><input aria-label={tr("包装模板名称","Packaging template name")} value={name} maxLength={80} placeholder={tr("自定义模板名称","Custom template name")} onChange={e=>setName(e.target.value)}/><button type="button" className="button small" disabled={invalid||!name.trim()||!!error} onClick={save}>{tr("保存模板","Save template")}</button>{templates.length>0&&<select aria-label={tr("已保存包装模板","Saved packaging templates")} value="" onChange={e=>{const t=e.target.value===""?undefined:templates[Number(e.target.value)];if(t){onReset?.();onChange(structuredClone(t.config));}}}><option value="">{tr("载入模板","Load template")}</option>{templates.map((t,i)=><option key={t.name} value={i}>{t.name}</option>)}</select>}</div>
    <BottomDeckSettings value={value} onChange={onChange} disabled={invalid}/>
    </details>
    {inner.crate&&<CrateExteriorHeight value={value} onChange={onChange} onValidityChange={onValidityChange} resetToken={resetToken}/>}
    <details ref={engineering} className="packaging-engineering">
      <summary>{tr("承重与实测资料","Load ratings and measurements")}</summary>
      <DeckSupportSettings value={value} onChange={onChange} onValidityChange={onValidityChange} resetToken={resetToken} invalid={invalid}/>
    <ForkInterfaceSettings value={value} onChange={onChange} onValidityChange={onValidityChange} resetToken={resetToken} invalid={invalid}/>
    {inner.crate&&<CrateBearingSettings value={value} onChange={onChange} onValidityChange={onValidityChange} resetToken={resetToken} invalid={invalid}/>}
    </details>
    {notice&&<small role="status">{notice}</small>}
    <p className="helper-text">{tr("输入的长宽为外尺寸；原包装自重包含底座、围板和箱盖；新增托内支承件自重另填并自动合计。材质用于显示，额定承重采用实测数据。","Length and width are exterior dimensions. Base tare includes the deck, enclosure and lid; added deck-support mass is entered separately and summed automatically. Material controls appearance; use measured load ratings.")}</p>
  </section>
  <div className="packaging-preview-column">
    {preview ? preview(appearance,<SpaceModelPreview pallet={shell} appearanceOnly/>) :
      <aside className="packaging-preview">{appearance}<SpaceModelPreview pallet={shell}/></aside>}
    <dl className="packaging-dimension-summary">
      <div><dt>{inner.crate?tr("木箱外尺寸","Crate exterior"):tr("托盘尺寸","Pallet dimensions")}</dt><dd>{value.length} × {value.width} × {inner.crate?packagingHeight(value):value.height} mm</dd></div>
      {inner.crate&&<div><dt>{tr("内部净尺寸","Clear interior")}</dt><dd>{inner.length} × {inner.width} × {value.maxCargoHeight} mm</dd></div>}
    </dl>
  </div>{recipe&&<div className="packaging-recipe-wide">{recipe}</div>}</div>;
}
