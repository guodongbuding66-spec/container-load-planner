import { expect, it } from "vitest";
import { crateEvidence, crateEvidenceKey, crateStructureKey, crateSupportRegions, emptyCrateBearing, parseCrateBearing, planCrateUnits, proposeCrateColumn, reviewCrateStack, type CrateReviewUnit } from "./crate-bearing";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { DEFAULT_PACKAGING, packagingParts, placedPackagingParts } from "./packaging";
import { packLoadingWorkflow } from "./pack-loading";
import { auditPackingResult } from "./result-audit";
import { analyzeLoads } from "./load-analysis";
import { parseFloorPalletConfig } from "./floor-pallets";
import { parseWorkspaceBackup, restoreWorkspacePlans, serializeWorkspaceBackup, type WorkspaceInputs } from "./workspace-file";
import { crateEvidenceHtml } from "./field-report";
import { downloadPdfGuide } from "./pdf-guide";
import { vi } from "vitest";
import { restorePackingSnapshot } from "./engine";
import { buildPlacementCsv, parseCsvRecords } from "./csv";
import type { FloorPalletConfig, PackingRequest, ProductInput } from "./types";

function config():FloorPalletConfig {
  const c:FloorPalletConfig={...DEFAULT_PALLET_BUILD.config,length:1000,width:800,height:100,weight:40,maxLoad:500,maxCargoHeight:400,packaging:{...DEFAULT_PACKAGING,base:"corner-feet",enclosure:"frame",wallThickness:40,lid:true}};
  c.crateBearing={...emptyCrateBearing(),policy:"rated",revision:"SYNTHETIC-TEST-ONLY",source:"Synthetic fixture, NOT a production rating",conditions:"Test fixture for static four-corner support; not real evidence",allowedOrientations:["LWH","WLH"],maxTopLoadKg:500,maxLayers:3,columnCapacityKg:{L0W0:1000,L0W1:1000,L1W0:1000,L1W1:1000},reviewed:true};
  c.crateBearing.reviewedFor=crateEvidenceKey(c);return c;
}
function unit(id:string,c=config(),orientation:"LWH"|"WLH"="LWH"):CrateReviewUnit{return {config:c,cargoKg:100,pallet:{id,presetId:c.presetId,name:c.name,x:0,y:0,z:0,dx:orientation==="LWH"?c.length:c.width,dy:orientation==="LWH"?c.width:c.length,dz:c.height,enclosureHeight:540,weight:c.weight,maxLoad:c.maxLoad,orientation,packaging:c.packaging}};}
const column=(n=3)=>proposeCrateColumn(Array.from({length:n},(_,i)=>unit(`crate-${i+1}`)),Array.from({length:n-1},()=>({x:0,y:0})));
const cargo:ProductInput={id:"p",sku:"P",name:"P",length:900,width:700,height:200,weight:10,quantity:6,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
function request(workflow:"pallet-only"|"palletized"="pallet-only"):PackingRequest{return {workflow,mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:1000,width:800,height:2000,doorWidth:800,doorHeight:2000,maxWeight:10000},products:[cargo],palletBuild:{...DEFAULT_PALLET_BUILD,config:config(),maxPallets:3,stackLayers:3,maxTopLoadKg:2000}};}

