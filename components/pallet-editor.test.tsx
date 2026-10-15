import { act } from "react";
import { createRoot, extend, _roots } from "@react-three/fiber";
import * as THREE from "three";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { usePlanEditor, type PlanEditor } from "./use-plan-editor";
import { PalletEditorControls } from "./pallet-unit-viewer";
import { setAppLanguage } from "./language";
import { packLoadingWorkflow } from "../lib/packing/pack-loading";
import { DEFAULT_PALLET_BUILD } from "../lib/packing/loading-workflow";
import { palletOrderPool } from "../lib/packing/pallet-edit";
import type { ProductInput } from "../lib/packing/types";

const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:300,height:200,weight:10,quantity:20,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,color:"#338877"};
const make=()=>packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:4000,width:2400,height:2400,doorWidth:2400,doorHeight:2400,maxWeight:10000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config:{...DEFAULT_PALLET_BUILD.config,length:800,width:600,height:100,maxCargoHeight:400}}});
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});

it("keeps pallet edits in shared 20-step draft history, restores the order pool on undo/redo and adopts only the full plan",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});
  const source=make(),p=source.pallets![0],upper=source.placements.filter(b=>b.palletIds?.includes(p.id)&&b.z===300).map(b=>b.id);
  let editor!:PlanEditor;const adopt=vi.fn();
  function Hook(){editor=usePlanEditor(source,[product],false,adopt);return <group/>;}
  const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);
  await root.configure({gl:renderer,frameloop:"never",size:{width:800,height:400,top:0,left:0}});
  try{
    await act(async()=>root.render(<Hook/>));await act(async()=>editor.palletEdit(p.id,{type:"remove",ids:upper}));
    const draft=editor.plan!;expect(draft.metrics.loadedCount).toBe(12);expect(adopt).not.toHaveBeenCalled();expect(editor.undo).toHaveLength(1);expect(palletOrderPool(draft,[product])[0].remaining).toBe(8);
    await act(async()=>editor.undoEdit());expect(editor.plan).toBe(source);expect(palletOrderPool(editor.plan!,[product])[0].remaining).toBe(4);
    await act(async()=>editor.redoEdit());expect(editor.plan).toBe(draft);expect(editor.redo).toHaveLength(0);
    await act(async()=>editor.palletEdit(p.id,{type:"move",ids:[draft.placements[0].id],delta:{x:0,y:0,z:2000}}));expect(editor.plan).toBe(draft);expect(editor.undo).toHaveLength(1);
    await act(async()=>editor.apply());expect(adopt).toHaveBeenCalledWith(draft);expect(draft.pallets).toHaveLength(2);
    await act(async()=>editor.discard());expect(editor.plan).toBe(source);expect(editor.changed).toBe(false);expect(editor.undo).toHaveLength(0);
  }finally{await act(async()=>root.unmount());_roots.delete(canvas);}
});
it("renders accessible local-coordinate controls, physical layer choices and the complete order pool in both languages",()=>{
  const plan=make(),id=plan.pallets![0].id;
  const editor={plan,selected:[],enabled:false,disabled:false,changed:false,undo:[],redo:[],message:"",select:vi.fn(),selectMany:vi.fn(),update:vi.fn(),palletEdit:vi.fn(),undoEdit:vi.fn(),redoEdit:vi.fn(),discard:vi.fn()} as unknown as PlanEditor;
  vi.stubGlobal("document",{documentElement:{lang:""}});
  const zh=renderToStaticMarkup(<PalletEditorControls editor={editor} products={[product]} id={id}/>);
  expect(zh).toContain("完整订单与待分配余量");expect(zh).toContain('aria-label="托内目标 X"');expect(zh).toContain('<fieldset disabled=""');expect(zh).toContain('0–200 mm');expect(zh).toContain('200–400 mm');expect(zh).toContain("清空某托仍保留托盘及自重");
  setAppLanguage("en");const en=renderToStaticMarkup(<PalletEditorControls editor={{...editor,enabled:true}} products={[product]} id={id}/>);
  expect(en).toContain("Add one carton / kit from pool");expect(en).toContain("Complete order and unassigned pool");expect(en).not.toMatch(/[\u3400-\u9fff]/u);expect(en).not.toContain('<fieldset disabled=""');
});
