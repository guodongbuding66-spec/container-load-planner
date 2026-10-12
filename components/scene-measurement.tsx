"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Measurement, Point3 } from "../lib/packing/inspection";
import { formatMeasure } from "../lib/packing/inspection";
import { MetricLabel } from "./scene-details";
import { useTransportAppearance } from "./transport-appearance";
export function SceneMeasurement({measurement,scale,offset}:{measurement:Measurement;scale:number;offset:THREE.Vector3}){
  const a=useTransportAppearance();
  const world=(p:Point3)=>new THREE.Vector3(p[0]*scale+offset.x,p[2]*scale+offset.y,p[1]*scale+offset.z);
  const start=world(measurement.a),end=world(measurement.b),middle=start.clone().add(end).multiplyScalar(.5);
  const geometry=useMemo(()=>new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(measurement.a[0]*scale+offset.x,measurement.a[2]*scale+offset.y,measurement.a[1]*scale+offset.z),new THREE.Vector3(measurement.b[0]*scale+offset.x,measurement.b[2]*scale+offset.y,measurement.b[1]*scale+offset.z)]),[measurement,scale,offset]);
  const line=useMemo(()=>{const l=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:a.dimensionLineColor,depthTest:false,depthWrite:false}));l.renderOrder=10002;l.frustumCulled=false;l.raycast=()=>{};return l;},[geometry,a.dimensionLineColor]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  useEffect(()=>()=>line.material.dispose(),[line]);
  return <group name="scene-measurement"><primitive object={line}/>{[start,end].map((p,i)=><mesh key={i} position={p} renderOrder={10002} raycast={()=>{}}><sphereGeometry args={[.022,12,8]}/><meshBasicMaterial color={a.dimensionLineColor} depthTest={false} depthWrite={false}/></mesh>)}<MetricLabel text={formatMeasure(measurement.distance,a.dimensionUnit,a.measurePrecision)} position={middle.toArray() as Point3} color={a.dimensionTextColor} size={.09} screenOffset={[0,20]}/></group>;
}
