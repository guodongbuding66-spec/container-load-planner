import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {useTailEconomicPreview,TailEconomicPreview} from "./tail-economic-preview";
import {economicTailBatch,economicQuote} from "../tests/economic-tail-fixture";
import {runOrderCapacityTrial} from "../lib/packing/order-capacity";
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
function setup(){const input=economicTailBatch();return {input,sourceKey:"complete-batch-1",quote:structuredClone(economicQuote),enabled:true,canApply:true,getInput:()=>input,onAdopt:vi.fn(()=>true)};}
it("waits for independent geometry review, preserves the quantity choice and only adopts on an explicit click",async()=>{
 const props=setup(),before=structuredClone(props.input);let task!:ReturnType<typeof useTailEconomicPreview>;function Hook(){task=useTailEconomicPreview(props);return <group/>;}const root=await mount(Hook);
 try{await act(async()=>task.run());const worker=FakeWorker.instances[0],trial=worker.postMessage.mock.calls[0][0].trials[0];expect(task.getReport()).toBeUndefined();expect(task.adopt()).toBe(false);expect(trial.request.palletBuild.looseQuantities).toEqual({a:6});await act(async()=>worker.deliver({index:0,plan:runOrderCapacityTrial(trial)}));expect(task.getReport()).toMatchObject({savings:20});expect(props.input).toEqual(before);expect(props.onAdopt).not.toHaveBeenCalled();expect(task.adopt()).toBe(true);expect(props.onAdopt).toHaveBeenCalledWith(props.input.rows[5]);}finally{await root.close();}
});
it.each(["quote","source","disabled","issued","unmount","rerun"])("invalidates old report and adopt callbacks after a %s round trip",async kind=>{
 let props=setup(),task!:ReturnType<typeof useTailEconomicPreview>;function Hook(){task=useTailEconomicPreview(props);return <group/>;}const root=await mount(Hook);let closed=false;
 try{await act(async()=>task.run());const worker=FakeWorker.instances[0],trial=worker.postMessage.mock.calls[0][0].trials[0];await act(async()=>worker.deliver({index:0,plan:runOrderCapacityTrial(trial)}));const oldGet=task.getReport,oldAdopt=task.adopt,original=props;
 if(kind==="unmount"){await root.close();closed=true;}else if(kind==="rerun"){await act(async()=>task.run());}else{props=kind==="quote"?{...props,quote:{...props.quote,freight:200}}:kind==="source"?{...props,sourceKey:"other"}:kind==="disabled"?{...props,enabled:false}:{...props,canApply:false};await root.render();props=original;await root.render();}
 expect(oldGet()).toBeUndefined();expect(oldAdopt()).toBe(false);expect(props.onAdopt).not.toHaveBeenCalled();if(!closed)expect(task.getReport()).toBeUndefined();}finally{if(!closed)await root.close();}
});
it.each(["cancel","timeout","worker","corrupt","index"])("rejects %s and ignores late worker replies",async kind=>{
 const props=setup();let task!:ReturnType<typeof useTailEconomicPreview>;function Hook(){task=useTailEconomicPreview(props);return <group/>;}const root=await mount(Hook);
 try{vi.useFakeTimers();await act(async()=>task.run());const worker=FakeWorker.instances[0],trial=worker.postMessage.mock.calls[0][0].trials[0],plan=runOrderCapacityTrial(trial);
 if(kind==="cancel")await act(async()=>task.cancel());else if(kind==="timeout")await act(async()=>vi.advanceTimersByTime(30001));else if(kind==="worker")await act(async()=>worker.onerror?.());else{if(kind==="corrupt")plan.placements[0].z=-100;await act(async()=>worker.deliver({index:kind==="index"?99:0,plan}));}
 await act(async()=>worker.deliver({index:0,plan:runOrderCapacityTrial(trial)}));expect(task.getReport()).toBeUndefined();expect(task.adopt()).toBe(false);expect(props.onAdopt).not.toHaveBeenCalled();expect(worker.terminate).toHaveBeenCalled();}finally{await root.close();}
});
it("allows issued previews but never applies them, and rejects an unavailable parent batch",async()=>{
 let props={...setup(),canApply:false},task!:ReturnType<typeof useTailEconomicPreview>;function Hook(){task=useTailEconomicPreview(props);return <group/>;}const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances[0],trial=w.postMessage.mock.calls[0][0].trials[0];await act(async()=>w.deliver({index:0,plan:runOrderCapacityTrial(trial)}));expect(task.getReport()!.savings).toBe(20);expect(task.adopt()).toBe(false);expect(props.onAdopt).not.toHaveBeenCalled();props={...props,sourceKey:"stale",getInput:()=>undefined as never};await root.render();await act(async()=>task.run());expect(task.current?.status).toBe("error");expect(FakeWorker.instances).toHaveLength(1);}finally{await root.close();}
});
it("does not create workers when pricing is incomplete and exposes bilingual accessible controls",async()=>{
 const props={...setup(),enabled:false};let task!:ReturnType<typeof useTailEconomicPreview>;function Hook(){task=useTailEconomicPreview(props);return <group/>;}const root=await mount(Hook);try{await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);}finally{await root.close();}
 expect(renderToStaticMarkup(<TailEconomicPreview {...props}/>)).toContain("先完成至少两个同量候选");vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<TailEconomicPreview {...props}/>);expect(en).not.toMatch(/[\u3400-\u9fff]/u);expect(en).toContain("Preview lowest-cost equal-delivery candidate");expect(en).toContain('disabled=""');
});
