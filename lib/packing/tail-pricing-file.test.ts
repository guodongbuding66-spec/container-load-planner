import {expect,it} from "vitest";
import {palletTailFixture,triplePalletTailFixture} from "../../tests/pallet-tail-fixture";
import {serializeTailPricing,parseTailPricing,MAX_TAIL_PRICING_BYTES} from "./tail-pricing-file";
import {buildTailCostReport,type TailCostQuote} from "./pallet-tail-costs";
import {packLoadingWorkflow} from "./pack-loading";
import {preparePalletTailTrials,tailCargoGroups} from "./pallet-tail";
import {runOrderCapacityTrial} from "./order-capacity";
const date="2026-11-03T00:00:00.000Z",quote:TailCostQuote={freight:1000,pricing:{currency:"CNY",packaging:{primary:20},charges:[{id:"labor",label:"Labor",category:"labor",basis:"container",amount:10,currency:"USD",source:"QA quote"}],exchangeRates:[{currency:"USD",rate:7,source:"QA treasury",date:"2026-11-03"}]}};
const file=()=>serializeTailPricing(quote,palletTailFixture(),date);
it("round-trips only quotes, preserving sources, dates, zero and unknown",()=>{
 const r=palletTailFixture(),q=structuredClone(quote),snapshot=structuredClone(r);q.pricing.packaging.primary=0;const parsed=parseTailPricing(serializeTailPricing(q,r,date),r);expect(parsed.quote).toEqual(q);expect(parsed.source).toEqual({format:"cargo-fit-tail-pricing",createdAt:date});expect(r).toEqual(snapshot);parsed.quote.pricing.packaging.primary=999;expect(q.pricing.packaging.primary).toBe(0);
 q.pricing.packaging.primary=null;q.pricing.charges![0].amount=null;q.pricing.exchangeRates=undefined;expect(parseTailPricing(serializeTailPricing(q,r,date),r).quote).toEqual(q);expect(file()).not.toContain('"placements"');
});
it("extracts quotes from a real cost report while ignoring its stored results and positions",()=>{
 const request=palletTailFixture(),baseline=packLoadingWorkflow(request),g=tailCargoGroups(request,baseline)[0],trials=preparePalletTailTrials(request,baseline,g.id,8),plans=trials.map(runOrderCapacityTrial),best={trial:trials.at(-1)!,plan:plans.at(-1)!};
 const report=buildTailCostReport({request,baseline,best,mode:"quick",groups:[{id:g.id,name:g.name,limit:8,cartonsPerUnit:1}],rows:trials.map((t,i)=>({units:t.tailReservationChange!.units,groups:[{id:g.id,name:g.name,units:t.tailReservationChange!.units}],loaded:plans[i].metrics.loadedCount,retained:true})),canApply:false},quote,date);
 report.comparison.after.costs.total=999999;report.trial.selectedCandidate!.loaded=9999;const parsed=parseTailPricing(JSON.stringify(report),request);expect(parsed.quote).toEqual(quote);expect(parsed.source.format).toBe("cargo-fit-tail-cost-report");expect(Object.keys(parsed).sort()).toEqual(["context","quote","source"]);expect(parsed).not.toHaveProperty("comparison");
});
it("accepts current demand, stock and row/specification order changes without reusing prior quantities",()=>{
 const r=triplePalletTailFixture(),text=serializeTailPricing({...quote,pricing:{...quote.pricing,packaging:{primary:20,"sku-b":null}}},r,date);r.products.reverse();r.products[0].quantity=30;r.palletBuild!.maxPallets=4;r.palletBuild!.additionalSpecs!.reverse();expect(parseTailPricing(text,r).quote.pricing.packaging).toEqual({primary:20,"sku-b":null});
});
it.each(["container","packaging","row","sku","customer","delivery","kit"])("rejects changed %s applicability even when identifiers appear reusable",kind=>{
 const r=palletTailFixture();if(kind==="container")r.container.length++;if(kind==="packaging")r.palletBuild!.config.length++;if(kind==="row")r.products[0].id="other";if(kind==="sku")r.products[0].sku="other";if(kind==="customer")r.products[0].orderLine={orderReference:"",lineReference:"",customer:"changed",batch:"",destination:"",stop:1};if(kind==="delivery")r.delivery={a:{customer:"Changed",destination:"Next",stop:2}};if(kind==="kit")r.products[0].setCode="KIT";expect(()=>parseTailPricing(file(),r)).toThrow(/context changed/);
});
it.each([-1,1e9+1,"1000",null])("rejects invalid freight %s before replacing pricing",freight=>{const f=JSON.parse(file());f.quote.freight=freight;expect(()=>parseTailPricing(JSON.stringify(f),palletTailFixture())).toThrow(/freight/);});
it("rejects stale packaging prices, malformed quote dates and invalid rates",()=>{
 const r=palletTailFixture(),f=JSON.parse(file());f.quote.pricing.packaging.deleted=1;expect(()=>parseTailPricing(JSON.stringify(f),r)).toThrow();for(const createdAt of ["",null,"2026-02-30T00:00:00.000Z","2026-11-03"]){const f=JSON.parse(file());f.createdAt=createdAt;expect(()=>parseTailPricing(JSON.stringify(f),r)).toThrow();}const fx=JSON.parse(file());fx.quote.pricing.exchangeRates[0].rate=0;expect(()=>parseTailPricing(JSON.stringify(fx),r)).toThrow();
});
it.each(["bad-json","workspace","trial-report","future-version"])("rejects %s as a quote file",kind=>{if(kind==="bad-json"){expect(()=>parseTailPricing("{",palletTailFixture())).toThrow();return;}const f=JSON.parse(file());if(kind==="future-version")f.version=2;else f.format=kind==="workspace"?"cargo-fit-workspace":"cargo-fit-tail-trial-report";expect(()=>parseTailPricing(JSON.stringify(f),palletTailFixture())).toThrow();});
it("enforces the byte budget before parsing, including multibyte text",()=>{expect(()=>parseTailPricing(" ".repeat(MAX_TAIL_PRICING_BYTES+1),palletTailFixture())).toThrow(/5 MB/);expect(()=>parseTailPricing("中".repeat(Math.ceil(MAX_TAIL_PRICING_BYTES/3)+1),palletTailFixture())).toThrow(/5 MB/);});
it("compares JSON objects independently of key order and exports fresh copies",()=>{const r=palletTailFixture(),f=JSON.parse(file());f.context=Object.fromEntries(Object.entries(f.context).reverse());expect(parseTailPricing(JSON.stringify(f),r).quote).toEqual(quote);const original=structuredClone(quote);serializeTailPricing(quote,r,date);expect(quote).toEqual(original);});
