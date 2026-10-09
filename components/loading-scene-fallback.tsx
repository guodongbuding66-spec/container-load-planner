"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { cameraDimensionProjector, projectDimensions, sceneMeasurement } from "../lib/packing/scene-dimensions";
import { calculateCameraViewFit } from "../lib/packing/camera-fit";
import { layoutSceneLabel, type LabelRect } from "../lib/packing/scene-labels";
import type { PackingResult, PlacedBox } from "../lib/packing/types";
import { DimensionSvg } from "./dimension-svg";
import { useModelViewport } from "./use-model-viewport";
import { useTransportAppearance } from "./transport-appearance";
import { tr, useLanguage } from "./language";

/** All visible footprints are retained; exact stacked duplicates collapse to their top box. */
export function topViewFootprints(placements:PlacedBox[],visibleProducts:Set<string>,visibleCount:number) {
  const map=new Map<string,PlacedBox>();
  for(const b of placements.slice(0,visibleCount))if(visibleProducts.has(b.productId)){
    const key=[b.x,b.y,b.dx,b.dy].join(":"),previous=map.get(key);
    if(!previous||b.z+b.dz>=previous.z+previous.dz)map.set(key,b);
  }
  return [...map.values()].sort((a,b)=>a.z+a.dz-b.z-b.dz);
}
export function LoadingSceneFallback({result,visibleProducts,visibleCount,selected,onSelect}:{result:PackingResult;visibleProducts:Set<string>;visibleCount:number;selected:PlacedBox|null;onSelect:(box:PlacedBox)=>void}) {
  useLanguage();
  const appearance=useTransportAppearance(),{host,viewport}=useModelViewport({width:720,height:340});
  const space=result.container,base=space.baseHeight??0,scale=5.6/Math.max(space.length-result.clearance*2,space.width-result.clearance*2,space.height-result.clearance+base);
  const {project,corners}=useMemo(()=>{
    const bounds=sceneMeasurement(space,result.clearance).bounds,size=[space.length*scale,space.height*scale,space.width*scale] as [number,number,number];
    const fit=calculateCameraViewFit(size,viewport,"top"),camera=new THREE.OrthographicCamera(-fit.orthographicHalfWidth,fit.orthographicHalfWidth,fit.orthographicHalfHeight,-fit.orthographicHalfHeight,fit.near,fit.far);
    camera.position.fromArray(fit.position).add(new THREE.Vector3(0,base*scale,0));camera.up.fromArray(fit.up);camera.lookAt(new THREE.Vector3(...fit.target).add(new THREE.Vector3(0,base*scale,0)));camera.updateProjectionMatrix();
    const project=cameraDimensionProjector(camera,viewport),corners=[project(bounds.min),project(bounds.max)];return {project,corners};
  },[space,result.clearance,scale,base,viewport]);
  const footprints=useMemo(()=>topViewFootprints(result.placements,visibleProducts,visibleCount),[result.placements,visibleProducts,visibleCount]);
  const offset=[-(space.length-result.clearance*2)*scale/2,base*scale,-(space.width-result.clearance*2)*scale/2];
  const rectFor=(b:{x:number;y:number;z:number;dx:number;dy:number;dz:number})=>{
    const a=project([b.x*scale+offset[0],b.z*scale+offset[1],b.y*scale+offset[2]]),c=project([(b.x+b.dx)*scale+offset[0],(b.z+b.dz)*scale+offset[1],(b.y+b.dy)*scale+offset[2]]);
    return {x:Math.min(a.x,c.x),y:Math.min(a.y,c.y),width:Math.abs(c.x-a.x),height:Math.abs(c.y-a.y)};
  };
  const measurement=sceneMeasurement(space,result.clearance,selected??undefined),dimensions=appearance.dimensions?projectDimensions(measurement.bounds,measurement.values,project,viewport,{unit:appearance.dimensionUnit,fontSize:appearance.dimensionFontSize,bottomInset:12}):[];
  const occupied:LabelRect[]=dimensions.map(d=>d.label),seen=new Set<string>();
  const labels=appearance.labels?footprints.filter(b=>{if(seen.has(b.productId))return false;seen.add(b.productId);return true;}).map(b=>{const r=rectFor(b),label=layoutSceneLabel({x:r.x+r.width/2-b.sku.length*3.5,y:r.y+r.height/2-9,width:b.sku.length*7+12,height:20},viewport,occupied);occupied.push(label);return {id:b.productId,sku:b.sku,label};}):[];
  return <div className="scene-fallback"><div ref={host} className="fallback-model-stage"><svg viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="img" aria-label={tr("真实坐标俯视图", "Actual-coordinate top view")}>
    <rect x={Math.min(corners[0].x,corners[1].x)} y={Math.min(corners[0].y,corners[1].y)} width={Math.abs(corners[1].x-corners[0].x)} height={Math.abs(corners[1].y-corners[0].y)} fill="none" stroke="#70939d" strokeWidth={2}/>
    {(result.pallets??[]).map(p=><rect key={p.id} {...rectFor(p)} fill="#dbc099" stroke="#b39670" strokeWidth={1} role="button" tabIndex={0} aria-label={`${tr("托盘", "Pallet")} ${p.id}`} onClick={()=>onSelect({...p,productId:p.id,sku:p.name,color:"#d4af7b",layer:0,orientation:"LWH",supportOnly:true})} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelect({...p,productId:p.id,sku:p.name,color:"#d4af7b",layer:0,orientation:"LWH",supportOnly:true});}}}/>)}
    {footprints.map(b=><rect key={b.id} {...rectFor(b)} fill={b.color} stroke={selected?.id===b.id?"#da8c2e":"#ffffffaa"} strokeWidth={selected?.id===b.id?2:1} role="button" tabIndex={0} aria-label={`${b.sku} ${b.id}`} onClick={()=>onSelect(b)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelect(b);}}}/>)}
    <g className="fallback-sku-labels" pointerEvents="none">{labels.map(({id,sku,label})=><g key={id}><rect {...label} rx={3} fill="#f7fbfbef"/><text x={label.x+label.width/2} y={label.y+14} textAnchor="middle" fill="#376272" fontSize={13} fontFamily="Arial, sans-serif">{sku}</text></g>)}</g>
    {appearance.dimensions&&<DimensionSvg dimensions={dimensions} fontSize={appearance.dimensionFontSize}/>}
  </svg></div><strong>{tr("当前浏览器未启用 WebGL")}</strong><span>{tr("已切换为真实坐标俯视图；装柜计算、校验与导出不受影响。")}</span></div>;
}
