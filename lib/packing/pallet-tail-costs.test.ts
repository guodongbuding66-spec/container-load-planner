import {expect,it} from "vitest";
import {palletTailFixture,triplePalletTailFixture} from "../../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "./pack-loading";
import {runOrderCapacityTrial} from "./order-capacity";
import {tailCargoGroups,preparePalletTailTrials,betterTailCandidate,type TailCandidate} from "./pallet-tail";
import {compareTailCosts,buildTailCostReport,buildTailCostCsv,type TailCostQuote} from "./pallet-tail-costs";
import {parseCsvRecords} from "./csv";

function batch(){
 const request=palletTailFixture(),baseline=packLoadingWorkflow(request),g=tailCargoGroups(request,baseline)[0],groups=[{id:g.id,name:g.name,limit:8,cartonsPerUnit:g.cartonsPerUnit}];let best:TailCandidate|undefined;
 const rows=preparePalletTailTrials(request,baseline,g.id,8).map(trial=>{const plan=runOrderCapacityTrial(trial);if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};return {units:trial.tailReservationChange!.units,groups:[{id:g.id,name:g.name,units:trial.tailReservationChange!.units}],loaded:plan.metrics.loadedCount,retained:true};});
 return {request,baseline,best:best!,mode:"quick" as const,groups,rows,canApply:true};
}
const quoted:TailCostQuote={freight:100,pricing:{currency:"CNY",packaging:{primary:20},charges:[{id:"labor",label:"Labor",category:"labor",basis:"container",amount:10,currency:"CNY",source:"QA quote"}]}};
it("accounts for actual packaging and cartons without applying, reselecting or changing inputs",()=>{
 const b=batch(),snapshot=structuredClone(b),quote=structuredClone(quoted),c=compareTailCosts(b.request,b.baseline,b.best.plan,quote);
 expect(c).toMatchObject({complete:true,currency:"CNY",selection:"quantity-first",costDifference:0,before:{loaded:8,loose:0,costs:{total:130},costPerLoadedCarton:16.25},after:{loaded:16,loose:8,costs:{total:130},costPerLoadedCarton:8.125}});expect(c.packages[0]).toMatchObject({beforeQuantity:1,quantity:1,unitPrice:20,beforeSubtotal:20,subtotal:20});expect(b).toEqual(snapshot);expect(quote).toEqual(quoted);c.quote.pricing.packaging.primary=999;expect(quote).toEqual(quoted);
});
it("retains known subtotals but never treats missing freight, packaging or rates as free",()=>{
 const b=batch();for(const quote of [{...quoted,freight:0},{...quoted,pricing:{...quoted.pricing,packaging:{}}},{...quoted,pricing:{...quoted.pricing,charges:[{...quoted.pricing.charges![0],currency:"USD"}]}}]){
  const c=compareTailCosts(b.request,b.baseline,b.best.plan,quote);expect(c.complete).toBe(false);expect(c.before.costs.total).toBeNull();expect(c.after.costPerLoadedCarton).toBeNull();expect(c.costDifference).toBeNull();expect(c.before.costs.knownSubtotal).toBeGreaterThan(0);
 }
});
it("supports explicitly free packaging and source-dated foreign quotes",()=>{
 const b=batch(),q={...quoted,pricing:{...quoted.pricing,packaging:{primary:0},charges:[{...quoted.pricing.charges![0],currency:"USD"}],exchangeRates:[{currency:"USD",rate:7,source:"Treasury",date:"2026-11-02"}]}};
 expect(compareTailCosts(b.request,b.baseline,b.best.plan,q).after.costs.total).toBe(170);
});
it("does not require prices for unused stock and charges an order only once per comparison side",()=>{
 const b=batch();b.request.palletBuild!.additionalSpecs=triplePalletTailFixture().palletBuild!.additionalSpecs;const q={...quoted,pricing:{...quoted.pricing,charges:[{...quoted.pricing.charges![0],basis:"order" as const,amount:7}]}};
 const c=compareTailCosts(b.request,b.baseline,b.best.plan,q);expect(c.after.costs.total).toBe(127);expect(c.packages.slice(1).every(p=>p.quantity===0&&p.subtotal===0&&p.unitPrice===null)).toBe(true);expect(c.after.costs.lines![0].quantity).toBe(1);
});
it.each([-1,NaN,Infinity,1e9+1])("rejects invalid freight %s",freight=>{const b=batch();expect(()=>compareTailCosts(b.request,b.baseline,b.best.plan,{...quoted,freight})).toThrow(/freight/);});
it("rejects stale specifications, invalid pricing and non-improving candidates",()=>{
 const b=batch();expect(()=>compareTailCosts(b.request,b.baseline,b.baseline,quoted)).toThrow();expect(()=>compareTailCosts(b.request,b.baseline,b.best.plan,{...quoted,pricing:{...quoted.pricing,packaging:{deleted:1}}})).toThrow();b.best.plan.pallets![0].specificationId="deleted";expect(()=>compareTailCosts(b.request,b.baseline,b.best.plan,quoted)).toThrow(/Stale/);
});
it("exports a deeply independent, reviewed complete batch including missing cost evidence",()=>{
 const b=batch(),report=buildTailCostReport(b,{...quoted,freight:0},"2026-11-02T00:00:00Z");expect(report).toMatchObject({format:"cargo-fit-tail-cost-report",version:1,status:"preview-not-applied",comparison:{complete:false},trial:{complete:true,selectedCandidate:{loaded:16}}});expect(report.trial.selectedCandidate!.review.checks.find(c=>c.id==="securing")!.state).toBe("unverified");report.comparison.quote.pricing.charges![0].source="changed";expect(quoted.pricing.charges![0].source).toBe("QA quote");
});
it("refuses incomplete, corrupt or stale cost reports even when quotes are complete",()=>{
 const a=batch();a.rows.pop();expect(()=>buildTailCostReport(a,quoted)).toThrow(/complete/);const b=batch();b.best.plan.placements[0].z=-10;expect(()=>buildTailCostReport(b,quoted)).toThrow();const c=batch();c.best.trial.request.palletBuild!.config.maxLoad++;expect(()=>buildTailCostReport(c,quoted)).toThrow(/original|packaging/);
});
it("derives report quantities and weight from reviewed geometry instead of trusting cached metrics",()=>{
 const b=batch();b.baseline.metrics.grossWeight=999999;b.best.plan.metrics.grossWeight=888888;const r=buildTailCostReport(b,quoted);expect(r.trial.baseline.id).toBe(b.baseline.id);expect(r.comparison.before.grossWeightKg).toBe(105);expect(r.comparison.after.grossWeightKg).toBe(185);expect(r.trial.selectedCandidate!.grossWeightKg).toBe(185);
 const corrupt=batch();corrupt.baseline.placements[0].z=-10;expect(()=>buildTailCostReport(corrupt,quoted)).toThrow();
});
it("cost CSV preserves unknown cells, free zero, bilingual scope and formula protection",()=>{
 const b=batch(),quote=structuredClone(quoted);quote.pricing.packaging.primary=0;quote.pricing.charges![0].label='=SUM(1,2)\n"quote"';quote.pricing.charges![0].amount=null;
 const report=buildTailCostReport(b,quote),csv=buildTailCostCsv(report,true),rows=parseCsvRecords(csv.replace(/^\uFEFF/,""));expect(csv.startsWith("\uFEFF")).toBe(true);expect(rows[0]).toHaveLength(11);expect(rows.find(r=>r[5]==="packaging:primary:subtotal")!.slice(8)).toEqual(["0","0","0"]);expect(rows.find(r=>r[5]==="quoted-total")!.slice(8)).toEqual(["","",""]);expect(rows.find(r=>r[5]==="charge:labor:subtotal")![6]).toBe('\'=SUM(1,2)\n"quote"');expect(rows[1][0]).toBe("Preview - not applied");expect(buildTailCostCsv(report)).toContain("已配置项目完整合计");
});
