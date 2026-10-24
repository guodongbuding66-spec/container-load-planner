import {expect,it} from "vitest";
import {packagingCapacityFixture} from "../../tests/packaging-capacity-fixture";
import {palletTailFixture} from "../../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "./pack-loading";
import {preparePalletTailTrials,tailCargoGroups} from "./pallet-tail";
import {runOrderCapacityTrial,reviewOrderCapacityTrial} from "./order-capacity";
import {improvesPalletTrial} from "./pallet-capacity";
import {looseManifest} from "./loose-cargo";
import {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans} from "./workspace-file";
import {ENGINE_VERSION} from "./engine";

it.each(["practical","maximum"] as const)("loads more original cartons alongside one intact pallet with %s",strategy=>{
 const request=palletTailFixture();request.strategy=strategy;const before=structuredClone(request),baseline=packLoadingWorkflow(request);
 expect(baseline.metrics.loadedCount).toBe(8);
 const trials=preparePalletTailTrials(request,baseline,"row:a",8),results=trials.map(runOrderCapacityTrial),best=results.at(-1)!;
 expect(trials.map(t=>t.tailReservationChange!.units)).toEqual([1,2,4,8]);expect(results.map(p=>p.metrics.loadedCount)).toEqual([9,10,12,16]);
 expect(best.validation.valid).toBe(true);expect(best.metrics.requestedCount).toBe(20);expect(best.metrics.grossWeight).toBe(185);expect(best.pallets).toHaveLength(1);
 expect(looseManifest(best)[0]).toMatchObject({reserved:8,loose:8,palletized:8,unloaded:4});expect(improvesPalletTrial(best,baseline)).toBe(true);
 for(const t of trials){const expected=structuredClone(request);expected.palletBuild!.looseQuantities={a:t.tailReservationChange!.units};expected.singleCartonLimit=undefined;expect(t.request).toEqual(expected);}
 expect(request).toEqual(before);expect(baseline.placements).toHaveLength(8);
});
it("retains existing loose allocations and only changes the selected row",()=>{
 const request=palletTailFixture();request.products.push({...request.products[0],id:"other",sku:"OTHER",quantity:2});request.palletBuild!.looseQuantities={other:2};
 const baseline=packLoadingWorkflow(request),trials=preparePalletTailTrials(request,baseline,"row:a",3);
 expect(trials.map(t=>t.request.palletBuild!.looseQuantities)).toEqual([{a:1,other:2},{a:2,other:2},{a:3,other:2}]);
});
it("reserves complete 1:2 kits and preserves stop assignments",()=>{
 const request=palletTailFixture();request.products=[{...request.products[0],length:200,width:200,height:100,quantity:10,setCode:"KIT",unitsPerSet:1},{...request.products[0],id:"b",sku:"B",length:200,width:200,height:100,quantity:20,setCode:"KIT",unitsPerSet:2}];request.palletBuild!.config.maxLoad=30;
 request.delivery={a:{customer:"A",destination:"First",stop:1},b:{customer:"A",destination:"First",stop:1}};
 const baseline=packLoadingWorkflow(request),trials=preparePalletTailTrials(request,baseline,"kit:KIT",3);
 expect(trials.map(t=>t.request.palletBuild!.looseQuantities)).toEqual([{a:1,b:2},{a:2,b:4},{a:3,b:6}]);
 for(const trial of trials){expect(trial.request.delivery).toEqual(request.delivery);const result=runOrderCapacityTrial(trial);expect(result.validation.valid).toBe(true);expect(result.summaries[1].loaded).toBe(result.summaries[0].loaded*2);}
});
it("bounds candidates by complete residual kits, original stock and 64 added cartons",()=>{
 const request=palletTailFixture();request.products[0].quantity=100;request.products[0].setCode="KIT";request.products[0].unitsPerSet=3;
 const plan=packLoadingWorkflow(request),group=tailCargoGroups(request,plan)[0];expect(group.availableUnits).toBe(21);expect(group.cartonsPerUnit).toBe(3);
 expect(preparePalletTailTrials(request,plan,group.id,21).map(t=>t.tailReservationChange!.units)).toEqual([1,2,4,8,21]);expect(()=>preparePalletTailTrials(request,plan,group.id,22)).toThrow(/Tail exceeds/);
});
it.each([0,1.5,65,NaN])("rejects invalid tail ceilings: %s",limit=>{const r=palletTailFixture();expect(()=>preparePalletTailTrials(r,packLoadingWorkflow(r),"row:a",limit)).toThrow(/Tail limit/);});
it.each(["locked","measuredEnvelope"] as const)("refuses to rebuild %s units",field=>{const r=palletTailFixture(),p=packLoadingWorkflow(r);Object.assign(p.pallets![0],{[field]:field==="locked"?true:{version:1}});expect(()=>preparePalletTailTrials(r,p,"row:a",2)).toThrow(/cannot be rebuilt/);});
it("rejects stale packaging, strategy, bad baseline coordinates and unknown groups",()=>{
 const r=palletTailFixture(),p=packLoadingWorkflow(r);const changed=structuredClone(r);changed.palletBuild!.config.maxLoad+=1;
 expect(()=>preparePalletTailTrials(changed,p,"row:a",2)).toThrow(/differ/);expect(()=>preparePalletTailTrials({...r,strategy:"maximum"},p,"row:a",2)).toThrow(/differ/);
 expect(()=>preparePalletTailTrials(r,p,"missing",2)).toThrow(/Tail exceeds/);p.placements[0].z=-10;expect(()=>preparePalletTailTrials(r,p,"row:a",2)).toThrow();
});
it("rejects worker allocation tampering and illegal loose coordinates",()=>{
 const r=palletTailFixture(),trial=preparePalletTailTrials(r,packLoadingWorkflow(r),"row:a",2).at(-1)!,p=runOrderCapacityTrial(trial),bad=structuredClone(p);bad.palletBuild!.looseQuantities!.a=3;
 expect(()=>reviewOrderCapacityTrial(trial,bad)).toThrow(/packaging/);const loose=p.placements.find(b=>!b.palletIds?.length)!;loose.x=0;loose.y=0;loose.z=100;expect(()=>reviewOrderCapacityTrial(trial,p)).toThrow();
});
it("does not infer space from volume or relax a full-floor packaging footprint",()=>{
 const r=palletTailFixture();r.palletBuild!.config.length=1200;const baseline=packLoadingWorkflow(r),trials=preparePalletTailTrials(r,baseline,"row:a",4);
 expect(trials.every(t=>!improvesPalletTrial(runOrderCapacityTrial(t),baseline))).toBe(true);
});
it("round-trips adopted reservations, counts, pallet identity and gross weight",()=>{
 const r=palletTailFixture(),t=preparePalletTailTrials(r,packLoadingWorkflow(r),"row:a",8).at(-1)!,p=runOrderCapacityTrial(t),input={...t.request,strategy:p.strategy,practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:90,lengthUnit:"mm" as const,weightUnit:"kg" as const},raw=serializeWorkspaceBackup(input,ENGINE_VERSION,p),restored=restoreWorkspacePlans(raw,parseWorkspaceBackup(raw))!;
 expect(restored.placements).toEqual(p.placements);expect(restored.pallets).toEqual(p.pallets);expect(restored.metrics.grossWeight).toBe(185);expect(restored.summaries[0]).toMatchObject({requested:20,loaded:16,unloaded:4});
});
it("excludes fulfilled demand, unsupported workflows and physical pallet cargo",()=>{
 const r=palletTailFixture(),p=packLoadingWorkflow(r);expect(tailCargoGroups({...r,workflow:"direct"},p)).toEqual([]);expect(tailCargoGroups(r,null)).toEqual([]);
 expect(tailCargoGroups({...r,products:[{...r.products[0],cargoType:"pallet"}]},p)).toEqual([]);
 p.summaries[0].unloaded=0;expect(tailCargoGroups(r,p)).toEqual([]);
});
it("does not offer an oversized order even when a small preview might fit",()=>{const r=palletTailFixture(),p=packLoadingWorkflow(r);r.products[0].quantity=4001;expect(()=>preparePalletTailTrials(r,p,"row:a",2)).toThrow(/1–4000/);});

