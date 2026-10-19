import {describe,it,expect} from "vitest";
import {packLoadingWorkflow} from "./pack-loading";
import {DEFAULT_PALLET_BUILD,parsePalletBuild} from "./loading-workflow";
import {restorePackingSnapshot,revisePackingResult,validatePacking} from "./engine";
import {parseLooseQuantities,looseReservationErrors,looseManifest,looseOutsideUnit} from "./loose-cargo";
import {parsePalletization,validatePalletizedCargo,visiblePlanPallets} from "./prebuilt-pallets";
import {auditPackingResult} from "./result-audit";
import {auditAccess} from "./access";
import {buildPlacementCsv,parseCsvRecords} from "./csv";
import {customerReport,offlineFieldHtml} from "./field-report";
import {parseWorkspaceBackup,restoreWorkspacePlans,serializeWorkspaceBackup} from "./workspace-file";
import type {PackingRequest,ProductInput} from "./types";

const cargo:ProductInput={id:"cargo",sku:"SHED-BOX",name:"Shed carton",length:500,width:500,height:200,weight:10,quantity:6,priority:50,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,maxStackLayers:0,maxTopLoadKg:100,color:"#337788"};
const build={...DEFAULT_PALLET_BUILD,looseQuantities:{cargo:2},config:{...DEFAULT_PALLET_BUILD.config,length:1000,width:1000,height:100,weight:20,maxCargoHeight:200},stackLayers:1};
const request:PackingRequest={mode:"mixed",workflow:"palletized",strategy:"maximum",palletBuild:build,clearance:0,container:{id:"mix",name:"Mixed QA",length:1500,width:1000,height:500,doorWidth:1000,doorHeight:500,maxWeight:1000},products:[cargo]};
const run=(patch:Partial<PackingRequest>={})=>packLoadingWorkflow({...request,...patch});

