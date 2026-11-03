import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {usePalletTailTrial,PalletTailTrial} from "./pallet-tail-trial";
import {runOrderCapacityTrial} from "../lib/packing/order-capacity";
import {palletTailFixture,jointPalletTailFixture,triplePalletTailFixture,economicTailFixture,quadruplePalletTailFixture} from "../tests/pallet-tail-fixture";
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
  await act(async()=>w.deliver({index:0,plan:runOrderCapacityTrial(trials[0])}));expect(task.current?.best).toBeUndefined();expect(task.getReport()).toBeUndefined();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
  for(let index=1;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));
  expect(task.current?.status).toBe("done");expect(task.best?.plan.metrics.loadedCount).toBe(16);expect(props.plan.metrics.loadedCount).toBe(8);expect(props.request.products[0].quantity).toBe(20);expect(props.onApply).not.toHaveBeenCalled();expect(task.getReport()?.selectedCandidate?.loaded).toBe(16);
  const oldCost=task.getCostReport;expect(oldCost({freight:100,pricing:{currency:"CNY",packaging:{primary:20}}})).toMatchObject({status:"preview-not-applied",comparison:{complete:true,before:{loaded:8},after:{loaded:16}}});expect(props.onApply).not.toHaveBeenCalled();
  await act(async()=>task.adopt());expect(props.onApply.mock.calls[0][0].looseQuantities).toEqual({a:8});expect(w.terminate).toHaveBeenCalled();
  await act(async()=>task.setSearchMode("detailed"));expect(oldCost({freight:100,pricing:{currency:"CNY",packaging:{primary:20}}})).toBeUndefined();
 }finally{await root.close();}
});
it.each(["cancel","timeout","worker"])("discards partial batches on %s and ignores late final results",async kind=>{
 const props=defaults();let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{vi.useFakeTimers();await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;
  await act(async()=>w.deliver({index:0,plan:runOrderCapacityTrial(trials[0])}));
  if(kind==="cancel")await act(async()=>task.cancel());else if(kind==="timeout")await act(async()=>vi.advanceTimersByTime(30001));else await act(async()=>w.onerror?.());
  for(let index=1;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));
  expect(task.best).toBeUndefined();expect(task.getReport()).toBeUndefined();expect(w.terminate).toHaveBeenCalled();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
 }finally{await root.close();}
});
it("invalidates a preview after a parameter round trip and rejects its old replies",async()=>{
 let props=defaults(),task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials,original=props;
  props={...props,request:{...props.request,clearance:1}};await root.render();props=original;await root.render();
  for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));
  expect(task.current).toBeNull();expect(task.getReport()).toBeUndefined();expect(w.terminate).toHaveBeenCalled();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
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
it("invalidates quick previews when switching to every-quantity mode and selects the leaner tie",async()=>{
 const request=palletTailFixture();request.container.height=600;request.container.doorHeight=600;const props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{
  await act(async()=>task.run());const old=FakeWorker.instances[0],oldTrials=old.postMessage.mock.calls[0][0].trials;
  await act(async()=>task.setSearchMode("detailed"));expect(old.terminate).toHaveBeenCalled();await act(async()=>old.deliver({index:0,plan:runOrderCapacityTrial(oldTrials[0])}));expect(task.current).toBeNull();
  await act(async()=>task.run());const w=FakeWorker.instances[1],trials=w.postMessage.mock.calls[0][0].trials;expect(trials).toHaveLength(8);
  for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));
  expect(task.best?.trial.tailReservationChange!.units).toBe(6);expect(task.best?.plan.metrics.loadedCount).toBe(14);await act(async()=>task.adopt());expect(props.onApply.mock.calls[0][0].looseQuantities).toEqual({a:6});
 }finally{await root.close();}
});

