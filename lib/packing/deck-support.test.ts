import {expect,it} from "vitest";
import {DEFAULT_PACKAGING,packagingReservedVolume,placedPackagingParts,packagingMassCenter} from "./packaging";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {packLoadingWorkflow} from "./pack-loading";
import {inspectDeckSupports,palletDeckSupportGeometry,completePackagingTare,type DeckSupport} from "./deck-support";
import {auditPackingResult} from "./result-audit";
import {validatePacking,restorePackingSnapshot} from "./engine";
import {parseFloorPalletConfig} from "./floor-pallets";
import {editPlan} from "./plan-edit";
import {editPalletContents,palletLocalBox,palletWorldBox} from "./pallet-edit";
import type {FloorPalletConfig,PackingRequest,ProductInput} from "./types";
const s:DeckSupport={id:"wood",name:"QA timber",x:0,y:0,dx:200,dy:200,dz:50,weightKg:5,maxLoadKg:20,source:"Synthetic fixture",revision:"QA43"};
const config:FloorPalletConfig={...DEFAULT_PALLET_BUILD.config,length:200,width:200,height:100,weight:5,maxLoad:30,maxCargoHeight:350,packaging:{...DEFAULT_PACKAGING,base:"solid",deckSupports:[s]}};
const p:ProductInput={id:"p",sku:"P",name:"P",length:200,width:200,height:100,weight:10,quantity:3,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const request:PackingRequest={mode:"mixed",workflow:"pallet-only",strategy:"maximum",clearance:0,products:[p],container:{id:"c",name:"C",length:1000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:10000},palletBuild:{...DEFAULT_PALLET_BUILD,config,maxPallets:1}};
const make=(r:Partial<PackingRequest>={})=>packLoadingWorkflow({...request,...r});
it.each(["practical","maximum"] as const)("builds physical support height and cumulative limits in %s",strategy=>{
 const plan=make({strategy});expect(plan.validation.valid).toBe(true);expect(plan.placements).toHaveLength(2);expect(plan.placements.map(b=>b.z)).toEqual([150,250]);expect(plan.pallets![0].weight).toBe(10);expect(plan.metrics.grossWeight).toBe(30);expect(plan.metrics.loadedVolume).toBe(14000000);expect(plan.placements.map(b=>b.layer)).toEqual([1,2]);expect(inspectDeckSupports(plan,[p])[0]).toMatchObject({loadKg:20,state:"pass",limitKg:20});expect(auditPackingResult(plan,[p]).hasErrors).toBe(false);expect(plan.metrics.executionComplexity.partialSupportCount).toBe(0);
});
it("keeps real part volume and total mass once",()=>{const plan=make(),pallet=plan.pallets![0];expect(completePackagingTare(config)).toBe(10);expect(packagingReservedVolume(pallet)).toBe(6000000);expect(placedPackagingParts(pallet).filter(p=>p.kind==="support")).toHaveLength(1);expect(palletDeckSupportGeometry([pallet]).boxes[0].weight).toBe(0);expect(packagingMassCenter(pallet)[2]).toBeCloseTo(87.5);});
it("loads complete supported units into a vehicle",()=>{const plan=make({workflow:"palletized"});expect(plan.validation.valid).toBe(true);expect(plan.placements.every(b=>b.z>=150)).toBe(true);expect(plan.metrics.grossWeight).toBe(30);});
it("rejects cargo inside the support volume during independent check and restore",()=>{const plan=make(),b=plan.placements.map((b,i)=>i?b:{...b,z:100});expect(validatePacking(b,plan.container,0,[p],"maximum","mixed",plan.pallets,undefined,plan.palletization).valid).toBe(false);expect(()=>restorePackingSnapshot(request,{...plan,placements:b})).toThrow();});
it("includes attached mass in the pallet payload limit",()=>{const c={...config,maxLoad:24,packaging:{...config.packaging!,deckSupports:[{...s,maxLoadKg:null}]}};expect(make({palletBuild:{...request.palletBuild!,config:c}}).placements).toHaveLength(1);});
it("distinguishes missing and zero load limits",()=>{const c={...config,maxLoad:100,packaging:{...config.packaging!,deckSupports:[{...s,maxLoadKg:null}]}};const unknown=make({palletBuild:{...request.palletBuild!,config:c}});expect(unknown.placements).toHaveLength(3);expect(inspectDeckSupports(unknown,[p])[0].state).toBe("unverified");expect(()=>make({palletBuild:{...request.palletBuild!,config:{...c,packaging:{...c.packaging!,deckSupports:[{...s,maxLoadKg:0}]}}}})).toThrow();});
it("preserves locks and rejects invalid contents edits atomically",()=>{const plan=make(),before=JSON.stringify(plan);expect(()=>editPalletContents(plan,[p],plan.pallets![0].id,{type:"move",ids:[plan.placements[0].id],delta:{x:0,y:0,z:-50}})).toThrow();expect(JSON.stringify(plan)).toBe(before);const locked=editPalletContents(plan,[p],plan.pallets![0].id,{type:"lock",locked:true});expect(()=>editPalletContents(locked,[p],plan.pallets![0].id,{type:"remove",ids:[plan.placements[0].id]})).toThrow();});
it("rotates asymmetric pieces through all four turns with the cargo",()=>{
 const c={...config,length:400,width:200,maxLoad:100,packaging:{...config.packaging!,deckSupports:[{...s,dx:100,dy:200,maxLoadKg:100}]}};
 let plan=make({workflow:"palletized",products:[{...p,length:100,quantity:1}],palletBuild:{...request.palletBuild!,config:c}});const original=plan.placements[0],ids=[original.id],local=palletLocalBox(original,plan.pallets![0]);
 plan=editPalletContents(plan,[{...p,length:100,quantity:1}],plan.pallets![0].id,{type:"move",ids,delta:{x:-local.x,y:-local.y,z:50-local.z}});
 // Move the whole unit away from origin, leaving room for every turn.
 plan=editPlan(plan,[{...p,length:100,quantity:1}],ids,"pallet",{x:200,y:200,z:0});const start=palletDeckSupportGeometry(plan.pallets!).boxes[0];
 for(let i=0;i<4;i++){plan=editPlan(plan,[{...p,length:100,quantity:1}],ids,"pallet",{x:0,y:0,z:0},0,0,true);expect(plan.validation.valid).toBe(true);expect(inspectDeckSupports(plan,[{...p,length:100,quantity:1}])[0].loadKg).toBe(10);const local=palletLocalBox(plan.placements[0],plan.pallets![0]);expect(palletWorldBox(local,plan.pallets![0])).toMatchObject(plan.placements[0]);}
 const end=palletDeckSupportGeometry(plan.pallets!).boxes[0];expect([end.x,end.y,end.dx,end.dy]).toEqual([start.x,start.y,start.dx,start.dy]);
});
it("rejects support overhang, overlap, deck gaps and missing physical mass",()=>{
 for(const supports of [[{...s,dx:201}],[s,{...s,id:"b"}],[{...s,weightKg:null}]])expect(()=>parseFloorPalletConfig({...config,packaging:{...config.packaging!,deckSupports:supports}})).toThrow();
 expect(()=>parseFloorPalletConfig({...config,packaging:{...config.packaging!,base:"block"}})).toThrow(/full bottom contact/);
});
it("enforces known ratings without provenance while reporting unverified",()=>{const c={...config,packaging:{...config.packaging!,deckSupports:[{...s,source:""}]}};const plan=make({palletBuild:{...request.palletBuild!,config:c}});expect(plan.placements).toHaveLength(2);expect(inspectDeckSupports(plan,[p])[0].state).toBe("unverified");});
it("keeps bottom-only cargo on its attached support as the first cargo layer",()=>{const plan=make({products:[{...p,bottomOnly:true}]});expect(plan.placements).toHaveLength(1);expect(plan.placements[0].z).toBe(150);});
it("reserves added mass when admitting complete units to a vehicle",()=>{const plan=make({workflow:"palletized",container:{...request.container,maxWeight:29}});expect(plan.pallets).toHaveLength(0);expect(plan.metrics.grossWeight).toBe(0);expect(plan.metrics.loadedCount).toBe(0);});
it("retains the physical support after removing all cargo and allows valid reinsertion",async()=>{
 const {isolatePalletPlan}=await import('./pallet-inspection');const plan=make(),id=plan.pallets![0].id,empty=editPalletContents(plan,[p],id,{type:"remove",ids:plan.placements.map(b=>b.id)});expect(empty.placements).toHaveLength(0);expect(empty.metrics.grossWeight).toBe(10);expect(empty.metrics.loadedVolume).toBe(6000000);expect(isolatePalletPlan(empty,id).container.height).toBe(150);
 const added=editPalletContents(empty,[p],id,{type:"add",productId:p.id,position:{x:0,y:0,z:50}});expect(added.placements).toHaveLength(1);expect(added.metrics.grossWeight).toBe(20);expect(inspectDeckSupports(added,[p])[0].loadKg).toBe(10);
});
it("uses full attached height in access checks even when cargo is lower",async()=>{
 const {auditAccess}=await import('./access');const c={...config,length:400,maxLoad:100,maxCargoHeight:400,packaging:{...config.packaging!,deckSupports:[{...s,dx:200,dz:300,maxLoadKg:100}]}};const plan=make({workflow:'palletized',products:[{...p,length:200,quantity:1}],palletBuild:{...request.palletBuild!,config:c}});const access=auditAccess(plan);expect(access.order[0].dz).toBe(400);
});
it("uses real two-end contact without filling the 600 mm span",()=>{
 const q={...p,length:1000,width:100,quantity:1,minimumSupportRatio:.4,longSupport:{version:1 as const,dimensions:{length:1000,width:100,height:100},axis:"L" as const,bands:[{start:0,end:200},{start:800,end:1000}],minimumContactRatio:1,maxSpanMm:600,maxOverhangMm:0,source:"QA span",revision:"43"}},c={...config,length:1000,width:100,maxLoad:100,packaging:{...config.packaging!,deckSupports:[{...s,dx:200,dy:100,weightKg:1},{...s,id:"end",x:800,dx:200,dy:100,weightKg:1}]}};
 const plan=make({products:[q],palletBuild:{...request.palletBuild!,config:c}});expect(plan.placements).toHaveLength(1);expect(inspectDeckSupports(plan,[q]).map(r=>r.loadKg)).toEqual([5,5]);
 expect(()=>make({products:[{...q,longSupport:{...q.longSupport,maxSpanMm:599}}],palletBuild:{...request.palletBuild!,config:c}})).toThrow(/deck support constraints/);
 expect(()=>make({products:[{...q,minimumSupportRatio:.995}],palletBuild:{...request.palletBuild!,config:c}})).toThrow();
});
it("tries the next packaging without splitting a failed kit",()=>{
 const q={...p,quantity:1,setCode:"KIT",unitsPerSet:1},other={...q,id:"q",sku:"Q"},blocked={...config,packaging:{...config.packaging!,deckSupports:[{...s,maxLoadKg:0}]}},plain={...config,packaging:{...config.packaging!,deckSupports:undefined}};
 const plan=make({products:[q,other],palletBuild:{...request.palletBuild!,config:blocked,additionalSpecs:[{id:"plain",config:plain,maxPallets:1,stackLayers:1,maxTopLoadKg:0}]}});expect(plan.placements).toHaveLength(2);expect(plan.pallets![0].specificationId).toBe("plain");expect(new Set(plan.placements.map(b=>b.setNumber)).size).toBe(1);
});
it.each([-1,NaN,Infinity,"5"])("rejects invalid added support mass %s",weightKg=>{expect(()=>parseFloorPalletConfig({...config,packaging:{...config.packaging!,deckSupports:[{...s,weightKg}]}})).toThrow();});
it("does not enable automatic floor pallets or complete-unit stacking",()=>{
 expect(()=>make({palletBuild:{...request.palletBuild!,stackLayers:2}})).toThrow(/floor-only/);
 expect(()=>make({palletBuild:{...request.palletBuild!,maxTopLoadKg:1}})).toThrow(/floor-only/);
 expect(()=>packLoadingWorkflow({...request,workflow:"direct",floorPallets:config})).toThrow(/prebuilt pallet/);
});
it("round-trips physical profiles and rejects changed current definitions and forged tare",async()=>{
 const {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans}=await import('./workspace-file'),{packWithComparison}=await import('./engine');
 const practical=make({strategy:'practical'}),maximum=make(),plan={...maximum,strategyPlans:{practical,maximum}},inputs={...request,mode:'mixed' as const,strategy:'maximum' as const,practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:'mm' as const,weightUnit:'kg' as const};
 const text=serializeWorkspaceBackup(inputs,'0.43.0',plan,plan.strategyPlans),restored=restoreWorkspacePlans(text,parseWorkspaceBackup(text))!;expect(restored.strategyPlans!.practical!.metrics.grossWeight).toBe(30);expect(restored.pallets![0].packaging!.deckSupports).toEqual([s]);
 const changed={...config,packaging:{...config.packaging!,deckSupports:[{...s,maxLoadKg:0}]}};expect(()=>restorePackingSnapshot({...request,palletBuild:{...request.palletBuild!,config:changed}},maximum)).toThrow(/workspace inputs/);
 for(const patch of [{weight:5},{quarterTurns:1},{quarterTurns:4}])expect(()=>restorePackingSnapshot(request,{...maximum,pallets:[{...maximum.pallets![0],...patch}]})).toThrow();
 // Baseline direct workflow remains unchanged when no attached support exists.
 expect(packWithComparison({...request,workflow:'direct',palletBuild:undefined}).validation.valid).toBe(true);
});
it("uses complete tare, raw profile and rotation in exports without extra cargo rows",async()=>{
 const {buildPlacementCsv,buildDeckSupportCsv,parseCsvRecords}=await import('./csv'),{customerReport,offlineFieldHtml}=await import('./field-report'),{analyzeLoads}=await import('./load-analysis');const plan=make(),rows=parseCsvRecords(buildPlacementCsv(plan)),header=rows[0];
 expect(rows).toHaveLength(4);expect(rows.every(r=>r.length===header.length)).toBe(true);const row=rows.find(r=>r[15]==='pallet')!;expect(row[14]).toBe('10');expect(row[header.indexOf('托盘水平转数')]).toBe('0');expect(JSON.parse(row[header.indexOf('托内支承件JSON')])).toEqual([s]);
 const csv=parseCsvRecords(buildDeckSupportCsv(plan,[p],true));expect(csv[1].slice(11,15)).toEqual(['5','20','20','pass']);expect(csv.every(r=>r.length===csv[0].length)).toBe(true);
 for(const html of [customerReport(plan,[p],{language:'en',customer:'QA',order:'QA',currency:'USD',freight:null}),offlineFieldHtml(plan,[p])]){expect(html).toContain('data-deck-supports="1"');expect(html).toContain('20.00');}
 expect(analyzeLoads(plan,[p]).pallets[0]).toMatchObject({load:25,limit:30,status:'verified'});expect(analyzeLoads(plan,[p]).zones.reduce((n,z)=>n+z.weight,0)).toBeCloseTo(30);
});
it("paginates actual support rows in PDF and keeps measured scope visible",async()=>{
 const {vi}=await import('vitest'),{downloadPdfGuide}=await import('./pdf-guide');const plan=make(),pallet=plan.pallets![0],texts:{v:string;y:number}[]=[];
 const many={...plan,pallets:[{...pallet,packaging:{...pallet.packaging!,deckSupports:Array.from({length:12},(_,i)=>({...s,id:`wood-${i}`,name:'N'.repeat(100),source:'S'.repeat(500)}))}}]};
 const ctx={fillText:(v:string,x:number,y:number)=>texts.push({v,y}),measureText:(v:string)=>({width:v.length*14}),fillRect:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),stroke:vi.fn(),fill:vi.fn()};
 vi.stubGlobal('document',{fonts:{ready:Promise.resolve()},createElement:(tag:string)=>tag==='canvas'?{getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([new Uint8Array([255,216,255,217])]))}:{click:vi.fn()}});vi.stubGlobal('URL',{createObjectURL:()=> 'blob:test',revokeObjectURL:vi.fn()});vi.stubGlobal('setTimeout',vi.fn());
 try{await downloadPdfGuide(many,'en',[p]);expect(texts.filter(t=>t.v==='Deck supports and cumulative static load')).toHaveLength(2);expect(texts.filter(t=>t.v.includes('NNNN')||t.v.includes('SSSS')).every(t=>t.y<2260&&t.v.length*14<=1500)).toBe(true);}finally{vi.unstubAllGlobals();}
});
it("localizes attached support diagnostics",async()=>{
 const {translateDiagnostic}=await import('./translate-ui');for(const trigger of [()=>parseFloorPalletConfig({...config,packaging:{...config.packaging!,deckSupports:[{...s,weightKg:null}]}}),()=>make({palletBuild:{...request.palletBuild!,stackLayers:2}}),()=>parseFloorPalletConfig({...config,packaging:{...config.packaging!,base:'block'}})]){try{trigger();throw Error('expected rejection');}catch(e){expect(translateDiagnostic((e as Error).message,'en')).not.toMatch(/[\u3400-\u9fff]/u);}}
});

