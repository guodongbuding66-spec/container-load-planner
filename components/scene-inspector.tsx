"use client";
import {regularSurfaceSpec,regularSurfaceFeatures} from "../lib/packing/surface-inspection";
import { useState } from "react";
import { LockKeyhole, Ruler, Scissors, UnlockKeyhole, X } from "lucide-react";
import { boxFeatures, formatMeasure, isolationKey, type MeasureMode, type Section, type SnapMode, type WallSide } from "../lib/packing/inspection";
import type { PackingResult, PlacedBox } from "../lib/packing/types";
import type { SceneInspection } from "./use-scene-inspection";
import { useTransportAppearance } from "./transport-appearance";
import { tr, useLanguage } from "./language";
import { cargoShapeOf, isRectilinearShape, SHAPE_LABELS } from "../lib/packing/cargo-shape";
import {SavedMeasurementsPanel} from "./saved-measurements-panel";
import {PalletBaseDetails} from "./pallet-base-details";

const MODES:[MeasureMode,string,string][]=[["off","关闭测量","Off"],["points","两点距离","Point distance"],["gap","两箱间距","Carton gap"],["wall","柜壁距离","Wall clearance"]];
const WALLS:[WallSide,string,string][]=[["x-","柜头","Rear wall"],["x+","箱门","Door plane"],["y-","左侧","Left wall"],["y+","右侧","Right wall"],["z-","柜底","Floor"],["z+","柜顶","Ceiling"]];
function isolationOptions(result:PackingResult,type:Section["isolation"]){
  if(type==="pallet")return (result.pallets??[]).map(p=>({value:p.id,label:p.id.replace("floor-pallet-","P")}));
  const keys=[...new Set(result.placements.map(b=>isolationKey(b,type)).filter(Boolean))];
  return keys.map(value=>({value,label:type==="layer"?`${tr("层","Layer")} ${value}`:(JSON.parse(value) as [string,number]).join(" · #")}));
}
export function SceneInspector({result,selected,inspection,onClearSelection,onFocus}:{result:PackingResult;selected:PlacedBox|null;inspection:SceneInspection;onClearSelection:()=>void;onFocus?:()=>void}){
  useLanguage();const a=useTransportAppearance(),{value,measurement,update}=inspection;
  const [feature,setFeature]=useState(0);
  const display=inspection.displayBoxes.find(b=>b.id===selected?.id)??selected;
  const spec=selected?regularSurfaceSpec(selected,result.cargoDetails?.[selected.productId]??{}):null;
  const solid=value.basis==="surface",available=!solid||!!spec&&value.section.axis==="off";
  const features=display&&available?(solid?regularSurfaceFeatures(selected!,spec!,a.measureSnap):boxFeatures(display,a.measureSnap)):[];
  const options=isolationOptions(result,value.section.isolation);
  const section=(patch:Partial<Section>)=>update({section:{...value.section,...patch}});
  const fmt=(n:number)=>formatMeasure(n,a.dimensionUnit,a.measurePrecision);
  const shape=selected&&!selected.supportOnly?cargoShapeOf(result.cargoDetails?.[selected.productId]??{}):"box";
  const pallet=selected?.supportOnly?result.pallets?.find(p=>p.id===selected.id):undefined;
  return <>
    <section className="scene-inspector-section"><div className="scene-dock-title"><strong>{tr("选中属性","Selection")}</strong>{selected&&<button aria-label={tr("关闭箱体详情","Close box details")} onClick={onClearSelection}><X size={16}/></button>}</div>
      {selected?<><strong className="scene-inspector-sku">{selected.sku}</strong><small>{selected.id}</small>{pallet?<PalletBaseDetails result={result} pallet={pallet} unit={a.dimensionUnit} precision={a.measurePrecision}/>:<dl className="scene-properties"><dt>{tr("尺寸","Size")}</dt><dd>{[selected.dx,selected.dy,selected.dz].map(fmt).join(" × ")}</dd><dt>XYZ</dt><dd>{[selected.x,selected.y,selected.z].map(fmt).join(" / ")}</dd><dt>{tr("重量","Weight")}</dt><dd>{selected.weight} kg</dd>{selected.setCode&&<><dt>{tr("套号","Set")}</dt><dd>{selected.setCode} · #{selected.setNumber}</dd></>}{!!selected.palletIds?.length&&<><dt>{tr("托盘","Pallet")}</dt><dd>{selected.palletIds.map(p=>p.replace("floor-pallet-","P")).join(" / ")}</dd></>}</dl>}{onFocus&&<button className="scene-inspector-action" onClick={onFocus}>{tr("放大查看","Focus on selection")}</button>}</>:<p>{tr("点击模型或货物列表查看属性。","Select a model or cargo-list item to inspect it.")}</p>}
      {selected&&shape!=="box"&&<p>{tr(...SHAPE_LABELS[shape])} · {isRectilinearShape(result.cargoDetails?.[selected.productId]??{})&&tr("实际组成块已用于碰撞与水平承托校验。","Solid blocks are used for collision and horizontal support checks.")} {tr("尺寸、两箱间距及柜壁距离使用外包络；两点测量可另选规则实体表面。实体模型重心按体积及已填写部件重量估算。","Dimensions, carton gaps and wall clearances use the envelope; point measurements can select supported solid surfaces. Solid-model gravity centres use volume and entered component masses.")}</p>}
    </section>
    <section className="scene-inspector-section"><h3><Ruler size={16}/>{tr("测量工具","Measurement")}</h3>
      <label>{tr("测量方式","Mode")}<select aria-label={tr("测量方式","Measurement mode")} value={value.mode} onChange={e=>inspection.setMode(e.target.value as MeasureMode)}>{MODES.map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>
      {value.mode!=="off"&&<>
        {value.mode==="points"&&<><label>{tr("测量依据","Basis")}<select aria-label={tr("测量依据","Measurement basis")} value={value.basis} onChange={e=>inspection.setBasis(e.target.value as "envelope"|"surface")}><option value="envelope">{tr("外包络","Outer envelope")}</option><option value="surface">{tr("规则实体表面","Regular solid surface")}</option></select></label>
        {solid&&<p>{tr("两实体取点之间的直线距离；不是沿面长度或两件货物的全局最短净距。支持长方体、楔形、梯形、L／U／T 型和阶梯形。俯视图点击会投影到最近实体特征，精确坐标以下方预览为准。","Straight-line distance between two solid picks, rather than surface length or the global minimum cargo clearance. Supports cuboids, wedges, trapezoids, L/U/T profiles and steps. Top-view clicks project to the closest solid feature; check the exact coordinates below.")}</p>}
        {solid&&!available&&<p role="status">{value.section.axis!=="off"?tr("请关闭剖切后进行实体取点；切面不是原货物表面。","Turn sectioning off before picking a solid surface; cut planes are artificial."):tr("此货物暂不支持实体取点，请选择受支持外形，或切换到外包络。","Solid picking is unavailable for this cargo. Select a supported shape or switch to the outer envelope.")}</p>}
        <label>{tr("捕捉","Snap")}<select aria-label={tr("测量捕捉","Measurement snap")} value={a.measureSnap} onChange={e=>a.updatePreferences({measureSnap:e.target.value as SnapMode})}>{[["vertex","点（角点）","Vertex"],["edge","边","Edge"],["face","面","Face"]].map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>{selected&&features.length>0&&<div className="scene-feature-picker"><label>{tr("精确取点","Exact feature")}<select aria-label={tr("测量取点位置","Measurement feature")} value={Math.min(feature,features.length-1)} onChange={e=>setFeature(Number(e.target.value))}>{features.map((p,i)=><option key={i} value={i}>{tr(a.measureSnap==="vertex"?"角点":a.measureSnap==="edge"?"边中点":"面中心",a.measureSnap==="vertex"?"Vertex":a.measureSnap==="edge"?"Edge midpoint":"Face centre")} {i+1}</option>)}</select></label><small>XYZ {features[Math.min(feature,features.length-1)].map(fmt).join(" / ")}</small><button disabled={value.locked} onClick={()=>inspection.pick(display!,features[Math.min(feature,features.length-1)])}>{tr("取此点","Pick this point")}</button></div>}</>}
        {value.mode==="wall"&&<label>{tr("参考柜壁","Reference wall")}<select aria-label={tr("测量参考柜壁","Measurement wall")} value={value.wall} onChange={e=>update({wall:e.target.value as WallSide})}>{WALLS.map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>}
        <label>{tr("小数位","Decimals")}<select aria-label={tr("测量小数精度","Measurement precision")} value={a.measurePrecision} onChange={e=>a.updatePreferences({measurePrecision:Number(e.target.value)})}>{[0,1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <p className="scene-measure-hint">{value.mode==="points"?tr("在模型上取两点，或选中货物后使用精确取点。","Pick two model points, or select cargo and use the exact feature picker."):value.mode==="gap"?tr("依次选择两个不同箱体，计算完整外箱的最短间距。","Select two different cartons to measure the shortest gap between their full outer boxes."):tr("选择一个箱体，测量到实际柜内边界的净距。","Select a carton to measure its clearance to the physical inner boundary.")}</p>
        {measurement?<output className="scene-measure-result"><strong>{solid&&value.mode==="points"?tr("实体直线距 · ","Solid point distance · "):""}{fmt(measurement.distance)}</strong><span>ΔX {fmt(measurement.deltas[0])} · ΔY {fmt(measurement.deltas[1])} · ΔZ {fmt(measurement.deltas[2])}</span><span>A {measurement.a.map(fmt).join(" / ")}</span><span>B {measurement.b.map(fmt).join(" / ")}</span></output>:<p role="status">{value.mode!=="wall"&&inspection.pickedCount===1?tr("等待第二个测量对象","Waiting for the second measurement pick"):tr("等待测量取点或选择箱体","Pick a point or select cargo to measure")}</p>}
        <div className="scene-inspector-actions"><button disabled={!measurement&&!value.locked} aria-pressed={value.locked} onClick={()=>update({locked:!value.locked})}>{value.locked?<UnlockKeyhole size={14}/>:<LockKeyhole size={14}/>} {tr(value.locked?"解锁测量":"锁定测量",value.locked?"Unlock":"Lock")}</button><button onClick={inspection.clear}>{tr("清除测量","Clear")}</button></div>
      </>}
    </section>
    <SavedMeasurementsPanel result={result} inspection={inspection}/>
    <section className="scene-inspector-section"><h3><Scissors size={16}/>{tr("剖切与隔离","Section & isolate")}</h3>
      {selected&&value.section.axis!=="off"&&<p>{tr("选中尺寸为完整外箱；剖切显示局部。","Selection dimensions describe the full outer box; sectioning shows only part of it.")}</p>}
      <label>{tr("剖切方向","Section axis")}<select aria-label={tr("剖切方向","Section axis")} value={value.section.axis} onChange={e=>section({axis:e.target.value as Section["axis"]})}>{[["off","关闭剖切","Off"],["x","沿柜长 X","Length X"],["y","沿柜宽 Y","Width Y"],["z","沿柜高 Z","Height Z"]].map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>
      {value.section.axis!=="off"&&<><label className="scene-cut-slider">{tr("剖切位置","Section position")} <output>{value.section.percent}%</output><input type="range" min={0} max={100} value={value.section.percent} aria-label={tr("剖切位置","Section position")} onChange={e=>section({percent:Number(e.target.value)})}/></label><label className="scene-inspector-check"><input type="checkbox" checked={value.section.reverse} onChange={e=>section({reverse:e.target.checked})}/>{tr("保留另一侧","Keep the opposite side")}</label></>}
      <label>{tr("单独查看","Isolate")}<select aria-label={tr("货物隔离方式","Cargo isolation")} value={value.section.isolation} onChange={e=>{const type=e.target.value as Section["isolation"];section({isolation:type,target:isolationOptions(result,type)[0]?.value??""});}}>{[["all","全部货物","All cargo"],["layer","单层","One layer"],["pallet","单托盘货物","One pallet load"],["set","单套货物","One product set"]].map(([id,zh,en])=><option key={id} value={id}>{tr(zh,en)}</option>)}</select></label>
      {value.section.isolation!=="all"&&(options.length?<select aria-label={tr("隔离目标","Isolation target")} value={value.section.target} onChange={e=>section({target:e.target.value})}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<p>{tr("本方案没有对应的分组。","This plan has no matching groups.")}</p>)}
      {value.section.isolation==="pallet"&&<p>{tr("按承托关联筛选；跨托盘的箱体可出现在多个托盘视图中。","Filtered by support links; a carton spanning pallets may appear in several pallet views.")}</p>}
      <p>{tr("查看范围变化不改变完整方案的箱数、容量、重量与导出。","The view filter leaves full-plan counts, capacity, weight and exports unchanged.")}</p>
    </section>
  </>;
}
