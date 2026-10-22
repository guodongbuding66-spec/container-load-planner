import {act,useState} from "react";
import {afterEach,expect,it,vi} from "vitest";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {useSceneInspection,type SceneInspection} from "./use-scene-inspection";
import {TransportAppearanceProvider} from "./transport-appearance";
import {updateViewPreferences} from "./view-preferences";
import {DEFAULT_VIEW_PREFERENCES} from "../lib/packing/view-preferences";
import {EMPTY_SECTION} from "../lib/packing/inspection";
import {pack} from "../lib/packing/engine";
import {CONTAINER_PRESETS,SAMPLE_PRODUCTS} from "../lib/packing/presets";
import {regularSurfaceFeatures,regularSurfaceSpec} from "../lib/packing/surface-inspection";
import type {PackingResult} from "../lib/packing/types";
const plan=pack({mode:"mixed",strategy:"practical",products:[{...SAMPLE_PRODUCTS[0],id:"u",sku:"U-PROFILE",quantity:1,length:1000,width:100,height:1000,cargoShape:"u-profile",rotationPolicy:"fixed"}],container:CONTAINER_PRESETS[2],clearance:10}),box=plan.placements[0],vertices=regularSurfaceFeatures(box,regularSurfaceSpec(box,plan.cargoDetails?.u)!,"vertex");
afterEach(()=>{vi.unstubAllGlobals();updateViewPreferences(DEFAULT_VIEW_PREFERENCES);});
async function mounted(run:(get:()=>SceneInspection,setPlan:(p:PackingResult)=>void)=>Promise<void>){
  const storage=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});updateViewPreferences(DEFAULT_VIEW_PREFERENCES);
  const canvas={style:{}} as HTMLCanvasElement,gl={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer;
  const root=createRoot(canvas);await root.configure({gl,frameloop:"never",size:{width:100,height:100,top:0,left:0}});let value!:SceneInspection,set!:(p:PackingResult)=>void;
  function Hook(){const [p,change]=useState(plan);set=change;value=useSceneInspection(p,new Set(["u"]),p.placements.length);return <group/>;}
  try{await act(async()=>root.render(<TransportAppearanceProvider><Hook/></TransportAppearanceProvider>));await run(()=>value,p=>set(p));}finally{await act(async()=>root.unmount());_roots.delete(canvas);}
}
it("mounts real solid point picks, saves parameters and invalidates moved cargo overlays",async()=>{await mounted(async(get,setPlan)=>{
  await act(async()=>get().setMode("points"));await act(async()=>get().setBasis("surface"));await act(async()=>get().pick(box,vertices[3]));await act(async()=>get().pick(box,vertices[6]));expect(get().measurement).toMatchObject({distance:500,basis:"surface"});await act(async()=>{expect(get().saveMeasurement("Slot")).toBe(true);});expect(get().saved.items[0].surface).toHaveLength(2);expect(get().savedOverlays[0]).toMatchObject({distance:500,basis:"surface"});await act(async()=>setPlan({...plan,placements:plan.placements.map(b=>({...b,x:b.x+1}))}));expect(get().saved.items).toHaveLength(1);expect(get().savedOverlays).toHaveLength(0);
});});
it("basis changes clear mixed picks and artificial section surfaces cannot be picked",async()=>{await mounted(async get=>{await act(async()=>get().setMode("points"));await act(async()=>get().pick(box,[box.x,box.y,box.z]));expect(get().pickedCount).toBe(1);await act(async()=>get().setBasis("surface"));expect(get().pickedCount).toBe(0);await act(async()=>get().update({section:{...EMPTY_SECTION,axis:"z"}}));await act(async()=>get().pick(box,vertices[3]));expect(get().pickedCount).toBe(0);await act(async()=>get().update({section:EMPTY_SECTION}));await act(async()=>get().pick(box,vertices[3]));expect(get().pickedCount).toBe(1);});});
it("unsupported curved cargo refuses solid picks while explicit envelope mode remains usable",async()=>{await mounted(async(get,setPlan)=>{await act(async()=>setPlan({...plan,cargoDetails:{u:{cargoShape:"cylinder"}}}));await act(async()=>get().setMode("points"));await act(async()=>get().setBasis("surface"));await act(async()=>get().pick(box,[box.x,box.y,box.z]));expect(get().pickedCount).toBe(0);await act(async()=>get().setBasis("envelope"));await act(async()=>get().pick(box,[box.x,box.y,box.z]));expect(get().pickedCount).toBe(1);});});
