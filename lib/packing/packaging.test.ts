import { describe,expect,it } from "vitest";
import { DEFAULT_PACKAGING,packagingParts,placedPackagingParts,packagingReservations,packagingReservedVolume,packagingMassCenter,parsePackaging } from "./packaging";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { packLoadingWorkflow } from "./pack-loading";
import { restorePackingSnapshot } from "./engine";
import { isolatePalletPlan } from "./pallet-inspection";
import { analyzeEmptySpaces } from "./free-space";
import { parseFloorPalletConfig } from "./floor-pallets";
import { buildPlacementCsv,parseCsvRecords } from "./csv";
import { parseWorkspaceBackup,restoreWorkspacePlans,serializeWorkspaceBackup } from "./workspace-file";
import type { PackingRequest,ProductInput } from "./types";
const product:ProductInput={id:"c",sku:"C",name:"Carton",length:450,width:350,height:200,weight:10,quantity:9,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,color:"#4488aa"};
const config={...DEFAULT_PALLET_BUILD.config,length:1000,width:800,height:100,weight:40,maxLoad:500,maxCargoHeight:400,packaging:{...DEFAULT_PACKAGING,enclosure:"panel" as const,wallThickness:50}};
const build={...DEFAULT_PALLET_BUILD,config};
const request:PackingRequest={mode:"mixed",strategy:"maximum",workflow:"palletized",palletBuild:build,products:[product],clearance:0,container:{id:"vehicle",name:"Vehicle",length:3000,width:1000,height:1000,doorWidth:1000,doorHeight:800,maxWeight:2000}};
describe("Custom complete packaging",()=>{
  it("reserves wall margins and a fixed lid even on a partly filled last crate",()=>{
    const plan=packLoadingWorkflow({...request,workflow:"pallet-only"});
    expect(plan.validation.errors).toEqual([]);expect(plan.placements).toHaveLength(9);expect(plan.pallets).toHaveLength(2);
    expect(plan.pallets!.every(p=>p.enclosureHeight===550)).toBe(true);
    for(const p of plan.pallets!){const cargo=plan.placements.filter(b=>b.palletIds?.includes(p.id));expect(cargo.every(b=>b.x>=p.x+50&&b.y>=p.y+50&&b.x+b.dx<=p.x+p.dx-50&&b.y+b.dy<=p.y+p.dy-50&&b.z+b.dz<=p.z+500)).toBe(true);}
    expect(plan.metrics.grossWeight).toBe(170);
    expect(plan.metrics.envelopeUtilization).toBeCloseTo(1);
    expect(plan.metrics.volumeUtilization).toBeLessThan(plan.metrics.envelopeUtilization!);
    expect(plan.metrics.loadedVolume).toBe(9*450*350*200+2*(1000*800*550-900*700*400));
    expect(plan.metrics.effectiveVolume).toBe(2*1000*800*550);
  });
  it("rotates a complete enclosure without changing its interior margins",()=>{
    const plan=packLoadingWorkflow({...request,palletBuild:{...build,config:{...config,layout:"cross"}},container:{...request.container,length:800,width:2000}});
    expect(plan.pallets!.length).toBeGreaterThan(0);expect(plan.pallets!.every(p=>p.orientation==="WLH")).toBe(true);
    for(const p of plan.pallets!)for(const b of placedPackagingParts(p)){expect(b.x).toBeGreaterThanOrEqual(p.x-.0001);expect(b.y).toBeGreaterThanOrEqual(p.y-.0001);expect(b.x+b.dx).toBeLessThanOrEqual(p.x+p.dx+.0001);expect(b.y+b.dy).toBeLessThanOrEqual(p.y+p.dy+.0001);}
  });
  it("rejects cargo that only fits the exterior, and counts the lid at the door",()=>{
    expect(()=>packLoadingWorkflow({...request,products:[{...product,length:980,width:780}]})).toThrow();
    expect(()=>packLoadingWorkflow({...request,container:{...request.container,doorHeight:540}})).toThrow(/Crate/);
    expect(packLoadingWorkflow({...request,container:{...request.container,doorHeight:550}}).validation.valid).toBe(true);
    expect(packLoadingWorkflow({...request,palletBuild:{...build,config:{...config,packaging:{...config.packaging,lid:false}}},container:{...request.container,doorHeight:500}}).validation.valid).toBe(true);
  });
  it("keeps crates on the floor even when an unverified frame is given a top-load rating",()=>{
    const plan=packLoadingWorkflow({...request,palletBuild:{...build,stackLayers:3,maxTopLoadKg:1000},products:[{...product,quantity:32}],container:{...request.container,length:1000,width:800,height:2000,doorWidth:800,doorHeight:2000}});
    expect(plan.pallets).toHaveLength(1);expect(plan.pallets![0].z).toBe(0);expect(plan.summaries[0].unloaded).toBe(24);
  });
  it("restores exact packaging recipes, net contents and recalculated totals",()=>{
    const plan=packLoadingWorkflow(request);
    const inputs={...request,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:95,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
    const file=serializeWorkspaceBackup(inputs,"0.27.0",plan),parsed=parseWorkspaceBackup(file),restored=restoreWorkspacePlans(file,parsed)!;
    expect(restored.pallets).toEqual(plan.pallets);expect(restored.placements).toEqual(plan.placements);expect(restored.metrics).toEqual({...plan.metrics,solveTimeMs:0});
    expect(parsed.palletBuild?.config.packaging).toEqual(config.packaging);
  });
  it("rejects forged wall penetrations, missing shells and tampered crate heights",()=>{
    const plan=packLoadingWorkflow(request);
    expect(()=>restorePackingSnapshot(request,{...plan,pallets:plan.pallets!.map(p=>({...p,enclosureHeight:500}))})).toThrow();
    expect(()=>restorePackingSnapshot(request,{...plan,pallets:plan.pallets!.map(p=>({...p,packaging:undefined}))})).toThrow();
    expect(()=>restorePackingSnapshot(request,{...plan,placements:plan.placements.map((b,i)=>i?b:{...b,x:0})})).toThrow();
  });
  it("never exposes enclosure walls as refillable gaps",()=>{
    const plan=packLoadingWorkflow(request),spaces=analyzeEmptySpaces(plan).spaces;
    const overlap=(a:{x:number;y:number;z:number;dx:number;dy:number;dz:number},b:typeof a)=>["x","y","z"].every((axis,i)=>Math.min(a[axis as "x"]+a[["dx","dy","dz"][i] as "dx"],b[axis as "x"]+b[["dx","dy","dz"][i] as "dx"])-Math.max(a[axis as "x"],b[axis as "x"])>.0001);
    for(const p of plan.pallets!)for(const wall of packagingReservations(p))expect(spaces.some(s=>overlap(s,wall))).toBe(false);
  });
  it("isolates a complete unit at the local origin without modifying the vehicle plan",()=>{
    const plan=packLoadingWorkflow(request),original=JSON.stringify(plan),p=plan.pallets![1],isolated=isolatePalletPlan(plan,p.id);
    expect(isolated.pallets).toHaveLength(1);expect(isolated.container.height).toBe(550);expect(isolated.placements).toHaveLength(1);expect(isolated.metrics.grossWeight).toBe(50);expect(isolated.pallets![0].x).toBe(0);
    expect(isolated.summaries[0].loaded).toBe(1);expect(JSON.stringify(plan)).toBe(original);
  });
  it("exports complete packaging recipes and exterior heights with aligned CSV columns",()=>{
    const plan=packLoadingWorkflow(request),rows=parseCsvRecords(buildPlacementCsv(plan));
    expect(rows[0]).toHaveLength(34);expect(rows.every(r=>r.length===34)).toBe(true);expect(JSON.parse(rows[1][32])).toEqual(config.packaging);expect(rows[1][33]).toBe("550");
  });
  it("validates bounded recipes and unusable interiors before solving",()=>{
    expect(()=>parsePackaging({...DEFAULT_PACKAGING,deckBoards:1})).toThrow();expect(()=>parsePackaging({...DEFAULT_PACKAGING,color:"red"})).toThrow();expect(()=>parsePackaging({...DEFAULT_PACKAGING,opacity:NaN})).toThrow();
    expect(()=>parseFloorPalletConfig({...config,width:90})).toThrow();expect(()=>parseFloorPalletConfig({...config,maxCargoHeight:0})).toThrow();
  });
  it("keeps every model component inside its exterior for all structures and rotations",()=>{
    for(const base of ["block","stringer","solid"] as const)for(const enclosure of ["none","slatted","panel","frame"] as const){
      const spec={...config.packaging,base,enclosure},parts=packagingParts(1000,800,100,spec,400);
      expect(parts.length).toBeLessThan(80);expect(parts.every(b=>b.x>=0&&b.y>=0&&b.z>=0&&b.dx>0&&b.dy>0&&b.dz>0&&b.x+b.dx<=1000+.0001&&b.y+b.dy<=800+.0001&&b.z+b.dz<=550+.0001)).toBe(true);
    }
  });
  it("deducts wall reservation once and estimates tare centre from physical components",()=>{
    const p=packLoadingWorkflow(request).pallets![0],parts=packagingReservations(p);
    expect(packagingReservedVolume(p)).toBe(parts.reduce((n,b)=>n+b.dx*b.dy*b.dz,0));
    expect(packagingMassCenter(p)[2]).toBeGreaterThan(p.dz/2);expect(packagingMassCenter(p)[0]).toBeCloseTo(p.x+p.dx/2);
  });
});
