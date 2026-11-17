"use client";
import {useEffect} from "react";
import {NumericInput} from "./numeric-input";
import {tr,useLanguage} from "./language";
import {ACCESSORY_TYPES,ACCESSORY_TYPE_TEXT,accessoryRegions,accessoryProductErrors,containerAccessoryWeight,type ContainerAccessory} from "../lib/packing/container-accessories";
import {MAX_SITE_EXCLUSIONS,parseSiteExclusions,type SiteExclusion} from "../lib/packing/site-exclusions";
import type {ContainerSpec,ProductInput} from "../lib/packing/types";
const axes=["x","y","z","dx","dy","dz"] as const;
type Props={container:ContainerSpec;products:readonly ProductInput[];only?:boolean;prebuilt?:boolean;invalid?:boolean;resetToken?:number;onChange:(c:ContainerSpec)=>void;onValidityChange:(key:string,valid:boolean)=>void};
export function ContainerAccessorySettings({container,products,only=false,prebuilt=false,invalid=false,resetToken,onChange,onValidityChange}:Props){
  useLanguage();const rows=accessoryRegions(container);let error="";
  try{parseSiteExclusions(container.exclusions,container);}catch{error=tr("请补齐重量并检查包络、依赖；支承须为装货前单件落地实心体，不能与其他实体相交。","Complete mass, bounds and dependencies. Supports require one solid floor piece installed before cargo, with no physical overlap.");}
  if(accessoryProductErrors(container,new Set(products.map(p=>p.id))).length)error=tr("附件关联货物已不存在，请重新选择或清除关联。","An associated product no longer exists; update or clear the association.");
  if(rows.length&&only)error=tr("整柜附件需要柜内坐标，请切换到装柜工作流。","Container accessories require vehicle coordinates. Choose a loading workflow.");
  if(prebuilt&&rows.some(z=>z.accessory.support))error=tr("落地支承件适用于直接装柜及底层托盘。预打托可使用普通附件。","Floor supports require direct loading and can coexist with floor pallets. Prebuilt loads can use ordinary accessories.");
  useEffect(()=>{onValidityChange("container-accessories-config",!error);return()=>onValidityChange("container-accessories-config",true);},[error,onValidityChange]);
  const update=(id:string,patch:Partial<SiteExclusion>)=>onChange({...container,exclusions:container.exclusions?.map(z=>z.id===id?{...z,...patch}:z)});
  const edit=(z:typeof rows[number],patch:Partial<ContainerAccessory>)=>update(z.id,{accessory:{...z.accessory,...patch}});
  const remove=(id:string)=>{
    for(const key of [...axes,"quantity","weight","support-load"])onValidityChange(`accessory-${id}-${key}`,true);
    // Removing a row explicitly removes its incoming dependency edges as well.
    const next=container.exclusions?.filter(z=>z.id!==id).map(z=>z.accessory?{...z,accessory:{...z.accessory,afterAccessoryIds:z.accessory.afterAccessoryIds.filter(v=>v!==id)}}:z);
    onChange({...container,exclusions:next?.length?next:undefined});
  };
  const add=(kind:SiteExclusion["kind"])=>{const id=`a-${crypto.randomUUID()}`;onChange({...container,exclusions:[...container.exclusions??[],{id,name:tr(kind==="obstacle"?"整柜材料":"安装预留",kind==="obstacle"?"Container material":"Installation reservation")+` ${rows.length+1}`,kind,x:0,y:0,z:0,dx:Math.min(100,container.length/4),dy:Math.min(100,container.width/4),dz:Math.min(100,container.height/4),accessory:{type:"timber",quantity:1,unitWeightKg:kind==="reserved"?0:null,phase:"before-cargo",relatedProductIds:[],afterAccessoryIds:[],source:"",revision:"",note:""}}]});};
  const mass=containerAccessoryWeight(container);
  return <details className="panel container-accessory-settings">
    <summary>{tr("整柜附件与固定预留","Container accessories and securing reservations")} <small>{rows.length} {tr("项","items")}</small></summary>
    <div className="accessory-header">
      <div className="accessory-actions">
        {(["obstacle","reserved"] as const).map(kind=><button key={kind} type="button" className="button small" disabled={invalid||!!error||only||(container.exclusions?.length??0)>=MAX_SITE_EXCLUSIONS} onClick={()=>add(kind)}>{tr(kind==="obstacle"?"新增实体附件":"新增安装预留",kind==="obstacle"?"Add physical accessory":"Add installation reservation")}</button>)}
      </div>
      <div className="accessory-mass">
        <span>{tr("附件计划重量","Accessory planned mass")}</span>
        <strong>{Number.isFinite(mass)?`${mass.toLocaleString()} kg`:tr("未填写完整","Incomplete")}</strong>
      </div>
    </div>
    <details className="accessory-entry-help">
      <summary>{tr("坐标与重量录入说明","Coordinate and mass guidance")}</summary>
      <p>{tr("坐标从实际柜内柜头、左壁、地板起算。每行包络覆盖该行全部数量，分散位置请分条录入。实体材料和安装空间始终禁占，重叠容积只扣一次。","Coordinates use the physical inner nose, left wall and floor. Each row envelope covers its entire quantity. Use separate rows for distributed positions. Both types remain clear and overlapping volume is deducted once.")}</p>
      <p>{tr("附件与柜内区域合计最多 16 条。单箱或托盘自重已包含的材料无需再填。计划重量以实称复核，固定强度和安装可达仍须核验。","Accessories and site exclusions share a 16-region limit. Enter independent accessories once, excluding material covered by carton or pallet tare. Planned mass is not a scale reading. Securing strength and installation reach remain unverified.")}</p>
    </details>
    {error&&<p role="alert">{error}</p>}
    {rows.map((z,index)=>{const a=z.accessory,label=`${tr("附件","Accessory")} ${index+1}`;return <fieldset key={z.id}><legend>{label} · {z.kind==="reserved"?tr("安装预留（无重量）","Installation space (no mass)"):tr("实体材料","Physical material")}</legend>
      <div className="accessory-main-grid">
      <div className="accessory-location">
      <div className="accessory-fields">
        <label>{tr("名称","Name")}<input aria-label={`${label} ${tr("名称","name")}`} maxLength={100} value={z.name} onChange={e=>update(z.id,{name:e.target.value})}/></label>
        <label>{tr("材料类型","Material type")}<select aria-label={`${label} ${tr("类型","type")}`} value={a.type} onChange={e=>edit(z,{type:e.target.value as ContainerAccessory["type"]})}>{ACCESSORY_TYPES.map(t=><option key={t} value={t}>{tr(...ACCESSORY_TYPE_TEXT[t])}</option>)}</select></label>
        <label>{tr("数量","Quantity")}<NumericInput ariaLabel={`${label} ${tr("数量","quantity")}`} value={a.quantity} integer min={1} max={10000} resetToken={resetToken} onValidityChange={v=>onValidityChange(`accessory-${z.id}-quantity`,v)} onValueChange={quantity=>edit(z,{quantity})}/></label>
        {z.kind==="obstacle"&&<label>{tr("单件计划重量 kg","Planned unit mass kg")}<NumericInput ariaLabel={`${label} ${tr("单件计划重量","planned unit mass")}`} value={a.unitWeightKg??0} min={0} max={1000000} resetToken={resetToken} onValidityChange={v=>onValidityChange(`accessory-${z.id}-weight`,v)} onValueChange={unitWeightKg=>edit(z,{unitWeightKg})}/>{a.unitWeightKg===null&&<><small>{tr("尚未填写；输入计划值或明确确认零重量。","Not entered; provide planned mass or explicitly confirm zero.")}</small><button type="button" className="button small" onClick={()=>edit(z,{unitWeightKg:0})}>{tr("确认零重量","Confirm zero mass")}</button></>}</label>}
        <label>{tr("安装阶段","Installation phase")}<select aria-label={`${label} ${tr("安装阶段","installation phase")}`} value={a.phase} onChange={e=>edit(z,{phase:e.target.value as ContainerAccessory["phase"]})}><option value="before-cargo">{tr("装货前安装","Before cargo")}</option><option value="after-cargo">{tr("关联货物装完后安装","After associated cargo")}</option></select></label>
      </div>
      <div className="accessory-envelope" role="group" aria-label={tr("安装包络","Installation envelope")}>
        {axes.map((axis,i)=><label key={axis}>{["X","Y","Z",tr("长","Length"),tr("宽","Width"),tr("高","Height")][i]} mm<NumericInput ariaLabel={`${label} ${axis}`} value={z[axis]} min={i<3?0:.001} max={1000000} resetToken={resetToken} onValidityChange={v=>onValidityChange(`accessory-${z.id}-${axis}`,v)} onValueChange={n=>update(z.id,{[axis]:n})}/></label>)}
      </div>
      </div>
      {z.kind==="obstacle"&&<div className="accessory-support-settings">
        <label className="accessory-check"><input type="checkbox" aria-label={`${label} ${tr("实心支承声明","solid support declaration")}`} checked={!!a.support} onChange={e=>{onValidityChange(`accessory-${z.id}-support-load`,true);edit(z,{support:e.target.checked?{version:1,surface:"solid-rectangle",maxLoadKg:null}:undefined});}}/>{tr("声明为单件落地、实心平顶支承件","Declare one solid, flat-top floor support")}</label>
        {a.support&&<>
          <div className="accessory-support-rating">
            <label className="accessory-check"><input type="checkbox" aria-label={`${label} ${tr("已知静载上限","known static load limit")}`} checked={a.support.maxLoadKg!==null} onChange={e=>{onValidityChange(`accessory-${z.id}-support-load`,true);edit(z,{support:{...a.support!,maxLoadKg:e.target.checked?0:null}});}}/>{tr("已填写上方静载上限（0 表示禁止承载）","Entered upper static load limit (0 prohibits load)")}</label>
            {a.support.maxLoadKg!==null&&<label className="accessory-rating-input">{tr("上方静载上限 kg","Upper static load limit kg")}<NumericInput ariaLabel={`${label} ${tr("静载上限","static load limit")}`} value={a.support.maxLoadKg} min={0} max={1000000} resetToken={resetToken} onValidityChange={v=>onValidityChange(`accessory-${z.id}-support-load`,v)} onValueChange={maxLoadKg=>edit(z,{support:{...a.support!,maxLoadKg}})}/></label>}
          </div>
          <p>{tr("支承件须为装货前安装的单件实心体，数量填 1，Z 填 0。长宽填写实际接触面，高填写厚度。静载上限按上方货物计，来源或版本缺失时显示待核验。","Use one solid piece installed before cargo, with quantity 1 and Z = 0. Enter the actual contact face and thickness. The limit applies to the load above. Missing source or revision leaves the rating unverified.")}</p>
        </>}
      </div>}
      </div>
      <div className="accessory-row-footer">
        <details className="accessory-installation">
          <summary>{tr("资料、货物关联与安装依赖","Source, associated cargo and dependencies")}</summary>
          <div className="accessory-secondary-fields">
            <label>{tr("资料来源","Source")}<input aria-label={`${label} ${tr("资料来源","source")}`} maxLength={500} value={a.source} onChange={e=>edit(z,{source:e.target.value})}/></label>
            <label>{tr("版本","Revision")}<input aria-label={`${label} ${tr("版本","revision")}`} maxLength={100} value={a.revision} onChange={e=>edit(z,{revision:e.target.value})}/></label>
            <label>{tr("安装／拆除备注","Installation / removal notes")}<input aria-label={`${label} ${tr("备注","notes")}`} maxLength={500} value={a.note} onChange={e=>edit(z,{note:e.target.value})}/></label>
          </div>
          {(products.length>0||a.relatedProductIds.length>0)&&<div className="accessory-checks"><strong>{tr("关联货物（产品标识）","Associated cargo (product IDs)")}</strong>
            {products.map(p=><label className="accessory-check" key={p.id}><input type="checkbox" checked={a.relatedProductIds.includes(p.id)} onChange={e=>edit(z,{relatedProductIds:e.target.checked?[...a.relatedProductIds,p.id]:a.relatedProductIds.filter(id=>id!==p.id)})}/>{p.sku}</label>)}
            {a.relatedProductIds.some(id=>!products.some(p=>p.id===id))&&<button type="button" className="button small" onClick={()=>edit(z,{relatedProductIds:a.relatedProductIds.filter(id=>products.some(p=>p.id===id))})}>{tr("清除失效货物关联","Clear missing cargo references")}</button>}
          </div>}
          {(rows.length>1||a.afterAccessoryIds.length>0)&&<div className="accessory-checks"><strong>{tr("必须先安装的附件","Accessories to install first")}</strong>
            {rows.filter(v=>v.id!==z.id).map(v=><label className="accessory-check" key={v.id}><input type="checkbox" checked={a.afterAccessoryIds.includes(v.id)} onChange={e=>edit(z,{afterAccessoryIds:e.target.checked?[...a.afterAccessoryIds,v.id]:a.afterAccessoryIds.filter(id=>id!==v.id)})}/>{v.name} · {v.id}</label>)}
            {a.afterAccessoryIds.some(id=>!rows.some(v=>v.id===id))&&<button type="button" className="button small" onClick={()=>edit(z,{afterAccessoryIds:a.afterAccessoryIds.filter(id=>rows.some(v=>v.id===id))})}>{tr("清除失效安装依赖","Clear missing installation dependencies")}</button>}
          </div>}
        </details>
        <button type="button" className="button small accessory-remove" onClick={()=>remove(z.id)}>{tr("删除附件及其依赖引用","Remove accessory and references")} {index+1}</button>
      </div>
    </fieldset>;})}
  </details>;
}