describe("Explicit complete units and loose cargo",()=>{
  it.each(["practical","maximum"] as const)("co-loads one complete unit and two reserved cartons with %s",strategy=>{
    const plan=run({strategy});expect(plan.validation.errors).toEqual([]);expect(plan.placements).toHaveLength(6);expect(plan.pallets).toHaveLength(1);expect(plan.metrics.grossWeight).toBe(80);
    expect(looseManifest(plan)).toEqual([{productId:"cargo",sku:"SHED-BOX",reserved:2,loose:2,palletized:4,unloaded:0,weightKg:20}]);expect(auditPackingResult(plan,[cargo]).hasErrors).toBe(false);
    expect(plan.placements.filter(b=>!b.palletIds?.length).every(b=>b.z===0)).toBe(true);
  });
  it("retains unmet palletized cargo at stock limits without silently dismantling it",()=>{
    const plan=run({products:[{...cargo,quantity:10}],palletBuild:{...build,maxPallets:1}});
    expect(looseManifest(plan)[0]).toMatchObject({reserved:2,loose:2,palletized:4,unloaded:4});expect(plan.palletization?.bounded).toBe(true);
  });
  it("keeps old files entirely palletized and canonicalizes explicit zero",()=>{
    expect(parsePalletBuild({...build,looseQuantities:undefined}).looseQuantities).toBeUndefined();expect(parseLooseQuantities({cargo:0})).toBeUndefined();
    const plan=run({palletBuild:{...build,looseQuantities:undefined}});expect(plan.placements.every(b=>b.palletIds?.length===1)).toBe(true);
    expect(restorePackingSnapshot({...request,palletBuild:plan.palletBuild},plan).validation.valid).toBe(true);
  });
  it.each([null,[],{cargo:-1},{cargo:1.2},{cargo:"2"},{cargo:1000001},JSON.parse('{"__proto__":1}')])("rejects malformed allocation %j",value=>{
    expect(()=>parseLooseQuantities(value)).toThrow();
  });
  it("rejects deleted SKUs, over-allocation and pallet-only reservations",()=>{
    for(const looseQuantities of [{missing:1},{cargo:7}] as Record<string,number>[])expect(()=>run({palletBuild:{...build,looseQuantities}})).toThrow(/预留/);
    expect(()=>run({workflow:"pallet-only"})).toThrow(/只打托/);expect(()=>parsePalletization({...run().palletization,only:true})).toThrow(/只打托/);
  });
  it("preserves whole kits in both modes and remaps globally unique kit numbers",()=>{
    const products=[{...cargo,id:"a",sku:"A",quantity:4,setCode:"SHED",unitsPerSet:2},{...cargo,id:"b",sku:"B",quantity:2,setCode:"SHED",unitsPerSet:1}];
    const plan=run({products,container:{...request.container,length:2000},palletBuild:{...build,looseQuantities:{a:2,b:1}}});
    expect(plan.placements).toHaveLength(6);expect(plan.setSummaries[0].loadedSets).toBe(2);expect(new Set(plan.placements.map(b=>b.setNumber)).size).toBe(2);
    for(const number of [1,2]){const members=plan.placements.filter(b=>b.setNumber===number);expect(members).toHaveLength(3);expect(new Set(members.map(b=>b.palletIds?.[0]??"loose")).size).toBe(1);}
    expect(auditPackingResult(plan,products).hasErrors).toBe(false);
    expect(looseReservationErrors({a:2},products)).not.toEqual([]);expect(looseReservationErrors({a:1,b:1},products)).not.toEqual([]);
  });
  it("never accepts half a loose kit when space is limited",()=>{
    const products=[{...cargo,id:"a",sku:"A",quantity:2,setCode:"KIT",unitsPerSet:1},{...cargo,id:"b",sku:"B",quantity:2,setCode:"KIT",unitsPerSet:1}];
    const plan=run({products,container:{...request.container,length:1250,height:300,doorHeight:300},palletBuild:{...build,looseQuantities:{a:1,b:1}}});
    const loose=plan.placements.filter(b=>!b.palletIds?.length);expect(loose.length===0||loose.length===2).toBe(true);expect(plan.validation.valid).toBe(true);
  });
  it("can load only explicitly reserved cargo if no unit can enter",()=>{
    const plan=run({container:{...request.container,doorHeight:250}});expect(plan.pallets).toHaveLength(0);expect(plan.placements).toHaveLength(2);expect(plan.metrics.grossWeight).toBe(20);expect(plan.summaries[0].unloaded).toBe(4);
  });
  it("supports the all-reserved case without inventing empty units or tare",()=>{
    const plan=run({palletBuild:{...build,looseQuantities:{cargo:6}}});expect(plan.pallets).toHaveLength(0);expect(plan.metrics.grossWeight).toBe(60);expect(plan.placements).toHaveLength(6);expect(plan.palletization?.preparedCount).toBe(0);
  });
  it("allows loose-on-loose stacking while preventing cross-mode support in either direction",()=>{
    const plan=run({products:[{...cargo,quantity:8}],container:{...request.container,height:600,doorHeight:600},palletBuild:{...build,looseQuantities:{cargo:4}}});
    const loose=plan.placements.filter(b=>!b.palletIds?.length);expect(loose).toHaveLength(4);expect(loose.some(b=>b.z>0)).toBe(true);
    const unit={...plan.placements[0],x:0,y:0,z:0,dx:1000,dy:1000,dz:300};
    expect(looseOutsideUnit({...unit,z:300,dx:500,dy:500,dz:200},unit)).toBe(false);
    expect(looseOutsideUnit({...unit,z:0,dx:500,dy:500,dz:200},{...unit,z:200})).toBe(false);
    const bad=plan.placements.map(b=>b===loose[0]?{...b,x:0,y:0,z:300}:b);
    expect(validatePalletizedCargo(bad,plan.pallets!,plan.container,0,plan.palletization!,[{...cargo,quantity:8}]).join()).toMatch(/包络/);
  });
  it("reserves the whole unit void and respects the larger protection gap",()=>{
    const unit={...run().placements[0],x:0,y:0,z:0,dx:1000,dy:1000,dz:500};
    expect(looseOutsideUnit({...unit,x:100,y:100,z:300,dx:100,dy:100,dz:100},unit)).toBe(false);
    expect(looseOutsideUnit({...unit,x:1000,dx:500,dy:500,dz:200},unit,10)).toBe(false);
    expect(looseOutsideUnit({...unit,x:1010,dx:500,dy:500,dz:200},unit,10)).toBe(true);
    const plan=run({container:{...request.container,length:1520},palletBuild:{...build,config:{...build.config,gap:20}}});expect(plan.placements.filter(b=>!b.palletIds?.length).every(b=>b.x>=1020||b.y>=1020)).toBe(true);
  });
  it("checks the shared vehicle weight and preserves unloaded quantities",()=>{
    const plan=run({container:{...request.container,maxWeight:79}});expect(plan.metrics.grossWeight).toBeLessThanOrEqual(79);expect(plan.summaries[0].unloaded).toBeGreaterThan(0);
    expect(plan.summaries[0].loaded+plan.summaries[0].unloaded).toBe(6);
  });
  it("rejects forged allocations against current inputs and undeclared loose coordinates",()=>{
    const plan=run();expect(()=>restorePackingSnapshot({...request,palletBuild:{...build,looseQuantities:undefined}},plan)).toThrow(/预留/);
    expect(()=>restorePackingSnapshot(request,{...plan,palletBuild:{...build,looseQuantities:{cargo:6}}})).toThrow(/预留/);
    expect(()=>restorePackingSnapshot(request,{...plan,palletization:{...plan.palletization,looseQuantities:{cargo:1}}})).toThrow(/预留/);
    const noPermission={...plan.palletization!,looseQuantities:undefined};expect(validatePacking(plan.placements,plan.container,0,[cargo],plan.strategy,plan.mode,plan.pallets,undefined,noPermission).valid).toBe(false);
    expect(()=>revisePackingResult({...plan,palletization:noPermission},plan.placements,[cargo])).toThrow();
  });
  it("keeps unit visibility and whole-unit playback while exposing loose paths and stops",()=>{
    const plan=run(),p=plan.pallets![0];expect(visiblePlanPallets(plan,0)).toEqual([]);expect(visiblePlanPallets(plan,6)).toHaveLength(1);
    const indices=plan.placements.map((b,i)=>b.palletIds?.includes(p.id)?i:-1).filter(n=>n>=0);expect(Math.max(...indices)-Math.min(...indices)+1).toBe(4);
    const paths=auditAccess({...plan,delivery:{cargo:{customer:"A",destination:"B",stop:1}}});expect(paths.order).toHaveLength(3);expect(paths.complete).toBe(true);expect(paths.order.filter(b=>!b.supportOnly)).toHaveLength(2);
  });
  it("round-trips shared inputs, coordinates, weight and unit membership through workspace backup",()=>{
    const plan=run(),inputs={...request,strategy:"maximum" as const,mode:"mixed" as const,practicalTargetPercent:95,customContainers:[],targetVolumePercent:85,targetWeightPercent:90,lengthUnit:"mm" as const,weightUnit:"kg" as const};
    const file=serializeWorkspaceBackup(inputs,"0.46.0",plan),parsed=parseWorkspaceBackup(file),restored=restoreWorkspacePlans(file,parsed)!;
    expect(restored.metrics.grossWeight).toBe(80);expect(restored.placements).toEqual(plan.placements);expect(restored.palletBuild?.looseQuantities).toEqual({cargo:2});
  });
  it("exports each physical record once with distinct mode and matching HTML manifests",()=>{
    const plan=run(),csv=parseCsvRecords(buildPlacementCsv(plan)),column=csv[0].indexOf("装载单元类型");expect(column).toBeGreaterThan(0);expect(csv.slice(1)).toHaveLength(7);
    expect(csv.slice(1).filter(r=>r[column]==="loose-cargo")).toHaveLength(2);expect(csv.slice(1).filter(r=>r[column]==="unit-content")).toHaveLength(4);expect(csv.slice(1).filter(r=>r[column]==="complete-unit")).toHaveLength(1);
    expect(customerReport(plan,[cargo],{language:"en",customer:"",order:"",currency:"USD",freight:null})).toContain('data-loose-manifest="1"');expect(offlineFieldHtml(plan,[cargo])).toContain('data-loose-manifest="1"');
  });
  it("keeps crate cavities and lids unavailable to loose cargo in restored plans",()=>{
    const config={...build.config,length:600,width:600,maxCargoHeight:200,packaging:{...build.config.packaging!,enclosure:"frame" as const,wallThickness:50,lid:true}};
    const spec={...build,config,looseQuantities:{cargo:1}},r={...request,palletBuild:spec,products:[{...cargo,quantity:2}],container:{...request.container,length:1100,width:600,height:600,doorWidth:600,doorHeight:600}};
    const plan=run(r);expect(plan.placements).toHaveLength(2);expect(plan.pallets).toHaveLength(1);
    const loose=plan.placements.find(b=>!b.palletIds?.length)!;
    for(const z of [100,350])expect(()=>restorePackingSnapshot(r,{...plan,placements:plan.placements.map(b=>b.id===loose.id?{...b,x:50,y:50,z}:b)})).toThrow();
  });
  it("does not confuse an original SKU identifier with a generated rigid unit",()=>{
    const p={...cargo,id:"unit-1"},plan=run({products:[p],palletBuild:{...build,looseQuantities:{"unit-1":2}}});expect(plan.placements).toHaveLength(6);expect(plan.placements.every(b=>b.productId==="unit-1")).toBe(true);expect(looseManifest(plan)[0]).toMatchObject({palletized:4,loose:2});
  });

});
