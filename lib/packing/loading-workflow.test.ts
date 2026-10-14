import { visiblePlanPallets } from "./prebuilt-pallets";
import { describe, expect, it } from "vitest";
import { buildPlacementCsv, parseCsvRecords } from "./csv";
import { packLoadingWorkflow } from "./pack-loading";
import { restorePackingSnapshot, revisePackingResult } from "./engine";
import { DEFAULT_PALLET_BUILD, parsePalletBuild } from "./loading-workflow";
import { parseWorkspaceBackup, restoreWorkspacePlans, serializeWorkspaceBackup } from "./workspace-file";
import type { PackingRequest, ProductInput } from "./types";
const product: ProductInput = { id: "cargo", sku: "CARGO", name: "Cargo", length: 500, width: 500, height: 200, weight: 10, quantity: 12, priority: 50, rotationPolicy: "upright", stackable: true, maxStackLayers: 0, maxTopLoadKg: 100, color: "#338877" };
const build = { ...DEFAULT_PALLET_BUILD, config: { ...DEFAULT_PALLET_BUILD.config, length: 1000, width: 1000, height: 100, weight: 20, maxLoad: 500, maxCargoHeight: 200 }, stackLayers: 3, maxTopLoadKg: 200 };
const request: PackingRequest = { workflow: "palletized", palletBuild: build, mode: "mixed", strategy: "maximum", clearance: 0, container: { id: "test", name: "Test", length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 800, maxWeight: 1000 }, products: [product] };
const inputs = { workflow: request.workflow, palletBuild: build, mode: "mixed" as const, strategy: "maximum" as const, practicalTargetPercent: 95, container: request.container, clearance: 0, products: [product], customContainers: [], targetVolumePercent: 85, targetWeightPercent: 85, lengthUnit: "mm" as const, weightUnit: "kg" as const };

