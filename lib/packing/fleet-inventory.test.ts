import {describe,it,expect} from "vitest";
import {allocateFleet,compareFleets,optimizeFleetTail,fleetEconomics,proposeOrderTopUp,reviewFleet} from "./fleet";
import {fleetPool} from "./fleet-inventory";
import {fleetCosts,parseFleetPricing} from "./fleet-costs";
import {validateFleet} from "./fleet-validation";
import {serializeFleetBackup,parseFleetBackup,buildFleetCoordinates,buildFleetSummary} from "./fleet-file";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {parseCsvRecords} from "./csv";
import type {PackingRequest,ProductInput} from "./types";
const p:ProductInput={id:"p",sku:"SHED-BOX",name:"Shed carton",length:500,width:500,height:200,weight:10,quantity:12,priority:50,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,maxStackLayers:0,maxTopLoadKg:100,color:"#337788"};
const build={...DEFAULT_PALLET_BUILD,maxPallets:3,looseQuantities:{p:2},config:{...DEFAULT_PALLET_BUILD.config,name:"QA pallet",length:1000,width:1000,height:100,weight:20,maxCargoHeight:200}};
const c={id:"small",name:"Small QA",length:1500,width:1000,height:300,doorWidth:1000,doorHeight:300,maxWeight:1000};
const req:PackingRequest={workflow:"palletized",mode:"mixed",strategy:"maximum",palletBuild:build,products:[p],container:c,clearance:0};
const opts=[{container:c,cost:100,available:5}],pricing={currency:"CNY",packaging:{primary:5}};
const run=(r=req,o=opts,prices=pricing)=>allocateFleet(r,o,5,"count",undefined,prices);

