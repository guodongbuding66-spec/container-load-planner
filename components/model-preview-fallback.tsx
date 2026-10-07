"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { palletParts } from "../lib/packing/floor-pallets";
import { createTransportParts, transportOpacity, transportSceneBounds, type TransportDisplayMode, type TransportPart } from "../lib/packing/transport-model";
import { projectModelPreview } from "../lib/packing/model-preview";
import { layoutSceneLabel, type LabelRect } from "../lib/packing/scene-labels";
import type { ContainerSpec, FloorPalletConfig } from "../lib/packing/types";
import type { SceneSize } from "../lib/packing/camera-fit";
import { tr, useLanguage } from "./language";

export function ModelPreviewFallback({ space, pallet, mode, transparency }: {space?:ContainerSpec;pallet?:FloorPalletConfig;mode:TransportDisplayMode;transparency:number}) {
  useLanguage();
  const [orbit,setOrbit]=useState({yaw:.72,pitch:.42}),[zoom,setZoom]=useState(1);
  const host=useRef<HTMLDivElement>(null);
  const [viewport,setViewport]=useState({width:520,height:260});
  useLayoutEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;if(width>0&&height>0)setViewport(v=>v.width===width&&v.height===height?v:{width,height});});observer.observe(host.current);return()=>observer.disconnect();},[]);
  const pointer=useRef<{x:number;y:number}|null>(null);
  const length=pallet?.length??space!.length,width=pallet?.width??space!.width,height=pallet?.height??space!.height;
  const parts=useMemo<TransportPart[]>(()=>pallet?palletParts(length,width,height).map((p)=>({name:`pallet-${p.kind}`,shape:"box",role:"floor",position:[p.x+p.dx/2-length/2,p.z+p.dz/2,p.y+p.dy/2-width/2],size:[p.dx,p.dz,p.dy]})):mode==="model"?createTransportParts(space!):[],[pallet,space,length,width,height,mode]);
  const bounds=useMemo(()=>pallet?{size:[length,height,width] as SceneSize,origin:[0,0,0] as SceneSize}:transportSceneBounds(space!,1,mode,0),[pallet,space,length,width,height,mode]);
  const {faces,project}=useMemo(()=>projectModelPreview(parts,{...bounds,size:bounds.size.map(n=>n/zoom) as SceneSize,origin:[bounds.origin[0],bounds.origin[1]+bounds.size[1]*(1-1/zoom)/2,bounds.origin[2]]},[Math.sin(orbit.yaw)*Math.cos(orbit.pitch),Math.sin(orbit.pitch),Math.cos(orbit.yaw)*Math.cos(orbit.pitch)],viewport.width,viewport.height),[parts,bounds,orbit,zoom,viewport]);
  const corners:SceneSize[]=[[-length/2,0,-width/2],[length/2,0,-width/2],[length/2,height,-width/2],[-length/2,height,-width/2],[-length/2,0,width/2],[length/2,0,width/2],[length/2,height,width/2],[-length/2,height,width/2]];
  const occupied:LabelRect[]=[];
  const labels=([["L",length,[0,0,width/2]],["W",width,[length/2,0,0]],["H",height,[length/2,height/2,width/2]]] as [string,number,SceneSize][]).map(([axis,value,point])=>{const p=project(point),text=`${axis} ${Math.round(value)} mm`,rect=layoutSceneLabel({x:p.x-text.length*3.8,y:p.y+7,width:text.length*7.6,height:23},viewport,occupied);occupied.push(rect);return {text,rect};});
  const opacity=pallet?1:transportOpacity(transparency);
  return <div ref={host} className="model-fallback-preview">
    <svg viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="img" aria-label={tr("简化模型预览", "Simplified model preview")} tabIndex={0}
      onPointerDown={e=>{pointer.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerUp={()=>{pointer.current=null;}} onPointerCancel={()=>{pointer.current=null;}}
      onPointerMove={e=>{if(!pointer.current)return;const dx=e.clientX-pointer.current.x,dy=e.clientY-pointer.current.y;pointer.current={x:e.clientX,y:e.clientY};setOrbit(v=>({yaw:v.yaw+dx*.012,pitch:Math.max(-1.45,Math.min(1.45,v.pitch+dy*.009))}));}}
      onKeyDown={e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","-"].includes(e.key))return;e.preventDefault();if(e.key==="+"||e.key==="-")setZoom(v=>Math.max(.6,Math.min(1.5,v+(e.key==="+"?.1:-.1))));else setOrbit(v=>({yaw:v.yaw+(e.key==="ArrowLeft"?-.15:e.key==="ArrowRight"?.15:0),pitch:Math.max(-1.45,Math.min(1.45,v.pitch+(e.key==="ArrowUp"?.1:e.key==="ArrowDown"?-.1:0)))}));}}
      onWheel={e=>setZoom(v=>Math.max(.6,Math.min(1.5,v-e.deltaY*.001)))}>
      <g opacity={opacity}>{faces.map(f=><polygon key={f.id} data-part={f.name} points={f.points} fill={f.color} stroke={f.color} strokeWidth={.35}/>)}</g>
      {!pallet&&<g fill="none" stroke="#608995" strokeWidth={mode==="wireframe"?1.5:.7} opacity={mode==="wireframe"?1:.45}>{[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].map(([a,b])=>{const start=project(corners[a]),end=project(corners[b]);return <line key={`${a}-${b}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y}/>;})}</g>}
      <g className="model-fallback-labels">{labels.map(({text,rect})=><g key={text}><rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={4}/><text x={rect.x+rect.width/2} y={rect.y+16} textAnchor="middle">{text}</text></g>)}</g>
    </svg>
    <button className="model-preview-reset" type="button" aria-label={tr("重置模型视角", "Reset model view")} onClick={()=>{setOrbit({yaw:.72,pitch:.42});setZoom(1);}}><RotateCcw size={14}/></button>
    <span className="model-fallback-note">{tr("WebGL 未启用 · 简化模型预览", "WebGL unavailable · simplified model preview")}</span>
  </div>;
}
