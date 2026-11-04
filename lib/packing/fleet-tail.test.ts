import {expect,it} from "vitest";
import {allocateFleet} from "./fleet";
import {fleetTailGroups,prepareFleetTail,finishFleetTail,reviewFleetTailCandidate,adoptFleetTail,buildFleetTailCsv} from "./fleet-tail";
import {fleetTailHandoff} from "./fleet-tail-handoff";
import {fleetCanonical,validateFleet} from "./fleet-validation";
import {serializeFleetBackup,parseFleetBackup,buildFleetCoordinates} from "./fleet-file";
import {parseCsvRecords} from "./csv";
import {fleetPool} from "./fleet-inventory";
import {fleetTailFixture} from "../../tests/fleet-tail-fixture";

const solve=(p:ReturnType<typeof prepareFleetTail>)=>p.trials.map(t=>{const v=t.value;return allocateFleet(v.request,v.options,v.limit,v.objective,undefined,v.pricing);});
it.each(["practical","maximum"] as const)("reallocates whole %s fleets with one shared stock and reservation ledger",strategy=>{
 const source=fleetTailFixture(strategy),before=structuredClone(source),p=prepareFleetTail(source,"row:p",8),results=solve(p),report=finishFleetTail(p,results);
 expect(source.result.loads).toHaveLength(3);expect(source.result.inventory).toMatchObject({totalUsed:3,loose:[{reserved:2,used:2}]});
 expect(p.trials.map(t=>t.units)).toEqual([1,2,4,8]);expect(report.best).toBeDefined();
 const best=adoptFleetTail(p,report);expect(best.result.loads.length).toBeLessThanOrEqual(3);if(strategy==="maximum")expect(best.result.loads).toHaveLength(2);expect(best.result.remaining[0].quantity).toBe(0);expect(best.result.costs!.total).toBeLessThan(315);
 expect(best.request.products).toEqual(source.request.products);expect(best.request.palletBuild!.maxPallets).toBe(3);expect(best.result.inventory!.loose[0].used).toBe(best.request.palletBuild!.looseQuantities!.p);
 expect(best.result.inventory!.packages[0].used).toBeLessThanOrEqual(3);expect(validateFleet(best.request,best.result,best.options,best.limit).valid).toBe(true);expect(source).toEqual(before);
 expect(parseFleetBackup(serializeFleetBackup(best),best.request).result).toEqual(best.result);
 const coordinates=parseCsvRecords(buildFleetCoordinates(best.result));expect(coordinates.slice(1)).toHaveLength(12+best.result.inventory!.totalUsed);
});
it("keeps existing quotas as a floor and never reserves more than source demand",()=>{
 const source=fleetTailFixture(),p=prepareFleetTail(source,"row:p",10);expect(p.trials.map(t=>t.units)).toEqual([1,2,4,8,10]);expect(p.trials.at(-1)!.value.request.palletBuild!.looseQuantities).toEqual({p:12});
 expect(()=>prepareFleetTail(source,"row:p",11)).toThrow();expect(()=>prepareFleetTail(source,"missing",2)).toThrow();expect(()=>prepareFleetTail(source,"row:p",1.5)).toThrow();
});
it("bounds complete-kit additions by the sum of components and preserves uneven original demand",()=>{
 const source=fleetTailFixture(),a={...source.request.products[0],id:"a",sku:"SAME",quantity:45,setCode:" KIT ",unitsPerSet:2},b={...a,id:"b",quantity:23,unitsPerSet:1};source.request.products=[a,b];source.request.palletBuild!.looseQuantities={a:2,b:1};
 const groups=fleetTailGroups(source.request);expect(groups).toHaveLength(1);expect(groups[0]).toMatchObject({id:"kit:KIT",cartonsPerUnit:3,availableUnits:21});
 source.result=allocateFleet(source.request,source.options,source.limit,source.objective,undefined,source.pricing);const prepared=prepareFleetTail(source,"kit:KIT",21);
 expect(prepared.trials.at(-1)!.value.request.palletBuild!.looseQuantities).toEqual({a:44,b:22});expect(prepared.trials.at(-1)!.value.request.products.map(p=>p.quantity)).toEqual([45,23]);
 const result=solve(prepared);for(const r of result)for(const l of r.loads)for(const setNumber of new Set(l.plan.placements.map(b=>b.setNumber))){const boxes=l.plan.placements.filter(b=>b.setNumber===setNumber);expect(boxes.filter(b=>b.productId==="a")).toHaveLength(2);expect(boxes.filter(b=>b.productId==="b")).toHaveLength(1);expect(new Set(boxes.map(b=>b.palletIds?.[0]??"loose")).size).toBe(1);}
});
it("distinguishes duplicate SKU rows and exports every original row for every reviewed candidate",()=>{
 const source=fleetTailFixture();source.request.products[0].quantity=6;source.request.products.push({...source.request.products[0],id:"other"});source.result=allocateFleet(source.request,source.options,source.limit,source.objective,undefined,source.pricing);
 expect(fleetTailGroups(source.request).map(g=>g.name)).toEqual(["FLEET-TAIL [p]","FLEET-TAIL [other]"]);
 const prepared=prepareFleetTail(source,"row:p",4),report=finishFleetTail(prepared,solve(prepared)),csv=parseCsvRecords(buildFleetTailCsv(report,true));expect(csv.slice(1)).toHaveLength(prepared.trials.length*2);expect(new Set(csv.slice(1).map(r=>r[10]))).toEqual(new Set(["p","other"]));expect(report.candidates.every(c=>c.rows.length===2)).toBe(true);
});
it.each(["stock","cost","quantity","coordinates","loose","quote"])("independently rejects forged %s results",kind=>{
 const source=fleetTailFixture(),p=prepareFleetTail(source,"row:p",2),result=solve(p)[0];
 if(kind==="stock")result.inventory!.packages[0].used=0;
 if(kind==="cost")result.costs!.total=0;
 if(kind==="quantity")result.loads[0].plan.metrics.loadedCount++;
 if(kind==="coordinates")result.loads[0].plan.placements[0].x=-1;
 if(kind==="loose")result.inventory!.loose[0].reserved++;
 if(kind==="quote")result.pricing={currency:"USD",packaging:{primary:5}};
 expect(()=>reviewFleetTailCandidate(p,0,result)).toThrow();
});
it.each(["locked-carton","locked-pallet","measured","issued","large-order","large-fleet","direct"])("rejects unsupported %s baseline",kind=>{
 const source=fleetTailFixture();if(kind==="locked-carton")source.result.loads[0].plan.placements[0].locked=true;
 if(kind==="locked-pallet")source.result.loads[0].plan.pallets![0].locked=true;
 if(kind==="measured")source.result.loads[0].plan.pallets![0].measuredEnvelope={} as never;
 if(kind==="issued")source.result.loads[0].plan.deliveryIdentity={} as never;
 if(kind==="large-order")source.request.products[0].quantity=4001;
 if(kind==="large-fleet")source.limit=11;
 if(kind==="direct")source.request.workflow="direct";
 expect(()=>prepareFleetTail(source,"row:p",2)).toThrow();
});
it("keeps unquoted totals unknown and requires complete quotations for the cost objective",()=>{
 const source=fleetTailFixture();source.pricing=undefined;source.result=allocateFleet(source.request,source.options,source.limit,"count");const prepared=prepareFleetTail(source,"row:p",4),report=finishFleetTail(prepared,solve(prepared));expect(report.candidates.every(c=>c.configuredTotal===null)).toBe(true);
 source.objective="cost";expect(()=>prepareFleetTail(source,"row:p",4)).toThrow();
});
it("carries a validated adopted fleet across the exact root update and rejects a later unrelated request",()=>{
 const source=fleetTailFixture(),prepared=prepareFleetTail(source,"row:p",8),report=finishFleetTail(prepared,solve(prepared)),next=adoptFleetTail(prepared,report);
 expect(fleetTailHandoff(next,next.request)?.result).toEqual(next.result);expect(fleetTailHandoff(next,source.request)).toBeNull();expect(fleetTailHandoff(null,next.request)).toBeNull();
 const corrupt=structuredClone(next);corrupt.result.loads[0].plan.placements[0].z=-1;expect(fleetTailHandoff(corrupt,next.request)).toBeNull();
});
it("rejects incomplete batches, stale sources and changed allocations during adoption",()=>{
 const source=fleetTailFixture(),p=prepareFleetTail(source,"row:p",8),results=solve(p),report=finishFleetTail(p,results);expect(()=>finishFleetTail(p,results.slice(1))).toThrow();
 const stale=structuredClone(report);stale.source.limit=4;expect(()=>adoptFleetTail(p,stale)).toThrow();const forged=structuredClone(report);forged.best!.request.palletBuild!.looseQuantities!.p=12;expect(()=>adoptFleetTail(p,forged)).toThrow();
 expect(fleetCanonical(report.source.request)).toBe(fleetCanonical(source.request));
});
it("rejects a physically valid equal-total candidate that trades away another original source row",()=>{
 const source=fleetTailFixture();source.limit=1;source.request.products.push({...source.request.products[0],id:"q",sku:"OTHER"});source.request.palletBuild!.looseQuantities={p:2,q:2};
 source.result=allocateFleet({...source.request,products:[...source.request.products].reverse()},source.options,1,"count",undefined,source.pricing);
 const pool=fleetPool(source.request,source.result.loads);source.result.remaining=pool.products;source.result.inventory=pool.inventory;
 expect(validateFleet(source.request,source.result,source.options,1).valid).toBe(true);
 const prepared=prepareFleetTail(source,"row:p",4),results=solve(prepared),reviewed=results.map((r,i)=>reviewFleetTailCandidate(prepared,i,r));
 expect(reviewed.some(c=>!c.summary.retainsRows)).toBe(true);for(const c of reviewed.filter(c=>!c.summary.retainsRows))expect(c.summary.improves).toBe(false);
 const report=finishFleetTail(prepared,results);if(report.best)expect(report.candidates[report.bestIndex!].rows.every(r=>r.loaded>=r.before)).toBe(true);
});
