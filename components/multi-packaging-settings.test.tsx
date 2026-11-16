import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {TransportAppearanceProvider} from "./transport-appearance";
import {PalletBuildSettings} from "./pallet-build-settings";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {TRANSPORT_PRESETS} from "../lib/packing/transport-library";
import {setAppLanguage} from "./language";
const options={...DEFAULT_PALLET_BUILD,primaryRule:{maxPallets:2},additionalSpecs:[{id:"second",config:{...DEFAULT_PALLET_BUILD.config,name:"Small",length:600,width:400},maxPallets:3,stackLayers:1,maxTopLoadKg:0}]};
beforeEach(()=>vi.stubGlobal("document",{documentElement:{lang:""}}));
afterEach(()=>{setAppLanguage("zh");vi.unstubAllGlobals();});
it("renders ordered stock summaries while keeping only the selected specification editor mounted",()=>{
  const html=renderToStaticMarkup(<TransportAppearanceProvider><PalletBuildSettings value={options} only onChange={()=>{}} onValidityChange={()=>{}}/></TransportAppearanceProvider>);
  expect(html.match(/class="packaging-editor"/g)).toHaveLength(1);expect(html).toContain("1. EUR");expect(html).toContain("2. Small");expect(html).toContain("此规格可用数量");expect(html).toContain("所有规格合计上限");
});
it("renders the new specification controls in English and localizes validation messages during render",()=>{
  setAppLanguage("en");
  const html=renderToStaticMarkup(<TransportAppearanceProvider><PalletBuildSettings value={{...options,primaryRule:{maxPallets:-1}}} only onChange={()=>{}} onValidityChange={()=>{}}/></TransportAppearanceProvider>);
  expect(html).toContain("Add packaging specification");expect(html).toContain("Check each packaging name");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
it("keeps compact selection explicit and describes priority and heuristic limits in English",()=>{
  setAppLanguage("en");
  const html=renderToStaticMarkup(<TransportAppearanceProvider><PalletBuildSettings value={{...options,selection:"compact"}} only onChange={()=>{}} onValidityChange={()=>{}}/></TransportAppearanceProvider>);
  expect(html).toContain('aria-label="Packaging selection mode"');expect(html).toContain('value="compact" selected=""');expect(html).toContain("minimum units or cost");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});

it("places the complete load preview beneath the packaging model",()=>{
  const request={container:TRANSPORT_PRESETS[0],workflow:"palletized" as const,palletBuild:options,products:[],clearance:10,mode:"mixed" as const,strategy:"practical" as const};
  const html=renderToStaticMarkup(<TransportAppearanceProvider><PalletBuildSettings value={options} only={false} request={request} onChange={()=>{}} onValidityChange={()=>{}}/></TransportAppearanceProvider>);
  const models=html.split('class="packaging-preview-column"');
  expect(models).toHaveLength(2);
  expect(models[1]).toMatch(/class="packaging-preview"[\s\S]*?class="pallet-build-preview"/u);
  expect(models[1]).toContain("生成整体打托预览");
});
