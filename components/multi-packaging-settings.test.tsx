import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {TransportAppearanceProvider} from "./transport-appearance";
import {PalletBuildSettings} from "./pallet-build-settings";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
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
