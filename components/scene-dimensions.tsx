"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createSceneLabelMaterial, LABEL_RENDER_ORDER, sceneLabelFrame, sceneLabelPose } from "../lib/packing/scene-labels";
import { cameraDimensionProjector, paintDimensions, projectDimensions, type DimensionAnnotation, type DimensionBounds, type DimensionColors, type DimensionStyle, type DimensionUnit } from "../lib/packing/scene-dimensions";

/** Screen-size engineering marks, attached to projected object edges and included in PNG export. */
export function SceneDimensions({bounds,values,unit,fontSize,style="dimensions",lineColor,textColor}:{bounds:DimensionBounds;values:{L:number;W:number;H:number};unit:DimensionUnit;fontSize:number;style?:DimensionStyle}&DimensionColors) {
  const mesh=useRef<THREE.Mesh>(null);
  const layer=useMemo(()=>{const canvas=document.createElement("canvas"),texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;const material=createSceneLabelMaterial(texture);material.forceSinglePass=true;return {canvas,texture,material};},[]);
  const layerRef=useRef(layer);
  const previous=useRef<{key:string;dimensions:DimensionAnnotation[]}>({key:"",dimensions:[]});
  useEffect(()=>()=>{layer.texture.dispose();layer.material.dispose();},[layer]);
  useFrame(state=>{
    if(!mesh.current||state.size.width<40||state.size.height<40)return;
    const drawingLayer=layerRef.current;
    const camera=state.camera,viewport=state.size;camera.updateMatrixWorld(true);
    const occupied=sceneLabelFrame(camera,state.clock.elapsedTime);
    const ratio=Math.min(2,state.gl.getPixelRatio());
    const key=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements,viewport.width,viewport.height,ratio,...bounds.min,...bounds.max,values.L,values.W,values.H,unit,fontSize,style,lineColor,textColor,...occupied.flatMap(r=>[r.x,r.y,r.width,r.height])].join("|");
    if(previous.current.key!==key){
      const previousEdges=Object.fromEntries(previous.current.dimensions.map(d=>[d.axis,d.edgeId]));
      const dimensions=projectDimensions(bounds,values,cameraDimensionProjector(camera,viewport),viewport,{unit,fontSize,style,occupied,bottomInset:30,previousEdges});
      const canvas=drawingLayer.canvas,width=Math.max(1,Math.round(viewport.width*ratio)),height=Math.max(1,Math.round(viewport.height*ratio));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      const ctx=canvas.getContext("2d")!;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,viewport.width,viewport.height);paintDimensions(ctx,dimensions,fontSize,{lineColor,textColor});
      drawingLayer.texture.needsUpdate=true;previous.current={key,dimensions};
    }
    occupied.push(...previous.current.dimensions.map(d=>d.label));
    const anchor=camera.getWorldPosition(new THREE.Vector3()).addScaledVector(camera.getWorldDirection(new THREE.Vector3()),Math.max((camera as THREE.PerspectiveCamera).near*2,1));
    const pose=sceneLabelPose(camera,anchor,viewport,{x:0,y:0,width:viewport.width,height:viewport.height},viewport.height);
    mesh.current.position.copy(pose.position);mesh.current.quaternion.copy(camera.quaternion);mesh.current.scale.set(pose.scale*viewport.width/viewport.height/2,pose.scale/2,1);
  });
  return <mesh name="scene-dimensions" ref={mesh} material={layer.material} renderOrder={LABEL_RENDER_ORDER+1} frustumCulled={false} raycast={()=>{}}><planeGeometry args={[2,2]}/></mesh>;
}
