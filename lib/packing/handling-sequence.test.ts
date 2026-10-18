import {afterEach,expect,it,vi} from "vitest";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {DEFAULT_PACKAGING,baseMeasurements} from "./packaging";
import {emptyForkInterface,forkEvidenceKey} from "./fork-interface";
import {packLoadingWorkflow} from "./pack-loading";
import {buildHandlingTask,handlingBasis,inspectHandlingSequence,parseHandlingTasks,setHandlingTask,handlingSequenceReport,HANDLING_MODEL,type HandlingTask} from "./handling-sequence";
import {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans} from "./workspace-file";
import {reviewPlan} from "./plan-review";
import {fieldPlanFingerprint} from "./execution";
import {buildPlacementCsv,parseCsvRecords} from "./csv";
import {customerReport,offlineFieldHtml} from "./field-report";
import {downloadPdfGuide} from "./pdf-guide";
import type {ProductInput} from "./types";
const config={...DEFAULT_PALLET_BUILD.config,length:1200,width:800,height:144,weight:25,maxLoad:1000,maxCargoHeight:800,packaging:{...DEFAULT_PACKAGING,measurements:{...baseMeasurements(1200,800,144,DEFAULT_PACKAGING),source:"QA base",revision:"r1"}}};
const f={...emptyForkInterface(config),direction:"x-max" as const,forkWidth:80,forkThickness:50,forkLength:1000,spacing:344,center:400,bottomZ:24,insertionDepth:800,tipClearance:10,clearance:2,withdrawalClearance:100,source:"QA forks",revision:"r1"};
const measured={...config,forkInterface:f};f.reviewedFor=forkEvidenceKey(measured);
const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:400,height:200,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const request={workflow:"palletized" as const,mode:"mixed" as const,strategy:"maximum" as const,clearance:0,container:{id:"c",name:"C",length:4000,width:2000,height:2000,doorWidth:2000,doorHeight:2000,maxWeight:20000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,config:measured,maxPallets:1}};
const plan=()=>packLoadingWorkflow(structuredClone(request));
const equipment={name:"QA truck",source:"QA geometry only",revision:"e1",bodyLength:500,bodyWidth:600,bodyHeight:700,mastDepth:100,mastWidth:600,mastHeight:1200,maxLift:200,clearance:0};
const site={source:"QA site",revision:"s1",doorLeft:0,doorBottom:0,frameDepth:50,outsideLength:10000,outsideLeft:-1000,outsideWidth:4000,outsideHeight:3000,outsideFloor:0};
const task=(p=plan(),direction:"load"|"unload"="unload")=>buildHandlingTask(p,p.pallets![0].id,{equipment:{...equipment},site:{...site},revision:"task-1",direction,outsideX:4500,lift:100,approach:500,exit:500});
const rebound=(p:ReturnType<typeof plan>,t:HandlingTask)=>({...t,basis:handlingBasis(p,t)});
it.each(["load","unload"] as const)("validates seven connected %s steps with explicit support transitions",direction=>{
 const p=plan(),t=task(p,direction),check=inspectHandlingSequence(p,t);expect(check.state).toBe("clear");expect(check.steps.map(s=>s.state)).toEqual(Array(7).fill("clear"));expect(check.steps.map(s=>s.connected)).toEqual([false,true,true,true,true,false,false]);expect(check.steps.map(s=>s.supported)).toEqual([true,true,false,false,true,true,true]);expect(check.capacity).toBe("unverified");expect(check.turning).toBe("not-executed");expect(check.unitPose.x).toBe(direction==="load"?0:4500);
});
it("tests the stationary outside base during loading rather than the final target position",()=>{
 const p=plan(),t=task(p,"load");const check=inspectHandlingSequence(p,t);expect(check.steps[1].geometry!.sweeps[2].x).toBeGreaterThan(4000);expect(check.state).toBe("clear");
 t.steps[1].to.lift=110;expect(inspectHandlingSequence(p,t).steps[1].issues).toContain("engagement");
});
it("finds a thin intermediate obstacle and leaves all later steps unexecuted",()=>{
 const p=plan();p.container.exclusions=[{id:"thin",name:"Thin",kind:"obstacle",x:3500,y:200,z:100,dx:1,dy:100,dz:100}];const check=inspectHandlingSequence(p,task(p));expect(check.steps.slice(0,3).every(s=>s.state==="clear")).toBe(true);expect(check.steps[3].state).toBe("blocked");expect(check.steps[3].geometry!.issues.some(i=>i.ids.includes("site-exclusion/thin"))).toBe(true);expect(check.steps.slice(4).every(s=>s.state==="not-executed")).toBe(true);
});
it("stops at a blocked approach with the equipment component and region ID",()=>{
 const p=plan();p.container.exclusions=[{id:"mast",name:"Mast blocker",kind:"reserved",x:2500,y:200,z:1000,dx:1,dy:100,dz:100}];const check=inspectHandlingSequence(p,task(p));expect(check.steps[0].state).toBe("blocked");expect(check.steps[0].geometry!.issues.some(i=>i.component==="mast"&&i.ids.includes("site-exclusion/mast"))).toBe(true);expect(check.steps.slice(1).every(s=>s.state==="not-executed")).toBe(true);
});
it("checks both the mast and the carried load at the doorway",()=>{
 const p=plan();p.container.doorHeight=400;const check=inspectHandlingSequence(p,task(p));expect(check.steps[3].state).toBe("blocked");expect(check.steps[3].geometry!.issues.some(i=>i.code==="door"&&i.component==="mast")).toBe(true);expect(check.steps[3].geometry!.issues.some(i=>i.code==="door"&&i.component==="load")).toBe(true);
});
it("keeps unknown outside support unverified and refuses to start a loading task",()=>{
 const p=plan(),t=task(p,"load");t.site.source="";const check=inspectHandlingSequence(p,rebound(p,t));expect(check.issues).toContain("initial-support");expect(check.steps.every(s=>s.state==="not-executed")).toBe(true);
});
it("stops unloading at unknown exterior geometry instead of treating later steps as clear",()=>{
 const p=plan(),t=task(p);t.site.outsideHeight=null;const check=inspectHandlingSequence(p,rebound(p,t));expect(check.steps[3].state).toBe("unverified");expect(check.steps[4].state).toBe("not-executed");
});
it("invalidates changed geometry and equipment until explicitly rebound, then still recomputes",()=>{
 const p=plan(),t=task(p);t.equipment.bodyWidth=2600;expect(inspectHandlingSequence(p,t).issues).toContain("basis");expect(inspectHandlingSequence(p,rebound(p,t)).state).toBe("blocked");
 const next=task(p);p.container.exclusions=[{id:"new",name:"New",kind:"reserved",x:2500,y:200,z:1000,dx:100,dy:100,dz:100}];expect(inspectHandlingSequence(p,next).issues).toContain("basis");
});
it("does not allow rebinding to override missing measured fork evidence",()=>{
 const p=plan(),t=task(p);p.palletization!.config.forkInterface!.source="changed";const check=inspectHandlingSequence(p,rebound(p,t));expect(check.steps[0].state).toBe("unverified");expect(check.steps[0].geometry!.issues.some(i=>i.code==="fork-evidence")).toBe(true);expect(check.steps[1].state).toBe("not-executed");
});
it("rejects a teleport between adjacent steps",()=>{
 const p=plan(),t=task(p);t.steps[1].from.x+=1;const check=inspectHandlingSequence(p,t);expect(check.steps[1].issues).toContain("continuity");expect(check.steps[2].state).toBe("not-executed");
});
it("keeps missing, duplicated and reordered phases from producing a completed task",()=>{
 const p=plan();for(const transform of [(t:HandlingTask)=>t.steps.splice(1,1),(t:HandlingTask)=>t.steps.reverse(),(t:HandlingTask)=>t.steps[1].kind="lift"]){const t=task(p);transform(t);const check=inspectHandlingSequence(p,t);expect(check.issues).toContain("sequence");expect(check.steps.every(s=>s.state==="not-executed")).toBe(true);}
});
it("requires full insertion before engagement and a positive lift before transfer",()=>{
 const p=plan(),t=task(p);t.steps[1].to.x=1;expect(inspectHandlingSequence(p,t).steps[1].issues).toContain("engagement");
 const zero=task(p);zero.steps[2].to.lift=0;expect(inspectHandlingSequence(p,zero).steps[2].issues).toContain("engagement");
});
it("cannot disengage a suspended load or lower at a different destination",()=>{
 const p=plan(),t=task(p);t.steps[4].to.lift=50;const check=inspectHandlingSequence(p,t);expect(check.steps[4].issues).toContain("support");expect(check.steps[5].state).toBe("not-executed");
 const wrong=task(p);wrong.steps[4].to.x-=1;expect(inspectHandlingSequence(p,wrong).steps[4].issues).toContain("destination");
});
it("requires a fully clear fork withdrawal before exit",()=>{
 const p=plan(),t=task(p);t.steps[5].to.x=t.steps[5].from.x+100;const check=inspectHandlingSequence(p,t);expect(check.steps[5].issues).toContain("support");expect(check.steps[6].state).toBe("not-executed");expect(check.connected).toBe(true);
});
it("does not invent lateral crab travel or unrecorded turns",()=>{
 const p=plan(),t=task(p);t.steps[3].to.y=20;expect(inspectHandlingSequence(p,t).steps[3].issues).toContain("alignment");
 const front=plan();front.palletization!.config.forkInterface!.direction="x-min";expect(inspectHandlingSequence(front,task(front)).issues).toContain("scope");
});
it("keeps elevated units and floor steps outside the first-stage support model",()=>{
 const p=plan();p.pallets![0].z=100;expect(inspectHandlingSequence(p,task(p)).issues).toContain("scope");const t=task();t.site.outsideFloor=-100;expect(inspectHandlingSequence(plan(),rebound(plan(),t)).steps[3].state).toBe("unverified");
});
it("does not extrapolate the measured mast envelope beyond its lift range",()=>{
 const p=plan(),t=task(p);t.equipment.maxLift=50;const check=inspectHandlingSequence(p,rebound(p,t));expect(check.steps[2].state).toBe("unverified");expect(check.steps[2].geometry!.issues.some(i=>i.code==="lift")).toBe(true);expect(check.steps[3].state).toBe("not-executed");
});
it("maps a rotated unit's original Y-maximum entry to world +X",()=>{
 const p=plan();p.pallets![0]={...p.pallets![0],orientation:"WLH",dx:800,dy:1200};const c=p.palletization!.config;c.forkInterface={...c.forkInterface!,direction:"y-max",center:600,spacing:528,insertionDepth:600,forkLength:800};c.forkInterface.reviewedFor=forkEvidenceKey(c);expect(inspectHandlingSequence(p,task(p)).state).toBe("clear");
});
it("retains post-cargo reservations throughout every handling phase",()=>{
 const p=plan();p.container.exclusions=[{id:"later",name:"Later",kind:"reserved",x:3500,y:200,z:100,dx:100,dy:100,dz:100,accessory:{type:"bar",quantity:1,unitWeightKg:0,phase:"after-cargo",relatedProductIds:[],afterAccessoryIds:[],source:"QA",revision:"r1",note:""}}];expect(inspectHandlingSequence(p,task(p)).steps[3].state).toBe("blocked");
});
it("strictly parses versioned tasks, rejects malformed poses and strips forged outcomes",()=>{
 const t=task(),parsed=parseHandlingTasks([{...t,check:{state:"clear"},authorized:true}])![0];expect(parsed).toEqual(t);expect("check" in parsed).toBe(false);
 for(const next of [{...t,version:2},{...t,model:"other"},{...t,steps:[{...t.steps[0],to:{x:NaN,y:0,lift:0}}]},{...t,steps:[t.steps[0],t.steps[0]]},{...t,equipment:{...t.equipment,bodyWidth:-1}}])expect(()=>parseHandlingTasks([next])).toThrow();expect(()=>parseHandlingTasks([t,t])).toThrow();expect(()=>parseHandlingTasks(Array(33).fill(t))).toThrow();
});
it("saves per-solver task data without changing quantities, stock, weight or five reviews",()=>{
 const p=plan(),before=structuredClone(p),t=task(p),next=setHandlingTask(p,t,t.unitId);expect(p).toEqual(before);expect(next.metrics).toEqual(p.metrics);expect(next.placements).toEqual(p.placements);expect(next.palletization).toEqual(p.palletization);expect(reviewPlan(next,[product])).toEqual(reviewPlan(p,[product]));expect(fieldPlanFingerprint(next)).not.toBe(fieldPlanFingerprint(p));expect(()=>setHandlingTask(p,t,"another")).toThrow();expect(setHandlingTask(next,undefined,t.unitId).handlingTasks).toBeUndefined();
});
it("restores tasks for both strategies and recomputes without reusing imported pass flags",()=>{
 const max=plan(),practical=packLoadingWorkflow({...structuredClone(request),strategy:"practical"}),a=setHandlingTask(max,task(max),max.pallets![0].id),b=setHandlingTask(practical,task(practical,"load"),practical.pallets![0].id),inputs={...request,practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
 const text=serializeWorkspaceBackup(inputs,"0.38.0",a,{maximum:a,practical:b}),restored=restoreWorkspacePlans(text,parseWorkspaceBackup(text))!;
 for(const key of ["practical","maximum"] as const){const p=restored.strategyPlans![key]!,t=p.handlingTasks![0];expect(inspectHandlingSequence(p,t).state).toBe("clear");expect(t.direction).toBe(key==="practical"?"load":"unload");expect(p.metrics.grossWeight).toBe(35);}
 const raw=JSON.parse(text);raw.coordinatePlan.handlingTasks[0].equipment.bodyWidth=2600;raw.coordinatePlan.handlingTasks[0].check={state:"clear"};const forged=JSON.stringify(raw),p=restoreWorkspacePlans(forged,parseWorkspaceBackup(forged))!;expect(inspectHandlingSequence(p,p.handlingTasks![0]).state).toBe("unverified");
});
it("preserves stale tasks as unverified when the unit disappears or a different solver is selected",()=>{
 const p=plan(),t=task(p);p.pallets=[];p.placements=[];expect(inspectHandlingSequence(p,t).issues).toContain("scope");const other=packLoadingWorkflow({...structuredClone(request),strategy:"practical"});expect(inspectHandlingSequence(other,t).issues).toContain("basis");
});
it("exports current steps, metadata and bilingual reports with escaped sources",()=>{
 const p=plan(),t=task(p);t.equipment.source="<QA>";const next=setHandlingTask(p,rebound(p,t),t.unitId),report=handlingSequenceReport(next,next.handlingTasks![0]);expect(report.format).toBe("cargo-fit-handling-sequence");expect(report.model).toBe(HANDLING_MODEL);expect(report.check.state).toBe("clear");expect(report.scope).toContain("Capacity");
 const rows=parseCsvRecords(buildPlacementCsv({...next,dimensionScenario:{id:"s",kind:"nominal",proxyProductIds:[]}})),header=rows[0];expect(rows.every(r=>r.length===header.length)).toBe(true);expect(header.slice(-2)).toEqual(["尺寸方案ID","尺寸口径"]);expect(JSON.parse(rows[1][header.indexOf("设备连贯任务JSON")])[0].revision).toBe("task-1");
 const html=customerReport(next,[product],{language:"en",customer:"",order:"",currency:"USD",freight:null});expect(html).toContain("Independent connected handling preflight");expect(html).toContain("&lt;QA&gt;");expect(html).toContain("Turning is not executed");expect(offlineFieldHtml(next,[product])).toContain("连贯搬运独立预检");
});
afterEach(()=>vi.unstubAllGlobals());
it("prints a bounded independent handling summary page with every phase and unverified scope",async()=>{
 const p=plan(),t=task(p),next=setHandlingTask(p,t,t.unitId),texts:string[]=[],positions:number[]=[],ctx={font:"",fillText:(s:string,_x:number,y:number)=>{texts.push(s);positions.push(y);},measureText:(s:string)=>({width:s.length*12}),fillRect:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),stroke:vi.fn(),fill:vi.fn()};
 vi.stubGlobal("document",{fonts:{ready:Promise.resolve()},createElement:(tag:string)=>tag==="canvas"?{getContext:()=>ctx,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([new Uint8Array([255,216,255,217])]))}:{click:vi.fn()}});vi.stubGlobal("URL",{createObjectURL:()=>"blob:task",revokeObjectURL:vi.fn()});vi.stubGlobal("setTimeout",vi.fn());await downloadPdfGuide(next,"en",[product]);expect(texts).toContain("Independent connected handling preflight");for(let i=1;i<=7;i++)expect(texts.some(s=>s.includes(`step-${i} ·`))).toBe(true);expect(texts.some(s=>s.includes("does not change the five reviews"))).toBe(true);
 texts.length=0;positions.length=0;const long={...t,steps:Array.from({length:16},(_,i)=>({...t.steps[i%7],id:`record-${i+1}`}))};await downloadPdfGuide(setHandlingTask(p,long,long.unitId),"en",[product]);expect(texts.some(s=>s.includes("record-16 ·"))).toBe(true);expect(Math.max(...positions)).toBeLessThan(2546);expect(texts.filter(s=>s==="Independent connected handling preflight")).toHaveLength(3);
});
