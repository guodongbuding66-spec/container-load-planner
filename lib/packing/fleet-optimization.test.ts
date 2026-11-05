import {expect,it} from "vitest";
import {allocateFleet} from "./fleet";
import {adoptFleetOptimization,buildFleetOptimizationCsv,createFleetOptimizationSearch,fleetOptimizationTrial,minimumFleetPrefix,prepareFleetOptimization,reviewFleetOptimization,solveFleetOptimizationTrial,type FleetOptimizationSettings} from "./fleet-optimization";
import {fleetTailFixture,jointFleetTailFixture} from "../../tests/fleet-tail-fixture";
import {parseFleetBackup,serializeFleetBackup,buildFleetCoordinates} from "./fleet-file";
import {validateFleet,fleetCanonical} from "./fleet-validation";
import {prepareFleetTail} from "./fleet-tail";
import {parseCsvRecords} from "./csv";
import type {PackingStrategy} from "./types";

const settings=(changes:Partial<FleetOptimizationSettings>={}):FleetOptimizationSettings=>({mode:"reallocate",keepPrefix:0,cartonBudget:64,comparePackaging:true,rework:{dismantle:2,rebuild:3,source:"Factory QA quotation"},...changes});
function run(source=jointFleetTailFixture(5),options=settings()){
 const p=prepareFleetOptimization(source,options),search=createFleetOptimizationSearch(p);let job;
 while((job=search.next()))search.accept(job.index,solveFleetOptimizationTrial(p,job.spec));
 return {p,report:search.finish()};
}
function oneContainer(strategy:PackingStrategy="maximum"){
 const s=jointFleetTailFixture(5,strategy);s.limit=1;s.result=allocateFleet(s.request,s.options,1,s.objective,undefined,s.pricing);return s;
}
it.each(["maximum","practical"] as const)("automatically reviews more than four groups under %s, retains every row and charges actual work",strategy=>{
 const s=jointFleetTailFixture(5,strategy),before=structuredClone(s),{p,report}=run(s),best=adoptFleetOptimization(p,report),c=report.candidates[report.bestIndex!];
 expect(s.result.loads).toHaveLength(10);expect(report.groups).toHaveLength(5);expect(report.search.kind).toBe("adaptive");expect(report.candidates.length).toBeLessThanOrEqual(64);expect(best.result.loads).toHaveLength(5);expect(c).toMatchObject({loaded:25,remaining:0,dismantled:10,rebuilt:0,reworkTotal:20,baseConfiguredTotal:500,configuredTotal:520,retainsRows:true});
 expect(c.rows.every(r=>r.loaded===5&&r.before===5)).toBe(true);expect(best.request.products).toEqual(s.request.products);expect(best.request.palletBuild!.maxPallets).toBe(10);expect(best.result.inventory!.totalUsed).toBe(0);expect(best.result.costs!.lines).toEqual([expect.objectContaining({category:"rework",amount:20,subtotal:20})]);
 expect(validateFleet(best.request,best.result,best.options,best.limit).valid).toBe(true);expect(s).toEqual(before);
});
it("identifies a complete small grid and preserves original quota floors",()=>{
 const s=fleetTailFixture(),{p,report}=run(s,settings({cartonBudget:1,comparePackaging:false}));expect(report.search).toMatchObject({kind:"complete-grid",candidateDomain:1,evaluated:1});expect(p.groups).toHaveLength(1);
 expect(fleetOptimizationTrial(p,p.seeds[0]).request.palletBuild!.looseQuantities).toEqual({p:3});expect(s.request.palletBuild!.looseQuantities).toEqual({p:2});
});
it.each([64,65])("keeps the explicit %i-group boundary and the 64-carton budget",count=>{
 const s=fleetTailFixture(),first=s.request.products[0];s.request.products=Array.from({length:count},(_,i)=>({...first,id:`many-${i}`,sku:`ROW-${i}`,quantity:1}));s.request.palletBuild={...s.request.palletBuild!,mix:"mixed",looseQuantities:undefined};s.result=allocateFleet(s.request,s.options,s.limit,s.objective,undefined,s.pricing);
 if(count===65){expect(()=>prepareFleetOptimization(s,settings())).toThrow(/64/);return;}
 const p=prepareFleetOptimization(s,settings());expect(p.groups).toHaveLength(64);expect(p.domainSize).toBeNull();for(const trial of p.seeds){expect(trial.units).toHaveLength(64);expect(trial.units.reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(64);}
 expect(p.seeds.some(t=>t.units.every(n=>n===1))).toBe(true);
});
it.each(["negative-prefix","prefix-too-large","budget-zero","budget-too-large","bad-quote","missing-source","wrong-mode","large-order","large-fleet"])("rejects unsupported %s settings before starting",kind=>{
 const source=jointFleetTailFixture(2),v=settings();
 if(kind==="negative-prefix")v.keepPrefix=-1;if(kind==="prefix-too-large")v.keepPrefix=99;if(kind==="budget-zero")v.cartonBudget=0;if(kind==="budget-too-large")v.cartonBudget=65;if(kind==="bad-quote")v.rework.dismantle=NaN;if(kind==="missing-source")v.rework.source="";if(kind==="wrong-mode")v.mode="other" as never;if(kind==="large-order")source.request.products[0].quantity=4001;if(kind==="large-fleet")source.limit=21;
 expect(()=>prepareFleetOptimization(source,v)).toThrow();
});
it("keeps missing rework quotes unknown and refuses to rank them as free under cost priority",()=>{
 const source=jointFleetTailFixture(2),v=settings({rework:{dismantle:null,rebuild:null,source:""}}),p=prepareFleetOptimization(source,v),spec={units:p.groups.map(g=>g.ceiling),selection:"ordered" as const},r=reviewFleetOptimization(p,spec,0,solveFleetOptimizationTrial(p,spec));
 expect(r.summary.reworkTotal).toBeNull();expect(r.summary.configuredTotal).toBeNull();expect(r.value.result.costs!.complete).toBe(false);
 source.objective="cost";expect(()=>prepareFleetOptimization(source,v)).toThrow(/quotes/);
});
it("declines a cheaper-freight schedule when its quoted dismantling makes the full cost worse",()=>{
 const s=jointFleetTailFixture(2);s.objective="cost";const {report}=run(s,settings({rework:{dismantle:1000,rebuild:1000,source:"Expensive work"}}));expect(report.bestIndex).toBeNull();expect(report.candidates.every(c=>!c.improves)).toBe(true);
});
it("preserves a locked prefix with the original plan identity and quota context through v2 backup",()=>{
 const source=jointFleetTailFixture(5);source.result.loads[0].plan.placements[0].locked=true;expect(minimumFleetPrefix(source)).toBe(1);expect(()=>prepareFleetOptimization(source,settings())).toThrow();
 const p=prepareFleetOptimization(source,settings({keepPrefix:1})),spec={units:p.groups.map(g=>g.ceiling),selection:"compact" as const},result=solveFleetOptimizationTrial(p,spec),r=reviewFleetOptimization(p,spec,0,result);
 expect(r.summary.retainsRows).toBe(true);expect(r.value.result.loads[0].plan).toEqual(source.result.loads[0].plan);expect(r.value.result.loads[0].frozen).toEqual({selection:"ordered"});expect(r.summary.dismantled).toBe(9);
 const text=serializeFleetBackup(r.value);expect(JSON.parse(text).version).toBe(2);const restored=parseFleetBackup(text,r.value.request);expect(buildFleetCoordinates(restored.result)).toBe(buildFleetCoordinates(r.value.result));expect(minimumFleetPrefix(restored)).toBe(1);expect(()=>prepareFleetTail(restored,p.groups[0].id,1)).toThrow();
});
it.each(["prefix-id","prefix-coordinate","prefix-context","extra-commitment","stock","price"])("independently rejects forged %s candidates",kind=>{
 const source=jointFleetTailFixture(3),p=prepareFleetOptimization(source,settings({keepPrefix:1})),spec={units:p.groups.map(g=>g.ceiling),selection:"ordered" as const},r=solveFleetOptimizationTrial(p,spec);
 if(kind==="prefix-id")r.loads[0].plan.id="forged";if(kind==="prefix-coordinate")r.loads[0].plan.placements[0].x+=1;if(kind==="prefix-context")r.loads[0].frozen!.selection="compact";if(kind==="extra-commitment")r.loads[1].frozen={selection:"ordered",looseQuantities:fleetOptimizationTrial(p,spec).request.palletBuild!.looseQuantities};if(kind==="stock")r.inventory!.totalUsed=0;if(kind==="price")r.costs!.total=0;
 expect(()=>reviewFleetOptimization(p,spec,0,r)).toThrow();
});
it.each(["maximum","practical"] as const)("fills real %s gaps without moving locked cartons or complete units, increasing stock or dismantling",strategy=>{
 const source=oneContainer(strategy),old=source.result.loads[0].plan;old.placements[0].locked=true;old.pallets![0].locked=true;expect(minimumFleetPrefix(source,"fill")).toBe(0);
 const p=prepareFleetOptimization(source,settings({mode:"fill"})),spec={units:p.groups.map(()=>1),selection:"ordered" as const},result=solveFleetOptimizationTrial(p,spec),r=reviewFleetOptimization(p,spec,0,result),plan=r.value.result.loads[0].plan;
 expect(old.metrics.loadedCount).toBe(4);expect(plan.metrics.loadedCount).toBe(6);expect(plan.metrics.grossWeight).toBe(80);expect(plan.pallets).toEqual(old.pallets);expect(r.summary).toMatchObject({containers:1,dismantled:0,rebuilt:0,reworkTotal:0,configuredTotal:105,improves:true});
 for(const box of old.placements)expect(plan.placements.find(b=>b.id===box.id)).toEqual(box);expect(r.value.result.inventory!.totalUsed).toBe(1);expect(r.value.result.remaining.reduce((n,p)=>n+p.quantity,0)).toBe(19);expect(source.request.palletBuild!.looseQuantities).toBeUndefined();
});
it("rejects changed original identities in a geometrically valid gap-fill result",()=>{
 const source=oneContainer(),p=prepareFleetOptimization(source,settings({mode:"fill"})),spec={units:p.groups.map(()=>1),selection:"ordered" as const},r=solveFleetOptimizationTrial(p,spec);r.loads[0].plan.placements[0].id="changed-original-id";expect(()=>reviewFleetOptimization(p,spec,0,r)).toThrow(/identity/);
});
it("rejects gap filling when there is no order remainder or all containers are committed",()=>{
 expect(()=>prepareFleetOptimization(jointFleetTailFixture(2),settings({mode:"fill"}))).toThrow();expect(()=>prepareFleetOptimization(oneContainer(),settings({mode:"fill",keepPrefix:1}))).toThrow();
});
it("keeps whole 1:2 kits atomic while filling and reports all original source rows",()=>{
 const source=oneContainer(),first=source.request.products[0];source.request.products=[{...first,id:"a",sku:"SAME",quantity:7,setCode:"KIT",unitsPerSet:1},{...first,id:"b",sku:"SAME",quantity:14,setCode:"KIT",unitsPerSet:2}];source.request.palletBuild={...source.request.palletBuild!,primaryRule:undefined,additionalSpecs:undefined,mix:"mixed",maxPallets:5};source.result=allocateFleet(source.request,source.options,1,"count",undefined,{currency:"CNY",packaging:{primary:5}});source.pricing=source.result.pricing;
 const p=prepareFleetOptimization(source,settings({mode:"fill"}));expect(p.groups).toHaveLength(1);expect(p.groups[0].cartonsPerUnit).toBe(3);
 const spec={units:[1],selection:"ordered" as const},result=solveFleetOptimizationTrial(p,spec),r=reviewFleetOptimization(p,spec,0,result);expect(r.summary.allocations[0].cartons).toBe(3);expect(r.summary.rows).toHaveLength(2);
 for(const l of result.loads)for(const code of new Set(l.plan.placements.map(b=>b.setNumber))){const cargo=l.plan.placements.filter(b=>b.setNumber===code);expect(cargo.filter(b=>b.productId==="b").length).toBe(2*cargo.filter(b=>b.productId==="a").length);}
});
it("exports a complete source-row ledger, then rejects changed source, quota and derived work charges on apply",()=>{
 const {p,report}=run(jointFleetTailFixture(3)),csv=parseCsvRecords(buildFleetOptimizationCsv(report,true));expect(csv).toHaveLength(1+3*report.candidates.length);expect(csv[0]).toHaveLength(29);expect(csv.slice(1).every(r=>r[25]==="preview-not-applied")).toBe(true);
 for(const kind of ["source","settings","quota","charges"]){const bad=structuredClone(report);if(kind==="source")bad.source.limit=9;if(kind==="settings")bad.settings.keepPrefix=1;if(kind==="quota")bad.best!.request.palletBuild!.looseQuantities!["row-1"]--;if(kind==="charges")bad.best!.pricing!.charges![0].amount=0;expect(()=>adoptFleetOptimization(p,bad)).toThrow();}
 expect(fleetCanonical(adoptFleetOptimization(p,report).request.products)).toBe(fleetCanonical(p.source.request.products));
});
it("requires a fully acknowledged finite batch and rejects duplicate or out-of-order results",()=>{
 const p=prepareFleetOptimization(fleetTailFixture(),settings({cartonBudget:1,comparePackaging:false})),search=createFleetOptimizationSearch(p);expect(()=>search.finish()).toThrow();const job=search.next()!;expect(()=>search.next()).toThrow();const r=solveFleetOptimizationTrial(p,job.spec);expect(()=>search.accept(1,r)).toThrow();search.accept(0,r);expect(()=>search.accept(0,r)).toThrow();expect(()=>search.finish()).toThrow();expect(search.next()).toBeNull();expect(search.finish().complete).toBe(true);
});
it("rejects a truncated batch even if its completion flag and evaluated counter are forged",()=>{
 const {p,report}=run(jointFleetTailFixture(3)),bad=structuredClone(report);bad.candidates=bad.candidates.slice(0,bad.bestIndex!+1);bad.search.evaluated=bad.candidates.length;expect(bad.candidates.length).toBeLessThan(report.candidates.length);expect(()=>adoptFleetOptimization(p,bad)).toThrow(/incomplete/);
});
it("separates returned reports and trial geometry from the prepared immutable source",()=>{
 const {p,report}=run(jointFleetTailFixture(2)),before=structuredClone(p.source);report.source.limit=19;report.settings.cartonBudget=1;report.best!.options[0].container.name="Changed";expect(p.source).toEqual(before);expect(()=>adoptFleetOptimization(p,report)).toThrow();
});
