import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {OrthographicViews} from "./orthographic-views";
import {pack} from "../lib/packing/engine";
import type {ProductInput} from "../lib/packing/types";
import {TransportAppearanceProvider} from "./transport-appearance";
import {FloorPalletSettings} from "./floor-pallet-settings";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {SiteExclusionSettings} from "./site-exclusion-settings";
import {setAppLanguage} from "./language";
const c={id:"c",name:"C",length:1000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:1000,exclusions:[{id:"a",name:"<Obstacle>",kind:"reserved" as const,x:10,y:0,z:0,dx:100,dy:100,dz:100}]};
beforeEach(()=>vi.stubGlobal("document",{documentElement:{lang:""}}));afterEach(()=>{setAppLanguage("zh");vi.unstubAllGlobals();});
it("renders physical coordinates, region purpose and union-volume accounting in English",()=>{
 setAppLanguage("en");const html=renderToStaticMarkup(<SiteExclusionSettings container={c} clearance={10} onChange={()=>{}} onValidityChange={()=>{}}/>);
 expect(html).toContain("Obstacles and keep-clear regions");expect(html).toContain("physical inner nose");expect(html).toContain("&lt;Obstacle&gt;");expect(html).toContain('aria-label="Region 1 dx"');expect(html).toContain('value="reserved" selected=""');expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
it("exposes invalid bounds and unsupported workflows while retaining a removal action",()=>{
 for(const props of [{container:{...c,width:50}},{container:c,only:true}]){
 const html=renderToStaticMarkup(<SiteExclusionSettings {...props} clearance={0} onChange={()=>{}} onValidityChange={()=>{}}/>);expect(html).toContain('role="alert"');expect(html).toContain("删除区域");expect(html).toContain('disabled=""');
 }
});

it("keeps site regions in print projections when all cargo is hidden without inflating occupied extents",()=>{
 const p:ProductInput={id:"p",sku:"P",name:"P",length:200,width:200,height:200,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#338877"},result=pack({mode:"mixed",strategy:"maximum",container:c,clearance:0,products:[p]});
 const html=renderToStaticMarkup(<OrthographicViews result={result} visibleProducts={new Set()} visibleCount={0} primaryCountLabel="0" renderPrintSvg activeView="top" onViewSelect={()=>{}}/>);expect(html.match(/#8571b5/g)).toHaveLength(3);expect(html).not.toContain("P</title>");expect(html).toContain("0 mm");expect(html).not.toContain("1 个托盘");expect(html).toContain("俯视图，当前显示 0 箱");
});

it.each([false,true])("renders the floor preview while invalid site drafts remain editable (floor enabled: %s)",enabled=>{
 for(const bad of [{...c.exclusions[0],x:950},{...c.exclusions[0],name:""}]){
  const container={...c,exclusions:[bad]};
  const html=renderToStaticMarkup(<TransportAppearanceProvider><FloorPalletSettings inline container={container} clearance={0} customSpaces={[]} config={enabled?DEFAULT_PALLET_BUILD.config:undefined} onSave={()=>{}} onClose={()=>{}}/><SiteExclusionSettings container={container} clearance={0} onChange={()=>{}} onValidityChange={()=>{}}/></TransportAppearanceProvider>);
  expect(html).toContain('role="alert"');expect(html).toContain('aria-label="区域 1 x"');expect(html).toContain("删除区域");
  if(enabled)expect(html).toContain("0.00");
 }
});