it("rejects missing specifications and forged attached geometry in the independent validator",()=>{const plan=make(),pallet=plan.pallets![0];expect(validatePacking(plan.placements,plan.container,0,[p],"maximum","mixed",plan.pallets).valid).toBe(false);expect(validatePacking(plan.placements,plan.container,0,[p],"maximum","mixed",[{...pallet,weight:5}],undefined,plan.palletization).valid).toBe(false);const malformed={...pallet,packaging:{...pallet.packaging!,deckSupports:[{...s,weightKg:null}]}};expect(validatePacking(plan.placements,plan.container,0,[p],"maximum","mixed",[malformed],undefined,plan.palletization).valid).toBe(false);});

it("allocates added support mass at its actual longitudinal location",async()=>{const {analyzeLoads}=await import('./load-analysis'),c={...config,length:400,maxLoad:100,packaging:{...config.packaging!,deckSupports:[{...s,dx:100,maxLoadKg:100}]}};const q={...p,length:100,quantity:1},plan=make({products:[q],palletBuild:{...request.palletBuild!,config:c}}),zones=analyzeLoads(plan,[q]).zones;expect(plan.placements[0].x).toBe(100);expect(zones.map(z=>z.weight)).toEqual([6.25,11.25,1.25,1.25]);expect(zones.reduce((n,z)=>n+z.weight,0)).toBe(plan.metrics.grossWeight);});
