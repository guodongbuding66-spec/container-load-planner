import {describe,expect,it} from "vitest";
import {palletHeightFixture} from "../../tests/pallet-height-fixture";
import {inspectPalletHeights,preparePalletHeightTrial} from "./pallet-height";
import {packLoadingWorkflow} from "./pack-loading";
import {reviewOrderCapacityTrial,runOrderCapacityTrial} from "./order-capacity";
import {DEFAULT_PACKAGING} from "./packaging";

describe("pallet cargo ceiling trial with the original 596-carton order",()=>{
 it.each(["practical","maximum"] as const)("recalculates %s beyond the first layer without adding order demand",strategy=>{
  const request=palletHeightFixture();request.strategy=strategy;
  const original=structuredClone(request),before=packLoadingWorkflow(request);
  expect(before.metrics.loadedCount).toBe(16);expect(before.metrics.requestedCount).toBe(596);
  expect(before.metrics.grossWeight).toBe(772);expect(Math.max(...before.placements.map(b=>b.z+b.dz))).toBe(180);
  const trial=preparePalletHeightTrial(request),after=runOrderCapacityTrial(trial);
  expect(request).toEqual(original);expect(trial.request.products).toEqual(request.products);
  expect(trial.heightChanges).toEqual([{id:"primary",name:"Long carton pallet",from:120,to:2527}]);
  expect(after.validation.valid).toBe(true);expect(after.metrics.loadedCount).toBe(92);expect(after.metrics.requestedCount).toBe(596);
  expect(after.summaries[0].unloaded).toBe(504);expect(after.metrics.grossWeight).toBe(3964);
  expect(Math.max(...after.placements.map(b=>b.layer))).toBeGreaterThan(1);
  expect(after.palletBuild!.config.maxLoad).toBe(1000);expect(after.palletBuild!.stackLayers).toBe(1);
  expect(after.pallets!.every(p=>p.z===0)).toBe(true);
 });
 it.each(["layers","bottom","support","topLoad","above","payload"])("retains the separate %s restriction even when height increases",rule=>{
  const request=palletHeightFixture(),p=request.products[0];
  if(rule==="layers")p.maxStackLayers=1;
  if(rule==="bottom")p.bottomOnly=true;
  if(rule==="support")p.stackable=false;
  if(rule==="topLoad")p.maxTopLoadKg=0;
  if(rule==="above")p.allowedAboveSkus=[];
  if(rule==="payload")request.palletBuild!.config.maxLoad=168;
  const trial=preparePalletHeightTrial(request),after=runOrderCapacityTrial(trial);
  expect(trial.request.products).toEqual(request.products);expect(after.metrics.loadedCount).toBe(16);
  expect(after.metrics.requestedCount).toBe(596);expect(after.validation.valid).toBe(true);
 });
 it("reports separate height, carton-rule and payload bounds",()=>{
  const request=palletHeightFixture();request.products[0].maxStackLayers=1;
  expect(inspectPalletHeights(request)[0].products[0]).toMatchObject({heightLayers:1,configuredLayers:1,payloadCartons:23,minHeight:120});
  request.products[0].allowedOrientations=["HLW"];
  request.palletBuild!.config.width=100;
  expect(inspectPalletHeights(request)[0].products[0].minHeight).toBeNull();
 });
 it("changes only enabled open-pallet ceilings and retains crate dimensions and stock",()=>{
  const request=palletHeightFixture(),build=request.palletBuild!;
  build.primaryRule={maxPallets:4,productIds:[request.products[0].id]};
  build.additionalSpecs=[{id:"crate",config:{...build.config,name:"Crate",maxCargoHeight:800,packaging:{...DEFAULT_PACKAGING,enclosure:"panel"}},maxPallets:5,stackLayers:1,maxTopLoadKg:0},
   {id:"empty",config:{...build.config,name:"Out of stock"},maxPallets:0,stackLayers:1,maxTopLoadKg:0}];
  const trial=preparePalletHeightTrial(request),next=trial.request.palletBuild!;
  expect(next.primaryRule).toEqual(build.primaryRule);expect(next.additionalSpecs).toEqual(build.additionalSpecs);
  expect(trial.heightChanges).toHaveLength(1);
 });
 it("honours open loading access, clearance and deck height",()=>{
  const request=palletHeightFixture();request.container.loadingAccess="open";
  expect(inspectPalletHeights(request)[0].available).toBe(request.container.height-request.clearance-request.palletBuild!.config.height);
 });
 it("rejects changed packing rules and independently rechecks returned geometry",()=>{
  const trial=preparePalletHeightTrial(palletHeightFixture()),plan=runOrderCapacityTrial(trial);
  const wrong=structuredClone(plan);wrong.palletBuild!.config.maxLoad=10000;
  expect(()=>reviewOrderCapacityTrial(trial,wrong)).toThrow(/包装/);
  const overlap=structuredClone(plan);Object.assign(overlap.placements[1],{x:overlap.placements[0].x,y:overlap.placements[0].y,z:overlap.placements[0].z});
  expect(()=>reviewOrderCapacityTrial(trial,overlap)).toThrow();
 });
 it("does not offer a height change for automatic ceilings or exhausted packaging",()=>{
  const request=palletHeightFixture();request.palletBuild!.config.maxCargoHeight=0;
  expect(inspectPalletHeights(request)[0].canRaise).toBe(false);expect(()=>preparePalletHeightTrial(request)).toThrow();
  request.palletBuild!.config.maxCargoHeight=120;request.palletBuild!.primaryRule={maxPallets:0};
  expect(()=>preparePalletHeightTrial(request)).toThrow();
 });
 it("rejects unsupported workflows, oversized trials and invalid draft packaging",()=>{
  const request=palletHeightFixture();request.workflow="direct";expect(()=>preparePalletHeightTrial(request)).toThrow();
  request.workflow="palletized";request.products[0].quantity=4001;expect(()=>preparePalletHeightTrial(request)).toThrow();
  request.palletBuild!.additionalSpecs=[{id:"bad",config:request.palletBuild!.config,maxPallets:1,stackLayers:1,maxTopLoadKg:0,productIds:[]}];
  expect(inspectPalletHeights(request)).toEqual([]);
 });
});
