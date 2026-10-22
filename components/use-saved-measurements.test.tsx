import {act} from "react";
import {afterEach,expect,it,vi} from "vitest";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {useSavedMeasurements,type SavedMeasurements} from "./use-saved-measurements";
import {MEASUREMENT_KEY,captureMeasurement,serializeMeasurements} from "../lib/packing/saved-measurements";
import {EMPTY_SECTION} from "../lib/packing/inspection";
import {pack} from "../lib/packing/engine";
import {CONTAINER_PRESETS,SAMPLE_PRODUCTS} from "../lib/packing/presets";
const plan=pack({mode:"mixed",strategy:"practical",container:CONTAINER_PRESETS[2],products:SAMPLE_PRODUCTS,clearance:10});
const item=captureMeasurement(plan,"wall",[plan.placements[0]],[],"face","x-",EMPTY_SECTION,"Rear","test",'2026-10-22T09:00:00.000Z');
afterEach(()=>vi.unstubAllGlobals());
async function mounted(run:(get:()=>SavedMeasurements)=>Promise<void>){
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});
  const canvas={style:{}} as HTMLCanvasElement,gl={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer;
  const root=createRoot(canvas);await root.configure({gl,frameloop:"never",size:{width:100,height:100,top:0,left:0}});let value!:SavedMeasurements;
  function Hook(){value=useSavedMeasurements();return <group/>;}
  try{await act(async()=>root.render(<Hook/>));await run(()=>value);}finally{await act(async()=>root.unmount());_roots.delete(canvas);}
}
it("loads native records, supports rename/hide/removal undo, and ignores invalid imports atomically",async()=>{
  let raw:string|null=serializeMeasurements([item]);vi.stubGlobal("localStorage",{getItem:(key:string)=>key===MEASUREMENT_KEY?raw:null,setItem:(_key:string,value:string)=>{raw=value;}});
  await mounted(async get=>{expect(get().ready).toBe(true);expect(get().items).toEqual([item]);await act(async()=>{get().patch(item.id,{name:"Changed",visible:false});});expect(get().items[0]).toMatchObject({name:"Changed",visible:false});const before=raw;await act(async()=>{await get().importFile({size:2,text:async()=>"{}"} as File);});expect(raw).toBe(before);await act(async()=>get().remove(item.id));expect(get().items).toHaveLength(0);await act(async()=>get().undo());expect(get().items[0].name).toBe("Changed");});
});
it("retains session records on quota failures and never overwrites a corrupt original",async()=>{
  const write=vi.fn(()=>{throw Error("quota");});vi.stubGlobal("localStorage",{getItem:()=>null,setItem:write});
  await mounted(async get=>{await act(async()=>{get().add(item);});expect(get().mode).toBe("session");expect(get().items).toEqual([item]);});
  write.mockClear();vi.stubGlobal("localStorage",{getItem:()=>"{broken",setItem:write});await mounted(async get=>{expect(get().mode).toBe("corrupt");await act(async()=>{get().add(item);});expect(get().items).toEqual([item]);expect(get().raw).toBe("{broken");expect(write).not.toHaveBeenCalled();});
});
it("rejects stale-page writes while retaining this page's records for download",async()=>{let raw:string|null=serializeMeasurements([item]);const write=vi.fn();vi.stubGlobal("localStorage",{getItem:()=>raw,setItem:write});await mounted(async get=>{raw=serializeMeasurements([{...item,name:"Other tab"}]);await act(async()=>{get().patch(item.id,{name:"My edit"});});expect(get().mode).toBe("conflict");expect(get().items[0].name).toBe("Rear");expect(write).not.toHaveBeenCalled();});});
it("ignores a late file completion after unmount",async()=>{let done!:(s:string)=>void,pending!:Promise<void>;const write=vi.fn();vi.stubGlobal("localStorage",{getItem:()=>null,setItem:write});await mounted(async get=>{await act(async()=>{pending=get().importFile({size:10,text:()=>new Promise<string>(resolve=>{done=resolve;})} as File);});});await act(async()=>{done(serializeMeasurements([item]));await pending;});expect(write).not.toHaveBeenCalled();});
