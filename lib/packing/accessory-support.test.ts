import {afterEach,expect,it,vi} from "vitest";
import {pack,packWithComparison,restorePackingSnapshot,revisePackingResult,validatePacking,improvePacking,diagnoseUnloadedPosition} from "./engine";
import {parseSiteExclusions,siteExclusionBoxes,siteExcludedVolume} from "./site-exclusions";
import {accessorySupportGeometry,inspectAccessorySupports} from "./accessory-support";
import {inspectLongSupport} from "./long-support";
import {containerAccessoryWeight} from "./container-accessories";
import {packLoadingWorkflow} from "./pack-loading";
import {palletizeThenPack} from "./palletize";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {auditPackingResult} from "./result-audit";
import {reviewPlan} from "./plan-review";
import {analyzeLoads} from "./load-analysis";
import {analyzeEmptySpaces,probeEmptySpace} from "./free-space";
import {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans} from "./workspace-file";
import {buildPlacementCsv,buildContainerAccessoryCsv,parseCsvRecords} from "./csv";
import {customerReport,offlineFieldHtml} from "./field-report";
import {downloadPdfGuide} from "./pdf-guide";
import {translateDiagnostic} from "./translate-ui";
import type {SiteExclusion} from "./site-exclusions";
import type {PackingRequest,ProductInput} from "./types";
const z:SiteExclusion={id:"wood",name:"QA solid timber",kind:"obstacle",x:0,y:0,z:0,dx:200,dy:200,dz:100,accessory:{type:"timber",quantity:1,unitWeightKg:5,phase:"before-cargo",relatedProductIds:[],afterAccessoryIds:[],source:"Synthetic QA fixture",revision:"QA42",note:"Not field data",support:{version:1,surface:"solid-rectangle",maxLoadKg:20}}};
const p:ProductInput={id:"p",sku:"QA-P",name:"QA-P",length:200,width:200,height:100,weight:10,quantity:3,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const c={id:"qa",name:"QA",length:200,width:200,height:400,doorWidth:200,doorHeight:400,maxWeight:100,exclusions:[z]};
const request:PackingRequest={workflow:"direct",mode:"mixed",strategy:"maximum",container:c,products:[p],clearance:0};
const change=(patch:Partial<NonNullable<SiteExclusion['accessory']>>):PackingRequest=>({...request,container:{...c,exclusions:[{...z,accessory:{...z.accessory!,...patch}}]}});
afterEach(()=>vi.unstubAllGlobals());
it.each(["maximum","practical"] as const)("uses actual thickness and cumulative limit in %s",strategy=>{
 const plan=pack({...request,strategy});expect(plan.validation.valid).toBe(true);expect(plan.placements.map(b=>b.z)).toEqual([100,200]);expect(plan.placements.map(b=>b.layer)).toEqual([1,2]);expect(plan.metrics.grossWeight).toBe(25);expect(plan.metrics.loadedCount).toBe(2);expect(plan.metrics.loadedVolume).toBe(8000000);expect(plan.metrics.effectiveVolume).toBe(12000000);expect(plan.summaries).toHaveLength(1);expect(plan.metrics.executionComplexity.partialSupportCount).toBe(0);
 expect(inspectAccessorySupports(plan,[p])[0]).toMatchObject({state:"pass",loadKg:20,limitKg:20});expect(auditPackingResult(plan,[p]).hasErrors).toBe(false);expect(analyzeLoads(plan,[p]).zones.reduce((n,z)=>n+z.weight,0)).toBeCloseTo(25);
});
it("keeps legacy obstacles non-supporting even when named timber",()=>{expect(pack(change({support:undefined})).placements).toHaveLength(0);expect(containerAccessoryWeight(c)).toBe(5);expect(siteExcludedVolume(c,0)).toBe(4000000);expect(accessorySupportGeometry(c,0).boxes[0].weight).toBe(0);expect(siteExclusionBoxes(c,0)[0].color).toBe("#348566");});
it("distinguishes unknown ratings from a hard zero and enforces numeric limits without provenance",()=>{
 const unknown=pack(change({support:{...z.accessory!.support!,maxLoadKg:null}}));expect(unknown.placements).toHaveLength(3);expect(inspectAccessorySupports(unknown,[p])[0].state).toBe("unverified");expect(reviewPlan(unknown,[p]).checks.find(c=>c.id==="bearing")!.state).toBe("unverified");
 expect(pack(change({support:{...z.accessory!.support!,maxLoadKg:0}})).placements).toHaveLength(0);
 const missing=pack(change({source:""}));expect(missing.placements).toHaveLength(2);expect(inspectAccessorySupports(missing,[p])[0].state).toBe("unverified");
});
it.each([{quantity:2},{phase:"after-cargo"},{type:"airbag"},{type:"strap"},{type:"desiccant"}])("rejects non-solid declarations %j",patch=>{const r=change(patch as Partial<NonNullable<SiteExclusion['accessory']>>);expect(()=>pack(r)).toThrow();expect(parseSiteExclusions(r.container.exclusions,c,true)).toHaveLength(1);});
it.each([-1,NaN,Infinity,"20",undefined])("rejects malformed support rating %s",maxLoadKg=>{expect(()=>pack(change({support:{...z.accessory!.support!,maxLoadKg} as never}))).toThrow();});
it("rejects floating supports, overlapping solids and support reservations while allowing touching faces",()=>{
 for(const exclusions of [[{...z,z:1}],[z,{...z,id:"overlap",accessory:undefined,x:100}],[{...z,kind:"reserved",accessory:{...z.accessory!,unitWeightKg:0}}]])expect(()=>parseSiteExclusions(exclusions,{...c,length:400})).toThrow();
 expect(parseSiteExclusions([z,{...z,id:"next",x:200}],{...c,length:400})).toHaveLength(2);
});
it("does not create a false top surface when ceiling clearance clips a support",()=>{const r={...request,container:{...c,height:110,doorHeight:110},clearance:20};expect(accessorySupportGeometry(r.container,20).boxes).toHaveLength(0);expect(()=>pack(r)).toThrow(/entire usable space/);});
it.each(["single","mixed"] as const)("routes %s search through support constraints",mode=>{const plan=pack({...request,mode,workflow:mode==="single"?"single-capacity":"direct",singleCartonLimit:3});expect(plan.placements).toHaveLength(2);expect(plan.validation.valid).toBe(true);});
it("independently rejects excessive cumulative load and forged anchors",()=>{
 const unrestricted=pack(change({support:{...z.accessory!.support!,maxLoadKg:null}}));expect(validatePacking(unrestricted.placements,c,0,[p]).valid).toBe(false);
 const plan=pack(request),fake={...plan.placements[0],id:"site-exclusion/fake",supportOnly:true};expect(validatePacking([fake],c,0,[p]).valid).toBe(false);expect(()=>pack({...request,products:[{...p,id:"site-exclusion/wood"}]})).toThrow();
 const forged=structuredClone(unrestricted);forged.validation={valid:true,errors:[]};expect(()=>restorePackingSnapshot(request,forged)).toThrow();
});
it("preserves fixed geometry, counts, weight and locks in edits and optimization",()=>{
 const plan=pack(request);plan.placements[0].locked=true;const before=JSON.stringify(plan);
 expect(()=>revisePackingResult(plan,plan.placements.map((b,i)=>i?{...b,x:1}:b),[p])).toThrow();expect(JSON.stringify(plan)).toBe(before);
 const revised=revisePackingResult(plan,plan.placements,[p]);expect(revised.metrics.grossWeight).toBe(25);expect(revised.placements.map(b=>b.layer)).toEqual([1,2]);
 const better=improvePacking(plan,[p],0);expect(better.metrics.grossWeight).toBe(25);expect(better.placements.find(b=>b.id===plan.placements[0].id)).toMatchObject(plan.placements[0]);
});
it("keeps complete kits atomic and rebuilds support indexes after failed kit rollback",()=>{
 const kit={...p,length:200,width:200,height:100,quantity:1,setCode:"KIT",unitsPerSet:1},other={...kit,id:"q",sku:"Q"},loose={...p,id:"loose",sku:"LOOSE",quantity:1,weight:5,priority:1};
 const r={...change({support:{...z.accessory!.support!,maxLoadKg:15}}),products:[kit,other,loose]},plan=pack(r);expect(plan.validation.valid).toBe(true);expect(plan.placements.map(b=>b.productId)).toEqual(["loose"]);expect(plan.metrics.grossWeight).toBe(10);
});
it("retains direct support with floor pallets and requires separate prebuilt-unit rules",()=>{
 expect(()=>packLoadingWorkflow({...request,workflow:"palletized",palletBuild:DEFAULT_PALLET_BUILD})).toThrow(/direct cargo/);expect(()=>palletizeThenPack(request,DEFAULT_PALLET_BUILD.config,"single")).toThrow(/direct cargo/);const plan=pack({...request,container:{...c,length:400},floorPallets:{...DEFAULT_PALLET_BUILD.config,length:200,width:200,height:50,gap:0,count:1}});expect(plan.validation.valid).toBe(true);expect(plan.pallets?.[0].x).toBeGreaterThanOrEqual(z.dx);
});
it("uses actual two-end timber contact and bounds each support by the complete load",()=>{
 const q={...p,length:1000,width:100,quantity:1,minimumSupportRatio:.4,longSupport:{version:1 as const,dimensions:{length:1000,width:100,height:100},axis:"L" as const,bands:[{start:0,end:200},{start:800,end:1000}],minimumContactRatio:1,maxSpanMm:600,maxOverhangMm:0,source:"QA geometry",revision:"42"}},a={...z,dy:100},b={...a,id:"end",x:800};
 const r={...request,container:{...c,length:1000,width:100,height:200,doorWidth:100,doorHeight:200,exclusions:[a,b]},products:[q]},plan=pack(r);
 expect(plan.placements).toHaveLength(1);expect(inspectLongSupport(plan,[q])[0]).toMatchObject({state:"pass",spanMm:600,overhangMm:[0,0]});expect(inspectAccessorySupports(plan,[q]).map(r=>r.loadKg)).toEqual([10,10]);
 expect(pack({...r,products:[{...q,longSupport:{...q.longSupport,maxSpanMm:599}}]}).placements).toHaveLength(0);
 expect(pack({...r,products:[{...q,minimumSupportRatio:.995}]}).placements).toHaveLength(0);
 const unknown=pack({...r,container:{...r.container,exclusions:[{...a,accessory:{...a.accessory!,source:""}},b]}});expect(inspectLongSupport(unknown,[q])[0].state).toBe("unverified");
});
it("probes free space on support tops through the same full validator",()=>{
 const plan=pack({...request,products:[{...p,quantity:1}]});const spaces=analyzeEmptySpaces(plan).spaces;expect(probeEmptySpace(plan,[p],p.id,spaces).status).toBe("fits");
 const capped={...plan,container:{...c,exclusions:[{...z,accessory:{...z.accessory!,support:{...z.accessory!.support!,maxLoadKg:10}}}]}};expect(probeEmptySpace(capped,[p],p.id,spaces).status).toBe("not-found");expect(diagnoseUnloadedPosition(plan,[p],p.id).candidate?.z).toBeGreaterThanOrEqual(200);
});
it("round-trips both strategies and rejects a changed support cap despite saved pass flags",()=>{
 const plan=packWithComparison(request),inputs={...request,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
 const text=serializeWorkspaceBackup(inputs,"0.42.0",plan,plan.strategyPlans),parsed=parseWorkspaceBackup(text),restored=restoreWorkspacePlans(text,parsed)!;expect(restored.container.exclusions![0]).toEqual(z);expect(restored.metrics.grossWeight).toBe(25);expect(restored.strategyPlans!.practical!.placements).toHaveLength(2);
 const tampered=JSON.parse(text);tampered.inputs.container.exclusions[0].accessory.support.maxLoadKg=0;const raw=JSON.stringify(tampered);expect(()=>restoreWorkspacePlans(raw,parseWorkspaceBackup(raw))).toThrow();
});
it("exports support declarations and current cumulative load without adding cargo rows",()=>{
 const plan=pack(request),rows=parseCsvRecords(buildPlacementCsv(plan));expect(rows.every(r=>r.length===rows[0].length)).toBe(true);expect(rows.filter(r=>r[15]==="site-exclusion")).toHaveLength(1);expect(rows.find(r=>r[15]==="site-exclusion")!.join()).toContain('"maxLoadKg":20');
 const csv=parseCsvRecords(buildContainerAccessoryCsv(plan,true,[p]));expect(csv.every(r=>r.length===csv[0].length)).toBe(true);expect(csv[1].slice(-3)).toEqual([JSON.stringify(z.accessory!.support),"20","Entered static load check passed"]);
 for(const html of [customerReport(plan,[p],{language:"en",customer:"QA",order:"QA",currency:"USD",freight:null}),offlineFieldHtml(plan,[p])]){expect(html).toContain('data-accessory-supports="1"');expect(html).toContain("20.00");expect(html).not.toContain("Orange obstacles and purple reservations provide no cargo support");}
});
it("paginates support PDF evidence without overflowing and retains unverified scope",async()=>{
 const plan=pack({...request,container:{...c,length:3400,exclusions:Array.from({length:16},(_,i)=>({...z,id:`wood-${i}`,x:i*200}))}}),texts:{v:string;y:number}[]=[];
 const ctx={fillText:(v:string,x:number,y:number)=>texts.push({v,y}),measureText:(v:string)=>({width:v.length*13}),fillRect:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),stroke:vi.fn(),fill:vi.fn()};
 vi.stubGlobal("document",{fonts:{ready:Promise.resolve()},createElement:(tag:string)=>tag==="canvas"?{getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([new Uint8Array([255,216,255,217])]))}:{click:vi.fn()}});vi.stubGlobal("URL",{createObjectURL:()=>"blob:test",revokeObjectURL:vi.fn()});vi.stubGlobal("setTimeout",vi.fn());await downloadPdfGuide(plan,"en",[p]);
 expect(texts.some(t=>t.v==="Fixed support static load check")).toBe(true);expect(texts.filter(t=>t.v==="Fixed support static load check")).toHaveLength(2);expect(texts.filter(t=>t.v.includes("Cumulative upper / entered limit")||t.v.includes("QA solid timber")).every(t=>t.y<2260)).toBe(true);
});
it("localizes support validation and warning diagnostics",()=>{
 for(const trigger of [()=>pack(change({quantity:2})),()=>pack({...request,container:{...c,exclusions:[{...z,z:1}]}}),()=>packLoadingWorkflow({...request,workflow:"palletized"})]){try{trigger();throw Error("expected rejection");}catch(e){expect(translateDiagnostic((e as Error).message,"en")).not.toMatch(/[\u3400-\u9fff]/u);}}
 expect(translateDiagnostic(pack(request).warnings.find(w=>w.includes("Declared solid floor supports"))!,"en")).not.toMatch(/[\u3400-\u9fff]/u);
});
