"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createSceneLabelMaterial, LABEL_RENDER_ORDER, sceneLabelFrame } from "../lib/packing/scene-labels";
import { cameraDimensionProjector, paintDimensions, projectDimensions, type DimensionAnnotation, type DimensionBounds, type DimensionColors, type DimensionStyle, type DimensionUnit } from "../lib/packing/scene-dimensions";

/** Screen-size engineering marks, attached to projected object edges and included in PNG export. */
const edgeIds = (marks:DimensionAnnotation[]) => Object.fromEntries(marks.map(mark=>[mark.axis,mark.edgeId]));

type DimensionTarget = { bounds: DimensionBounds; values: { L: number; W: number; H: number } };

export function SceneDimensions({bounds,values,container,unit,fontSize,style="dimensions",lineColor,textColor}:DimensionTarget&{container?:DimensionTarget;unit:DimensionUnit;fontSize:number;style?:DimensionStyle}&DimensionColors) {
  const mesh=useRef<THREE.Mesh>(null);
  const layer=useMemo(()=>{
    const canvas=document.createElement("canvas");
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.generateMipmaps=false;
    texture.minFilter=THREE.LinearFilter;
    const material=createSceneLabelMaterial(texture);
    material.side=THREE.FrontSide;
    // The annotation canvas already contains screen coordinates. Draw it directly in
    // clip space so camera swaps, clipping planes and orbit updates cannot hide it.
    material.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace("#include <project_vertex>","gl_Position = vec4(position.xy, 0.0, 1.0);");
    };
    return {canvas,texture,material};
  },[]);
  const layerRef=useRef(layer);
  const previous=useRef<{key:string;outer:DimensionAnnotation[];inner:DimensionAnnotation[]}>({key:"",outer:[],inner:[]});
  useEffect(()=>()=>{layer.texture.dispose();layer.material.dispose();},[layer]);
  useFrame(state=>{
    if(!mesh.current||state.size.width<40||state.size.height<40)return;
    const drawingLayer=layerRef.current;
    const camera=state.camera,viewport=state.size;camera.updateMatrixWorld(true);
    const occupied=sceneLabelFrame(camera,state.clock.elapsedTime);
    const ratio=Math.min(2,state.gl.getPixelRatio());
    const targetKey=[...bounds.min,...bounds.max,...Object.values(values),...(container?[...container.bounds.min,...container.bounds.max,...Object.values(container.values)]:[])].join("|");
    const key=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements,viewport.width,viewport.height,ratio,targetKey,unit,fontSize,style,lineColor,textColor,...occupied.flatMap(r=>[r.x,r.y,r.width,r.height].map(Math.round))].join("|");
    if(previous.current.key!==key){
      const project=cameraDimensionProjector(camera,viewport);
      const options={unit,fontSize,style,occupied,bottomInset:30};
      const outer=container?projectDimensions(container.bounds,container.values,project,viewport,{...options,previousEdges:edgeIds(previous.current.outer)}):[];
      const dimensions=projectDimensions(bounds,values,project,viewport,{...options,previousEdges:edgeIds(previous.current.inner),...(container?{style:"dimensions",occupied:[...occupied,...outer.flatMap(d=>[d.label,...d.ticks.map(t=>t.label)])]}:{})});
      const canvas=drawingLayer.canvas,width=Math.max(1,Math.round(viewport.width*ratio)),height=Math.max(1,Math.round(viewport.height*ratio));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      const ctx=canvas.getContext("2d")!;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,viewport.width,viewport.height);
      if(outer.length)paintDimensions(ctx,outer,fontSize,{lineColor,textColor});
      paintDimensions(ctx,dimensions,fontSize,container?{lineColor:"#b57925",textColor:"#825515"}:{lineColor,textColor});
      drawingLayer.texture.needsUpdate=true;previous.current={key,outer,inner:dimensions};
    }
    occupied.push(...[...previous.current.outer,...previous.current.inner].flatMap(d=>[d.label,...d.ticks.map(t=>t.label)]));
  });
  return <mesh name="scene-dimensions" ref={mesh} material={layer.material} renderOrder={LABEL_RENDER_ORDER+1} frustumCulled={false} raycast={()=>{}}><planeGeometry args={[2,2]}/></mesh>;
}
