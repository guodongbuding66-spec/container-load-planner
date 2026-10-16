import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PalletManifest} from "./pallet-manifest";
import {setAppLanguage} from "./language";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import type {ProductInput} from "../lib/packing/types";
const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:400,height:200,weight:10,quantity:5,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#338877"};
const big={...DEFAULT_PALLET_BUILD.config,name:"<Big>",length:800,width:800,height:100,weight:20,maxCargoHeight:200};
const make=()=>packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"v",name:"V",length:4000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:2000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,config:big,selection:"compact",additionalSpecs:[{id:"small",config:{...big,name:"Small",length:400,width:400,height:50,weight:8},maxPallets:10,stackLayers:1,maxTopLoadKg:0}]}});
beforeEach(()=>vi.stubGlobal("document",{documentElement:{lang:""}}));
afterEach(()=>{setAppLanguage("zh");vi.unstubAllGlobals();});
it("renders both selected specifications, actual envelopes and localized generation reasons",()=>{
 const result=make(),html=renderToStaticMarkup(<PalletManifest result={result}/>);
 expect(html).toContain("包装自动比选依据（生成时记录）");expect(html).toContain("按优先顺序可装更多货物");expect(html).toContain("同优先货量，外包络更小");expect(html).toContain("400 × 400 × 250");expect(html).toContain("&lt;Big&gt;");expect(html.match(/>已选</g)).toHaveLength(2);
});
it("shows cleared generation records without pretending edited contents were compared",()=>{
 setAppLanguage("en");const result=make();result.palletization!.selectionChoices=undefined;
 const html=renderToStaticMarkup(<PalletManifest result={result}/>);
 expect(html).toContain("No generation records; rebuild pallets");expect(html).not.toContain("More cargo in priority order");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
