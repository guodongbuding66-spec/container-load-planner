"use client";
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { sectionLimits, type Section } from "../lib/packing/inspection";
import type { PackingResult } from "../lib/packing/types";
/** Scoped to physical geometry. Screen-facing text and measurement overlays never get clipped. */
export function SectionGeometry({result,section,scale,offset,children}:{result:PackingResult;section:Section;scale:number;offset:THREE.Vector3;children:ReactNode}){
  const ref=useRef<THREE.Group>(null);
  const planes=useMemo(()=>{
    if(section.axis==="off")return [];
    const {axis,threshold}=sectionLimits(result,section),worldAxis=[0,2,1][axis],normal=new THREE.Vector3();normal.setComponent(worldAxis,section.reverse?1:-1);
    return [new THREE.Plane(normal,(threshold*scale+offset.getComponent(worldAxis))*(section.reverse?-1:1))];
  },[result,section,scale,offset]);
  useLayoutEffect(()=>{
    const materials=new Map<THREE.Material,{planes:THREE.Plane[]|null;shadows:boolean}>();
    ref.current?.traverse(o=>{const m=(o as THREE.Mesh).material;for(const material of Array.isArray(m)?m:m?[m]:[]){if(materials.has(material))continue;materials.set(material,{planes:material.clippingPlanes,shadows:material.clipShadows});material.clippingPlanes=planes;material.clipShadows=true;material.needsUpdate=true;}});
    return()=>{materials.forEach((old,m)=>{m.clippingPlanes=old.planes;m.clipShadows=old.shadows;m.needsUpdate=true;});};
  });
  return <group ref={ref} name="section-geometry">{children}</group>;
}
