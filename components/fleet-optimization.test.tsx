import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {FleetOptimization,useFleetOptimization} from "./fleet-optimization";
import {fleetTailFixture} from "../tests/fleet-tail-fixture";
import {prepareFleetOptimization,solveFleetOptimizationTrial,type FleetOptimizationSettings} from "../lib/packing/fleet-optimization";
import {setAppLanguage} from "./language";
class FakeWorker{
 static instances:FakeWorker[]=[];onmessage:((e:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();constructor(){FakeWorker.instances.push(this);}deliver(data:unknown){this.onmessage?.({data} as MessageEvent);}
}
async function mount(Hook:()=>React.ReactNode){
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});vi.stubGlobal("Worker",FakeWorker);const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);
 await root.configure({gl:renderer,frameloop:"never",size:{width:800,height:400,top:0,left:0}});await act(async()=>root.render(<Hook/>));return {render:()=>act(async()=>root.render(<Hook/>)),close:async()=>{await act(async()=>root.unmount());_roots.delete(canvas);}};
}
afterEach(()=>{vi.useRealTimers();FakeWorker.instances=[];vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
const setup=()=>({value:fleetTailFixture(),sourceKey:"same-settings",enabled:true,canApply:true,onApply:vi.fn(()=>true),settings:{mode:"reallocate",keepPrefix:0,cartonBudget:4,comparePackaging:false,rework:{dismantle:0,rebuild:0,source:"QA explicit zero"}} as FleetOptimizationSettings});
async function finish(worker:FakeWorker){
 const init=worker.postMessage.mock.calls[0][0],p=prepareFleetOptimization(init.source,init.settings);await act(async()=>worker.deliver({type:"ready"}));
 for(let n=0;n<64&&!worker.terminate.mock.calls.length;n++){const job=worker.postMessage.mock.calls.at(-1)![0];expect(job.type).toBe("solve");await act(async()=>worker.deliver({type:"result",index:job.index,result:solveFleetOptimizationTrial(p,job.spec)}));}
}
it("waits for every main-thread review and explicitly applies the independently checked fleet",async()=>{
 const props=setup(),before=structuredClone(props.value);let task!:ReturnType<typeof useFleetOptimization>;function Hook(){task=useFleetOptimization(props);return <group/>;}const root=await mount(Hook);
 try{await act(async()=>task.run());const w=FakeWorker.instances[0];expect(w.postMessage).toHaveBeenCalledOnce();expect(task.getReport()).toBeUndefined();expect(task.apply()).toBe(false);await finish(w);expect(task.getReport()!.best!.result.loads).toHaveLength(2);expect(props.onApply).not.toHaveBeenCalled();expect(props.value).toEqual(before);expect(task.apply()).toBe(true);expect(props.onApply).toHaveBeenCalledOnce();}finally{await root.close();}
});
it.each(["prefix","budget","work-quote","mode","source","disabled","apply-disabled","rerun"])("invalidates old exports and apply callbacks after %s round trips",async kind=>{
 let props=setup(),task!:ReturnType<typeof useFleetOptimization>;function Hook(){task=useFleetOptimization(props);return <group/>;}const root=await mount(Hook);
 try{await act(async()=>task.run());await finish(FakeWorker.instances[0]);const get=task.getReport,apply=task.apply,original=props;
 if(kind==="rerun")await act(async()=>task.run());else{const settings=structuredClone(props.settings);if(kind==="prefix")settings.keepPrefix=1;if(kind==="budget")settings.cartonBudget=3;if(kind==="work-quote")settings.rework.dismantle=5;if(kind==="mode")settings.mode="fill";
 props={...props,settings,...(kind==="source"?{sourceKey:"changed"}:kind==="disabled"?{enabled:false}:kind==="apply-disabled"?{canApply:false}:{})};await root.render();props=original;await root.render();}
 expect(get()).toBeUndefined();expect(apply()).toBe(false);expect(props.onApply).not.toHaveBeenCalled();expect(task.getReport()).toBeUndefined();}finally{await root.close();}
});
it.each(["cancel","timer","late-clock","worker","duplicate-ready","bad-index","corrupt"])("discards %s batches, including late messages",async kind=>{
 const props=setup();let task!:ReturnType<typeof useFleetOptimization>;function Hook(){task=useFleetOptimization(props);return <group/>;}const root=await mount(Hook);
 try{vi.useFakeTimers();await act(async()=>task.run());const w=FakeWorker.instances[0];await act(async()=>w.deliver({type:"ready"}));const job=w.postMessage.mock.calls.at(-1)![0],p=prepareFleetOptimization(props.value,props.settings),result=solveFleetOptimizationTrial(p,job.spec);
 if(kind==="cancel")await act(async()=>task.cancel());if(kind==="timer")await act(async()=>vi.advanceTimersByTime(30001));if(kind==="late-clock")vi.setSystemTime(Date.now()+30001);if(kind==="worker")await act(async()=>w.onerror?.());if(kind==="duplicate-ready")await act(async()=>w.deliver({type:"ready"}));if(kind==="corrupt")result.loads[0].plan.placements[0].x=-1;
 await act(async()=>w.deliver({type:"result",index:kind==="bad-index"?99:job.index,result}));expect(task.getReport()).toBeUndefined();expect(task.apply()).toBe(false);expect(w.terminate).toHaveBeenCalled();expect(props.onApply).not.toHaveBeenCalled();}finally{await root.close();}
});
it("disables invalid workers, respects parent rejection, renders bilingual controls and closes stale callbacks on unmount",async()=>{
 let props={...setup(),enabled:false},task!:ReturnType<typeof useFleetOptimization>;function Hook(){task=useFleetOptimization(props);return <group/>;}const root=await mount(Hook);let closed=false;
 try{await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);props={...props,enabled:true,onApply:vi.fn(()=>false)};await root.render();await act(async()=>task.run());await finish(FakeWorker.instances[0]);expect(task.apply()).toBe(false);const get=task.getReport;await root.close();closed=true;expect(get()).toBeUndefined();}finally{if(!closed)await root.close();}
 vi.stubGlobal("document",{documentElement:{lang:""}});expect(renderToStaticMarkup(<FleetOptimization {...props}/>)).toContain("自动整单优化");setAppLanguage("en");const html=renderToStaticMarkup(<FleetOptimization {...props}/>);expect(html).toContain("Preview automatic fleet optimization");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
