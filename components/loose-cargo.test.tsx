import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {TransportAppearanceProvider} from "./transport-appearance";
import {CargoLoadingAllocation} from "./cargo-loading-allocation";
import {PalletBuildSettings} from "./pallet-build-settings";
import {PalletManifest} from "./pallet-manifest";
import {setAppLanguage} from "./language";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import type {ProductInput} from "../lib/packing/types";

const renderMarkup=(node:React.ReactNode)=>renderToStaticMarkup(<TransportAppearanceProvider>{node}</TransportAppearanceProvider>);
const product:ProductInput={id:"p",sku:"SHED-BOX",name:"Shed carton",length:500,width:500,height:200,weight:10,quantity:6,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#337788"},products=[product];
const value={...DEFAULT_PALLET_BUILD,looseQuantities:{p:2},config:{...DEFAULT_PALLET_BUILD.config,length:1000,width:1000,height:100,maxCargoHeight:200}};
const plan=()=>packLoadingWorkflow({mode:"mixed",workflow:"palletized",strategy:"maximum",products,palletBuild:value,clearance:0,container:{id:"c",name:"QA",length:1500,width:1000,height:500,doorWidth:1000,doorHeight:500,maxWeight:1000}});
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});

it("offers explicit carton reservations with order limits and whole-kit wording",()=>{
  const html=renderMarkup(<CargoLoadingAllocation value={value.looseQuantities} products={products} onChange={()=>{}} onValidityChange={()=>{}}/>);
  expect(html).toContain('aria-label="SHED-BOX 散装箱数"');expect(html).toContain("订单箱数");expect(html).toContain("全部散装");expect(html).toContain("全部打托");expect(html).toContain("分别指定数量");
});
it("renders the English configuration and loaded loose manifest without Chinese leftovers",()=>{
  vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");
  const html=renderMarkup(<><CargoLoadingAllocation value={value.looseQuantities} products={products} onChange={()=>{}} onValidityChange={()=>{}}/><PalletManifest result={plan()} products={products}/></>);
  expect(html).toContain('aria-label="SHED-BOX loose cartons"');expect(html).toContain("Loose cargo manifest");expect(html).toContain("Loaded on units");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
it("keeps pallet-only reservations visible with a correction and clear action",()=>{
  const html=renderMarkup(<PalletBuildSettings value={value} products={products} only onChange={()=>{}} onValidityChange={()=>{}}/>);
  expect(html).toContain('role="alert"');expect(html).toContain("清除散装预留");expect(html).not.toContain('aria-label="预留散装箱数 SHED-BOX"');
});
it("does not hide the loose manifest when no complete unit fits",()=>{
  const initial=plan(),allLoose={...initial,pallets:[],placements:initial.placements.filter(b=>!b.palletIds?.length)};
  const html=renderMarkup(<PalletManifest result={allLoose} products={products}/>);expect(html).toContain("散箱混装清单");expect(html).toContain("SHED-BOX");
});
