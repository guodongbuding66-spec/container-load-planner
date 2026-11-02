import {expect,it,vi,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {TailCostComparison} from "./tail-cost-comparison";
import {setAppLanguage} from "./language";
import {palletTailFixture} from "../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {preparePalletTailTrials} from "../lib/packing/pallet-tail";
import {runOrderCapacityTrial} from "../lib/packing/order-capacity";
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
function props(){const request=palletTailFixture(),baseline=packLoadingWorkflow(request),candidate=runOrderCapacityTrial(preparePalletTailTrials(request,baseline,"row:a",8).at(-1)!);return {request,baseline,candidate,disabled:false,getReport:vi.fn()};}
it("shows missing quotes and original quantities with an explicit preview scope",()=>{
 const p=props(),html=renderToStaticMarkup(<TailCostComparison {...p}/>);expect(html).toContain("报价未完整");expect(html).toContain("未核算");expect(html).toContain("余货后续运费");expect(html).toContain("报价不改变候选");expect(html).toContain("下载尾数费用 JSON");expect(p.getReport).not.toHaveBeenCalled();expect(p.baseline.metrics.loadedCount).toBe(8);
});
it("fully translates controls and disables unavailable exports",()=>{
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const html=renderToStaticMarkup(<TailCostComparison {...props()} disabled={true}/>);expect(html).not.toMatch(/[\u3400-\u9fff]/u);expect(html).toContain("Tail comparison freight");expect(html).toContain("Download tail cost CSV");expect(html).toContain("Quotes are incomplete");expect(html).toContain('disabled=""');
});
