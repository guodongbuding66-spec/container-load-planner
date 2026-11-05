import {afterEach,expect,it,vi} from "vitest";
import {defaultModelPart,defaultSolidModel} from "./solid-model";
import {DEFAULT_PACKAGING} from "./packaging";
import {downloadPdfGuide} from "./pdf-guide";
import {translateDiagnostic} from "./translate-ui";
import {reviewPlan} from "./plan-review";
import {pack,validatePacking,restorePackingSnapshot,calculateReverseCounts} from "./engine";
import {packLoadingWorkflow} from "./pack-loading";
import {availablePackingVolume,parseSiteExclusions,siteExcludedVolume,siteExclusionBoxes,type SiteExclusion} from "./site-exclusions";
import {auditPackingResult} from "./result-audit";
import {analyzeEmptySpaces,intersects} from "./free-space";
import {auditAccess} from "./access";
import {planProjection} from "./plan-projection";
import {customerReport,offlineFieldHtml} from "./field-report";
import {buildPlacementCsv,parseCsvRecords} from "./csv";
import {fieldPlanFingerprint} from "./execution";
import {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans} from "./workspace-file";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {validatePalletizedCargo} from "./prebuilt-pallets";
import {palletSpaceSummary} from "./floor-pallets";
import type {PackingRequest,ProductInput} from "./types";
const p:ProductInput={id:"p",sku:"P",name:"P",length:500,width:500,height:500,weight:10,quantity:8,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const zone:SiteExclusion={id:"a",name:"<Obstacle>",kind:"obstacle",x:0,y:0,z:0,dx:500,dy:500,dz:500};
const c={id:"c",name:"C",length:1000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:1000};
const req:PackingRequest={workflow:"direct",mode:"mixed",strategy:"maximum",clearance:0,container:{...c,exclusions:[zone]},products:[p]};
it("subtracts overlapping physical regions exactly once and clips safety margins",()=>{
 const container={...c,exclusions:[{...zone,dy:1000,dz:1000},{...zone,id:"b",x:250,dy:1000,dz:1000}]};
 expect(siteExcludedVolume(container,0)).toBe(750000000);expect(availablePackingVolume(container,0)).toBe(250000000);
 const clipped={...c,exclusions:[{...zone,dx:100,dy:1000,dz:1000}]};expect(siteExclusionBoxes(clipped,10)[0]).toMatchObject({x:0,y:0,z:0,dx:90,dy:980,dz:990});expect(siteExcludedVolume(clipped,10)).toBe(90*980*990);
 expect(siteExcludedVolume({...c,exclusions:[{...zone,dx:5}]},10)).toBe(0);
});
it("validates identities, bounded coordinates and region types without changing old inputs",()=>{
 expect(parseSiteExclusions(undefined,c)).toBeUndefined();expect(parseSiteExclusions([],c)).toBeUndefined();expect(parseSiteExclusions([zone],c)).toEqual([zone]);
 for(const v of [[zone,zone],[{...zone,x:-1}],[{...zone,dx:0}],[{...zone,x:501}],[{...zone,dz:NaN}],[{...zone,kind:"support"}],[{...zone,name:""}],Array.from({length:17},(_,i)=>({...zone,id:`z${i}`}))])expect(()=>parseSiteExclusions(v,c)).toThrow();
 expect(parseSiteExclusions([{...zone,name:"",x:800}],c,true)).toHaveLength(1);
});
it.each(["practical","maximum"] as const)("rebuilds feasible cargo around an obstacle without counting it (%s)",strategy=>{
 const plan=pack({...req,strategy});expect(plan.validation.errors).toEqual([]);expect(plan.metrics.loadedCount).toBeGreaterThan(0);expect(plan.metrics.loadedCount).toBeLessThanOrEqual(7);expect(plan.metrics.grossWeight).toBe(plan.placements.length*10);expect(plan.metrics.effectiveVolume).toBe(875000000);expect(plan.placements.every(b=>!intersects(b,zone))).toBe(true);expect(auditPackingResult(plan,[p]).hasErrors).toBe(false);expect(plan.summaries).toHaveLength(1);
 if(strategy==="maximum")expect(plan.metrics.loadedCount).toBe(6); // The empty top corner has no supporting obstacle.
});
it("never uses an obstacle or reserved region as a load-bearing platform",()=>{
 for(const kind of ["obstacle","reserved"] as const){const plan=pack({...req,container:{...c,length:500,width:500,doorWidth:500,exclusions:[{...zone,kind}]}});expect(plan.placements).toEqual([]);expect(plan.validation.valid).toBe(true);}
});
it.each(["practical","maximum"] as const)("handles single-product capacity with a physical region (%s)",strategy=>{
 const plan=pack({...req,mode:"single",strategy,singleCartonLimit:8});expect(plan.validation.valid).toBe(true);expect(plan.placements.length).toBeGreaterThan(0);expect(plan.placements.length).toBeLessThan(8);expect(plan.metrics.loadedCount).toBe(plan.placements.length);expect(auditPackingResult(plan,[p]).hasErrors).toBe(false);
});
it("independently rejects imported collisions and same-volume moved regions",()=>{
 const baseline=pack({...req,container:c}),plan=pack(req);
 expect(validatePacking(baseline.placements,req.container,0,[p]).valid).toBe(false);expect(()=>restorePackingSnapshot(req,baseline)).toThrow();
 const moved=structuredClone(plan);moved.container.exclusions![0].x=500;
 expect(auditPackingResult(moved,[p]).hasErrors).toBe(true);expect(()=>restorePackingSnapshot({...req,container:moved.container},plan)).toThrow();
});
it("removes reserved geometry from free-space suggestions and remaining capacity",()=>{
 const plan=pack(req),empty=analyzeEmptySpaces(plan),boxes=siteExclusionBoxes(plan.container,0);expect(empty.spaces.every(s=>boxes.every(b=>!intersects(s,b)))).toBe(true);
 expect(empty.coveredVolume).toBeCloseTo(plan.metrics.effectiveVolume-plan.metrics.loadedVolume,4);expect(palletSpaceSummary(plan.container,0,[],plan.metrics.loadedVolume,plan.metrics.grossWeight).effectiveVolume).toBe(plan.metrics.effectiveVolume);
});
it("keeps fixed regions in straight and bounded load/unload path contexts",()=>{
 const plan=pack({...req,products:[{...p,length:400,width:400,height:400,quantity:1}],container:{...c,exclusions:[{...zone,x:500,dx:100,dy:1000,dz:1000}]}}),delivery={p:{customer:"C",destination:"D",stop:1}};
 const straight=auditAccess(plan,delivery);expect(straight.issues.some(i=>i.reason==="blocked"&&i.obstacles.includes("site-exclusion/a"))).toBe(true);
 const route=auditAccess(plan,delivery,{maneuver:true,maxLift:0,clearance:0,turn:true,budget:100});expect(route.issues.some(i=>i.reason==="search")).toBe(true);
});
it("preserves source geometry and both strategy snapshots in backups",()=>{
 const maximum=pack(req),practical=pack({...req,strategy:"practical"}),inputs={...req,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:95,customContainers:[req.container],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
 const file=serializeWorkspaceBackup(inputs,"0.34.0",maximum,{maximum,practical}),parsed=parseWorkspaceBackup(file),restored=restoreWorkspacePlans(file,parsed)!;
 expect(parsed.container.exclusions).toEqual([zone]);expect(parsed.customContainers[0].exclusions).toEqual([zone]);expect(restored.strategyPlans!.practical!.metrics.grossWeight).toBe(practical.metrics.grossWeight);expect(restored.metrics.effectiveVolume).toBe(maximum.metrics.effectiveVolume);
 const tampered=JSON.parse(file);tampered.inputs.container.exclusions[0].x=900;expect(()=>parseWorkspaceBackup(JSON.stringify(tampered))).toThrow();
});
it("exports permanent projection geometry, escaped report names and separately typed zero-weight CSV rows",()=>{
 const plan=pack(req),html=customerReport(plan,[p],{language:"en",customer:"C",order:"O",currency:"USD",freight:null});
 for(const view of ["top","side","door"] as const)expect(planProjection(plan,view).shapes.filter(s=>s.box.id.startsWith("site-exclusion/"))).toHaveLength(1);
 expect(html).toContain('data-site-exclusions="1"');expect(html).toContain("&lt;Obstacle&gt;");expect(html).toContain("no cargo support");expect(offlineFieldHtml(plan,[p])).toContain("柜内障碍与禁占区");
 const rows=parseCsvRecords(buildPlacementCsv(plan));expect(rows.every(r=>r.length===rows[0].length)).toBe(true);const site=rows.find(r=>r[15]==="site-exclusion")!;expect(site[14]).toBe("0");expect(site[31]).toBe("physical-inner");expect(JSON.parse(site.at(-1)!)).toEqual(zone);expect(rows.filter(r=>r[15]==="cargo")).toHaveLength(plan.placements.length);
 const scenario={...plan,dimensionScenario:{id:"s",kind:"nominal" as const,proxyProductIds:[]}};expect(parseCsvRecords(buildPlacementCsv(scenario))[0].slice(-2)).toEqual(["尺寸方案ID","尺寸口径"]);
});
it("invalidates offline progress when region locations change",()=>{
 const plan=pack(req),moved={...plan,container:{...plan.container,exclusions:[{...zone,x:500}]}};expect(fieldPlanFingerprint(plan)).not.toBe(fieldPlanFingerprint(moved));
});
it("checks complete prebuilt pallet envelopes and keeps comparison metadata valid",()=>{
 const cargo={...p,length:400,width:400,height:100,quantity:4},config={...DEFAULT_PALLET_BUILD.config,length:500,width:500,height:50,maxCargoHeight:500};
 const r={...req,workflow:"palletized" as const,products:[cargo],container:{...c,length:2000,exclusions:[{...zone,dy:1000,dz:1000}]},palletBuild:{...DEFAULT_PALLET_BUILD,config,selection:"compact" as const}};
 const plan=packLoadingWorkflow(r);expect(plan.placements).toHaveLength(4);expect(plan.pallets!.every(p=>p.x>=500)).toBe(true);expect(auditPackingResult(plan,[cargo]).hasErrors).toBe(false);
 const stock=packLoadingWorkflow({...r,container:{...r.container,exclusions:undefined}}),unit=stock.pallets![0];const intruded={...r.container,exclusions:[{...zone,x:unit.x+10,y:unit.y+10,z:unit.z+10,dx:20,dy:20,dz:20}]};
 expect(validatePalletizedCargo(stock.placements,stock.pallets!,intruded,0,stock.palletization!,[cargo]).some(e=>e.includes("site region"))).toBe(true);
});
it("places floor pallets beyond a keep-clear zone and still rejects pallet-only site regions",()=>{
 const region={...zone,x:0,y:0,dx:250,dy:c.width,dz:100};
 const plan=pack({...req,container:{...c,exclusions:[region]},floorPallets:{...DEFAULT_PALLET_BUILD.config,length:400,width:400,height:50,count:2,gap:0}});
 expect(plan.validation.valid).toBe(true);expect(plan.pallets).toHaveLength(2);
 expect(plan.pallets?.every(p=>p.x>=250)).toBe(true);
 expect(()=>packLoadingWorkflow({...req,workflow:"pallet-only",palletBuild:DEFAULT_PALLET_BUILD})).toThrow(/Pallet-only/);
 expect(()=>pack({...req,container:{...c,exclusions:[{...zone,dx:1000,dy:1000,dz:1000}]}})).toThrow(/占满/);
});

it("uses actual compound bodies when a fixed region lies inside an open notch",()=>{
 const model=defaultSolidModel("box",[100,100,100]);model.parts=[defaultModelPart("box",[20,100,100],"left"),{...defaultModelPart("box",[80,20,100],"rear"),position:[20,0,0]}];
 const cargo={...p,length:100,width:100,height:100,quantity:1,solidModel:model},container={...c,length:100,width:100,height:100,doorWidth:100,doorHeight:100,exclusions:[{...zone,x:30,y:30,z:0,dx:60,dy:60,dz:100}]};
 const plan=pack({...req,container,products:[cargo]});expect(plan.placements).toHaveLength(1);expect(plan.validation.valid).toBe(true);expect(auditPackingResult(plan,[cargo]).hasErrors).toBe(false);
});
it("retains whole kits while generating around site regions",()=>{
 const a={...p,setCode:"KIT",unitsPerSet:1},b={...a,id:"b",sku:"B"},plan=pack({...req,products:[a,b]});expect(plan.placements.length%2).toBe(0);expect(plan.summaries[0].loaded).toBe(plan.summaries[1].loaded);expect(auditPackingResult(plan,[a,b]).hasErrors).toBe(false);
});
it("rejects fixed intrusions into empty enclosed crate space, independently of carton collision",()=>{
 const cargo={...p,length:100,width:100,height:100,quantity:1},config={...DEFAULT_PALLET_BUILD.config,length:500,width:500,height:50,maxCargoHeight:500,packaging:{...DEFAULT_PACKAGING,enclosure:"frame" as const}};
 const plan=packLoadingWorkflow({...req,workflow:"palletized",container:c,products:[cargo],palletBuild:{...DEFAULT_PALLET_BUILD,config}}),u=plan.pallets![0],intrusion={...zone,x:u.x+200,y:u.y+200,z:300,dx:20,dy:20,dz:20},container={...c,exclusions:[intrusion]};
 expect(plan.placements.every(b=>!intersects(b,intrusion))).toBe(true);expect(validatePalletizedCargo(plan.placements,plan.pallets!,container,0,plan.palletization!,[cargo]).some(e=>e.includes("site region"))).toBe(true);
});
it("keeps open-access site routing unverified",()=>{
 const plan=pack({...req,container:{...req.container,loadingAccess:"open"},delivery:{p:{customer:"C",destination:"D",stop:1}}});expect(reviewPlan(plan,[p]).checks.find(c=>c.id==="path")!.state).toBe("unverified");
});
afterEach(()=>vi.unstubAllGlobals());
it("renders site coordinates and limits on a separate PDF page without adding cargo or tare",async()=>{
 const plan=pack(req),texts:string[]=[],ctx={fillText:(v:string)=>texts.push(v),measureText:(v:string)=>({width:v.length*13}),fillRect:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),stroke:vi.fn(),fill:vi.fn()};
 vi.stubGlobal("document",{fonts:{ready:Promise.resolve()},createElement:(tag:string)=>tag==="canvas"?{getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([new Uint8Array([255,216,255,217])]))}:{click:vi.fn()}});vi.stubGlobal("URL",{createObjectURL:()=>"blob:test",revokeObjectURL:vi.fn()});vi.stubGlobal("setTimeout",vi.fn());
 await downloadPdfGuide(plan,"en",[p]);expect(texts).toContain("Obstacles and keep-clear regions");expect(texts).toContain("0 / 0 / 0");expect(texts).toContain("500 × 500 × 500");expect(texts.some(t=>t.includes("Equipment, threshold traversal"))).toBe(true);expect(plan.metrics.grossWeight).toBe(60);
});

it.each(["mixed","single"] as const)("keeps invalid region arithmetic editable and rejects solving (%s)",mode=>{
 for(const bad of [{...zone,x:900},{...zone,name:""}]){
  const invalid={...req,mode,container:{...c,exclusions:[bad]}};
  const bound=calculateReverseCounts(invalid,1,1);expect(bound.effectiveVolume).toBe(0);expect(bound.recommendedTotal).toBe(0);expect(()=>pack(invalid)).toThrow();
 }
 expect(calculateReverseCounts({...req,mode},1,1).recommendedTotal).toBeGreaterThan(0);
});

it("localizes site-region solver warnings and bounds failures without altering user data",()=>{
 const plan=pack(req),warning=plan.warnings.find(v=>v.includes("Site regions constrain"))!;
 expect(warning).toBeTruthy();expect(translateDiagnostic(warning,"en")).not.toMatch(/[\u3400-\u9fff]/u);
 let error="";try{parseSiteExclusions([{...zone,x:900}],c);}catch(e){error=(e as Error).message;}
 expect(translateDiagnostic(error,"en")).toContain("physical interior");expect(translateDiagnostic(error,"en")).not.toMatch(/[\u3400-\u9fff]/u);
});
