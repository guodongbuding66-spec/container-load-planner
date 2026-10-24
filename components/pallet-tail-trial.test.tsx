import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {usePalletTailTrial,PalletTailTrial} from "./pallet-tail-trial";
import {runOrderCapacityTrial} from "../lib/packing/order-capacity";
import {palletTailFixture} from "../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {setAppLanguage} from "./language";
class FakeWorker{
 static instances:FakeWorker[]=[];onmessage:((e:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();constructor(){FakeWorker.instances.push(this);}deliver(data:unknown){this.onmessage?.({data} as MessageEvent);}
}
async function mount(Hook:()=>React.ReactNode){
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});vi.stubGlobal("Worker",FakeWorker);
 const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);
 await root.configure({gl:renderer,frameloop:"never",size:{width:800,height:400,top:0,left:0}});await act(async()=>root.render(<Hook/>));
 return {render:()=>act(async()=>root.render(<Hook/>)),close:async()=>{await act(async()=>root.unmount());_roots.delete(canvas);}};
}
afterEach(()=>{vi.useRealTimers();FakeWorker.instances=[];vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
const defaults=()=>{const request=palletTailFixture();return {request,plan:packLoadingWorkflow(request),disabled:false,canApply:true,onApply:vi.fn()};};
it("waits for every candidate, keeps the original and only applies the selected loose allocation",async()=>{
 const props=defaults();let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{
  await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;
  await act(async()=>w.deliver({index:0,plan:runOrderCapacityTrial(trials[0])}));expect(task.current?.best).toBeUndefined();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
  for(let index=1;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));
  expect(task.current?.status).toBe("done");expect(task.best?.plan.metrics.loadedCount).toBe(16);expect(props.plan.metrics.loadedCount).toBe(8);expect(props.request.products[0].quantity).toBe(20);expect(props.onApply).not.toHaveBeenCalled();
  await act(async()=>task.adopt());expect(props.onApply.mock.calls[0][0].looseQuantities).toEqual({a:8});expect(w.terminate).toHaveBeenCalled();
 }finally{await root.close();}
});
it.each(["cancel","timeout","worker"])("discards partial batches on %s and ignores late final results",async kind=>{
 const props=defaults();let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{vi.useFakeTimers();await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;
  await act(async()=>w.deliver({index:0,plan:runOrderCapacityTrial(trials[0])}));
  if(kind==="cancel")await act(async()=>task.cancel());else if(kind==="timeout")await act(async()=>vi.advanceTimersByTime(30001));else await act(async()=>w.onerror?.());
  for(let index=1;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));
  expect(task.best).toBeUndefined();expect(w.terminate).toHaveBeenCalled();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
 }finally{await root.close();}
});
it("invalidates a preview after a parameter round trip and rejects its old replies",async()=>{
 let props=defaults(),task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials,original=props;
  props={...props,request:{...props.request,clearance:1}};await root.render();props=original;await root.render();
  for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));
  expect(task.current).toBeNull();expect(w.terminate).toHaveBeenCalled();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
 }finally{await root.close();}
});
it("independently rejects a corrupt candidate and can still select later validated results",async()=>{
 const props=defaults();let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;
  for(let index=0;index<trials.length;index++){const plan=runOrderCapacityTrial(trials[index]);if(index===0)plan.placements[0].z=-100;await act(async()=>w.deliver({index,plan}));}
  expect(task.current?.rows[0]).toMatchObject({loaded:null,retained:false});expect(task.current?.rows[0].problem).toBeTruthy();expect(task.best?.plan.metrics.loadedCount).toBe(16);
 }finally{await root.close();}
});
it("treats unexpected candidate indices as a failed batch",async()=>{
 const props=defaults();let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances[0];await act(async()=>w.deliver({index:99}));expect(task.current?.status).toBe("error");await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();}finally{await root.close();}
});
it("keeps an issued version preview-only and blocks measured or locked rebuilding",async()=>{
 let props={...defaults(),canApply:false},task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
  const next=defaults();next.plan.pallets![0].locked=true;props={...next,canApply:true};await root.render();await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(1);
 }finally{await root.close();}
});
it("shows the bounded scope and has complete English and empty-plan states",()=>{
 const props=defaults();expect(renderToStaticMarkup(<PalletTailTrial {...props}/>)).toContain("最多 5 个候选");expect(renderToStaticMarkup(<PalletTailTrial {...props} plan={null}/>)).toContain("需要已计算");
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<PalletTailTrial {...props}/>);expect(en).toContain("Maximum additional loose units");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
