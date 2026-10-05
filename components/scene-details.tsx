"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Billboard, Line, Edges } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { palletParts } from "../lib/packing/floor-pallets";
import type { PlacedPallet } from "../lib/packing/types";

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
  return <instancedMesh ref={ref} args={[undefined,undefined,parts.length]} onClick={e=>{if(onSelect&&e.instanceId!==undefined){e.stopPropagation();onSelect(parts[e.instanceId].pallet);}}}><boxGeometry/><meshStandardMaterial roughness={.92}/></instancedMesh>;
}

function MetricLabel({text,position,size=.09,color="#376272",screenOffset=[0,0]}:{text:string;position:[number,number,number];size?:number;color?:string;screenOffset?:[number,number]}){
  const ref=useRef<THREE.Group>(null);
  const label=useMemo(()=>{const c=document.createElement("canvas"),ctx=c.getContext("2d")!;ctx.font="600 40px Arial,sans-serif";c.width=Math.ceil(ctx.measureText(text).width+24);c.height=64;ctx.font="600 40px Arial,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="rgba(247,251,251,.95)";ctx.fillRect(0,0,c.width,64);ctx.fillStyle=color;ctx.fillText(text,c.width/2,33);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return {texture,ratio:c.width/c.height};},[text,color]);
  useEffect(()=>()=>label.texture.dispose(),[label]);
  const target=useMemo(()=>new THREE.Vector3(...position),[position]);
  useFrame(state=>{if(ref.current){const units=state.viewport.getCurrentViewport(state.camera,target).height/state.size.height;const px=size<.08?18:size>.1?25:22;ref.current.scale.setScalar(units*px);ref.current.position.set(screenOffset[0]*units,screenOffset[1]*units,0);}});
  return <Billboard position={position}><group ref={ref}><mesh><planeGeometry args={[label.ratio,1]}/><meshBasicMaterial map={label.texture} transparent depthWrite={false} toneMapped={false}/></mesh></group></Billboard>;
}

function RulerAxis({axis,scale,compact}:{axis:{name:string;total:number;start:THREE.Vector3;dir:THREE.Vector3;tick:THREE.Vector3;label:THREE.Vector3};scale:number;compact:boolean}){
  const ref=useRef<THREE.Group>(null),cameraDirection=useMemo(()=>new THREE.Vector3(),[]);
  useFrame(state=>{state.camera.getWorldDirection(cameraDirection);if(ref.current)ref.current.visible=Math.abs(cameraDirection.dot(axis.dir))<.985;});
  const a=axis,step=a.total>8000?2000:a.total>3500?1000:500;
  const ticks=Array.from({length:Math.floor(a.total/step)+1},(_,i)=>i*step).filter(n=>a.total-n>step*.7);ticks.push(a.total);
  const end=a.start.clone().addScaledVector(a.dir,a.total*scale);
  return <group ref={ref}><Line points={[a.start,end]} color="#6b95a4" lineWidth={1}/>{(compact?[]:ticks).map(n=>{const pos=a.start.clone().addScaledVector(a.dir,n*scale);return <group key={n}><Line points={[pos,pos.clone().add(a.tick)]} color="#6b95a4" lineWidth={1}/><MetricLabel text={String(Math.round(n))} position={pos.clone().add(a.label).toArray() as [number,number,number]} size={.055}/></group>;})}<MetricLabel text={compact?`${a.name.split("/")[1].trim()} ${Math.round(a.total)} mm`:`${a.name} · ${Math.round(a.total)} mm`} position={(a.name.startsWith("Z")?end:a.start.clone().lerp(end,.5)).clone().add(a.label).toArray() as [number,number,number]} size={.085} screenOffset={a.name.startsWith("Z")?[35,compact?14:-23]:[0,compact&&a.name.startsWith("Y")?-44:-25]}/></group>;
}

/** Real spatial rulers, expressed in mm, with adaptive spacing for large vehicles. */
export function SceneRulers({length,width,height,scale,offset}:{length:number;width:number;height:number;scale:number;offset:THREE.Vector3}) {
  const {size}=useThree();
  const axes=useMemo(()=>[
    {name:"X / L",total:length,start:new THREE.Vector3(offset.x,-.025,offset.z-.18),dir:new THREE.Vector3(1,0,0),tick:new THREE.Vector3(0,0,-.035),label:new THREE.Vector3(0,0,-.09)},
    {name:"Y / W",total:width,start:new THREE.Vector3(offset.x-.18,-.025,offset.z),dir:new THREE.Vector3(0,0,1),tick:new THREE.Vector3(-.035,0,0),label:new THREE.Vector3(-.10,0,0)},
    {name:"Z / H",total:height,start:new THREE.Vector3(offset.x-.18,offset.y,offset.z-.18),dir:new THREE.Vector3(0,1,0),tick:new THREE.Vector3(-.035,0,0),label:new THREE.Vector3(-.14,0,0)},
  ],[length,width,height,offset]);
  return <group>{axes.map(a=><RulerAxis key={a.name} axis={a} scale={scale} compact={size.width<500}/>)}</group>;
}

export function SelectedBoxDimensions({box,scale,offset}:{box:{x:number;y:number;z:number;dx:number;dy:number;dz:number;sku:string};scale:number;offset:THREE.Vector3}){
  const x=(box.x+box.dx/2)*scale+offset.x,y=(box.z+box.dz)*scale+offset.y,z=(box.y+box.dy/2)*scale+offset.z;
  const halfX=box.dx*scale/2,halfZ=box.dy*scale/2,bottom=y-box.dz*scale;
  return <group><mesh position={[x,(bottom+y)/2,z]}><boxGeometry args={[box.dx*scale,box.dz*scale,box.dy*scale]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/><Edges color="#da8c2e"/></mesh><Line points={[[x-halfX,y+.03,z+halfZ+.04],[x+halfX,y+.03,z+halfZ+.04]]} color="#da8c2e" lineWidth={2}/><MetricLabel text={`${box.dx} mm`} position={[x,y+.09,z+halfZ+.06]} size={.09}/><Line points={[[x+halfX+.04,y+.03,z-halfZ],[x+halfX+.04,y+.03,z+halfZ]]} color="#da8c2e" lineWidth={2}/><MetricLabel text={`${box.dy} mm`} position={[x+halfX+.12,y+.05,z]} size={.09}/><Line points={[[x+halfX+.04,bottom,z+halfZ+.04],[x+halfX+.04,y,z+halfZ+.04]]} color="#da8c2e" lineWidth={2}/><MetricLabel text={`${box.dz} mm`} position={[x+halfX+.16,(bottom+y)/2,z+halfZ+.06]} size={.09}/></group>;
}
