"use client";

import { Edges, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Box, DoorOpen, Eye, ScanLine, ImageDown, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { tr, useLanguage } from "./language";
import {
  calculateCameraFit,
  calculateCameraViewFit,
  type CameraProjection,
  type CameraPresetView,
  type CameraView,
  type SceneSize,
} from "../lib/packing/camera-fit";
import { detectRuntimePolicy } from "../lib/packing/runtime-policy";
import type { PackingResult, PlacedBox } from "../lib/packing/types";

type Props = {
  presentation?: boolean;
  result: PackingResult | null;
  visibleProducts: Set<string>;
  visibleCount: number;
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
        <b>箱门</b>
      </div>
      <strong>当前浏览器未启用 WebGL</strong>
      <span>已切换为真实坐标俯视图；装柜计算、校验与导出不受影响。</span>
    </div>
  );
}

function InstancedBoxes({ group, scale, offset, reducedRendering }: { group: InstanceGroup; scale: number; offset: THREE.Vector3; reducedRendering: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null), baseRef = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext("2d"); if (!ctx) return undefined;
    ctx.fillStyle = group.color; ctx.fillRect(0,0,512,256); ctx.strokeStyle = "rgba(255,255,255,.36)"; ctx.lineWidth = 3; ctx.strokeRect(12,12,488,232);
    ctx.fillStyle = "#ffffff"; ctx.textAlign="center"; ctx.font="bold 42px sans-serif"; ctx.fillText(group.sku.slice(0,20),256,125); ctx.font="32px sans-serif"; ctx.fillText(`${group.orientation[2]} ↑`,256,185);
    const result = new THREE.CanvasTexture(canvas); result.colorSpace=THREE.SRGBColorSpace; return result;
  }, [group.sku,group.orientation,group.color]);
  useEffect(()=>()=>texture?.dispose(),[texture]);
  useLayoutEffect(() => {
    if (!meshRef.current) return;
    group.boxes.forEach((box,index)=>{
      const dims=[box.dx,box.dz,box.dy], pos=[(box.x+box.dx/2)*scale+offset.x,(box.z+box.dz/2)*scale+offset.y,(box.y+box.dy/2)*scale+offset.z];
      const originalAxis=box.orientation.indexOf("H"), axis=originalAxis===0?0:originalAxis===1?2:1;
      const base=group.cargoType==="pallet"?Math.min(group.baseHeight??0,dims[axis]*.95):0;
      const bodyDims=[...dims], bodyPos=[...pos];bodyDims[axis]-=base;bodyPos[axis]+=base*scale/2;
      transform.position.set(...bodyPos as [number,number,number]); transform.scale.set(...bodyDims.map(d=>d*scale*.985) as [number,number,number]);transform.updateMatrix();meshRef.current?.setMatrixAt(index,transform.matrix);
      if(baseRef.current){const baseDims=[...dims],basePos=[...pos];baseDims[axis]=base;basePos[axis]-=(dims[axis]-base)*scale/2;transform.position.set(...basePos as [number,number,number]);transform.scale.set(...baseDims.map(d=>d*scale*.985) as [number,number,number]);transform.updateMatrix();baseRef.current.setMatrixAt(index,transform.matrix);}
    });
    meshRef.current.instanceMatrix.needsUpdate=true;meshRef.current.computeBoundingSphere();if(baseRef.current){baseRef.current.instanceMatrix.needsUpdate=true;baseRef.current.computeBoundingSphere();}
  },[group.boxes,group.baseHeight,group.cargoType,offset,scale,transform]);
  return <><instancedMesh ref={meshRef} args={[undefined,undefined,group.boxes.length]} castShadow={!reducedRendering} receiveShadow={!reducedRendering}><boxGeometry args={[1,1,1]}/><meshStandardMaterial map={texture} color={texture?"white":group.color} roughness={.72}/></instancedMesh>{group.cargoType==="pallet" && !!group.baseHeight && <instancedMesh ref={baseRef} args={[undefined,undefined,group.boxes.length]}><boxGeometry args={[1,1,1]}/><meshStandardMaterial color="#956641" roughness={.9}/></instancedMesh>}</>;
}