it("keeps missing, prohibited and reviewed evidence separate without inferring strength from material",()=>{
  const c=config();delete c.crateBearing;expect(crateEvidence(c).state).toBe("unverified");
  c.crateBearing={...emptyCrateBearing(),policy:"prohibited"};expect(crateEvidence(c).state).toBe("prohibited");
  expect(crateEvidence(config()).state).toBe("ready");
  const panel={...config(),packaging:{...config().packaging!,enclosure:"panel" as const}};panel.crateBearing!.reviewedFor=crateEvidenceKey(panel);expect(crateEvidence(panel).reasons).toContain("unsupported");
});
it("binds review to structural dimensions, material, tare AND evidence while appearance changes preserve it",()=>{
  const c=config();for(const patch of [{length:1001},{weight:41},{maxCargoHeight:401},{packaging:{...c.packaging!,base:"block" as const}},{packaging:{...c.packaging!,material:"steel" as const}}])expect(crateEvidence({...c,...patch}).state).toBe("unverified");
  expect(crateEvidence({...c,name:"Renamed",packaging:{...c.packaging!,color:"#112233",opacity:.2}}).state).toBe("ready");
  expect(crateEvidence({...c,crateBearing:{...c.crateBearing!,source:"Other file"}}).reasons).toContain("stale");
  expect(crateEvidence({...c,crateBearing:{...c.crateBearing!,maxTopLoadKg:501}}).reasons).toContain("stale");
  expect(crateStructureKey(c)).not.toContain("opacity");
});
it("requires complete sources, four ratings, supported geometry, orientation and valid dates",()=>{
  const c=config();c.crateBearing!.validUntil="2026-01-01";c.crateBearing!.reviewedFor=crateEvidenceKey(c);expect(crateEvidence(c,"2026-10-16").reasons).toContain("expired");
  expect(()=>parseCrateBearing({...emptyCrateBearing(),columnCapacityKg:{L0W0:1,L0W1:1,L1W0:1}})).toThrow();
  expect(()=>parseCrateBearing({...emptyCrateBearing(),maxTopLoadKg:Infinity})).toThrow();
  expect(()=>parseCrateBearing({...emptyCrateBearing(),validUntil:"2026-02-30"})).toThrow();
  expect(()=>parseCrateBearing({...emptyCrateBearing(),allowedOrientations:["LWH","LWH"]})).toThrow();
});
it("renders exactly four physical bottom feet at the permitted corner paths, including short bases",()=>{
  for(const height of [20,100]){const c={...config(),height},parts=packagingParts(c.length,c.width,c.height,c.packaging,400),feet=parts.filter(p=>p.kind==="block");
    expect(feet).toHaveLength(4);expect(feet.every(p=>p.z===0)).toBe(true);
    const zones=crateSupportRegions(c);for(const zone of zones)expect(feet.some(f=>f.x===zone.x&&f.y===zone.y&&f.dx===zone.dx&&f.dy===zone.dy)).toBe(true);
  }
  const cross=unit("cross",config(),"WLH");expect(placedPackagingParts(cross.pallet).filter(p=>p.kind==="block")).toHaveLength(4);expect(crateSupportRegions(cross.config,cross.pallet).every(r=>r.x>=0&&r.y>=0&&r.x+r.dx<=800&&r.y+r.dy<=1000)).toBe(true);
});
it("matches all four corners and counts every upper gross mass once through three tiers",()=>{
  const report=reviewCrateStack(column());expect(report.state).toBe("passed");expect(report.contacts).toHaveLength(8);expect(report.contacts.every(c=>c.covered)).toBe(true);
  expect(report.units.map(u=>u.topLoadKg)).toEqual([280,140,0]);expect(report.units.map(u=>u.throughLoadBoundKg)).toEqual([420,280,140]);
  expect(report.units[0].columns.every(c=>c.boundKg===420)).toBe(true);expect(report.units.reduce((n,u)=>n+u.grossKg,0)).toBe(420);
});
it("maps clockwise horizontal turns to the same physical support zones",()=>{
  const report=reviewCrateStack(proposeCrateColumn([unit("a",config(),"WLH"),unit("b",config(),"WLH")],[{x:0,y:0}]));expect(report.state).toBe("passed");
});
it("rejects even a small offset and pinpoints the affected feet instead of accepting central-panel contact",()=>{
  const units=proposeCrateColumn([unit("a"),unit("b")],[{x:1,y:0}]),report=reviewCrateStack(units);
  expect(report.state).toBe("failed");expect(report.issues.some(i=>i.unitId==="b"&&i.code==="contact"&&i.corner)).toBe(true);
  units[1].pallet.z-=1;expect(reviewCrateStack(units).issues.some(i=>i.code==="contact")).toBe(true);
});
it("checks cumulative top rating, the worst-case per-path bound and every supporting unit's layer limit",()=>{
  const top=column();top[0].config.crateBearing!.maxTopLoadKg=279;top[0].config.crateBearing!.reviewedFor=crateEvidenceKey(top[0].config);expect(reviewCrateStack(top).issues.some(i=>i.code==="top-load")).toBe(true);
  const paths=column();paths[0].config.crateBearing!.columnCapacityKg.L1W1=419;paths[0].config.crateBearing!.reviewedFor=crateEvidenceKey(paths[0].config);expect(reviewCrateStack(paths).issues).toContainEqual({unitId:"crate-1",code:"column-load",corner:"L1W1"});
  const layers=column();layers[0].config.crateBearing!.maxLayers=2;layers[0].config.crateBearing!.reviewedFor=crateEvidenceKey(layers[0].config);expect(reviewCrateStack(layers).issues.some(i=>i.code==="layers")).toBe(true);
});
it("never promotes missing evidence, explicit prohibition or a single-unit selection to a passed stack",()=>{
  const units=column(2);delete units[1].config.crateBearing;expect(reviewCrateStack(units).state).toBe("unverified");
  units[1].config.crateBearing={...emptyCrateBearing(),policy:"prohibited"};expect(reviewCrateStack(units).state).toBe("prohibited");
  expect(reviewCrateStack([unit("a")]).state).toBe("unverified");
  expect(()=>proposeCrateColumn([unit("a"),unit("b")],[])).toThrow();expect(()=>reviewCrateStack([unit("a"),unit("a")])).toThrow();
});
it("rejects payload, geometry and rated orientation failures",()=>{
  const units=column(2);units[1].cargoKg=501;expect(reviewCrateStack(units).issues.some(i=>i.code==="payload")).toBe(true);
  const orientation=column(2);orientation[1].config.crateBearing!.allowedOrientations=["WLH"];orientation[1].config.crateBearing!.reviewedFor=crateEvidenceKey(orientation[1].config);expect(reviewCrateStack(orientation).issues.some(i=>i.code==="orientation")).toBe(true);
  units[1].pallet.weight=999;expect(reviewCrateStack(units).issues.some(i=>i.code==="geometry")).toBe(true);
});
it("keeps production crates on the floor even with complete synthetic test evidence",()=>{
  const p=packLoadingWorkflow(request("palletized"));expect(p.pallets).toHaveLength(1);expect(p.pallets![0].z).toBe(0);expect(p.metrics.loadedCount).toBe(2);expect(p.metrics.grossWeight).toBe(60);expect(p.validation.valid).toBe(true);
  expect(auditPackingResult(p,[cargo]).checks.find(c=>c.id==="strength")?.state).toBe("unverified");
  const loads=analyzeLoads(p,[cargo]);expect(loads.crates[0].evidence.state).toBe("ready");expect(loads.crates[0].grossKg).toBe(60);
});
it("preflights complete existing units without changing the source order, weights, coordinates or field plan",()=>{
  const plan=packLoadingWorkflow(request()),before=JSON.stringify(plan),units=planCrateUnits(plan);expect(units).toHaveLength(3);
  expect(reviewCrateStack(proposeCrateColumn(units,[{x:0,y:0},{x:0,y:0}])).state).toBe("passed");expect(JSON.stringify(plan)).toBe(before);expect(plan.metrics.grossWeight).toBe(180);
});
it("preserves exact evidence through templates, backups and CSV while rejecting a mismatched snapshot source",()=>{
  const r=request(),plan=packLoadingWorkflow(r),inputs:WorkspaceInputs={...r,strategy:"maximum",practicalTargetPercent:88,customContainers:[],targetVolumePercent:90,targetWeightPercent:90,lengthUnit:"mm",weightUnit:"kg"};
  const file=serializeWorkspaceBackup(inputs,"test",plan),parsed=parseWorkspaceBackup(file);expect(parsed.palletBuild!.config.crateBearing).toEqual(config().crateBearing);expect(restoreWorkspacePlans(file,parsed)?.metrics.grossWeight).toBe(180);
  const raw=structuredClone(plan);raw.palletization!.config.crateBearing!.source="Another source";expect(()=>restorePackingSnapshot(r,raw)).toThrow(/evidence/);
  expect(parseFloorPalletConfig(config()).crateBearing).toEqual(config().crateBearing);
  const rows=parseCsvRecords(buildPlacementCsv(plan));expect(rows[0].slice(-3)).toEqual(["木箱额定资料JSON","木箱资料状态","木箱核验范围"]);expect(rows.slice(1).every(row=>row.at(-2)==="ready"&&row.at(-1)?.includes("floor-only"))).toBe(true);expect(JSON.parse(rows[1].at(-3)!).revision).toBe("SYNTHETIC-TEST-ONLY");
});

