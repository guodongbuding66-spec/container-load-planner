"use client";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import { createTransportParts, TRANSPORT_COLORS, transportOpacity, type TransportDisplayMode, type TransportPart } from "../lib/packing/transport-model";
import type { ContainerSpec } from "../lib/packing/types";

function PartInstances({ parts, scale, transparency }: { parts: TransportPart[]; scale: number; transparency: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const role = parts[0].role, wheel = parts[0].shape === "wheel";
  const opacity = transportOpacity(transparency);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const object = new THREE.Object3D();
    parts.forEach((p, i) => {
      object.position.fromArray(p.position).multiplyScalar(scale);
      if (wheel) { object.rotation.set(Math.PI / 2, 0, 0); object.scale.set(p.size[0] * scale, p.size[2] * scale, p.size[1] * scale); }
      else { object.rotation.set(0, 0, 0); object.scale.fromArray(p.size).multiplyScalar(scale); }
      object.updateMatrix(); ref.current!.setMatrixAt(i, object.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [parts, scale, wheel]);
  // The hull cannot intercept clicks on cargo, even at full opacity.
  return <instancedMesh ref={ref} args={[undefined, undefined, parts.length]} visible={opacity > 0} raycast={() => {}} renderOrder={10}>
    {wheel ? <cylinderGeometry args={[.5, .5, 1, 12]}/> : <boxGeometry/>}
    <meshStandardMaterial color={TRANSPORT_COLORS[role]} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} roughness={role === "glass" ? .2 : .8} metalness={role === "body" || role === "frame" ? .18 : 0}/>
  </instancedMesh>;
}

/** Shared by setup, the space library, the main loading view and fullscreen. */
export function TransportModel({ space, scale, mode, transparency }: { space: ContainerSpec; scale: number; mode: TransportDisplayMode; transparency: number }) {
  const groups = useMemo(() => {
    const map = new Map<string, TransportPart[]>();
    for (const part of createTransportParts(space)) { const key = `${part.shape}-${part.role}`; map.set(key, [...(map.get(key) ?? []), part]); }
    return [...map.entries()];
  }, [space]);
  return <group>
    {mode === "model" && groups.map(([key, parts]) => <PartInstances key={key} parts={parts} scale={scale} transparency={transparency}/>)}
    <mesh position={[0, space.height * scale / 2, 0]} raycast={() => {}}>
      <boxGeometry args={[space.length * scale, space.height * scale, space.width * scale]}/><meshBasicMaterial visible={false}/>
      <Edges color={mode === "wireframe" ? "#4e7380" : "#7193a0"} transparent opacity={mode === "wireframe" ? 1 : .35}/>
    </mesh>
  </group>;
}
