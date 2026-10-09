"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Edges } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { palletParts } from "../lib/packing/floor-pallets";
import type { PlacedPallet } from "../lib/packing/types";
import { createSceneLabelMaterial, LABEL_RENDER_ORDER, layoutSceneLabel, sceneLabelFrame, sceneLabelPose } from "../lib/packing/scene-labels";

/** Each face gets a canvas matching its physical aspect, so text never stretches. */
export function boxFaceTexture(sku: string, color: string, width: number, height: number, up?: string) {
  const ratio = width / height, longest = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(ratio >= 1 ? longest : longest * ratio));
  canvas.height = Math.max(8, Math.round(ratio >= 1 ? longest / ratio : longest));
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = color; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = "rgba(13,43,50,.28)"; ctx.lineWidth = Math.max(1,Math.min(w,h)*.022); ctx.strokeRect(0,0,w,h);
  const maxWidth=w*.88, maxHeight=h*.65;
  let font=Math.min(h*.3, w*.16), lines:string[]=[];
  for (;font>2;font-=1) {
    ctx.font=`700 ${font}px Arial, 'Noto Sans SC', sans-serif`;
    lines=[];let line="";
    for(const char of sku){if(ctx.measureText(line+char).width>maxWidth&&line){lines.push(line);line="";}line+=char;}if(line)lines.push(line);
    if(lines.length*font*1.2<=maxHeight&&lines.length<=(ratio>3?1:3))break;
  }
  const arrow=up&&ratio<5&&h>60, labelHeight=lines.length*font*1.2+(arrow?font*.85:0);
  const panelWidth=Math.min(w*.94,Math.max(...lines.map(l=>ctx.measureText(l).width),font*2)+font*.7);
  ctx.fillStyle="rgba(255,255,250,.94)";ctx.fillRect((w-panelWidth)/2,(h-labelHeight)/2-font*.22,panelWidth,labelHeight+font*.44);
  ctx.fillStyle="#18323a";ctx.textAlign="center";ctx.textBaseline="middle";
  lines.forEach((line,i)=>ctx.fillText(line,w/2,(h-labelHeight)/2+font*.6+i*font*1.2));
  if(arrow){ctx.font=`700 ${font*.65}px Arial,sans-serif`;ctx.fillText(`↑ ↑  ${up}`,w/2,(h+labelHeight)/2-font*.3);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

export function PalletStructures({ pallets, scale, offset, onSelect }: {pallets:PlacedPallet[];scale:number;offset:THREE.Vector3;onSelect?:(p:PlacedPallet)=>void}) {
  const ref=useRef<THREE.InstancedMesh>(null);
  const parts=useMemo(()=>pallets.flatMap(p=>palletParts(p.dx,p.dy,p.dz).map(part=>({...part,x:part.x+p.x,y:part.y+p.y,z:part.z+p.z,flat:p.dz<50,pallet:p}))),[pallets]);
  useLayoutEffect(()=>{if(!ref.current)return;const dummy=new THREE.Object3D();parts.forEach((p,i)=>{dummy.position.set((p.x+p.dx/2)*scale+offset.x,(p.z+p.dz/2)*scale+offset.y,(p.y+p.dy/2)*scale+offset.z);dummy.scale.set(p.dx*scale*.997,p.dz*scale*.995,p.dy*scale*.997);dummy.updateMatrix();ref.current!.setMatrixAt(i,dummy.matrix);ref.current!.setColorAt(i,new THREE.Color(p.flat?"#98a4ae":p.kind==="block"?"#ac8151":"#d4af7b"));});ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;ref.current.computeBoundingSphere();},[parts,scale,offset]);
  if(!parts.length)return null;
  return <instancedMesh ref={ref} args={[undefined,undefined,parts.length]} onClick={e=>{if(e.delta>3)return;if(onSelect&&e.instanceId!==undefined){e.stopPropagation();onSelect(parts[e.instanceId].pallet);}}}><boxGeometry/><meshStandardMaterial roughness={.92}/></instancedMesh>;
}

export function MetricLabel({text,position,size=.09,color="#376272",screenOffset=[0,0]}:{text:string;position:[number,number,number];size?:number;color?:string;screenOffset?:[number,number]}){
  const ref=useRef<THREE.Group>(null);
  const label=useMemo(()=>{const c=document.createElement("canvas"),ctx=c.getContext("2d")!;ctx.font="600 40px Arial,sans-serif";c.width=Math.ceil(ctx.measureText(text).width+24);c.height=64;ctx.font="600 40px Arial,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="rgba(247,251,251,.95)";ctx.fillRect(0,0,c.width,64);ctx.fillStyle=color;ctx.fillText(text,c.width/2,33);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return {texture,ratio:c.width/c.height};},[text,color]);
  const material=useMemo(()=>createSceneLabelMaterial(label.texture),[label]);
  useEffect(()=>()=>{label.texture.dispose();material.dispose();},[label,material]);
  const target=useMemo(()=>new THREE.Vector3(...position),[position]);
  useFrame(state=>{if(!ref.current||!state.size.width||!state.size.height)return;const px=size<.08?18:size>.1?25:22;const anchor=target.clone();ref.current.parent?.localToWorld(anchor);const p=anchor.clone().project(state.camera);const occupied=sceneLabelFrame(state.camera,state.clock.elapsedTime);const rect=layoutSceneLabel({x:(p.x+1)*state.size.width/2+screenOffset[0]-label.ratio*px/2,y:(1-p.y)*state.size.height/2-screenOffset[1]-px/2,width:label.ratio*px,height:px},state.size,occupied);occupied.push(rect);const pose=sceneLabelPose(state.camera,anchor,state.size,rect,px);ref.current.position.copy(ref.current.parent?.worldToLocal(pose.position)??pose.position);ref.current.quaternion.copy(state.camera.quaternion);ref.current.scale.set(pose.scale*Math.min(1,rect.width/(label.ratio*px)),pose.scale,pose.scale);});
  return <group name={`scene-label:${text}`} ref={ref}><mesh material={material} renderOrder={LABEL_RENDER_ORDER} frustumCulled={false} raycast={()=>{}}><planeGeometry args={[label.ratio,1]}/></mesh></group>;
}

/** Selection is separate from measurements; the Dimensions switch never clears selection. */
export function SelectionOutline({box,scale,offset}:{box:{x:number;y:number;z:number;dx:number;dy:number;dz:number};scale:number;offset:THREE.Vector3}) {
  return <mesh name="selection-outline" position={[(box.x+box.dx/2)*scale+offset.x,(box.z+box.dz/2)*scale+offset.y,(box.y+box.dy/2)*scale+offset.z]} raycast={()=>{}}><boxGeometry args={[box.dx*scale,box.dz*scale,box.dy*scale]}/><meshBasicMaterial visible={false}/><Edges color="#da8c2e" depthTest={false} depthWrite={false} renderOrder={LABEL_RENDER_ORDER-1}/></mesh>;
}
