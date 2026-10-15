"use client";
import { packagingHeight, packagingInterior } from "../lib/packing/packaging";
import { tr, tt, useLanguage } from "./language";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type { ContainerSpec, FloorPalletConfig, PlacedPallet } from "../lib/packing/types";
import type { CameraView, SceneSize } from "../lib/packing/camera-fit";
import { transportSceneBounds } from "../lib/packing/transport-model";
import { supportsWebGL } from "../lib/packing/webgl-support";
import { SceneCameraController } from "../lib/packing/scene-camera";
import { PalletStructures } from "./scene-details";
import { SceneDimensions } from "./scene-dimensions";
import { DimensionControls } from "./dimension-controls";
import type { DimensionBounds } from "../lib/packing/scene-dimensions";
import { SceneErrorBoundary } from "./scene-error-boundary";
import { SceneCameraRig } from "./scene-camera-rig";
import { TransportModel } from "./transport-model";
import { TransportModelControls, useTransportAppearance } from "./transport-appearance";
import { ModelPreviewFallback } from "./model-preview-fallback";

const subscribe = () => () => {};
export function SpaceModelPreview({ pallet, space }: { pallet?: FloorPalletConfig; space?: ContainerSpec }) {
  useLanguage();
  const appearance = useTransportAppearance();
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [view, setView] = useState<CameraView>("perspective");
  const controller = useMemo(() => new SceneCameraController(), []);
  const length=pallet?.length??space?.length??1200,width=pallet?.width??space?.width??800,height=pallet?(packagingInterior(pallet).crate?packagingHeight(pallet):pallet.height):space?.height??144;
  const scale=3/Math.max(length,width,height),offset=useMemo(()=>new THREE.Vector3(-length*scale/2,0,-width*scale/2),[length,width,scale]);
  const base=useMemo<PlacedPallet[]>(()=>[{id:"preview",presetId:pallet?.presetId??"preview",name:pallet?.name??"",x:0,y:0,z:0,dx:length,dy:width,dz:pallet?.height??height,packaging:pallet?.packaging,enclosureHeight:pallet&&packagingInterior(pallet).crate?height:undefined,weight:pallet?.weight??0,maxLoad:pallet?.maxLoad??0,orientation:"LWH"}],[pallet,length,width,height]);
  const dimensionBounds=useMemo<DimensionBounds>(()=>({min:[-length*scale/2,0,-width*scale/2],max:[length*scale/2,height*scale,width*scale/2]}),[length,width,height,scale]);
  const containerSize=useMemo<SceneSize>(()=>[length*scale,height*scale,width*scale],[length,height,width,scale]);
  const sceneBounds=useMemo(()=>space?transportSceneBounds(space,scale,appearance.mode,0):undefined,[space,scale,appearance.mode]);
  if (![length,width,height].every(v=>Number.isFinite(v)&&v>0)) return <div className="space-model-preview model-invalid"><p>{tr("填写有效的长、宽、高后显示尺寸模型。")}</p></div>;
  return <section className="space-model-section" aria-label={tt`${pallet ? tr("托盘") : tr("装载空间")}三维模型，${length} × ${width} × ${height} mm`}>
    {!pallet&&<TransportModelControls/>}
    <DimensionControls/>
    <div className="space-model-preview">
      {!ready?<div className="model-invalid">{tr("正在检测三维图形能力…")}</div>:!supportsWebGL()?<ModelPreviewFallback space={space} pallet={pallet} mode={appearance.mode} transparency={appearance.transparency}/>:<SceneErrorBoundary resetKey={`${length}-${width}-${height}`}>
        <Canvas dpr={[1,1.5]} gl={{antialias:true}}>
          <color attach="background" args={["#f3f7f7"]}/><ambientLight intensity={1.5}/><directionalLight position={[2,5,4]} intensity={2}/>
          {pallet?<PalletStructures pallets={base} scale={scale} offset={offset}/>:space&&<TransportModel space={space} scale={scale} mode={appearance.mode} transparency={appearance.transparency}/>}
          {appearance.dimensions&&<SceneDimensions bounds={dimensionBounds} values={{L:length,W:width,H:height}} unit={appearance.dimensionUnit} fontSize={appearance.dimensionFontSize} style={appearance.dimensionStyle} lineColor={appearance.dimensionLineColor} textColor={appearance.dimensionTextColor}/>}
          <SceneCameraRig controller={controller} containerSize={containerSize} sceneBounds={sceneBounds} view={view} projection="perspective" onInteraction={()=>setView("free")} enablePan={false}/>
        </Canvas>
      </SceneErrorBoundary>}
      <span className="model-preview-hint">{tr("拖动旋转 · 滚轮缩放")}</span>
    </div>
    {!pallet&&<p className="model-reference-note">{tr("通用外形示意；尺寸标注为可用装载空间。", "Generic exterior; dimensions show usable cargo space.")}</p>}
  </section>;
}
