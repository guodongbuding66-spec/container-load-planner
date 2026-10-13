import { useMemo } from "react";
import { cargoShapeGeometry } from "../lib/packing/cargo-shape-geometry";
import type { ShapeFields } from "../lib/packing/cargo-shape";
import type { CargoShape, OrientationCode } from "../lib/packing/types";

/** The workbench mesh projected to SVG; preview works without WebGL. */
export function CargoShapePreview({shape,fields={},dimensions=[1,1,1],orientation="LWH"}:{shape:CargoShape;fields?:ShapeFields;dimensions?:number[];orientation?:OrientationCode}) {
  const [l,w,h]=dimensions;
  const {cargoType,shapeAxis,shapeTopRatio,shapeWallRatio,shapeWallHeightRatio,shapeStepLengthRatio,shapeStepHeightRatio}=fields;
  const faces=useMemo(()=>{
    const geometry=cargoShapeGeometry({cargoType,cargoShape:shape,shapeAxis,shapeTopRatio,shapeWallRatio,shapeWallHeightRatio,shapeStepLengthRatio,shapeStepHeightRatio},orientation,true),positions=geometry.getAttribute("position"),normals=geometry.getAttribute("normal"),index=geometry.getIndex();
    const original:{[key:string]:number}={L:l,W:w,H:h};
    const scale=[original[orientation[0]],original[orientation[2]],original[orientation[1]]].map(v=>Number.isFinite(v)&&v>0?v:1);
    const maxScale=Math.max(...scale);scale.forEach((v,i)=>scale[i]=v/maxScale);
    const count=index?.count??positions.count,triangles=[];
    for(let i=0;i<count;i+=3){
      const vertices=[0,1,2].map(j=>index?index.getX(i+j):i+j),n=vertices[0];
      if(normals.getX(n)+normals.getY(n)+normals.getZ(n)<=0)continue;
      const points=vertices.map(v=>{const x=positions.getX(v)*scale[0],y=positions.getY(v)*scale[1],z=positions.getZ(v)*scale[2];return {x:.86*(x-z),y:-y+.28*(x+z),depth:x+y+z};});
      triangles.push({points,depth:points.reduce((s,p)=>s+p.depth,0)/3,color:normals.getY(n)>.5?"#b7dce1":normals.getX(n)>.5?"#338391":"#78b7c0"});
    }
    geometry.dispose();
    const all=triangles.flatMap(t=>t.points),minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y)),s=Math.min(74/(maxX-minX||1),48/(maxY-minY||1));
    return triangles.sort((a,b)=>a.depth-b.depth).map(t=>({...t,points:t.points.map(p=>`${(42+(p.x-(minX+maxX)/2)*s).toFixed(3)},${(29+(p.y-(minY+maxY)/2)*s).toFixed(3)}`).join(" ")}));
  },[shape,cargoType,shapeAxis,shapeTopRatio,shapeWallRatio,shapeWallHeightRatio,shapeStepLengthRatio,shapeStepHeightRatio,orientation,l,w,h]);
  return <svg viewBox="0 0 84 58" aria-hidden="true" className="cargo-shape-preview" data-preview-shape={shape}>
    {faces.map((f,i)=><polygon key={i} points={f.points} fill={shape==="irregular"?"none":f.color} stroke={shape==="irregular"?"#338391":f.color} strokeWidth=".3" strokeDasharray={shape==="irregular"?"3 2":undefined}/>)}
  </svg>;
}