function SceneCapture({ register }: { register: (capture: () => Promise<Blob>) => void }) {
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
  containerSize,
  view,
  projection,
  onInteraction,
}: {
  containerSize: SceneSize;
  view: CameraView;
  projection: CameraProjection;
  onInteraction: () => void;
}) {
  const { size: viewport } = useThree();
  const perspectiveRef = useRef<THREE.PerspectiveCamera>(null);
  const orthographicRef = useRef<THREE.OrthographicCamera>(null);
  const baseFit = useMemo(
    () => calculateCameraFit(containerSize, { width: viewport.width, height: viewport.height }),
    [containerSize, viewport.height, viewport.width],
  );
  const presetView: CameraPresetView = view === "free" ? "perspective" : view;
  const targetFit = useMemo(
    () => calculateCameraViewFit(containerSize, { width: viewport.width, height: viewport.height }, presetView),
    [containerSize, presetView, viewport.height, viewport.width],
  );
  const targetPosition = useMemo(() => new THREE.Vector3(...targetFit.position), [targetFit.position]);
  const targetUp = useMemo(() => new THREE.Vector3(...targetFit.up), [targetFit.up]);
  const lookAt = useMemo(() => new THREE.Vector3(...targetFit.target), [targetFit.target]);

  useFrame((_, delta) => {
    const camera = projection === "orthographic" ? orthographicRef.current : perspectiveRef.current;
    if (!camera || view === "free") return;
    const alpha = 1 - Math.exp(-7.5 * delta);
    camera.position.lerp(targetPosition, alpha);
    camera.up.lerp(targetUp, alpha).normalize();
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
  });

  return (
    <>
      {projection === "orthographic" ? (
        <OrthographicCamera
          ref={orthographicRef}
          makeDefault
          position={targetFit.position}
          up={targetFit.up}
          left={-targetFit.orthographicHalfWidth}
          right={targetFit.orthographicHalfWidth}
          top={targetFit.orthographicHalfHeight}
          bottom={-targetFit.orthographicHalfHeight}
          near={Math.min(baseFit.near, targetFit.near)}
          far={Math.max(baseFit.far, targetFit.far)}
        />
      ) : (
        <PerspectiveCamera
          ref={perspectiveRef}
          makeDefault
          position={baseFit.position}
          up={baseFit.up}
          fov={34}
          near={Math.min(baseFit.near, targetFit.near)}
          far={Math.max(baseFit.far, targetFit.far)}
        />
      )}
      <OrbitControls
        key={projection}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={Math.min(baseFit.minDistance, targetFit.minDistance)}
        maxDistance={Math.max(baseFit.maxDistance, targetFit.maxDistance)}
        minZoom={0.45}
        maxZoom={4}
        target={targetFit.target}
        onStart={onInteraction}
      />
    </>
  );
}

