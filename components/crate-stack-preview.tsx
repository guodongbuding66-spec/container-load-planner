"use client";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { CRATE_CORNERS, type CrateCorner } from "../lib/packing/crate-structure";
import type { CrateReviewUnit, CrateStackReview } from "../lib/packing/crate-bearing";
import { cratePreview, type CratePreview } from "../lib/packing/crate-preview";
import { projectModelPreview } from "../lib/packing/model-preview";
import type { CameraView, SceneSize } from "../lib/packing/camera-fit";
import { SceneCameraController } from "../lib/packing/scene-camera";
import { supportsWebGL } from "../lib/packing/webgl-support";
import { PalletStructures } from "./scene-details";
import { SceneAnalysisOverlay } from "./scene-analysis-overlay";
import { SceneCameraRig } from "./scene-camera-rig";
import { SceneErrorBoundary } from "./scene-error-boundary";
import { useModelViewport } from "./use-model-viewport";
import { tr, useLanguage } from "./language";

const subscribe=()=>()=>{};
const roleLabels={foot:["底脚","Foot"],deck:["底板接触片","Deck contact patch"],post:["立柱","Post"],cap:["箱盖角部","Lid corner"]} as const;
const initialOrbit={yaw:Math.atan(.32),pitch:Math.atan(.38/Math.sqrt(1+.32*.32))};
const cameraPresets=[["perspective","三维","3D",initialOrbit.yaw,initialOrbit.pitch],["side","长 × 高","Length × height",0,0],["door","宽 × 高","Width × height",Math.PI/2,0],["top","俯视","Top",0,Math.PI/2]] as const;

export function CratePreviewFallback({data,orbit,onOrbit}:{data:CratePreview;orbit:{yaw:number;pitch:number};onOrbit:(v:{yaw:number;pitch:number})=>void}){
  const {host,viewport}=useModelViewport({width:660,height:360}),drag=useRef<{id:number;x:number;y:number}|null>(null);
  const direction:SceneSize=[Math.sin(orbit.yaw)*Math.cos(orbit.pitch),Math.sin(orbit.pitch),Math.cos(orbit.yaw)*Math.cos(orbit.pitch)];
  const bounds={size:data.size,origin:[0,0,0] as SceneSize},model=projectModelPreview(data.projectionParts,bounds,direction,viewport.width,viewport.height),selected=projectModelPreview(data.projectionHighlights,bounds,direction,viewport.width,viewport.height),targets=projectModelPreview(data.projectionTargets,bounds,direction,viewport.width,viewport.height);
  return <div ref={host} className="crate-preview-stage"><svg viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="img" aria-label={tr("木箱实体路径坐标投影：拖动或方向键旋转","Crate physical-path coordinate projection: drag or use arrow keys to orbit")} tabIndex={0}
    onPointerDown={e=>{if(e.button!==0)return;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;onOrbit({yaw:orbit.yaw+(e.clientX-d.x)*.012,pitch:Math.max(-1.45,Math.min(1.45,orbit.pitch+(e.clientY-d.y)*.009))});drag.current={id:e.pointerId,x:e.clientX,y:e.clientY};}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
    onKeyDown={e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))return;e.preventDefault();onOrbit({yaw:orbit.yaw+(e.key==="ArrowLeft"?-.15:e.key==="ArrowRight"?.15:0),pitch:Math.max(-1.45,Math.min(1.45,orbit.pitch+(e.key==="ArrowUp"?.1:e.key==="ArrowDown"?-.1:0)))});}}>
    <g opacity=".4">{model.faces.map(f=><polygon key={f.id} points={f.points} fill={f.color} stroke={f.color} strokeWidth=".4"/>)}</g>
    <g>{targets.faces.map(f=><polygon key={f.id} data-contact-reference="true" points={f.points} fill={f.color} stroke="#237da1" strokeWidth="2"/>)}</g>
    <g>{selected.faces.map(f=><polygon key={f.id} data-path-role={f.name} points={f.points} fill={f.color} stroke={data.color} strokeWidth=".6"/>)}</g>
  </svg></div>;
}

