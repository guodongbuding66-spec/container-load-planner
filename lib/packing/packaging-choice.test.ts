import {expect,it} from "vitest";
import {choosePackaging,parsePackagingChoices,packagingSelectionNotes,type PackagingCandidate} from "./packaging-choice";
import {customerReport,offlineFieldHtml} from "./field-report";
import {packLoadingWorkflow} from "./pack-loading";
import {DEFAULT_PALLET_BUILD,parsePalletBuild} from "./loading-workflow";
import {DEFAULT_PACKAGING} from "./packaging";
import {restorePackingSnapshot} from "./engine";
import {auditPackingResult} from "./result-audit";
import {editPalletContents} from "./pallet-edit";
import {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans} from "./workspace-file";
import {buildPlacementCsv,parseCsvRecords} from "./csv";
import type {PackingRequest,PalletBuildOptions,ProductInput} from "./types";
const cargo:ProductInput={id:"c",sku:"C",name:"C",length:400,width:400,height:200,weight:10,quantity:5,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const big={...DEFAULT_PALLET_BUILD.config,name:"Big",length:800,width:800,height:100,weight:20,maxCargoHeight:200};
const small={id:"small",config:{...big,name:"Small",length:400,width:400,height:50,weight:8},maxPallets:10,stackLayers:1,maxTopLoadKg:0};
const build:PalletBuildOptions={...DEFAULT_PALLET_BUILD,config:big,maxPallets:20,selection:"compact",primaryRule:{maxPallets:20},additionalSpecs:[small]};
const request:PackingRequest={workflow:"pallet-only",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"v",name:"V",length:4000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:2000},products:[cargo],palletBuild:build};
const candidate=(id:string,patch:Partial<PackagingCandidate>={}):PackagingCandidate=>({specificationId:id,cartons:1,loads:{"sku:a":1},exterior:[1000,800,300],tareKg:20,...patch});
it.each(["practical","maximum"] as const)("fills a large unit then assigns the tail to a smaller package (%s)",strategy=>{
 const p=packLoadingWorkflow({...request,strategy}),ordered=packLoadingWorkflow({...request,strategy,palletBuild:{...build,selection:"ordered"}});
 expect(p.validation.errors).toEqual([]);expect(p.placements).toHaveLength(5);expect(p.pallets!.map(p=>p.specificationId)).toEqual(["primary","small"]);expect(p.metrics.grossWeight).toBe(78);expect(ordered.metrics.grossWeight).toBe(90);expect(p.palletization!.preparedBySpecification).toEqual({primary:1,small:1});expect(p.metrics.effectiveVolume).toBeLessThan(ordered.metrics.effectiveVolume);expect(auditPackingResult(p,[cargo]).hasErrors).toBe(false);
 expect(p.palletization!.selectionChoices!.map(c=>c.reason)).toEqual(["priority-load","smaller-envelope"]);expect(p.palletization!.selectionChoices![1].candidates.map(c=>c.cartons)).toEqual([1,1]);
});
it("retains required high-priority units even when another candidate carries more low-priority cartons",()=>{
 const a={...cargo,quantity:2,priority:100,mustLoad:true},b={...cargo,id:"b",sku:"B",length:100,width:100,quantity:20,priority:1,mustLoad:false};
 const p=packLoadingWorkflow({...request,products:[a,b],palletBuild:{...build,mix:"mixed",maxPallets:1,config:{...big,width:400},additionalSpecs:[{...small,config:{...small.config,length:400,width:600}}]}});
 expect(p.summaries.find(s=>s.productId===a.id)!.loaded).toBe(2);expect(p.pallets![0].specificationId).toBe("primary");const note=p.palletization!.selectionChoices![0];expect(note.candidates.find(c=>c.specificationId==="small")!.cartons).toBeGreaterThan(note.candidates[0].cartons);expect(note.reason).toBe("priority-load");
});
it("compares whole 1:2 kits rather than treating extra components as complete units",()=>{
 const a={...cargo,length:200,width:200,height:100,quantity:3,setCode:"KIT",unitsPerSet:1},b={...a,id:"b",sku:"B",length:100,width:100,quantity:7,weight:5,unitsPerSet:2};
 const p=packLoadingWorkflow({...request,products:[a,b],palletBuild:{...build,config:{...big,length:400,width:300,maxCargoHeight:100},additionalSpecs:[{...small,config:{...small.config,length:200,width:300,maxCargoHeight:100}}]}});
 expect(p.setSummaries[0].loadedSets).toBe(3);expect(p.summaries.find(s=>s.productId==="b")!.unloaded).toBe(1);expect(p.pallets!.map(p=>p.specificationId)).toEqual(["primary","small"]);
 const refs=new Map<string,Set<string>>();for(const b of p.placements){const key=`${b.setCode}/${b.setNumber}`,ids=refs.get(key)??new Set<string>();for(const id of b.palletIds??[])ids.add(id);refs.set(key,ids);}expect([...refs.values()].every(ids=>ids.size===1)).toBe(true);expect(auditPackingResult(p,[a,b]).hasErrors).toBe(false);
});
it("honors independent stock, SKU permissions and payload when comparing tails",()=>{
 for(const alternative of [{...small,maxPallets:0},{...small,productIds:["other"]},{...small,config:{...small.config,maxLoad:5}}]){
  const products="productIds" in alternative?[cargo,{...cargo,id:"other",sku:"OTHER",quantity:0}]:[cargo];const p=packLoadingWorkflow({...request,products,palletBuild:{...build,additionalSpecs:[alternative]}});expect(p.placements).toHaveLength(5);expect(p.pallets!.every(p=>p.specificationId==="primary")).toBe(true);
 }
 const p=packLoadingWorkflow({...request,palletBuild:{...build,primaryRule:{maxPallets:0},additionalSpecs:[{...small,maxPallets:3}]}});expect(p.placements).toHaveLength(3);expect(p.summaries[0].unloaded).toBe(2);expect(p.palletization!.preparedBySpecification).toEqual({primary:0,small:3});
});
it("filters complete units that cannot pass the door before scoring their cargo",()=>{
 const p=packLoadingWorkflow({...request,workflow:"palletized",container:{...request.container,width:500,doorWidth:500}});expect(p.placements).toHaveLength(5);expect(p.pallets!.every(p=>p.specificationId==="small")).toBe(true);expect(auditPackingResult(p,[cargo]).hasErrors).toBe(false);
});
it("uses fixed crate exterior, net interior and full tare without unlocking crate stacking",()=>{
 const crate={...small,config:{...small.config,length:500,width:500,weight:30,packaging:{...DEFAULT_PACKAGING,enclosure:"panel" as const,wallThickness:50}}};
 const p=packLoadingWorkflow({...request,palletBuild:{...build,additionalSpecs:[crate]}});expect(p.placements).toHaveLength(5);expect(p.pallets![1].enclosureHeight).toBe(300);expect(p.pallets![1].z).toBe(0);expect(p.metrics.grossWeight).toBe(100);expect(auditPackingResult(p,[cargo]).hasErrors).toBe(false);
});
it("uses footprint, tare and stable source order only after priority loads and volume tie",()=>{
 const a=candidate("a"),b=candidate("b",{exterior:[800,500,600]});expect(choosePackaging([a,b],["sku:a"]).reason).toBe("smaller-footprint");
 const light=candidate("light",{tareKg:10});expect(choosePackaging([a,light],["sku:a"]).candidate.specificationId).toBe("light");expect(choosePackaging([a,light],["sku:a"]).reason).toBe("lower-tare");expect(choosePackaging([a,candidate("b")],["sku:a"]).reason).toBe("stable-order");
});
it("round-trips the selection mode, quantities and descriptive comparisons through both strategy backups and CSV",()=>{
 const maximum=packLoadingWorkflow(request),practical=packLoadingWorkflow({...request,strategy:"practical"});const inputs={...request,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:95,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
 const file=serializeWorkspaceBackup(inputs,"0.33.0",maximum,{maximum,practical}),parsed=parseWorkspaceBackup(file),p=restoreWorkspacePlans(file,parsed)!;expect(parsed.palletBuild!.selection).toBe("compact");for(const strategy of ["maximum","practical"] as const){expect(p.strategyPlans![strategy]!.palletization!.selectionChoices).toEqual(({maximum,practical})[strategy].palletization!.selectionChoices);expect(p.strategyPlans![strategy]!.metrics.grossWeight).toBe(78);}
 const rows=parseCsvRecords(buildPlacementCsv(p));expect(rows[0].slice(-2)).toEqual(["包装比选模式","生成时比选记录JSON"]);expect(rows.slice(1).every(r=>r.at(-2)==="compact"&&!!JSON.parse(r.at(-1)!))).toBe(true);expect(rows.every(r=>r.length===rows[0].length)).toBe(true);
});
it("rejects mismatched source mode, selected packaging and altered selected quantities",()=>{
 const p=packLoadingWorkflow(request);expect(()=>restorePackingSnapshot({...request,palletBuild:{...build,selection:"ordered"}},p)).toThrow(/selection mode/);
 for(const mutate of [(v:typeof p)=>v.palletization!.selectionChoices![0].chosenSpecificationId="small",(v:typeof p)=>v.palletization!.selectionChoices![0].candidates[0].cartons++,(v:typeof p)=>v.palletization!.selectionChoices![0].candidates[0].exterior[0]++]){const v=structuredClone(p);mutate(v);expect(()=>restorePackingSnapshot(request,v)).toThrow();}
});
it("clears generation comparisons after editing cargo instead of presenting stale choices",()=>{
 const p=packLoadingWorkflow(request),b=p.placements.find(b=>b.palletIds?.includes(p.pallets![1].id))!,edited=editPalletContents(p,[cargo],p.pallets![1].id,{type:"remove",ids:[b.id]});expect(edited.palletization!.selection).toBe("compact");expect(edited.palletization!.selectionChoices).toBeUndefined();expect(p.palletization!.selectionChoices).toHaveLength(2);expect(edited.metrics.requestedCount).toBe(5);expect(edited.metrics.loadedCount).toBe(4);
});
it("keeps old input in ordered mode and validates bounded comparison records",()=>{
 expect(parsePalletBuild(DEFAULT_PALLET_BUILD).selection).toBeUndefined();expect(()=>parsePalletBuild({...build,selection:"unknown"})).toThrow();const p=packLoadingWorkflow(request),notes=p.palletization!.selectionChoices!;expect(parsePackagingChoices(notes,new Set(["primary","small"]))).toEqual(notes);expect(()=>parsePackagingChoices([...notes,...notes],new Set(["primary","small"]))).toThrow();
});
it("excludes complete units above vehicle payload before comparing smaller candidates",()=>{
 const p=packLoadingWorkflow({...request,workflow:"palletized",container:{...request.container,maxWeight:25}});
 expect(p.pallets!.length).toBeGreaterThan(0);expect(p.pallets!.every(p=>p.specificationId==="small")).toBe(true);expect(p.metrics.grossWeight).toBeLessThanOrEqual(25);expect(p.validation.errors).toEqual([]);
});

it("retains comparison scope in delivery reports and dimension CSV without mixing metrics",()=>{
 const p=packLoadingWorkflow(request),meta={language:"en" as const,customer:"Customer",order:"Order",currency:"USD",freight:null};
 const html=customerReport(p,[cargo],meta);expect(html).toContain('data-packaging-selection="compact"');expect(html).toContain("no global minimum-unit or cost guarantee");expect(html.match(/<article data-packaging-selection="compact">(.*?)<\/article>/)?.[1]).not.toMatch(/[\u3400-\u9fff]/u);expect(offlineFieldHtml(p,[cargo])).toContain("逐托自动比选");
 const notes=packagingSelectionNotes(p,true);expect(notes).toHaveLength(3);expect(notes[2]).toContain("2 generation records");expect(packagingSelectionNotes({...p,palletization:{...p.palletization!,selectionChoices:undefined}},true)[2]).toContain("cleared or unavailable");
 const scenario={...p,dimensionScenario:{id:"scenario",kind:"nominal" as const,proxyProductIds:[]}},rows=parseCsvRecords(buildPlacementCsv(scenario));
 expect(rows[0].slice(-4)).toEqual(["包装比选模式","生成时比选记录JSON","尺寸方案ID","尺寸口径"]);expect(rows.every(r=>r.length===rows[0].length)).toBe(true);expect(rows[1].slice(-2)).toEqual(["scenario","nominal"]);
});
