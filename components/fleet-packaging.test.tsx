import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,it,expect,vi} from "vitest";
import {FleetPackagingPrices,FleetInventoryReport,FleetFiles} from "./fleet-packaging";
import {FleetPlanner} from "./planning-upgrades";
import {setAppLanguage} from "./language";
import {allocateFleet} from "../lib/packing/fleet";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import type {PackingRequest} from "../lib/packing/types";
const request:PackingRequest={workflow:"palletized",palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,looseQuantities:{p:2},config:{...DEFAULT_PALLET_BUILD.config,name:"QA pallet",length:1000,width:1000,height:100,weight:20,maxCargoHeight:200}},mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"QA vehicle",length:1500,width:1000,height:300,doorWidth:1000,doorHeight:300,maxWeight:1000},products:[{id:"p",sku:"SHED",name:"Shed carton",length:500,width:500,height:200,weight:10,quantity:12,priority:50,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,maxStackLayers:0,color:"#337788"}]};
const options=[{container:request.container,cost:100,available:4}];
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("requires explicit quotation before zero packaging price means free",()=>{
 const unknown=renderToStaticMarkup(<FleetPackagingPrices request={request} value={{currency:"CNY",packaging:{}}} onChange={()=>{}} onValidity={()=>{}} disabled={false}/>);expect(unknown).toContain('aria-label="包装已报价 QA pallet"');expect(unknown).toContain('<fieldset disabled=""');expect(unknown).toContain("未报价不按免费比较");
 const free=renderToStaticMarkup(<FleetPackagingPrices request={request} value={{currency:"USD",packaging:{primary:0}}} onChange={()=>{}} onValidity={()=>{}} disabled={false}/>);expect(free).toContain('checked=""');expect(free).not.toContain('<fieldset disabled=""');
});
it("renders actual shared inventory, loose quotas and unknown total in English",()=>{
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const result=allocateFleet(request,options,4,"count");
 const html=renderToStaticMarkup(<><FleetPackagingPrices request={request} value={{currency:"USD",packaging:{}}} onChange={()=>{}} onValidity={()=>{}} disabled={false}/><FleetInventoryReport result={result}/></>);expect(html).toContain("Packaging stock shared by the full order");expect(html).toContain("Order loose reservation");expect(html).toContain("Incomplete quotes");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
it("offers source-checked fleet restoration before a new run exists",()=>{
 const html=renderToStaticMarkup(<FleetFiles value={null} request={request} onRestore={()=>{}} onError={()=>{}} disabled={false}/>);expect(html).toContain("恢复多柜备份");expect(html).toContain('type="file"');expect(html).toMatch(/disabled="">导出全部柜方案/);
});
it("exposes the fleet planner with prebuilt pricing and an independent restore action",()=>{
 const html=renderToStaticMarkup(<FleetPlanner request={request} disabled={false}/>);expect(html).toContain("预打托规格库存、总托数和指定散装数量跨柜共用");expect(html).toContain("包装已报价 QA pallet");expect(html).toContain("恢复多柜备份");expect(html).not.toContain("运行抬升／转向检查");
});
