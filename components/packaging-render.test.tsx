import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {expect,it,vi} from "vitest";
import {PalletStructures} from "./scene-details";
import {DEFAULT_PACKAGING,placedPackagingParts} from "../lib/packing/packaging";
import type {PlacedPallet} from "../lib/packing/types";
it("mounts the physical enclosure, saved material and opacity and resolves a picked component to its complete unit",async()=>{
  extend({Group:THREE.Group,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,MeshStandardMaterial:THREE.MeshStandardMaterial});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const canvas={style:{}} as HTMLCanvasElement,gl={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer;
  const root=createRoot(canvas);await root.configure({gl,frameloop:"never",size:{width:600,height:400,top:0,left:0}});
  const pallet:PlacedPallet={id:"unit",presetId:"custom",name:"Crate",x:250,y:100,z:0,dx:800,dy:1000,dz:100,orientation:"WLH",weight:40,maxLoad:500,enclosureHeight:550,packaging:{...DEFAULT_PACKAGING,material:"steel",color:"#4488aa",enclosure:"panel",wallThickness:50,opacity:.35}};
  const picked=vi.fn(),parts=placedPackagingParts(pallet);
  try{
    await act(async()=>root.render(<PalletStructures pallets={[pallet]} scale={.001} offset={new THREE.Vector3()} onSelect={picked}/>));
    const mesh=_roots.get(canvas)!.store.getState().scene.getObjectByName("packaging-structure") as THREE.InstancedMesh;
    expect(mesh.count).toBe(parts.length);const material=mesh.material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBe(.35);expect(material.transparent).toBe(true);expect(material.depthWrite).toBe(false);expect(material.metalness).toBe(.75);
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),size=new THREE.Vector3();
    const i=parts.findIndex(p=>p.kind==="lid");mesh.getMatrixAt(i,matrix);matrix.decompose(position,new THREE.Quaternion(),size);
    expect(position.y/.001+size.y/.002).toBeCloseTo(550,3);
    const handler=mesh as unknown as {__r3f:{handlers:{onClick:(e:unknown)=>void}}};
    handler.__r3f.handlers.onClick({delta:0,instanceId:i,stopPropagation(){}});expect(picked).toHaveBeenCalledWith(pallet);
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);vi.unstubAllGlobals();}
});
it("renders the attached support at its physical position after a half turn",async()=>{
  extend({Group:THREE.Group,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,MeshStandardMaterial:THREE.MeshStandardMaterial});vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const canvas={style:{}} as HTMLCanvasElement,gl={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);await root.configure({gl,frameloop:"never",size:{width:600,height:400,top:0,left:0}});
  const pallet:PlacedPallet={id:"unit",presetId:"custom",name:"Support",x:250,y:100,z:0,dx:1000,dy:800,dz:100,orientation:"LWH",quarterTurns:2,weight:15,maxLoad:500,packaging:{...DEFAULT_PACKAGING,base:"solid",material:"steel",deckSupports:[{id:"s",name:"S",x:100,y:50,dx:200,dy:100,dz:50,weightKg:10,maxLoadKg:100,source:"QA",revision:"43"}]}};
  try{
    await act(async()=>root.render(<PalletStructures pallets={[pallet]} scale={.001} offset={new THREE.Vector3()}/>));const mesh=_roots.get(canvas)!.store.getState().scene.getObjectByName("packaging-structure") as THREE.InstancedMesh;expect(mesh.count).toBe(2);
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),size=new THREE.Vector3();mesh.getMatrixAt(1,matrix);matrix.decompose(position,new THREE.Quaternion(),size);expect(position.x).toBeCloseTo(1.05);expect(position.y).toBeCloseTo(.125);expect(position.z).toBeCloseTo(.8);expect(size.x).toBeCloseTo(.2);expect(size.y).toBeCloseTo(.05);expect(size.z).toBeCloseTo(.1);
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);vi.unstubAllGlobals();}
});
