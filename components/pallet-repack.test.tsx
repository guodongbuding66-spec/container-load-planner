import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {usePlanEditor,type PlanEditor} from "./use-plan-editor";
import {PalletRepackControls,usePalletRepackPreview} from "./pallet-repack-controls";
import {PalletRefillControls} from "./pallet-refill-controls";
import {usePalletSearch} from "./use-pallet-search";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {DEFAULT_PACKAGING} from "../lib/packing/packaging";
import {editPalletContents} from "../lib/packing/pallet-edit";
import {repackPalletContents} from "../lib/packing/pallet-repack";
import {refillPalletContents} from "../lib/packing/pallet-refill";
import {setAppLanguage} from "./language";
import type {ProductInput} from "../lib/packing/types";

const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:300,height:200,weight:10,quantity:20,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"},products=[product];
function make(){
  const plan=packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:5000,width:2500,height:2500,doorWidth:2500,doorHeight:2500,maxWeight:10000},products,palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config:{...DEFAULT_PALLET_BUILD.config,length:800,width:600,height:100,maxCargoHeight:600,packaging:{...DEFAULT_PACKAGING,base:"solid"}}}}),p=plan.pallets![0];
  return editPalletContents(plan,products,p.id,{type:"remove",ids:plan.placements.filter(b=>b.palletIds?.[0]===p.id&&(b.x!==0||b.y!==0)).map(b=>b.id)});
}
class FakeWorker{
  static instances:FakeWorker[]=[];
  onmessage:((e:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;
  postMessage=vi.fn();terminate=vi.fn();
  constructor(){FakeWorker.instances.push(this);}
  deliver(data:unknown){this.onmessage?.({data} as MessageEvent);}
}
async function mount(Hook:()=>React.ReactNode){
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});vi.stubGlobal("Worker",FakeWorker);
  const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);
  await root.configure({gl:renderer,frameloop:"never",size:{width:800,height:400,top:0,left:0}});await act(async()=>root.render(<Hook/>));
  return {render:()=>act(async()=>root.render(<Hook/>)),close:async()=>{await act(async()=>root.unmount());_roots.delete(canvas);}};
}
afterEach(()=>{vi.useRealTimers();FakeWorker.instances=[];vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});

it("keeps worker previews separate, commits one draft transaction and shares undo, redo and apply",async()=>{
  const source=make(),id=source.pallets![0].id,onAdopt=vi.fn(),pending=vi.fn();let editor!:PlanEditor,preview!:ReturnType<typeof usePalletRepackPreview>;
  function Hook(){editor=usePlanEditor(source,products,false,onAdopt);preview=usePalletRepackPreview(editor.plan!,products,id,false,pending);return <group/>;}
  const root=await mount(Hook);
  try{
    await act(async()=>preview.run());const w=FakeWorker.instances.at(-1)!;expect(preview.running).toBe(true);expect(pending).toHaveBeenLastCalledWith(true);expect(w.postMessage).toHaveBeenCalledWith({plan:source,products,id});
    const r=repackPalletContents(source,products,id);await act(async()=>w.deliver({ok:true,result:r}));expect(preview.result?.improved).toBe(true);expect(editor.changed).toBe(false);expect(editor.undo).toHaveLength(0);expect(onAdopt).not.toHaveBeenCalled();
    await act(async()=>editor.palletEdit(id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey}));const draft=editor.plan!;
    expect(editor.undo).toHaveLength(1);expect(preview.result).toBeNull();expect(draft.metrics.grossWeight).toBe(source.metrics.grossWeight);
    await act(async()=>editor.undoEdit());expect(editor.plan).toBe(source);expect(preview.result).toBeNull();
    await act(async()=>editor.redoEdit());expect(editor.plan).toBe(draft);await act(async()=>editor.apply());expect(onAdopt).toHaveBeenCalledWith(draft);
    await act(async()=>editor.discard());expect(editor.changed).toBe(false);expect(editor.undo).toHaveLength(0);
  }finally{await root.close();}
});
it("cancels workers, ignores late messages and invalidates previews after scope changes",async()=>{
  let source=make(),blocked=false,preview!:ReturnType<typeof usePalletRepackPreview>;const id=source.pallets![0].id,pending=vi.fn();
  function Hook(){preview=usePalletRepackPreview(source,products,id,blocked,pending);return <group/>;}
  const root=await mount(Hook);
  try{
    await act(async()=>preview.run());const canceled=FakeWorker.instances.at(-1)!;await act(async()=>preview.cancel());await act(async()=>canceled.deliver({ok:true,result:repackPalletContents(source,products,id)}));expect(canceled.terminate).toHaveBeenCalled();expect(preview.result).toBeNull();expect(preview.running).toBe(false);
    await act(async()=>preview.run());const stale=FakeWorker.instances.at(-1)!,old=source;source=editPalletContents(source,products,id,{type:"lock-others",locked:true});await root.render();await act(async()=>stale.deliver({ok:true,result:repackPalletContents(old,products,id)}));expect(stale.terminate).toHaveBeenCalled();expect(preview.result).toBeNull();expect(pending).toHaveBeenLastCalledWith(false);
    await act(async()=>preview.run());const changed=FakeWorker.instances.at(-1)!;blocked=true;await root.render();expect(changed.terminate).toHaveBeenCalled();expect(preview.running).toBe(false);
  }finally{await root.close();}
});
it("stops at the worker deadline and does not accept an error or late result",async()=>{
  const source=make(),id=source.pallets![0].id;let preview!:ReturnType<typeof usePalletRepackPreview>;
  function Hook(){preview=usePalletRepackPreview(source,products,id,false);return <group/>;}
  const root=await mount(Hook);
  try{
    vi.useFakeTimers();await act(async()=>preview.run());const w=FakeWorker.instances.at(-1)!;await act(async()=>vi.advanceTimersByTime(10001));expect(w.terminate).toHaveBeenCalled();expect(preview.running).toBe(false);expect(preview.message).toMatch(/10 秒/);await act(async()=>w.deliver({ok:true,result:{improved:true}}));expect(preview.result).toBeNull();
    await act(async()=>preview.run());await act(async()=>FakeWorker.instances.at(-1)!.deliver({ok:false,error:"原方案保留 / Original layout retained"}));expect(preview.message).toContain("原方案保留");expect(preview.result).toBeNull();
  }finally{await root.close();}
});
it.each(["zh","en"] as const)("renders bounded, accessible local-repacking controls in %s",language=>{
  vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage(language);const plan=make(),editor={plan,palletEdit:vi.fn()} as unknown as PlanEditor;
  const html=renderToStaticMarkup(<PalletRepackControls editor={editor} products={products} id={plan.pallets![0].id} blocked/>);
  expect(html).toContain('disabled=""');expect(html).toContain('aria-live="polite"');expect(html).toContain("160");
  if(language==="en"){expect(html).toContain("Local pallet repacking");expect(html).toContain("four cancellable search passes");expect(html).not.toMatch(/[\u3400-\u9fff]/u);}else expect(html).toContain("其他整托不移动");
});

