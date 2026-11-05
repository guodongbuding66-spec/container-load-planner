"use client";

import {useMemo,useState} from "react";
import {MAX_FLOOR_ZONES,parseVehicleEngineering,reviewVehicleEngineering} from "../lib/packing/vehicle-engineering";
import type {ContainerSpec,PackingResult} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

const asNumber=(value:string)=>value.trim()?Number(value):NaN;
const zoneFields=[
 ["x","距柜头 mm","From nose mm"],["y","距左壁 mm","From left wall mm"],
 ["dx","区段长 mm","Zone length mm"],["dy","区段宽 mm","Zone width mm"],["maxKg","区段额定载荷 kg","Zone rating kg"],
] as const;
const balanceFields=[
 ["minX","纵向最小 mm","Minimum longitudinal mm"],["maxX","纵向最大 mm","Maximum longitudinal mm"],
 ["minY","横向最小 mm","Minimum lateral mm"],["maxY","横向最大 mm","Maximum lateral mm"],
] as const;
type ZoneDraft={id:string;name:string;x:string;y:string;dx:string;dy:string;maxKg:string};

export function VehicleEngineeringSettings({container,onChange}:{container:ContainerSpec;onChange:(next:ContainerSpec)=>void}){
 useLanguage();
 const current=container.engineering;
 const [zones,setZones]=useState<ZoneDraft[]>(()=>current?.zones.map(z=>({...z,x:String(z.x),y:String(z.y),dx:String(z.dx),dy:String(z.dy),maxKg:String(z.maxKg)}))??[]);
 const [includeBalance,setIncludeBalance]=useState(!!current?.balance);
 const [message,setMessage]=useState("");
 const apply=(form:HTMLFormElement)=>{
  try{
   const data=new FormData(form),get=(key:string)=>String(data.get(key)??"");
   const pressure=get("pressure");
   const profile=parseVehicleEngineering({version:1,source:get("source"),revision:get("revision"),maxContactKgM2:pressure.trim()?asNumber(pressure):null,
    zones:zones.map(z=>({...z,...Object.fromEntries(zoneFields.map(([key])=>[key,asNumber(z[key])]))})),
    ...(includeBalance?{balance:Object.fromEntries(balanceFields.map(([key])=>[key,asNumber(get(key))]))}:{})},container);
   onChange({...container,engineering:profile});
   setMessage(tr("已保存限值。重新计算后生效。","Limits saved. Recalculate to apply them."));
  }catch(e){const [zh,en]=(e instanceof Error?e.message:String(e)).split(" / ");setMessage(tr(zh,en??zh));}
 };
 const addZone=()=>{
  let n=zones.length+1;while(zones.some(z=>z.id===`floor-${n}`))n++;
  setZones([...zones,{id:`floor-${n}`,name:"",x:"0",y:"0",dx:"",dy:"",maxKg:""}]);
 };
 return <details className="wizard-advanced">
  <summary>{tr("地板载荷与配重约束","Floor loads and balance limits")}{current?` · ${current.revision}`:""}</summary>
  <form className="upgrade-body" onSubmit={e=>{e.preventDefault();apply(e.currentTarget);}}>
   <p>{tr("使用实际柜型资料填写限值。分区和配重坐标从柜头、左壁量起。接触面按累计重量的保守上界复核。","Enter limits from the actual vehicle documentation. Zones and balance coordinates start at the nose and left wall. Contact checks use conservative cumulative mass bounds.")}</p>
   <div className="feature-form-grid">
    <label>{tr("工程资料来源","Engineering evidence source")}<input required name="source" maxLength={500} defaultValue={current?.source}/></label>
    <label>{tr("资料版本或日期","Evidence revision or date")}<input required name="revision" maxLength={120} defaultValue={current?.revision}/></label>
    <label>{tr("接触面限值 kg/m²（可留空）","Contact limit kg/m² (optional)")}<input name="pressure" type="number" step="any" min="0.001" defaultValue={current?.maxContactKgM2??""}/></label>
   </div>
   {zones.map((z,i)=><fieldset key={z.id} className="feature-form-grid">
    <legend>{tr("地板区段","Floor zone")} {i+1}</legend>
    <label>{tr("区段名称","Zone name")}<input required maxLength={100} value={z.name} onChange={e=>setZones(old=>old.map(p=>p.id===z.id?{...p,name:e.target.value}:p))}/></label>
    {zoneFields.map(([key,zh,en])=><label key={key}>{tr(zh,en)}<input required type="number" min="0" step="any" value={z[key]} onChange={e=>setZones(old=>old.map(p=>p.id===z.id?{...p,[key]:e.target.value}:p))}/></label>)}
    <button className="button" type="button" onClick={()=>setZones(old=>old.filter(p=>p.id!==z.id))}>{tr("移除此区段","Remove this zone")}</button>
   </fieldset>)}
   <div className="upgrade-actions"><button className="button" type="button" disabled={zones.length>=MAX_FLOOR_ZONES} onClick={addZone}>{tr("添加地板区段","Add floor zone")}</button>
    <label><input type="checkbox" checked={includeBalance} onChange={e=>setIncludeBalance(e.target.checked)}/>{tr("限定平面重心窗口","Constrain the horizontal center of mass")}</label>
   </div>
   {includeBalance&&<div className="feature-form-grid">{balanceFields.map(([key,zh,en])=><label key={key}>{tr(zh,en)}<input required name={key} type="number" min="0" step="any" defaultValue={current?.balance?.[key]}/></label>)}</div>}
   <div className="upgrade-actions"><button className="button primary" type="submit">{tr("保存工程限值","Save engineering limits")}</button>
    {current&&<button className="button" type="button" onClick={()=>onChange({...container,engineering:undefined})}>{tr("移除当前柜型限值","Remove this vehicle's limits")}</button>}
   </div>
   {message&&<p role="status">{message}</p>}
  </form>
 </details>;
}

