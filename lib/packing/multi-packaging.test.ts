import { describe,expect,it } from "vitest";
import { packLoadingWorkflow } from "./pack-loading";
import { DEFAULT_PALLET_BUILD,parsePalletBuild } from "./loading-workflow";
import { restorePackingSnapshot,revisePackingResult } from "./engine";
import { auditPackingResult } from "./result-audit";
import { serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans } from "./workspace-file";
import { buildPlacementCsv,parseCsvRecords } from "./csv";
import { DEFAULT_PACKAGING } from "./packaging";
import type { PackingRequest,PalletBuildSpecification,ProductInput } from "./types";
const product:ProductInput={id:"cargo",sku:"CARGO",name:"Cargo",length:400,width:400,height:200,weight:10,quantity:10,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const config={...DEFAULT_PALLET_BUILD.config,name:"Primary",length:800,width:800,height:100,weight:20,maxLoad:1000,maxCargoHeight:200};
const second:PalletBuildSpecification={id:"small",config:{...config,name:"Small",length:400,width:400,height:50,weight:8},maxPallets:10,stackLayers:1,maxTopLoadKg:0};
const build={...DEFAULT_PALLET_BUILD,config,maxPallets:20,primaryRule:{maxPallets:1},additionalSpecs:[second]};
const request:PackingRequest={workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"vehicle",name:"Vehicle",length:3000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:2000},products:[product],palletBuild:build};

