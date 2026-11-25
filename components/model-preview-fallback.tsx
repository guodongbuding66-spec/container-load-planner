"use client";
import {deckSupportHeight} from "../lib/packing/deck-support";
import { useId, useMemo, useRef, useState } from "react";
import { useModelViewport } from "./use-model-viewport";
import { RotateCcw } from "lucide-react";
import { packagingParts, packagingHeight, packagingInterior, DEFAULT_PACKAGING } from "../lib/packing/packaging";
import { createTransportParts, transportOpacity, transportSceneBounds, type TransportDisplayMode, type TransportPart } from "../lib/packing/transport-model";
import { projectModelPreview } from "../lib/packing/model-preview";
import { projectDimensions } from "../lib/packing/scene-dimensions";
import { DimensionSvg } from "./dimension-svg";
import { useTransportAppearance } from "./transport-appearance";
import type { ContainerSpec, FloorPalletConfig } from "../lib/packing/types";
import type { PackagingMaterial } from "../lib/packing/packaging-materials";
import type { SceneSize } from "../lib/packing/camera-fit";
import { tr, useLanguage } from "./language";

const timberLines=Array.from({length:42},(_,i)=>{
  const v=(i+.2)/42;
  const wobble=(Math.sin(i*4.91)+.6)*.022;
  return `M-.02 ${v}Q.21 ${v+wobble} .51 ${v}T1.02 ${v}`;
});

function SurfacePatterns({id,material}:{id:string;material:PackagingMaterial}) {
  const wood = material==="wood"||material==="plywood";
  return <>
    <pattern id={id+"-surface"} patternUnits="userSpaceOnUse" width="1" height="1">
      {wood?timberLines.map((d,i)=><path key={d} d={d} fill="none" stroke={i%7===1?"#fff3d9":"#3e2518"} strokeWidth={i%7===1 ? .015 : .006} opacity={.13+(i%5)*.035}/>):
        Array.from({length:81},(_,i)=><circle key={i} cx={((i*49)%83+.5)/83} cy={((i*31)%83+.5)/83} r={material==="steel"?.022+(i%4)*.008:.013} fill={i%3?"#182525":"#eef8f6"} opacity={material==="steel"?.12:.2}/>)}
    </pattern>
    <pattern id={id+"-end"} patternUnits="userSpaceOnUse" width="1" height="1">
      {material==="plywood"?Array.from({length:8},(_,i)=><rect key={i} x="0" y={i/8} width="1" height={1/8} fill={i%2?"#493222":"#fff0ce"} opacity={i%2 ? .29 : .2}/>):
        Array.from({length:12},(_,i)=><ellipse key={i} cx=".16" cy=".27" rx={(i+1)*.084} ry={(i+1)*.078} fill="none" stroke="#39291e" strokeWidth={i%3?.012:.022} opacity=".26"/>)}
    </pattern>
  </>;
}

