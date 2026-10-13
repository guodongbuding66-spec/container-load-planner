"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, Ruler } from "lucide-react";
import { cargoShapeOf, type ShapeFields } from "../lib/packing/cargo-shape";
import { DEFAULT_PREVIEW_CAMERA, fitPreviewCamera, orbitPreview, previewAnnotationLayout, previewDimensions, previewMesh, previewProjection, zoomPreview } from "../lib/packing/shape-preview";
import type { ShapeSizeOptions, SizeKey } from "../lib/packing/shape-dimensions";
import type { OrientationCode } from "../lib/packing/types";
import { fromMillimeters, type LengthUnit } from "../lib/packing/units";
import { tr, useLanguage } from "./language";

export function CargoModelPreview({fields,dimensions,orientation,options,unit,active,onOrientationChange}:{fields:ShapeFields;dimensions:number[];orientation:OrientationCode;options:ShapeSizeOptions;unit:LengthUnit;active?:SizeKey;onOrientationChange:(code:OrientationCode)=>void}) {
  useLanguage();
  const [rulers,setRulers]=useState(true);
  const host=useRef<SVGSVGElement>(null),drag=useRef<{id:number;x:number;y:number}|null>(null);
  const {cargoType,cargoShape,shapeAxis,shapeTopRatio,shapeWallRatio,shapeWallHeightRatio,shapeStepLengthRatio,shapeStepHeightRatio}=fields;
  const [l,w,h]=dimensions;
  const modelFields={cargoType,cargoShape,shapeAxis,shapeTopRatio,shapeWallRatio,shapeWallHeightRatio,shapeStepLengthRatio,shapeStepHeightRatio};
  const mesh=useMemo(()=>previewMesh({cargoType,cargoShape,shapeAxis,shapeTopRatio,shapeWallRatio,shapeWallHeightRatio,shapeStepLengthRatio,shapeStepHeightRatio},[l,w,h],orientation),[cargoType,cargoShape,shapeAxis,shapeTopRatio,shapeWallRatio,shapeWallHeightRatio,shapeStepLengthRatio,shapeStepHeightRatio,l,w,h,orientation]);
  const [camera,setCamera]=useState(()=>fitPreviewCamera(mesh,DEFAULT_PREVIEW_CAMERA));
  const projected=useMemo(()=>previewProjection(mesh,camera),[mesh,camera]);
  const annotations=previewDimensions(modelFields,[l,w,h],options,orientation,mesh);
  const labels=previewAnnotationLayout(annotations,projected.project);
  const fmt=(n:number)=>Number(fromMillimeters(n,unit).toPrecision(6)).toLocaleString(undefined,{maximumFractionDigits:5});
  useEffect(()=>{const svg=host.current;if(!svg)return;const wheel=(e:WheelEvent)=>{e.preventDefault();setCamera(c=>zoomPreview(c,Math.exp(-e.deltaY*.0015)));};svg.addEventListener("wheel",wheel,{passive:false});return()=>svg.removeEventListener("wheel",wheel);},[]);
  const preset=(yaw:number,pitch:number)=>setCamera(fitPreviewCamera(mesh,{yaw,pitch,zoom:1}));
  const reset=()=>setCamera(fitPreviewCamera(mesh,DEFAULT_PREVIEW_CAMERA));
  const cameraPresets:Array<[string,string,number,number]>=[["等轴","Isometric",Math.PI/4,.42],["正视","Front",0,0],["侧视","Side",Math.PI/2,0],["俯视","Top",0,Math.PI/2]];
  const axes=[{label:orientation[0],end:[.3,0,0] as [number,number,number],color:"#b45049"},{label:orientation[2],end:[0,.3,0] as [number,number,number],color:"#456fa7"},{label:orientation[1],end:[0,0,.3] as [number,number,number],color:"#33836c"}];
  return <div className="cargo-model-preview">
    <div className="cargo-preview-toolbar" aria-label={tr("预览相机","Preview camera")}>{cameraPresets.map(([zh,en,yaw,pitch])=><button type="button" key={en} onClick={()=>preset(yaw,pitch)}>{tr(zh,en)}</button>)}<button type="button" aria-label={tr("适配预览","Fit preview")} onClick={reset}><RotateCcw size={14}/></button><button type="button" aria-label={tr("放大预览","Zoom in preview")} onClick={()=>setCamera(c=>zoomPreview(c,1.25))}><Plus size={14}/></button><button type="button" aria-label={tr("缩小预览","Zoom out preview")} onClick={()=>setCamera(c=>zoomPreview(c,.8))}><Minus size={14}/></button><button type="button" aria-pressed={rulers} aria-label={tr("预览尺寸标注","Preview dimensions")} onClick={()=>setRulers(v=>!v)}><Ruler size={14}/></button></div>
    <svg ref={host} viewBox="0 0 360 240" role="img" tabIndex={0} aria-label={tr("可旋转三维货物预览：拖动旋转，滚轮缩放；方向键旋转，Home 适配。","Interactive 3D cargo preview: drag to orbit, scroll to zoom; arrow keys orbit, Home fits.")} className="cargo-model-surface" data-preview-shape={cargoShapeOf(fields)} data-camera-yaw={camera.yaw.toFixed(4)} data-camera-pitch={camera.pitch.toFixed(4)} data-camera-zoom={camera.zoom.toFixed(4)}
      onPointerDown={e=>{if(e.button!==0)return;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{const previous=drag.current;if(!previous||previous.id!==e.pointerId)return;setCamera(c=>orbitPreview(c,e.clientX-previous.x,e.clientY-previous.y));drag.current={id:e.pointerId,x:e.clientX,y:e.clientY};}}
      onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onPointerCancel={()=>drag.current=null} onLostPointerCapture={()=>drag.current=null} onDoubleClick={reset}
      onKeyDown={e=>{const movement:Record<string,[number,number]>={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]};if(movement[e.key]){e.preventDefault();setCamera(c=>orbitPreview(c,...movement[e.key]));}else if(e.key==="Home"){e.preventDefault();reset();}else if(e.key==="+"||e.key==="="||e.key==="-"){e.preventDefault();setCamera(c=>zoomPreview(c,e.key==="-"?.8:1.25));}}}>
      <ellipse cx="180" cy="214" rx="84" ry="6" fill="#78949b" opacity=".08"/>
      <g className="cargo-preview-faces">{projected.faces.map((f,i)=><polygon key={i} points={f.points} fill={cargoShape==="irregular"?"none":f.color} stroke={cargoShape==="irregular"?"#338391":f.color} strokeWidth=".4" strokeDasharray={cargoShape==="irregular"?"4 3":undefined}/>)}</g>
      {rulers&&<g className="cargo-preview-dimensions" pointerEvents="none">{labels.map(a=>{const {start,end,label,mid}=a,selected=active===a.key;return <g key={a.key} data-dimension-key={a.key} className={selected?"selected":""}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y}/><line className="cargo-dimension-leader" x1={mid.x} y1={mid.y} x2={label.x} y2={label.y}/><circle cx={start.x} cy={start.y} r="2"/><circle cx={end.x} cy={end.y} r="2"/><rect x={label.x-15} y={label.y-9} width="30" height="18" rx="4"/><text x={label.x} y={label.y+3} textAnchor="middle">{a.code}</text></g>;})}</g>}
      <g className="cargo-preview-axes" transform="translate(322 210)" pointerEvents="none">{axes.map(a=>{const p=projected.project(a.end),origin=projected.project([0,0,0]),x=(p.x-origin.x)/camera.zoom*.5,y=(p.y-origin.y)/camera.zoom*.5;return <g key={a.label}><line x1="0" y1="0" x2={x} y2={y} stroke={a.color}/><text x={x} y={y-3} fill={a.color} textAnchor="middle">{a.label}</text></g>;})}</g>
    </svg>
    <div className="cargo-preview-legend">{annotations.map(a=><span key={a.key} className={active===a.key?"selected":""}><b>{a.code}</b> {fmt(a.value)} {unit}</span>)}</div>
    <div className="cargo-preview-orientation"><label>{tr("摆放预览","Placement preview")}<select aria-label={tr("外形预览朝向","Shape preview orientation")} value={orientation} onChange={e=>onOrientationChange(e.target.value as OrientationCode)}>{["LWH","LHW","WLH","WHL","HLW","HWL"].map(code=><option key={code} value={code}>{code} · {code[2]} ↑</option>)}</select></label><small>{tr("拖动旋转 · 滚轮缩放","Drag to orbit · Scroll to zoom")}</small></div>
    <small className="cargo-preview-hint">{tr("转动相机只改变观察视角；允许装载方向在下方选择。","Orbit changes your viewing angle. Choose allowed loading orientations below.")}</small>
  </div>;
}
