import { CONTAINER_PRESETS } from "./presets";
import { describe, expect, it } from "vitest";
import { pack, restorePackingSnapshot, revisePackingResult, improvePacking, validatePacking } from "./engine";
import { arrangeFloorPallets, palletParts, parseFloorPalletConfig, palletSpaceSummary } from "./floor-pallets";
import { buildPlacementCsv, parseCsvRecords } from "./csv";
import { parseWorkspaceBackup, serializeWorkspaceBackup, restoreWorkspacePlans, type WorkspaceInputs } from "./workspace-file";
import type { FloorPalletConfig, PackingRequest, ProductInput } from "./types";

const floor:FloorPalletConfig={presetId:"eur",name:"EUR 1",length:1200,width:800,height:144,weight:25,maxLoad:1500,count:1,gap:0,layout:"long",allowFloorCargo:false};
const box:ProductInput={id:"cargo-a",sku:"CARGO-A",name:"Cargo",length:600,width:400,height:500,weight:20,quantity:20,priority:100,rotationPolicy:"upright",stackable:true,maxStackLayers:0,color:"#2f7f89"};
const request: PackingRequest={mode:"mixed",strategy:"maximum",clearance:0,container:{id:"test",name:"Test",length:2400,width:1600,height:1200,doorWidth:1600,doorHeight:1200,maxWeight:3000},products:[box],floorPallets:floor};
describe("Physical floor pallets",()=>{
  it("uses real support height and tare without inflating carton count or layer limit",()=>{
    const result=pack(request);
    expect(result.validation.errors).toEqual([]);expect(result.metrics.loadedCount).toBe(8);
    expect(result.placements.filter(b=>b.layer===1).every(b=>b.z===144)).toBe(true);
    expect(result.placements.every(b=>b.palletIds?.[0]===result.pallets![0].id)).toBe(true);
    expect(result.metrics.grossWeight).toBe(185);
    expect(result.metrics.loadedVolume).toBe(8*600*400*500+1200*800*144);
    expect(pack({...request,products:[{...box,maxStackLayers:1}]}).metrics.loadedCount).toBe(4);
  });
  it("limits cargo by both pallet load and vehicle payload including tare",()=>{
    expect(pack({...request,floorPallets:{...floor,maxLoad:60}}).metrics.loadedCount).toBe(3);
    expect(pack({...request,container:{...request.container,maxWeight:65}}).metrics.loadedCount).toBe(2);
    expect(()=>pack({...request,container:{...request.container,maxWeight:20}})).toThrow("自重");
  });
  it("supports floor-only goods at deck level and optional loose floor cargo",()=>{
    const bottom=pack({...request,products:[{...box,bottomOnly:true}]});expect(bottom.validation.valid).toBe(true);expect(bottom.metrics.loadedCount).toBe(4);expect(bottom.placements.every(b=>b.z===144)).toBe(true);
    const loose=pack({...request,floorPallets:{...floor,allowFloorCargo:true}});expect(loose.metrics.loadedCount).toBeGreaterThan(8);expect(loose.placements.some(b=>b.z===0&&!b.palletIds)).toBe(true);
  });
  it("keeps full kits and single-product planning caps",()=>{
    const products=[{...box,setCode:"KIT",quantity:10,unitsPerSet:1},{...box,id:"cargo-b",sku:"CARGO-B",setCode:"KIT",quantity:10,unitsPerSet:1}];
    const result=pack({...request,products});expect(result.validation.errors).toEqual([]);expect(result.setSummaries[0].loadedSets).toBe(4);
    const single=pack({...request,mode:"single",products,singleCartonLimit:6});expect(single.validation.errors).toEqual([]);expect(single.metrics.loadedCount).toBe(6);
  });
  it("restores exact physical coordinates and rejects altered supports or colliding cargo",()=>{
    const result=pack(request),snapshot={strategy:result.strategy,placements:result.placements,pallets:result.pallets};
    const restored=restorePackingSnapshot(request,snapshot);expect(restored.metrics.grossWeight).toBe(result.metrics.grossWeight);expect(restored.placements).toEqual(result.placements);
    expect(()=>restorePackingSnapshot(request,{...snapshot,pallets:result.pallets!.map(p=>({...p,dz:145}))})).toThrow("托盘");
    expect(()=>restorePackingSnapshot(request,{...snapshot,placements:result.placements.map((b,i)=>i?b:{...b,z:0})})).toThrow("校验");
    expect(validatePacking(result.placements,request.container,0,request.products,"maximum","mixed").valid).toBe(false);
  });
  it("retains locked cargo and pallet support through manual edits and continued optimization",()=>{
    const result=pack(request),locked=revisePackingResult(result,result.placements.map((b,i)=>({...b,locked:i===0})),request.products);
    const optimized=improvePacking(locked,request.products,1);expect(optimized.validation.errors).toEqual([]);expect(optimized.placements.find(b=>b.id===locked.placements[0].id)).toEqual(locked.placements[0]);expect(optimized.pallets).toEqual(result.pallets);
    expect(()=>revisePackingResult(result,result.placements.map((b,i)=>i?b:{...b,z:0}),request.products)).toThrow();
  });
  it("exports explicit pallet records and elevated cargo coordinates, including archive round trips",()=>{
    const result=pack(request),rows=parseCsvRecords(buildPlacementCsv(result));expect(rows[1][15]).toBe("pallet");expect(rows[1][12]).toBe("LWH");expect(rows[2][8]).toBe("144");expect(rows[2][16]).toBe(result.pallets![0].id);
    const inputs:WorkspaceInputs={...request,strategy:"maximum",customContainers:[],targetVolumePercent:90,targetWeightPercent:90,practicalTargetPercent:85,lengthUnit:"mm",weightUnit:"kg"};
    const archive=serializeWorkspaceBackup(inputs,"test",result);expect(parseWorkspaceBackup(archive).floorPallets).toEqual(floor);expect(restoreWorkspacePlans(archive,inputs)?.placements).toEqual(result.placements);
  });
  it("arranges nonoverlapping upright pallets and respects fixed counts and door widths",()=>{
    const pallets=arrangeFloorPallets(request.container,0,{...floor,count:0,layout:"auto"});expect(pallets.length).toBe(4);
    for(const a of pallets){expect(a.x+a.dx).toBeLessThanOrEqual(2400);expect(a.y+a.dy).toBeLessThanOrEqual(1600);for(const b of pallets){if(a.id===b.id)continue;expect(a.x+a.dx<=b.x||b.x+b.dx<=a.x||a.y+a.dy<=b.y||b.y+b.dy<=a.y).toBe(true);}}
    expect(()=>arrangeFloorPallets(request.container,0,{...floor,count:5})).toThrow("最多");expect(()=>arrangeFloorPallets({...request.container,doorWidth:700},0,floor)).toThrow("最多");
  });
  it("models deck, blocks and runners with two fork openings in each axis",()=>{
    const parts=palletParts(1200,800,144);expect(parts).toHaveLength(20);expect(parts.filter(p=>p.kind==="block")).toHaveLength(9);
    expect(Math.max(...parts.map(p=>p.z+p.dz))).toBe(144);expect(parts.filter(p=>p.z===0)).toHaveLength(3);expect(palletParts(1200,800,25)).toHaveLength(1);
  });
  it("enforces deck-relative height and loaded-pallet door clearance in both solvers",()=>{
    for(const strategy of ["practical","maximum"] as const){
      const limited=pack({...request,strategy,practicalTargetUtilization:.95,floorPallets:{...floor,maxCargoHeight:600}});
      expect(limited.validation.errors).toEqual([]);expect(limited.metrics.loadedCount).toBe(4);
      expect(limited.placements.every(b=>b.z+b.dz<=744)).toBe(true);
      const door=pack({...request,strategy,container:{...request.container,doorHeight:900}});
      expect(door.metrics.loadedCount).toBe(4);expect(door.placements.every(b=>b.z+b.dz<=900)).toBe(true);
    }
  });
  it("independently rejects stored/manual coordinates above a changed pallet height limit",()=>{
    const result=pack(request),limited={...request,floorPallets:{...floor,maxCargoHeight:600}};
    const validation=validatePacking(result.placements,request.container,0,request.products,"maximum","mixed",result.pallets,limited.floorPallets);
    expect(validation.valid).toBe(false);expect(validation.errors.some(e=>e.includes("限高"))).toBe(true);
    expect(()=>restorePackingSnapshot(limited,result)).toThrow();
    expect(()=>revisePackingResult({...result,floorPallets:limited.floorPallets},result.placements,request.products)).toThrow();
  });
  it("does not apply pallet cargo height limits to unlinked loose cargo",()=>{
    const result=pack({...request,floorPallets:{...floor,maxCargoHeight:500,allowFloorCargo:true}});
    expect(result.validation.errors).toEqual([]);
    expect(result.placements.some(b=>!b.palletIds&&b.z+b.dz>644)).toBe(true);
    expect(result.placements.filter(b=>b.palletIds).every(b=>b.z+b.dz<=644)).toBe(true);
  });
  it("deducts physical pallet envelopes and tare exactly once, and none when absent",()=>{
    const result=pack(request),goods=result.summaries.reduce((n,s)=>n+s.loadedVolume,0);
    const summary=palletSpaceSummary(request.container,0,result.pallets!,goods,result.summaries.reduce((n,s)=>n+s.loadedWeight,0));
    expect(summary.effectiveVolume-summary.reservedVolume-goods).toBe(summary.remainingVolume);
    expect(summary.remainingVolume).toBe(result.metrics.effectiveVolume-result.metrics.loadedVolume);
    expect(summary.remainingWeight).toBe(request.container.maxWeight-result.metrics.grossWeight);
    const noPallet=palletSpaceSummary(request.container,0,[],goods,160);
    expect(noPallet.reservedVolume).toBe(0);expect(noPallet.tareWeight).toBe(0);expect(noPallet.cargoCapacity).toBe(noPallet.effectiveVolume);
  });
  it("rejects invalid height inputs and forged internal support flags",()=>{
    for(const maxCargoHeight of [-1,Infinity,NaN,"1800",100001])expect(()=>parseFloorPalletConfig({...floor,maxCargoHeight})).toThrow();
    expect(parseFloorPalletConfig({...floor,maxCargoHeight:0}).maxCargoHeight).toBe(0);
    const result=pack(request);
    expect(validatePacking(result.placements.map(b=>({...b,supportOnly:true})),request.container,0,request.products,"maximum","mixed",result.pallets,floor).valid).toBe(false);
  });
  it("fits preview boards within exact dimensions for every supported base shape",()=>{
    for(const [l,w,h] of [[1200,800,144],[1200,1000,144],[800,600,100],[1100,1100,180],[3175,2438,25]]){
      const parts=palletParts(l,w,h);
      expect(Math.max(...parts.map(p=>p.x+p.dx))).toBeCloseTo(l);
      expect(Math.max(...parts.map(p=>p.y+p.dy))).toBeCloseTo(w);
      expect(Math.max(...parts.map(p=>p.z+p.dz))).toBeCloseTo(h);
      expect(parts.every(p=>p.x>=0&&p.y>=0&&p.z>=0&&p.dx>0&&p.dy>0&&p.dz>0)).toBe(true);
    }
  });

  it("uses the actual different GP/HQ deck clearance without an artificial layer cap",()=>{
    const product={...box,height:290,maxStackLayers:0,quantity:100};
    const gp=pack({...request,strategy:"practical",clearance:10,products:[product],container:CONTAINER_PRESETS.find(c=>c.id==="40gp")!});
    const hq=pack({...request,strategy:"practical",clearance:10,products:[product],container:CONTAINER_PRESETS.find(c=>c.id==="40hq")!});
    expect(gp.validation.errors).toEqual([]);expect(hq.validation.errors).toEqual([]);
    expect(gp.metrics.loadedCount).toBe(28);expect(hq.metrics.loadedCount).toBe(32);
  });

});
