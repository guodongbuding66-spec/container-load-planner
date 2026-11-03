import {expect,it} from "vitest";
import {economicTailBatch,economicQuote} from "../../tests/economic-tail-fixture";
import {economicTailFixture,jointPalletTailFixture} from "../../tests/pallet-tail-fixture";
import {prepareEconomicTailTrial,reviewEconomicTailTrial,buildEconomicTailCsv} from "./tail-economy";
import {runOrderCapacityTrial,reviewOrderCapacityTrial} from "./order-capacity";
import {packLoadingWorkflow} from "./pack-loading";
import {restorePackingSnapshot} from "./engine";
import {preparePalletTailTrials,prepareJointPalletTailTrials,betterTailCandidate,type TailCandidate} from "./pallet-tail";
import {captureTailCostBasis,tailAllocationKey} from "./tail-cost-table";
import {parseCsvRecords} from "./csv";

it.each(["quick","detailed"] as const)("recalculates the %s batch's 14-carton choice from two pallets at 140 to one at 120",mode=>{
 const input=economicTailBatch(mode),before=structuredClone(input),prepared=prepareEconomicTailTrial(input,economicQuote),report=reviewEconomicTailTrial(prepared,runOrderCapacityTrial(prepared.trial),"2026-11-03T00:00:00Z");
 expect(prepared.trial.request.palletBuild!.looseQuantities).toEqual({a:6});expect(input).toEqual(before);
 expect(report).toMatchObject({status:"preview-not-applied",selection:"quantity-first-then-equal-delivery-cost",quantityCandidate:{loaded:14,configuredTotal:140,pallets:2,loose:1},economicCandidate:{configuredTotal:120},savings:20,currency:"CNY",recheck:{sameOrderRows:true,sameActualUsage:true}});
 expect(report.costReport.comparison).toMatchObject({selection:report.selection,before:{loaded:8,pallets:1},after:{loaded:14,pallets:1,loose:6,grossWeightKg:165,costs:{total:120,complete:true}}});
 expect(report.costReport.trial.selectedCandidate!.orderRows).toMatchObject([{id:"a",requested:14,loaded:14,reserved:6,loose:6,palletized:8}]);expect(report.costReport.trial.selectedCandidate!.modelValidation.valid).toBe(true);
 expect(report.costReport.trial.baseline.id).toBe(input.baseline.id);expect(report.costReport.comparison.quote).toEqual(economicQuote);
 expect(report.quantityCandidate.allocation).toBe('[["row:a",1]]');expect(report.economicCandidate.allocation).toBe('[["row:a",6]]');
});
it("keeps the quantity candidate on a configured-cost tie and reports zero savings",()=>{
 const input=economicTailBatch(),prepared=prepareEconomicTailTrial(input,{...economicQuote,pricing:{...economicQuote.pricing,packaging:{primary:0}}}),report=reviewEconomicTailTrial(prepared,runOrderCapacityTrial(prepared.trial));expect(prepared.rowIndex).toBe(0);expect(report.savings).toBe(0);expect(report.economicCandidate.allocation).toBe(report.quantityCandidate.allocation);
});
it.each(["freight","packaging","charge","rate"])("refuses an automatic economic choice when %s is unknown",kind=>{
 const quote={...economicQuote,freight:kind==="freight"?0:100,pricing:{...economicQuote.pricing,packaging:kind==="packaging"?{}:economicQuote.pricing.packaging,charges:[{id:"labor",label:"Handling",category:"labor" as const,basis:"packaging" as const,amount:kind==="charge"?null:2,currency:kind==="rate"?"USD":"CNY",source:"QA"}]}};
 expect(()=>prepareEconomicTailTrial(economicTailBatch(),quote)).toThrow(/complete quotes/);
});
it.each(["partial","missing usage","stale usage","no selected","locked","measured"])("refuses %s input without changing the original plan",kind=>{
 const input=economicTailBatch();if(kind==="partial")input.rows.pop();else if(kind==="missing usage")delete input.rows[5].costBasis;else if(kind==="stale usage")input.rows[5].costBasis!.rows[0].loaded=13;else if(kind==="no selected")input.best=undefined;else if(kind==="locked")input.baseline.pallets![0].locked=true;else input.baseline.pallets![0].measuredEnvelope={length:800,width:1000,height:500} as never;
 const before=structuredClone(input);expect(()=>prepareEconomicTailTrial(input,economicQuote)).toThrow();expect(input).toEqual(before);
});
it("selects two complete group allocations while preserving each of two original source rows",()=>{
 const request=jointPalletTailFixture();request.container.length=4000;request.container.height=600;request.container.doorHeight=600;request.products.forEach(p=>p.quantity=14);request.palletBuild!.maxPallets=4;request.palletBuild!.primaryRule!.maxPallets=2;request.palletBuild!.additionalSpecs![0].maxPallets=2;
 const partial=packLoadingWorkflow(request),keep=new Set<string>(),seen=new Set<string>();for(const pallet of partial.pallets!){const spec=pallet.specificationId??"primary";if(!seen.has(spec)){seen.add(spec);keep.add(pallet.id);}}partial.pallets=partial.pallets!.filter(p=>keep.has(p.id));partial.placements=partial.placements.filter(p=>p.palletIds?.every(id=>keep.has(id)));const baseline=restorePackingSnapshot(request,partial),trials=prepareJointPalletTailTrials(request,baseline,[{groupId:"row:a",limit:6},{groupId:"row:b",limit:6}]);let best:TailCandidate|undefined;
 const rows=trials.map(trial=>{const plan=reviewOrderCapacityTrial(trial,runOrderCapacityTrial(trial));if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};return {units:trial.tailReservationChange!.units,groups:trial.tailReservationChange!.groups!,loaded:plan.metrics.loadedCount,retained:true,costBasis:captureTailCostBasis(request,plan)};});
 const input={request,baseline,rows,best,mode:"joint" as const,canApply:true,groups:[{id:"row:a",name:"TAIL-A",limit:6,cartonsPerUnit:1},{id:"row:b",name:"TAIL-B",limit:6,cartonsPerUnit:1}]},prepared=prepareEconomicTailTrial(input,{freight:100,pricing:{currency:"CNY",packaging:{primary:20,"sku-b":20}}}),report=reviewEconomicTailTrial(prepared,runOrderCapacityTrial(prepared.trial));
 expect(report.costReport.trial.selectedCandidate!.orderRows.map(r=>r.loaded)).toEqual([14,14]);expect(report.quantityCandidate.configuredTotal).toBe(180);expect(report.economicCandidate.configuredTotal).toBe(140);expect(report.savings).toBe(40);expect(tailAllocationKey(prepared.trial.tailReservationChange!.groups!)).toBe(report.economicCandidate.allocation);expect(prepared.trial.request.palletBuild!.looseQuantities).toEqual({a:6,b:6});
});
it.each(["geometry","different usage","tampered trial","tampered quote"])("refuses %s after solving the economic candidate",kind=>{
 const prepared=prepareEconomicTailTrial(economicTailBatch(),economicQuote),raw=runOrderCapacityTrial(prepared.trial);
 if(kind==="geometry")raw.placements[0].z=-100;else if(kind==="different usage")prepared.input.rows[5].costBasis!.loose=5;else if(kind==="tampered trial")prepared.trial.request.products[0].quantity=100;else prepared.quote.freight=200;
 expect(()=>reviewEconomicTailTrial(prepared,raw)).toThrow();
});
it("prices per-package foreign labor using the actual one-pallet usage",()=>{
 const quote={...economicQuote,pricing:{...economicQuote.pricing,charges:[{id:"labor",label:"Handling",category:"labor" as const,basis:"packaging" as const,amount:2,currency:"USD",source:"QA"}],exchangeRates:[{currency:"USD",rate:7,source:"QA",date:"2026-11-03"}]}},prepared=prepareEconomicTailTrial(economicTailBatch(),quote),report=reviewEconomicTailTrial(prepared,runOrderCapacityTrial(prepared.trial));expect(report.quantityCandidate.configuredTotal).toBe(168);expect(report.economicCandidate.configuredTotal).toBe(134);expect(report.savings).toBe(34);expect(report.costReport.comparison.after.costs.lines![0].quantity).toBe(1);
});
it("keeps a 1:2 kit whole through economic selection and its independently recalculated report",()=>{
 const {request}=economicTailFixture();Object.assign(request.products[0],{length:200,width:200,height:100,quantity:6,setCode:"KIT",unitsPerSet:1});request.products.push({...request.products[0],id:"b",sku:"TAIL-B",quantity:12,unitsPerSet:2});request.palletBuild!.config.maxLoad=90;
 const partial=packLoadingWorkflow(request),removed=partial.pallets![1].id;partial.pallets=partial.pallets!.slice(0,1);partial.placements=partial.placements.filter(p=>!p.palletIds?.includes(removed));const baseline=restorePackingSnapshot(request,partial),trials=preparePalletTailTrials(request,baseline,"kit:KIT",3,"detailed");let best:TailCandidate|undefined;
 const rows=trials.map(trial=>{const plan=reviewOrderCapacityTrial(trial,runOrderCapacityTrial(trial));if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};return {units:trial.tailReservationChange!.units,groups:[{id:"kit:KIT",name:"KIT",units:trial.tailReservationChange!.units}],loaded:plan.metrics.loadedCount,retained:true,costBasis:captureTailCostBasis(request,plan)};});
 const input={request,baseline,rows,best,mode:"detailed" as const,canApply:true,groups:[{id:"kit:KIT",name:"KIT",limit:3,cartonsPerUnit:3}]},prepared=prepareEconomicTailTrial(input,economicQuote),report=reviewEconomicTailTrial(prepared,runOrderCapacityTrial(prepared.trial));expect(prepared.trial.request.palletBuild!.looseQuantities).toEqual({a:3,b:6});expect(report.costReport.trial.selectedCandidate!.orderRows.map(r=>r.loaded)).toEqual([6,12]);expect(report.savings).toBe(20);
});
it("exports the economic allocation, both quote totals, saved amount and full reviewed row report",()=>{
 const prepared=prepareEconomicTailTrial(economicTailBatch(),economicQuote),report=reviewEconomicTailTrial(prepared,runOrderCapacityTrial(prepared.trial)),json=JSON.parse(JSON.stringify(report)),en=buildEconomicTailCsv(report,true),records=parseCsvRecords(en.replace(/^\uFEFF/,""));expect(json.costReport.trial.selectedCandidate.orderRows[0].reserved).toBe(6);expect(records.every(r=>r.length===11)).toBe(true);expect(records.find(r=>r[5]==="economic:1")![9]).toBe("140");expect(records.find(r=>r[5]==="economic:2")![9]).toBe("120");expect(records.find(r=>r[5]==="economic:3")![9]).toBe("20");expect(records.at(-1)![9]).toBe(report.economicCandidate.allocation);expect(en).not.toMatch(/[\u3400-\u9fff]/u);expect(buildEconomicTailCsv(report)).toContain("经济配额");
});
