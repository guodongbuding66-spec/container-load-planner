import {act} from "react";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {PalletLayerTemplates} from "./pallet-layer-templates";
import {PalletManifest} from "./pallet-manifest";
import {usePlanEditor,type PlanEditor} from "./use-plan-editor";
import {setAppLanguage} from "./language";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {capturePalletLayer,editPalletContents} from "../lib/packing/pallet-edit";
import type {ProductInput} from "../lib/packing/types";
const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:300,height:200,weight:10,quantity:40,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const make=()=>packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:5000,width:2500,height:2500,doorWidth:2500,doorHeight:2500,maxWeight:10000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config:{...DEFAULT_PALLET_BUILD.config,length:800,width:600,height:100,maxCargoHeight:600,weight:25}}});
const editorFor=(plan:ReturnType<typeof make>)=>({plan,selected:[],enabled:true,disabled:false,changed:false,undo:[],redo:[],message:"",palletEdit:vi.fn()}) as unknown as PlanEditor;
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("renders named, versioned layer controls and order-based repeated stacking in both languages",()=>{const p=make(),id=p.pallets![0].id,t=capturePalletLayer(p,[product],id,0,"QA layer","1"),editor=editorFor(p),props={editor,products:[product],id,templates:[t],onChange:vi.fn(),blocked:false};const zh=renderToStaticMarkup(<PalletLayerTemplates {...props}/>);expect(zh).toContain('aria-label="层型起点 Z"');expect(zh).toContain("相邻层型交替转 180°");expect(zh).toContain("800 × 600 × 200 mm");expect(zh).toContain("任一层越界、碰撞");vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<PalletLayerTemplates {...props}/>);expect(en).toContain("Validate and add to edit draft");expect(en).toContain("Layer revision");expect(en).not.toMatch(/[\u3400-\u9fff]/u);});
it("disables applications for locked or unavailable cargo while permitting template inspection",()=>{const p=make(),id=p.pallets![0].id,t=capturePalletLayer(p,[product],id,0,"QA layer","1"),html=renderToStaticMarkup(<PalletLayerTemplates editor={editorFor(p)} products={[product]} id={id} templates={[t]} onChange={vi.fn()} blocked/>);expect(html).toContain('<fieldset disabled=""><legend>从订单余量应用层型');expect(html).toContain('QA layer · 1');});
it("retires fork and equipment task entry points from the active manifest",()=>{const p=make(),html=renderToStaticMarkup(<PalletManifest result={p} products={[product]} onAdopt={()=>{}}/>);expect(html).toContain("查看／编辑托内货物");expect(html).not.toMatch(/进叉预检|设备动作预检|连贯搬运预检/);expect(p.placements.length).toBe(24);});
it("uses one undo transaction for all repeated layers and never adopts a failed batch",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});const original=make(),id=original.pallets![0].id,t=capturePalletLayer(original,[product],id,0,"QA","1"),source=editPalletContents(original,[product],id,{type:"remove",ids:original.placements.filter(b=>b.palletIds?.includes(id)).map(b=>b.id)}),adopt=vi.fn();let editor!:PlanEditor;function Hook(){editor=usePlanEditor(source,[product],false,adopt);return <group/>;}
 const canvas={style:{}} as HTMLCanvasElement,renderer={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);await root.configure({gl:renderer,frameloop:"never",size:{width:800,height:400,top:0,left:0}});
 try{await act(async()=>root.render(<Hook/>));await act(async()=>editor.palletEdit(id,{type:"apply-layer",template:t,position:{x:0,y:0,z:0},turns:0,repeat:3,alternate180:true}));const draft=editor.plan!;expect(draft.metrics.loadedCount).toBe(24);expect(editor.undo).toHaveLength(1);expect(adopt).not.toHaveBeenCalled();await act(async()=>editor.palletEdit(id,{type:"apply-layer",template:t,position:{x:0,y:0,z:600},turns:0,repeat:2,alternate180:false}));expect(editor.plan).toBe(draft);expect(editor.undo).toHaveLength(1);await act(async()=>editor.undoEdit());expect(editor.plan).toBe(source);await act(async()=>editor.redoEdit());expect(editor.plan).toBe(draft);await act(async()=>editor.apply());expect(adopt).toHaveBeenCalledWith(draft);expect(product.quantity).toBe(40);}finally{await act(async()=>root.unmount());_roots.delete(canvas);}
});
