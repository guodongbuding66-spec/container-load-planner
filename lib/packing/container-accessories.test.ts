import {afterEach,expect,it,vi} from "vitest";
import {parseSiteExclusions,siteExcludedVolume,siteExclusionBoxes,type SiteExclusion} from "./site-exclusions";
import {accessoryInstallationPlan,accessoryMassBoxes,containerAccessoryWeight,orderedAccessories,type ContainerAccessory} from "./container-accessories";
import {pack,packWithComparison,restorePackingSnapshot,revisePackingResult,validatePacking,calculateReverseCounts} from "./engine";
import {packLoadingWorkflow} from "./pack-loading";
import {auditPackingResult} from "./result-audit";
import {reviewPlan} from "./plan-review";
import {palletSpaceSummary} from "./floor-pallets";
import {analyzeLoads} from "./load-analysis";
import {analyzeEmptySpaces,intersects,probeEmptySpace} from "./free-space";
import {planProjection} from "./plan-projection";
import {auditAccess} from "./access";
import {buildPlacementCsv,buildContainerAccessoryCsv,parseCsvRecords} from "./csv";
import {customerReport,offlineFieldHtml} from "./field-report";
import {fieldPlanFingerprint} from "./execution";
import {downloadPdfGuide} from "./pdf-guide";
import {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans} from "./workspace-file";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {translateDiagnostic} from "./translate-ui";
import type {PackingRequest,ProductInput} from "./types";
const c={id:"c",name:"C",length:1000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:35};
const p:ProductInput={id:"p",sku:"P",name:"P",length:200,width:200,height:200,weight:10,quantity:8,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const a:ContainerAccessory={type:"timber",quantity:2,unitWeightKg:7.5,phase:"before-cargo",relatedProductIds:["p"],afterAccessoryIds:[],source:"Measured list",revision:"r1",note:"Remove after unloading"};
const z:SiteExclusion={id:"wood",name:"Wood",kind:"obstacle",x:900,y:900,z:0,dx:100,dy:100,dz:100,accessory:a};
const req:PackingRequest={mode:"mixed",workflow:"direct",strategy:"maximum",clearance:0,container:{...c,exclusions:[z]},products:[p]};
afterEach(()=>vi.unstubAllGlobals());
it("preserves old zero-mass regions and optional metadata",()=>{
 const old={...z,accessory:undefined};expect(parseSiteExclusions([old],c)![0].accessory).toBeUndefined();expect(containerAccessoryWeight({exclusions:[old]})).toBe(0);
 expect(parseSiteExclusions([z],c)![0].accessory).toEqual(a);
});
it("deducts the union once while quantity multiplies only mass",()=>{
 const reserved={...z,id:"install",kind:"reserved" as const,x:850,accessory:{...a,quantity:99,unitWeightKg:0}},container={...c,exclusions:[z,reserved]};
 expect(siteExcludedVolume(container,0)).toBe(1500000);expect(containerAccessoryWeight(container)).toBe(15);expect(siteExclusionBoxes(container,0).every(b=>b.weight===0)).toBe(true);
});
it.each([null,-1,NaN,Infinity,"10"])("rejects incomplete or invalid unit mass: %s",unitWeightKg=>{
 const bad={...z,accessory:{...a,unitWeightKg}};expect(()=>parseSiteExclusions([bad],c)).toThrow();
 if(unitWeightKg===null){expect(parseSiteExclusions([bad],c,true)![0].accessory!.unitWeightKg).toBeNull();expect(calculateReverseCounts({...req,container:{...c,exclusions:[bad as SiteExclusion]}},1,1).recommendedTotal).toBe(0);}
});
it("rejects reservation mass, invalid quantity, unknown metadata and malformed references",()=>{
 for(const bad of [{...z,kind:"reserved"},{...z,accessory:{...a,quantity:0}},{...z,accessory:{...a,quantity:1.5}},{...z,accessory:{...a,type:"load-bearing"}},{...z,accessory:{...a,relatedProductIds:["p","p"]}},{...z,accessory:{...a,note:"n".repeat(501)}}])expect(()=>parseSiteExclusions([bad],c)).toThrow();
});
it.each(["practical","maximum"] as const)("counts planned accessory mass once within payload (%s)",strategy=>{
 const plan=pack({...req,strategy});expect(plan.metrics.loadedCount).toBe(2);expect(plan.metrics.grossWeight).toBe(35);expect(plan.summaries[0].loadedWeight).toBe(20);expect(plan.placements.every(b=>b.productId==="p")).toBe(true);expect(auditPackingResult(plan,[p]).hasErrors).toBe(false);
 expect(analyzeLoads(plan,[p]).zones.reduce((n,z)=>n+z.weight,0)).toBeCloseTo(35);
});
it("independently rejects an extra carton and forged total mass",()=>{
 const baseline=pack({...req,container:{...c,maxWeight:1000,exclusions:[z]}});expect(validatePacking(baseline.placements,req.container,0,[p]).valid).toBe(false);
 const plan=pack(req);const altered=structuredClone(plan);altered.metrics.grossWeight-=15;expect(auditPackingResult(altered,[p]).hasErrors).toBe(true);
 expect(()=>pack({...req,container:{...c,maxWeight:14,exclusions:[z]}})).toThrow(/Accessory planned mass/);
});
it("reserves attachments and installation spaces for free-space probes, projections and access",()=>{
 const plan=pack(req),spaces=analyzeEmptySpaces(plan).spaces;expect(spaces.every(s=>!intersects(s,z))).toBe(true);expect(planProjection(plan,"top").shapes.some(s=>s.box.id==="site-exclusion/wood")).toBe(true);
 expect(probeEmptySpace(plan,[p],p.id,spaces).status).toBe("weight");
 const wall={...z,x:800,y:0,z:0,dx:200,dy:1000,dz:1000};const withWall=pack({...req,container:{...c,maxWeight:1000,exclusions:[wall]},products:[{...p,quantity:1}]});
 expect(auditAccess(withWall).issues.some(i=>i.obstacles.includes("site-exclusion/wood"))).toBe(true);
});
it("never uses accessory geometry as a supporting platform",()=>{
 const plan=pack({...req,container:{...c,length:200,width:200,height:400,doorWidth:200,doorHeight:400,maxWeight:100,exclusions:[{...z,x:0,y:0,dx:200,dy:200,dz:200}]}});expect(plan.placements).toHaveLength(0);expect(plan.metrics.grossWeight).toBe(15);expect(plan.validation.valid).toBe(true);
});
it("uses accessory mass in single capacity, arithmetic bounds and remaining payload at step zero",()=>{
 const plan=pack({...req,workflow:"single-capacity",mode:"single"});expect(plan.metrics.loadedCount).toBe(2);expect(plan.metrics.grossWeight).toBe(35);
 expect(calculateReverseCounts({...req,mode:"single"},1,1).recommendedTotal).toBe(2);
 expect(palletSpaceSummary(req.container,0,[],0,0).remainingWeight).toBe(20);
});
it("retains exact mass and updates envelope-center balance during edit and snapshot recovery",()=>{
 const plan=pack(req),weights=[...plan.placements,...accessoryMassBoxes(plan.container,0)],expected=weights.reduce((n,b)=>n+(b.x+b.dx/2)*b.weight,0)/35;
 expect(plan.metrics.centerOfGravity.x).toBeCloseTo(expected);
 const edit=revisePackingResult(plan,plan.placements,[p]);expect(edit.metrics.grossWeight).toBe(35);expect(edit.metrics.centerOfGravity.x).toBeCloseTo(expected);
 const restored=restorePackingSnapshot(req,plan);expect(restored.metrics.grossWeight).toBe(35);expect(restored.metrics.centerOfGravity.x).toBeCloseTo(expected);
});
it("does not clip planned mass away at safety margins or inflate it with zero-mass reservations",()=>{
 const edge={...z,x:0,y:0,dx:5,dy:5},plan=pack({...req,clearance:10,container:{...c,exclusions:[edge]}});
 expect(siteExclusionBoxes(plan.container,10)).toHaveLength(0);expect(plan.metrics.grossWeight).toBe(35);expect(analyzeLoads(plan,[p]).zones.reduce((n,z)=>n+z.weight,0)).toBeCloseTo(35);
});
it("orders dependencies and propagates missing cargo through dependent accessories",()=>{
 const first={...z,accessory:{...a,phase:"after-cargo" as const}},second={...z,id:"strap",accessory:{...a,quantity:1,unitWeightKg:0,phase:"after-cargo" as const,relatedProductIds:[],afterAccessoryIds:["wood"]}};
 expect(orderedAccessories([second,first]).map(v=>v.id)).toEqual(["wood","strap"]);
 const plan=pack({...req,container:{...c,exclusions:[second,first]}}),rows=accessoryInstallationPlan(plan);
 expect(rows[0].afterCargoStep).toBe(2);expect(rows[1].afterCargoStep).toBe(2);expect(rows.map(r=>r.missingProductIds)).toEqual([["p"],["p"]]);expect(reviewPlan(plan,[p]).checks.find(c=>c.id==="securing")!.state).toBe("unverified");
});
it("rejects cycles, dangling edges and before-cargo dependencies on after-cargo",()=>{
 const other={...z,id:"other",accessory:{...a,afterAccessoryIds:["wood"]}};
 for(const rows of [[{...z,accessory:{...a,afterAccessoryIds:["wood"]}}],[{...z,accessory:{...a,afterAccessoryIds:["other"]}},other],[{...z,accessory:{...a,afterAccessoryIds:["missing"]}}],[{...z,accessory:{...a,afterAccessoryIds:["other"]}},{...other,accessory:{...a,phase:"after-cargo",afterAccessoryIds:[]}}]])expect(()=>parseSiteExclusions(rows,c)).toThrow();
});
it("rejects deleted product links and pallet-only workflows without vehicle coordinates",()=>{
 const bad={...req,container:{...c,exclusions:[{...z,accessory:{...a,relatedProductIds:["deleted"]}}]}};
 expect(()=>pack(bad)).toThrow(/Unknown accessory/);expect(()=>packLoadingWorkflow(bad)).toThrow(/Unknown accessory/);expect(()=>packLoadingWorkflow({...req,workflow:"pallet-only",palletBuild:DEFAULT_PALLET_BUILD})).toThrow();
});
it("keeps complete pallet cargo, tare and accessory mass separated",()=>{
 const config={...DEFAULT_PALLET_BUILD.config,length:400,width:400,height:100,weight:5,maxLoad:100,maxCargoHeight:200},request={...req,workflow:"palletized" as const,container:{...c,maxWeight:60,exclusions:[z]},products:[{...p,quantity:4}],palletBuild:{...DEFAULT_PALLET_BUILD,config,maxPallets:2}};
 const plan=packLoadingWorkflow(request);expect(plan.validation.valid).toBe(true);expect(plan.metrics.loadedCount).toBe(4);expect(plan.pallets).toHaveLength(1);expect(plan.metrics.grossWeight).toBe(60);expect(plan.pallets![0].weight).toBe(5);expect(auditPackingResult(plan,request.products).hasErrors).toBe(false);
});
it("round-trips both strategies and rejects tampered accessory mass or geometry",()=>{
 const plan=packWithComparison(req),inputs={...req,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
 const backup=serializeWorkspaceBackup(inputs,"0.36.0",plan,plan.strategyPlans),parsed=parseWorkspaceBackup(backup),restored=restoreWorkspacePlans(backup,parsed)!;expect(parsed.container.exclusions![0].accessory).toEqual(a);expect(restored.metrics.grossWeight).toBe(35);expect(restored.strategyPlans!.practical!.metrics.grossWeight).toBe(35);
 const bad=JSON.parse(backup);bad.inputs.container.exclusions[0].accessory.unitWeightKg=-1;expect(()=>parseWorkspaceBackup(JSON.stringify(bad))).toThrow();
 const altered=structuredClone(plan);altered.container.exclusions![0].accessory!.revision="r2";expect(fieldPlanFingerprint(altered)).not.toBe(fieldPlanFingerprint(plan));
});
it("exports separate planned masses with consistent row widths and final dimension columns",()=>{
 const plan=pack(req);plan.dimensionScenario={id:"nominal",kind:"nominal",proxyProductIds:[]};const rows=parseCsvRecords(buildPlacementCsv(plan));expect(rows.every(r=>r.length===rows[0].length)).toBe(true);expect(rows[0].slice(-2)).toEqual(["尺寸方案ID","尺寸口径"]);const row=rows.find(r=>r[15]==="site-exclusion")!;expect(row[14]).toBe("15");expect(row.join()).toContain('"quantity":2');
 const list=parseCsvRecords(buildContainerAccessoryCsv(plan,true));expect(list[1][8]).toBe("15");expect(list[0]).toContain("Planned unit kg");expect(list.every(r=>r.length===list[0].length)).toBe(true);
});
it("escapes material data and exposes planned/unverified scope in customer and offline reports",()=>{
 const plan=pack({...req,container:{...c,exclusions:[{...z,name:"<wood>",accessory:{...a,source:"<source>",note:"<script>bad</script>"}}]}}),report=customerReport(plan,[p],{language:"en",customer:"C",order:"O",currency:"USD",freight:null});
 expect(report).toContain('data-container-accessories="1"');expect(report).toContain("&lt;source&gt;");expect(report).not.toContain("<script>bad");expect(report).toContain("securing strength remain unverified");expect(offlineFieldHtml(plan,[p])).toContain("整柜附件与安装清单");
});
it("keeps accessory PDF rows within page bounds and exposes truncation scope",async()=>{
 const plan=pack({...req,container:{...c,exclusions:[{...z,accessory:{...a,source:"S".repeat(500),note:"N".repeat(500)}}]}}),texts:{v:string;x:number;y:number}[]=[];
 const ctx={fillText:(v:string,x:number,y:number)=>texts.push({v,x,y}),measureText:(v:string)=>({width:v.length*13}),fillRect:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),stroke:vi.fn(),fill:vi.fn()};
 vi.stubGlobal("document",{fonts:{ready:Promise.resolve()},createElement:(tag:string)=>tag==="canvas"?{getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([new Uint8Array([255,216,255,217])]))}:{click:vi.fn()}});vi.stubGlobal("URL",{createObjectURL:()=>"blob:test",revokeObjectURL:vi.fn()});vi.stubGlobal("setTimeout",vi.fn());await downloadPdfGuide(plan,"en",[p]);
 expect(texts.some(t=>t.v.includes("Container accessories and installation dependencies"))).toBe(true);expect(texts.some(t=>t.v.includes("workspace / accessory CSV"))).toBe(true);expect(texts.filter(t=>t.v.includes("SSSS")).every(t=>t.v.length*13<=1500&&t.y<2260)).toBe(true);
});
it("localizes all accessory diagnostics without treating user notes as translations",()=>{
 for(const trigger of [()=>parseSiteExclusions([{...z,accessory:{...a,unitWeightKg:null}}],c),()=>parseSiteExclusions([{...z,accessory:{...a,afterAccessoryIds:["wood"]}}],c),()=>parseSiteExclusions([{...z,accessory:{...a,afterAccessoryIds:["missing"]}}],c),()=>pack({...req,container:{...c,maxWeight:1,exclusions:[z]}}),()=>pack({...req,container:{...c,exclusions:[{...z,accessory:{...a,relatedProductIds:["missing"]}}]}})]){
  try{trigger();throw Error("expected rejection");}catch(e){expect(translateDiagnostic((e as Error).message,"en")).not.toMatch(/[\u3400-\u9fff]/u);}
 }
 const plan=pack(req);expect(translateDiagnostic(plan.warnings.find(v=>v.includes("Site regions constrain"))!,"en")).not.toMatch(/[\u3400-\u9fff]/u);
});
