import {expect,it} from "vitest";
import {packagingCapacityFixture} from "../../tests/packaging-capacity-fixture";
import {palletTailFixture,jointPalletTailFixture} from "../../tests/pallet-tail-fixture";
import {packLoadingWorkflow} from "./pack-loading";
import {preparePalletTailTrials,prepareJointPalletTailTrials,betterTailCandidate,tailCargoGroups} from "./pallet-tail";
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

it("checks every quantity and finds a smaller loose reservation missed by quick sampling",()=>{
 const request=palletTailFixture();request.container.height=600;request.container.doorHeight=600;
 const baseline=packLoadingWorkflow(request),quick=preparePalletTailTrials(request,baseline,"row:a",8),detailed=preparePalletTailTrials(request,baseline,"row:a",8,"detailed");
 expect(quick.map(t=>t.tailReservationChange!.units)).toEqual([1,2,4,8]);expect(detailed.map(t=>t.tailReservationChange!.units)).toEqual([1,2,3,4,5,6,7,8]);
 const ranked=(trials:typeof quick)=>trials.map(t=>({units:t.tailReservationChange!.units,plan:runOrderCapacityTrial(t)})).filter(c=>improvesPalletTrial(c.plan,baseline)).sort((a,b)=>b.plan.metrics.loadedCount-a.plan.metrics.loadedCount||a.units-b.units)[0];
 const a=ranked(quick),b=ranked(detailed);expect(a.plan.metrics.loadedCount).toBe(14);expect(a.units).toBe(8);expect(b.plan.metrics.loadedCount).toBe(14);expect(b.units).toBe(6);expect(looseManifest(b.plan)[0]).toMatchObject({reserved:6,loose:6,palletized:8,unloaded:6});
});
it("bounds a detailed scan by original whole-unit demand and rejects unknown search modes",()=>{
 const r=palletTailFixture(),p=packLoadingWorkflow(r);expect(preparePalletTailTrials(r,p,"row:a",12,"detailed")).toHaveLength(12);expect(()=>preparePalletTailTrials(r,p,"row:a",13,"detailed")).toThrow();expect(()=>preparePalletTailTrials(r,p,"row:a",8,"bad" as "quick")).toThrow(/search mode/);
});

