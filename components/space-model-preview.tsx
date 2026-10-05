"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ContainerSpec, FloorPalletConfig, PlacedPallet } from "../lib/packing/types";
import { PalletStructures, SelectedBoxDimensions } from "./scene-details";
import { SceneErrorBoundary } from "./scene-error-boundary";

/** The preview and final plan share the same pallet geometry and physical dimensions. */
export function SpaceModelPreview({ pallet, space }: { pallet?: FloorPalletConfig; space?: ContainerSpec }) {
  const length=pallet?.length??space?.length??1200, width=pallet?.width??space?.width??800, height=pallet?.height??space?.height??144;
  const scale=3/Math.max(length,width,height), offset=useMemo(()=>new THREE.Vector3(-length*scale/2,0,-width*scale/2),[length,width,scale]);
  const base=useMemo<PlacedPallet[]>(()=>[{id:"preview",presetId:pallet?.presetId??"preview",name:pallet?.name??"",x:0,y:0,z:0,dx:length,dy:width,dz:height,weight:pallet?.weight??0,maxLoad:pallet?.maxLoad??0,orientation:"LWH"}],[pallet,length,width,height]);
  const dims=useMemo(()=>({x:0,y:0,z:0,dx:length,dy:width,dz:height,sku:""}),[length,width,height]);
  if (![length,width,height].every(v=>Number.isFinite(v)&&v>0)) return <div className="space-model-preview model-invalid"><p>填写有效的长、宽、高后显示尺寸模型。</p></div>;
  return <div className="space-model-preview" role="img" aria-label={`${pallet ? "托盘" : "装载空间"}三维模型，${length} × ${width} × ${height} mm`}>
    <SceneErrorBoundary resetKey={`${length}-${width}-${height}`}><Canvas camera={{position:[3.6,2.8,3.8],fov:38,near:.01,far:100}} dpr={[1,1.5]} gl={{antialias:true}}>
      <color attach="background" args={["#f3f7f7"]}/><ambientLight intensity={1.5}/><directionalLight position={[2,5,4]} intensity={2}/>
      {pallet ? <PalletStructures pallets={base} scale={scale} offset={offset}/> : <group>
        <mesh position={[0,height*scale/2,0]}><boxGeometry args={[length*scale,height*scale,width*scale]}/><meshStandardMaterial color="#78a5ad" transparent opacity={.09} depthWrite={false}/><Edges color="#799ca8"/></mesh>
        <mesh position={[0,-.012,0]}><boxGeometry args={[length*scale,.024,width*scale]}/><meshStandardMaterial color="#c8d8d9"/></mesh>
        <mesh position={[-length*scale/2,height*scale/2,0]}><boxGeometry args={[.012,height*scale,width*scale]}/><meshStandardMaterial color="#a9c3c8" transparent opacity={.45}/></mesh>
      </group>}
      <SelectedBoxDimensions box={dims} scale={scale} offset={offset}/>
      <OrbitControls makeDefault target={[0,height*scale/2,0]} enablePan={false} minDistance={3} maxDistance={10} minPolarAngle={.15} maxPolarAngle={Math.PI*.8}/>
    </Canvas></SceneErrorBoundary>
    <span className="model-preview-hint">拖动旋转 · 滚轮缩放</span>
  </div>;
}