function ContainerModel({ result, visibleProducts, visibleCount, reducedRendering, presentation }: { result: PackingResult; visibleProducts: Set<string>; visibleCount: number; reducedRendering: boolean; presentation?: boolean }) {
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
      {baseHeight > 0 && <mesh position={[0, baseHeight * scale / 2, 0]}><boxGeometry args={[size[0], baseHeight * scale, size[2]]}/><meshStandardMaterial color="#956641" roughness={.9}/></mesh>}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, baseHeight * scale - 0.015, 0]} receiveShadow={!reducedRendering}>
        <planeGeometry args={[size[0], size[2]]} />
        <meshStandardMaterial color="#dbe4e6" roughness={0.95} />
      </mesh>
      {groups.map((group) => (
        <InstancedBoxes key={group.productId} group={group} scale={scale} offset={offset} reducedRendering={reducedRendering} />
      ))}
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
  cameraView,
  projectionMode,
  onCameraViewChange,
  onProjectionModeChange,
}: Props) {
  useLanguage();
  const captureRef=useRef<(() => Promise<Blob>) | null>(null);
  const registerCapture=useMemo(()=> (capture: () => Promise<Blob>) => { captureRef.current=capture; },[]);
  const [captureError,setCaptureError] = useState("");
  const saveImage=async()=>{ try { const blob=await captureRef.current?.();if(!blob)throw new Error(tr("图形尚未准备完成。", "Scene is not ready."));const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="CargoFit_3D.png";link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setCaptureError(""); } catch(e) {setCaptureError(e instanceof Error?e.message:"Image export failed");}};
  const clientReady = useSyncExternalStore(subscribeToClientReady, getClientReady, getServerNotReady);
  const webglSupported = clientReady ? supportsWebGL() : null;
  const reducedRendering = clientReady ? detectRuntimePolicy().reducedRendering : false;
  const containerSize = useMemo<SceneSize>(() => (result ? normalizedSceneSize(result) : [5.6, 1.25, 1.1]), [result]);
  return (
    <div className="scene-shell" role="region" aria-label="可交互三维装柜视图">
      {!result ? (
        <div className="scene-empty">
          <div className="scene-empty-cube" aria-hidden="true" />
          <strong>等待计算方案</strong>
          <span>填写左侧参数后，柜内真实摆放会显示在这里</span>
        </div>
      ) : webglSupported === null ? (
        <div className="scene-loading">正在检测三维图形能力…</div>
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
              <fog attach="fog" args={["#eef4f5", 12, 24]} />
              <ambientLight intensity={1.45} />
              <hemisphereLight args={["#ffffff", "#61747a", 1.5]} />
              <directionalLight castShadow={!reducedRendering} position={[5, 9, 4]} intensity={2.1} shadow-mapSize-width={reducedRendering ? 256 : 1024} shadow-mapSize-height={reducedRendering ? 256 : 1024} />
              <ContainerModel result={result} visibleProducts={visibleProducts} visibleCount={visibleCount} reducedRendering={reducedRendering} presentation={presentation} />
              <SceneCapture register={registerCapture}/>
              <CameraRig
                containerSize={containerSize}
                view={cameraView}
                projection={projectionMode}
                onInteraction={() => onCameraViewChange("free")}
              />
            </Canvas>
          </div>
          <div className="scene-camera-controls">
            <div className="scene-projection-controls" role="toolbar" aria-label="三维投影方式">
              <button type="button" className={projectionMode === "perspective" ? "active" : ""} aria-pressed={projectionMode === "perspective"} onClick={() => onProjectionModeChange("perspective")}>透视投影</button>
              <button type="button" className={projectionMode === "orthographic" ? "active" : ""} aria-pressed={projectionMode === "orthographic"} onClick={() => onProjectionModeChange("orthographic")}>正交投影</button>
            </div>
            <div className="scene-view-controls" role="toolbar" aria-label="三维相机视角">
              {CAMERA_VIEWS.map((view) => (
                <button
                  type="button"
                  key={view.id}
                  className={cameraView === view.id ? "active" : ""}
                  aria-pressed={cameraView === view.id}
                  onClick={() => onCameraViewChange(view.id)}
                >
                  {view.icon}
                  {tr(view.label)}
                </button>
              ))}
            </div>
          </div>
          <div className="scene-tools"><button type="button" onClick={()=>{onCameraViewChange("perspective");onProjectionModeChange("perspective");}}><RotateCcw size={14}/>{tr("重置视图")}</button><button type="button" onClick={()=>void saveImage()}><ImageDown size={14}/>{tr("保存图片")}</button></div>
          {!presentation && <div className="scene-rulers"><span>L {result.container.length-result.clearance*2} mm</span><span>W {result.container.width-result.clearance*2} mm</span><span>H {result.container.height-result.clearance} mm</span></div>}
          {!presentation && <div className="orientation-cube" aria-label={tr("方向立方体", "Orientation cube")}>{CAMERA_VIEWS.filter(v=>v.id!=="perspective").map(v=><button key={v.id} aria-label={`${tr("方向立方体", "Orientation cube")} · ${tr(v.label)}`} onClick={()=>{onProjectionModeChange("orthographic");onCameraViewChange(v.id);}}>{tr(v.label)}</button>)}</div>}
          {captureError && <p role="alert" className="scene-export-error">{captureError}</p>}
          {!presentation && <div className="scene-hint">
            <span>拖动旋转</span>
            <span>滚轮缩放</span>
            <span>右键平移</span>
          </div>}
          <div className="door-marker">箱门方向</div>
        </>
      )}
    </div>
  );
}
