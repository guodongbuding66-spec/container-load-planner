import {restorePackingSnapshot} from "./engine";
import {parseWorkspaceBackup,restoreWorkspacePlans,serializeWorkspaceBackup,type WorkspaceInputs} from "./workspace-file";
import {auditPackingResult} from "./result-audit";
import {buildPlacementCsv,parseCsvRecords} from "./csv";
import {crateEvidenceHtml} from "./field-report";
import {expect,it} from "vitest";
import {oneLayerCrateFixture} from "../../tests/one-layer-crate-fixture";
import {packLoadingWorkflow} from "./pack-loading";
import {previewPalletRecipe,withPalletRecipe} from "./pallet-recipe";
import {palletSpecifications} from "./pallet-specifications";
import {emptyCrateBearing} from "./crate-bearing";
import {planCrateStackReview} from "./crate-auto-stack";
import {enableWholePalletStacking,parseUnitStacking} from "./unit-stacking";
function fixture(count=3){
 const r=oneLayerCrateFixture(),b=r.palletBuild!;
 Object.assign(b.config,{length:1800,width:1800,unitStacking:{enabled:true,maxLayers:0},crateBearing:emptyCrateBearing()});
 b.maxPallets=200;b.primaryRule={maxPallets:200,cartonLimit:count};return r;
}
it("loads complete three-carton crates above the floor without changing their dimensions",()=>{
 const r=fixture();const p=packLoadingWorkflow(r);
 expect(p.validation.valid).toBe(true);expect(p.pallets!.some(v=>v.z>0)).toBe(true);
 expect(p.metrics.loadedCount).toBe(252);expect(p.pallets).toHaveLength(84);expect(Math.max(...p.pallets!.map(p=>p.z))).toBe(2340);
 expect(planCrateStackReview(p).cells.some(v=>v.state==="declared"&&v.level>1)).toBe(true);
 expect(r.products[0].quantity).toBe(596);
});
it.each([3,20])("keeps %i cartons per pallet and loads multiple complete tiers after sizing",count=>{
 const r=fixture(count),spec=palletSpecifications(r.palletBuild!)[0];
 delete spec.config.crateBearing;
 const preview=previewPalletRecipe({request:r,spec,groupKey:'sku:'+r.products[0].id,cartons:count,mode:'suggest'});
 r.palletBuild=withPalletRecipe(r.palletBuild!,'primary',{config:preview.config,cartonLimit:count});
 for(const strategy of ['practical','maximum'] as const){const p=packLoadingWorkflow({...r,strategy});expect(p.validation.valid).toBe(true);expect(p.pallets!.some(v=>v.z>0)).toBe(true);expect(p.metrics.loadedCount).toBe(count===3?378:strategy==='practical'?540:560);expect(p.pallets!.every(v=>v.z+(v.enclosureHeight??v.dz)<=r.container.height-r.clearance)).toBe(true);}
// Hundreds of cartons are packed by both solvers; shared CI CPUs need a larger
// per-case budget than small unit tests. Keep every count and geometry assertion.
},15000);
it("honors explicit floor-only, zero top load, prohibited structure and cumulative upper load",()=>{
 for(const change of [{unitStacking:{enabled:false,maxLayers:0}},{unitStacking:{enabled:true,maxLayers:0,maxTopLoadKg:0}},{crateBearing:{...emptyCrateBearing(),policy:'prohibited' as const}}]){
  const r=fixture();Object.assign(r.palletBuild!.config,change);const p=packLoadingWorkflow(r);expect(p.pallets!.every(v=>v.z===0)).toBe(true);
 }
 const r=fixture();r.palletBuild!.config.unitStacking={enabled:true,maxLayers:0,maxTopLoadKg:151};const p=packLoadingWorkflow(r);expect(Math.max(...planCrateStackReview(p).cells.map(c=>c.level))).toBe(2);expect(p.validation.valid).toBe(true);
});
it("rejects invalid declaration values",()=>{for(const v of [{enabled:true,maxLayers:-1},{enabled:true,maxLayers:100},{enabled:true,maxLayers:0,maxTopLoadKg:-1}])expect(()=>parseUnitStacking(v)).toThrow();});

