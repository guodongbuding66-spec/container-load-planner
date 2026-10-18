import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {HandlingSequenceEditor} from "./handling-sequence-editor";
import {EquipmentActionPreflight} from "./equipment-action-preflight";
import {PalletManifest} from "./pallet-manifest";
import {setAppLanguage} from "./language";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {buildHandlingTask,setHandlingTask} from "../lib/packing/handling-sequence";
import {emptyForkInterface} from "../lib/packing/fork-interface";
const config={...DEFAULT_PALLET_BUILD.config};config.forkInterface={...emptyForkInterface(config),forkWidth:80,forkThickness:50,forkLength:1000,insertionDepth:800,spacing:344,bottomZ:24};
const plan=()=>packLoadingWorkflow({workflow:"palletized",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:4000,width:2000,height:2000,doorWidth:2000,doorHeight:2000,maxWeight:20000},products:[{id:"p",sku:"P",name:"P",length:400,width:400,height:200,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#338877"}],palletBuild:{...DEFAULT_PALLET_BUILD,config,maxPallets:1}});
const common={equipment:{name:"QA",source:"QA source",revision:"e1",bodyLength:500,bodyWidth:600,bodyHeight:700,mastDepth:100,mastWidth:600,mastHeight:1200,maxLift:200,clearance:0},site:{source:"QA site",revision:"s1",doorLeft:0,doorBottom:0,frameDepth:50,outsideLength:10000,outsideLeft:0,outsideWidth:2000,outsideHeight:3000,outsideFloor:0}};
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("exposes a separate connected task and keeps its endpoint inputs and save controls scoped",()=>{
 const p=plan(),id=p.pallets![0].id,t=buildHandlingTask(p,id,{...common,revision:"task-1",direction:"unload",outsideX:4500,lift:100,approach:500,exit:500}),saved=setHandlingTask(p,t,id),html=renderToStaticMarkup(<HandlingSequenceEditor plan={saved} id={id} common={common} disabled={false} onSave={()=>{}}/>);
 expect(html).toContain('aria-label="step-7 终点 lift mm"');expect(html).toContain("保存任务到当前方案");expect(html).toContain("起点随前一步终点联动");expect(html).toContain("落位与支承切换");expect(html).toContain("未检查");expect(html).toMatch(/disabled="">导出连贯预检 JSON/);expect(renderToStaticMarkup(<PalletManifest result={saved}/>)).toContain(`连贯搬运预检 ${id}`);
});
it("renders English connected scope without Chinese fallback or single-segment authorization",()=>{
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const p=plan(),id=p.pallets![0].id,html=renderToStaticMarkup(<EquipmentActionPreflight plan={p} id={id} initialSequence onClose={()=>{}}/>);expect(html).toContain("Connected handling preflight");expect(html).toContain("Generate / regenerate seven steps");expect(html).toContain("Turning is not executed");expect(html).not.toMatch(/[\u3400-\u9fff]/u);expect(html).not.toContain("Check current segment");
});
it("keeps orphan task records inspectable and removable when their unit disappeared",()=>{
 const p=plan(),id=p.pallets![0].id,t=buildHandlingTask(p,id,{...common,revision:"task-1",direction:"unload",outsideX:4500,lift:100,approach:500,exit:500}),saved={...setHandlingTask(p,t,id),pallets:[],placements:[]};expect(renderToStaticMarkup(<PalletManifest result={saved}/>)).toContain("task-1");expect(renderToStaticMarkup(<EquipmentActionPreflight plan={saved} id={id} initialSequence onClose={()=>{}} onHandlingTask={()=>{}}/>)).toContain("删除本托任务");
});