it.each(["practical","maximum"] as const)("jointly completes both original rows with %s without adding packaging stock",strategy=>{
 const r=jointPalletTailFixture();r.strategy=strategy;const before=structuredClone(r),baseline=packLoadingWorkflow(r);expect(baseline.metrics.loadedCount).toBe(16);expect(baseline.summaries.map(s=>s.loaded)).toEqual([8,8]);
 const singles=["row:a","row:b"].map(id=>preparePalletTailTrials(r,baseline,id,4,"detailed").map(runOrderCapacityTrial));expect(singles.map(rows=>Math.max(...rows.map(p=>p.metrics.loadedCount)))).toEqual([20,20]);
 const trials=prepareJointPalletTailTrials(r,baseline,[{groupId:"row:a",limit:4},{groupId:"row:b",limit:4}]);expect(trials).toHaveLength(24);
 let best:Parameters<typeof betterTailCandidate>[2];for(const trial of trials){const plan=runOrderCapacityTrial(trial);expect(plan.validation.valid).toBe(true);if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};}
 expect(best!.plan.metrics.loadedCount).toBe(24);expect(best!.plan.metrics.grossWeight).toBe(290);expect(best!.plan.pallets).toHaveLength(2);expect(best!.trial.request.palletBuild!.looseQuantities).toEqual({a:4,b:4});expect(best!.plan.summaries.map(s=>s.unloaded)).toEqual([0,0]);expect(r).toEqual(before);
 const expected=structuredClone(r);expected.palletBuild!.looseQuantities={a:4,b:4};expected.singleCartonLimit=undefined;expect(best!.trial.request).toEqual(expected);
});
it("includes both one-sided allocations, omits both-zero and never duplicates a joint allocation",()=>{
 const r=jointPalletTailFixture(),p=packLoadingWorkflow(r),trials=prepareJointPalletTailTrials(r,p,[{groupId:"row:a",limit:2},{groupId:"row:b",limit:3}]),keys=trials.map(t=>JSON.stringify(t.tailReservationChange!.groups!.map(g=>g.units)));
 expect(trials).toHaveLength(11);expect(new Set(keys).size).toBe(11);expect(keys).toContain("[0,3]");expect(keys).toContain("[2,0]");expect(keys).not.toContain("[0,0]");
});
it("requires a complete grid within 64 combinations and never silently truncates it",()=>{
 const r=jointPalletTailFixture();r.products.forEach(p=>p.quantity=100);const baseline=packLoadingWorkflow(r);
 expect(()=>prepareJointPalletTailTrials(r,baseline,[{groupId:"row:a",limit:8},{groupId:"row:b",limit:8}])).toThrow(/exceeds 64/);
 expect(prepareJointPalletTailTrials(r,baseline,[{groupId:"row:a",limit:7},{groupId:"row:b",limit:7}])).toHaveLength(63);
});
it("treats the 64-carton ceiling as shared across both complete kits",()=>{
 const r=jointPalletTailFixture();r.products.forEach((p,i)=>Object.assign(p,{length:100,width:100,height:100,weight:1,quantity:120,setCode:i?"KB":"KA",unitsPerSet:40}));r.palletBuild!.config.maxLoad=40;r.palletBuild!.additionalSpecs![0].config.maxLoad=40;
 const p=packLoadingWorkflow(r),trials=prepareJointPalletTailTrials(r,p,[{groupId:"kit:KA",limit:1},{groupId:"kit:KB",limit:1}]);expect(trials).toHaveLength(2);expect(trials.map(t=>Object.values(t.request.palletBuild!.looseQuantities!).reduce((a,b)=>a+b,0))).toEqual([40,40]);expect(trials.every(t=>runOrderCapacityTrial(t).validation.valid)).toBe(true);
});
it("keeps 1:2 kit components together while comparing a second independent carton row",()=>{
 const r=palletTailFixture();r.container.length=2000;r.products[0]={...r.products[0],length:200,width:200,height:100,quantity:10,setCode:"KIT",unitsPerSet:1};r.products.push({...r.products[0],id:"b",sku:"B",quantity:20,unitsPerSet:2},{...r.products[0],id:"c",sku:"C",quantity:10,setCode:"",unitsPerSet:1});r.palletBuild!.config.maxLoad=30;r.palletBuild!.maxPallets=2;
 const p=packLoadingWorkflow(r),trials=prepareJointPalletTailTrials(r,p,[{groupId:"kit:KIT",limit:2},{groupId:"row:c",limit:2}]);for(const t of trials){const q=t.request.palletBuild!.looseQuantities!;expect(q.b??0).toBe((q.a??0)*2);const plan=runOrderCapacityTrial(t);expect(plan.validation.valid).toBe(true);expect(plan.summaries.find(s=>s.productId==="b")!.loaded).toBe(plan.summaries.find(s=>s.productId==="a")!.loaded*2);}
});
it("keeps existing loose reservations as a floor in every joint candidate",()=>{
 const r=jointPalletTailFixture();r.palletBuild!.looseQuantities={a:1,b:1};const p=packLoadingWorkflow(r),trials=prepareJointPalletTailTrials(r,p,[{groupId:"row:a",limit:2},{groupId:"row:b",limit:2}]);expect(trials.every(t=>t.request.palletBuild!.looseQuantities!.a>=1&&t.request.palletBuild!.looseQuantities!.b>=1)).toBe(true);
});
it.each([{selections:[]},{selections:[{groupId:"row:a",limit:1}]},{selections:[{groupId:"row:a",limit:1},{groupId:"row:a",limit:2}]},{selections:[{groupId:"missing",limit:1},{groupId:"row:b",limit:1}]}])("rejects incomplete, duplicated or unknown joint groups: $selections",({selections})=>{const r=jointPalletTailFixture();expect(()=>prepareJointPalletTailTrials(r,packLoadingWorkflow(r),selections)).toThrow();});
it("compares tied totals by actual reserved cartons, even when results arrive in reverse order",()=>{
 const r=palletTailFixture();r.container.height=600;r.container.doorHeight=600;const baseline=packLoadingWorkflow(r),trials=preparePalletTailTrials(r,baseline,"row:a",8,"detailed"),six={trial:trials[5],plan:runOrderCapacityTrial(trials[5])},eight={trial:trials[7],plan:runOrderCapacityTrial(trials[7])};
 expect(betterTailCandidate(six,baseline,eight)).toBe(true);expect(betterTailCandidate(eight,baseline,six)).toBe(false);const invalid=structuredClone(six);invalid.plan.validation.valid=false;expect(betterTailCandidate(invalid,baseline)).toBe(false);
});
it("restores a joint allocation using the existing workspace format without dropping unmet stock",()=>{
 const r=jointPalletTailFixture(),baseline=packLoadingWorkflow(r),trial=prepareJointPalletTailTrials(r,baseline,[{groupId:"row:a",limit:4},{groupId:"row:b",limit:4}]).find(t=>t.request.palletBuild!.looseQuantities?.a===4&&t.request.palletBuild!.looseQuantities?.b===4)!,plan=runOrderCapacityTrial(trial),input={...trial.request,strategy:plan.strategy,practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:90,lengthUnit:"mm" as const,weightUnit:"kg" as const},raw=serializeWorkspaceBackup(input,ENGINE_VERSION,plan),restored=restoreWorkspacePlans(raw,parseWorkspaceBackup(raw))!;
 expect(restored.placements).toEqual(plan.placements);expect(restored.pallets).toEqual(plan.pallets);expect(restored.palletBuild!.looseQuantities).toEqual({a:4,b:4});expect(restored.metrics.loadedCount).toBe(24);expect(restored.metrics.grossWeight).toBe(290);expect(parseWorkspaceBackup(raw).products.map(p=>p.quantity)).toEqual([12,12]);
});
it("distinguishes duplicate SKU names by stable order-row ID and reserves each row separately",()=>{
 const r=jointPalletTailFixture();r.products[1].sku=r.products[0].sku;const p=packLoadingWorkflow(r),groups=tailCargoGroups(r,p);
 expect(groups.map(g=>g.name)).toEqual(["TAIL-A [a]","TAIL-A [b]"]);const t=prepareJointPalletTailTrials(r,p,[{groupId:"row:a",limit:1},{groupId:"row:b",limit:1}]);expect(t.at(-1)!.request.palletBuild!.looseQuantities).toEqual({a:1,b:1});
});
