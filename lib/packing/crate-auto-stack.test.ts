import { analyzeLoads } from "./load-analysis";
import { auditPackingResult } from "./result-audit";
import { reviewPlan } from "./plan-review";
import { buildPlacementCsv,parseCsvRecords } from "./csv";
import { crateEvidenceHtml } from "./field-report";
import { newPackagingConfig } from "./pallet-specifications";
import { expect, it } from "vitest";
import { crateAutoEnabled, inspectCrateStacks, planCrateStackReview } from "./crate-auto-stack";
import { crateEvidenceKey, emptyCrateBearing, planCrateUnits } from "./crate-bearing";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { DEFAULT_PACKAGING } from "./packaging";
import { packLoadingWorkflow } from "./pack-loading";
import { restorePackingSnapshot, validatePacking } from "./engine";
import { editPalletContents, palletLocalBox, palletWorldBox } from "./pallet-edit";
import { parseWorkspaceBackup, restoreWorkspacePlans, serializeWorkspaceBackup, type WorkspaceInputs } from "./workspace-file";
import type { FloorPalletConfig, PackingRequest, PackingResult } from "./types";

function config(): FloorPalletConfig {
  const c: FloorPalletConfig = {...DEFAULT_PALLET_BUILD.config,length:1000,width:800,height:100,weight:40,maxLoad:500,maxCargoHeight:400,packaging:{...DEFAULT_PACKAGING,base:"corner-feet",enclosure:"frame",wallThickness:40,lid:true}};
  c.crateBearing={...emptyCrateBearing(),automaticStacking:true,policy:"rated",revision:"QA-SYNTHETIC",source:"SOFTWARE TEST ONLY",conditions:"Synthetic four-corner static fixture, not production evidence",allowedOrientations:["LWH","WLH"],maxTopLoadKg:500,maxLayers:3,columnCapacityKg:{L0W0:1000,L0W1:1000,L1W0:1000,L1W1:1000},reviewed:true};
  return seal(c);
}
function seal(c:FloorPalletConfig) { c.crateBearing!.reviewedFor=crateEvidenceKey(c);return c; }
function request(strategy:"practical"|"maximum"="maximum"):PackingRequest { return {workflow:"palletized",mode:"mixed",strategy,clearance:0,container:{id:"c",name:"C",length:1000,width:800,height:2000,doorWidth:800,doorHeight:2000,maxWeight:10000},products:[{id:"p",sku:"P",name:"P",length:900,width:700,height:200,weight:10,quantity:6,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:10,color:"#338877"}],palletBuild:{...DEFAULT_PALLET_BUILD,config:config(),maxPallets:3}}; }
const pack=(r=request())=>packLoadingWorkflow(r);
function moveUnit(plan:PackingResult,id:string,delta:{x?:number;y?:number;z?:number}) {for(const p of plan.pallets!)if(p.id===id){p.x+=delta.x??0;p.y+=delta.y??0;p.z+=delta.z??0;}for(const b of plan.placements)if(b.palletIds?.includes(id)){b.x+=delta.x??0;b.y+=delta.y??0;b.z+=delta.z??0;}return plan;}