export function CrateStackPreview({units,report}:{units:readonly CrateReviewUnit[];report:CrateStackReview}){
  useLanguage();
  const [selectedId,setSelectedId]=useState(units[0]?.pallet.id??""),[corner,setCorner]=useState<CrateCorner>("L0W0"),[view,setView]=useState<CameraView>("perspective"),[orbit,setOrbit]=useState(initialOrbit);
  const current=units.some(u=>u.pallet.id===selectedId)?selectedId:units[0]?.pallet.id??"";
  const data=useMemo(()=>cratePreview(units,report,current,corner),[units,report,current,corner]),ready=useSyncExternalStore(subscribe,()=>true,()=>false);
  const [controller,setController]=useState(()=>new SceneCameraController()),scale=data?3/Math.max(...data.size):1,offset=useMemo(()=>new THREE.Vector3(...(data?.offset??[0,0,0])).multiplyScalar(scale),[data,scale]);
  const row=report.units.find(u=>u.id===current),path=row?.structure.paths.find(p=>p.id===corner),contact=report.contacts.find(c=>c.upperId===current&&c.foot.id===corner);
  const colored=useMemo(()=>units.map(u=>({...u.pallet,packaging:u.pallet.packaging?{...u.pallet.packaging,opacity:u.pallet.id===current ? .5 : .18}:undefined})),[units,current]);
  if(!data)return <p role="alert">{tr("包装几何无效，结构预览已暂停。","Invalid packaging geometry; structural preview is paused.")}</p>;
  return <section className="crate-stack-preview" aria-label={tr("独立叠放结构预览","Independent stack structural preview")}>
    <h4>{tr("包装结构与传力路径","Packaging structure and load paths")}</h4>
    <p className="helper-text">{tr("只显示包装结构，不含箱内货物。高亮表示几何路径及预检状态，不代表连接件或材料强度已经通过。","Packaging only; cargo is omitted. Highlights show geometric paths and preflight status, never verified joints or material strength.")}</p>
    <div className="crate-preview-toolbar"><label>{tr("查看木箱","Inspect crate")}<select aria-label={tr("结构预览木箱","Structural preview crate")} value={current} onChange={e=>setSelectedId(e.target.value)}>{units.map((u,i)=><option key={u.pallet.id} value={u.pallet.id}>{i+1}. {u.pallet.id}</option>)}</select></label><div role="group" aria-label={tr("传力角部","Load-path corner")}>{CRATE_CORNERS.map(id=><button type="button" className="button small" key={id} aria-pressed={id===corner} onClick={()=>setCorner(id)}>{id}</button>)}</div></div>
    <div className="crate-preview-toolbar">{cameraPresets.map(([code,zh,en,yaw,pitch])=><button type="button" className="button small" aria-pressed={view===code} key={code} onClick={()=>{setView(code);setOrbit({yaw,pitch});setController(new SceneCameraController());}}>{tr(zh,en)}</button>)}</div>
    {!ready?<p>{tr("正在检测三维图形能力…","Checking 3D graphics…")}</p>:!supportsWebGL()?<><p className="helper-text">{tr("WebGL 未启用，显示同源实体坐标投影，可拖动旋转。","WebGL unavailable; showing the same physical coordinates as an interactive projection.")}</p><CratePreviewFallback data={data} orbit={orbit} onOrbit={v=>{setView("free");setOrbit(v);}}/></>:<SceneErrorBoundary resetKey={`${current}-${corner}`}><div className="crate-preview-stage"><Canvas dpr={[1,1.5]} gl={{antialias:true}}><color attach="background" args={["#f3f7f8"]}/><ambientLight intensity={1.5}/><directionalLight position={[2,5,4]} intensity={2}/><PalletStructures pallets={colored} scale={scale} offset={offset}/><SceneAnalysisOverlay regions={[...data.targets.map((p,i)=>({...p,id:`reference-${i}`,color:"#237da1"})),...data.highlights.map((p,i)=>({...p,id:`path-${i}`,color:data.color}))]} scale={scale} offset={offset}/><SceneCameraRig controller={controller} containerSize={data.size.map(n=>n*scale) as SceneSize} view={view} projection="orthographic" onInteraction={()=>setView("free")}/></Canvas></div></SceneErrorBoundary>}
    <p><strong>{current} / {corner}</strong> · {path?.continuous?tr("四段几何连续（强度未核验）","Four connected geometric segments (strength unverified)"):tr("实体路径不完整","Incomplete physical path")} · {tr("单路径保守上界","Conservative path bound")} {row?.throughLoadBoundKg.toFixed(2)} kg</p>
    {contact&&<p className="helper-text">{tr("下箱接触参考","Lower contact reference")}: {contact.lowerId} / {contact.referenceZone?.id??"—"} · {contact.covered?tr("许可区完整覆盖","Fully covered by permitted zone"):tr("未完整覆盖，蓝色仅为应对齐的参考位置","Not fully covered; blue is only the target reference")}.</p>}
    <div className="upgrade-table-wrap"><table><caption>{tr("选中路径的实际部件区间（mm）","Actual component intervals on selected path (mm)")}</caption><thead><tr><th>{tr("部件","Component")}</th><th>X / Y / Z</th><th>{tr("长 × 宽 × 高","Length × width × height")}</th></tr></thead><tbody>{path?.segments.map(s=><tr key={s.role}><th>{tr(roleLabels[s.role][0],roleLabels[s.role][1])}</th><td>{[s.x,s.y,s.z].map(n=>n.toFixed(2)).join(" / ")}</td><td>{[s.dx,s.dy,s.dz].map(n=>n.toFixed(2)).join(" × ")}</td></tr>)}</tbody></table></div>
  </section>;
}
