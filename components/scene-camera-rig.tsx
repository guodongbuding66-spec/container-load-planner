"use client";
import { useLayoutEffect, useRef, type ComponentRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { SceneCameraController } from "../lib/packing/scene-camera";
import type { CameraView, CameraProjection, SceneSize } from "../lib/packing/camera-fit";

export function SceneCameraRig({ controller, containerSize, sceneBounds, view, projection, onInteraction, focus, enablePan = true, enabled=true }: {
  controller: SceneCameraController; containerSize: SceneSize; sceneBounds?: { size: SceneSize; origin: SceneSize }; view: CameraView;
  projection: CameraProjection; onInteraction: () => void; focus?: { size: SceneSize; origin: SceneSize }; enablePan?: boolean; enabled?:boolean;
}) {
  const { size: viewport, get, set } = useThree();
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = controller.cameras[projection];
  useLayoutEffect(() => { const previous = get().camera; set({ camera }); return () => set({ camera: previous }); }, [camera, get, set]);
  useLayoutEffect(() => { if (controlsRef.current) controller.update({ containerSize, sceneBounds, viewport, view, projection, focus }, controlsRef.current); }, [controller, containerSize, sceneBounds, viewport, view, projection, focus]);
  return <OrbitControls enabled={enabled} ref={controlsRef} camera={camera} makeDefault enablePan={enablePan} enableDamping dampingFactor={.08} minZoom={.45} maxZoom={4} onStart={onInteraction}/>;
}
