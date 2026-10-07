"use client";

import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Box, DoorOpen, Eye, ScanLine, ImageDown, RotateCcw, Tag, Ruler, ZoomIn } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentRef } from "react";
import * as THREE from "three";
import { boxFaceTexture, PalletStructures, SceneRulers, SelectedBoxDimensions } from "./scene-details";
import { palletParts, palletAnchors } from "../lib/packing/floor-pallets";
import { SceneFullscreen } from "./scene-fullscreen";
import {tr, useLanguage} from "./language";
import {
  type CameraProjection,
  type CameraPresetView,
  type CameraView,
  type SceneSize,
} from "../lib/packing/camera-fit";
import { SceneCameraController } from "../lib/packing/scene-camera";
import { detectRuntimePolicy } from "../lib/packing/runtime-policy";
import type { PackingResult, PlacedBox } from "../lib/packing/types";

type Props = {
  presentation?: boolean;
  result: PackingResult | null;
  visibleProducts: Set<string>;
  visibleCount: number;
  onVisibleCountChange?: (count: number) => void;
  cameraView: CameraView;
  projectionMode: CameraProjection;
  onCameraViewChange: (view: CameraView) => void;
  onProjectionModeChange: (projection: CameraProjection) => void;
};

type InstanceGroup = {
  productId: string;
  sku: string;
  orientation: string;
  cargoType?: string;
  baseHeight?: number;
  color: string;
  boxes: PlacedBox[];
};

let cachedWebGLSupport: boolean | undefined;

function supportsWebGL() {
  if (cachedWebGLSupport !== undefined) return cachedWebGLSupport;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    cachedWebGLSupport = Boolean(context);
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cachedWebGLSupport = false;
  }
  return cachedWebGLSupport;
}

const subscribeToClientReady = () => () => undefined;
const getClientReady = () => true;
const getServerNotReady = () => false;

function TopViewFallback({ result, visibleProducts, visibleCount }: { result: PackingResult; visibleProducts: Set<string>; visibleCount: number }) {
  useLanguage();
  const effectiveLength = Math.max(1, result.container.length - result.clearance * 2);
  const effectiveWidth = Math.max(1, result.container.width - result.clearance * 2);
  return (
    <div className="scene-fallback">
      <div className="fallback-plan" style={{ aspectRatio: `${effectiveLength} / ${effectiveWidth}` }}>
        {result.placements.slice(0, visibleCount).filter((box) => visibleProducts.has(box.productId)).slice(0, 500).map((box) => (
          <i
            key={box.id}
            title={`${box.sku} · Z ${box.z} mm`}
            style={{
              background: box.color,
              left: `${(box.x / effectiveLength) * 100}%`,
              top: `${(box.y / effectiveWidth) * 100}%`,
              width: `${(box.dx / effectiveLength) * 100}%`,
              height: `${(box.dy / effectiveWidth) * 100}%`,
              zIndex: Math.max(1, Math.round(box.z)),
            }}
          />
        ))}
        <b>{tr("箱门")}</b>
      </div>
      <strong>{tr("当前浏览器未启用 WebGL")}</strong>
      <span>{tr("已切换为真实坐标俯视图；装柜计算、校验与导出不受影响。")}</span>
    </div>
  );
}

