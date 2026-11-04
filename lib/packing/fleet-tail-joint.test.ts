import {expect,it} from "vitest";
import {allocateFleet} from "./fleet";
import {adoptFleetTail,buildFleetTailCsv,createFleetTailReview,finishFleetTail,fleetTailGroups,prepareFleetTail,prepareJointFleetTail} from "./fleet-tail";
import {parseCsvRecords} from "./csv";
import {parseFleetBackup,serializeFleetBackup} from "./fleet-file";
import {validateFleet} from "./fleet-validation";
import {fleetTailFixture,jointFleetTailFixture} from "../../tests/fleet-tail-fixture";

const solve=(p:ReturnType<typeof prepareJointFleetTail>)=>p.trials.map(t=>{const v=t.value;return allocateFleet(v.request,v.options,v.limit,v.objective,undefined,v.pricing);});
it.each(["practical","maximum"] as const)("independently adopts four joint source rows with shared stock using %s",strategy=>{
 const source=jointFleetTailFixture(4,strategy),before=structuredClone(source),selections=fleetTailGroups(source.request).map(g=>({groupId:g.id,limit:1})),prepared=prepareJointFleetTail(source,selections),report=finishFleetTail(prepared,solve(prepared));
 expect(source.result.loads).toHaveLength(8);expect(source.result.costs!.total).toBe(840);expect(prepared.trials).toHaveLength(15);expect(report.version).toBe(2);expect(report.groups).toHaveLength(4);expect(report.best).toBeDefined();
 const adopted=adoptFleetTail(prepared,report);expect(adopted.result.loads).toHaveLength(4);expect(adopted.result.costs!.total).toBe(420);expect(adopted.result.remaining.every(p=>p.quantity===0)).toBe(true);expect(adopted.result.inventory!.packages.map(p=>p.used)).toEqual([1,1,1,1]);expect(adopted.result.inventory!.loose.map(p=>p.used)).toEqual([1,1,1,1]);
 expect(adopted.request.products).toEqual(source.request.products);expect(adopted.request.palletBuild!.maxPallets).toBe(8);expect(validateFleet(adopted.request,adopted.result,adopted.options,10).valid).toBe(true);expect(parseFleetBackup(serializeFleetBackup(adopted),adopted.request).result).toEqual(adopted.result);expect(source).toEqual(before);
 expect(report.candidates[report.bestIndex!].rows.every(r=>r.loaded===5&&r.before===5&&r.reserved===1)).toBe(true);
});
it("proves the fourth selected group improves over every completed three-group candidate",()=>{
 const source=jointFleetTailFixture(),groups=fleetTailGroups(source.request),selections=groups.map(g=>({groupId:g.id,limit:1})),three=prepareJointFleetTail(source,selections.slice(0,3)),four=prepareJointFleetTail(source,selections);
 expect(finishFleetTail(three,solve(three)).best!.result.loads).toHaveLength(5);expect(finishFleetTail(four,solve(four)).best!.result.loads).toHaveLength(4);
 const single=prepareFleetTail(source,groups[0].id,1);expect(finishFleetTail(single,solve(single)).best!.result.loads).toHaveLength(7);
});
it.each([2,3,4])("exhausts a distinct %i-group grid including one-sided allocations and excluding all-zero",count=>{
 const source=jointFleetTailFixture(),selection=fleetTailGroups(source.request).slice(0,count).map(g=>({groupId:g.id,limit:1})),p=prepareJointFleetTail(source,selection);
 expect(p.trials).toHaveLength(2**count-1);expect(new Set(p.trials.map(t=>JSON.stringify(t.allocations!.map(a=>a.units)))).size).toBe(p.trials.length);expect(p.trials.every(t=>t.allocations!.some(a=>a.units>0))).toBe(true);for(let i=0;i<count;i++)expect(p.trials.some(t=>t.allocations!.every((a,j)=>a.units===(i===j?1:0)))).toBe(true);
 expect(p.trials.map(t=>t.allocations!.reduce((n,a)=>n+a.cartons,0))).toEqual(p.trials.map(t=>t.allocations!.reduce((n,a)=>n+a.cartons,0)).sort((a,b)=>a-b));
});
it("accepts 63 candidates at the grid edge and rejects the next Cartesian grid before solving",()=>{
 const source=jointFleetTailFixture(2);source.request.products.forEach(p=>p.quantity=10);source.result=allocateFleet(source.request,source.options,10,"count",undefined,source.pricing);
 const groups=fleetTailGroups(source.request);expect(prepareJointFleetTail(source,groups.map(g=>({groupId:g.id,limit:7}))).trials).toHaveLength(63);expect(()=>prepareJointFleetTail(source,[{groupId:groups[0].id,limit:8},{groupId:groups[1].id,limit:7}])).toThrow(/64/);
});
it.each(["one","five","duplicate","missing","fraction","zero","over-demand"])("rejects %s joint selections",kind=>{
 const source=jointFleetTailFixture(),groups=fleetTailGroups(source.request),s=groups.slice(0,2).map(g=>({groupId:g.id,limit:1}));
 if(kind==="one")s.pop();if(kind==="five")s.push(...groups.slice(2).map(g=>({groupId:g.id,limit:1})),{groupId:"extra",limit:1});if(kind==="duplicate")s[1].groupId=s[0].groupId;if(kind==="missing")s[1].groupId="deleted";if(kind==="fraction")s[1].limit=1.5;if(kind==="zero")s[1].limit=0;if(kind==="over-demand")s[1].limit=6;
 expect(()=>prepareJointFleetTail(source,s)).toThrow();
});
it("counts whole-kit cartons across groups and preserves the original non-kit remainder",()=>{
 const source=jointFleetTailFixture(2),a=source.request.products[0],b={...a,id:"component",sku:"COMP",quantity:11,setCode:"KIT",unitsPerSet:2};a.setCode="KIT";a.unitsPerSet=1;a.quantity=6;source.request.products.push(b);source.request.palletBuild!.primaryRule!.productIds=[a.id,b.id];source.request.palletBuild!.looseQuantities={"row-1":1,component:2};source.result=allocateFleet(source.request,source.options,10,"count",undefined,source.pricing);
 const p=prepareJointFleetTail(source,[{groupId:"kit:KIT",limit:1},{groupId:"row:row-2",limit:1}]);expect(p.trials.at(-1)!.allocations!.map(a=>a.cartons)).toEqual([3,1]);expect(p.trials.at(-1)!.value.request.palletBuild!.looseQuantities).toEqual({"row-1":2,component:4,"row-2":1});expect(p.trials.at(-1)!.value.request.products.map(p=>p.quantity)).toEqual([6,5,11]);
 const report=finishFleetTail(p,solve(p));for(const c of report.candidates)expect(c.addedCartons).toBe(c.allocations!.reduce((n,a)=>n+a.cartons,0));
});
it("rejects a small grid whose combined whole-kit carton ceilings exceed the global carton budget",()=>{
 const source=fleetTailFixture(),a=source.request.products[0];source.request.products=[{...a,id:"a",quantity:33,setCode:"A",unitsPerSet:33},{...a,id:"b",quantity:32,setCode:"B",unitsPerSet:32}];source.request.palletBuild!.looseQuantities=undefined;source.result=allocateFleet(source.request,source.options,source.limit,"count",undefined,source.pricing);
 expect(()=>prepareJointFleetTail(source,[{groupId:"kit:A",limit:1},{groupId:"kit:B",limit:1}])).toThrow(/64/);
});
it("exports every candidate vector and every original source row, including unchanged same-SKU rows",()=>{
 const source=jointFleetTailFixture(4);source.request.products.forEach(p=>p.sku="SAME");source.result=allocateFleet(source.request,source.options,10,"count",undefined,source.pricing);const p=prepareJointFleetTail(source,fleetTailGroups(source.request).map(g=>({groupId:g.id,limit:1}))),report=finishFleetTail(p,solve(p)),csv=parseCsvRecords(buildFleetTailCsv(report,true));
 expect(csv).toHaveLength(61);expect(csv[0].slice(-4)).toEqual(report.groups!.map(g=>`Added units: ${g.name} [${g.id}]`));for(let i=0;i<report.candidates.length;i++)for(const row of csv.slice(1+i*4,1+(i+1)*4)){expect(row.slice(-4).map(Number)).toEqual(report.candidates[i].allocations!.map(a=>a.units));expect(Number(row[20])).toBe(report.candidates[i].addedCartons);}
 expect(new Set(csv.slice(1).map(r=>r[10]))).toEqual(new Set(source.request.products.map(p=>p.id)));expect(report.groups!.every(g=>g.name.includes("row-"))).toBe(true);
});
it("reviews streaming results in order, forbids partial finish, and revalidates adoption metadata",()=>{
 const source=jointFleetTailFixture(2),p=prepareJointFleetTail(source,fleetTailGroups(source.request).map(g=>({groupId:g.id,limit:1}))),results=solve(p),review=createFleetTailReview(p);
 expect(()=>review.finish()).toThrow();expect(()=>review.accept(1,results[1])).toThrow();review.accept(0,results[0]);expect(()=>review.accept(0,results[0])).toThrow();results.slice(1).forEach((r,i)=>review.accept(i+1,r));const report=review.finish();expect(report.best).toBeDefined();expect(()=>review.accept(results.length,results[0])).toThrow();
 for(const kind of ["group","vector","version"]){const forged=structuredClone(report);if(kind==="group")forged.groups![1].id="other";if(kind==="vector")forged.candidates[forged.bestIndex!].allocations![1].units=0;if(kind==="version")forged.version=1;expect(()=>adoptFleetTail(p,forged)).toThrow();}
});
