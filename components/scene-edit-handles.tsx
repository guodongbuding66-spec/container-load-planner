"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Html, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { selectionBounds } from "../lib/packing/plan-edit";
import type { PlacedBox } from "../lib/packing/types";
import type { PlanEditor } from "./use-plan-editor";
export function SceneEditHandles({editor,boxes,scale,offset,onDragging}:{editor:PlanEditor;boxes:PlacedBox[];scale:number;offset:THREE.Vector3;onDragging:(v:boolean)=>void}){
  const {gl,camera,size}=useThree(),anchor=useMemo(()=>new THREE.Object3D(),[]),start=useRef<THREE.Vector3|null>(null),bounds=useMemo(()=>selectionBounds(editor.selected),[editor.selected]);
  const anchorObject=useMemo(()=>({current:anchor}),[anchor]);
  const [rect,setRect]=useState<{x:number;y:number;w:number;h:number}|null>(null);
  useEffect(()=>{if(bounds)anchor.position.set((bounds.x+bounds.dx/2)*scale+offset.x,(bounds.z+bounds.dz/2)*scale+offset.y,(bounds.y+bounds.dy/2)*scale+offset.z);},[anchor,bounds,scale,offset]);
  useEffect(()=>{
    if(!editor.rectangle)return;
    const canvas=gl.domElement;let begin:{x:number;y:number;add:boolean}|null=null;
    const down=(e:PointerEvent)=>{if(e.button!==0)return;const r=canvas.getBoundingClientRect();begin={x:e.clientX-r.left,y:e.clientY-r.top,add:e.shiftKey};canvas.setPointerCapture(e.pointerId);};
    const move=(e:PointerEvent)=>{if(!begin)return;const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;setRect({x:Math.min(x,begin.x),y:Math.min(y,begin.y),w:Math.abs(x-begin.x),h:Math.abs(y-begin.y)});};
    const up=(e:PointerEvent)=>{if(!begin)return;const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,loX=Math.min(x,begin.x),hiX=Math.max(x,begin.x),loY=Math.min(y,begin.y),hiY=Math.max(y,begin.y);
      const ids=boxes.filter(b=>{const p=new THREE.Vector3((b.x+b.dx/2)*scale+offset.x,(b.z+b.dz/2)*scale+offset.y,(b.y+b.dy/2)*scale+offset.z).project(camera),px=(p.x+1)*size.width/2,py=(1-p.y)*size.height/2;return p.z>=-1&&p.z<=1&&px>=loX&&px<=hiX&&py>=loY&&py<=hiY;}).map(b=>b.id);
      editor.selectMany(ids,begin.add);begin=null;setRect(null);};
    const cancel=()=>{begin=null;setRect(null);};canvas.addEventListener("pointerdown",down);canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerup",up);canvas.addEventListener("pointercancel",cancel);
    return ()=>{canvas.removeEventListener("pointerdown",down);canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerup",up);canvas.removeEventListener("pointercancel",cancel);};
  },[editor,boxes,gl,camera,size,scale,offset]);
  return <><primitive object={anchor}/>{rect&&<Html fullscreen style={{pointerEvents:"none"}}><div className="scene-marquee" style={{left:rect.x,top:rect.y,width:rect.w,height:rect.h}}/></Html>}{bounds&&!editor.rectangle&&<TransformControls object={anchorObject} mode="translate" size={.8} translationSnap={editor.grid>0?editor.grid*scale:undefined} onMouseDown={()=>{start.current=anchor.position.clone();onDragging(true);}} onMouseUp={()=>{const p=start.current;onDragging(false);if(p){const d=anchor.position.clone().sub(p);editor.move({x:d.x/scale,y:d.z/scale,z:d.y/scale});anchor.position.copy(p);}start.current=null;}}/>}</>;
}
