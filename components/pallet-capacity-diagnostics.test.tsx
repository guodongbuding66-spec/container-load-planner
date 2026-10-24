import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import {PalletCapacityDiagnostics} from "./pallet-capacity-diagnostics";
import {packagingCapacityFixture} from "../tests/packaging-capacity-fixture";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {setAppLanguage} from "./language";
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("shows actual base footprints and payload margins without declaring voids usable",()=>{
 const html=renderToStaticMarkup(<PalletCapacityDiagnostics plan={packLoadingWorkflow(packagingCapacityFixture())}/>);
 expect(html).toContain("87.5%");expect(html).toContain("96.6%");expect(html).toContain("2743 × 2233 × 60");expect(html).toContain("34.0 kg");expect(html).toContain("不代表可补货空间");
});
it("renders the complete diagnostic in English",()=>{
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");
 const html=renderToStaticMarkup(<PalletCapacityDiagnostics plan={packLoadingWorkflow(packagingCapacityFixture())}/>);expect(html).toContain("Base projection");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
