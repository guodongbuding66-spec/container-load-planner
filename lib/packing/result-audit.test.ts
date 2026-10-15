import { describe, expect, it } from "vitest";
import { auditPackingResult, type AuditCheckId } from "./result-audit";
import { defaultSolidModel } from "./solid-model";
import { MAX_VISIBLE_PLACEMENTS } from "./engine";
import { packLoadingWorkflow } from "./pack-loading";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { DEFAULT_PACKAGING } from "./packaging";
import { parseWorkspaceBackup, restoreWorkspacePlans, serializeWorkspaceBackup } from "./workspace-file";
import type { LoadingWorkflow, PackingRequest, PackingResult, ProductInput } from "./types";

const product:ProductInput={id:"cargo",sku:"CARGO",name:"Carton",length:450,width:350,height:200,weight:10,quantity:9,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const container={id:"test",name:"Test",length:3000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:2000};
const build={...DEFAULT_PALLET_BUILD,config:{...DEFAULT_PALLET_BUILD.config,length:1000,width:800,height:100,weight:40,maxLoad:500,maxCargoHeight:400}};
const request:PackingRequest={workflow:"direct",mode:"mixed",strategy:"maximum",clearance:0,container,products:[product],palletBuild:build};
const crateRequest:PackingRequest={...request,workflow:"pallet-only",palletBuild:{...build,config:{...build.config,packaging:{...DEFAULT_PACKAGING,enclosure:"panel",wallThickness:50}}}};
const state=(p:PackingResult,id:AuditCheckId,products:ProductInput[]=[product])=>auditPackingResult(p,products).checks.find(c=>c.id===id)?.state;
const clone=(p:PackingResult)=>structuredClone(p);

describe("Complete-plan data consistency",()=>{
  it.each((["direct","single-capacity","pallet-only","palletized"] as LoadingWorkflow[]).flatMap(workflow=>(["practical","maximum"] as const).map(strategy=>({workflow,strategy}))))("accepts valid $workflow / $strategy snapshots without changing their contents",({workflow,strategy})=>{
    const p=packLoadingWorkflow({...request,workflow,strategy,mode:workflow==="single-capacity"?"single":"mixed"}),before=JSON.stringify(p);
    expect(p.validation.errors).toEqual([]);
    expect(auditPackingResult(p,[product]).checks.filter(c=>c.state==="fail")).toEqual([]);
    expect(JSON.stringify(p)).toBe(before);
  });
  it("counts full and tail-crate cargo, all packaging tare and reservation exactly once",()=>{
    const p=packLoadingWorkflow(crateRequest),report=auditPackingResult(p,[product]);
    expect(p.placements).toHaveLength(9);expect(p.pallets).toHaveLength(2);expect(p.metrics.grossWeight).toBe(170);
    expect(p.metrics.loadedVolume).toBe(659500000);expect(p.metrics.effectiveVolume).toBe(880000000);
    expect(report.hasErrors).toBe(false);expect(state(p,"strength")).toBe("unverified");
    const missingTare=clone(p);missingTare.metrics.grossWeight-=40;expect(state(missingTare,"weight")).toBe("fail");
    const doubledTare=clone(p);doubledTare.metrics.grossWeight+=80;expect(state(doubledTare,"weight")).toBe("fail");
    const wrongDenominator=clone(p);wrongDenominator.metrics.effectiveVolume=container.length*container.width*container.height;expect(state(wrongDenominator,"capacity")).toBe("fail");
  });
  it("audits both saved strategies after restoring exact coordinates and recalculated totals",()=>{
    const maximum=packLoadingWorkflow(crateRequest),practical=packLoadingWorkflow({...crateRequest,strategy:"practical"});
    const inputs={...crateRequest,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:95,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
    const file=serializeWorkspaceBackup(inputs,"0.27.1",maximum,{maximum,practical}),parsed=parseWorkspaceBackup(file),restored=restoreWorkspacePlans(file,parsed)!;
    for(const key of ["maximum","practical"] as const){
      const p=restored.strategyPlans![key]!;
      expect(p.placements).toEqual(({maximum,practical})[key].placements);
      expect(auditPackingResult(p,parsed.products).hasErrors).toBe(false);
    }
  });
  it("detects duplicated tracking IDs and discrepancies in source SKU, unit weight and shape",()=>{
    const p=packLoadingWorkflow(request),duplicate=clone(p);duplicate.placements[1].id=duplicate.placements[0].id;expect(state(duplicate,"records")).toBe("fail");
    for(const patch of [{sku:"STALE"},{weight:11}]){
      const stale=clone(p);Object.assign(stale.placements[0],patch);expect(state(stale,"products")).toBe("fail");
    }
    const stale=clone(p);stale.cargoDetails![product.id]={cargoShape:"u-profile",shapeWallRatio:.2};expect(state(stale,"products")).toBe("fail");
  });
  it("detects inconsistent count, dimensions, payload, volume and utilization fields independently",()=>{
    const p=packLoadingWorkflow(request);
    const count=clone(p);count.metrics.loadedCount++;expect(state(count,"quantities")).toBe("fail");
    const demand=clone(p);demand.summaries[0].requested--;demand.summaries[0].unloaded=0;expect(state(demand,"quantities")).toBe("fail");
    const bounds=clone(p);bounds.placements[0].x=container.length;expect(state(bounds,"dimensions")).toBe("fail");
    const size=clone(p);size.placements[0].dx++;expect(state(size,"dimensions")).toBe("fail");
    const mass=clone(p);mass.summaries[0].loadedWeight++;expect(state(mass,"weight")).toBe("fail");
    const volume=clone(p);volume.metrics.loadedVolume+=1_000_000;expect(state(volume,"volume")).toBe("fail");
    const ratio=clone(p);ratio.metrics.volumeUtilization=.99;expect(state(ratio,"capacity")).toBe("fail");
  });
  it("rejects wall penetration and a missing crate shell even if the old validation flag is true",()=>{
    const p=packLoadingWorkflow(crateRequest),wall=clone(p);wall.placements[0].x=wall.pallets![0].x;expect(wall.validation.valid).toBe(true);expect(state(wall,"packaging")).toBe("fail");
    const shell=clone(p);shell.pallets![0].packaging=undefined;expect(state(shell,"packaging")).toBe("fail");
  });
  it("checks kit tracking and summaries against original per-kit component definitions",()=>{
    const a={...product,setCode:"KIT",unitsPerSet:1,quantity:2},b={...a,id:"second",sku:"SECOND",unitsPerSet:2,quantity:4},products=[a,b];
    const p=packLoadingWorkflow({...request,products});expect(auditPackingResult(p,products).hasErrors).toBe(false);
    const missing=clone(p);missing.placements[0].setCode=undefined;expect(state(missing,"kits",products)).toBe("fail");
    const number=clone(p);const same=number.placements.filter(x=>x.setNumber===1);same[1].setItemNumber=same[0].setItemNumber;expect(state(number,"kits",products)).toBe("fail");
    const summary=clone(p);summary.setSummaries[0].items[0].unitsPerSet=2;expect(state(summary,"kits",products)).toBe("fail");
    const total=clone(p);total.setSummaries[0].loadedCartons++;expect(state(total,"kits",products)).toBe("fail");
  });
  it("keeps absent and irrelevant-axis bearing data unverified without blocking otherwise consistent data",()=>{
    const missing={...product,maxTopLoadKg:undefined},p=packLoadingWorkflow({...request,products:[missing]});
    expect(auditPackingResult(p,[missing]).hasErrors).toBe(false);expect(state(p,"strength",[missing])).toBe("unverified");
    const wrongAxis={...missing,rotationPolicy:"fixed" as const,topLoadByVerticalAxis:{length:1000}},q=packLoadingWorkflow({...request,products:[wrongAxis]});
    expect(state(q,"strength",[wrongAxis])).toBe("unverified");
    expect(auditPackingResult(p).checks.find(c=>c.id==="products")?.state).toBe("unverified");
  });
  it("does not present empty coordinates as a fully accepted load plan",()=>{
    const p=packLoadingWorkflow({...request,products:[{...product,length:10000,width:10000}]});
    const report=auditPackingResult(p,[{...product,length:10000,width:10000}]);
    expect(p.placements).toHaveLength(0);expect(report.unverified).toBeGreaterThan(0);expect(report.passed).toBeLessThan(report.checks.length);
  });
  it("allows realistic floating-point summation without hiding a material mass discrepancy",()=>{
    const decimal={...product,weight:.1},p=packLoadingWorkflow({...request,products:[decimal]});
    p.metrics.grossWeight+=1e-12;expect(state(p,"weight",[decimal])).toBe("pass");
    p.metrics.grossWeight+=.01;expect(state(p,"weight",[decimal])).toBe("fail");
  });
  it("uses actual modeled volume for a frustum and retains its shape provenance",()=>{
    const solid={...product,cargoShape:"frustum" as const,solidModel:defaultSolidModel("frustum",[450,350,200]),quantity:2,stackable:false};
    const p=packLoadingWorkflow({...request,products:[solid]});
    expect(p.placements.length).toBeGreaterThan(0);expect(p.metrics.loadedVolume).toBeLessThan(p.metrics.loadedCount*450*350*200);
    expect(auditPackingResult(p,[solid]).hasErrors).toBe(false);
    const stale=clone(p);stale.cargoDetails![solid.id].solidModel=undefined;expect(state(stale,"products",[solid])).toBe("fail");
  });
  it("marks a coordinate-limited theoretical capacity as unverified rather than inventing missing boxes",()=>{
    const small={...product,length:1,width:1,height:1,weight:0,rotationPolicy:"fixed" as const};
    const p=packLoadingWorkflow({...request,workflow:"single-capacity",mode:"single",products:[small],container:{...container,length:MAX_VISIBLE_PLACEMENTS+1,width:1,height:1,doorWidth:1,doorHeight:1,maxWeight:1000}});
    expect(p.metrics.loadedCount).toBe(MAX_VISIBLE_PLACEMENTS+1);expect(p.placements).toHaveLength(MAX_VISIBLE_PLACEMENTS);
    const report=auditPackingResult(p,[small]);expect(report.hasErrors).toBe(false);expect(report.completeCoordinates).toBe(false);expect(state(p,"quantities",[small])).toBe("unverified");
  });
});