it("keeps document grouping separate for reviewed, prohibited and unreviewed evidence and escapes source HTML",()=>{
  const r=request(),plan=packLoadingWorkflow(r);plan.palletization!.specifications=[{id:"primary",config:config(),maxPallets:3,stackLayers:3,maxTopLoadKg:2000},{id:"other",config:config(),maxPallets:3,stackLayers:3,maxTopLoadKg:2000}];
  plan.palletization!.specifications[0].config.crateBearing!.source="<script>bad</script>";
  plan.palletization!.specifications[0].config.crateBearing!.reviewedFor=crateEvidenceKey(plan.palletization!.specifications[0].config);
  plan.palletization!.specifications[1].config.crateBearing!.policy="prohibited";
  plan.pallets!.forEach((p,i)=>p.specificationId=i?"other":"primary");
  const html=crateEvidenceHtml(plan,true);expect(html.match(/<section>/g)).toHaveLength(2);expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");expect(html).not.toContain("<script>");expect(html).toContain("prohibited");expect(html).toContain("floor-only");
});
it("includes an independent evidence summary in the PDF without changing the plan",async()=>{
  const plan=packLoadingWorkflow(request()),before=JSON.stringify(plan),texts:string[]=[];
  const ctx={fillText:(s:string)=>texts.push(s),measureText:(s:string)=>({width:s.length*15}),fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
  vi.stubGlobal("document",{fonts:{ready:Promise.resolve()},createElement:(tag:string)=>tag==="canvas"?{getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([new Uint8Array([255,216,255,217])]))}:{click(){}}});
  vi.stubGlobal("URL",{createObjectURL:()=>"blob:test",revokeObjectURL(){}});vi.stubGlobal("setTimeout",vi.fn());
  try{await downloadPdfGuide(plan,"en",[cargo]);expect(texts).toContain("Crate rating evidence (independent preflight)");expect(texts.some(s=>s.includes("SYNTHETIC-TEST-ONLY"))).toBe(true);expect(texts.some(s=>s.includes("keeps crates floor-only"))).toBe(true);expect(JSON.stringify(plan)).toBe(before);}finally{vi.unstubAllGlobals();}
});