it("previews a refill without editing, then adds it in one undoable transaction",async()=>{
  const source=make(),id=source.pallets![0].id,onAdopt=vi.fn(),pending=vi.fn();
  let editor!:PlanEditor,preview!:ReturnType<typeof usePalletSearch<"refill">>;
  function Hook(){editor=usePlanEditor(source,products,false,onAdopt,true);preview=usePalletSearch("refill",editor.plan!,products,id,false,pending);return <group/>;}
  const root=await mount(Hook);
  try{
    await act(async()=>preview.run());
    const worker=FakeWorker.instances.at(-1)!;
    expect(worker.postMessage).toHaveBeenCalledWith({plan:source,products,id,operation:"refill"});
    expect(pending).toHaveBeenLastCalledWith(true);
    const result=refillPalletContents(source,products,id);
    expect(result.additions.length).toBeGreaterThan(0);
    await act(async()=>worker.deliver({ok:true,result}));
    expect(editor.plan).toBe(source);
    expect(preview.result).toBe(result);
    expect(pending).toHaveBeenLastCalledWith(false);
    await act(async()=>editor.palletEdit(id,{type:"refill",sourceKey:result.sourceKey,additions:result.additions}));
    const draft=editor.plan!;
    expect(draft.metrics.loadedCount).toBe(source.metrics.loadedCount+result.additions.length);
    expect(editor.undo).toEqual([source]);
    expect(preview.result).toBeNull();
    await act(async()=>editor.undoEdit());expect(editor.plan).toBe(source);expect(preview.result).toBeNull();
    await act(async()=>editor.redoEdit());expect(editor.plan).toBe(draft);
    await act(async()=>editor.apply());expect(onAdopt).toHaveBeenCalledWith(draft);
  }finally{await root.close();}
});

it.each(["zh","en"] as const)("renders the refill search entry in %s",language=>{
  vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage(language);
  const plan=make(),editor={plan} as PlanEditor;
  const html=renderToStaticMarkup(<PalletRefillControls editor={editor} products={products} id={plan.pallets![0].id} blocked={false} onPendingChange={vi.fn()}/>);
  expect(html).toContain('role="status"');
  expect(html).toContain(language==="zh"?"预览本托自动补货":"Preview automatic pallet refill");
});
