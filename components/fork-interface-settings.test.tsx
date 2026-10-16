import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {setAppLanguage} from "./language";
import {ForkInterfaceSettings} from "./fork-interface-settings";
import {ForkUnitPreflight} from "./fork-unit-preflight";
import {PackagingEditor} from "./packaging-editor";
import {TransportAppearanceProvider} from "./transport-appearance";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {DEFAULT_PACKAGING,baseMeasurements} from "../lib/packing/packaging";
import {emptyForkInterface,forkEvidenceKey} from "../lib/packing/fork-interface";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import type {ProductInput} from "../lib/packing/types";
const config={...DEFAULT_PALLET_BUILD.config,name:"Pallet A",length:1200,width:800,height:144,maxCargoHeight:400,packaging:{...DEFAULT_PACKAGING,measurements:{...baseMeasurements(1200,800,144,DEFAULT_PACKAGING),source:"Measured A",revision:"v1"}}};
const probe={...emptyForkInterface(config),forkWidth:80,forkThickness:40,forkLength:1000,insertionDepth:800,spacing:344,bottomZ:24,source:"Measured truck",revision:"v1"};
const value={...config,forkInterface:probe};
beforeEach(()=>vi.stubGlobal("document",{documentElement:{lang:""}}));afterEach(()=>{setAppLanguage("zh");vi.unstubAllGlobals();});
it("renders measured dimensions, actual channels and independent load ratings in English",()=>{
 setAppLanguage("en");const html=renderToStaticMarkup(<ForkInterfaceSettings value={value} onChange={()=>{}} onValidityChange={()=>{}}/>);
 expect(html).toContain("Measured base and fork preflight");expect(html).toContain("Full-depth fork-channel cross-section projection");expect(html).toContain('aria-label="Measured deck thickness"');expect(html).toContain("Static payload rating kg");expect(html).toContain("Dynamic payload rating kg");expect(html).toContain("Rack payload rating kg");expect(html).toContain("Evidence or measurement review missing");expect(html).toContain("does not authorize operations");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
it("keeps invalid measured drafts editable and unreviewed without rendering a broken model",()=>{
 const invalid={...value,packaging:{...value.packaging,measurements:{...value.packaging.measurements,deckThickness:144}}};
 const html=renderToStaticMarkup(<TransportAppearanceProvider><PackagingEditor value={invalid} onChange={()=>{}} onValidityChange={()=>{}}/></TransportAppearanceProvider>);
 expect(html).toContain('aria-label="实测面板厚"');expect(html).toContain('role="alert"');expect(html).toContain("先修正底座尺寸");expect(html).toContain("实测底座部件超出底座外包络");
 setAppLanguage("en");expect(renderToStaticMarkup(<TransportAppearanceProvider><PackagingEditor value={invalid} onChange={()=>{}} onValidityChange={()=>{}}/></TransportAppearanceProvider>)).toContain("Measured base parts exceed the base envelope");
});
it("keeps missing parameters unverified and disables measured controls for a solid base",()=>{
 const html=renderToStaticMarkup(<ForkInterfaceSettings value={{...config,packaging:{...DEFAULT_PACKAGING,base:"solid"}}} onChange={()=>{}} onValidityChange={()=>{}}/>);
 expect(html).toContain("叉具几何未核验");expect(html).toContain("无贯通矩形净孔");expect(html).toMatch(/aria-label="使用实测底座尺寸" disabled=""/);
});
it("renders a current review without allowing it to override blocked geometry",()=>{
 const blocked={...value,forkInterface:{...probe,forkThickness:130}};blocked.forkInterface.reviewedFor=forkEvidenceKey(blocked);
 const html=renderToStaticMarkup(<ForkInterfaceSettings value={blocked} onChange={()=>{}} onValidityChange={()=>{}}/>);expect(html).toContain("所填叉具几何不通过");expect(html).toContain("当前资料已核对");expect(html).toContain('aria-label="已核对当前底座与叉具实测资料" checked=""');
});
it("shows individual unit scope and exports a report without an adopt control",()=>{
 const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:400,height:200,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#338877"};
 const plan=packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",container:{id:"c",name:"C",length:4000,width:2000,height:2000,doorWidth:2000,doorHeight:2000,maxWeight:20000},clearance:0,products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,config:value}});
 const html=renderToStaticMarkup(<ForkUnitPreflight plan={plan} id={plan.pallets![0].id} onClose={()=>{}}/>);expect(html).toContain("编组区坐标不代表实际作业场地");expect(html).toContain("导出进叉预检 JSON");expect(html).toContain("完全抽叉扫掠包络");expect(html).not.toContain("采用");
});
