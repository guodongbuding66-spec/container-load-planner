import {expect,it} from "vitest";
import {economicTailFixture,jointPalletTailFixture} from "../../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "./pack-loading";
import {preparePalletTailTrials,prepareJointPalletTailTrials,betterTailCandidate,type TailCandidate} from "./pallet-tail";
import {runOrderCapacityTrial,reviewOrderCapacityTrial} from "./order-capacity";
import {captureTailCostBasis,priceTailCandidates,buildTailCandidateCostCsv} from "./tail-cost-table";
import {buildTailCostReport} from "./pallet-tail-costs";
import {fleetCosts,fleetCostsFromUsage,planCostUsage} from "./fleet-costs";
import {parseCsvRecords} from "./csv";
import type {TailComparisonRow} from "./pallet-tail-report";

const quote={freight:100,pricing:{currency:"CNY",packaging:{primary:20}}};
function economicBatch(){
 const {request,baseline}=economicTailFixture();let best:TailCandidate|undefined;
 const trials=preparePalletTailTrials(request,baseline,"row:a",6,"detailed"),rows:TailComparisonRow[]=trials.map(trial=>{
  const plan=reviewOrderCapacityTrial(trial,runOrderCapacityTrial(trial));if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};
  return {units:trial.tailReservationChange!.units,groups:[{id:"row:a",name:"TAIL-A",units:trial.tailReservationChange!.units}],loaded:plan.metrics.loadedCount,retained:true,costBasis:captureTailCostBasis(request,plan)};
 });
 const groups=[{id:"row:a",name:"TAIL-A",limit:6,cartonsPerUnit:1}],selectedGroups=rows.find(r=>r.units===best!.trial.tailReservationChange!.units)!.groups;
 return {request,baseline,rows,best:best!,groups,selectedGroups,mode:"detailed" as const,canApply:true};
}
it("finds the lower configured cost for identical real delivery without reselecting the quantity winner",()=>{
 const b=economicBatch(),before=structuredClone(b),table=priceTailCandidates(b.request,b.baseline,b.best.plan,b.rows,quote,b.selectedGroups);
 expect(b.baseline.validation.valid).toBe(true);expect(b.baseline.metrics.loadedCount).toBe(8);expect(b.baseline.pallets).toHaveLength(1);expect(b.baseline.metrics.grossWeight).toBe(105);
 expect(b.best.trial.tailReservationChange!.units).toBe(1);expect(b.best.plan.metrics.loadedCount).toBe(14);expect(b.best.plan.pallets).toHaveLength(2);
 expect(table).toMatchObject({complete:true,canRank:true,comparableCount:6,minimum:120});expect(table.rows[0]).toMatchObject({current:true,loaded:14,loose:1,costs:{total:140},difference:0,lowest:false});expect(table.rows[5]).toMatchObject({current:false,loaded:14,loose:6,costs:{total:120},difference:-20,lowest:true});expect(table.rows[5].packages[0].quantity).toBe(1);expect(b).toEqual(before);
 const next={...structuredClone(b.request),palletBuild:structuredClone(preparePalletTailTrials(b.request,b.baseline,"row:a",6,"detailed")[5].request.palletBuild)},plan=packLoadingWorkflow(next);expect(plan.validation.valid).toBe(true);expect(plan.metrics).toMatchObject({loadedCount:14,grossWeight:165});expect(plan.pallets).toHaveLength(1);expect(next.products[0].quantity).toBe(14);expect(next.palletBuild!.maxPallets).toBe(2);
});
it("includes all candidate fees in JSON and a separate bilingual CSV with unknowns and escaping",()=>{
 const b=economicBatch(),r=buildTailCostReport(b,quote,"2026-11-03T00:00:00Z");expect(r.candidateCosts.minimum).toBe(120);expect(r.comparison.after.costs.total).toBe(140);b.rows[5].allocation='=SUM(1,2)\n"tail"';const table=priceTailCandidates(b.request,b.baseline,b.best.plan,b.rows,{...quote,freight:0},b.selectedGroups),csv=buildTailCandidateCostCsv(table,"0.72.0",r.createdAt,true),records=parseCsvRecords(csv.replace(/^\uFEFF/,""));expect(csv.startsWith("\uFEFF")).toBe(true);expect(records).toHaveLength(7);expect(records.every(r=>r.length===14)).toBe(true);expect(records[6][4]).toBe('\'=SUM(1,2)\n"tail"');expect(records[6][10]).toBe("");expect(records[6][12]).toBe("false");expect(buildTailCandidateCostCsv(table,"0.72.0",r.createdAt)).toContain("各订单行数量相同");
});
it.each(["freight","packaging","rate","amount"])("keeps the batch minimum unknown with missing %s",kind=>{
 const b=economicBatch(),q={...quote,pricing:{...quote.pricing,packaging:kind==="packaging"?{}:quote.pricing.packaging,charges:[{id:"x",label:"Handling",category:"labor" as const,basis:"packaging" as const,amount:kind==="amount"?null:1,currency:kind==="rate"?"USD":"CNY",source:"QA"}]}};
 if(kind==="freight")q.freight=0;const table=priceTailCandidates(b.request,b.baseline,b.best.plan,b.rows,q,b.selectedGroups);expect(table.complete).toBe(false);expect(table.minimum).toBeNull();expect(table.rows.every(r=>!r.lowest&&r.difference===null)).toBe(true);expect(table.rows[5].costs!.knownSubtotal).toBeGreaterThan(0);
});
it("marks free-packaging ties and does not rank a solitary comparable candidate",()=>{
 const b=economicBatch(),q={freight:100,pricing:{currency:"CNY",packaging:{primary:0}}},table=priceTailCandidates(b.request,b.baseline,b.best.plan,b.rows,q,b.selectedGroups);expect(table.rows.every(r=>r.lowest&&r.costs!.total===100)).toBe(true);const one=priceTailCandidates(b.request,b.baseline,b.best.plan,b.rows.slice(0,1),q,b.selectedGroups);expect(one.complete).toBe(true);expect(one.canRank).toBe(false);expect(one.minimum).toBeNull();expect(one.rows[0].lowest).toBe(false);
});
it.each(["missing","wrong row","wrong count","stock","material","loose","selected usage"])("does not rank or adopt a %s accounting basis",kind=>{
 const b=economicBatch(),row=b.rows[kind==="selected usage"?0:5],basis=row.costBasis!;
 if(kind==="missing")delete row.costBasis;else if(kind==="wrong row")basis.rows[0].id="stale";else if(kind==="wrong count")basis.rows[0].loaded=13;else if(kind==="stock")basis.packagingIds.push("primary","primary");else if(kind==="material")basis.accessories=[{id:"stale",quantity:1}];else if(kind==="loose")basis.loose=100;else basis.loose=2;
 const table=priceTailCandidates(b.request,b.baseline,b.best.plan,b.rows,quote,b.selectedGroups);expect(table.canRank).toBe(false);expect(table.rows[kind==="selected usage"?0:5].available).toBe(false);expect(table.minimum).toBeNull();
});
it("excludes equal totals with different source-row quantities using actual joint candidates",()=>{
 const request=jointPalletTailFixture(),baseline=packLoadingWorkflow(request),trials=prepareJointPalletTailTrials(request,baseline,[{groupId:"row:a",limit:3},{groupId:"row:b",limit:3}]);const plans=trials.map(t=>reviewOrderCapacityTrial(t,runOrderCapacityTrial(t))),selected=trials.findIndex(t=>t.tailReservationChange!.groups!.map(g=>g.units).join(",")==="1,2"),other=trials.findIndex(t=>t.tailReservationChange!.groups!.map(g=>g.units).join(",")==="2,1");
 const rows=trials.map((t,i)=>({units:t.tailReservationChange!.units,groups:t.tailReservationChange!.groups!,loaded:plans[i].metrics.loadedCount,retained:true,costBasis:captureTailCostBasis(request,plans[i])})),table=priceTailCandidates(request,baseline,plans[selected],rows,{freight:100,pricing:{currency:"CNY",packaging:{primary:20,"sku-b":20}}},rows[selected].groups);
 expect(rows[other].loaded).toBe(rows[selected].loaded);expect(table.rows[other]).toMatchObject({available:true,sameDelivery:false,difference:null,lowest:false,reason:"different-order-rows"});
});
it("uses the same accounting arithmetic for retained usage snapshots and full plans",()=>{
 const b=economicBatch(),q={...quote.pricing,charges:[{id:"labor",label:"Handling",category:"labor" as const,basis:"packaging" as const,refId:"primary",amount:2.25,currency:"USD",source:"QA"}],exchangeRates:[{currency:"USD",rate:7.1234,source:"QA",date:"2026-11-03"}]},loads=[{plan:b.baseline,cost:100},{plan:b.best.plan,cost:200}];expect(fleetCostsFromUsage(loads.map(l=>planCostUsage(l.plan,l.cost)),q)).toEqual(fleetCosts(loads,q));expect(fleetCosts(loads,q)).toMatchObject({freight:300,packaging:60,complete:true});expect(fleetCosts(loads,q).lines![0]).toMatchObject({quantity:3,exchangeRate:7.1234});expect(fleetCosts(loads,q).lines![0].subtotal).toBeCloseTo(48.08295,8);expect(fleetCosts(loads,q).total).toBeCloseTo(408.08295,8);
});
