import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {afterEach,expect,it,vi} from "vitest";
import {usePalletRecipe} from "./pallet-recipe";
import {oneLayerCrateFixture} from "../tests/one-layer-crate-fixture";
import {emptyCrateBearing} from "../lib/packing/crate-bearing";
import {palletSpecifications} from "../lib/packing/pallet-specifications";
import {previewPalletRecipe,withPalletRecipe} from "../lib/packing/pallet-recipe";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
class FakeWorker {
 static instances:FakeWorker[]=[];
 onmessage:((e:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();
 constructor(){FakeWorker.instances.push(this);}
 finish(){this.onmessage?.({data:{ok:true,result:previewPalletRecipe(this.postMessage.mock.calls[0][0].recipe)}} as MessageEvent);}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();FakeWorker.instances=[];});
async function mount(initialCartons?:number){
 const request=oneLayerCrateFixture(),build=request.palletBuild!;
 Object.assign(build.config,{length:1800,width:1800,crateBearing:emptyCrateBearing()});
 build.primaryRule={maxPallets:50,cartonLimit:3};build.selection="compact";
 const onApply=vi.fn(),onPendingChange=vi.fn();
 let props={request,spec:palletSpecifications(build)[0],disabled:false,onApply,onPendingChange,initialCartons};
 let task!:ReturnType<typeof usePalletRecipe>;
 function Hook(){task=usePalletRecipe(props);return <group/>;}
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("Worker",FakeWorker);extend({Group:THREE.Group});
 const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);
 await root.configure({gl:renderer,frameloop:"never",size:{width:800,height:400,top:0,left:0}});
 vi.useFakeTimers();vi.stubGlobal("window",{setTimeout,clearTimeout});
 await act(async()=>root.render(<Hook/>));
 return {get task(){return task;},request,onApply,onPendingChange,
  finish:async()=>{await act(async()=>vi.advanceTimersByTime(181));const w=FakeWorker.instances.at(-1)!;await act(async()=>w.finish());return w;},
  render:async(disabled=false)=>{props={...props,disabled};await act(async()=>root.render(<Hook/>));},
  close:async()=>{await act(async()=>root.unmount());_roots.delete(canvas);}};
}
it("typing a count on documented packaging automatically sizes and applies a real multilayer plan",async()=>{
 const ui=await mount();try{
  expect(ui.task.pending).toBe(false);
  expect(packLoadingWorkflow(ui.request).metrics.loadedCount).toBe(18);
  await act(async()=>ui.task.suggest("20"));await ui.finish();
  expect(ui.task.preview).toMatchObject({layerCount:10,height:1255});expect(ui.task.preview!.placements).toHaveLength(20);
  expect(ui.task.redesigned).toBe(true);expect(ui.onApply).not.toHaveBeenCalled();
  await act(async()=>ui.task.applyPreview());
  const next=withPalletRecipe(ui.request.palletBuild!,"primary",ui.onApply.mock.calls[0][0]);
  expect(next.additionalSpecs![0].config).toEqual(ui.request.palletBuild!.config);
  for(const strategy of ["practical","maximum"] as const){const result=packLoadingWorkflow({...ui.request,palletBuild:next,strategy});expect(result.metrics.loadedCount).toBe(strategy==="practical"?540:560);expect(result.pallets!.some(p=>p.z>0)).toBe(true);expect(result.validation.valid).toBe(true);}
 }finally{await ui.close();}
});
it("previews recommended counts without another click and permits fine adjustment before committing",async()=>{
 const ui=await mount(23);try{
  await ui.finish();expect(ui.task.preview!.placements).toHaveLength(23);expect(ui.task.preview!.layerCount).toBeGreaterThan(1);
  await act(async()=>ui.task.suggest("20"));await ui.finish();
  await act(async()=>ui.task.fineTune());await act(async()=>ui.task.updateFine("length","1750"));await ui.finish();
  expect(ui.task.preview!.config.length).toBe(1750);expect(ui.onApply).not.toHaveBeenCalled();expect(ui.task.pending).toBe(true);
  await act(async()=>ui.task.applyPreview());expect(ui.onApply.mock.calls[0][0]).toMatchObject({redesigned:true,cartonLimit:20,config:{length:1750,maxCargoHeight:1200}});
 }finally{await ui.close();}
});
it("blocks incomplete and invalid fine-tuning instead of saving another single-layer recipe",async()=>{
 const ui=await mount(20);try{
  await ui.finish();await act(async()=>ui.task.fineTune());await act(async()=>ui.task.updateFine("maxCargoHeight","125"));await ui.finish();
  expect(ui.task.preview!.layerCount).toBe(1);expect(ui.task.fitsTarget).toBe(false);
  await act(async()=>ui.task.applyPreview());expect(ui.onApply).not.toHaveBeenCalled();
  await act(async()=>ui.task.updateFine("maxCargoHeight",""));expect(ui.task.preview).toBeUndefined();expect(ui.task.fineInvalid).toBe(true);
  await act(async()=>ui.task.applyPreview());expect(ui.onApply).not.toHaveBeenCalled();
  await act(async()=>ui.task.cancel());await ui.finish();expect(ui.task.draft).toBe("3");expect(ui.task.pending).toBe(false);expect(ui.task.preview!.layerCount).toBe(1);
 }finally{await ui.close();}
});
it("drops a delayed worker result after quantity changes and keeps saved packaging edits isolated",async()=>{
 const ui=await mount();try{
  await ui.finish();await act(async()=>ui.task.fineTune());await act(async()=>ui.task.updateFine("maxCargoHeight","1200"));
  expect(ui.request.palletBuild!.config.maxCargoHeight).toBe(125);expect(ui.task.redesigned).toBe(true);
  await act(async()=>ui.task.suggest("20"));await act(async()=>vi.advanceTimersByTime(181));const stale=FakeWorker.instances.at(-1)!;
  await act(async()=>ui.task.suggest("21"));await act(async()=>stale.finish());expect(ui.task.preview).toBeUndefined();
  await ui.finish();expect(ui.task.preview!.placements).toHaveLength(21);
  await ui.render(true);await act(async()=>ui.task.applyPreview());expect(ui.onApply).not.toHaveBeenCalled();
 }finally{await ui.close();}
});

it("keeps the user's three-carton target and automatically previews three layers rather than requiring twenty",async()=>{
 const ui=await mount(3);try{
  await ui.finish();expect(ui.task.preview).toMatchObject({layerCount:3,height:415,config:{length:1700,width:605}});
  expect(ui.task.preview!.placements).toHaveLength(3);expect(ui.onApply).not.toHaveBeenCalled();
  await act(async()=>ui.task.applyPreview());const next=withPalletRecipe(ui.request.palletBuild!,"primary",ui.onApply.mock.calls[0][0]);
  expect(next.primaryRule!.cartonLimit).toBe(3);
  for(const strategy of ["practical","maximum"] as const){const result=packLoadingWorkflow({...ui.request,palletBuild:next,strategy});expect(result.metrics.loadedCount).toBe(378);expect(result.pallets).toHaveLength(126);expect(result.pallets!.some(p=>p.z>0)).toBe(true);expect(result.validation.valid).toBe(true);}
 }finally{await ui.close();}
});