it.each(["practical","maximum"] as const)("uses the registered long-carton order without changing ratings in %s",strategy=>{
 const request=packagingCapacityFixture();request.strategy=strategy;const baseline=packLoadingWorkflow(request),trial=preparePalletTailTrials(request,baseline,"row:long",8).at(-1)!,result=runOrderCapacityTrial(trial);
 expect(baseline.metrics.loadedCount).toBe(92);expect(result.metrics.loadedCount).toBe(100);expect(result.metrics.grossWeight).toBe(4300);expect(result.metrics.requestedCount).toBe(596);expect(result.summaries[0].unloaded).toBe(496);expect(result.pallets).toHaveLength(4);expect(looseManifest(result)[0]).toMatchObject({reserved:8,loose:8,palletized:92});
 expect(result.palletBuild!.additionalSpecs![0].maxPallets).toBe(13);expect(result.palletBuild!.config.maxLoad).toBe(1000);
});
it("rejects poorer compact-tail candidates instead of assuming tails always help",()=>{
 const request=packagingCapacityFixture();request.palletBuild!.selection="compact";const baseline=packLoadingWorkflow(request),results=preparePalletTailTrials(request,baseline,"row:long",8).map(runOrderCapacityTrial);
 expect(baseline.metrics.loadedCount).toBe(299);expect(results.every(p=>!improvesPalletTrial(p,baseline))).toBe(true);
});