for(const strategy of ["practical","maximum"] as const)it(`${strategy}: loads three complete crates and keeps carton pressure separate from structural through-load`,()=>{
  const r=request(strategy),p=pack(r);expect(p.validation.valid).toBe(true);expect(p.pallets?.map(v=>v.z)).toEqual([0,540,1080]);expect(p.metrics.loadedCount).toBe(6);expect(p.metrics.grossWeight).toBe(180);
  const report=planCrateStackReview(p);expect(report.errors).toEqual([]);expect(report.cells.map(v=>v.topLoadKg)).toEqual([120,60,0]);expect(report.cells.map(v=>v.throughLoadBoundKg)).toEqual([180,120,60]);expect(report.cells.every(v=>v.state==="passed")).toBe(true);
  expect(p.placements.map(v=>v.z)).toEqual([100,300,640,840,1180,1380]);expect(validatePacking(p.placements,p.container,p.clearance,r.products,p.strategy,p.mode,p.pallets,undefined,p.palletization).valid).toBe(true);
});
it("requires explicit opt-in, preserving old independent reviewed evidence and floor-only coordinates",()=>{
  const r=request(),c=r.palletBuild!.config;delete c.crateBearing!.automaticStacking;seal(c);expect(crateAutoEnabled(c)).toBe(false);const p=pack(r);expect(p.metrics.loadedCount).toBe(2);expect(p.pallets?.map(p=>p.z)).toEqual([0]);
});
it("starts a newly copied specification floor-only without changing the original reviewed source",()=>{
  const r=request(),source=r.palletBuild!.config,before=JSON.stringify(source),copy=newPackagingConfig(source);expect(crateAutoEnabled(source)).toBe(true);expect(copy.crateBearing?.automaticStacking).toBe(false);expect(copy.crateBearing?.reviewed).toBe(false);expect(copy.crateBearing?.reviewedFor).toBe("");expect(JSON.stringify(source)).toBe(before);r.palletBuild!.config=copy;expect(pack(r).metrics.loadedCount).toBe(2);
});
for(const scenario of ["missing","disabled","unreviewed","stale","expired","prohibited","zero","unsupported"] as const)it(`keeps ${scenario} evidence crates on the floor`,()=>{
  const r=request(),c=r.palletBuild!.config;
  if(scenario==="missing")delete c.crateBearing;
  else if(scenario==="disabled"){c.crateBearing!.automaticStacking=false;seal(c);}
  else if(scenario==="unreviewed")c.crateBearing!.reviewed=false;
  else if(scenario==="stale")c.crateBearing!.source="changed";
  else if(scenario==="expired"){c.crateBearing!.validUntil="2020-01-01";seal(c);}
  else if(scenario==="prohibited"){c.crateBearing!.policy="prohibited";seal(c);}
  else if(scenario==="zero"){c.crateBearing!.maxTopLoadKg=0;seal(c);}
  else{c.packaging!.enclosure="panel";seal(c);}
  const p=pack(r);expect(p.metrics.loadedCount).toBe(2);expect(p.pallets?.every(p=>p.z===0)).toBe(true);
});
for(const [field,limit,expected] of [["top",120,6],["top",119,4],["column",180,6],["column",179,4],["layers",2,4]] as const)it(`checks cumulative ${field} ${limit} during candidate search and continues with feasible units`,()=>{
  const r=request(),c=r.palletBuild!.config;if(field==="top")c.crateBearing!.maxTopLoadKg=limit;else if(field==="column")c.crateBearing!.columnCapacityKg.L1W1=limit;else c.crateBearing!.maxLayers=limit;seal(c);
  const p=pack(r);expect(p.metrics.loadedCount).toBe(expected);expect(p.validation.valid).toBe(true);expect(planCrateStackReview(p).errors).toEqual([]);
});
it("allows a one-layer-rated upper crate while enforcing the lower crate's cumulative tier allowance",()=>{
  const r=request(),upper=config();upper.crateBearing!.maxLayers=1;seal(upper);r.products[0].quantity=4;r.palletBuild!.maxPallets=2;r.palletBuild!.primaryRule={maxPallets:1};r.palletBuild!.additionalSpecs=[{id:"upper",config:upper,maxPallets:1,stackLayers:1,maxTopLoadKg:0}];
  const p=pack(r);expect(p.metrics.loadedCount).toBe(4);expect(p.pallets?.map(p=>p.specificationId)).toEqual(["primary","upper"]);expect(p.pallets?.map(p=>p.z)).toEqual([0,540]);
});
it("requires the actual world orientation of every crate to be covered by the rating",()=>{
  const r=request(),c=r.palletBuild!.config;c.crateBearing!.allowedOrientations=["WLH"];seal(c);expect(pack(r).metrics.loadedCount).toBe(2);
  r.products[0].rotationPolicy="upright";r.container.length=800;r.container.width=1000;r.container.doorWidth=1000;const p=pack(r);expect(p.metrics.loadedCount).toBe(6);expect(p.pallets?.every(p=>p.orientation==="WLH")).toBe(true);expect(planCrateStackReview(p).errors).toEqual([]);
});
it("never stacks independent pallet inspection units and respects whole-unit door height and total mass",()=>{
  const r=request();r.workflow="pallet-only";expect(pack(r).pallets?.every(p=>p.z===0)).toBe(true);r.workflow="palletized";r.container.height=1079;r.container.doorHeight=1079;expect(pack(r).metrics.loadedCount).toBe(2);r.container.height=2000;r.container.doorHeight=539;expect(()=>pack(r)).toThrow();r.container.doorHeight=2000;r.container.maxWeight=119;expect(pack(r).metrics.loadedCount).toBe(2);
});
it("rejects shifted, floating or re-enabled stale stacks on restore and direct unified validation",()=>{
  const r=request(),p=pack(r);for(const delta of [{x:1},{z:1}]){const bad=moveUnit(structuredClone(p),p.pallets![1].id,delta);expect(()=>restorePackingSnapshot(r,bad)).toThrow();expect(validatePacking(bad.placements,bad.container,0,r.products,bad.strategy,bad.mode,bad.pallets,undefined,bad.palletization).valid).toBe(false);}
  const stale=structuredClone(p);stale.palletization!.config.crateBearing!.automaticStacking=false;seal(stale.palletization!.config);const changed=structuredClone(r);changed.palletBuild!.config=stale.palletization!.config;expect(()=>restorePackingSnapshot(changed,stale)).toThrow();
});
it("rejects open-pallet/crate mixed vertical paths and multiple upper crates",()=>{
  const r=request();r.workflow="pallet-only";const p=pack(r),units=planCrateUnits(p),bottom=units[0],upper=units[1];upper.pallet={...upper.pallet,x:0,y:0,z:540};const envelope=(u:typeof bottom)=>({...u.pallet,dz:540,productId:u.pallet.id,sku:u.pallet.id,color:"#333333",layer:1});const env=[envelope(bottom),envelope(upper)];
  expect(inspectCrateStacks([bottom],env).errors.length).toBeGreaterThan(0);expect(inspectCrateStacks([upper],env).errors.length).toBeGreaterThan(0);
  expect(inspectCrateStacks([bottom,upper], [...env,{...env[1],id:"other",productId:"other"}]).errors.length).toBeGreaterThan(0);
});
it("revalidates lower paths after a contents edit and preserves the entire source on rejection",()=>{
  const r=request(),c=r.palletBuild!.config;c.crateBearing!.maxTopLoadKg=100;seal(c);r.products[0].quantity=4;r.products[0].maxStackLayers=1;r.palletBuild!.maxPallets=3;const p=pack(r),before=JSON.stringify(p);expect(p.metrics.loadedCount).toBe(3);
  const editable=r.products.map(v=>({...v,maxStackLayers:2}));expect(()=>editPalletContents(p,editable,p.pallets![2].id,{type:"add",productId:"p",position:{x:40,y:40,z:200}})).toThrow(/top-load/);expect(JSON.stringify(p)).toBe(before);
});
it("restores actual columns and explicit opt-in with exact positions and mass; changed sources cannot reuse the rating",()=>{
  const r=request(),p=pack(r),inputs:WorkspaceInputs={...r,strategy:"maximum",practicalTargetPercent:88,customContainers:[],targetVolumePercent:90,targetWeightPercent:90,lengthUnit:"mm",weightUnit:"kg"},file=serializeWorkspaceBackup(inputs,"0.45.0",p),restored=restoreWorkspacePlans(file,parseWorkspaceBackup(file))!;
  expect(restored.metrics.grossWeight).toBe(180);expect(JSON.parse(JSON.stringify(restored.pallets))).toEqual(JSON.parse(JSON.stringify(p.pallets)));expect(restored.placements.map(b=>[b.id,b.x,b.y,b.z])).toEqual(p.placements.map(b=>[b.id,b.x,b.y,b.z]));
  const changed=structuredClone(inputs);changed.palletBuild!.config.crateBearing!.source="different";expect(()=>restoreWorkspacePlans(file,changed)).toThrow(/evidence/);
});
it("orders complete lower crates before upper cargo with a smaller wall inset, including restore",()=>{
  const r=request(),upper=config();upper.packaging!.wallThickness=30;seal(upper);r.products[0].quantity=4;r.palletBuild!.maxPallets=2;r.palletBuild!.primaryRule={maxPallets:1};r.palletBuild!.additionalSpecs=[{id:"upper",config:upper,maxPallets:1,stackLayers:1,maxTopLoadKg:0}];
  const p=pack(r);expect(p.metrics.loadedCount).toBe(4);expect(p.placements.map(b=>b.palletIds?.[0])).toEqual(["floor-pallet-1","floor-pallet-1","floor-pallet-2","floor-pallet-2"]);expect(p.placements[2].x).toBeLessThan(p.placements[0].x);expect(restorePackingSnapshot(r,p).placements.map(b=>b.id)).toEqual(p.placements.map(b=>b.id));
});
it("bounds the supported column at twenty tiers without accepting a twenty-first crate",()=>{
  const r=request(),c=r.palletBuild!.config;c.crateBearing!.maxLayers=20;c.crateBearing!.maxTopLoadKg=10000;for(const k of ["L0W0","L0W1","L1W0","L1W1"] as const)c.crateBearing!.columnCapacityKg[k]=10000;seal(c);r.products[0].quantity=42;r.palletBuild!.maxPallets=21;r.container.height=20000;r.container.doorHeight=20000;const p=pack(r);expect(p.metrics.loadedCount).toBe(40);expect(p.pallets).toHaveLength(20);expect(planCrateStackReview(p).errors).toEqual([]);
});
it("checks site regions against complete crate envelopes during search",()=>{
  const r=request();r.container.exclusions=[{id:"beam",name:"Beam",kind:"obstacle",x:0,y:0,z:1000,dx:1000,dy:800,dz:100}];const p=pack(r);expect(p.metrics.loadedCount).toBe(2);expect(p.validation.valid).toBe(true);
});
it("preserves complete 1:2 kits inside each stacked crate",()=>{
  const r=request(),c=r.palletBuild!.config;c.maxCargoHeight=600;seal(c);r.products[0].maxTopLoadKg=100;r.products=[{...r.products[0],quantity:2,setCode:"KIT",unitsPerSet:1},{...r.products[0],id:"b",sku:"B",quantity:4,setCode:"KIT",unitsPerSet:2}];const p=pack(r);expect(p.metrics.loadedCount).toBe(6);expect(p.pallets).toHaveLength(2);expect(p.setSummaries[0].loadedSets).toBe(2);for(const unit of p.pallets!){const cargo=p.placements.filter(b=>b.palletIds?.[0]===unit.id);expect(cargo).toHaveLength(3);expect(new Set(cargo.map(b=>b.setNumber)).size).toBe(1);expect(cargo.filter(b=>b.sku==="B")).toHaveLength(2);}
});
for(const turns of [2,3] as const)it(`revalidates actual corner paths at horizontal quarter-turn ${turns}`,()=>{
  const r=request();r.products[0].rotationPolicy="upright";r.container.width=1000;r.container.doorWidth=1000;const p=pack(r),rotated=structuredClone(p);for(const pallet of rotated.pallets!){const source=p.pallets!.find(v=>v.id===pallet.id)!;pallet.quarterTurns=turns;pallet.orientation=turns%2?"WLH":"LWH";pallet.dx=turns%2?800:1000;pallet.dy=turns%2?1000:800;for(let i=0;i<rotated.placements.length;i++)if(rotated.placements[i].palletIds?.includes(pallet.id))rotated.placements[i]=palletWorldBox(palletLocalBox(p.placements[i],source),pallet);}
  expect(restorePackingSnapshot(r,rotated).validation.valid).toBe(true);expect(planCrateStackReview(rotated).cells.every(c=>c.state==="passed")).toBe(true);
});
it("rejects a saved column whose current packaging geometry changed even if the old evidence object was retained",()=>{
  const r=request(),p=pack(r);r.palletBuild!.config.length+=1;expect(()=>restorePackingSnapshot(r,p)).toThrow(/geometry or rating evidence/);
});
it("shows actual static loads consistently in audits, heatmap, HTML and coordinate CSV",()=>{
  const r=request(),p=pack(r),loads=analyzeLoads(p,r.products);expect(loads.crates.map(c=>c.stack.topLoadKg)).toEqual([120,60,0]);expect(loads.pallets.map(c=>c.load)).toEqual([20,20,20]);expect(loads.zones.reduce((n,z)=>n+z.weight,0)).toBe(180);
  expect(auditPackingResult(p,r.products).checks.find(c=>c.id==="strength")?.state).toBe("pass");expect(reviewPlan(p,r.products).checks.find(c=>c.id==="bearing")?.state).toBe("pass");
  const csv=parseCsvRecords(buildPlacementCsv(p)),state=csv[0].indexOf("木箱实际叠放状态"),top=csv[0].indexOf("木箱累计上压(kg)"),through=csv[0].indexOf("木箱每路径总载荷上界(kg)");expect(csv.slice(1,4).map(r=>[r[state],r[top],r[through]])).toEqual([["passed","120","180"],["passed","60","120"],["passed","0","60"]]);expect(crateEvidenceHtml(p,true)).toContain("Passed entered static ratings");
  const bad=moveUnit(structuredClone(p),p.pallets![1].id,{x:1});expect(reviewPlan(bad,r.products).checks.find(c=>c.id==="bearing")?.state).toBe("fail");
});

