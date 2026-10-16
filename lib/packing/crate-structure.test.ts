import { expect, it } from "vitest";
import { CRATE_CORNERS, crateStructure, inspectCratePaths } from "./crate-structure";
import { crateEvidence, crateEvidenceKey, crateStackEvidence, emptyCrateBearing, planCrateUnits, proposeCrateColumn, reviewCrateStack } from "./crate-bearing";
import { DEFAULT_PACKAGING, packagingParts, placedPackagingParts } from "./packaging";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { packLoadingWorkflow } from "./pack-loading";
import { parseWorkspaceBackup } from "./workspace-file";
import type { FloorPalletConfig, ProductInput } from "./types";

const config:FloorPalletConfig={...DEFAULT_PALLET_BUILD.config,length:1000,width:800,height:100,weight:40,maxCargoHeight:400,packaging:{...DEFAULT_PACKAGING,base:"corner-feet",enclosure:"frame",wallThickness:40}};
const parts=()=>packagingParts(1000,800,100,config.packaging,400);
const product:ProductInput={id:"carton",sku:"C",name:"C",length:900,width:700,height:200,weight:10,quantity:6,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,color:"#338877"};
function plan(){return packLoadingWorkflow({workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:1000,width:800,height:2000,doorWidth:800,doorHeight:2000,maxWeight:10000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,config,maxPallets:3}});}

it("extracts four continuous paths from the exact physical renderer components",()=>{
  const model=crateStructure(config);expect(model.complete).toBe(true);expect(model.paths.map(p=>p.id)).toEqual([...CRATE_CORNERS]);
  for(const path of model.paths){expect(path.segments.map(s=>s.role)).toEqual(["foot","deck","post","cap"]);expect(path.bottomZ).toBe(0);expect(path.topZ).toBe(540);
    for(const segment of path.segments){expect(parts().some(b=>b.bearingRole===segment.role&&(!b.corner||b.corner===path.id)&&segment.x>=b.x&&segment.y>=b.y&&segment.x+segment.dx<=b.x+b.dx&&segment.y+segment.dy<=b.y+b.dy&&segment.z===b.z&&segment.dz===b.dz)).toBe(true);}
  }
});
it("keeps short feet, slatted frames and the physical lid in the same vertical chain",()=>{
  const c={...config,height:20,packaging:{...config.packaging!,enclosure:"slatted" as const}};const model=crateStructure(c);expect(model.complete).toBe(true);expect(model.paths[0].segments[0].dz).toBeGreaterThan(0);expect(model.paths[0].topZ).toBe(460);
});
it("rotates each tagged path with the physical clockwise model and preserves its corner identity",()=>{
  const u=planCrateUnits(plan())[0],pose={x:125,y:-300,z:600,orientation:"WLH" as const},model=crateStructure(config,pose);
  const physical=placedPackagingParts({...u.pallet,...pose,dx:800,dy:1000});expect(model.complete).toBe(true);
  for(const path of model.paths){const foot=physical.find(p=>p.bearingRole==="foot"&&p.corner===path.id)!;expect(path.bottom).toEqual({id:path.id,x:foot.x,y:foot.y,dx:foot.dx,dy:foot.dy});expect(path.bottomZ).toBe(600);expect(path.topZ).toBe(1140);}
  expect(model.paths[0].bottom).toEqual({id:"L0W0",x:125,y:660,dx:40,dy:40});
});
it.each(["foot","post","deck","cap"] as const)("rejects a missing %s instead of inventing a full support plane",role=>{
  expect(inspectCratePaths(parts().filter(p=>p.bearingRole!==role)).complete).toBe(false);
});
it("rejects duplicate feet and repeated columns with ambiguous load paths",()=>{
  for(const role of ["foot","post"]){const p=parts(),b=p.find(b=>b.bearingRole===role)!;expect(inspectCratePaths([...p,{...b}]).complete).toBe(false);}
});
it("rejects an offset column even when a wide deck would still cover it",()=>{
  const p=parts().map(b=>b.bearingRole==="post"&&b.corner==="L0W0"?{...b,x:b.x+1}:b);const report=inspectCratePaths(p);expect(report.complete).toBe(false);expect(report.paths.find(p=>p.id==="L0W0")!.continuous).toBe(false);
});
it("rejects a broken column, floating lid and a deck that cannot cover the foot",()=>{
  for(const patch of [parts().map(b=>b.bearingRole==="post"?{...b,dz:b.dz-1}:b),parts().map(b=>b.bearingRole==="cap"?{...b,z:b.z+1}:b),parts().map(b=>b.bearingRole==="deck"?{...b,dx:999}:b)])expect(inspectCratePaths(patch).complete).toBe(false);
});
it("fails closed for unsupported structures and malformed physical geometry",()=>{
  for(const c of [{...config,height:NaN},{...config,length:80},{...config,packaging:{...config.packaging!,base:"block" as const}},{...config,packaging:{...config.packaging!,lid:false}},{...config,packaging:{...config.packaging!,enclosure:"panel" as const}}])expect(crateStructure(c).complete).toBe(false);
  expect(inspectCratePaths(parts().map(b=>b.bearingRole==="post"?{...b,dz:Infinity}:b)).complete).toBe(false);
});
it("uses the lower physical cap height and unique corner identity for every contact",()=>{
  const p=plan(),units=proposeCrateColumn(planCrateUnits(p),[{x:0,y:0},{x:0,y:0}]),report=reviewCrateStack(units);expect(report.contacts).toHaveLength(8);
  for(const c of report.contacts){expect(c.covered).toBe(true);expect(c.footZ).toBe(c.zoneZ);expect(c.lowerCorner).toBe(c.foot.id);}
  expect(report.units[0].throughLoadBoundKg).toBe(180);expect(report.units[0].topLoadKg).toBe(120);expect(report.units.every(u=>u.structure.complete)).toBe(true);
});
it("binds evidence to the new geometry model and invalidates the preceding review key",()=>{
  const c=structuredClone(config);c.crateBearing={...emptyCrateBearing(),policy:"rated",reviewed:true,revision:"SYNTHETIC-TEST-ONLY",source:"Test fixture, not actual ratings",conditions:"Test only",maxTopLoadKg:500,columnCapacityKg:{L0W0:1000,L0W1:1000,L1W0:1000,L1W1:1000}};
  c.crateBearing.reviewedFor=crateEvidenceKey(c);expect(crateEvidence(c).state).toBe("ready");const previous=JSON.parse(c.crateBearing.reviewedFor);delete previous.model;c.crateBearing.reviewedFor=JSON.stringify(previous);expect(crateEvidence(c).reasons).toContain("stale");
});
it("exports complete physical-path evidence without changing the source or accepting it as a workspace",()=>{
  const p=plan(),before=JSON.stringify(p),units=proposeCrateColumn(planCrateUnits(p),[{x:0,y:0},{x:0,y:0}]),evidence=crateStackEvidence(p,units,"2026-10-16T00:00:00.000Z"),copy=JSON.parse(JSON.stringify(evidence));
  expect(copy.version).toBe(2);expect(copy.geometryModel).toBe("four-corner-paths-v1");expect(copy.report.units[0].structure.paths[0].segments).toHaveLength(4);expect(copy.sourcePlanId).toBe(p.id);expect(()=>parseWorkspaceBackup(JSON.stringify(copy))).toThrow();expect(JSON.stringify(p)).toBe(before);
  units[0]={...units[0],cargoKg:999};expect(()=>crateStackEvidence(p,units)).toThrow(/unchanged complete/);
});
