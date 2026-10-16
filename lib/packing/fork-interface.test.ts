import {downloadPdfGuide} from "./pdf-guide";
import {afterEach,expect,it,vi} from "vitest";
import {DEFAULT_PACKAGING,baseMeasurements,packagingParts,placedPackagingParts,validateBaseMeasurements,parsePackaging} from "./packaging";
import {parseFloorPalletConfig} from "./floor-pallets";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {packLoadingWorkflow} from "./pack-loading";
import {crateStructureKey} from "./crate-bearing";
import {crateStructure} from "./crate-structure";
import {buildPlacementCsv,parseCsvRecords} from "./csv";
import {customerReport,offlineFieldHtml} from "./field-report";
import {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans} from "./workspace-file";
import {auditPackingResult} from "./result-audit";
import {fieldPlanFingerprint} from "./execution";
import {emptyForkInterface,parseForkInterface,inspectForkInterface,inspectPlanFork,forkEvidenceKey,forkEvidenceReady,forkWindows,forkBaseParts,placeForkBox,forkReport,FORK_DIRECTIONS} from "./fork-interface";
import type {FloorPalletConfig,PackingRequest,ProductInput} from "./types";
const plain:FloorPalletConfig={...DEFAULT_PALLET_BUILD.config,length:1200,width:800,height:144,weight:25,maxLoad:1000,maxCargoHeight:800,packaging:{...DEFAULT_PACKAGING}};
const config:FloorPalletConfig={...plain,packaging:{...DEFAULT_PACKAGING,measurements:{...baseMeasurements(1200,800,144,DEFAULT_PACKAGING),deckThickness:22,bottomThickness:22,bearerThickness:22,supportLength:144,supportWidth:112,source:"Measured pallet A",revision:"r1"}}};
const probe={...emptyForkInterface(config),direction:"x-max" as const,forkWidth:80,forkThickness:50,forkLength:1000,spacing:344,center:400,bottomZ:24,insertionDepth:800,tipClearance:10,clearance:2,withdrawalClearance:100,source:"Measured truck A",revision:"r1"};
const c={...config,forkInterface:probe};
const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:400,height:200,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const request:PackingRequest={workflow:"palletized",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:4000,width:2000,height:2000,doorWidth:2000,doorHeight:2000,maxWeight:20000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,config:c,maxPallets:1}};
const plan=()=>packLoadingWorkflow(request);
it("preserves legacy parts and only changes geometry when measured fields are present",()=>{
 expect(parsePackaging(DEFAULT_PACKAGING)).toEqual(DEFAULT_PACKAGING);
 const legacy=packagingParts(1200,800,144,DEFAULT_PACKAGING),measured=forkBaseParts(config);
 expect(measured).toEqual(legacy);expect(forkBaseParts({...config,packaging:{...config.packaging!,measurements:{...config.packaging!.measurements!,supportWidth:100}}})).not.toEqual(legacy);
 expect(()=>validateBaseMeasurements(1200,800,144,config.packaging)).not.toThrow();
});
it("validates measured dimensions, source lengths and base envelope before solving",()=>{
 for(const patch of [{deckThickness:0},{deckThickness:NaN},{bottomThickness:100},{supportLength:401},{supportWidth:300},{deckBoardWidth:161},{source:"x".repeat(501)}])expect(()=>parseFloorPalletConfig({...config,packaging:{...config.packaging,measurements:{...config.packaging!.measurements,...patch}}})).toThrow();
 expect(()=>parseFloorPalletConfig({...config,packaging:{...config.packaging!,base:"solid"}})).toThrow();
 expect(()=>parseForkInterface({...probe,forkWidth:NaN})).toThrow();expect(()=>parseForkInterface({...probe,spacing:-1})).toThrow();expect(()=>parseForkInterface({...probe,direction:"z-min"})).toThrow();expect(()=>parseForkInterface({...probe,ratings:{...probe.ratings,dynamicKg:-1}})).toThrow();
 expect(parseForkInterface(emptyForkInterface(config)).forkWidth).toBe(0);
});
it("derives through-channel widths and heights from real structural parts",()=>{
 expect(forkWindows(config,"x")).toEqual([{lateral:112,z:0,width:232,height:100},{lateral:456,z:0,width:232,height:100}]);
 expect(forkWindows(config,"y").some(w=>w.lateral===144&&w.width===384&&w.z===22&&w.height===100)).toBe(true);
 const stringer={...config,packaging:{...config.packaging!,base:"stringer" as const}};
 expect(forkWindows(stringer,"x").length).toBeGreaterThan(0);expect(forkWindows(stringer,"y")).toEqual([]);
 const solid={...plain,packaging:{...DEFAULT_PACKAGING,base:"solid" as const}};expect(forkWindows(solid,"x")).toEqual([]);expect(forkWindows(solid,"y")).toEqual([]);
});
it.each(FORK_DIRECTIONS)("tests both forks against parts rather than assuming an open entry face (%s)",direction=>{
 const p={...probe,direction,...(direction.startsWith("y")?{center:600,spacing:528,bottomZ:24,forkThickness:50,insertionDepth:600,forkLength:800}:{})};
 const check=inspectForkInterface({...c,forkInterface:p});expect(check.state).toBe("pass");expect(check.forks).toHaveLength(2);expect(check.sweeps).toHaveLength(2);expect(check.equipment).toBe("unverified");expect(check.evidence).toBe("unverified");
});
it("does not fill missing fork data or infer measured evidence from a generic model",()=>{
 expect(inspectForkInterface(config).state).toBe("unverified");expect(inspectForkInterface({...plain,forkInterface:probe}).evidence).toBe("unverified");
 expect(inspectForkInterface({...c,forkInterface:{...probe,forkLength:0}}).issues[0].code).toBe("missing");
});
it.each(["forkWidth","forkThickness","spacing","bottomZ","insertionDepth"] as const)("identifies a blocked or impossible fork envelope after changing %s",key=>{
 const values={forkWidth:260,forkThickness:120,spacing:30,bottomZ:130,insertionDepth:1200};const check=inspectForkInterface({...c,forkInterface:{...probe,[key]:values[key]}});expect(check.state).toBe("fail");expect(check.issues.length).toBeGreaterThan(0);
});
it("checks bearer intersections and full withdrawal rather than just the final fork box",()=>{
 const check=inspectForkInterface({...c,forkInterface:{...probe,direction:"x-min",bottomZ:90,forkThickness:20,clearance:0}});
 expect(check.state).toBe("fail");expect(check.issues.some(i=>i.code==="part")).toBe(true);
 const okay=inspectForkInterface(c);expect(okay.sweeps[0].dx).toBe(1904);expect(okay.sweeps[0].x+okay.sweeps[0].dx).toBe(2302);
});
it("binds review to measured geometry and fork/rating sources, preserving appearance-only changes",()=>{
 const reviewed={...c,forkInterface:{...probe,reviewedFor:forkEvidenceKey(c)}};
 expect(forkEvidenceReady(reviewed)).toBe(true);
 for(const next of [{...reviewed,height:150},{...reviewed,forkInterface:{...reviewed.forkInterface!,forkWidth:81}},{...reviewed,forkInterface:{...reviewed.forkInterface!,ratings:{...probe.ratings,source:"changed"}}},{...reviewed,packaging:{...reviewed.packaging!,measurements:{...reviewed.packaging!.measurements!,source:"changed"}}}])expect(forkEvidenceReady(next)).toBe(false);
 expect(forkEvidenceReady({...reviewed,packaging:{...reviewed.packaging!,color:"#ffffff",opacity:.3}})).toBe(true);
 const blocked={...c,forkInterface:{...probe,forkThickness:130}};blocked.forkInterface.reviewedFor=forkEvidenceKey(blocked);expect(inspectForkInterface(blocked).state).toBe("fail");
});
it("invalidates crate review and uses the measured foot/deck geometry in linked structural paths",()=>{
 expect(crateStructureKey(config)).not.toBe(crateStructureKey(plain));
 const corner={...config,packaging:{...config.packaging!,base:"corner-feet" as const,enclosure:"frame" as const,measurements:{...config.packaging!.measurements!,supportLength:30,supportWidth:30}}};
 expect(crateStructure(corner).complete).toBe(true);expect(crateStructure({...corner,packaging:{...corner.packaging,measurements:{...corner.packaging.measurements,supportLength:40}}}).complete).toBe(false);
});
it("maps asymmetric local fork geometry by the same rotation as packaging parts",()=>{
 const p={...plan().pallets![0],x:100,y:200,z:50,orientation:"WLH" as const,dx:800,dy:1200};const part=forkBaseParts(c)[1];
 expect(placedPackagingParts({...p,packaging:c.packaging})[1]).toMatchObject(placeForkBox(p,part));
 expect(placeForkBox(p,{x:-100,y:50,z:20,dx:200,dy:80,dz:40})).toEqual({x:150,y:1300,z:70,dx:80,dy:200,dz:40});
});
it("checks actual unit surroundings, rear exit, walls, door, cargo and fixed regions",()=>{
 const base=plan(),id=base.pallets![0].id;expect(base.validation.valid).toBe(true);expect(inspectPlanFork(base,id).state).toBe("pass");
 const front=structuredClone(base);front.palletization!.config.forkInterface!.direction="x-min";expect(inspectPlanFork(front,id).issues.some(i=>i.code==="wall")).toBe(true);
 const rear=structuredClone(base);rear.container.length=1800;expect(inspectPlanFork(rear,id).state).toBe("pass");rear.container.doorWidth=200;expect(inspectPlanFork(rear,id).issues.some(i=>i.code==="door")).toBe(true);
 const occupied=structuredClone(base);occupied.placements.push({...base.placements[0],id:"blocker",x:1400,y:200,z:0,dx:100,dy:100,dz:100});expect(inspectPlanFork(occupied,id).issues.some(i=>i.code==="cargo"&&i.ids.includes("blocker"))).toBe(true);
 const site=structuredClone(base);site.container.exclusions=[{id:"zone",name:"Z",kind:"reserved",x:1400,y:200,z:0,dx:100,dy:100,dz:100}];expect(inspectPlanFork(site,id).issues.some(i=>i.code==="site"&&i.ids.includes("site-exclusion/zone"))).toBe(true);
 const neighbor=structuredClone(base);neighbor.pallets!.push({...base.pallets![0],id:"neighbor",x:1400});expect(inspectPlanFork(neighbor,id).issues.some(i=>i.code==="pallet"&&i.ids.includes("neighbor"))).toBe(true);
 const open=structuredClone(rear);open.container.loadingAccess="open";expect(inspectPlanFork(open,id).state).toBe("unverified");
});
it("keeps local-only pallet inspection separate from vehicle/worksite clearance",()=>{
 const result=packLoadingWorkflow({...request,workflow:"pallet-only"});const before=structuredClone(result),check=inspectPlanFork(result,result.pallets![0].id);
 expect(check.scope).toBe("inspection");expect(check.state).toBe("pass");expect(result).toEqual(before);expect(inspectPlanFork(result,"missing").state).toBe("unverified");
});
it("preserves fork data and measured geometry in templates, backup and independent JSON without changing counts or tare",()=>{
 const maximum=plan(),practical=packLoadingWorkflow({...request,strategy:"practical"}),inputs={...request,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
 expect(maximum.metrics.grossWeight).toBe(35);expect(maximum.metrics.loadedCount).toBe(1);expect(auditPackingResult(maximum,[product]).hasErrors).toBe(false);
 const backup=serializeWorkspaceBackup(inputs,"0.35.0",maximum,{maximum,practical}),parsed=parseWorkspaceBackup(backup),restored=restoreWorkspacePlans(backup,parsed)!;
 expect(parsed.palletBuild!.config.forkInterface).toEqual(probe);expect(restored.pallets![0].packaging?.measurements).toEqual(c.packaging!.measurements);expect(restored.metrics.grossWeight).toBe(35);
 const report=forkReport(maximum,maximum.pallets![0].id);expect(report.format).toBe("cargo-fit-fork-preflight");expect(report.check.scope).toBe("vehicle");expect(()=>parseWorkspaceBackup(JSON.stringify(report))).toThrow();
 const altered=structuredClone(maximum);altered.palletization!.config.forkInterface!.spacing+=1;expect(fieldPlanFingerprint(altered)).not.toBe(fieldPlanFingerprint(maximum));
 const bad=JSON.parse(backup);bad.inputs.palletBuild.config.packaging.measurements.supportWidth=1000;expect(()=>parseWorkspaceBackup(JSON.stringify(bad))).toThrow();
});
it("exports separate fork columns, escaped measured sources and a clearly scoped bilingual report",()=>{
 const result=plan();result.palletization!.config.packaging!.measurements!.source="<measured>";result.palletization!.config.forkInterface!.source="<fork>";
 const rows=parseCsvRecords(buildPlacementCsv(result)),header=rows[0],column=header.indexOf("叉具接口JSON");expect(column).toBeGreaterThan(0);expect(rows.every(r=>r.length===header.length)).toBe(true);expect(rows.some((r,i)=>i&&r[column].includes('"forkWidth":80'))).toBe(true);
 const html=customerReport(result,[product],{language:"en",customer:"C",order:"O",currency:"USD",freight:null});expect(html).toContain("Base and fork data");expect(html).toContain("&lt;measured&gt;");expect(html).toContain("&lt;fork&gt;");expect(html).toContain("Equipment capacity");expect(offlineFieldHtml(result,[product])).toContain("底座与叉具资料");
});
it("keeps per-spec fork data with compact choices, site regions and final dimension columns",()=>{
 const small={...c,name:"Small",length:400,width:400,maxCargoHeight:200,packaging:{...c.packaging!,measurements:{...baseMeasurements(400,400,144,DEFAULT_PACKAGING),source:"Small measured",revision:"s1"}},forkInterface:{...probe,center:200,spacing:172,forkWidth:20,forkLength:400,insertionDepth:200}};
 const result=packLoadingWorkflow({...request,products:[{...product,quantity:7}],palletBuild:{...request.palletBuild!,selection:"compact",config:{...c,maxCargoHeight:200},primaryRule:{maxPallets:1},maxPallets:2,additionalSpecs:[{id:"small",config:small,maxPallets:1,stackLayers:1,maxTopLoadKg:0}]}});
 expect(result.validation.valid).toBe(true);expect(result.metrics.loadedCount).toBe(7);expect(result.pallets).toHaveLength(2);
 result.container.exclusions=[{id:"z",name:"Region",kind:"reserved",x:3900,y:1900,z:1900,dx:100,dy:100,dz:100}];result.dimensionScenario={id:"scenario",kind:"nominal",proxyProductIds:[]};
 const rows=parseCsvRecords(buildPlacementCsv(result)),header=rows[0],col=header.indexOf("叉具接口JSON");expect(header.slice(-2)).toEqual(["尺寸方案ID","尺寸口径"]);expect(rows.every(r=>r.length===header.length)).toBe(true);
 expect(rows.filter((r,i)=>i&&r[15]==="pallet").map(r=>JSON.parse(r[col]).forkWidth).sort((a,b)=>a-b)).toEqual([20,80]);expect(rows.find(r=>r[15]==="site-exclusion")![col]).toBe("");
 const missing=structuredClone(result);delete missing.pallets![0].specificationId;expect(()=>forkReport(missing,missing.pallets![0].id)).toThrow();
});
it("separates documentary handling ratings from the unchanged packing payload limit",()=>{
 const restricted={...c,forkInterface:{...probe,ratings:{staticKg:200,dynamicKg:1,rackKg:0,source:"Conditions A"}}};
 const result=packLoadingWorkflow({...request,palletBuild:{...request.palletBuild!,config:restricted}}),check=inspectPlanFork(result,result.pallets![0].id);
 expect(result.metrics.grossWeight).toBe(35);expect(result.pallets![0].maxLoad).toBe(1000);expect(check.ratings).toEqual(restricted.forkInterface.ratings);expect(check.equipment).toBe("unverified");
});
it("normalizes evidence whitespace consistently through configuration parsing",()=>{
 const raw={...c,packaging:{...c.packaging!,measurements:{...c.packaging!.measurements!,source:"  Measured A  ",revision:" r1 "}},forkInterface:{...probe,source:" Truck A ",revision:" r1 "}};
 raw.forkInterface.reviewedFor=forkEvidenceKey(raw);expect(forkEvidenceReady(raw)).toBe(true);expect(forkEvidenceReady(parseFloorPalletConfig(raw))).toBe(true);
});
afterEach(()=>vi.unstubAllGlobals());
it("prints one scoped fork evidence page with complete geometry numbers and bounded source summaries",async()=>{
 const result=plan(),texts:{value:string;x:number;y:number;font:string;page:number}[]=[],ctx={font:"",fillText:(value:string,x:number,y:number)=>texts.push({value,x,y,font:ctx.font,page}),measureText:(v:string)=>({width:[...v].reduce((n,c)=>n+(/[\u3400-\u9fff]/.test(c)?1:.57)*(Number(/(\d+)px/.exec(ctx.font)?.[1])||25),0)}),fillRect:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),stroke:vi.fn(),fill:vi.fn()};let page=0;
 result.palletization!.config.packaging!.measurements!.source="测量来源".repeat(120);result.palletization!.config.forkInterface!.source="叉具来源".repeat(120);
 vi.stubGlobal("document",{fonts:{ready:Promise.resolve()},createElement:(tag:string)=>tag==="canvas"?{getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>{page++;cb(new Blob([new Uint8Array([255,216,255,217])]))}}:{click:vi.fn()}});vi.stubGlobal("URL",{createObjectURL:()=>"blob:fork-test",revokeObjectURL:vi.fn()});vi.stubGlobal("setTimeout",vi.fn());
 await downloadPdfGuide(result,"en",[product]);const title=texts.find(t=>t.value==="Base and fork data (independent preflight)")!;expect(title).toBeTruthy();const rows=texts.filter(t=>t.page===title.page);
 expect(rows.some(t=>t.value==="80 mm")).toBe(true);expect(rows.some(t=>t.value.includes("Equipment capacity"))).toBe(true);expect(rows.every(t=>t.y<2546&&t.x>=0)).toBe(true);expect(result.metrics.grossWeight).toBe(35);
 for(const row of rows){ctx.font=row.font;expect(row.x+ctx.measureText(row.value).width,row.value).toBeLessThanOrEqual(1730);}
});
