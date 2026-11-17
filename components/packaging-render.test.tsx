import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {expect,it,vi} from "vitest";
import {PalletStructures} from "./scene-details";
import {DEFAULT_PACKAGING,placedPackagingParts} from "../lib/packing/packaging";
import type {PlacedPallet} from "../lib/packing/types";
function packagingMeshes(scene:THREE.Scene){
  const meshes:THREE.InstancedMesh[]=[];
  scene.traverse(node=>{if(node instanceof THREE.InstancedMesh&&node.name==="packaging-structure")meshes.push(node);});
  return meshes;
}
function dimensions(mesh:THREE.InstancedMesh){
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
}
it("mounts the physical enclosure, saved material and opacity and resolves a picked component to its complete unit",async()=>{
  extend({Group:THREE.Group,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,MeshStandardMaterial:THREE.MeshStandardMaterial});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const canvas={style:{}} as HTMLCanvasElement,gl={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer;
  const root=createRoot(canvas);await root.configure({gl,frameloop:"never",size:{width:600,height:400,top:0,left:0}});
  const pallet:PlacedPallet={id:"unit",presetId:"custom",name:"Crate",x:250,y:100,z:0,dx:800,dy:1000,dz:100,orientation:"WLH",weight:40,maxLoad:500,enclosureHeight:550,packaging:{...DEFAULT_PACKAGING,material:"steel",color:"#4488aa",enclosure:"panel",wallThickness:50,opacity:.35}};
  const picked=vi.fn(),parts=placedPackagingParts(pallet);
  try{
    await act(async()=>root.render(<PalletStructures pallets={[pallet]} scale={.001} offset={new THREE.Vector3()} onSelect={picked}/>));
    const meshes=packagingMeshes(_roots.get(canvas)!.store.getState().scene);
    expect(meshes.reduce((n,mesh)=>n+mesh.count,0)).toBe(parts.length);
    const lid=parts.find(p=>p.kind==="lid")!;
    const mesh=meshes.find(m=>dimensions(m).toArray().every((value,axis)=>Math.abs(value-[lid.dx,lid.dz,lid.dy][axis])<.001))!;
    expect(mesh).toBeDefined();
    const [material]=mesh.material as THREE.MeshStandardMaterial[];
    expect(material.opacity).toBe(.35);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.metalness).toBeGreaterThan(.5);
    expect(material.normalMap).not.toBeNull();
    expect(material.roughnessMap).not.toBeNull();
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),size=new THREE.Vector3();
    const i=0;
    mesh.getMatrixAt(i,matrix);
    matrix.decompose(position,new THREE.Quaternion(),size);
    expect((position.y+dimensions(mesh).y*size.y/2)/.001).toBeCloseTo(550,3);
    const handler=mesh as unknown as {__r3f:{handlers:{onClick:(e:unknown)=>void}}};
    handler.__r3f.handlers.onClick({delta:0,instanceId:i,stopPropagation(){}});expect(picked).toHaveBeenCalledWith(pallet);
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);vi.unstubAllGlobals();}
});
it("renders the attached support at its physical position after a half turn",async()=>{
  extend({Group:THREE.Group,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,MeshStandardMaterial:THREE.MeshStandardMaterial});vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const canvas={style:{}} as HTMLCanvasElement,gl={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);await root.configure({gl,frameloop:"never",size:{width:600,height:400,top:0,left:0}});
  const pallet:PlacedPallet={id:"unit",presetId:"custom",name:"Support",x:250,y:100,z:0,dx:1000,dy:800,dz:100,orientation:"LWH",quarterTurns:2,weight:15,maxLoad:500,packaging:{...DEFAULT_PACKAGING,base:"solid",material:"steel",deckSupports:[{id:"s",name:"S",x:100,y:50,dx:200,dy:100,dz:50,weightKg:10,maxLoadKg:100,source:"QA",revision:"43"}]}};
  try{
    await act(async()=>root.render(<PalletStructures pallets={[pallet]} scale={.001} offset={new THREE.Vector3()}/>));
    const meshes=packagingMeshes(_roots.get(canvas)!.store.getState().scene);
    expect(meshes.reduce((n,mesh)=>n+mesh.count,0)).toBe(2);
    const mesh=meshes.find(m=>Math.abs(dimensions(m).y-50)<.001)!;
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3();
    mesh.getMatrixAt(0,matrix);matrix.decompose(position,new THREE.Quaternion(),scale);
    const size=dimensions(mesh).multiply(scale);
    expect(position.x).toBeCloseTo(1.05);expect(position.y).toBeCloseTo(.125);expect(position.z).toBeCloseTo(.8);
    expect(size.x).toBeCloseTo(.2);expect(size.y).toBeCloseTo(.05);expect(size.z).toBeCloseTo(.1);
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);vi.unstubAllGlobals();}
});