it("jointly applies two order-row reservations after the entire grid finishes",async()=>{
 const request=jointPalletTailFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{
  await act(async()=>{task.setSearchMode("joint");task.setChoice({id:"row:a",limit:"4"});task.setSecondChoice({id:"row:b",limit:"4"});});await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;expect(trials).toHaveLength(24);
  for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));
  expect(task.best?.plan.metrics.loadedCount).toBe(24);expect(props.onApply).not.toHaveBeenCalled();expect(task.current?.rows.every(r=>r.allocation?.includes("TAIL-A")&&r.allocation.includes("TAIL-B"))).toBe(true);
  await act(async()=>task.adopt());expect(props.onApply.mock.calls[0][0].looseQuantities).toEqual({a:4,b:4});expect(request.products.map(p=>p.quantity)).toEqual([12,12]);
 }finally{await root.close();}
});
it("does not run an oversized joint grid and retains the original request",async()=>{
 const request=jointPalletTailFixture();request.products.forEach(p=>p.quantity=100);const props={...defaults(),request,plan:packLoadingWorkflow(request)},before=structuredClone(request);let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>{task.setSearchMode("joint");task.setChoice({id:"row:a",limit:"8"});task.setSecondChoice({id:"row:b",limit:"8"});});expect(task.jointTooLarge).toBe(true);expect(task.validLimit).toBe(false);await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);expect(request).toEqual(before);}finally{await root.close();}
});
it("drops a joint batch after a secondary-ceiling round trip",async()=>{
 const request=jointPalletTailFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.setSearchMode("joint"));await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;
  await act(async()=>task.setSecondChoice({id:"row:b",limit:"2"}));await act(async()=>task.setSecondChoice({id:"row:b",limit:"3"}));
  for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));expect(task.current).toBeNull();expect(task.getReport()).toBeUndefined();expect(w.terminate).toHaveBeenCalled();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
 }finally{await root.close();}
});
it("exposes the joint and detailed controls with keyboard-accessible native fields",()=>{
 const request=jointPalletTailFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request)};const zh=renderToStaticMarkup(<PalletTailTrial {...props}/>);expect(zh).toContain("尾数搜索范围");expect(zh).toContain("逐量细查");expect(zh).toContain("两组联合");
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<PalletTailTrial {...props}/>);expect(en).toContain("Two groups together");expect(en).toContain("Every quantity");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
});

it("adopts all three row allocations only after the complete grid",async()=>{
 const request=triplePalletTailFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.setSearchMode("triple"));expect(task.jointGrid).toBe(26);await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;expect(trials).toHaveLength(26);
  for(let index=0;index<trials.length-1;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));expect(task.best).toBeUndefined();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
  const index=trials.length-1;await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));expect(task.best?.plan.metrics.loadedCount).toBe(30);await act(async()=>task.adopt());expect(props.onApply.mock.calls[0][0].looseQuantities).toEqual({a:2,b:2,c:2});
 }finally{await root.close();}
});
it.each(["ceiling","third row","mode"])("invalidates a three-group batch on %s round trip",async kind=>{
 const request=triplePalletTailFixture();request.products.push({...request.products[2],id:"d",sku:"D"});const props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.setSearchMode("triple"));await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;
  if(kind==="mode"){await act(async()=>task.setSearchMode("joint"));await act(async()=>task.setSearchMode("triple"));}else{await act(async()=>task.setThirdChoice({id:kind==="third row"?"row:d":"row:c",limit:"1"}));await act(async()=>task.setThirdChoice({id:"row:c",limit:"2"}));}
  for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));expect(task.current).toBeNull();expect(task.getReport()).toBeUndefined();expect(w.terminate).toHaveBeenCalled();await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();
 }finally{await root.close();}
});
it("rejects an oversized triple grid and missing third group before creating a Worker",async()=>{
 let request=triplePalletTailFixture();request.products.forEach(p=>p.quantity=100);let props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>{task.setSearchMode("triple");task.setChoice({id:"row:a",limit:"4"});task.setSecondChoice({id:"row:b",limit:"4"});task.setThirdChoice({id:"row:c",limit:"4"});});expect(task.jointGrid).toBe(124);expect(task.validLimit).toBe(false);await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);
  request=jointPalletTailFixture();props={...defaults(),request,plan:packLoadingWorkflow(request)};await root.render();expect(task.thirdGroup).toBeUndefined();expect(task.validLimit).toBe(false);await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);
 }finally{await root.close();}
});

