import { act, useLayoutEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createRoot, extend, _roots } from "@react-three/fiber";
import { ContainerModel } from "./container-scene";
import { TransportAppearanceProvider, useTransportAppearance } from "./transport-appearance";
import { updateViewPreferences } from "./view-preferences";
import { DEFAULT_VIEW_PREFERENCES } from "../lib/packing/view-preferences";
import { LoadingSceneFallback, topViewFootprints } from "./loading-scene-fallback";
import { ModelPreviewFallback } from "./model-preview-fallback";
import { pack } from "../lib/packing/engine";
import { CONTAINER_PRESETS } from "../lib/packing/presets";
import type { PlacedBox } from "../lib/packing/types";
import { SceneCameraController } from "../lib/packing/scene-camera";
import { OrbitControls } from "three-stdlib";
import { cameraDimensionProjector, projectDimensions, sceneMeasurement } from "../lib/packing/scene-dimensions";
import { DimensionSvg } from "./dimension-svg";
import { EMPTY_SECTION, inspectBoxes } from "../lib/packing/inspection";
import { inspectionPallets, isolatedBounds, selectedBounds } from "../lib/packing/scene-view-scope";
import { palletAnchors } from "../lib/packing/floor-pallets";

const result=pack({mode:"mixed",strategy:"practical",container:CONTAINER_PRESETS[0],clearance:20,products:[{id:"shed",sku:"SHED-101",name:"shed",length:2200,width:620,height:180,weight:20,quantity:6,color:"#98b9de",priority:1,rotationPolicy:"upright",stackable:true,maxStackLayers:10}]});
afterEach(()=>{vi.unstubAllGlobals();updateViewPreferences(DEFAULT_VIEW_PREFERENCES);});

