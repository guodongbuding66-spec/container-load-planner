"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import { createTransportParts, TRANSPORT_COLORS, transportOpacity, type TransportDisplayMode, type TransportPart } from "../lib/packing/transport-model";
import type { ContainerSpec } from "../lib/packing/types";
import { createPackagingFinish } from "../lib/packing/packaging-materials";

function PartInstances({ parts, scale, transparency, finish, reduced }: { parts: TransportPart[]; scale: number; transparency: number; finish?:THREE.MeshStandardMaterial; reduced:boolean }) {
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
    {wheel ? <cylinderGeometry args={[.5, .5, 1, reduced?10:24]}/> : <boxGeometry/>}
    <meshStandardMaterial color={TRANSPORT_COLORS[role]} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1}
      map={finish?.map} normalMap={finish?.normalMap} normalScale={[.28,.28]} roughnessMap={finish?.roughnessMap}
      roughness={role === "glass" ? .2 : .82} metalness={role === "body" || role === "frame" ? .26 : 0}/>
  </instancedMesh>;
}

/** Shared by setup, the space library, the main loading view and fullscreen. */
export function TransportModel({ space, scale, mode, transparency, reduced=false }: { space: ContainerSpec; scale: number; mode: TransportDisplayMode; transparency: number; reduced?:boolean }) {
  const groups = useMemo(() => {
    const map = new Map<string, TransportPart[]>();
    if(mode==="model")for (const part of createTransportParts(space,reduced)) {
      const key=`${part.shape}-${part.role}`, batch=map.get(key)??[];
      batch.push(part);
      map.set(key,batch);
    }
    return [...map.entries()];
  }, [space,reduced,mode]);
  const finishes=useMemo(()=>!reduced&&mode==="model"?{metal:createPackagingFinish("steel",1),floor:createPackagingFinish("plywood",1)}:null,[reduced,mode]);
  useEffect(()=>()=>{finishes?.metal.dispose();finishes?.floor.dispose();},[finishes]);
  return <group>
    {groups.map(([key, parts]) => {
      const role=parts[0].role;
      const finish=role==="floor"?finishes?.floor:role==="body"||role==="frame"||role==="cab"?finishes?.metal:undefined;
      return <PartInstances key={key} parts={parts} scale={scale} transparency={transparency} finish={finish?.materials[0]} reduced={reduced}/>;
    })}
    <mesh position={[0, space.height * scale / 2, 0]} raycast={() => {}}>
      <boxGeometry args={[space.length * scale, space.height * scale, space.width * scale]}/><meshBasicMaterial visible={false}/>
      <Edges color={mode === "wireframe" ? "#4e7380" : "#7193a0"} transparent opacity={mode === "wireframe" ? 1 : .35}/>
    </mesh>
  </group>;
}
