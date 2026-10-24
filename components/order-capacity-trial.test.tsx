import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {OrderCapacityTrial,useOrderCapacityTrial} from "./order-capacity-trial";
import {runOrderCapacityTrial} from "../lib/packing/order-capacity";
import {orderCapacityFixture} from "../tests/order-capacity-fixture";
import {palletHeightFixture} from "../tests/pallet-height-fixture";
import {packagingCapacityFixture} from "../tests/packaging-capacity-fixture";
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
const defaults=()=>({request:orderCapacityFixture(),volume:.85,weight:.9,disabled:false,canApply:true,onApply:vi.fn()});
it("previews existing packaging stock and applies only selection, leaving 596 ordered",async()=>{
 const request=packagingCapacityFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request),onApplyBuild:vi.fn()};let task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{
  await act(async()=>task.run("packaging"));const w=FakeWorker.instances[0],trial=w.postMessage.mock.calls[0][0];
  expect(trial.request.palletBuild.additionalSpecs[0].maxPallets).toBe(13);expect(props.request.palletBuild!.selection).toBeUndefined();
  await act(async()=>w.deliver({plan:runOrderCapacityTrial(trial)}));expect(props.onApplyBuild).not.toHaveBeenCalled();expect(task.current?.plan?.metrics.loadedCount).toBe(299);
  await act(async()=>task.adopt());expect(props.onApplyBuild.mock.calls[0][0].selection).toBe("compact");expect(props.onApply).not.toHaveBeenCalled();expect(request.products[0].quantity).toBe(596);
 }finally{await root.close();}
});
it("discards a packaging candidate if stock changes, even after a round trip to the old stock",async()=>{
 const request=packagingCapacityFixture();let props={...defaults(),request,plan:packLoadingWorkflow(request),onApplyBuild:vi.fn()},task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{
  await act(async()=>task.run("packaging"));const w=FakeWorker.instances[0],candidate=runOrderCapacityTrial(w.postMessage.mock.calls[0][0]);
  props={...props,request:packagingCapacityFixture(2)};await root.render();expect(w.terminate).toHaveBeenCalled();
  props={...props,request};await root.render();await act(async()=>w.deliver({plan:candidate}));expect(task.current).toBeNull();await act(async()=>task.adopt());expect(props.onApplyBuild).not.toHaveBeenCalled();
 }finally{await root.close();}
});
it("keeps packaging selection read-only for an issued delivery and blocks measured fallback",async()=>{
 const request=packagingCapacityFixture();let props={...defaults(),request,plan:packLoadingWorkflow(request),canApply:false,measuredEnvelope:false,onApplyBuild:vi.fn()},task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{
  await act(async()=>task.run("packaging"));const w=FakeWorker.instances[0];await act(async()=>w.deliver({plan:runOrderCapacityTrial(w.postMessage.mock.calls[0][0])}));await act(async()=>task.adopt());expect(props.onApplyBuild).not.toHaveBeenCalled();
  props={...props,canApply:true,measuredEnvelope:true};await root.render();await act(async()=>task.run("packaging"));expect(FakeWorker.instances).toHaveLength(1);expect(task.current).toBeNull();
 }finally{await root.close();}
});
it("offers registered packaging comparisons and uses a general limit title for direct loading",()=>{
 const request=packagingCapacityFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request)};
 const html=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(html).toContain("保持本单数量，按现有包装比选");expect(html).toContain("87.5%");
 const direct={...request,workflow:"direct" as const,products:request.products.map(p=>({...p,quantity:700}))},plan=packLoadingWorkflow(direct);
 expect(plan.metrics.loadedCount).toBeLessThan(700);const directHtml=renderToStaticMarkup(<OrderCapacityTrial {...props} request={direct} plan={plan}/>);expect(directHtml).toContain("订单尚未装完：检查装载限制");expect(directHtml).not.toContain("整托占地与载荷诊断");
});
it("previews the unchanged 596-carton order and applies only validated higher ceilings",async()=>{
 const request=palletHeightFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request),onApplyBuild:vi.fn()};
 let task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{
  await act(async()=>task.run("height"));const w=FakeWorker.instances[0],trial=w.postMessage.mock.calls[0][0];
  expect(trial.request.products[0].quantity).toBe(596);expect(props.request.palletBuild!.config.maxCargoHeight).toBe(120);
  await act(async()=>w.deliver({plan:runOrderCapacityTrial(trial)}));expect(props.onApplyBuild).not.toHaveBeenCalled();
  await act(async()=>task.adopt());expect(props.onApplyBuild.mock.calls[0][0].config.maxCargoHeight).toBe(2527);expect(props.onApply).not.toHaveBeenCalled();expect(props.request.products[0].quantity).toBe(596);
 }finally{await root.close();}
});
it("does not apply a non-improving height trial or an issued delivery preview",async()=>{
 const request=palletHeightFixture();request.products[0].maxStackLayers=1;
 let props={...defaults(),request,plan:packLoadingWorkflow(request),onApplyBuild:vi.fn()},task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{
  await act(async()=>task.run("height"));let w=FakeWorker.instances[0];await act(async()=>w.deliver({plan:runOrderCapacityTrial(w.postMessage.mock.calls[0][0])}));await act(async()=>task.adopt());expect(props.onApplyBuild).not.toHaveBeenCalled();
  const next=palletHeightFixture();props={...props,request:next,plan:packLoadingWorkflow(next),canApply:false};await root.render();
  await act(async()=>task.run("height"));w=FakeWorker.instances[1];await act(async()=>w.deliver({plan:runOrderCapacityTrial(w.postMessage.mock.calls[0][0])}));await act(async()=>task.adopt());expect(props.onApplyBuild).not.toHaveBeenCalled();
 }finally{await root.close();}
});
it("describes the unfinished one-layer order and distinguishes pallet stacks from carton layers",()=>{
 const request=palletHeightFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request)};
 const zh=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(zh).toContain("订单尚未装完");expect(zh).toContain("当前只生成了第一层");expect(zh).toContain("120.0 mm");expect(zh).toContain("2527.0 mm");expect(zh).toContain("保持本单数量，按柜门净高试算打托");
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(en).toContain("Order incomplete");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
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
 const props=defaults();props.request.products[0].maxStackLayers=1;const zh=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(zh).toContain("订单数量与装载试算");expect(zh).toContain("箱体层数上限");expect(zh).toContain("1000 mm");expect(zh).toContain("30 秒");
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(en).toContain("Order quantity and loading trials");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
it("disables nominal trials when adopted measured envelopes are present",async()=>{
 let props={...defaults(),measuredEnvelope:true},task!:ReturnType<typeof useOrderCapacityTrial>;function Hook(){task=useOrderCapacityTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);props={...props,measuredEnvelope:false};await root.render();await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(1);props={...props,measuredEnvelope:true};await root.render();expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();expect(task.current).toBeNull();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();}finally{await root.close();}
});
it("explains the measured-envelope guard in both languages",()=>{
 const props={...defaults(),measuredEnvelope:true};expect(renderToStaticMarkup(<OrderCapacityTrial {...props}/>)).toContain("不能退回标称尺寸计算");vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<OrderCapacityTrial {...props}/>);expect(en).toContain("do not fall back to nominal dimensions");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
