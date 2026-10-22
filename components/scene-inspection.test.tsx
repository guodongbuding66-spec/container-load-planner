import { act, useLayoutEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createRoot, extend, _roots } from "@react-three/fiber";
import * as THREE from "three";
import { ContainerModel } from "./container-scene";
import { TransportAppearanceProvider, useTransportAppearance } from "./transport-appearance";
import { useSceneInspection, type SceneInspection } from "./use-scene-inspection";
import { updateViewPreferences } from "./view-preferences";
import { DEFAULT_VIEW_PREFERENCES } from "../lib/packing/view-preferences";
import { EMPTY_SECTION } from "../lib/packing/inspection";
import { pack } from "../lib/packing/engine";
import { CONTAINER_PRESETS } from "../lib/packing/presets";
import type { PackingResult } from "../lib/packing/types";
afterEach(()=>{vi.unstubAllGlobals();updateViewPreferences(DEFAULT_VIEW_PREFERENCES);});
it("mounts clipped geometry and real measurement overlays, preserves the plan, locks picks and clears obsolete measures",async()=>{
  const result=pack({mode:"mixed",strategy:"practical",container:CONTAINER_PRESETS[0],clearance:20,products:[{id:"p",sku:"TEST",name:"test",length:600,width:400,height:200,quantity:4,weight:10,color:"#4488aa",priority:1,rotationPolicy:"upright",stackable:true,maxStackLayers:10}]});
  const original=JSON.stringify(result),box=result.placements[0];
  const storage=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
  extend({Group:THREE.Group,Mesh:THREE.Mesh,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,PlaneGeometry:THREE.PlaneGeometry,SphereGeometry:THREE.SphereGeometry,MeshBasicMaterial:THREE.MeshBasicMaterial,MeshStandardMaterial:THREE.MeshStandardMaterial,GridHelper:THREE.GridHelper});
  const context={font:"",fillStyle:"",strokeStyle:"",fillRect(){},strokeRect(){},measureText(s:string){return {width:s.length*20};},fillText(){},strokeText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},setTransform(){},clearRect(){}};
  vi.stubGlobal("document",{createElement:()=>({width:1,height:1,getContext:()=>context})});vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  updateViewPreferences(DEFAULT_VIEW_PREFERENCES);
  const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,localClippingEnabled:true,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer;
  const root=createRoot(canvas);await root.configure({gl:renderer,frameloop:"never",size:{width:920,height:420,top:0,left:0}});
  let inspection!:SceneInspection,appearance!:ReturnType<typeof useTransportAppearance>,setPlan!:(r:PackingResult)=>void;
  function Scene(){
    const [plan,changePlan]=useState(result);appearance=useTransportAppearance();inspection=useSceneInspection(plan,new Set(["p"]),plan.placements.length);
    useLayoutEffect(()=>{setPlan=changePlan;},[]);
    return <ContainerModel result={plan} visibleProducts={new Set(["p"])} visibleCount={plan.placements.length} reducedRendering modelMode="wireframe" transparency={65} labels={false} selected={null} onSelect={inspection.pick} section={inspection.value.section} manualMeasurement={inspection.measurement} manualMeasurements={inspection.savedOverlays}/>;
  }
  const store=_roots.get(canvas)!.store,scene=()=>store.getState().scene;
  try{
    await act(async()=>root.render(<TransportAppearanceProvider><Scene/></TransportAppearanceProvider>));
    await act(async()=>inspection.update({section:{...EMPTY_SECTION,axis:"z",percent:2}}));
    const mesh=scene().getObjectsByProperty("isInstancedMesh",true)[0] as THREE.InstancedMesh,matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
    const position=new THREE.Vector3(),scale=new THREE.Vector3();matrix.decompose(position,new THREE.Quaternion(),scale);
    const unit=5.6/Math.max(result.container.length-40,result.container.width-40,result.container.height-20);
    // Instanced matrices are uploaded as Float32; compare within 0.0001 mm.
    expect(scale.y/unit).toBeCloseTo(result.container.height*.02,4);
    const material=(mesh.material as THREE.Material[])[0];expect(material.clippingPlanes).toHaveLength(1);
    const hud=scene().getObjectByName("scene-dimensions") as THREE.Mesh;expect((hud.material as THREE.Material).clippingPlanes).toBeNull();
    expect(JSON.stringify(result)).toBe(original);
    await act(async()=>{inspection.update({section:{...EMPTY_SECTION}});inspection.setMode("points");});
    const pickMesh=scene().getObjectsByProperty("isInstancedMesh",true)[0] as THREE.InstancedMesh&{__r3f:{handlers:{onClick:(event:{delta:number;instanceId:number;point:THREE.Vector3;stopPropagation:()=>void})=>void}}};
    const firstPoint=new THREE.Vector3((box.x-(result.container.length-40)/2)*unit,box.z*unit,(box.y-(result.container.width-40)/2)*unit);
    const lastPoint=firstPoint.clone().add(new THREE.Vector3(box.dx*unit,box.dz*unit,box.dy*unit));
    await act(async()=>pickMesh.__r3f.handlers.onClick({delta:60,instanceId:0,point:firstPoint,stopPropagation:()=>{}}));expect(inspection.value.points).toHaveLength(0);
    await act(async()=>pickMesh.__r3f.handlers.onClick({delta:1,instanceId:0,point:firstPoint,stopPropagation:()=>{}}));
    await act(async()=>pickMesh.__r3f.handlers.onClick({delta:1,instanceId:0,point:lastPoint,stopPropagation:()=>{}}));
    expect(inspection.measurement!.distance).toBeCloseTo(Math.hypot(box.dx,box.dy,box.dz),10);
    const overlay=scene().getObjectByName("scene-measurement")!,line=overlay.getObjectByProperty("isLine",true) as THREE.Line;
    const positions=line.geometry.getAttribute("position");
    expect(new THREE.Vector3().fromBufferAttribute(positions,0).distanceTo(new THREE.Vector3().fromBufferAttribute(positions,1))/unit).toBeCloseTo(inspection.measurement!.distance,3);
    expect((line.material as THREE.Material).depthTest).toBe(false);
    const locked=inspection.measurement;
    await act(async()=>inspection.update({locked:true}));await act(async()=>inspection.pick(result.placements[1],[0,0,0]));expect(inspection.measurement).toEqual(locked);
    await act(async()=>inspection.update({section:{...EMPTY_SECTION,isolation:"set",target:""}}));expect(inspection.displayBoxes).toHaveLength(0);expect(inspection.measurement).toBeNull();expect(inspection.pickedCount).toBe(0);
    await act(async()=>inspection.update({section:{...EMPTY_SECTION}}));expect(inspection.measurement).toEqual(locked);
    await act(async()=>appearance.setDimensions(false));expect(scene().getObjectByName("scene-measurement")).toBeUndefined();expect(scene().getObjectByName("scene-dimensions")).toBeUndefined();
    await act(async()=>appearance.setDimensions(true));expect(scene().getObjectByName("scene-measurement")).toBeDefined();
    await act(async()=>{expect(inspection.saveMeasurement("Diagonal")).toBe(true);});expect(inspection.saved.items).toHaveLength(1);expect(inspection.savedOverlays).toHaveLength(1);expect(scene().getObjectByName("scene-measurement")).toBeDefined();
    await act(async()=>appearance.setDimensions(false));expect(scene().getObjectByName("scene-measurement")).toBeUndefined();await act(async()=>appearance.setDimensions(true));
    await act(async()=>setPlan({...result,placements:result.placements.map(b=>({...b,x:b.x+1}))}));expect(inspection.measurement).toBeNull();expect(inspection.value.mode).toBe("off");
    expect(inspection.saved.items).toHaveLength(1);expect(inspection.savedOverlays).toHaveLength(0);expect(scene().getObjectByName("scene-measurement")).toBeUndefined();
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);}
});