it.each(["practical","maximum"] as const)("uses distinct rated corner paths on two coplanar crates under %s",strategy=>{
  const r=request(strategy),build=r.palletBuild!,lower=build.config,upper=config();
  lower.width=400;lower.gap=0;upper.gap=0;
  lower.crateBearing!.bridgeStacking=true;upper.crateBearing!.bridgeStacking=true;seal(lower);seal(upper);
  r.practicalTargetUtilization=.95;r.container.height=1150;r.container.doorHeight=1150;
  r.products=[{...r.products[0],width:300,height:400,priority:100,quantity:2},{...r.products[0],id:"upper",sku:"UPPER",width:700,height:400,priority:10,quantity:1}];
  build.primaryRule={maxPallets:2,productIds:["p"]};
  build.additionalSpecs=[{id:"bridge",config:upper,maxPallets:1,stackLayers:1,maxTopLoadKg:0,productIds:["upper"]}];
  const plan=pack(r),report=planCrateStackReview(plan);
  expect(plan.metrics.loadedCount).toBe(3);
  expect(plan.pallets?.map(p=>p.z)).toEqual([0,0,540]);
  expect(report.bridgeParents.get(plan.pallets![2].id)).toEqual(plan.pallets!.slice(0,2).map(p=>p.id));
  expect(report.cells.filter(c=>c.level===1).every(c=>c.topLoadKg===50&&c.throughLoadBoundKg===100)).toBe(true);
  expect(report.errors).toEqual([]);
  lower.crateBearing!.bridgeStacking=false;seal(lower);
  expect(pack(r).metrics.loadedCount).toBe(2);
},15_000);

it("also constrains rated crates by the separate pallet tier and top-load controls",()=>{
 for(const rule of [{enabled:true,maxLayers:2},{enabled:true,maxLayers:0,maxTopLoadKg:60}]){
 const r=request();r.palletBuild!.config.unitStacking=rule;const p=pack(r);
 expect(p.validation.valid).toBe(true);expect(p.pallets).toHaveLength(2);expect(Math.max(...planCrateStackReview(p).cells.map(c=>c.level))).toBe(2);
 }
});
