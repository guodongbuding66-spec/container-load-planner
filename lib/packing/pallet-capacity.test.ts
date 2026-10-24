import {describe,expect,it} from "vitest";
import {packagingCapacityFixture} from "../../tests/packaging-capacity-fixture";
import {palletHeightFixture} from "../../tests/pallet-height-fixture";
import {canCompareExistingPackaging,preparePackagingComparisonTrial,inspectPalletCapacity,improvesPalletTrial} from "./pallet-capacity";
import {packLoadingWorkflow} from "./pack-loading";
import {runOrderCapacityTrial,reviewOrderCapacityTrial} from "./order-capacity";
import {DEFAULT_LOADING_RULES} from "./loading-rules";
import {unitContentsKey} from "./unit-envelope";

describe("existing packaging comparison and compact unit loading",()=>{
 it.each(["practical","maximum"] as const)("loads 299 cartons with 13 registered small pallets in %s",strategy=>{
  const request=packagingCapacityFixture();request.strategy=strategy;const original=structuredClone(request),before=packLoadingWorkflow(request);
  expect(before.metrics.loadedCount).toBe(92);
  const trial=preparePackagingComparisonTrial(request),after=runOrderCapacityTrial(trial);
  expect(request).toEqual(original);expect(trial.request.products).toEqual(original.products);
  const expected=structuredClone(original.palletBuild!);expected.selection="compact";
  expect(trial.request.palletBuild).toEqual(expected);expect(trial.packagingSelectionChange).toEqual({from:"ordered",to:"compact"});
  expect(after.validation.valid).toBe(true);expect(after.metrics.requestedCount).toBe(596);expect(after.metrics.loadedCount).toBe(299);
  expect(after.summaries[0].unloaded).toBe(297);expect(after.metrics.grossWeight).toBe(12883);
  expect(inspectPalletCapacity(after)!.groups).toEqual([{id:"long-small",name:"Small registered pallet",units:13,cartons:299}]);
  expect(improvesPalletTrial(after,before)).toBe(true);
  // 14 floor units require at least one large base because small stock is 13.
  // Their minimum area exceeds the net floor, and every unit holds at most 23 cartons by payload.
  const floor=(request.container.length-2*request.clearance)*(request.container.width-2*request.clearance);
  expect(13*1800*1100+2743*2233).toBeGreaterThan(floor);
  expect(Math.floor(1000/42)*13).toBe(after.metrics.loadedCount);
 });
 it("keeps two-pallet stock bounded while using compatible large fallback units",()=>{
  const request=packagingCapacityFixture(2),after=runOrderCapacityTrial(preparePackagingComparisonTrial(request));
  expect(after.metrics.loadedCount).toBe(115);expect(after.validation.valid).toBe(true);
  expect(inspectPalletCapacity(after)!.groups).toEqual([{id:"long-small",name:"Small registered pallet",units:2,cartons:46},{id:"primary",name:"Large registered pallet",units:3,cartons:69}]);
  expect(after.palletBuild!.additionalSpecs![0].maxPallets).toBe(2);
 });
 it("respects an explicitly requested cargo order instead of overriding it",()=>{
  const request=packagingCapacityFixture();request.palletBuild!.selection="compact";
  request.loadingRules={...DEFAULT_LOADING_RULES,cargoOrder:"large-first"};
  expect(packLoadingWorkflow(request).metrics.loadedCount).toBe(92);
  request.loadingRules.cargoOrder="small-first";
  expect(packLoadingWorkflow(request).metrics.loadedCount).toBe(299);
 });
 it("does not invent a usable alternative from zero stock, ineligible SKUs or one specification",()=>{
  const request=packagingCapacityFixture(0);expect(canCompareExistingPackaging(request)).toBe(false);expect(()=>preparePackagingComparisonTrial(request)).toThrow();
  request.palletBuild!.additionalSpecs![0].maxPallets=13;request.palletBuild!.additionalSpecs![0].productIds=["absent"];
  expect(canCompareExistingPackaging(request)).toBe(false);
  expect(canCompareExistingPackaging(palletHeightFixture())).toBe(false);
 });
 it("rejects an already compact or oversized trial and rejects a changed stock reply",()=>{
  const request=packagingCapacityFixture();request.palletBuild!.selection="compact";expect(()=>preparePackagingComparisonTrial(request)).toThrow();
  request.palletBuild!.selection="ordered";request.products[0].quantity=4001;expect(()=>preparePackagingComparisonTrial(request)).toThrow();
  request.products[0].quantity=596;const trial=preparePackagingComparisonTrial(request),after=runOrderCapacityTrial(trial);
  after.palletBuild!.additionalSpecs![0].maxPallets=99;
  expect(()=>reviewOrderCapacityTrial(trial,after)).toThrow(/包装/);
 });
 it("will not call a larger total an improvement when a loaded order row is displaced",()=>{
  const before=packLoadingWorkflow(palletHeightFixture()),after=structuredClone(before);
  after.metrics.loadedCount=before.metrics.loadedCount+1;
  after.placements[0].productId="other-row";after.placements.push({...after.placements[0],id:"new"});
  expect(improvesPalletTrial(after,before)).toBe(false);
 });
});

