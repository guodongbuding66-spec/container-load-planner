import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {MeasuredUnitRepack,useMeasuredUnitRepack} from "./measured-unit-repack";
import {repackMeasuredUnits} from "../lib/packing/unit-envelope-repack";
import {measuredUnitFixture} from "../tests/measured-unit-fixture";
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
it("keeps worker output as a preview until explicit adoption",async()=>{
 const {plan,document,request}=measuredUnitFixture(),onAdopt=vi.fn();let task!:ReturnType<typeof useMeasuredUnitRepack>;
 function Hook(){task=useMeasuredUnitRepack({plan,document,products:request.products,disabled:false,onAdopt});return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances.at(-1)!;expect(w.postMessage).toHaveBeenCalledWith({plan,document,products:request.products});const candidate=repackMeasuredUnits(plan,document,request.products);await act(async()=>w.deliver({plan:candidate}));expect(onAdopt).not.toHaveBeenCalled();expect(task.candidate).toBe(candidate);await act(async()=>task.adopt());expect(onAdopt).toHaveBeenCalledWith(candidate);expect(task.candidate).toBeNull();}finally{await root.close();}
});
it("cancels and ignores late results after measurement, input or disabled scope changes",async()=>{
 const f=measuredUnitFixture(),onAdopt=vi.fn();let document=f.document,disabled=false,task!:ReturnType<typeof useMeasuredUnitRepack>;
 function Hook(){task=useMeasuredUnitRepack({plan:f.plan,document,products:f.request.products,disabled,onAdopt});return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances.at(-1)!;document={...document,units:[...document.units]};await root.render();expect(w.terminate).toHaveBeenCalled();await act(async()=>w.deliver({plan:f.plan}));expect(task.candidate).toBeNull();await act(async()=>task.run());const next=FakeWorker.instances.at(-1)!;disabled=true;await root.render();expect(next.terminate).toHaveBeenCalled();await act(async()=>next.deliver({plan:f.plan}));await act(async()=>task.adopt());expect(onAdopt).not.toHaveBeenCalled();}finally{await root.close();}
});
it("retains the original plan on cancellation, deadline and worker errors",async()=>{
 const {plan,document,request}=measuredUnitFixture(),onAdopt=vi.fn();let task!:ReturnType<typeof useMeasuredUnitRepack>;
 function Hook(){task=useMeasuredUnitRepack({plan,document,products:request.products,disabled:false,onAdopt});return <group/>;}
 const root=await mount(Hook);try{vi.useFakeTimers();await act(async()=>task.run());const w=FakeWorker.instances.at(-1)!;await act(async()=>task.cancel());expect(w.terminate).toHaveBeenCalled();await act(async()=>w.deliver({plan}));expect(task.candidate).toBeNull();await act(async()=>task.run());await act(async()=>vi.advanceTimersByTime(15001));expect(task.preview?.message).toMatch(/15 秒/);expect(task.candidate).toBeNull();await act(async()=>task.run());await act(async()=>FakeWorker.instances.at(-1)!.onerror?.());expect(task.candidate).toBeNull();expect(onAdopt).not.toHaveBeenCalled();}finally{await root.close();}
});
it("does not start a worker with incomplete records and surfaces a rejected adoption",async()=>{
 const f=measuredUnitFixture();let document={...f.document,units:f.document.units.slice(1)},task!:ReturnType<typeof useMeasuredUnitRepack>;const onAdopt=vi.fn(()=>{throw Error("已装记录保护 / Loaded-record protection");});
 function Hook(){task=useMeasuredUnitRepack({plan:f.plan,document,products:f.request.products,disabled:false,onAdopt});return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);expect(task.preview?.message).toMatch(/every current unit/);document=f.document;await root.render();await act(async()=>task.run());const candidate=repackMeasuredUnits(f.plan,document,f.request.products);await act(async()=>FakeWorker.instances.at(-1)!.deliver({plan:candidate}));await act(async()=>task.adopt());expect(task.candidate).toBe(candidate);expect(task.preview?.message).toMatch(/Loaded-record/);}finally{await root.close();}
});
it("states bounded scope, backup, mass and revision behavior in both languages",()=>{
 const {plan,document,request}=measuredUnitFixture();const props={plan,document,products:request.products,disabled:false,onAdopt:vi.fn()},zh=renderToStaticMarkup(<MeasuredUnitRepack {...props}/>);expect(zh).toContain("最多 60 托");expect(zh).toContain("未计入计划的附件增重");vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<MeasuredUnitRepack {...props}/>);expect(en).toContain("15-second budget");expect(en).toContain("Preview measured-unit repacking");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