export function ModelPreviewFallback({ space, pallet, mode, transparency, showDimensions }: {space?:ContainerSpec;pallet?:FloorPalletConfig;mode:TransportDisplayMode;transparency:number;showDimensions?:boolean}) {
  useLanguage();
  const appearance=useTransportAppearance();
  const dimensionsEnabled=showDimensions??appearance.dimensions;
  const id=useId().replace(/[^a-zA-Z0-9_-]/g,"");
  const material=pallet?(pallet.packaging??DEFAULT_PACKAGING).material:undefined;
  const [orbit,setOrbit]=useState({yaw:.72,pitch:.42}),[zoom,setZoom]=useState(1);
  const {host,viewport}=useModelViewport();
  const pointer=useRef<{x:number;y:number}|null>(null);
  const length=pallet?.length??space?.length??1200,width=pallet?.width??space?.width??800,height=pallet?(packagingInterior(pallet).crate?packagingHeight(pallet):pallet.height+deckSupportHeight(pallet)):space?.height??144;
  const target=useMemo(()=>space??{id:"preview",name:"",length,width,height,doorWidth:width,doorHeight:height,maxWeight:1},[space,length,width,height]);
  const parts=useMemo<TransportPart[]>(()=>pallet?packagingParts(length,width,pallet.height,pallet.packaging,pallet.maxCargoHeight).map((p)=>({name:`pallet-${p.kind}`,color:pallet.packaging?.color??DEFAULT_PACKAGING.color,shape:"box",role:"floor",position:[p.x+p.dx/2-length/2,p.z+p.dz/2,p.y+p.dy/2-width/2],size:[p.dx,p.dz,p.dy]})):mode==="model"?createTransportParts(target,true):[],[pallet,target,length,width,mode]);
  const bounds=useMemo(()=>pallet?{size:[length,height,width] as SceneSize,origin:[0,0,0] as SceneSize}:transportSceneBounds(target,1,mode,0),[pallet,target,length,width,height,mode]);
  const {faces,project}=useMemo(()=>projectModelPreview(parts,{...bounds,size:bounds.size.map(n=>n/zoom) as SceneSize,origin:[bounds.origin[0],bounds.origin[1]+bounds.size[1]*(1-1/zoom)/2,bounds.origin[2]]},[Math.sin(orbit.yaw)*Math.cos(orbit.pitch),Math.sin(orbit.pitch),Math.cos(orbit.yaw)*Math.cos(orbit.pitch)],viewport.width,viewport.height,material,dimensionsEnabled?appearance.dimensionFontSize*2+16:0),[parts,bounds,orbit,zoom,viewport,material,dimensionsEnabled,appearance.dimensionFontSize]);
  const corners:SceneSize[]=[[-length/2,0,-width/2],[length/2,0,-width/2],[length/2,height,-width/2],[-length/2,height,-width/2],[-length/2,0,width/2],[length/2,0,width/2],[length/2,height,width/2],[-length/2,height,width/2]];
  // The note and reset button share the top strip; labels must avoid both.
  const dimensions=dimensionsEnabled?projectDimensions({min:[-length/2,0,-width/2],max:[length/2,height,width/2]},{L:length,W:width,H:height},project,viewport,{unit:appearance.dimensionUnit,fontSize:appearance.dimensionFontSize,style:appearance.dimensionStyle,bottomInset:25,occupied:[{x:0,y:0,width:viewport.width,height:40}]}):[];
  const footprint=pallet?[[-length/2,0,-width/2],[length/2,0,-width/2],[length/2,0,width/2],[-length/2,0,width/2]].map(p=>{const point=project(p as SceneSize);return `${point.x},${point.y}`;}).join(" "):"";
  const opacity=pallet?(pallet.packaging?.opacity??1):transportOpacity(transparency);
  return <div ref={host} className="model-fallback-preview">
    <svg viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="img" aria-label={tr("简化模型预览", "Simplified model preview")} tabIndex={0}
      onPointerDown={e=>{pointer.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerUp={()=>{pointer.current=null;}} onPointerCancel={()=>{pointer.current=null;}}
      onPointerMove={e=>{if(!pointer.current)return;const dx=e.clientX-pointer.current.x,dy=e.clientY-pointer.current.y;pointer.current={x:e.clientX,y:e.clientY};setOrbit(v=>({yaw:v.yaw+dx*.012,pitch:Math.max(-1.45,Math.min(1.45,v.pitch+dy*.009))}));}}
      onKeyDown={e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","-"].includes(e.key))return;e.preventDefault();if(e.key==="+"||e.key==="-")setZoom(v=>Math.max(.6,Math.min(1.5,v+(e.key==="+"?.1:-.1))));else setOrbit(v=>({yaw:v.yaw+(e.key==="ArrowLeft"?-.15:e.key==="ArrowRight"?.15:0),pitch:Math.max(-1.45,Math.min(1.45,v.pitch+(e.key==="ArrowUp"?.1:e.key==="ArrowDown"?-.1:0)))}));}}
      onWheel={e=>setZoom(v=>Math.max(.6,Math.min(1.5,v-e.deltaY*.001)))}>
      {material&&<defs>
        <filter id={id+"-contact"} x="-.35" y="-.65" width="1.7" height="2.3"><feGaussianBlur stdDeviation="4"/></filter>
        <SurfacePatterns id={id} material={material}/>
        {faces.map(f=>f.texture&&<pattern key={f.id} id={id+f.id} href={"#"+id+(f.texture.end?"-end":"-surface")} patternTransform={f.texture.transform}/>)}
      </defs>}
      {material&&<polygon points={footprint} fill="#554938" opacity=".17" filter={`url(#${id}-contact)`}/>}
      <g opacity={opacity}>{faces.map(f=><g key={f.id}>
        <polygon data-part={f.name} points={f.points} fill={mode==="wireframe"?"none":f.color} stroke={material?"#3b3024":f.color} strokeOpacity={material ? .20 : 1} strokeWidth={material ? .62 : .35}/>
        {mode!=="wireframe"&&f.texture&&<polygon points={f.points} fill={`url(#${id}${f.id})`}/>}
      </g>)}</g>
      {!pallet&&<g fill="none" stroke="#608995" strokeWidth={mode==="wireframe"?1.5:.7} opacity={mode==="wireframe"?1:.45}>{[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].map(([a,b])=>{const start=project(corners[a]),end=project(corners[b]);return <line key={`${a}-${b}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y}/>;})}</g>}
      {dimensionsEnabled&&<DimensionSvg dimensions={dimensions} fontSize={appearance.dimensionFontSize} lineColor={appearance.dimensionLineColor} textColor={appearance.dimensionTextColor}/>}
    </svg>
    <button className="model-preview-reset" type="button" aria-label={tr("重置模型视角", "Reset model view")} onClick={()=>{setOrbit({yaw:.72,pitch:.42});setZoom(1);}}><RotateCcw size={14}/></button>
    <span className="model-fallback-note">{tr("WebGL 未启用 · 简化模型预览", "WebGL unavailable · simplified model preview")}</span>
  </div>;
}