function downloadReview(plan:PackingResult,review:NonNullable<ReturnType<typeof reviewVehicleEngineering>>){
 const contents=JSON.stringify({format:"cargo-fit-vehicle-engineering",version:1,engineVersion:plan.engineVersion,planId:plan.id,containerId:plan.container.id,review},null,2);
 const url=URL.createObjectURL(new Blob([contents],{type:"application/json"})),a=document.createElement("a");
 a.href=url;a.download="vehicle-engineering-review.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function VehicleEngineeringReview({plan}:{plan:PackingResult}){
 useLanguage();
 const review=useMemo(()=>reviewVehicleEngineering(plan),[plan]);
 if(!review)return null;
 const status=review.state==="pass"?tr("录入限值内","Within entered limits"):review.state==="fail"?tr("超过录入限值","Entered limits exceeded"):tr("接触资料未核验","Contact evidence unverified");
 return <details className="upgrade-panel">
  <summary>{tr("地板载荷与配重复核","Floor load and balance review")} · {status}</summary>
  <div className="upgrade-body">
   <p>{review.profile.source} · {review.profile.revision} · {review.totalKg.toFixed(2)} kg</p>
   {review.cg&&<p>{tr("从柜头／左壁量起的计划重心","Planned center of mass from nose / left wall")} {review.cg.x.toFixed(1)} / {review.cg.y.toFixed(1)} mm</p>}
   {review.maxKnownContactKgM2!==null&&<p>{tr("已识别接触面的最大载荷上界","Highest identified contact load bound")} {review.maxKnownContactKgM2.toFixed(1)} kg/m²{review.profile.maxContactKgM2!==null?` / ${review.profile.maxContactKgM2} kg/m²`:""}</p>}
   {review.errors.length>0&&<ul>{review.errors.map(e=>{
    const boundary=e.search(/ \/ (Contact load bound|Floor zone load bound|Loaded mass center)/);
    return <li key={e}>{boundary>=0?tr(e.slice(0,boundary),e.slice(boundary+3)):e}</li>;
   })}</ul>}
   {review.zones.length>0&&<div className="upgrade-table-wrap"><table><thead><tr><th>{tr("地板区段","Floor zone")}</th><th>{tr("载荷上界 kg","Load bound kg")}</th><th>{tr("额定 kg","Rating kg")}</th></tr></thead><tbody>{review.zones.map(z=><tr key={z.id}><td>{z.name}</td><td>{z.loadKg.toFixed(2)}</td><td>{z.maxKg}</td></tr>)}</tbody></table></div>}
   {review.unknown.length>0&&<p>{tr("待核验接触路径或支承面","Contact paths or support faces awaiting evidence")} {review.unknown.length}</p>}
   <button className="button" type="button" onClick={()=>downloadReview(plan,review)}>{tr("下载地板与配重复核 JSON","Download floor and balance review JSON")}</button>
  </div>
 </details>;
}
