import {expect,it} from "vitest";
import {palletTailFixture,triplePalletTailFixture} from "../../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "./pack-loading";
import {runOrderCapacityTrial} from "./order-capacity";
import {tailCargoGroups,preparePalletTailTrials,prepareJointPalletTailTrials,betterTailCandidate,type TailCandidate,type TailSearchMode} from "./pallet-tail";
import {buildTailTrialReport,buildTailTrialCsv,type TailComparisonRow} from "./pallet-tail-report";
import {parseCsvRecords} from "./csv";

function batch(request=palletTailFixture(),mode:TailSearchMode="quick",limit=8){
 const baseline=packLoadingWorkflow(request),groups=tailCargoGroups(request,baseline).slice(0,mode==="triple"?3:1).map(g=>({id:g.id,name:g.name,limit,cartonsPerUnit:g.cartonsPerUnit})),trials=mode==="triple"?prepareJointPalletTailTrials(request,baseline,groups.map(g=>({groupId:g.id,limit}))):preparePalletTailTrials(request,baseline,groups[0].id,limit,mode as "quick"|"detailed"),rows:TailComparisonRow[]=[];let best:TailCandidate|undefined;
 for(const trial of trials){const plan=runOrderCapacityTrial(trial),change=trial.tailReservationChange!;rows.push({units:change.units,groups:change.groups??[{id:groups[0].id,name:groups[0].name,units:change.units}],loaded:plan.metrics.loadedCount,retained:true});if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};}
 return {request,baseline,mode,groups,rows,best,canApply:true};
}
const short=()=>{const r=palletTailFixture();r.container.height=600;r.container.doorHeight=600;return r;};
it("records a complete preview without applying or counting unplaced reservations as loaded",()=>{
 const input=batch(short()),before=structuredClone(input),report=buildTailTrialReport(input,"2026-10-29T00:00:00Z");expect(report).toMatchObject({format:"cargo-fit-tail-trial-report",version:1,complete:true,status:"preview-not-applied",canApply:true});expect(report.candidates).toHaveLength(4);expect(report.selectedCandidate?.orderRows[0]).toMatchObject({requested:20,beforeLoaded:8,loaded:14,reserved:8,loose:6,palletized:8,unloaded:6});expect(input).toEqual(before);
 report.input.products[0].quantity=999;report.scope.groups[0].limit=1;expect(input).toEqual(before);
});
it("records all 26 allocations and all stable source rows in a three-group report",()=>{
 const report=buildTailTrialReport(batch(triplePalletTailFixture(),"triple",2));expect(report.candidates).toHaveLength(26);expect(report.scope.groups.map(g=>g.limit)).toEqual([2,2,2]);expect(report.selectedCandidate).toMatchObject({loaded:30,grossWeightKg:375,pallets:3,looseQuantities:{a:2,b:2,c:2}});expect(report.selectedCandidate?.orderRows.map(r=>[r.id,r.requested,r.loaded,r.loose,r.palletized,r.unloaded])).toEqual([["a",10,10,2,8,0],["b",10,10,2,8,0],["c",10,10,2,8,0]]);
});
it.each(["partial","duplicate","wrong group"])("refuses a %s batch instead of exporting it as complete",kind=>{
 const input=batch();if(kind==="partial")input.rows.pop();if(kind==="duplicate")input.rows[0]=structuredClone(input.rows[1]);if(kind==="wrong group")input.rows[0].groups[0].id="row:other";expect(()=>buildTailTrialReport(input)).toThrow(/complete/);
});
it("rejects an unbounded or mismatched report scope",()=>{
 const input=batch(triplePalletTailFixture(),"triple",2);input.groups.forEach(g=>g.limit=4);expect(()=>buildTailTrialReport(input)).toThrow();const a=batch();a.groups[0].cartonsPerUnit=2;expect(()=>buildTailTrialReport(a)).toThrow(/demand/);
});
it("rechecks the selected geometry and protects original stock and ratings",()=>{
 const a=batch();a.best!.plan.placements[0].z=-10;expect(()=>buildTailTrialReport(a)).toThrow();const b=batch();b.best!.trial.request.palletBuild!.config.maxLoad+=1;expect(()=>buildTailTrialReport(b)).toThrow(/original inputs/);
});
it("keeps failures and no-increase outcomes in a complete report with no selected candidate",()=>{
 const r=palletTailFixture();r.palletBuild!.config.length=1200;const input=batch(r);expect(input.best).toBeUndefined();input.rows[0]={...input.rows[0],loaded:null,retained:false,problem:"candidate review failed"};input.rows[1].retained=false;const report=buildTailTrialReport(input);expect(report.selectedCandidate).toBeNull();expect(report.candidates.map(r=>r.outcome)).toEqual(["review-failed","row-reduced","no-increase","no-increase"]);expect(()=>buildTailTrialCsv(report)).toThrow(/No selected/);
});
it("CSV protects formulas and quotes while JSON keeps exact source identity",()=>{
 const request=short();request.products[0].id="=a";request.products[0].sku='=SUM(1,2)\n"box"';const report=buildTailTrialReport(batch(request)),csv=buildTailTrialCsv(report,true),rows=parseCsvRecords(csv.replace(/^\uFEFF/,""));expect(csv.startsWith("\uFEFF")).toBe(true);expect(rows[1][0]).toBe("Preview - not applied");expect(rows[1][5]).toBe("'=a");expect(rows[1][6]).toBe('\'=SUM(1,2)\n"box"');expect(report.selectedCandidate?.orderRows[0].id).toBe("=a");expect(rows[1].slice(7,15)).toEqual(["20","8","14","0","8","6","8","6"]);
});
it("retains preview-only permissions in issued-version reports",()=>{const input=batch();input.canApply=false;const report=buildTailTrialReport(input);expect(report.canApply).toBe(false);expect(report.status).toBe("preview-not-applied");expect(buildTailTrialCsv(report)).toContain("试算预览－未采用");});

it("keeps the five review states separate from successful model validation",()=>{
 const report=buildTailTrialReport(batch(short()));expect(report.selectedCandidate?.modelValidation.valid).toBe(true);expect(report.selectedCandidate?.review.checks).toHaveLength(5);expect(report.selectedCandidate?.review.checks.find(c=>c.id==="securing")?.state).toBe("unverified");expect(report.selectedCandidate?.review.state).not.toBe("pass");const csv=buildTailTrialCsv(report,true);expect(csv).toContain("Candidate-wide securing review");expect(csv).toContain("Unverified");
});
