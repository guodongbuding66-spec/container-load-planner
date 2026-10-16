import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {CrateStackPreview,CratePreviewFallback} from "./crate-stack-preview";
import {CrateStackReport,CrateStackPreflight} from "./crate-stack-preflight";
import {setAppLanguage} from "./language";
import {planCrateUnits,proposeCrateColumn,reviewCrateStack} from "../lib/packing/crate-bearing";
import {cratePreview} from "../lib/packing/crate-preview";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {DEFAULT_PACKAGING} from "../lib/packing/packaging";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import type {ProductInput} from "../lib/packing/types";
const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:300,height:200,weight:10,quantity:2,priority:50,rotationPolicy:"fixed",stackable:false,maxStackLayers:0,color:"#338877"};
function make(offset=0){const p=packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",clearance:0,container:{id:"c",name:"C",length:600,width:500,height:1000,doorWidth:500,doorHeight:1000,maxWeight:1000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config:{...DEFAULT_PALLET_BUILD.config,length:600,width:500,height:100,maxCargoHeight:200,packaging:{...DEFAULT_PACKAGING,base:"corner-feet",enclosure:"frame"}}}}),units=proposeCrateColumn(planCrateUnits(p),[{x:offset,y:0}]);return {p,units,report:reviewCrateStack(units)};}
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("renders source IDs, four path parts and explicit packaging-only scope",()=>{
 const {units,report}=make(),html=renderToStaticMarkup(<CrateStackPreview units={units} report={report}/>);
 expect(html).toContain("不含箱内货物");expect(html).toContain('aria-label="结构预览木箱"');expect(html).toContain("底板接触片");expect(html).toContain("箱盖角部");expect(html).toContain("强度未核验");expect(html).not.toContain("采用");
});
it("preserves lower reference zones for misaligned contacts without treating them as valid support",()=>{
 const {units,report}=make(1),id=units[1].pallet.id,contact=report.contacts[0];expect(contact.covered).toBe(false);expect(contact.zone).toBeUndefined();expect(contact.referenceZone).toBeDefined();
 const data=cratePreview(units,report,id,"L0W0")!,html=renderToStaticMarkup(<><CrateStackReport report={report}/><CratePreviewFallback data={data} orbit={{yaw:0,pitch:Math.PI/2}} onOrbit={()=>{}}/></>);
 expect(html).toContain("参考位置不用于放行");expect(html).toContain('data-contact-reference="true"');expect(html).toContain('data-path-role="foot"');expect(html).not.toContain("NaN");expect(data.targets[0].x).toBe(0);expect(data.highlights[0].x).toBe(1);
});
it("renders the preview controls and all path/source explanations in English",()=>{
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const {p,units,report}=make(),data=cratePreview(units,report,units[1].pallet.id,"L0W0")!;
 const html=renderToStaticMarkup(<><CrateStackPreview units={units} report={report}/><CratePreviewFallback data={data} orbit={{yaw:.7,pitch:.4}} onOrbit={()=>{}}/><CrateStackPreflight plan={p} disabled={true}/></>);
 expect(html).toContain("Packaging only; cargo is omitted");expect(html).toContain("Inspect stack structure and paths");expect(html).toContain("Actual component intervals");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