describe("saved-unit footprint and payload diagnostics",()=>{
 it("explains low volume utilization using base dimensions and actual cargo load",()=>{
  const request=packagingCapacityFixture(),plan=packLoadingWorkflow(request),report=inspectPalletCapacity(plan)!;
  expect(report.rows).toHaveLength(4);expect(report.baseArea).toBe(24500476);expect(report.floorArea).toBe(27987960);
  expect(report.baseCoverage).toBeCloseTo(.87539341917);expect(report.payloadUtilization).toBe(.966);
  expect(report.rows[0]).toMatchObject({length:2743,width:2233,baseHeight:60,cartons:23,cargoKg:966,capacityKg:1000,remainingKg:34,cargoHeight:720});
 });
 it("subtracts added support mass exactly once from the cargo rating",()=>{
  const plan=packLoadingWorkflow(palletHeightFixture()),p=plan.pallets![0];
  p.packaging={...p.packaging!,deckSupports:[{id:"s",name:"Support",x:0,y:0,dx:100,dy:100,dz:20,weightKg:10,maxLoadKg:1000,source:"fixture",revision:"1"}]};
  const row=inspectPalletCapacity(plan)!.rows[0];expect(row.capacityKg).toBe(990);expect(row.cargoKg).toBe(168);expect(row.remainingKg).toBe(822);
 });
 it("counts stacked base projections once and withholds margins requiring transferred loads",()=>{
  const plan=packLoadingWorkflow(palletHeightFixture()),p=plan.pallets![0];
  plan.pallets=[p,{...p,id:"upper",z:180}];plan.placements=[];
  const report=inspectPalletCapacity(plan)!;expect(report.baseArea).toBe(p.dx*p.dy);expect(report.payloadUtilization).toBeNull();expect(report.rows.every(r=>r.remainingKg===null)).toBe(true);
 });
 it("withholds margins for measured envelopes and unresolved associations",()=>{
  const plan=packLoadingWorkflow(palletHeightFixture()),p=plan.pallets![0],cargo=plan.placements.filter(b=>b.palletIds?.includes(p.id));
  p.measuredEnvelope={version:1,length:p.dx,width:p.dy,height:180,noseProtrusion:0,leftProtrusion:0,source:"fixture",date:"2026-10-24",contentsKey:unitContentsKey(p,cargo)};
  expect(inspectPalletCapacity(plan)!.rows[0].remainingKg).toBeNull();
  delete p.measuredEnvelope;plan.placements[0].palletIds=[p.id,plan.pallets![1].id];
  const report=inspectPalletCapacity(plan)!;expect(report.unassignedCartons).toBe(1);expect(report.rows.every(r=>r.remainingKg===null)).toBe(true);
 });
 it("separates explicitly loose cartons instead of duplicating their mass across pallets",()=>{
  const plan=packLoadingWorkflow(palletHeightFixture()),b=plan.placements[0];
  plan.palletization!.looseQuantities={[b.productId]:1};plan.placements.push({...b,id:"loose",palletIds:undefined});
  const report=inspectPalletCapacity(plan)!;expect(report.looseCartons).toBe(1);expect(report.unassignedCartons).toBe(0);expect(report.rows.reduce((n,r)=>n+r.cartons,0)).toBe(16);
 });
 it("does not hide missing support mass behind a zero remainder",()=>{
  const plan=packLoadingWorkflow(palletHeightFixture()),p=plan.pallets![0];
  p.packaging={...p.packaging!,deckSupports:[{id:"s",name:"Support",x:0,y:0,dx:100,dy:100,dz:20,weightKg:null,maxLoadKg:null,source:"",revision:""}]};
  const row=inspectPalletCapacity(plan)!.rows[0];expect(row.capacityKg).toBeNull();expect(row.remainingKg).toBeNull();
  delete plan.palletization;expect(inspectPalletCapacity(plan)).toBeNull();
 });
});
