import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { CrateBearingSettings } from "./crate-bearing-settings";
import { CrateStackReport, CrateStackPreflight } from "./crate-stack-preflight";
import { SceneLoadPanel } from "./scene-load-panel";
import { setAppLanguage } from "./language";
import { crateEvidenceKey, emptyCrateBearing, planCrateUnits, proposeCrateColumn, reviewCrateStack } from "../lib/packing/crate-bearing";
import { DEFAULT_PALLET_BUILD } from "../lib/packing/loading-workflow";
import { DEFAULT_PACKAGING } from "../lib/packing/packaging";
import { packLoadingWorkflow } from "../lib/packing/pack-loading";
import { analyzeLoads } from "../lib/packing/load-analysis";
import type { FloorPalletConfig, ProductInput } from "../lib/packing/types";

afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
function make(){const config:FloorPalletConfig={...DEFAULT_PALLET_BUILD.config,length:600,width:500,height:100,maxCargoHeight:200,packaging:{...DEFAULT_PACKAGING,base:"corner-feet",enclosure:"frame",wallThickness:30}};
  config.crateBearing={...emptyCrateBearing(),policy:"rated",revision:"TEST-ONLY",source:"Synthetic test only",conditions:"Not production evidence",maxTopLoadKg:1000,maxLayers:3,columnCapacityKg:{L0W0:2000,L0W1:2000,L1W0:2000,L1W1:2000},reviewed:true};config.crateBearing.reviewedFor=crateEvidenceKey(config);
  const product:ProductInput={id:"p",sku:"P",name:"P",length:500,width:400,height:200,weight:10,quantity:2,priority:50,rotationPolicy:"fixed",stackable:false,maxStackLayers:0,color:"#338877"};
  const plan=packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:600,width:500,height:1000,doorWidth:500,doorHeight:1000,maxWeight:1000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,config,maxPallets:2}});return {config,plan,product};}
it("renders source-bound corner ratings and a reviewed checkbox without suggesting automatic stacking",()=>{
  const {config}=make(),html=renderToStaticMarkup(<CrateBearingSettings value={config} onChange={()=>{}} onValidityChange={()=>{}}/>);
  expect(html).toContain('aria-label="木箱额定顶载"');expect(html).toContain('aria-label="木箱路径额定值 L1W1"');expect(html).toContain("资料已核对");expect(html).toContain("主求解器仍将木箱底置");expect(html).toContain("不假设四角均分");
  const stale=renderToStaticMarkup(<CrateBearingSettings value={{...config,length:601}} onChange={()=>{}} onValidityChange={()=>{}}/>);expect(stale).toContain("结构或资料已改变");expect(stale).not.toContain('checked=""/>已人工核对');
});
it("renders preflight outcomes, source identities and the full-mass bound in English without residual Chinese",()=>{
  vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const {config,plan}=make(),units=planCrateUnits(plan),report=reviewCrateStack(proposeCrateColumn(units,[{x:0,y:0}]));
  const html=renderToStaticMarkup(<><CrateBearingSettings value={config} onChange={()=>{}} onValidityChange={()=>{}}/><CrateStackReport report={report}/><CrateStackPreflight plan={plan} disabled={false}/></>);
  expect(html).toContain("Passed entered-rating preflight (not adopted)");expect(html).toContain("Bound for EACH path kg");expect(html).toContain("has no adoption action");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
it("labels the crate heatmap as evidence review, independent of carton payload verification",()=>{
  const {plan,product}=make(),html=renderToStaticMarkup(<SceneLoadPanel report={analyzeLoads(plan,[product])} mode="crate" onMode={()=>{}} selected={plan.placements[0]}/>);
  expect(html).toContain("颜色只表示额定资料状态");expect(html).toContain("主方案仍底置");expect(html).toContain("TEST-ONLY");expect(html).toContain("Synthetic test only");
});