describe("Ordered mixed packaging specifications",()=>{
  it.each(["practical","maximum"] as const)("uses stock-limited large and small pallets without losing or duplicating cargo (%s)",strategy=>{
    const p=packLoadingWorkflow({...request,strategy});
    expect(p.validation.errors).toEqual([]);expect(p.placements).toHaveLength(10);expect(p.pallets).toHaveLength(7);
    expect(p.pallets!.filter(p=>p.specificationId==="primary")).toHaveLength(1);expect(p.pallets!.filter(p=>p.specificationId==="small")).toHaveLength(6);
    expect(p.palletization?.preparedBySpecification).toEqual({primary:1,small:6});expect(p.metrics.grossWeight).toBe(168);
    expect(p.metrics.loadedVolume).toBe(432000000);expect(p.metrics.effectiveVolume).toBe(432000000);expect(p.metrics.volumeUtilization).toBeCloseTo(1);
    expect(p.container.length*p.container.width*p.container.height).toBeGreaterThan(p.metrics.effectiveVolume);
    expect(auditPackingResult(p,[product]).hasErrors).toBe(false);
  });
  it("loads heterogeneous intact units into a vehicle with vehicle-based utilization",()=>{
    const p=packLoadingWorkflow({...request,workflow:"palletized"});expect(p.validation.valid).toBe(true);expect(p.placements).toHaveLength(10);
    expect(p.pallets).toHaveLength(7);expect(p.metrics.effectiveVolume).toBe(3000000000);expect(auditPackingResult(p,[product]).hasErrors).toBe(false);
    for(const b of p.placements)expect(b.palletIds).toHaveLength(1);
  });
  it("retains unmet demand when one inventory or the total unit limit is exhausted",()=>{
    const stock=packLoadingWorkflow({...request,palletBuild:{...build,additionalSpecs:[{...second,maxPallets:1}]}});
    expect(stock.placements).toHaveLength(5);expect(stock.summaries[0].unloaded).toBe(5);expect(stock.metrics.requestedCount).toBe(10);
    const bounded=packLoadingWorkflow({...request,palletBuild:{...build,maxPallets:2}});expect(bounded.palletization?.bounded).toBe(true);expect(bounded.placements).toHaveLength(5);expect(bounded.summaries[0].unloaded).toBe(5);
  });
  it("supports independent SKU selections even when mixed pallets are enabled",()=>{
    const a={...product,quantity:4},b={...product,id:"b",sku:"B",length:300,width:300,weight:5,quantity:2},products=[a,b];
    const p=packLoadingWorkflow({...request,products,palletBuild:{...build,mix:"mixed",primaryRule:{maxPallets:1,productIds:[a.id]},additionalSpecs:[{...second,config:{...second.config,length:600,width:600},productIds:[b.id]}]}});
    expect(p.placements).toHaveLength(6);for(const pallet of p.pallets!){const cargo=p.placements.filter(b=>b.palletIds?.includes(pallet.id));expect(cargo.every(b=>b.productId===(pallet.specificationId==="primary"?a.id:"b"))).toBe(true);}
    expect(auditPackingResult(p,products).hasErrors).toBe(false);
  });
  it("never manufactures a complete kit from separately eligible component subsets",()=>{
    const a={...product,quantity:2,setCode:"KIT",unitsPerSet:1},b={...a,id:"b",sku:"B"},products=[a,b];
    const partial={...build,primaryRule:{maxPallets:1,productIds:[a.id]},additionalSpecs:[{...second,config,productIds:[b.id]}]};
    expect(()=>packLoadingWorkflow({...request,products,palletBuild:partial})).toThrow();
    const p=packLoadingWorkflow({...request,products,palletBuild:{...partial,additionalSpecs:[{...second,config,productIds:[a.id,b.id]}]}});
    expect(p.setSummaries[0].loadedSets).toBe(2);expect(p.placements).toHaveLength(4);expect(p.pallets!.every(p=>p.specificationId==="small")).toBe(true);
    expect(auditPackingResult(p,products).hasErrors).toBe(false);
  });
  it("skips unavailable specifications and falls back when the first one cannot pass the door",()=>{
    const only=packLoadingWorkflow({...request,palletBuild:{...build,config:{...config,maxCargoHeight:0},primaryRule:{maxPallets:0}}});expect(only.placements).toHaveLength(10);expect(only.pallets!.every(p=>p.specificationId==="small")).toBe(true);
    const p=packLoadingWorkflow({...request,workflow:"palletized",palletBuild:{...build,config:{...config,width:1200}},container:{...request.container,width:600,doorWidth:600}});
    expect(p.placements).toHaveLength(7);expect(p.summaries[0].unloaded).toBe(3);expect(p.pallets!.every(p=>p.specificationId==="small")).toBe(true);
    const spacious=packLoadingWorkflow({...request,workflow:"palletized",palletBuild:{...build,config:{...config,width:1200}},container:{...request.container,length:5000,width:600,doorWidth:600}});expect(spacious.placements).toHaveLength(10);
  });
  it("keeps crate walls, lid, full tare and interior height specific to their own units",()=>{
    const crate={...second,config:{...second.config,length:500,width:500,weight:30,packaging:{...DEFAULT_PACKAGING,enclosure:"panel" as const,wallThickness:50}}};
    const p=packLoadingWorkflow({...request,palletBuild:{...build,additionalSpecs:[crate]}});
    expect(p.metrics.grossWeight).toBe(300);expect(p.pallets!.filter(p=>p.specificationId==="small").every(p=>p.enclosureHeight===300)).toBe(true);
    expect(auditPackingResult(p,[product]).hasErrors).toBe(false);
    const bad=structuredClone(p);const pallet=bad.pallets!.find(p=>p.specificationId==="small")!,box=bad.placements.find(b=>b.palletIds?.includes(pallet.id))!;box.x=pallet.x;
    expect(()=>restorePackingSnapshot({...request,palletBuild:bad.palletBuild},bad)).toThrow();
  });
  it("defaults added specifications to nonstacking and checks each complete unit's declared rules",()=>{
    const products=[{...product,quantity:8}],container={...request.container,length:800,width:800,height:900,doorWidth:800,doorHeight:900};
    const options={...build,stackLayers:2,maxTopLoadKg:1000,additionalSpecs:[{...second,config,maxPallets:1}]};
    const one=packLoadingWorkflow({...request,workflow:"palletized",products,container,palletBuild:options});expect(one.pallets).toHaveLength(1);
    const p=packLoadingWorkflow({...request,workflow:"palletized",products,container,palletBuild:{...options,additionalSpecs:[{...second,config,maxPallets:1,stackLayers:2,maxTopLoadKg:1000}]}});
    expect(p.pallets).toHaveLength(2);expect(p.pallets!.map(p=>p.z).sort((a,b)=>a-b)).toEqual([0,300]);expect(p.placements).toHaveLength(8);expect(auditPackingResult(p,products).hasErrors).toBe(false);
  });
  it("never puts an uncertified crate on top of another specification",()=>{
    const crate={...second,config:{...second.config,length:500,width:500,packaging:{...DEFAULT_PACKAGING,enclosure:"panel" as const,wallThickness:50}},stackLayers:3,maxTopLoadKg:1000};
    const p=packLoadingWorkflow({...request,workflow:"palletized",products:[{...product,quantity:5}],container:{...request.container,length:800,width:800,height:1000,doorWidth:800},palletBuild:{...build,stackLayers:3,maxTopLoadKg:1000,additionalSpecs:[crate]}});
    expect(p.validation.valid).toBe(true);expect(p.pallets).toHaveLength(1);expect(p.pallets!.every(p=>p.z===0)).toBe(true);
  });
  it("restores both strategies with exact specifications, coordinates, mass and per-unit capacity",()=>{
    const maximum=packLoadingWorkflow(request),practical=packLoadingWorkflow({...request,strategy:"practical"});
    const inputs={...request,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:95,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
    const file=serializeWorkspaceBackup(inputs,"0.28.0",maximum,{maximum,practical}),parsed=parseWorkspaceBackup(file),p=restoreWorkspacePlans(file,parsed)!;
    expect(parsed.palletBuild).toEqual(parsePalletBuild(build));
    for(const strategy of ["practical","maximum"] as const){const restored=p.strategyPlans![strategy]!,original=({maximum,practical})[strategy];expect(restored.pallets).toEqual(original.pallets);expect(restored.placements).toEqual(original.placements);expect(restored.metrics).toEqual({...original.metrics,solveTimeMs:0});expect(auditPackingResult(restored,parsed.products).hasErrors).toBe(false);}
  });
  it("rejects forged specification IDs, inventory counts, SKU permissions and altered source recipes",()=>{
    const p=packLoadingWorkflow(request);
    const unknown=structuredClone(p);unknown.pallets![0].specificationId="unknown";expect(()=>restorePackingSnapshot(request,unknown)).toThrow();
    const counts=structuredClone(p);counts.palletization!.preparedBySpecification!.primary=2;expect(()=>restorePackingSnapshot(request,counts)).toThrow();
    const recipe=structuredClone(p);recipe.palletization!.specifications![1].config.weight++;expect(()=>restorePackingSnapshot(request,recipe)).toThrow();
    const removed=structuredClone(p);removed.palletization!.specifications=undefined;expect(()=>restorePackingSnapshot(request,removed)).toThrow();
    const forged=p.pallets!.map((p,i)=>i?{...p}:({...p,specificationId:"small"}));expect(()=>revisePackingResult(p,p.placements,[product],forged)).toThrow();
  });
  it("exports aligned columns linking every carton and pallet to its packaging specification",()=>{
    const p=packLoadingWorkflow(request),rows=parseCsvRecords(buildPlacementCsv(p)),header=rows[0];expect(header).toHaveLength(36);expect(rows.every(r=>r.length===header.length)).toBe(true);
    expect(new Set(rows.slice(1).map(r=>r[34]))).toEqual(new Set(["primary","small"]));expect(rows.slice(1).every(r=>r[35]==="Primary"||r[35]==="Small")).toBe(true);
  });
  it("validates bounded inventories, unique IDs and explicit nonempty SKU selections",()=>{
    expect(()=>parsePalletBuild({...build,primaryRule:{maxPallets:-1}})).toThrow();expect(()=>parsePalletBuild({...build,additionalSpecs:[second,second]})).toThrow();
    expect(()=>parsePalletBuild({...build,additionalSpecs:[{...second,id:"primary"}]})).toThrow();expect(()=>parsePalletBuild({...build,primaryRule:{maxPallets:1,productIds:[]}})).toThrow();
    expect(()=>packLoadingWorkflow({...request,palletBuild:{...build,primaryRule:{maxPallets:1,productIds:["unknown"]}}})).toThrow(/unknown SKU/);
  });
});