describe("shared fleet inventory, whole schedules and entered costs",()=>{
 it.each(["practical","maximum"] as const)("preserves the full order and loose quota across containers with %s",strategy=>{
  const r={...req,strategy},result=run(r);expect(result.complete).toBe(true);expect(result.loads).toHaveLength(3);expect(result.loads.reduce((n,l)=>n+l.plan.metrics.loadedCount,0)).toBe(12);
  expect(result.inventory).toMatchObject({totalUsed:3,totalLimit:3,packages:[{available:3,used:3,remaining:0}],loose:[{reserved:2,used:2,remaining:0}]});expect(result.costs).toMatchObject({freight:300,packaging:15,total:315,complete:true});expect(validateFleet(r,result,opts).errors).toEqual([]);
  expect(result.loads.reduce((n,l)=>n+l.plan.metrics.grossWeight,0)).toBe(180);
 });
 it("does not consume packaging from discarded trial units",()=>{
  const result=run();expect(result.loads[0].plan.palletization?.preparedCount).toBe(3);expect(result.loads[0].plan.pallets).toHaveLength(1);expect(result.inventory?.totalUsed).toBe(3);expect(result.loads[1].plan.palletization?.preparedCount).toBe(2);
 });
 it("stops at the shared total unit limit and retains unmet palletized cargo",()=>{
  const r={...req,palletBuild:{...build,maxPallets:2}},result=run(r);expect(result.complete).toBe(false);expect(result.remaining[0].quantity).toBe(2);expect(result.inventory?.totalUsed).toBe(2);expect(result.inventory?.loose[0].used).toBe(2);expect(result.loads.reduce((n,l)=>n+l.plan.metrics.loadedCount,0)).toBe(10);
 });
 it("keeps per-specification stock separate, including zero-stock primaries",()=>{
  const r={...req,palletBuild:{...build,primaryRule:{maxPallets:1},additionalSpecs:[{id:"extra",config:{...build.config,name:"Extra"},maxPallets:1,stackLayers:1,maxTopLoadKg:0}]}},prices={currency:"USD",packaging:{primary:5,extra:7}},result=run(r,opts,prices);
  expect(result.inventory?.packages.map(p=>p.used)).toEqual([1,1]);expect(result.remaining[0].quantity).toBe(2);expect(result.costs?.packaging).toBe(12);
  const emptyPrimary=run({...r,palletBuild:{...r.palletBuild,primaryRule:{maxPallets:0}}},opts,prices);expect(emptyPrimary.inventory?.packages.map(p=>p.used)).toEqual([0,1]);
 });
 it("debits each candidate only after it is chosen",()=>{
  const options=[...opts,{container:{...c,id:"alternative",name:"Alternative"},cost:120,available:5}],result=run(req,options);
  expect(result.complete).toBe(true);expect(result.inventory?.totalUsed).toBe(3);expect(result.inventory?.loose[0].used).toBe(2);expect(req.palletBuild?.maxPallets).toBe(3);expect(req.products[0].quantity).toBe(12);
 });
 it("respects physical vehicle availability as well as package availability",()=>{
  const options=[{...opts[0],available:1}],result=run(req,options);expect(result.loads).toHaveLength(1);expect(result.remaining[0].quantity).toBe(6);expect(result.inventory?.packages[0].remaining).toBe(2);
 });
 it("preserves mismatched kit leftovers without splitting loose or palletized sets",()=>{
  const products=[{...p,id:"a",sku:"A",setCode:"KIT",unitsPerSet:2,quantity:9},{...p,id:"b",sku:"B",setCode:"KIT",unitsPerSet:1,quantity:4}],r={...req,products,palletBuild:{...build,looseQuantities:{a:2,b:1}}},result=run(r);
  expect(result.remaining.map(p=>p.quantity)).toEqual([1,0]);expect(result.loads.reduce((n,l)=>n+l.plan.setSummaries[0].loadedSets,0)).toBe(4);
  for(const l of result.loads)for(const setNumber of new Set(l.plan.placements.map(b=>b.setNumber))){const boxes=l.plan.placements.filter(b=>b.setNumber===setNumber);expect(boxes).toHaveLength(3);expect(new Set(boxes.map(b=>b.palletIds?.[0]??"loose")).size).toBe(1);}
 });
 it("can use remaining loose cargo after the shared package stock reaches zero",()=>{
  const r={...req,palletBuild:{...build,maxPallets:1,looseQuantities:{p:8}}},result=run(r);expect(result.complete).toBe(true);expect(result.inventory?.totalUsed).toBe(1);expect(result.inventory?.loose[0].used).toBe(8);expect(result.loads.some(l=>!l.plan.pallets?.length)).toBe(true);
 });
 it("reports all-reserved orders without requiring unused packaging prices",()=>{
  const r={...req,palletBuild:{...build,looseQuantities:{p:12}}},prices={currency:"CNY",packaging:{}};
  const result=allocateFleet(r,opts,5,"cost",undefined,prices);expect(result.complete).toBe(true);expect(result.inventory?.totalUsed).toBe(0);expect(result.costs?.packaging).toBe(0);
 });
 it("does not label unquoted packages as free or compute a complete total",()=>{
  const result=allocateFleet(req,opts,5,"count");expect(result.costs?.packaging).toBeNull();expect(result.costs?.total).toBeNull();expect(result.costs?.knownSubtotal).toBe(300);expect(fleetEconomics(result).some(r=>r.costPerSet===null)).toBe(true);
  expect(()=>allocateFleet(req,opts,5,"cost")).toThrow(/单价/);
 });
 it("accepts explicitly free packaging while keeping zero freight unknown",()=>{
  const result=run(req,opts,{currency:"CNY",packaging:{primary:0}});expect(result.costs?.total).toBe(300);expect(run(req,[{...opts[0],cost:0}]).costs?.total).toBeNull();
 });
 it.each([{currency:"BAD!",packaging:{}},{currency:"CNY",packaging:{primary:-1}},{currency:"CNY",packaging:{deleted:1}},{currency:"USD",packaging:{primary:NaN}}])("rejects invalid/stale prices %j",value=>expect(()=>parseFleetPricing(value,req)).toThrow());
 it("compares complete schedules by freight plus actual packaging cost",()=>{
  const products=[{...p,quantity:8}],r={...req,products,palletBuild:{...build,maxPallets:2,looseQuantities:undefined,config:{...build.config,maxCargoHeight:0}},container:{...c,length:1000}},small={container:{...r.container,id:"low"},cost:100,available:3},large={container:{...r.container,id:"high",height:500,doorHeight:500},cost:230,available:2},prices={currency:"CNY",packaging:{primary:60}};
  const results=compareFleets(r,[small,large],3,"cost",undefined,prices);expect(results[0].result.costs?.total).toBe(290);expect(results[0].result.totalCost).toBe(230);expect(results.find(r=>r.label==="全部 Small QA")?.result.costs?.total).toBeDefined();
  expect(results.some(c=>c.result.costs?.total===320)).toBe(true);expect(fleetEconomics(results[0].result).reduce((n,s)=>n+s.cost,0)).toBeCloseTo(290);
 });
 it("rebuilds only tail cargo and reuses stock released by removed tail containers",()=>{
  const r={...req,palletBuild:{...build,looseQuantities:undefined,config:{...build.config,maxCargoHeight:0}},container:{...c,length:1000}},small={container:r.container,cost:100,available:3},big={container:{...r.container,id:"big",height:500,doorHeight:500},cost:130,available:1};
  const baseline=run(r,[small]),prefix=baseline.loads[0],identity=JSON.stringify(prefix);const optimized=optimizeFleetTail(r,baseline,[small,big],"count",pricing);
  expect(optimized.loads).toHaveLength(2);expect(optimized.loads[0]).toBe(prefix);expect(JSON.stringify(prefix)).toBe(identity);expect(optimized.inventory?.totalUsed).toBe(2);expect(optimized.complete).toBe(true);expect(validateFleet(r,optimized,[small,big]).valid).toBe(true);
 });
 it("keeps delivery stops and straight-path inputs on every prebuilt container",()=>{
  const delivery={p:{customer:"Customer",destination:"Port",stop:2}},r={...req,delivery},result=run(r);expect(result.loads.every(l=>JSON.stringify(l.plan.delivery)===JSON.stringify(delivery))).toBe(true);expect(validateFleet(r,result,opts).valid).toBe(true);
  const forged=structuredClone(result);forged.loads[0].plan.delivery!.p.stop=1;expect(validateFleet(r,forged,opts).valid).toBe(false);
 });
 it("validates source-bound fleet backups and rechecks all physical coordinates",()=>{
  const result=run(),value={request:req,options:opts,limit:5,objective:"count" as const,pricing,result},file=serializeFleetBackup(value),restored=parseFleetBackup(file,req);expect(restored.result).toEqual(result);
  for(const mutate of [(v:typeof value)=>{v.result.remaining[0].quantity=1;},(v:typeof value)=>{v.result.inventory!.packages[0].used=0;},(v:typeof value)=>{v.result.costs!.total=0;},(v:typeof value)=>{v.result.loads[1].plan.placements[0].x=-1;},(v:typeof value)=>{v.result.pricing!.packaging.primary=0;}]){const copy=structuredClone(value);mutate(copy);expect(()=>parseFleetBackup(JSON.stringify({format:"cargo-fit-fleet-v1",version:1,...copy}),req)).toThrow();}
  expect(()=>parseFleetBackup(file,{...req,products:[{...p,quantity:13}]})).toThrow(/当前订单/);
 });
 it("distinguishes container-local physical IDs and conserves exported mass",()=>{
  const result=run(),rows=parseCsvRecords(buildFleetCoordinates(result)),head=rows[0],weight=head.indexOf("重量(kg)");expect(rows.slice(1)).toHaveLength(15);expect(new Set(rows.slice(1).map(r=>r[0])).size).toBe(3);expect(rows.slice(1).reduce((n,r)=>n+Number(r[weight]),0)).toBe(180);
  const summary=parseCsvRecords(buildFleetSummary(result));expect(summary.find(r=>r[0]==="freight-and-packaging")?.slice(6,11)).toEqual(["300","15","315","315","CNY"]);
 });
 it("never transfers unknown costs or extra packaging into a free top-up promise",()=>{
  const result=run();const proposal=proposeOrderTopUp(req,result,opts,20,pricing);if(proposal){expect(proposal.result.costs!.total).toBeLessThanOrEqual(result.costs!.total!);expect(proposal.result.inventory!.totalUsed).toBeLessThanOrEqual(3);}
  expect(proposeOrderTopUp(req,allocateFleet(req,opts,5,"count"),opts,20)).toBeNull();
 });
 it("retains zero-load orders as unmet and does not rank zero cost as a quote",()=>{
  const result=run(req,[{...opts[0],container:{...c,length:100,width:100,doorWidth:100}}]);expect(result.loads).toHaveLength(0);expect(result.complete).toBe(false);expect(result.costs?.total).toBeNull();expect(result.remaining[0].quantity).toBe(12);expect(fleetCosts([]).complete).toBe(false);
 });
 it("rejects pallet-only fleet requests, duplicate vehicle IDs and hard shared-stock violations",()=>{
  expect(()=>run({...req,workflow:"pallet-only"})).toThrow();expect(()=>run(req,[...opts,...opts])).toThrow(/重复/);
  const result=run();expect(()=>fleetPool({...req,palletBuild:{...build,maxPallets:2}},result.loads)).toThrow(/超限/);
 });
 it("does not prefer an unquoted zero-freight candidate at equal cargo",()=>{
  const r={...req,products:[{...p,quantity:1}],palletBuild:{...build,looseQuantities:{p:1}}},options=[opts[0],{...opts[0],container:{...c,id:"unquoted"},cost:0}];expect(run(r,options).loads[0].plan.container.id).toBe(c.id);
 });
 it("prices physically laid floor pallets without claiming shared prebuilt stock",()=>{
  const r={...req,workflow:"direct" as const,palletBuild:undefined,products:[{...p,quantity:4}],floorPallets:build.config};
  expect(()=>allocateFleet(r,opts,2,"cost")).toThrow(/单价/);const result=allocateFleet(r,opts,2,"cost",undefined,{currency:"USD",packaging:{floor:10}});expect(result.costs?.total).toBe(110);expect(result.inventory).toBeUndefined();
 });
 it("preserves required high-priority delivery over an optional cheaper partial schedule",()=>{
  const products=[{...p,id:"must",sku:"MUST",length:1000,width:1000,quantity:1,mustLoad:true},{...p,id:"optional",sku:"OPTIONAL",quantity:10,mustLoad:false}],large={...c,id:"large",length:1000,height:200,doorHeight:200},small={...large,id:"tiny",length:500,width:500,doorWidth:500};
  const r={...req,workflow:"direct" as const,palletBuild:undefined,products,container:large},result=allocateFleet(r,[{container:small,cost:1,available:1},{container:large,cost:100,available:1}],1,"cost");expect(result.loads[0].plan.placements[0].sku).toBe("MUST");expect(result.remaining.find(p=>p.id==="optional")?.quantity).toBe(10);
 });
 it("rejects reuse of the first container's loose allocation in a later container",()=>{
  const result=structuredClone(run());result.loads[1].plan=structuredClone(result.loads[0].plan);expect(validateFleet(req,result,opts).valid).toBe(false);
 });
 it("enforces the shared total independently of larger per-specification stocks",()=>{
  expect(()=>fleetPool({...req,palletBuild:{...build,maxPallets:2,primaryRule:{maxPallets:5}}},run().loads)).toThrow(/总上限/);
 });
 it("does not reintroduce committed loose cargo when replacing two tail containers",()=>{
  const baseline=run(),large={container:{...c,id:"large",length:3500},cost:130,available:1},result=optimizeFleetTail(req,baseline,[...opts,large],"count",pricing);expect(result.loads).toHaveLength(2);expect(result.loads[0]).toBe(baseline.loads[0]);expect(result.inventory?.loose[0].used).toBe(2);expect(result.loads.reduce((n,l)=>n+l.plan.metrics.loadedCount,0)).toBe(12);
 });
 it("uses the existing tail capacity without increasing packaging stock or quoted cost",()=>{
  const base=run(),proposal=proposeOrderTopUp(req,base,opts,20,pricing);expect(proposal?.additions[0].quantity).toBe(2);expect(proposal?.result.inventory?.totalUsed).toBe(3);expect(proposal?.result.costs?.total).toBe(315);
 });
 it("keeps large access reviews explicitly unverified within a bounded budget",()=>{
  const r={...req,workflow:"direct" as const,palletBuild:undefined,products:[{...p,length:100,width:100,height:100,quantity:300,weight:0}],container:{...c,length:1000}},result=allocateFleet(r,[{container:r.container,cost:100,available:1}],1,"count");expect(result.loads[0].plan.metrics.loadedCount).toBe(300);expect(reviewFleet(result).pathUnverified).toBe(1);expect(reviewFleet(result).constraints).toContain("access-budget");
 });

});
