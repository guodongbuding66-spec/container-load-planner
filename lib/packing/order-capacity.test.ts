import {expect,it} from "vitest";
import {packLoadingWorkflow} from "./pack-loading";
import {calculateReverseCounts} from "./engine";
import {orderCapacityFixture} from "../../tests/order-capacity-fixture";
import {prepareOrderCapacityTrial,runOrderCapacityTrial,reviewOrderCapacityTrial,replenishedOrder} from "./order-capacity";

it("keeps a 16-carton order intact while independently trialling the arithmetic target",()=>{
 const request=orderCapacityFixture(),before=structuredClone(request),original=packLoadingWorkflow(request),trial=prepareOrderCapacityTrial(request,.85,.9);
 expect(original.metrics.loadedCount).toBe(16);expect(trial.arithmeticCartons).toBe(596);expect(trial.request.products[0].quantity).toBe(596);
 const plan=runOrderCapacityTrial(trial);expect(plan.validation.valid).toBe(true);expect(plan.metrics.loadedCount).toBeGreaterThan(16);expect(plan.metrics.loadedCount).toBeLessThan(596);expect(new Set(plan.placements.map(b=>b.z)).size).toBeGreaterThan(1);
 expect(request).toEqual(before);expect(original.placements).toHaveLength(16);expect(plan.metrics.grossWeight).toBe(plan.placements.length*42+plan.pallets!.length*25);
 const next=replenishedOrder(request.products,plan);expect(next[0].quantity).toBe(plan.metrics.loadedCount);expect(packLoadingWorkflow({...request,products:next}).metrics.loadedCount).toBe(plan.metrics.loadedCount);
});
it.each(["practical","maximum"] as const)("uses the original %s rules and checks complete pallet geometry",strategy=>{
 const trial=prepareOrderCapacityTrial({...orderCapacityFixture(),strategy},.85,.9),plan=runOrderCapacityTrial(trial);
 expect(plan.strategy).toBe(strategy);expect(plan.workflow).toBe("palletized");expect(plan.validation.valid).toBe(true);expect(plan.pallets!.every(p=>p.dz===144&&p.weight===25)).toBe(true);
 expect(plan.placements.every(p=>p.z>=144&&p.z+p.dz<=1144)).toBe(true);
});
it.each(["height","layers","support","weight","stock"])("does not bypass a limiting %s declaration",limit=>{
 const request=orderCapacityFixture();if(limit==="height")request.palletBuild!.config.maxCargoHeight=120;
 if(limit==="layers")request.products[0].maxStackLayers=1;
 if(limit==="support")request.products[0].stackable=false;
 if(limit==="weight")request.palletBuild!.config.maxLoad=42;
 if(limit==="stock")request.palletBuild!.maxPallets=1;
 const before=structuredClone(request),trial=prepareOrderCapacityTrial(request,.85,.9),plan=runOrderCapacityTrial(trial);
 expect(plan.validation.valid).toBe(true);expect(plan.metrics.loadedCount).toBeLessThan(40);expect(request).toEqual(before);expect(trial.request.palletBuild).toEqual(before.palletBuild);
});
it("never erases original unmet quantities when a trial has less capacity",()=>{
 const request=orderCapacityFixture(1000),trial=prepareOrderCapacityTrial(request,.1,.1),plan=runOrderCapacityTrial(trial);
 expect(trial.request.products[0].quantity).toBe(1000);expect(replenishedOrder(request.products,plan)[0].quantity).toBe(1000);
});
it("retains complete 1:2 kits in hypothetical stock and verified packing",()=>{
 const r=orderCapacityFixture();r.workflow="direct";r.palletBuild=undefined;r.products=[{...r.products[0],id:"a",sku:"A",length:500,width:500,height:100,quantity:4,weight:10,setCode:"KIT",unitsPerSet:1},{...r.products[0],id:"b",sku:"B",length:500,width:500,height:100,quantity:8,weight:10,setCode:"KIT",unitsPerSet:2}];
 const t=prepareOrderCapacityTrial(r,.1,.1),p=runOrderCapacityTrial(t);expect(t.request.products[1].quantity).toBe(t.request.products[0].quantity*2);expect(p.summaries[1].loaded).toBe(p.summaries[0].loaded*2);expect(p.validation.valid).toBe(true);
});
it("leaves zero-demand SKUs out of the stock ratio",()=>{
 const r=orderCapacityFixture();r.products.push({...r.products[0],id:"unused",quantity:0});expect(calculateReverseCounts(r,.85,.9).quantities[1].suggestedQuantity).toBe(0);expect(prepareOrderCapacityTrial(r,.85,.9).request.products[1].quantity).toBe(0);
});
it("does not invent an order ratio when all demands are zero",()=>{const r=orderCapacityFixture(0);expect(calculateReverseCounts(r,.85,.9).recommendedTotal).toBe(0);});
it("bounds tiny-carton arithmetic demands instead of claiming full capacity",()=>{
 const r=orderCapacityFixture();r.workflow="direct";r.palletBuild=undefined;Object.assign(r.products[0],{length:10,width:10,height:10,weight:0});const trial=prepareOrderCapacityTrial(r,.85,.9);
 expect(trial.budgetLimited).toBe(true);expect(trial.arithmeticCartons).toBeGreaterThan(4000);expect(trial.request.products[0].quantity).toBeLessThanOrEqual(4000);
});
it.each([0,4001])("rejects unsupported order budgets: %s",quantity=>expect(()=>prepareOrderCapacityTrial(orderCapacityFixture(quantity),.85,.9)).toThrow(/1–4000/));
it.each([NaN,0,1.1])("rejects invalid target ratios: %s",ratio=>expect(()=>prepareOrderCapacityTrial(orderCapacityFixture(),ratio,.9)).toThrow(/target ratios/));
it.each(["single-capacity","pallet-only"] as const)("rejects unsupported workflow %s",workflow=>expect(()=>prepareOrderCapacityTrial({...orderCapacityFixture(),workflow},.85,.9)).toThrow(/require/));
it("rechecks coordinates and does not trust worker counters",()=>{
 const t=prepareOrderCapacityTrial(orderCapacityFixture(),.1,.1),p=runOrderCapacityTrial(t),tampered=structuredClone(p);tampered.metrics.loadedCount=9999;
 expect(reviewOrderCapacityTrial(t,tampered).metrics.loadedCount).toBe(p.placements.length);tampered.placements[0].z=-100;expect(()=>reviewOrderCapacityTrial(t,tampered)).toThrow();
});
it("rejects different packaging, workflow and solver claims",()=>{
 const t=prepareOrderCapacityTrial(orderCapacityFixture(),.1,.1),p=runOrderCapacityTrial(t);
 expect(()=>reviewOrderCapacityTrial(t,{...p,strategy:"maximum"})).toThrow(/strategy/);expect(()=>reviewOrderCapacityTrial(t,{...p,workflow:"direct"})).toThrow(/workflow/);
 const changed=structuredClone(p);changed.palletBuild!.config.maxLoad=9999;expect(()=>reviewOrderCapacityTrial(t,changed)).toThrow(/packaging/);
});
it("does not copy delivery assignments into hypothetical stock or invent top-load ratings",()=>{
 const r=orderCapacityFixture();r.delivery={long:{customer:"Customer",destination:"Destination",stop:2}};const before=structuredClone(r.delivery),t=prepareOrderCapacityTrial(r,.85,.9);expect(t.request.delivery).toBeUndefined();expect(t.request.products[0].maxTopLoadKg).toBeUndefined();expect(r.delivery).toEqual(before);
});
