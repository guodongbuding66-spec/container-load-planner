import {expect,it,vi,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {TailCandidateReview} from "./tail-candidate-review";
import {PalletTailTrial} from "./pallet-tail-trial";
import {setAppLanguage} from "./language";
import {palletTailFixture,triplePalletTailFixture} from "../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {preparePalletTailTrials} from "../lib/packing/pallet-tail";
import {runOrderCapacityTrial} from "../lib/packing/order-capacity";
afterEach(()=>{setAppLanguage("zh");vi.unstubAllGlobals();});
it("labels actual quantities separately from reservations in both languages",()=>{
 const request=palletTailFixture();request.container.height=600;request.container.doorHeight=600;const baseline=packLoadingWorkflow(request),candidate=runOrderCapacityTrial(preparePalletTailTrials(request,baseline,"row:a",8).at(-1)!);
 const zh=renderToStaticMarkup(<TailCandidateReview request={request} baseline={baseline} candidate={candidate}/>);expect(zh).toContain("实际散箱");expect(zh).toContain("散箱预留：原 → 候选");expect(zh).toContain("scope=\"row\"");expect(zh).toContain("<tfoot>");expect(zh).toContain("tabindex=\"0\"");
 vi.stubGlobal("document",{documentElement:{lang:""}});setAppLanguage("en");const en=renderToStaticMarkup(<TailCandidateReview request={request} baseline={baseline} candidate={candidate}/>);expect(en).toContain("Actual loose");expect(en).toContain("Reserved loose: before → candidate");expect(en).not.toMatch(/[\u3400-\u9fff]/u);
 const r=triplePalletTailFixture(),ui=renderToStaticMarkup(<PalletTailTrial request={r} plan={packLoadingWorkflow(r)} disabled={false} canApply={true}/>);expect(ui).toContain("Three groups together");expect(ui).not.toMatch(/[\u3400-\u9fff]/u);
});