it("only exports a current complete report, including no-improvement batches",async()=>{
 const request=palletTailFixture();request.palletBuild!.config.length=1200;const props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{expect(task.getReport()).toBeUndefined();await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));const getOld=task.getReport,getOldCost=task.getCostReport;expect(getOldCost({freight:100,pricing:{currency:"CNY",packaging:{}}})).toBeUndefined();expect(getOld()).toMatchObject({complete:true,selectedCandidate:null,status:"preview-not-applied"});
  await act(async()=>task.setSearchMode("detailed"));await act(async()=>task.setSearchMode("quick"));expect(getOld()).toBeUndefined();expect(getOldCost({freight:100,pricing:{currency:"CNY",packaging:{}}})).toBeUndefined();expect(task.getReport()).toBeUndefined();expect(props.onApply).not.toHaveBeenCalled();
 }finally{await root.close();}
});

it("retains actual usage for every reviewed tail and explicitly applies a cheaper same-delivery allocation",async()=>{
 const {request,baseline}=economicTailFixture(),props={request,plan:baseline,disabled:false,canApply:true,onApply:vi.fn()};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);try{await act(async()=>task.setSearchMode("detailed"));await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;
  for(let index=0;index<trials.length-1;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));expect(task.adoptCandidate(task.current!.rows[0])).toBe(false);
  const last=trials.length-1;await act(async()=>w.deliver({index:last,plan:runOrderCapacityTrial(trials[last])}));expect(task.current!.rows).toHaveLength(6);expect(task.best!.trial.tailReservationChange!.units).toBe(1);const row=task.current!.rows[5];expect(row.costBasis).toMatchObject({loose:6,packagingIds:["primary"],rows:[{id:"a",loaded:14}]});expect(task.adoptCandidate(structuredClone(row))).toBe(false);expect(props.onApply).not.toHaveBeenCalled();await act(async()=>{expect(task.adoptCandidate(row)).toBe(true);});const build=props.onApply.mock.calls[0][0];expect(build.looseQuantities).toEqual({a:6});expect(build.maxPallets).toBe(2);expect(request.products[0].quantity).toBe(14);expect(baseline.metrics.loadedCount).toBe(8);
 }finally{await root.close();}
});
it.each(["rerun","round trip","issued","unmount","cancel"])("rejects captured adoption and report methods after %s",async kind=>{
 const {request,baseline}=economicTailFixture();let props={request,plan:baseline,disabled:false,canApply:true,onApply:vi.fn()},task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}
 const root=await mount(Hook);let closed=false;try{await act(async()=>task.setSearchMode("detailed"));await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));const oldAdopt=task.adoptCandidate,oldQuantityAdopt=task.adopt,oldReport=task.getReport,oldCost=task.getCostReport,row=task.current!.rows[5];
  if(kind==="rerun")await act(async()=>task.run());else if(kind==="round trip"){await act(async()=>task.setChoice({id:"row:a",limit:"5"}));await act(async()=>task.setChoice({id:"row:a",limit:"6"}));}else if(kind==="issued"){props={...props,canApply:false};await root.render();}else if(kind==="unmount"){await root.close();closed=true;}else await act(async()=>task.cancel());
  expect(oldAdopt(row)).toBe(false);oldQuantityAdopt();expect(oldReport()).toBeUndefined();expect(oldCost({freight:100,pricing:{currency:"CNY",packaging:{primary:20}}})).toBeUndefined();expect(props.onApply).not.toHaveBeenCalled();
 }finally{if(!closed)await root.close();}
});