describe("actual scene graph dimensions and selected-carton regression",()=>{
  it("removes every dimension when off, keeps selection, and never duplicates the selected SKU badge",async()=>{
    extend({Group:THREE.Group,Mesh:THREE.Mesh,InstancedMesh:THREE.InstancedMesh,BoxGeometry:THREE.BoxGeometry,PlaneGeometry:THREE.PlaneGeometry,MeshBasicMaterial:THREE.MeshBasicMaterial,MeshStandardMaterial:THREE.MeshStandardMaterial,GridHelper:THREE.GridHelper});
    const painted:string[]=[],fonts:string[]=[],draws:{text:string;x:number;y:number;color:string}[]=[],strokes:string[]=[];
    const context={font:"",fillStyle:"",strokeStyle:"",fillRect(){},strokeRect(){},measureText(s:string){return {width:s.length*20};},fillText(s:string,x:number,y:number){painted.push(s);fonts.push(this.font);draws.push({text:s,x,y,color:this.fillStyle});},strokeText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){strokes.push(this.strokeStyle);},setTransform(){},clearRect(){}};
    vi.stubGlobal("document",{createElement:()=>({width:1,height:1,getContext:()=>context})});
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
    const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer;
    const root=createRoot(canvas),rig=new SceneCameraController(),camera=rig.cameras.perspective,controls=new OrbitControls(camera);
    rig.update({containerSize:[5.6,2.3,2.3],viewport:{width:920,height:420},view:"perspective",projection:"perspective"},controls);
    await root.configure({gl:renderer,camera,frameloop:"never",size:{width:920,height:420,top:0,left:0}});
    let appearance!:ReturnType<typeof useTransportAppearance>,select!:(box:PlacedBox|null)=>void,selectedId:string|undefined;
    function Scene(){
      appearance=useTransportAppearance();const [selected,setSelected]=useState<PlacedBox|null>(result.placements[0]);
      selectedId=selected?.id;
      useLayoutEffect(()=>{select=setSelected;},[]);
      return <ContainerModel result={result} visibleProducts={new Set(["shed"])} visibleCount={result.placements.length} reducedRendering modelMode="wireframe" transparency={65} labels={appearance.labels} selected={selected} onSelect={setSelected}/>;
    }
    const store=_roots.get(canvas)!.store;
    const names=()=>{const list:string[]=[];store.getState().scene.traverse(o=>{if(o.name)list.push(o.name);});return list;};
    const frame=()=>{const state=store.getState();state.clock.elapsedTime+=1;for(const s of state.internal.subscribers)s.ref.current(state,1/60);};
    try{
      await act(async()=>{root.render(<TransportAppearanceProvider><Scene/></TransportAppearanceProvider>);});
      expect(names().filter(n=>n==="scene-dimensions")).toHaveLength(1);
      expect(names().filter(n=>n==="scene-label:SHED-101")).toHaveLength(0);
      await act(async()=>appearance.setSkuSummaries(true));
      expect(names().filter(n=>n==="scene-label:SHED-101")).toHaveLength(1);
      expect(names()).toContain("selection-outline");
      frame();expect(painted).toContain("L 2200 mm");expect(painted).toContain("W 620 mm");expect(painted).toContain("H 180 mm");
      const hud=store.getState().scene.getObjectByName("scene-dimensions") as THREE.Mesh;
      expect((hud.material as THREE.Material).depthTest).toBe(false);expect(hud.renderOrder).toBeGreaterThan(10000);
      const shader={vertexShader:"#include <project_vertex>"};
      (hud.material as THREE.MeshBasicMaterial).onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms,renderer);
      expect(shader.vertexShader).toBe("gl_Position = vec4(position.xy, 0.0, 1.0);");
      expect(hud.frustumCulled).toBe(false);
      expect(hud.geometry.getAttribute("position").count).toBe(4);
      // Fiber forwards click events after an OrbitControls drag. A different
      // instance under the pointer must not replace the measured carton.
      const click=store.getState().scene.getObjectsByProperty("isInstancedMesh",true)[0] as THREE.InstancedMesh&{__r3f:{handlers:{onClick:(e:{delta:number;instanceId:number;stopPropagation:()=>void})=>void}}};
      const stop=vi.fn();
      await act(async()=>click.__r3f.handlers.onClick({delta:80,instanceId:1,stopPropagation:stop}));
      expect(selectedId).toBe(result.placements[0].id);expect(stop).not.toHaveBeenCalled();
      await act(async()=>click.__r3f.handlers.onClick({delta:1,instanceId:1,stopPropagation:stop}));
      expect(selectedId).toBe(result.placements[1].id);expect(stop).toHaveBeenCalledOnce();
      await act(async()=>{select(result.placements[0]);appearance.setDimensionStyle("dimensions");appearance.setDimensionLineColor("#ff6600");appearance.setDimensionTextColor("#5522aa");});
      // Check the actual mounted HUD's final screen mapping after repeated camera
      // rotation, zoom, projection switches and fullscreen/narrow viewport sizes.
      for(const projection of ["perspective","orthographic"] as const)for(const viewport of [{width:920,height:420},{width:320,height:245},{width:1363,height:936}]){
        const activeCamera=rig.cameras[projection],orbit=new OrbitControls(activeCamera);
        rig.update({containerSize:[5.6,2.3,2.3],viewport,view:"perspective",projection},orbit);
        store.setState({camera:activeCamera,size:{...viewport,left:0,top:0}});
        const target=new THREE.Vector3(0,1.15,0),distance=activeCamera.position.distanceTo(target);
        for(let yaw=0.25;yaw<Math.PI*2;yaw+=.35){
          activeCamera.position.copy(target).add(new THREE.Vector3(Math.sin(yaw),.4,Math.cos(yaw)).normalize().multiplyScalar(distance));activeCamera.lookAt(target);activeCamera.zoom=1.15;activeCamera.updateProjectionMatrix();
          draws.length=0;strokes.length=0;frame();store.getState().scene.updateMatrixWorld(true);
          const measures=draws.filter(d=>/\bmm$/.test(d.text));
          expect(measures.filter(d=>d.color==="#825515").map(d=>d.text).sort()).toEqual(["L 2200 mm","W 620 mm","H 180 mm"].sort());
          expect(measures.filter(d=>d.color==="#5522aa").map(d=>d.text)).toContain(`L ${result.container.length} mm`);
          expect(strokes).toContain("#ff6600");expect(strokes).toContain("#b57925");
          for(const d of measures){
            const projected=new THREE.Vector3(d.x/viewport.width*2-1,1-d.y/viewport.height*2,0);
            expect((projected.x+1)*viewport.width/2).toBeCloseTo(d.x,5);expect((1-projected.y)*viewport.height/2).toBeCloseTo(d.y,5);
          }
        }
        orbit.dispose();
      }
      await act(async()=>appearance.setDimensions(false));
      expect(names()).not.toContain("scene-dimensions");expect(names()).toContain("selection-outline");
      painted.length=0;frame();expect(painted.some(s=>/\b(mm|cm|m)$/.test(s))).toBe(false);
      await act(async()=>appearance.setLabels(false));
      expect(names().filter(n=>n.startsWith("scene-label:"))).toHaveLength(1);
      await act(async()=>appearance.setSkuSummaries(false));
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
  it("isolates one carton or the complete loaded crate, including its lid and linked SKUs",()=>{
    const pallet = {id:"crate-1",presetId:"crate",name:"Crate 1",x:0,y:0,z:655,dx:1060,dy:1560,dz:25,weight:25,maxLoad:1000,orientation:"LWH" as const,enclosureHeight:655};
    const first = {...result.placements[0],id:"first",x:30,y:30,z:680,dx:1000,dy:500,dz:300,palletIds:[pallet.id]};
    const second = {...first,id:"second",productId:"other",sku:"OTHER",y:530};
    const loose = {...first,id:"loose",x:2000,palletIds:[]};
    const plan = {...result,pallets:[pallet],placements:[first,second,loose]};
    const visible = new Set([first.productId]);
    const onlyCarton = {...EMPTY_SECTION,isolation:"carton" as const,target:first.id};
    const onlyPallet = {...EMPTY_SECTION,isolation:"pallet" as const,target:pallet.id};
    expect(selectedBounds(plan,palletAnchors([pallet])[0])).toMatchObject({z:655,dx:1060,dy:1560,dz:655});
    const draw = (section:typeof onlyCarton|typeof onlyPallet) => renderToStaticMarkup(<TransportAppearanceProvider><LoadingSceneFallback result={plan} visibleProducts={visible} visibleCount={3} selected={null} onSelect={()=>{}} section={section}/></TransportAppearanceProvider>);
    const carton = draw(onlyCarton);
    expect(carton).toContain('aria-label="SHED-101 first"');
    expect(carton).not.toContain('aria-label="托盘 crate-1"');
    expect(carton).not.toContain('aria-label="OTHER second"');
    const crate = draw(onlyPallet);
    expect(crate).toContain('aria-label="托盘 crate-1"');
    expect(crate).toContain('aria-label="OTHER second"');
    expect(crate).not.toContain('aria-label="SHED-101 loose"');
    const cartons = inspectBoxes(plan,visible,3,onlyPallet);
    expect(isolatedBounds(plan,onlyPallet,cartons,inspectionPallets(plan,3,onlyPallet,cartons))).toMatchObject({dz:655});
  });
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
    expect(main).toContain(`L ${result.container.length} mm`);
    expect(main).toContain('fill="#825515"');
    expect(main).toContain(">SHED-101<");
    for(const props of [{space:result.container},{}]){
      const html=renderToStaticMarkup(<TransportAppearanceProvider><ModelPreviewFallback {...props} mode="model" transparency={65}/></TransportAppearanceProvider>);
      expect(html).toContain('data-dimension-count="3"');expect(html).toContain('stroke="#467ee6"');expect(html).toContain('paint-order="stroke"');
      expect(html).not.toContain("model-fallback-labels");
    }
  });
  it("renders custom line/text colours and the identical tick labels in SVG",()=>{
    const viewport={width:920,height:420},rig=new SceneCameraController(),controls=new OrbitControls(rig.cameras.perspective),measurement=sceneMeasurement(result.container,20);
    rig.update({containerSize:[5.6,2.3,2.3],viewport,view:"perspective",projection:"perspective"},controls);
    const dimensions=projectDimensions(measurement.bounds,measurement.values,cameraDimensionProjector(rig.cameras.perspective,viewport),viewport,{style:"ruler",unit:"cm"});
    const html=renderToStaticMarkup(<svg><DimensionSvg dimensions={dimensions} fontSize={18} lineColor="#ff6600" textColor="#5522aa"/></svg>);
    expect(html).toContain('stroke="#ff6600"');expect(html).toContain('fill="#5522aa"');expect(html).not.toContain('stroke="#467ee6"');
    expect(html.match(/data-ruler-tick="true"/g)).toHaveLength(dimensions.flatMap(d=>d.ticks).length);
    controls.dispose();
  });
});
