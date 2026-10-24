import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {OrderCapacityTrial,useOrderCapacityTrial} from "./order-capacity-trial";
import {runOrderCapacityTrial} from "../lib/packing/order-capacity";
import {orderCapacityFixture} from "../tests/order-capacity-fixture";
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
const defaults=()=>({request:orderCapacityFixture(),volume:.85,weight:.9,disabled:false,canApply:true,onApply:vi.fn()});
it("previews independently checked added stock and never auto-applies it",async()=>{
 const props=defaults();let task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const trial=FakeWorker.instances[0].postMessage.mock.calls[0][0],plan=runOrderCapacityTrial(trial);await act(async()=>FakeWorker.instances[0].deliver({plan}));expect(props.onApply).not.toHaveBeenCalled();expect(props.request.products[0].quantity).toBe(16);await act(async()=>task.adopt());expect(props.onApply.mock.calls[0][0][0].quantity).toBe(plan.metrics.loadedCount);}finally{await root.close();}
});
it("cancels changed input and rejects a late response even after an input round trip",async()=>{
 let props=defaults(),task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const old=FakeWorker.instances[0],plan=runOrderCapacityTrial(old.postMessage.mock.calls[0][0]);props={...props,volume:.8};await root.render();expect(old.terminate).toHaveBeenCalled();props={...props,volume:.85};await root.render();await act(async()=>old.deliver({plan}));expect(task.current).toBeNull();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();}finally{await root.close();}
});
it("drops a completed preview when disabled or changed to a delivery-only view",async()=>{
 let props=defaults(),task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances[0];await act(async()=>w.deliver({plan:runOrderCapacityTrial(w.postMessage.mock.calls[0][0])}));props={...props,disabled:true};await root.render();expect(task.current).toBeNull();props={...props,disabled:false,canApply:false};await root.render();await act(async()=>task.run());const next=FakeWorker.instances[1];await act(async()=>next.deliver({plan:runOrderCapacityTrial(next.postMessage.mock.calls[0][0])}));await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();}finally{await root.close();}
});
it.each(["cancel","timeout","worker"])("retains the original order on %s",async kind=>{
 const props=defaults();let task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{vi.useFakeTimers();await act(async()=>task.run());const w=FakeWorker.instances[0];if(kind==="cancel")await act(async()=>task.cancel());else if(kind==="timeout")await act(async()=>vi.advanceTimersByTime(30001));else await act(async()=>w.onerror?.());expect(w.terminate).toHaveBeenCalled();expect(task.current?.plan).toBeUndefined();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();expect(props.request.products[0].quantity).toBe(16);}finally{await root.close();}
});
it("rejects broken geometry in a worker reply",async()=>{
 const props=defaults();let task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances[0],plan=runOrderCapacityTrial(w.postMessage.mock.calls[0][0]);plan.placements[0].x=-999;await act(async()=>w.deliver({plan}));expect(task.current?.kind).toBe("error");expect(task.current?.plan).toBeUndefined();}finally{await root.close();}
});
it("displays order versus capacity, limits and complete English copy",()=>{
 const props=defaults();props.request.products[0].maxStackLayers=1;const zh=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(zh).toContain("本单装完 ≠ 整柜装满");expect(zh).toContain("箱体层数上限");expect(zh).toContain("1000 mm");expect(zh).toContain("30 秒");
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(en).toContain("Order fulfilled ≠ container full");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
it("disables nominal trials when adopted measured envelopes are present",async()=>{
 let props={...defaults(),measuredEnvelope:true},task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);props={...props,measuredEnvelope:false};await root.render();await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(1);props={...props,measuredEnvelope:true};await root.render();expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();expect(task.current).toBeNull();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();}finally{await root.close();}
});
it("explains the measured-envelope guard in both languages",()=>{
 const props={...defaults(),measuredEnvelope:true};expect(renderToStaticMarkup(<OrderCapacityTrial {...props}/>)).toContain("不能退回标称尺寸计算");vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(en).toContain("do not fall back to nominal dimensions");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
