import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {useFleetTailPreview,FleetTailPreview} from "./fleet-tail-preview";
import {fleetTailFixture} from "../tests/fleet-tail-fixture";
import {allocateFleet} from "../lib/packing/fleet";
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
const setup=()=>({value:fleetTailFixture(),sourceKey:"settings-1",enabled:true,canApply:true,groupId:"row:p",limit:8,onApply:vi.fn(()=>true)});
function replies(worker:FakeWorker){return worker.postMessage.mock.calls[0][0].trials.map((t:{value:ReturnType<typeof fleetTailFixture>},index:number)=>{const v=t.value;return {index,result:allocateFleet(v.request,v.options,v.limit,v.objective,undefined,v.pricing)};});}
it("waits for the entire independently reviewed batch and requires an explicit apply",async()=>{
 const props=setup(),before=structuredClone(props.value);let task!:ReturnType<typeof useFleetTailPreview>;function Hook(){task=useFleetTailPreview(props);return <group/>;}const root=await mount(Hook);
 try{await act(async()=>task.run());const w=FakeWorker.instances[0],rows=replies(w);await act(async()=>w.deliver(rows[0]));expect(task.getReport()).toBeUndefined();expect(task.apply()).toBe(false);
 for(const row of rows.slice(1))await act(async()=>w.deliver(row));expect(task.getReport()?.best?.result.loads).toHaveLength(2);expect(props.onApply).not.toHaveBeenCalled();expect(props.value).toEqual(before);expect(task.apply()).toBe(true);expect(props.onApply).toHaveBeenCalledOnce();}finally{await root.close();}
});
it.each(["quote","source","ceiling","disabled","issued","rerun","unmount"])("invalidates old export and apply callbacks after %s changes, including round trips",async kind=>{
 let props=setup(),task!:ReturnType<typeof useFleetTailPreview>;function Hook(){task=useFleetTailPreview(props);return <group/>;}const root=await mount(Hook);let closed=false;
 try{await act(async()=>task.run());const w=FakeWorker.instances[0];for(const row of replies(w))await act(async()=>w.deliver(row));const oldGet=task.getReport,oldApply=task.apply,original=props;
 if(kind==="unmount"){await root.close();closed=true;}else if(kind==="rerun"){await act(async()=>task.run());}else{props=kind==="quote"?{...props,value:{...props.value,pricing:{currency:"CNY",packaging:{primary:6}}}}:kind==="source"?{...props,sourceKey:"settings-2"}:kind==="ceiling"?{...props,limit:4}:kind==="disabled"?{...props,enabled:false}:{...props,canApply:false};await root.render();props=original;await root.render();}
 expect(oldGet()).toBeUndefined();expect(oldApply()).toBe(false);expect(props.onApply).not.toHaveBeenCalled();if(!closed)expect(task.getReport()).toBeUndefined();}finally{if(!closed)await root.close();}
});
it.each(["cancel","timeout","worker","corrupt","index","duplicate"])("discards %s batches and ignores late worker messages",async kind=>{
 const props=setup();let task!:ReturnType<typeof useFleetTailPreview>;function Hook(){task=useFleetTailPreview(props);return <group/>;}const root=await mount(Hook);
 try{vi.useFakeTimers();await act(async()=>task.run());const w=FakeWorker.instances[0],rows=replies(w);
 if(kind==="cancel")await act(async()=>task.cancel());else if(kind==="timeout")await act(async()=>vi.advanceTimersByTime(30001));else if(kind==="worker")await act(async()=>w.onerror?.());else if(kind==="duplicate"){await act(async()=>w.deliver(rows[0]));await act(async()=>w.deliver(rows[0]));}else{if(kind==="corrupt")rows[0].result.loads[0].plan.placements[0].x=-100;await act(async()=>w.deliver({...rows[0],index:kind==="index"?99:0}));}
 for(const row of rows)await act(async()=>w.deliver(row));expect(task.getReport()).toBeUndefined();expect(task.apply()).toBe(false);expect(props.onApply).not.toHaveBeenCalled();expect(w.terminate).toHaveBeenCalled();}finally{await root.close();}
});
it("does not start disabled workers, honors parent rejection and renders accessible bilingual controls",async()=>{
 let props={...setup(),enabled:false},task!:ReturnType<typeof useFleetTailPreview>;function Hook(){task=useFleetTailPreview(props);return <group/>;}const root=await mount(Hook);
 try{await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);props={...props,enabled:true,onApply:vi.fn(()=>false)};await root.render();await act(async()=>task.run());const w=FakeWorker.instances[0];for(const row of replies(w))await act(async()=>w.deliver(row));expect(task.apply()).toBe(false);}finally{await root.close();}
 expect(renderToStaticMarkup(<FleetTailPreview {...props}/>)).toContain("整单共享库存尾数试算");vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<FleetTailPreview {...props}/>);expect(en).toContain("Preview fleet tail allocation");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});
