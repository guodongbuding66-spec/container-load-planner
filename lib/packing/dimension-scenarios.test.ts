import { describe, expect, it } from "vitest";
import { emptyDimensionAllowance, parseDimensionAllowance } from "./dimension-allowance";
import { buildDimensionComparison, conservativeProduct, deriveDimensionScenario, reviewOriginalDimensionPositions, scenarioMargins } from "./dimension-scenarios";
import { parseDimensionComparisonReport } from "./dimension-report";
import { packLoadingWorkflow } from "./pack-loading";
import { parseProductInput, parseWorkspaceBackup, serializeWorkspaceBackup, restoreWorkspacePlans, type WorkspaceInputs } from "./workspace-file";
import { buildPlacementCsv, parseProductsCsv, parseCsvRecords } from "./csv";
import { toCsvCell } from "./csv";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { defaultSolidModel } from "./solid-model";
import { auditPackingResult } from "./result-audit";
import { reviewPlan } from "./plan-review";
import { toMillimeters } from "./units";
import type { PackingRequest, ProductInput } from "./types";

const product:ProductInput={id:"p",sku:"P",name:"P",length:1000,width:580,height:200,weight:10,quantity:4,priority:50,rotationPolicy:"fixed",stackable:false,maxStackLayers:0,color:"#338877"};
const request=(p=product):PackingRequest=>({workflow:"direct",mode:"mixed",strategy:"maximum",clearance:10,container:{id:"c",name:"C",length:1020,width:2350,height:400,doorWidth:2350,doorHeight:400,maxWeight:1000},products:[p]});
const allowance=()=>({...emptyDimensionAllowance(),source:"Measured batch",batch:"B-01",measuredAt:"2026-10-16",increment:{length:0,width:3,height:0}});
const compare=(r:PackingRequest)=>buildDimensionComparison(r,packLoadingWorkflow(deriveDimensionScenario(r,"nominal").request),packLoadingWorkflow(deriveDimensionScenario(r,"conservative").request));

