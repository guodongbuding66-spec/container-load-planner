import {afterEach,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {PalletSearchNote} from "./quality-benchmarks";
import {runQualityCase} from "../lib/packing/quality-benchmarks";
import {setAppLanguage} from "./language";
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
it("explains the actual selected candidate instead of implying an independent 32-carton maximum search",()=>{const r=runQualityCase("pallet-loose","maximum"),h=renderToStaticMarkup(<PalletSearchNote value={r.palletSearch}/>);expect(r.loaded).toBe(32);expect(h).toContain("31 → 32");expect(h).toContain("独立复核的现场候选");});
it("renders candidate provenance in English and suppresses an unselected reference",()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const r=runQualityCase("pallet-loose","maximum"),h=renderToStaticMarkup(<PalletSearchNote value={r.palletSearch}/>);expect(h).toContain("independently reviewed practical candidate");expect(h).not.toMatch(/[\u3400-\u9fff]/u);expect(renderToStaticMarkup(<PalletSearchNote value={{maximumCount:32,practicalCount:31,selected:"maximum",comparison:"kept-maximum"}}/>)).toBe("");});
