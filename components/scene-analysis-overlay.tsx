"use client";
import { MetricLabel } from "./scene-details";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import type { BoundsBox } from "../lib/packing/inspection";
export type AnalysisRegion=BoundsBox&{id:string;color:string};
export function SceneAnalysisOverlay({regions,scale,offset}:{regions:AnalysisRegion[];scale:number;offset:THREE.Vector3}){
  return <group name="scene-analysis-overlay">{regions.filter(b=>b.id.startsWith("gap-")).map(b=><MetricLabel key={`label-${b.id}`} text={`${b.dx.toFixed(1)} × ${b.dy.toFixed(1)} × ${b.dz.toFixed(1)} mm`} size={.12} position={[(b.x+b.dx/2)*scale+offset.x,(b.z+b.dz)*scale+offset.y+.1,(b.y+b.dy/2)*scale+offset.z]}/>)}{regions.map(b=><mesh key={b.id} position={[(b.x+b.dx/2)*scale+offset.x,(b.z+b.dz/2)*scale+offset.y,(b.y+b.dy/2)*scale+offset.z]} renderOrder={800} raycast={()=>{}}><boxGeometry args={[b.dx*scale,b.dz*scale,b.dy*scale]}/><meshBasicMaterial color={b.color} transparent opacity={.18} depthWrite={false} depthTest={false}/><Edges color={b.color} renderOrder={801}><lineBasicMaterial color={b.color} depthTest={false} transparent opacity={.8}/></Edges></mesh>)}</group>;
}