it("keeps nominal inputs immutable and distinguishes per-dimension and per-face increments in canonical units",()=>{
  const p={...product,protectionGap:5,dimensionAllowance:{...allowance(),incrementMode:"per-face" as const,increment:{length:toMillimeters(.3,"cm"),width:0,height:0}}},before=JSON.stringify(p),r=request(p);
  expect(deriveDimensionScenario(r,"nominal").request.products[0].length).toBe(1000);
  const next=deriveDimensionScenario(r,"conservative").request.products[0];expect(next.length).toBe(1006);expect(next.protectionGap).toBe(5);expect(next.weight).toBe(10);expect(next.dimensionAllowance).toBeUndefined();expect(JSON.stringify(p)).toBe(before);
  p.dimensionAllowance.incrementMode="total" as never;expect(conservativeProduct(p).product.length).toBe(1003);
});
it("uses larger measured axes without shrinking nominal dimensions and counts each accessory only once",()=>{
  const a={...allowance(),measured:{length:998,width:585,height:201},attachments:[{sourceId:"wrap",name:"Film",increment:{length:2,width:2,height:2},weightKg:.5,dimensionsIncluded:true,weightIncluded:true},{sourceId:"corners",name:"Corners",increment:{length:4,width:4,height:4},weightKg:.2,dimensionsIncluded:false,weightIncluded:false}]};
  const p=conservativeProduct({...product,dimensionAllowance:a}).product;
  expect([p.length,p.width,p.height,p.weight]).toEqual([1004,592,205,10.2]);
  expect(conservativeProduct({...product,dimensionAllowance:a}).product).toEqual(p);
});
describe("dimension input validation",()=>{
  it.each([-1,NaN,Infinity])("rejects invalid allowance %s",n=>expect(()=>parseDimensionAllowance({...allowance(),increment:{length:n,width:0,height:0}})).toThrow());
  it("rejects repeated accessory IDs, invalid dates, invalid measurements and inclusion flags",()=>{
    const attachment={sourceId:"film",name:"Film",increment:{length:1,width:1,height:1},weightKg:1,dimensionsIncluded:false,weightIncluded:false};
    expect(()=>parseDimensionAllowance({...allowance(),attachments:[attachment,{...attachment,sourceId:" FILM "}]})).toThrow(/Duplicate/);
    expect(()=>parseDimensionAllowance({...allowance(),measuredAt:"2026-02-30"})).toThrow();
    expect(()=>parseDimensionAllowance({...allowance(),measured:{length:0,width:10,height:10}})).toThrow();
    expect(()=>parseDimensionAllowance({...allowance(),attachments:[{...attachment,weightIncluded:"false"}]})).toThrow();
  });
});
it("finds a four-column 2330 mm width failure at old positions and independently solves the new count",()=>{
  const r=request({...product,dimensionAllowance:allowance()}),c=compare(r);
  expect(c.nominal.plan.metrics.loadedCount).toBe(4);expect(c.originalPositions.valid).toBe(false);
  expect(c.conservative.plan.validation.valid).toBe(true);expect(c.conservative.plan.metrics.loadedCount).toBe(3);
  expect(c.conservative.plan.placements.every(b=>b.dy===583)).toBe(true);
  expect(auditPackingResult(c.conservative.plan,c.conservative.request.products).hasErrors).toBe(false);
  expect(auditPackingResult(c.conservative.plan,c.nominal.request.products).hasErrors).toBe(true);
  expect(scenarioMargins(c.conservative.plan)?.door?.width).toBe(1747);
});
it("catches door-height and mass limits when dimensions or accessories change",()=>{
  const p={...product,quantity:1,dimensionAllowance:{...allowance(),increment:{length:0,width:0,height:51}}},r=request(p);r.container.doorHeight=250;
  const c=compare(r);expect(c.nominal.plan.metrics.loadedCount).toBe(1);expect(c.conservative.plan.metrics.loadedCount).toBe(0);expect(c.originalPositions.valid).toBe(false);
  const heavy=request({...product,quantity:1,dimensionAllowance:{...allowance(),attachments:[{sourceId:"base",name:"Base",increment:{length:0,width:0,height:0},weightKg:1000,dimensionsIncluded:false,weightIncluded:false}]}});
  expect(compare(heavy).conservative.plan.metrics.loadedCount).toBe(0);
});
it("keeps kits atomic and packaging tare once across prebuilt workflows",()=>{
  const a={...product,length:400,width:300,height:100,quantity:4,stackable:true,setCode:"KIT",unitsPerSet:1,dimensionAllowance:{...allowance(),increment:{length:0,width:0,height:1}}};
  const r={...request(a),workflow:"pallet-only" as const,products:[a,{...a,id:"b",sku:"B",weight:4}],palletBuild:{...DEFAULT_PALLET_BUILD,maxPallets:2,config:{...DEFAULT_PALLET_BUILD.config,length:800,width:600,height:100,weight:25,maxCargoHeight:500}}};
  const c=compare(r);expect(c.conservative.plan.metrics.loadedCount).toBe(8);expect(c.conservative.plan.setSummaries[0].loadedSets).toBe(4);
  expect(c.conservative.plan.metrics.grossWeight).toBe(56+c.conservative.plan.pallets!.length*25);expect(scenarioMargins(c.conservative.plan)?.door).toBeNull();
});
it("uses a declared non-stacking outer proxy for enlarged solids without altering nominal geometry",()=>{
  const p={...product,length:400,width:300,height:200,cargoShape:"box" as const,solidModel:defaultSolidModel("box",[400,300,200]),stackable:true,dimensionAllowance:allowance()};
  const r=request(p),derived=deriveDimensionScenario(r,"conservative");
  expect(derived.tag.proxyProductIds).toEqual(["p"]);expect(derived.request.products[0].solidModel).toBeUndefined();expect(derived.request.products[0].stackable).toBe(false);expect(derived.request.products[0].bottomOnly).toBe(true);
  expect(deriveDimensionScenario(r,"nominal").request.products[0].solidModel).toEqual(p.solidModel);
  const cone={...product,cargoShape:"frustum" as const,shapeTopRatio:0,dimensionAllowance:allowance()};
  expect(packLoadingWorkflow(deriveDimensionScenario(request(cone),"conservative").request).validation.valid).toBe(true);
  const c=compare(r);expect(reviewPlan(c.conservative.plan,c.conservative.request.products).checks.find(x=>x.id==="bearing")?.state).toBe("unverified");
});
it("preserves allowances in workspace and CSV imports while old products remain nominal",()=>{
  const p={...product,dimensionAllowance:allowance()};expect(parseProductInput(p).dimensionAllowance).toEqual(p.dimensionAllowance);expect(parseProductInput(product).dimensionAllowance).toBeUndefined();
  const r=request(p),plan=packLoadingWorkflow(r),inputs:WorkspaceInputs={...r,strategy:"maximum",practicalTargetPercent:88,customContainers:[],targetVolumePercent:90,targetWeightPercent:90,lengthUnit:"cm",weightUnit:"kg"};
  const backup=serializeWorkspaceBackup(inputs,"test",plan),restored=parseWorkspaceBackup(backup);
  expect(restored.products[0].dimensionAllowance).toEqual(p.dimensionAllowance);expect(restoreWorkspacePlans(backup,restored)?.metrics.loadedCount).toBe(4);
  const csv="sku,name,length,width,height,weight,quantity,dimensionAllowance\nP,P,1000,580,200,10,4,"+toCsvCell(JSON.stringify(p.dimensionAllowance));expect(parseProductsCsv(csv,["#338877"])[0].dimensionAllowance).toEqual(p.dimensionAllowance);
});
it("exports matching scenario identities in every cargo/pallet CSV row and revalidates both reports on restore",()=>{
  const c=compare(request({...product,name:"P\r\nCarton",dimensionAllowance:allowance()})),restored=parseDimensionComparisonReport(JSON.stringify(c));
  expect(restored.nominal.plan.metrics.loadedCount).toBe(4);expect(restored.conservative.plan.metrics.loadedCount).toBe(3);
  expect(restored.conservative.plan.dimensionScenario).toEqual(c.conservative.plan.dimensionScenario);
  const rows=parseCsvRecords(buildPlacementCsv(c.conservative.plan));expect(rows).toHaveLength(4);expect(rows[1][2]).toBe("P\r\nCarton");expect(rows[0].slice(-2)).toEqual(["尺寸方案ID","尺寸口径"]);expect(rows.slice(1).every(r=>r.at(-1)==="conservative")).toBe(true);
  const raw=structuredClone(c);raw.conservative.plan.metrics.grossWeight=999999;expect(parseDimensionComparisonReport(JSON.stringify(raw)).conservative.plan.metrics.grossWeight).toBe(30);
  raw.conservative.request.products[0].width=580;expect(()=>parseDimensionComparisonReport(JSON.stringify(raw))).toThrow(/request mismatch/);
});
it("refuses mismatched snapshots and invalidates in-place checks for changed quantities",()=>{
  const r=request({...product,dimensionAllowance:allowance()}),c=compare(r);
  expect(()=>buildDimensionComparison(r,c.conservative.plan,c.nominal.plan)).toThrow();
  const scenario=deriveDimensionScenario({...r,products:[{...r.products[0],quantity:1}]},"conservative");expect(reviewOriginalDimensionPositions(c.nominal.plan,scenario).valid).toBe(false);
});
