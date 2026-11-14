"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Edges } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cargoSurfaceLabelGeometry, createCargoLabelMaterial } from "../lib/packing/cargo-surface-labels";
import { placedPackagingParts, DEFAULT_PACKAGING, type PackagingPart } from "../lib/packing/packaging";
import type { PlacedPallet } from "../lib/packing/types";
import { createSceneLabelMaterial, LABEL_RENDER_ORDER, layoutSceneLabel, sceneLabelFrame, sceneLabelPose } from "../lib/packing/scene-labels";
import { MARK_ASPECT, markLines, type ShippingMark } from "../lib/packing/shipping-mark";

export function useShippingMarkCanvas(mark: ShippingMark | undefined, sku: string) {
  const [decoded, setDecoded] = useState<{ src: string; image: HTMLImageElement }>();
  const source = mark?.image;
  useEffect(() => {
    if (!source) return;
    const image = new Image();
    let active = true;
    image.src = source;
    void image.decode().then(() => { if (active) setDecoded({ src: source, image }); }).catch(() => {});
    return () => { active = false; };
  }, [source]);
  return useMemo(() => {
    const image = source && decoded?.src === source ? decoded.image : undefined;
    if (!mark?.text && !image) return;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = canvas.width / MARK_ASPECT;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fffffa";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const lines = markLines(mark?.text ?? (image ? "" : sku));
    const imageHeight = lines.length ? 112 : 224;
    if (image) {
      const scale = Math.min(480 / image.naturalWidth, imageHeight / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      ctx.drawImage(image, (512 - width) / 2, 16 + (imageHeight - height) / 2, width, height);
    }
    if (lines.length) {
      const top = image ? 136 : 16;
      const lineHeight = Math.min(54, (240 - top) / lines.length);
      ctx.fillStyle = "#18323a";
      ctx.font = `700 ${Math.floor(lineHeight * .76)}px Arial, 'Noto Sans SC', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const first = top + (240 - top - lines.length * lineHeight) / 2 + lineHeight / 2;
      lines.forEach((line, index) => ctx.fillText(line, 256, first + index * lineHeight, 480));
    }
    return canvas;
  }, [mark?.text, source, decoded, sku]);
}

/** Each face gets a canvas matching its physical aspect, so text never stretches. */
export function boxFaceTexture(sku: string, color: string, width: number, height: number, up?: string, mark?: HTMLCanvasElement) {
  const ratio = width / height, longest = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(ratio >= 1 ? longest : longest * ratio));
  canvas.height = Math.max(8, Math.round(ratio >= 1 ? longest / ratio : longest));
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = color; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = "rgba(13,43,50,.28)"; ctx.lineWidth = Math.max(1,Math.min(w,h)*.022); ctx.strokeRect(0,0,w,h);
  if (mark) {
    const scale = Math.min(w * .9 / mark.width, h * .82 / mark.height);
    const dw = mark.width * scale, dh = mark.height * scale;
    ctx.drawImage(mark, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
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

type StructurePart=PackagingPart&{pallet:PlacedPallet};
function PackagingInstances({parts,scale,offset,onSelect}:{parts:StructurePart[];scale:number;offset:THREE.Vector3;onSelect?:(p:PlacedPallet)=>void}) {
  const ref=useRef<THREE.InstancedMesh>(null),spec=parts[0].pallet.packaging??DEFAULT_PACKAGING;
  const grain=useMemo(()=>{if(spec.material!=="wood"&&spec.material!=="plywood")return null;const data=new Uint8Array(128*32*4);for(let y=0;y<32;y++)for(let x=0;x<128;x++){const c=220+Math.round(20*Math.sin(y*2.8+Math.sin(x*.13)*.3)+12*Math.sin(x*12.9+y*7.7));const i=(y*128+x)*4;data[i]=data[i+1]=data[i+2]=c;data[i+3]=255;}const t=new THREE.DataTexture(data,128,32);t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;},[spec.material]);
  useEffect(()=>()=>grain?.dispose(),[grain]);
  useLayoutEffect(()=>{if(!ref.current)return;const dummy=new THREE.Object3D();parts.forEach((p,i)=>{dummy.position.set((p.x+p.dx/2)*scale+offset.x,(p.z+p.dz/2)*scale+offset.y,(p.y+p.dy/2)*scale+offset.z);dummy.scale.set(p.dx*scale,p.dz*scale,p.dy*scale);dummy.updateMatrix();ref.current!.setMatrixAt(i,dummy.matrix);const color=new THREE.Color(p.pallet.packaging?.color??(p.pallet.dz<50?"#98a4ae":p.kind==="block"?"#ac8151":"#d4af7b"));if(p.kind==="block")color.multiplyScalar(.88);ref.current!.setColorAt(i,color);});ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;ref.current.computeBoundingSphere();},[parts,scale,offset]);
  // Historic decks remain opaque; custom shells use the explicitly saved opacity.
  const opacity=parts[0].pallet.packaging?spec.opacity:1;
  return <instancedMesh name="packaging-structure" ref={ref} args={[undefined,undefined,parts.length]} raycast={onSelect?THREE.InstancedMesh.prototype.raycast:()=>{}} onClick={e=>{if(e.delta>3)return;if(onSelect&&e.instanceId!==undefined){e.stopPropagation();onSelect(parts[e.instanceId].pallet);}}}><boxGeometry/><meshStandardMaterial map={grain} roughness={spec.material==="steel"?.4:spec.material==="plastic"?.65:.92} metalness={spec.material==="steel"?.75:0} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1}/></instancedMesh>;
}
export function PalletStructures({pallets,scale,offset,onSelect}:{pallets:PlacedPallet[];scale:number;offset:THREE.Vector3;onSelect?:(p:PlacedPallet)=>void}) {
  const groups=useMemo(()=>{const map=new Map<string,StructurePart[]>();for(const p of pallets){const spec=p.packaging,key=spec?JSON.stringify([spec.material,spec.opacity]):"legacy";const parts=map.get(key)??[];parts.push(...placedPackagingParts(p).map(part=>({...part,pallet:p})));map.set(key,parts);}return [...map.entries()];},[pallets]);
  return <>{groups.map(([key,parts])=><PackagingInstances key={key} parts={parts} scale={scale} offset={offset} onSelect={onSelect}/>)}</>;
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

/** Physical stickers share the cargo instance matrices and clipping scope. */
export function CargoSurfaceLabels({sku,source,dimensions,count,instanceRef,mark}:{sku:string;source:THREE.BufferGeometry;dimensions:[number,number,number];count:number;instanceRef:RefObject<THREE.InstancedMesh|null>;mark?:HTMLCanvasElement}){
  const label=useMemo(()=>{
    if(mark){const texture=new THREE.CanvasTexture(mark);texture.colorSpace=THREE.SRGBColorSpace;return {texture,ratio:mark.width/mark.height};}
    const c=document.createElement('canvas'),ctx=c.getContext('2d')!;
    ctx.font='600 40px Arial,sans-serif';c.width=Math.ceil(ctx.measureText(sku).width+24);c.height=64;
    ctx.font='600 40px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fffffa';ctx.fillRect(0,0,c.width,64);ctx.fillStyle='#18323a';ctx.fillText(sku,c.width/2,33);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return {texture,ratio:c.width/c.height};
  },[sku,mark]);
  const material=useMemo(()=>createCargoLabelMaterial(label.texture),[label]),geometry=useMemo(()=>cargoSurfaceLabelGeometry(source,dimensions,label.ratio),[source,dimensions,label.ratio]);
  useEffect(()=>()=>{geometry.dispose();},[geometry]);
  useEffect(()=>()=>{material.dispose();label.texture.dispose();},[material,label]);
  if(!geometry.getAttribute('position')?.count)return null;
  return <instancedMesh name={`cargo-surface-labels:${sku}`} ref={instanceRef} args={[geometry,material,count]} renderOrder={1} frustumCulled={false} raycast={()=>{}}/>;
}

/** Selection is separate from measurements; the Dimensions switch never clears selection. */
export function SelectionOutline({box,scale,offset}:{box:{x:number;y:number;z:number;dx:number;dy:number;dz:number};scale:number;offset:THREE.Vector3}) {
  return <mesh name="selection-outline" position={[(box.x+box.dx/2)*scale+offset.x,(box.z+box.dz/2)*scale+offset.y,(box.y+box.dy/2)*scale+offset.z]} raycast={()=>{}}><boxGeometry args={[box.dx*scale,box.dz*scale,box.dy*scale]}/><meshBasicMaterial visible={false}/><Edges color="#da8c2e" depthTest={false} depthWrite={false} renderOrder={LABEL_RENDER_ORDER-1}/></mesh>;
}
