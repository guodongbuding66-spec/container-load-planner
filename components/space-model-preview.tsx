"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Environment, Lightformer } from "@react-three/drei";
import { Layers3, PackageOpen, Box } from "lucide-react";
import { deckSupportHeight, completePackagingTare } from "../lib/packing/deck-support";
import { packagingHeight, packagingInterior } from "../lib/packing/packaging";
import { tr, tt, useLanguage } from "./language";
import type { ContainerSpec, FloorPalletConfig, PlacedPallet } from "../lib/packing/types";
import type { CameraView, SceneSize } from "../lib/packing/camera-fit";
import { transportSceneBounds } from "../lib/packing/transport-model";
import { supportsWebGL } from "../lib/packing/webgl-support";
import { detectRuntimePolicy } from "../lib/packing/runtime-policy";
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

function PackagingLighting({ reflective, reduced }: { reflective: boolean; reduced: boolean }) {
  return <>
    {reflective&&!reduced&&<Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={2} color="#ecf4ff" position={[2,3,1]} rotation={[Math.PI/2,0,.5]} scale={[6,2,1]}/>
      <Lightformer form="rect" intensity={1.2} color="#fff3dc" position={[0,2,-3]} scale={[7,3,1]}/>
      <Lightformer form="rect" intensity={.9} color="#cbdce9" position={[-3,0,1]} rotation={[0,Math.PI/2,0]} scale={[6,2,1]}/>
    </Environment>}
    <hemisphereLight color="#f7fbff" groundColor="#bdb4a4" intensity={1.45}/>
    <directionalLight position={[3,5,4]} color="#fff4e3" intensity={2.6} castShadow={!reduced} shadow-mapSize={1024}
      shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-3}
      shadow-normalBias={.004} shadow-bias={-.0002}/>
    <directionalLight position={[-3,2,-2]} color="#d9e9ff" intensity={.85}/>
    {!reduced&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,-.003,0]} receiveShadow>
      <planeGeometry args={[30,30]}/><shadowMaterial transparent opacity={.22}/>
    </mesh>}
  </>;
}