describe("First-class loading workflows", () => {
  it("fills practical pallet decks fully before applying the vehicle utilization target",()=>{
    const only=packLoadingWorkflow({...request,strategy:"practical",workflow:"pallet-only"});expect(only.placements).toHaveLength(12);expect(only.pallets).toHaveLength(3);expect(only.metrics.volumeUtilization).toBeCloseTo(1);
    const loaded=packLoadingWorkflow({...request,strategy:"practical",practicalTargetUtilization:.88});expect(loaded.placements).toHaveLength(8);expect(loaded.pallets!.some(p=>p.z>0)).toBe(true);expect(loaded.metrics.volumeUtilization).toBeLessThanOrEqual(.88);
  });
  it("builds three rigid layers, preserving actual decks, cargo coordinates, local carton layers and gross weight", () => {
    const plan = packLoadingWorkflow(request);
    expect(plan.validation.errors).toEqual([]);
    expect(plan.placements).toHaveLength(12);
    expect(plan.pallets!.map(p => p.z).sort((a,b)=>a-b)).toEqual([0,300,600]);
    expect(plan.placements.every(b => b.layer === 1 && b.palletIds?.length === 1)).toBe(true);
    expect(plan.metrics.grossWeight).toBe(180);
    expect(plan.metrics.loadedVolume).toBe(12*500*500*200+3*1000*1000*100);
  });
  it("loads all supporting cargo before an elevated pallet starts and synchronizes deck playback",()=>{
    const plan=packLoadingWorkflow(request);
    for(const p of plan.pallets!.filter(p=>p.z>0)){
      const lower=plan.pallets!.find(q=>q.id!==p.id&&q.z<p.z&&q.x===p.x&&q.y===p.y&&Math.max(...plan.placements.filter(b=>b.palletIds?.includes(q.id)).map(b=>b.z+b.dz))===p.z)!;
      const firstUpper=plan.placements.findIndex(b=>b.palletIds?.includes(p.id));
      expect(plan.placements.slice(firstUpper).some(b=>b.palletIds?.includes(lower.id))).toBe(false);
    }
    expect(visiblePlanPallets(plan,0)).toHaveLength(0);expect(visiblePlanPallets(plan,4)).toHaveLength(1);expect(visiblePlanPallets(plan,5)).toHaveLength(2);expect(visiblePlanPallets(plan,12)).toHaveLength(3);
  });
  it("enforces stack layers, declared unit top load, carton upper load and payload independently", () => {
    expect(packLoadingWorkflow({...request,palletBuild:{...build,stackLayers:1}}).pallets).toHaveLength(1);
    expect(packLoadingWorkflow({...request,palletBuild:{...build,maxTopLoadKg:0}}).pallets).toHaveLength(1);
    expect(packLoadingWorkflow({...request,palletBuild:{...build,maxTopLoadKg:70}}).pallets).toHaveLength(2);
    expect(packLoadingWorkflow({...request,products:[{...product,maxTopLoadKg:1}]}).pallets).toHaveLength(1);
    expect(packLoadingWorkflow({...request,palletBuild:{...build,config:{...build.config,maxLoad:80}}}).pallets).toHaveLength(1);
  });
  it("keeps uneven and incomplete pallet tops on the floor", () => {
    const p={...product,quantity:6};const plan=packLoadingWorkflow({...request,products:[p]});
    expect(plan.validation.valid).toBe(true);expect(plan.placements).toHaveLength(6);
    const lower=plan.pallets!.find(p=>p.z===0)!;expect(plan.placements.filter(b=>b.palletIds?.includes(lower.id))).toHaveLength(4);
    expect(packLoadingWorkflow({...request,products:[{...product,stackable:false}]}).pallets).toHaveLength(1);
  });
  it("builds all independent pallets without using vehicle dimensions, door or payload", () => {
    const plan=packLoadingWorkflow({...request,workflow:"pallet-only",container:{...request.container,length:1,width:1,height:1,doorWidth:1,doorHeight:1,maxWeight:1}});
    expect(plan.validation.valid).toBe(true);expect(plan.pallets).toHaveLength(3);expect(plan.pallets!.every(p=>p.z===0)).toBe(true);
    expect(plan.container.id).toBe("pallet-inspection");expect(plan.metrics.effectiveVolume).toBe(3*1000*1000*300);expect(plan.metrics.volumeUtilization).toBeCloseTo(1);
    expect(plan.workflow).toBe("pallet-only");expect(plan.summaries[0].unloaded).toBe(0);
    expect(()=>packLoadingWorkflow({...request,workflow:"pallet-only",palletBuild:{...build,config:{...build.config,maxCargoHeight:0}}})).toThrow(/限高/);
  });
  it("preserves remaining order quantities at the pallet limit and enforces single/mixed policy", () => {
    const p={...product,quantity:20},b={...p,id:"second",sku:"SECOND",quantity:3};
    const plan=packLoadingWorkflow({...request,workflow:"pallet-only",products:[p,b],palletBuild:{...build,maxPallets:2}});
    expect(plan.palletization?.bounded).toBe(true);expect(plan.summaries.reduce((n,s)=>n+s.unloaded,0)).toBe(15);
    for(const pallet of plan.pallets!)expect(new Set(plan.placements.filter(b=>b.palletIds?.includes(pallet.id)).map(b=>b.productId)).size).toBe(1);
    const mixed=packLoadingWorkflow({...request,workflow:"pallet-only",products:[{...product,quantity:1},b],palletBuild:{...build,mix:"mixed"}});
    expect(mixed.pallets).toHaveLength(1);expect(mixed.placements).toHaveLength(4);
  });
  it("restores stacked and pallet-only plans with exact physical coordinates and mode-specific metrics", () => {
    for(const workflow of ["palletized","pallet-only"] as const){
      const plan=packLoadingWorkflow({...request,workflow}), file=serializeWorkspaceBackup({...inputs,workflow},"0.26.0",plan), parsed=parseWorkspaceBackup(file),restored=restoreWorkspacePlans(file,parsed)!;
      expect(parsed.workflow).toBe(workflow);expect(parsed.palletBuild).toEqual(build);expect(restored.pallets).toEqual(plan.pallets);
      expect(restored.placements).toEqual(plan.placements);expect(restored.metrics).toEqual({...plan.metrics,solveTimeMs:0});expect(restored.workflow).toBe(workflow);
    }
  });
  it("rejects forged elevated decks, weakened stack ratings, split kits and intersecting rigid envelopes", () => {
    const plan=packLoadingWorkflow(request);
    expect(()=>restorePackingSnapshot(request,{...plan,palletization:{...plan.palletization,stackLayers:1}})).toThrow();
    expect(()=>restorePackingSnapshot(request,{...plan,palletization:{...plan.palletization,maxTopLoadKg:10}})).toThrow();
    expect(()=>revisePackingResult(plan,plan.placements,[product],plan.pallets!.map(p=>({...p,z:p.z+10})))).toThrow();
  });
  it("preserves whole kits per pallet and explains impossible cargo instead of producing an empty pallet result",()=>{
    const a={...product,quantity:6,setCode:"KIT",unitsPerSet:1},b={...a,id:"second",sku:"SECOND"};
    const plan=packLoadingWorkflow({...request,workflow:"pallet-only",products:[a,b]});expect(plan.setSummaries[0].loadedSets).toBe(6);
    for(let n=1;n<=6;n++)expect(new Set(plan.placements.filter(b=>b.setNumber===n).flatMap(b=>b.palletIds??[])).size).toBe(1);
    expect(()=>packLoadingWorkflow({...request,workflow:"pallet-only",products:[{...product,width:1100,length:1100}]})).toThrow(/托盘/);
    const blocked=packLoadingWorkflow({...request,palletBuild:{...build,config:{...build.config,layout:"cross"}},products:[{...product,allowedOrientations:["LWH"]}]});expect(blocked.placements).toHaveLength(0);expect(blocked.warnings.some(w=>w.includes("无法"))).toBe(true);
  });
  it("exports aligned pallet and cargo rows with explicit inspection or vehicle coordinate use",()=>{
    for(const workflow of ["palletized","pallet-only"] as const){const plan=packLoadingWorkflow({...request,workflow}),rows=parseCsvRecords(buildPlacementCsv(plan));expect(rows.every(r=>r.length===rows[0].length)).toBe(true);expect(rows.slice(1).every(r=>r.at(-2)===workflow&&r.at(-1)===(workflow==="pallet-only"?"pallet-inspection":"vehicle-loading"))).toBe(true);}
  });
  it("retains the direct mixed-order and single-product capacity algorithms", () => {
    const direct=packLoadingWorkflow({...request,workflow:"direct",palletBuild:undefined});expect(direct.validation.valid).toBe(true);expect(direct.pallets).toHaveLength(0);expect(direct.placements).toHaveLength(12);
    const single=packLoadingWorkflow({...request,workflow:"single-capacity",mode:"single",palletBuild:undefined});expect(single.validation.valid).toBe(true);expect(single.placements.length).toBeGreaterThan(12);
    expect(()=>parsePalletBuild({...build,maxPallets:201})).toThrow();expect(()=>parsePalletBuild({...build,stackLayers:0})).toThrow();
  });
});
