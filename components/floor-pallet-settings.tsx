"use client";
import { useEffect, useMemo, useState } from "react";
import { Layers3, Check } from "lucide-react";
import type { ContainerSpec, FloorPalletConfig } from "../lib/packing/types";
import { TRANSPORT_PRESETS } from "../lib/packing/transport-library";
import { arrangeFloorPallets, palletCargoCeiling, palletSpaceSummary, parseFloorPalletConfig } from "../lib/packing/floor-pallets";
import { FeatureDialog } from "./feature-dialog";
import { SpaceModelPreview } from "./space-model-preview";
import {tr, useLanguage} from "./language";

const keys=["length","width","height","weight","maxLoad","count","gap","maxCargoHeight"] as const;
const initial=(space:ContainerSpec):FloorPalletConfig=>({presetId:space.id,name:space.name,length:space.length,width:space.width,height:space.baseHeight??144,weight:25,maxLoad:space.maxWeight,count:0,gap:0,layout:"auto",allowFloorCargo:false,maxCargoHeight:0});
const strings=(p:FloorPalletConfig)=>Object.fromEntries(keys.map(k=>[k,String(p[k]??0)]));
type Props={config?:FloorPalletConfig;container:ContainerSpec;clearance:number;customSpaces:ContainerSpec[];onSave:(v:FloorPalletConfig|undefined)=>void;onClose:()=>void;inline?:boolean;onDraftChange?:(v:FloorPalletConfig|undefined,invalid:boolean)=>void};
export function FloorPalletSettings({config,container,clearance,customSpaces,onSave,onClose,inline=false,onDraftChange}:Props) {
  useLanguage();
  const spaces=[...TRANSPORT_PRESETS,...customSpaces].filter(p=>p.category==="pallet");
  const [draft,setDraft]=useState(config??initial(spaces[0]));
  const [enabled,setEnabled]=useState(Boolean(config));
  const [values,setValues]=useState(()=>strings(config??initial(spaces[0])));
  const [error,setError]=useState("");
  const preview=useMemo(()=>{
    let emptySummary;
    try { emptySummary=palletSpaceSummary(container,clearance,[]); }
    catch(e) {
      const unknown={...palletSpaceSummary({...container,exclusions:undefined},clearance,[]),effectiveVolume:0,cargoCapacity:0,remainingVolume:0};
      return {p:draft,pallets:[],summary:unknown,error:e instanceof Error?e.message:"Invalid input"};
    }
    try {
      const p=parseFloorPalletConfig({...draft,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v.trim()?Number(v):NaN]))});
      const pallets=enabled?arrangeFloorPallets(container,clearance,p):[];
      const summary=palletSpaceSummary(container,clearance,pallets);
      if(enabled&&summary.tareWeight>container.maxWeight)throw new Error(tr("托盘总自重超过柜型最大载重。"));
      return {p,pallets,summary,error:""};
    }catch(e){return {p:draft,pallets:[],summary:emptySummary,error:e instanceof Error?e.message:"Invalid input"};}
  },[draft,values,enabled,container,clearance]);
  useEffect(()=>{onDraftChange?.(enabled?preview.p:undefined,enabled&&Boolean(preview.error));},[enabled,preview,onDraftChange]);
  const choose=(id:string)=>{const space=spaces.find(s=>s.id===id);if(!space)return;const next={...initial(space),count:Number(values.count)||0,gap:Number(values.gap)||0,maxCargoHeight:Number(values.maxCargoHeight)||0,layout:draft.layout,allowFloorCargo:draft.allowFloorCargo};setDraft(next);setValues(strings(next));};
  const save=()=>{if(enabled&&preview.error){setError(preview.error);return;}onSave(enabled?preview.p:undefined);onClose();};
  const fields=[["length",tr("托盘长"),"Length","mm"],["width",tr("托盘宽"),"Width","mm"],["height",tr("底座高"),"Base height","mm"],["weight",tr("托盘自重"),"Tare weight","kg"],["maxLoad",tr("单托盘承重"),"Payload limit","kg"],["count",tr("托盘数量"),"Pallet count",""],["gap",tr("托盘间隙"),"Pallet gap","mm"],["maxCargoHeight",tr("托盘货物限高"),"Cargo height above deck","mm"]] as const;
  const content=<>
    <div className="pallet-choice-row" role="group" aria-label={tr("有无托盘","Pallet use")}>
      <button className={!enabled?"selected":""} aria-pressed={!enabled} onClick={()=>setEnabled(false)}><strong>{tr("无托盘 · 直接装柜","No pallets")}</strong><small>{tr("货物从柜底开始摆放","Cargo starts at the vehicle floor")}</small></button>
      <button className={enabled?"selected":""} aria-pressed={enabled} onClick={()=>setEnabled(true)}><Layers3 size={19}/><span><strong>{tr("使用底层托盘","Use floor pallets")}</strong><small>{tr("按实际尺寸、重量和承重计算","Use physical dimensions, tare and payload")}</small></span></button>
    </div>
    {enabled ? <div className="pallet-settings-grid"><section>
      <label className="pallet-preset-label">{tr("从托盘库选择","Pallet library")}<select aria-label={tr("底层托盘规格","Floor pallet preset")} value={draft.presetId} onChange={e=>choose(e.target.value)}>{!spaces.some(s=>s.id===draft.presetId)&&<option value={draft.presetId}>{tr(draft.name)}</option>}{spaces.map(s=><option key={s.id} value={s.id}>{tr(s.name)} · {s.length} × {s.width} mm</option>)}</select></label>
      <div className="feature-form-grid">{fields.map(([key,zh,en,unit])=><label key={key}>{tr(zh,en)}{unit&&` (${unit})`}<input inputMode={key==="count"?"numeric":"decimal"} aria-label={tr(zh,en)} value={values[key]} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>{key==="count"&&<small>{tr("0 = 自动铺设；可指定实际数量","0 = fill floor; or set a fixed count")}</small>}{key==="maxCargoHeight"&&<small>{tr("从托盘顶面起算；0 = 按柜高和门高","Above deck; 0 = vehicle and door limit")}</small>}</label>)}</div>
      <label className="pallet-preset-label">{tr("铺设方向","Floor layout")}<select aria-label={tr("托盘铺设方向","Pallet layout")} value={draft.layout} onChange={e=>setDraft(v=>({...v,layout:e.target.value as FloorPalletConfig["layout"]}))}><option value="auto">{tr("自动组合方向","Mixed horizontal orientations")}</option><option value="long">{tr("托盘长边沿柜长","Long side along vehicle")}</option><option value="cross">{tr("托盘长边沿柜宽","Long side across vehicle")}</option></select></label>
      <label className="pallet-floor-option"><input type="checkbox" checked={draft.allowFloorCargo} onChange={e=>setDraft(v=>({...v,allowFloorCargo:e.target.checked}))}/>{tr("允许余下货物直接放在柜底","Allow loose cargo on remaining floor")}</label>
      <p className="feature-muted">{tr("规格库为参考。请核对托盘实测尺寸、自重及额定承重；不使用托盘时不扣减空间。","Confirm actual dimensions, tare and rated payload. No pallet deduction when disabled.")}</p>
    </section><section className="pallet-layout-preview">
      <span className="eyebrow">{tr("尺寸匹配的托盘模型","PALLET MODEL")}</span>
      <SpaceModelPreview pallet={preview.p}/>
      <strong className="pallet-model-dimensions">{preview.p.length} × {preview.p.width} × {preview.p.height} mm</strong>
      <span className="eyebrow">{tr("柜底铺设预览","FLOOR PLAN")}</span>
      <svg viewBox={`-60 -60 ${Math.max(1,container.length-clearance*2)+120} ${Math.max(1,container.width-clearance*2)+120}`} role="img" aria-label={tr("底层托盘铺设图","Floor pallet layout")}><rect width={Math.max(1,container.length-clearance*2)} height={Math.max(1,container.width-clearance*2)} fill="#f7faf9" stroke="#91ada9" strokeWidth="12"/>{preview.pallets.map((p,i)=><g key={p.id}><rect x={p.x} y={p.y} width={p.dx} height={p.dy} fill="#d8b58a" stroke="#8b693f" strokeWidth="8"/>{Array.from({length:5},(_,j)=><line key={j} x1={p.x+25} x2={p.x+p.dx-25} y1={p.y+(j+.5)*p.dy/5} y2={p.y+(j+.5)*p.dy/5} stroke="#f9ebd7" strokeWidth="18"/>)}<text x={p.x+p.dx/2} y={p.y+p.dy/2+42} textAnchor="middle" fill="#4d3b28" fontSize="135" fontWeight="700">{i+1}</text></g>)}</svg>
      <dl className="pallet-space-breakdown"><div><dt>{tr("铺设数量 / 总自重","Count / tare")}</dt><dd>{preview.pallets.length} / {preview.summary.tareWeight.toLocaleString()} kg</dd></div><div><dt>{tr("托盘占用","Reserved pallet volume")}</dt><dd>{(preview.summary.reservedVolume/1e9).toFixed(3)} m³</dd></div><div><dt>{tr("货物可用容积","Available cargo volume")}</dt><dd>{(preview.summary.cargoCapacity/1e9).toFixed(2)} m³</dd></div><div><dt>{tr("托盘上方可装高度","Usable height above deck")}</dt><dd>{Math.max(0,palletCargoCeiling(container,clearance,preview.p)-preview.p.height)} mm</dd></div></dl>
      <p className="feature-note" role={preview.error?"alert":undefined}>{preview.error||tr("托盘底座按完整外包络预留空间，叉孔不作为可塞货空间。货物 Z 坐标从柜底起算，已包含托盘高度。","The full base envelope is reserved, including fork openings. Cargo Z includes the pallet height.")}</p>
      <p className="feature-muted">{tr("板块、墩块及叉孔为通用结构示意；承托按平台外包络核验。","Generic deck, block and fork-opening model; support uses the deck envelope.")}</p>
    </section></div> : <p className="no-pallet-note">{tr("直接使用柜内净空，货物 Z = 0 从柜底起算。已有托盘货物的包装总高请在第一步录入，避免重复加高。","Use the vehicle floor. Enter the full outer height of pre-palletized goods in step 1 to avoid adding a second base.")}</p>}
  </>;
  if(inline)return <article className="panel floor-pallet-panel"><div className="panel-head"><div><span className="section-kicker">PALLET BASE</span><h2>{tr("柜内托盘","Floor pallets")}</h2><p>{tr("可选；启用后同步扣除空间与载重。","Optional; reserve pallet volume and tare when enabled.")}</p></div></div>{content}</article>;
  return <FeatureDialog title={tr("柜内底层托盘","Floor pallets")} subtitle={tr("将托盘放进集装箱或货车，货物坐标随底座同步抬高。","Place physical pallets inside the vehicle.")} onClose={onClose} footer={<><p role={error?"alert":undefined}>{error||tr("保存设置后，在第三步统一计算。","Save settings, then calculate in step 3.")}</p><button className="button" onClick={onClose}>{tr("取消")}</button><button className="button primary" onClick={save}><Check size={16}/>{tr("保存设置","Save settings")}</button></>}>{content}</FeatureDialog>;
}
