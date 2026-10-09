import { act, useLayoutEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createRoot, extend, _roots } from "@react-three/fiber";
import { ContainerModel } from "./container-scene";
import { TransportAppearanceProvider, useTransportAppearance } from "./transport-appearance";
import { LoadingSceneFallback, topViewFootprints } from "./loading-scene-fallback";
import { ModelPreviewFallback } from "./model-preview-fallback";
import { pack } from "../lib/packing/engine";
import { CONTAINER_PRESETS } from "../lib/packing/presets";
import type { PlacedBox } from "../lib/packing/types";
import { SceneCameraController } from "../lib/packing/scene-camera";
import { OrbitControls } from "three-stdlib";

const result=pack({mode:"mixed",strategy:"practical",container:CONTAINER_PRESETS[0],clearance:20,products:[{id:"shed",sku:"SHED-101",name:"shed",length:2200,width:620,height:180,weight:20,quantity:6,color:"#98b9de",priority:1,rotationPolicy:"upright",stackable:true,maxStackLayers:10}]});
afterEach(()=>vi.unstubAllGlobals());

describe("actual scene graph dimensions and selected-carton regression",()=>{
  it("removes every dimension when off, keeps selection, and never duplicates the selected SKU badge",async()=>{
    extend({Group:THREE.Group,Mesh:THREE.Mesh,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,PlaneGeometry:THREE.PlaneGeometry,MeshBasicMaterial:THREE.MeshBasicMaterial,MeshStandardMaterial:THREE.MeshStandardMaterial,GridHelper:THREE.GridHelper});
    const painted:string[]=[],fonts:string[]=[];
    const context={font:"",fillStyle:"",strokeStyle:"",fillRect(){},strokeRect(){},measureText(s:string){return {width:s.length*20};},fillText(s:string){painted.push(s);fonts.push(this.font);},strokeText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},setTransform(){},clearRect(){}};
    vi.stubGlobal("document",{createElement:()=>({width:1,height:1,getContext:()=>context})});
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
    const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer;
    const root=createRoot(canvas),rig=new SceneCameraController(),camera=rig.cameras.perspective,controls=new OrbitControls(camera);
    rig.update({containerSize:[5.6,2.3,2.3],viewport:{width:920,height:420},view:"perspective",projection:"perspective"},controls);
    await root.configure({gl:renderer,camera,frameloop:"never",size:{width:920,height:420,top:0,left:0}});
    let appearance!:ReturnType<typeof useTransportAppearance>,select!:(box:PlacedBox|null)=>void;
    function Scene(){
      appearance=useTransportAppearance();const [selected,setSelected]=useState<PlacedBox|null>(result.placements[0]);
      useLayoutEffect(()=>{select=setSelected;},[]);
      return <ContainerModel result={result} visibleProducts={new Set(["shed"])} visibleCount={result.placements.length} reducedRendering modelMode="wireframe" transparency={65} labels={appearance.labels} selected={selected} onSelect={setSelected}/>;
    }
    const store=_roots.get(canvas)!.store;
    const names=()=>{const list:string[]=[];store.getState().scene.traverse(o=>{if(o.name)list.push(o.name);});return list;};
    const frame=()=>{const state=store.getState();state.clock.elapsedTime+=1;for(const s of state.internal.subscribers)s.ref.current(state,1/60);};
    try{
      await act(async()=>{root.render(<TransportAppearanceProvider><Scene/></TransportAppearanceProvider>);});
      expect(names().filter(n=>n==="scene-dimensions")).toHaveLength(1);
      expect(names().filter(n=>n==="scene-label:SHED-101")).toHaveLength(1);
      expect(names()).toContain("selection-outline");
      frame();expect(painted).toContain("L 2200 mm");expect(painted).toContain("W 620 mm");expect(painted).toContain("H 180 mm");
      const hud=store.getState().scene.getObjectByName("scene-dimensions") as THREE.Mesh;
      expect((hud.material as THREE.Material).depthTest).toBe(false);expect(hud.renderOrder).toBeGreaterThan(10000);
      await act(async()=>appearance.setDimensions(false));
      expect(names()).not.toContain("scene-dimensions");expect(names()).toContain("selection-outline");
      painted.length=0;frame();expect(painted.some(s=>/\b(mm|cm|m)$/.test(s))).toBe(false);
      await act(async()=>appearance.setLabels(false));
      expect(names().filter(n=>n.startsWith("scene-label:"))).toEqual([]);expect(names()).toContain("selection-outline");
      const cargo:THREE.InstancedMesh[]=[];store.getState().scene.traverse(o=>{if(o instanceof THREE.InstancedMesh)cargo.push(o);});
      expect(cargo.length).toBeGreaterThan(0);expect(cargo.flatMap(o=>o.material).every(m=>!(m as THREE.MeshStandardMaterial).map)).toBe(true);
      await act(async()=>{appearance.setDimensions(true);appearance.setDimensionUnit("cm");appearance.setDimensionFontSize(26);});
      frame();expect(painted).toContain("L 220 cm");expect(painted).toContain("H 18 cm");expect(fonts).toContain("600 26px Arial, sans-serif");
      await act(async()=>select(null));painted.length=0;frame();
      expect(names()).not.toContain("selection-outline");expect(painted).toContain(`L ${result.container.length/10} cm`);
      await act(async()=>{appearance.setDimensions(false);select(result.placements[1]);});
      expect(names()).not.toContain("scene-dimensions");expect(names()).toContain("selection-outline");
    }finally{
      await act(async()=>root.unmount());controls.dispose();_roots.delete(canvas);
    }
  });
});

describe("real-coordinate SVG fallback",()=>{
  it("retains footprints beyond the old 500-carton limit, picks the highest stack and respects visibility",()=>{
    const prototype=result.placements[0];
    const placements=Array.from({length:700},(_,i)=>({...prototype,id:`box-${i}`,productId:i===699?"late":"shed",x:i*10,y:0,z:0,dx:10,dy:10,dz:10}));
    const full=topViewFootprints(placements,new Set(["shed","late"]),700);
    expect(full).toHaveLength(700);expect(full.map(b=>b.id)).toContain("box-699");
    expect(topViewFootprints(placements,new Set(["late"]),700)).toHaveLength(1);
    expect(topViewFootprints(placements,new Set(["late"]),600)).toHaveLength(0);
    const stack=[{...prototype,id:"top",z:100},{...prototype,id:"bottom",z:0}];
    expect(topViewFootprints(stack,new Set(["shed"]),2).map(b=>b.id)).toEqual(["top"]);
  });
  it("renders the same unboxed edge dimensions in main, space and pallet previews",()=>{
    const main=renderToStaticMarkup(<TransportAppearanceProvider><LoadingSceneFallback result={result} visibleProducts={new Set(["shed"])} visibleCount={result.placements.length} selected={result.placements[0]} onSelect={()=>{}}/></TransportAppearanceProvider>);
    expect(main).toContain('data-dimension-count="2"');expect(main).toContain("L 2200 mm");expect(main).toContain("W 620 mm");expect(main).not.toContain("H 180 mm");
    expect(main.match(/>SHED-101</g)).toHaveLength(1);
    for(const props of [{space:result.container},{}]){
      const html=renderToStaticMarkup(<TransportAppearanceProvider><ModelPreviewFallback {...props} mode="model" transparency={65}/></TransportAppearanceProvider>);
      expect(html).toContain('data-dimension-count="3"');expect(html).toContain('stroke="#467ee6"');expect(html).toContain('paint-order="stroke"');
      expect(html).not.toContain("model-fallback-labels");
    }
  });
});