function InstancedBoxes({ group, scale, offset, reducedRendering, labels, onSelect }: { group: InstanceGroup; scale: number; offset: THREE.Vector3; reducedRendering: boolean; labels:boolean; onSelect:(box:PlacedBox)=>void }) {
  useLanguage();
  const meshRef = useRef<THREE.InstancedMesh>(null), baseRef = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const first=group.boxes[0];
  const materials = useMemo(() => {
    const dims=[first.dx,first.dz,first.dy], axis=first.orientation.indexOf("H");
    if(group.cargoType==="pallet")dims[axis===0?0:axis===1?2:1]-=group.baseHeight??0;
    const textures=labels?[boxFaceTexture(group.sku,group.color,dims[2],dims[1],group.orientation[2]),boxFaceTexture(group.sku,group.color,dims[0],dims[2]),boxFaceTexture(group.sku,group.color,dims[0],dims[1],group.orientation[2])]:[];
    const maps=[textures[0],textures[0],textures[1],textures[1],textures[2],textures[2]];
    return maps.map(map=>new THREE.MeshStandardMaterial({map,color:map?"white":group.color,roughness:.82}));
  },[first.dx,first.dy,first.dz,first.orientation,group.baseHeight,group.cargoType,group.sku,group.color,group.orientation,labels]);
  useEffect(()=>()=>{new Set(materials.map(m=>m.map)).forEach(t=>t?.dispose());materials.forEach(m=>m.dispose());},[materials]);
  const parts=useMemo(()=>group.cargoType!=="pallet"||!group.baseHeight?[]:group.boxes.flatMap(box=>{
    const world=[box.dx,box.dy,box.dz];
    const l=world[box.orientation.indexOf("L")],w=world[box.orientation.indexOf("W")];
    return palletParts(l,w,group.baseHeight!).map(p=>{
      const positions={L:p.x,W:p.y,H:p.z},dimensions={L:p.dx,W:p.dy,H:p.dz};
      const letters=box.orientation.split("") as Array<"L"|"W"|"H">;
      return {x:box.x+positions[letters[0]],y:box.y+positions[letters[1]],z:box.z+positions[letters[2]],dx:dimensions[letters[0]],dy:dimensions[letters[1]],dz:dimensions[letters[2]],kind:p.kind};
    });
  }),[group.boxes,group.baseHeight,group.cargoType]);
  useLayoutEffect(() => {
    if (!meshRef.current) return;
    group.boxes.forEach((box,index)=>{
      const dims=[box.dx,box.dz,box.dy], pos=[(box.x+box.dx/2)*scale+offset.x,(box.z+box.dz/2)*scale+offset.y,(box.y+box.dy/2)*scale+offset.z];
      const originalAxis=box.orientation.indexOf("H"), axis=originalAxis===0?0:originalAxis===1?2:1;
      const base=group.cargoType==="pallet"?Math.min(group.baseHeight??0,dims[axis]*.95):0;
      dims[axis]-=base;pos[axis]+=base*scale/2;
      transform.position.set(...pos as [number,number,number]); transform.scale.set(...dims.map(d=>d*scale) as [number,number,number]);transform.updateMatrix();meshRef.current?.setMatrixAt(index,transform.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate=true;meshRef.current.computeBoundingSphere();
    if(baseRef.current){parts.forEach((p,i)=>{transform.position.set((p.x+p.dx/2)*scale+offset.x,(p.z+p.dz/2)*scale+offset.y,(p.y+p.dy/2)*scale+offset.z);transform.scale.set(p.dx*scale*.997,p.dz*scale*.995,p.dy*scale*.997);transform.updateMatrix();baseRef.current!.setMatrixAt(i,transform.matrix);baseRef.current!.setColorAt(i,new THREE.Color(p.kind==="block"?"#ac8151":"#d4af7b"));});baseRef.current.instanceMatrix.needsUpdate=true;if(baseRef.current.instanceColor)baseRef.current.instanceColor.needsUpdate=true;baseRef.current.computeBoundingSphere();}
  },[group.boxes,group.baseHeight,group.cargoType,parts,materials,offset,scale,transform]);
  return <><instancedMesh ref={meshRef} args={[undefined,materials,group.boxes.length]} castShadow={!reducedRendering} receiveShadow={!reducedRendering} onClick={e=>{e.stopPropagation();if(e.instanceId!==undefined)onSelect(group.boxes[e.instanceId]);}}><boxGeometry args={[1,1,1]}/></instancedMesh>{parts.length>0&&<instancedMesh ref={baseRef} args={[undefined,undefined,parts.length]}><boxGeometry/><meshStandardMaterial roughness={.92}/></instancedMesh>}</>;
}

function SceneCapture({ register }: { register: (capture: () => Promise<Blob>) => void }) {
  useLanguage();
  const { gl,scene,camera } = useThree();
  useEffect(()=>{register(()=>new Promise((resolve,reject)=>{gl.render(scene,camera);gl.domElement.toBlob(blob=>blob?resolve(blob):reject(new Error("Image export failed")),"image/png");}));},[gl,scene,camera,register]);
  return null;
}

function normalizedSceneSize(result: PackingResult): SceneSize {
  const effectiveLength = Math.max(1, result.container.length - result.clearance * 2);
  const effectiveWidth = Math.max(1, result.container.width - result.clearance * 2);
  const effectiveHeight = Math.max(1, result.container.height - result.clearance + (result.container.baseHeight ?? 0));
  const scale = 5.6 / Math.max(effectiveLength, effectiveWidth, effectiveHeight);
  return [effectiveLength * scale, effectiveHeight * scale, effectiveWidth * scale];
}

function CameraRig({
  controller,
  containerSize,
  view,
  projection,
  onInteraction,
  focus,
}: {
  controller: SceneCameraController;
  containerSize: SceneSize;
  view: CameraView;
  projection: CameraProjection;
  onInteraction: () => void;
  focus?: {size:SceneSize;origin:SceneSize};
}) {
  useLanguage();
  const { size: viewport, get, set } = useThree();
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = controller.cameras[projection];
  useLayoutEffect(() => {
    const previous = get().camera;
    set({ camera });
    return () => set({ camera: previous });
  }, [camera, get, set]);
  useLayoutEffect(() => {
    if (controlsRef.current) controller.update({ containerSize, viewport, view, projection, focus }, controlsRef.current);
  }, [controller, containerSize, viewport, view, projection, focus]);
  return <OrbitControls
    ref={controlsRef}
    camera={camera}
    makeDefault
    enableDamping
    dampingFactor={0.08}
    minZoom={0.45}
    maxZoom={4}
    onStart={onInteraction}
  />;
}

function ContainerModel({ result, visibleProducts, visibleCount, reducedRendering, presentation, labels, rulers, selected, onSelect }: { result: PackingResult; visibleProducts: Set<string>; visibleCount: number; reducedRendering: boolean; presentation?: boolean; labels:boolean; rulers:boolean; selected:PlacedBox|null;onSelect:(b:PlacedBox)=>void }) {
  useLanguage();
  const effective = {
    length: result.container.length - result.clearance * 2,
    width: result.container.width - result.clearance * 2,
    height: result.container.height - result.clearance,
  };
  const baseHeight = result.container.baseHeight ?? 0;
  const maxDimension = Math.max(effective.length, effective.width, effective.height + baseHeight);
  const scale = 5.6 / maxDimension;
  const offset = useMemo(
    () => new THREE.Vector3(-effective.length * scale * 0.5, baseHeight * scale, -effective.width * scale * 0.5),
    [baseHeight, effective.length, effective.width, scale],
  );
  const groups = useMemo(() => {
    const map = new Map<string, InstanceGroup>();
    for (const box of result.placements.slice(0, visibleCount)) {
      if (!visibleProducts.has(box.productId)) continue;
      const key = `${box.productId}:${box.orientation}`;
      const meta = result.cargoDetails?.[box.productId];
      const current = map.get(key) ?? { productId: key, sku: box.sku, orientation: box.orientation, cargoType: meta?.cargoType, baseHeight: meta?.palletBaseHeight, color: box.color, boxes: [] };
      current.boxes.push(box);
      map.set(key, current);
    }
    return [...map.values()];
  }, [result.placements, result.cargoDetails, visibleCount, visibleProducts]);
  const size: [number, number, number] = [effective.length * scale, effective.height * scale, effective.width * scale];

  return (
    <group>
      {!presentation && <mesh position={[0, size[1] / 2 + baseHeight * scale, 0]} receiveShadow={!reducedRendering}>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#8bb8c0" transparent opacity={0.055} roughness={0.8} side={THREE.DoubleSide} />
        <Edges color="#4e7380" threshold={15} />
      </mesh>}
      {baseHeight > 0 && <PalletStructures pallets={[{id:"space-base",presetId:result.container.id,name:result.container.name,x:0,y:0,z:-baseHeight,dx:effective.length,dy:effective.width,dz:baseHeight,weight:0,maxLoad:result.container.maxWeight,orientation:"LWH"}]} scale={scale} offset={offset}/>}
      <PalletStructures pallets={result.pallets??[]} scale={scale} offset={offset} onSelect={p=>onSelect(palletAnchors([p])[0])}/>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]} receiveShadow={!reducedRendering}>
        <planeGeometry args={[size[0], size[2]]} />
        <meshStandardMaterial color="#dbe4e6" roughness={0.95} />
      </mesh>
      {groups.map((group) => (
        <InstancedBoxes key={group.productId} group={group} scale={scale} offset={offset} reducedRendering={reducedRendering} labels={labels} onSelect={onSelect} />
      ))}
      {rulers && <SceneRulers length={effective.length} width={effective.width} height={effective.height} scale={scale} offset={offset}/>}
      {selected && <SelectedBoxDimensions box={selected} scale={scale} offset={offset}/>}
      {!presentation && <gridHelper args={[Math.max(size[0], size[2]) * 1.25, 16, "#91a6ab", "#d9e1e3"]} position={[0, -0.02, 0]} />}
    </group>
  );
}

const CAMERA_VIEWS: Array<{ id: CameraPresetView; label: string; icon: React.ReactNode }> = [
  { id: "perspective", label: "等轴测", icon: <Box size={13} /> },
  { id: "top", label: "俯视", icon: <ScanLine size={13} /> },
  { id: "side", label: "侧视", icon: <Eye size={13} /> },
  { id: "door", label: "箱门", icon: <DoorOpen size={13} /> },
  { id: "bottom", label: "底视", icon: <ScanLine size={13}/> },
  { id: "rear", label: "后视", icon: <DoorOpen size={13}/> },
  { id: "left", label: "左视", icon: <Eye size={13}/> },
];

export function ContainerScene({
  result,
  presentation = false,
  visibleProducts,
  visibleCount,
  onVisibleCountChange,
  cameraView,
  projectionMode,
  onCameraViewChange,
  onProjectionModeChange,
}: Props) {
  useLanguage();
  const cameraController = useMemo(() => new SceneCameraController(), []);
  const captureRef=useRef<(() => Promise<Blob>) | null>(null);
  const registerCapture=useMemo(()=> (capture: () => Promise<Blob>) => { captureRef.current=capture; },[]);
  const [labels,setLabels]=useState(true),[rulers,setRulers]=useState(true),[selection,setSelection]=useState<{planId:string;box:PlacedBox}|null>(null),[focusId,setFocusId]=useState<string|null>(null);
  const selected=selection&&selection.planId===result?.id&&(selection.box.supportOnly?result?.pallets?.some(p=>p.id===selection.box.id):result?.placements.slice(0,visibleCount).some(b=>b.id===selection.box.id)&&visibleProducts.has(selection.box.productId))?selection.box:null;
  const focus=useMemo(()=>{if(!selected||!result||focusId!==selected.id||projectionMode!=="perspective"||(cameraView!=="perspective"&&cameraView!=="free"))return undefined;const l=result.container.length-result.clearance*2,w=result.container.width-result.clearance*2,h=result.container.height-result.clearance,base=result.container.baseHeight??0,scale=5.6/Math.max(l,w,h+base);return {size:[selected.dx*scale,selected.dz*scale,selected.dy*scale] as SceneSize,origin:[(selected.x+selected.dx/2-l/2)*scale,(selected.z+base)*scale,(selected.y+selected.dy/2-w/2)*scale] as SceneSize};},[selected,result,focusId,projectionMode,cameraView]);
  const [captureError,setCaptureError] = useState("");
  const saveImage=async()=>{ try { const blob=await captureRef.current?.();if(!blob)throw new Error(tr("图形尚未准备完成。", "Scene is not ready."));const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="CargoFit_3D.png";link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setCaptureError(""); } catch(e) {setCaptureError(e instanceof Error?e.message:"Image export failed");}};
  const clientReady = useSyncExternalStore(subscribeToClientReady, getClientReady, getServerNotReady);
  const webglSupported = clientReady ? supportsWebGL() : null;
  const reducedRendering = clientReady ? detectRuntimePolicy().reducedRendering : false;
  const containerSize = useMemo<SceneSize>(() => (result ? normalizedSceneSize(result) : [5.6, 1.25, 1.1]), [result]);
  return (
    <SceneFullscreen>          <div className="scene-camera-controls">
            <div className="scene-projection-controls" role="toolbar" aria-label={tr("三维投影方式")}>
              <button type="button" className={projectionMode === "perspective" ? "active" : ""} aria-pressed={projectionMode === "perspective"} onClick={() => { setFocusId(null); onProjectionModeChange("perspective"); }}>{tr("透视投影")}</button>
              <button type="button" className={projectionMode === "orthographic" ? "active" : ""} aria-pressed={projectionMode === "orthographic"} onClick={() => { setFocusId(null); onProjectionModeChange("orthographic"); }}>{tr("正交投影")}</button>
            </div>
            <div className="scene-view-controls" role="toolbar" aria-label={tr("三维相机视角")}>
              {CAMERA_VIEWS.map((view) => (
                <button
                  type="button"
                  key={view.id}
                  className={cameraView === view.id ? "active" : ""}
                  aria-pressed={cameraView === view.id}
                  onClick={() => { setFocusId(null); onCameraViewChange(view.id); }}
                >
                  {view.icon}
                  {tr(view.label)}
                </button>
              ))}
            </div>
          </div>
          <div className="scene-tools" aria-label={tr("三维工具", "3D tools")}><button type="button" disabled={!webglSupported} aria-pressed={labels} onClick={()=>setLabels(v=>!v)}><Tag size={14}/>{tr("箱标","Labels")}</button><button type="button" disabled={!webglSupported} aria-pressed={rulers} onClick={()=>setRulers(v=>!v)}><Ruler size={14}/>{tr("尺寸","Dimensions")}</button><button type="button" onClick={()=>{setSelection(null);setFocusId(null);onCameraViewChange("perspective");onProjectionModeChange("perspective");}}><RotateCcw size={14}/>{tr("重置视图")}</button><button type="button" disabled={!webglSupported} onClick={()=>void saveImage()}><ImageDown size={14}/>{tr("保存图片")}</button></div>
<div className="scene-shell" role="region" aria-label={tr("可交互三维装柜视图")}>
      {!result ? (
        <div className="scene-empty">
          <div className="scene-empty-cube" aria-hidden="true" />
          <strong>{tr("等待计算方案")}</strong>
          <span>{tr("填写左侧参数后，柜内真实摆放会显示在这里")}</span>
        </div>
      ) : webglSupported === null ? (
        <div className="scene-loading">{tr("正在检测三维图形能力…")}</div>
      ) : !webglSupported ? (
        <TopViewFallback result={result} visibleProducts={visibleProducts} visibleCount={visibleCount} />
      ) : (
        <>
          <div className="scene-canvas">
            <Canvas
              shadows={!reducedRendering}
              dpr={reducedRendering ? [1, 1.1] : [1, 1.6]}
              gl={{ antialias: !reducedRendering, alpha: true, powerPreference: reducedRendering ? "low-power" : "high-performance" }}
            >
              <color attach="background" args={["#eef4f5"]} />
              <ambientLight intensity={.8} />
              <hemisphereLight args={["#ffffff", "#61747a", .8]} />
              <directionalLight castShadow={!reducedRendering} position={[5, 9, 4]} intensity={2.1} shadow-mapSize-width={reducedRendering ? 256 : 1024} shadow-mapSize-height={reducedRendering ? 256 : 1024} />
              <ContainerModel result={result} visibleProducts={visibleProducts} visibleCount={visibleCount} reducedRendering={reducedRendering} presentation={presentation} labels={labels} rulers={rulers&&!focus} selected={selected} onSelect={box=>setSelection({planId:result.id,box})} />
              <SceneCapture register={registerCapture}/>
              <CameraRig
                controller={cameraController}
                containerSize={containerSize}
                view={cameraView}
                projection={projectionMode}
                focus={focus}
                onInteraction={() => onCameraViewChange("free")}
              />
            </Canvas>
          </div>
          {selected && <div className="scene-selection-info"><button aria-label={tr("关闭箱体详情","Close box details")} onClick={()=>{setSelection(null);setFocusId(null);}}>×</button><strong>{selected.supportOnly?`${selected.name} · ${selected.id.replace("floor-pallet-","P")}`:selected.sku}</strong><button className="scene-focus-button" onClick={()=>{setFocusId(selected.id);onCameraViewChange("perspective");onProjectionModeChange("perspective");}}><ZoomIn size={13}/>{tr("放大查看","Focus on box")}</button><span>{selected.dx} × {selected.dy} × {selected.dz} mm</span><span>X {selected.x} · Y {selected.y} · Z {selected.z} mm</span>{selected.supportOnly&&<span>{tr("自重 / 承重","Tare / payload")} {selected.weight} / {result.pallets?.find(p=>p.id===selected.id)?.maxLoad} kg</span>}{selected.palletIds?.length?<span>{tr("托盘","Pallet")} {selected.palletIds.map(id=>id.replace("floor-pallet-","P")).join(" / ")}</span>:null}</div>}
          {captureError && <p role="alert" className="scene-export-error">{captureError}</p>}
          {!presentation && <div className="scene-hint">
            <span>{tr("拖动旋转")}</span>
            <span>{tr("滚轮缩放")}</span>
            <span>{tr("右键平移")}</span>
          </div>}
          <div className="door-marker">{tr("箱门方向")}</div>
        </>
      )}
    </div>{result&&onVisibleCountChange&&<footer className="scene-progress"><span>{tr("装载进度")}</span><input type="range" min={0} max={result.placements.length} value={visibleCount} aria-label={tr("三维装载进度", "3D loading progress")} onChange={e=>onVisibleCountChange(Number(e.target.value))}/><output>{visibleCount} / {result.placements.length} {tr("箱")}</output></footer>}</SceneFullscreen>
  );
}
