import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, _roots, extend } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import { ContainerModel } from "./container-scene";
import { LoadingSceneFallback } from "./loading-scene-fallback";
import { TransportAppearanceProvider } from "./transport-appearance";
import { updateViewPreferences } from "./view-preferences";
import { DEFAULT_VIEW_PREFERENCES } from "../lib/packing/view-preferences";
import { EMPTY_SECTION } from "../lib/packing/inspection";
import { pack } from "../lib/packing/engine";
import type { ProductInput } from "../lib/packing/types";
const p:ProductInput={id:"shape",sku:"SHAPE",name:"shape",length:600,width:400,height:300,quantity:1,weight:10,priority:50,rotationPolicy:"fixed",stackable:false,maxStackLayers:0,color:"#339988",cargoShape:"wedge"};
const plan=pack({mode:"mixed",strategy:"maximum",container:{id:"c",name:"c",length:1200,width:800,height:600,doorWidth:800,doorHeight:600,maxWeight:1000},products:[p],clearance:0});
afterEach(()=>{vi.unstubAllGlobals();updateViewPreferences(DEFAULT_VIEW_PREFERENCES);});
it("mounts real wedge geometry and clips it without squeezing its source shape",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  extend({Group:THREE.Group,Mesh:THREE.Mesh,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,PlaneGeometry:THREE.PlaneGeometry,MeshStandardMaterial:THREE.MeshStandardMaterial,MeshBasicMaterial:THREE.MeshBasicMaterial,GridHelper:THREE.GridHelper});
  updateViewPreferences({...DEFAULT_VIEW_PREFERENCES,dimensions:false,labels:false});
  const canvas={style:{}} as HTMLCanvasElement,gl={domElement:canvas,localClippingEnabled:true,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer;
  const root=createRoot(canvas);await root.configure({gl,frameloop:"never",size:{width:920,height:420,top:0,left:0}});
  try{
    await act(async()=>root.render(<TransportAppearanceProvider><ContainerModel result={plan} visibleProducts={new Set([p.id])} visibleCount={1} reducedRendering modelMode="wireframe" transparency={65} labels={false} selected={null} onSelect={()=>{}} section={{...EMPTY_SECTION,axis:"z",percent:10}}/></TransportAppearanceProvider>));
    const scene=_roots.get(canvas)!.store.getState().scene,mesh=scene.getObjectsByProperty("isInstancedMesh",true).find(m=>(m as THREE.Mesh).geometry.name==="cargo-shape:wedge") as THREE.InstancedMesh;
    expect(mesh).toBeDefined();
    const positions=mesh.geometry.getAttribute("position");
    const topX=Array.from({length:positions.count},(_,i)=>i).filter(i=>positions.getY(i)>.49).map(i=>positions.getX(i));
    expect(topX.length).toBeGreaterThan(0);expect(topX.every(x=>Math.abs(x+.5)<1e-6)).toBe(true);
    const matrix=new THREE.Matrix4(),scale=new THREE.Vector3();mesh.getMatrixAt(0,matrix);matrix.decompose(new THREE.Vector3(),new THREE.Quaternion(),scale);
    expect(scale.y/(5.6/1200)).toBeCloseTo(300,4);
    expect((mesh.material as THREE.Material[])[0].clippingPlanes).toHaveLength(1);
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);}
});
it("keeps fallback envelopes but draws an actual cylinder silhouette and preserves picking",()=>{
  const cylinder=pack({mode:"mixed",strategy:"maximum",container:plan.container,clearance:0,products:[{...p,cargoShape:"cylinder"}]});
  const html=renderToStaticMarkup(<TransportAppearanceProvider><LoadingSceneFallback result={cylinder} visibleProducts={new Set([p.id])} visibleCount={1} selected={null} onSelect={()=>{}}/></TransportAppearanceProvider>);
  expect(html).toContain('data-cargo-shape="cylinder"');expect(html).toContain('<polygon');expect(html).toContain('clip-path="url(');expect(html).toContain('role="button"');
});
