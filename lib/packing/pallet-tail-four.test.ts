import {expect,it} from "vitest";
import {quadruplePalletTailFixture,tripleKitPalletTailFixture} from "../../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "./pack-loading";
import {prepareJointPalletTailTrials,betterTailCandidate,tailCargoGroups,type TailCandidate} from "./pallet-tail";
import {runOrderCapacityTrial,reviewOrderCapacityTrial} from "./order-capacity";
import {captureTailCostBasis} from "./tail-cost-table";
import {buildTailTrialReport,buildTailTrialCsv,type TailReportInput} from "./pallet-tail-report";
import {buildTailCostReport} from "./pallet-tail-costs";
import {parseWorkspaceBackup,restoreWorkspacePlans,serializeWorkspaceBackup} from "./workspace-file";

function fourBatch(){
 const request=quadruplePalletTailFixture(),baseline=packLoadingWorkflow(request),groups=tailCargoGroups(request,baseline).map(g=>({id:g.id,name:g.name,limit:1,cartonsPerUnit:g.cartonsPerUnit}));let best:TailCandidate|undefined;
 const rows=prepareJointPalletTailTrials(request,baseline,groups.map(g=>({groupId:g.id,limit:1}))).map(trial=>{const plan=reviewOrderCapacityTrial(trial,runOrderCapacityTrial(trial));if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};return {units:trial.tailReservationChange!.units,groups:trial.tailReservationChange!.groups!,loaded:plan.metrics.loadedCount,retained:true,costBasis:captureTailCostBasis(request,plan)};});return {request,baseline,groups,rows,best,mode:"quad" as const,canApply:true};
}
it.each(["practical","maximum"] as const)("completes four original nine-carton rows with %s and no extra stock",strategy=>{
 const request=quadruplePalletTailFixture();request.strategy=strategy;const before=structuredClone(request),baseline=packLoadingWorkflow(request),selections=request.products.map(p=>({groupId:`row:${p.id}`,limit:1})),trials=prepareJointPalletTailTrials(request,baseline,selections);let best:TailCandidate|undefined;
 expect(baseline.metrics.loadedCount).toBe(32);expect(trials).toHaveLength(15);for(const trial of trials){const plan=reviewOrderCapacityTrial(trial,runOrderCapacityTrial(trial));if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};}
 expect(best!.plan.metrics).toMatchObject({loadedCount:36,grossWeight:460});expect(best!.plan.pallets).toHaveLength(4);expect(best!.plan.summaries.map(s=>s.loaded)).toEqual([9,9,9,9]);expect(best!.trial.request.palletBuild!.looseQuantities).toEqual({a:1,b:1,c:1,d:1});expect(request).toEqual(before);
});
it("includes all four one-sided boundaries exactly once but excludes the all-zero allocation",()=>{
 const b=fourBatch(),keys=b.rows.map(r=>r.groups.map(g=>g.units).join(","));expect(new Set(keys).size).toBe(15);for(const key of ["1,0,0,0","0,1,0,0","0,0,1,0","0,0,0,1","1,1,1,1"])expect(keys).toContain(key);expect(keys).not.toContain("0,0,0,0");
});
it("allows the complete 53-allocation grid and rejects 80 without truncation",()=>{
 const r=quadruplePalletTailFixture();r.products.forEach(p=>p.quantity=20);const p=packLoadingWorkflow(r),s=r.products.map((p,i)=>({groupId:`row:${p.id}`,limit:i===3?1:2}));expect(prepareJointPalletTailTrials(r,p,s)).toHaveLength(53);s[3].limit=2;expect(()=>prepareJointPalletTailTrials(r,p,s)).toThrow(/64/);
});
it.each(["duplicate","missing","fifth"])("rejects %s group scope",kind=>{
 const b=fourBatch(),s=b.groups.map(g=>({groupId:g.id,limit:1}));if(kind==="duplicate")s[3].groupId=s[2].groupId;else if(kind==="missing")s[3].groupId="missing";else s.push({groupId:"row:e",limit:1});expect(()=>prepareJointPalletTailTrials(b.request,b.baseline,s)).toThrow();
});
it("retains atomic 1:2 kits alongside three other groups",()=>{
 const r=tripleKitPalletTailFixture();r.container.length=3600;r.palletBuild!.maxPallets=4;r.products.push({...structuredClone(r.products[2]),id:"e",sku:"TAIL-E"});const before=structuredClone(r),p=packLoadingWorkflow(r),trials=prepareJointPalletTailTrials(r,p,[{groupId:"kit:KIT",limit:1},{groupId:"row:c",limit:1},{groupId:"row:d",limit:1},{groupId:"row:e",limit:1}]);expect(trials).toHaveLength(15);const last=trials.at(-1)!;expect(last.request.palletBuild!.looseQuantities).toEqual({a:1,b:2,c:1,d:1,e:1});const plan=reviewOrderCapacityTrial(last,runOrderCapacityTrial(last));expect(plan.validation.valid).toBe(true);expect(plan.summaries.find(s=>s.productId==="b")!.loaded).toBe(2*plan.summaries.find(s=>s.productId==="a")!.loaded);expect(r).toEqual(before);
});
it("exports four-row quantities and cost evidence, and rejects incomplete or mislabelled batches",()=>{
 const b=fourBatch(),report=buildTailTrialReport(b),csv=buildTailTrialCsv(report,true);expect(report.scope).toMatchObject({mode:"quad"});expect(report.candidates).toHaveLength(15);expect(report.selectedCandidate!.orderRows.map(r=>r.loaded)).toEqual([9,9,9,9]);expect(csv).toContain("TAIL-D");const c=buildTailCostReport(b,{freight:100,pricing:{currency:"CNY",packaging:{primary:10,"sku-b":20,"sku-c":30,"sku-d":40}}});expect(c.comparison.after.costs.total).toBe(200);expect(c.candidateCosts.comparableCount).toBe(1);expect(c.candidateCosts.canRank).toBe(false);expect(()=>buildTailTrialReport({...b,rows:b.rows.slice(1)})).toThrow(/complete/);expect(()=>buildTailTrialReport({...b,mode:"triple"} as TailReportInput)).toThrow(/scope/);
});
it("round-trips an adopted four-group plan using the existing workspace format",()=>{
 const b=fourBatch(),plan=b.best!.plan,input={...b.best!.trial.request,strategy:plan.strategy,practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:90,lengthUnit:"mm" as const,weightUnit:"kg" as const},raw=serializeWorkspaceBackup(input,plan.engineVersion,plan),restored=restoreWorkspacePlans(raw,parseWorkspaceBackup(raw))!;expect(restored.validation.valid).toBe(true);expect(restored.metrics.loadedCount).toBe(36);expect(restored.palletBuild!.looseQuantities).toEqual({a:1,b:1,c:1,d:1});
});

it("excludes four-kit allocations exceeding sixty-four added cartons without splitting any kit",()=>{
 const r=quadruplePalletTailFixture();r.products.forEach((p,i)=>Object.assign(p,{length:100,width:100,height:100,quantity:51,setCode:`K${i}`,unitsPerSet:17}));r.palletBuild!.config.maxLoad=170;r.palletBuild!.additionalSpecs!.forEach(s=>s.config.maxLoad=170);const p=packLoadingWorkflow(r),s=r.products.map((_p,i)=>({groupId:`kit:K${i}`,limit:1})),trials=prepareJointPalletTailTrials(r,p,s);expect(trials).toHaveLength(14);expect(trials.every(t=>Object.values(t.request.palletBuild!.looseQuantities!).reduce((n,v)=>n+v,0)<=64&&Object.values(t.request.palletBuild!.looseQuantities!).every(v=>v===17))).toBe(true);
});
