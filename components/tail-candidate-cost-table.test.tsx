import {expect,it,vi,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {TailCandidateCostTable} from "./tail-candidate-cost-table";
import {priceTailCandidates,captureTailCostBasis} from "../lib/packing/tail-cost-table";
import {economicTailFixture} from "../tests/pallet-tail-fixture";
import {preparePalletTailTrials} from "../lib/packing/pallet-tail";
import {runOrderCapacityTrial} from "../lib/packing/order-capacity";
import {setAppLanguage} from "./language";
afterEach(()=>{vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("zh");vi.unstubAllGlobals();});
function props(quoted=true){const {request,baseline}=economicTailFixture(),trials=preparePalletTailTrials(request,baseline,"row:a",6,"detailed"),plans=trials.map(runOrderCapacityTrial),rows=trials.map((t,i)=>({units:t.tailReservationChange!.units,groups:[{id:"row:a",name:"TAIL-A",units:t.tailReservationChange!.units}],loaded:plans[i].metrics.loadedCount,retained:true,costBasis:captureTailCostBasis(request,plans[i])})),table=priceTailCandidates(request,baseline,plans[0],rows,{freight:quoted?100:0,pricing:{currency:"CNY",packaging:{primary:20}}},rows[0].groups);return {rows,table,disabled:false,canApply:true,onAdopt:vi.fn()};}
it("labels the bounded same-delivery minimum and offers explicit quota recalculation",()=>{
 const p=props(),html=renderToStaticMarkup(<TailCandidateCostTable {...p}/>);expect(html).toContain("本批次同量最低");expect(html).toContain("120.00");expect(html).toContain("-20.00");expect(html).toContain('aria-label="采用配额 6 并重新计算"');expect(html).toContain("Tail test pallet × 1");expect(html).toContain("正式结果以重新计算为准");expect(p.onAdopt).not.toHaveBeenCalled();
});
it("keeps missing quotes unknown, blocks adoption and translates the table fully",()=>{
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const html=renderToStaticMarkup(<TailCandidateCostTable {...props(false)}/>);expect(html).not.toMatch(/[\u3400-\u9fff]/u);expect(html).toContain("no batch minimum");expect(html).toContain("Unknown");expect((html.match(/disabled=""/g)??[])).toHaveLength(6);
});
it("keeps issued versions preview-only",()=>{const html=renderToStaticMarkup(<TailCandidateCostTable {...props()} canApply={false}/>);expect((html.match(/disabled=""/g)??[])).toHaveLength(6);});
