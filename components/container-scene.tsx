"use client";

import { Edges, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Box, DoorOpen, Eye, ScanLine } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  calculateCameraFit,
  calculateCameraViewFit,
  type CameraProjection,
  type CameraPresetView,
  type CameraView,
  type SceneSize,
} from "../lib/packing/camera-fit";
import type { PackingResult, PlacedBox } from "../lib/packing/types";

type Props = {
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
  color: string;
  boxes: PlacedBox[];
};

function supportsWebGL() {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

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

function InstancedBoxes({ group, scale, offset }: { group: InstanceGroup; scale: number; offset: THREE.Vector3 }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    group.boxes.forEach((box, index) => {
      transform.position.set(
        (box.x + box.dx / 2) * scale + offset.x,
        (box.z + box.dz / 2) * scale + offset.y,
        (box.y + box.dy / 2) * scale + offset.z,
      );
      transform.scale.set(box.dx * scale * 0.985, box.dz * scale * 0.985, box.dy * scale * 0.985);
      transform.updateMatrix();
      meshRef.current?.setMatrixAt(index, transform.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.computeBoundingSphere();
  }, [group.boxes, offset, scale, transform]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, group.boxes.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={group.color} roughness={0.72} metalness={0.08} />
    </instancedMesh>
  );
}

function normalizedSceneSize(result: PackingResult): SceneSize {
  const effectiveLength = Math.max(1, result.container.length - result.clearance * 2);
  const effectiveWidth = Math.max(1, result.container.width - result.clearance * 2);
  const effectiveHeight = Math.max(1, result.container.height - result.clearance);
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

function ContainerModel({ result, visibleProducts, visibleCount }: { result: PackingResult; visibleProducts: Set<string>; visibleCount: number }) {
  const effective = useMemo(
    () => ({
      length: result.container.length - result.clearance * 2,
      width: result.container.width - result.clearance * 2,
      height: result.container.height - result.clearance,
    }),
    [result],
  );
  const maxDimension = Math.max(effective.length, effective.width, effective.height);
  const scale = 5.6 / maxDimension;
  const offset = useMemo(
    () => new THREE.Vector3(-effective.length * scale * 0.5, 0, -effective.width * scale * 0.5),
    [effective.length, effective.width, scale],
  );
  const groups = useMemo(() => {
    const map = new Map<string, InstanceGroup>();
    for (const box of result.placements.slice(0, visibleCount)) {
      if (!visibleProducts.has(box.productId)) continue;
      const current = map.get(box.productId) ?? { productId: box.productId, color: box.color, boxes: [] };
      current.boxes.push(box);
      map.set(box.productId, current);
    }
    return [...map.values()];
  }, [result.placements, visibleCount, visibleProducts]);
  const size: [number, number, number] = [effective.length * scale, effective.height * scale, effective.width * scale];

  return (
    <group>
      <mesh position={[0, size[1] / 2, 0]} receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#8bb8c0" transparent opacity={0.055} roughness={0.8} side={THREE.DoubleSide} />
        <Edges color="#4e7380" threshold={15} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]} receiveShadow>
        <planeGeometry args={[size[0], size[2]]} />
        <meshStandardMaterial color="#dbe4e6" roughness={0.95} />
      </mesh>
      {groups.map((group) => (
        <InstancedBoxes key={group.productId} group={group} scale={scale} offset={offset} />
      ))}
      <gridHelper args={[Math.max(size[0], size[2]) * 1.25, 16, "#91a6ab", "#d9e1e3"]} position={[0, -0.02, 0]} />
    </group>
  );
}

const CAMERA_VIEWS: Array<{ id: CameraPresetView; label: string; icon: React.ReactNode }> = [
  { id: "perspective", label: "等轴测", icon: <Box size={13} /> },
  { id: "top", label: "俯视", icon: <ScanLine size={13} /> },
  { id: "side", label: "侧视", icon: <Eye size={13} /> },
  { id: "door", label: "箱门", icon: <DoorOpen size={13} /> },
];

export function ContainerScene({
  result,
  visibleProducts,
  visibleCount,
  cameraView,
  projectionMode,
  onCameraViewChange,
  onProjectionModeChange,
}: Props) {
  const webglSupported = useMemo(() => supportsWebGL(), []);
  const containerSize = useMemo<SceneSize>(() => (result ? normalizedSceneSize(result) : [5.6, 1.25, 1.1]), [result]);
  return (
    <div className="scene-shell" role="region" aria-label="可交互三维装柜视图">
      {!result ? (
        <div className="scene-empty">
          <div className="scene-empty-cube" aria-hidden="true" />
          <strong>等待计算方案</strong>
          <span>填写左侧参数后，柜内真实摆放会显示在这里</span>
        </div>
      ) : !webglSupported ? (
        <TopViewFallback result={result} visibleProducts={visibleProducts} visibleCount={visibleCount} />
      ) : (
        <>
          <div className="scene-canvas">
            <Canvas
              shadows
              dpr={[1, 1.6]}
              gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            >
              <color attach="background" args={["#eef4f5"]} />
              <fog attach="fog" args={["#eef4f5", 12, 24]} />
              <ambientLight intensity={1.45} />
              <hemisphereLight args={["#ffffff", "#61747a", 1.5]} />
              <directionalLight castShadow position={[5, 9, 4]} intensity={2.1} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
              <ContainerModel result={result} visibleProducts={visibleProducts} visibleCount={visibleCount} />
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
                  {view.label}
                </button>
              ))}
            </div>
          </div>
          <div className="scene-hint">
            <span>拖动旋转</span>
            <span>滚轮缩放</span>
            <span>右键平移</span>
          </div>
          <div className="door-marker">箱门方向</div>
        </>
      )}
    </div>
  );
}