it("enables whole-unit tiers without resizing and changes supply only when selected",()=>{
 const r=fixture(),b=r.palletBuild!;delete b.config.unitStacking;b.maxPallets=50;b.primaryRule!.maxPallets=50;
 const copy=structuredClone(b),limited=enableWholePalletStacking(b,"primary",false),automatic=enableWholePalletStacking(b,"primary",true);
 expect(b).toEqual(copy);expect(limited.maxPallets).toBe(50);expect(automatic.maxPallets).toBe(200);expect(automatic.primaryRule!.maxPallets).toBe(200);
 expect(automatic.config.length).toBe(1800);expect(automatic.config.maxCargoHeight).toBe(125);expect(automatic.config.crateBearing).toEqual(b.config.crateBearing);
 expect(packLoadingWorkflow({...r,palletBuild:limited}).metrics.loadedCount).toBe(150);
 expect(packLoadingWorkflow({...r,palletBuild:automatic}).metrics.loadedCount).toBe(252);
});


it("preserves tiers and weight through backup restore and labels exported structure unverified",()=>{
 const r=fixture(),plan=packLoadingWorkflow(r);
 const inputs:WorkspaceInputs={...r,strategy:r.strategy??"practical",practicalTargetPercent:88,customContainers:[],targetVolumePercent:90,targetWeightPercent:90,lengthUnit:"mm",weightUnit:"kg"};
 const file=serializeWorkspaceBackup(inputs,plan.engineVersion,plan),restored=restoreWorkspacePlans(file,parseWorkspaceBackup(file))!;
 expect(restored.pallets!.map(p=>[p.id,p.x,p.y,p.z])).toEqual(plan.pallets!.map(p=>[p.id,p.x,p.y,p.z]));
 expect(restored.metrics.grossWeight).toBe(plan.metrics.grossWeight);
 expect(restored.placements.map(b=>[b.id,b.x,b.y,b.z])).toEqual(plan.placements.map(b=>[b.id,b.x,b.y,b.z]));
 expect(auditPackingResult(plan,r.products).checks.find(c=>c.id==="strength")!.state).toBe("unverified");
 const csv=parseCsvRecords(buildPlacementCsv(plan)),state=csv[0].indexOf("木箱实际叠放状态"),rules=csv[0].indexOf("整托堆叠规则JSON");
 expect(csv[1][state]).toBe("declared");expect(JSON.parse(csv[1][rules])).toEqual({enabled:true,maxLayers:0});
 expect(crateEvidenceHtml(plan,true)).toContain("structural rating unverified");
 const changed=structuredClone(inputs);changed.palletBuild!.config.unitStacking!.enabled=false;
 expect(()=>restoreWorkspacePlans(file,changed)).toThrow();
});
it("rejects floating or overloaded restored columns and respects a two-tier cap",()=>{
 const r=fixture();r.palletBuild!.config.unitStacking!.maxLayers=2;
 const plan=packLoadingWorkflow(r);expect(plan.metrics.loadedCount).toBe(36);expect(planCrateStackReview(plan).cells.every(c=>c.level<=2)).toBe(true);
 const bad=structuredClone(plan),id=bad.pallets!.find(p=>p.z>0)!.id;
 bad.pallets!.find(p=>p.id===id)!.z+=1;bad.placements.filter(b=>b.palletIds?.includes(id)).forEach(b=>b.z+=1);
 expect(()=>restorePackingSnapshot(r,bad)).toThrow();
 const original=fixture(),full=packLoadingWorkflow(original);full.palletization!.config.unitStacking!.maxTopLoadKg=0;
 if(full.palletization!.specifications)for(const s of full.palletization!.specifications)s.config.unitStacking!.maxTopLoadKg=0;
 original.palletBuild!.config.unitStacking!.maxTopLoadKg=0;
 expect(()=>restorePackingSnapshot(original,full)).toThrow();
});