const subscribe = () => () => {};
export function SpaceModelPreview({ pallet, space, appearanceOnly = false, compactDimensions = false }: { pallet?: FloorPalletConfig; space?: ContainerSpec; appearanceOnly?: boolean; compactDimensions?: boolean }) {
  useLanguage();
  const appearance = useTransportAppearance();
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const reduced = ready && detectRuntimePolicy().reducedRendering;
  const [view, setView] = useState<CameraView>("perspective");
  const [inspection, setInspection] = useState<"model"|"base"|"interior">("model");
  const [touchActive, setTouchActive] = useState(false);
  const controller = useMemo(() => new SceneCameraController(), []);
  const crate = !!pallet && packagingInterior(pallet).crate;
  const isBase = crate && inspection === "base";
  const isInside = crate && inspection === "interior" && pallet?.packaging?.lid === true;
  const model = useMemo(() => {
    if (!pallet?.packaging || !crate) return pallet;
    if (isBase) return {...pallet, packaging:{...pallet.packaging,enclosure:"none" as const,lid:false,deckSupports:undefined}};
    if (isInside) return {...pallet, packaging:{...pallet.packaging,lid:false}};
    return pallet;
  }, [pallet, crate, isBase, isInside]);
  const length=model?.length??space?.length??1200,width=model?.width??space?.width??800,height=model?(packagingInterior(model).crate?packagingHeight(model):model.height+deckSupportHeight(model)):space?.height??144;
  const scale=3/Math.max(length,width,height),offset=useMemo(()=>new THREE.Vector3(-length*scale/2,0,-width*scale/2),[length,width,scale]);
  const base=useMemo<PlacedPallet[]>(()=>[{id:"preview",presetId:model?.presetId??"preview",name:model?.name??"",x:0,y:0,z:0,dx:length,dy:width,dz:model?.height??height,packaging:model?.packaging,enclosureHeight:model&&packagingInterior(model).crate?height:undefined,weight:model?completePackagingTare(model):0,maxLoad:model?.maxLoad??0,orientation:"LWH"}],[model,length,width,height]);
  const dimensionBounds=useMemo<DimensionBounds>(()=>({min:[-length*scale/2,0,-width*scale/2],max:[length*scale/2,height*scale,width*scale/2]}),[length,width,height,scale]);
  const containerSize=useMemo<SceneSize>(()=>[length*scale,height*scale,width*scale],[length,height,width,scale]);
  const sceneBounds=useMemo(()=>space?transportSceneBounds(space,scale,appearance.mode,0):undefined,[space,scale,appearance.mode]);
  const showDimensions = appearance.dimensions && !appearanceOnly;
  if (![length,width,height].every(v=>Number.isFinite(v)&&v>0)) return <div className="space-model-preview model-invalid"><p>{tr("填写有效的长、宽、高后显示尺寸模型。")}</p></div>;
  const fallback = <ModelPreviewFallback space={space} pallet={model} mode={appearance.mode} transparency={appearance.transparency} showDimensions={showDimensions}/>;
  return <section className="space-model-section" aria-label={tt`${model ? tr("托盘") : tr("装载空间")}三维模型，${length} × ${width} × ${height} mm`}>
    {!model&&<TransportModelControls showDimensions={compactDimensions}/>}
    {(crate||!appearanceOnly&&!compactDimensions)&&<div className="model-preview-controls">
      {crate&&<div className="model-inspection" role="group" aria-label={tr("查看包装部位","Inspect packaging")}>
        <button type="button" className="button small" aria-pressed={!isBase&&!isInside} onClick={()=>setInspection("model")}><Box size={14}/>{tr("外观","Exterior")}</button>
        {pallet.packaging?.lid&&<button type="button" className="button small" aria-pressed={isInside} onClick={()=>setInspection("interior")}><PackageOpen size={14}/>{tr("开盖","Lid off")}</button>}
        <button type="button" className="button small" aria-pressed={isBase} onClick={()=>setInspection("base")}><Layers3 size={14}/>{tr("底座","Base")}</button>
      </div>}
      {!appearanceOnly&&!compactDimensions&&<DimensionControls/>}
    </div>}
    <div className={`space-model-preview${touchActive?" touch-active":""}`}>
      {!ready?<div className="model-invalid">{tr("正在检测三维图形能力…")}</div>:!supportsWebGL()?fallback:<SceneErrorBoundary resetKey={`${length}-${width}-${height}`} fallback={fallback}>
        <Canvas dpr={reduced?1:[1,1.5]} gl={{antialias:!reduced,powerPreference:reduced?"low-power":"high-performance"}} shadows={!!model&&!reduced}>
          <color attach="background" args={["#f2f5f6"]}/>
          {model?<><PackagingLighting reduced={reduced} reflective={model.packaging?.material==="steel"}/><PalletStructures pallets={base} scale={scale} offset={offset} reduced={reduced}/></>:
            space&&<><hemisphereLight color="#edf5fa" groundColor="#8e8272" intensity={1.6}/><directionalLight position={[2,5,4]} intensity={2}/><TransportModel space={space} scale={scale} mode={appearance.mode} transparency={appearance.transparency} reduced={reduced}/></>}
          {showDimensions&&<SceneDimensions bounds={dimensionBounds} values={{L:length,W:width,H:height}} unit={appearance.dimensionUnit} fontSize={appearance.dimensionFontSize} style={appearance.dimensionStyle} lineColor={appearance.dimensionLineColor} textColor={appearance.dimensionTextColor}/>}
          <SceneCameraRig controller={controller} containerSize={containerSize} sceneBounds={sceneBounds} view={view} projection={space?"orthographic":"perspective"} onInteraction={()=>setView("free")} enablePan={false}/>
        </Canvas>
      </SceneErrorBoundary>}
    </div>
    <div className="model-preview-guide">
      <span>{tr("拖动旋转 · 滚轮缩放","Drag to rotate · scroll to zoom")}</span>
      <button type="button" className="button small model-touch-toggle" aria-pressed={touchActive} onClick={()=>setTouchActive(active=>!active)}>{touchActive?tr("完成旋转，继续滚动","Done rotating"):tr("触控旋转模型","Rotate with touch")}</button>
    </div>
    {!pallet&&<p className="model-reference-note">{tr("通用外形示意，标注为可用装载空间。", "The generic model shows the usable cargo dimensions.")}</p>}
  </section>;
}