it("adopts four original rows only after all fifteen independently reviewed allocations finish",async()=>{
 const request=quadruplePalletTailFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}const root=await mount(Hook);try{await act(async()=>task.setSearchMode("quad"));expect(task.jointGrid).toBe(15);expect(task.fourthGroup?.id).toBe("row:d");await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;expect(trials).toHaveLength(15);for(let index=0;index<14;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));await act(async()=>task.adopt());expect(props.onApply).not.toHaveBeenCalled();await act(async()=>w.deliver({index:14,plan:runOrderCapacityTrial(trials[14])}));expect(task.best!.plan.metrics.loadedCount).toBe(36);expect(task.getReport()!.scope.groups).toHaveLength(4);expect(task.getReport()!.scope.mode).toBe("quad");await act(async()=>task.adopt());expect(props.onApply.mock.calls[0][0].looseQuantities).toEqual({a:1,b:1,c:1,d:1});expect(request.products.map(p=>p.quantity)).toEqual([9,9,9,9]);}finally{await root.close();}
});
it.each(["fourth ceiling","fourth row","mode"])("invalidates complete four-group results after a %s round trip",async kind=>{
 const request=quadruplePalletTailFixture();request.products.push({...request.products[3],id:"e",sku:"TAIL-E"});const props={...defaults(),request,plan:packLoadingWorkflow(request)};let task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}const root=await mount(Hook);try{await act(async()=>task.setSearchMode("quad"));await act(async()=>task.run());const w=FakeWorker.instances[0],trials=w.postMessage.mock.calls[0][0].trials;for(let index=0;index<trials.length;index++)await act(async()=>w.deliver({index,plan:runOrderCapacityTrial(trials[index])}));const oldReport=task.getReport,oldAdopt=task.adopt;
 if(kind==="mode"){await act(async()=>task.setSearchMode("triple"));await act(async()=>task.setSearchMode("quad"));}else{await act(async()=>task.setFourthChoice({id:kind==="fourth row"?"row:e":"row:d",limit:"0"}));await act(async()=>task.setFourthChoice({id:"row:d",limit:"1"}));}expect(oldReport()).toBeUndefined();oldAdopt();expect(task.current).toBeNull();expect(props.onApply).not.toHaveBeenCalled();}finally{await root.close();}
});
it("blocks a missing fourth group and an eighty-allocation grid before starting a worker",async()=>{
 let request=quadruplePalletTailFixture();request.products.forEach(p=>p.quantity=20);let props={...defaults(),request,plan:packLoadingWorkflow(request)},task!:ReturnType<typeof usePalletTailTrial>;function Hook(){task=usePalletTailTrial(props);return <group/>;}const root=await mount(Hook);try{await act(async()=>{task.setSearchMode("quad");task.setChoice({id:"row:a",limit:"2"});task.setSecondChoice({id:"row:b",limit:"2"});task.setThirdChoice({id:"row:c",limit:"2"});task.setFourthChoice({id:"row:d",limit:"2"});});expect(task.jointGrid).toBe(80);expect(task.validLimit).toBe(false);await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);request=triplePalletTailFixture();props={...defaults(),request,plan:packLoadingWorkflow(request)};await root.render();expect(task.fourthGroup).toBeUndefined();expect(task.validLimit).toBe(false);await act(async()=>task.run());expect(FakeWorker.instances).toHaveLength(0);}finally{await root.close();}
});
it("translates and exposes the four-group scope without Chinese labels in English",()=>{
 const request=quadruplePalletTailFixture(),props={...defaults(),request,plan:packLoadingWorkflow(request)};expect(renderToStaticMarkup(<PalletTailTrial {...props}/>)).toContain("四组联合");vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const html=renderToStaticMarkup(<PalletTailTrial {...props}/>);expect(html).toContain("Four groups together");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
