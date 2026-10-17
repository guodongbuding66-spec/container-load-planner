import {expect,it} from "vitest";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {DEFAULT_PACKAGING,baseMeasurements} from "./packaging";
import {emptyForkInterface,forkEvidenceKey} from "./fork-interface";
import {packLoadingWorkflow} from "./pack-loading";
import {emptyEquipment,emptyEquipmentTask,inspectEquipmentAction,equipmentActionReport,parseEquipmentTemplate,serializeEquipmentTemplate,readEquipmentTemplate,type EquipmentTask} from "./equipment-actions";
import type {ProductInput} from "./types";
const config={...DEFAULT_PALLET_BUILD.config,length:1200,width:800,height:144,weight:25,maxLoad:1000,maxCargoHeight:800,packaging:{...DEFAULT_PACKAGING,measurements:{...baseMeasurements(1200,800,144,DEFAULT_PACKAGING),source:"QA measured base",revision:"r1"}}};
const f={...emptyForkInterface(config),direction:"x-max" as const,forkWidth:80,forkThickness:50,forkLength:1000,spacing:344,center:400,bottomZ:24,insertionDepth:800,tipClearance:10,clearance:2,withdrawalClearance:100,source:"QA measured forks",revision:"r1"};
const measured={...config,forkInterface:f};f.reviewedFor=forkEvidenceKey(measured);
const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:400,height:200,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const plan=()=>packLoadingWorkflow({workflow:"palletized",mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:4000,width:2000,height:2000,doorWidth:2000,doorHeight:2000,maxWeight:20000},products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,config:structuredClone(measured),maxPallets:1}});
const task=():EquipmentTask=>({equipment:{name:"QA truck",source:"QA measurements, not a real rating",revision:"e1",bodyLength:500,bodyWidth:600,bodyHeight:700,mastDepth:100,mastWidth:600,mastHeight:1200,maxLift:200,clearance:0},site:{source:"QA site",revision:"s1",doorLeft:0,doorBottom:0,frameDepth:50,outsideLength:4000,outsideLeft:-1000,outsideWidth:4000,outsideHeight:3000,outsideFloor:0},action:{mode:"loaded",from:{x:0,y:0,lift:0},to:{x:0,y:0,lift:0}}});
const check=(t=task(),p=plan())=>inspectEquipmentAction(p,p.pallets![0].id,t);
it("keeps missing equipment blank and rejects invalid or unsourced saved templates",()=>{
 expect(Object.values(emptyEquipment()).filter(v=>v===null)).toHaveLength(8);expect(check(emptyEquipmentTask()).state).toBe("unverified");
 for(const patch of [{bodyLength:0},{bodyWidth:NaN},{maxLift:-1},{clearance:null},{source:""},{revision:""},{name:"x".repeat(101)}])expect(()=>parseEquipmentTemplate({...task().equipment,...patch})).toThrow();
 expect(readEquipmentTemplate(serializeEquipmentTemplate(task().equipment))).toEqual(task().equipment);expect(()=>readEquipmentTemplate('{"version":2}')).toThrow();
});
it("checks five separate envelopes without treating a single clear pose as a full equipment route",()=>{
 const r=check();expect(r.state).toBe("clear");expect(r.sweeps.map(b=>b.component)).toEqual(["body","mast","fork-1","fork-2","load"]);expect(r.unverified.join(" ")).toContain("rated capacity");expect(r.forkEvidence).toBe("reviewed");
});
it("lifts forks and load while the chassis and maximum mast envelope stay on the floor",()=>{
 const t=task();t.action.to.lift=150;const r=check(t),base=check();expect(r.state).toBe("clear");
 for(const id of ["body","mast"])expect(r.sweeps.find(b=>b.component===id)).toEqual(base.sweeps.find(b=>b.component===id));
 for(const id of ["fork-1","fork-2","load"])expect(r.sweeps.find(b=>b.component===id)!.dz).toBe(base.sweeps.find(b=>b.component===id)!.dz+150);
 t.action.to.lift=201;expect(check(t).issues.map(i=>i.code)).toContain("lift");
});
it("finds a thin obstacle between clear endpoints with a continuous sweep",()=>{
 const t=task(),p=plan();t.action.to.x=1800;p.container.exclusions=[{id:"thin",name:"Thin",kind:"obstacle",x:2200,y:200,z:100,dx:1,dy:100,dz:100}];
 const r=check(t,p);expect(r.state).toBe("blocked");expect(r.issues.some(i=>i.code==="obstacle"&&i.ids.includes("site-exclusion/thin"))).toBe(true);
});
it("reports the body that cannot pass despite a smaller load fitting",()=>{
 const t=task(),p=plan();p.container.doorWidth=900;t.equipment.bodyWidth=1200;t.action.to.x=4500;
 const r=check(t,p);expect(r.issues.some(i=>i.code==="door"&&i.component==="body")).toBe(true);expect(r.issues.some(i=>i.code==="door"&&i.component==="load")).toBe(false);
});
it("checks door sill and low mast clearance only at the doorway band",()=>{
 const t=task(),p=plan();p.container.doorHeight=1000;t.action.from.x=4200;t.action.to.x=4500;
 expect(check(t,p).issues.some(i=>i.code==="door")).toBe(false);
 t.action.from.x=0;expect(check(t,p).issues.some(i=>i.code==="door"&&i.component==="mast")).toBe(true);
 p.container.doorHeight=1900;t.site.doorBottom=50;expect(check(t,p).issues.some(i=>i.code==="door"&&i.component==="fork-1")).toBe(true);
});
it("keeps an unknown exterior unverified and checks its measured lateral and length bounds",()=>{
 const t=task();t.action.to.x=4500;t.site.source="";expect(check(t).state).toBe("unverified");expect(check(t).issues.some(i=>i.component==="outside")).toBe(true);
 t.site.source="QA";expect(check(t).state).toBe("clear");t.site.outsideLength=100;expect(check(t).issues.some(i=>i.code==="outside")).toBe(true);
});
it("does not infer a level approach across an unmodeled floor step",()=>{
 const t=task();t.action.to.x=4500;t.site.outsideFloor=-100;expect(check(t).state).toBe("unverified");expect(check(t).issues.some(i=>i.code==="floor-level")).toBe(true);
});
it("does not invent a diagonal path, turn or missing input",()=>{
 const t=task();t.action.to.x=100;t.action.to.y=100;expect(check(t).issues[0].code).toBe("motion");expect(check(t).sweeps).toHaveLength(0);
 t.action.to={x:NaN,y:0,lift:0};expect(check(t).state).toBe("unverified");
});
it("retains floor contact at zero while enforcing positive side clearance",()=>{
 const t=task();t.equipment.clearance=2;expect(check(t).issues.some(i=>i.code==="wall")).toBe(true);const p=plan();p.pallets![0].x+=10;p.pallets![0].y+=10;for(const b of p.placements){b.x+=10;b.y+=10;}expect(check(t,p).state).toBe("clear");expect(check(t,p).sweeps.find(b=>b.component==="load")!.z).toBe(0);
});
it("allows exact boundary contact but identifies a positive overlap by component and ID",()=>{
 const p=plan(),t=task();p.container.exclusions=[{id:"touch",name:"Touch",kind:"reserved",x:1900,y:200,z:100,dx:100,dy:100,dz:100}];expect(check(t,p).state).toBe("clear");
 p.container.exclusions[0].x=1899;expect(check(t,p).issues.some(i=>i.component==="body"&&i.ids.includes("site-exclusion/touch"))).toBe(true);
});
it("keeps post-cargo accessories obstructing the sweep",()=>{
 const p=plan(),t=task();p.container.exclusions=[{id:"later",name:"Later",kind:"reserved",x:1600,y:200,z:100,dx:100,dy:100,dz:100,accessory:{type:"bar",quantity:1,unitWeightKg:0,phase:"after-cargo",relatedProductIds:[],afterAccessoryIds:[],source:"QA",revision:"r1",note:""}}];expect(check(t,p).issues.some(i=>i.ids.includes("site-exclusion/later"))).toBe(true);
});
it("includes other loaded units and loose cargo in the environment",()=>{
 const p=plan();p.placements.push({...p.placements[0],id:"neighbor",palletIds:undefined,x:1600});expect(check(task(),p).issues.some(i=>i.ids.includes("neighbor"))).toBe(true);
 const other=plan();other.pallets!.push({...other.pallets![0],id:"other",x:1600});expect(check(task(),other).issues.some(i=>i.ids.includes("other"))).toBe(true);
});
it("checks final-base fork fit and stationary target during insertion or withdrawal",()=>{
 const t=task();t.action.mode="fork-only";t.action.to.x=1100;expect(check(t).state).toBe("clear");expect(check(t).sweeps).toHaveLength(4);
 t.action.to={x:0,y:0,lift:100};expect(check(t).issues.some(i=>i.code==="target"&&i.component.startsWith("fork"))).toBe(true);
 const p=plan();p.palletization!.config.forkInterface!.forkThickness=130;expect(check(task(),p).issues[0].code).toBe("fork-evidence");expect(check(task(),p).issues.some(i=>i.code==="fork-fit")).toBe(true);
});
it("maps the equipment direction through rotated unit coordinates",()=>{
 const p=plan();p.pallets![0]={...p.pallets![0],orientation:"WLH",dx:800,dy:1200};p.placements=[];const r=check(task(),p);
 expect(r.sweeps.find(b=>b.component==="body")).toMatchObject({x:100,y:-700,dx:600,dy:500});expect(r.issues.some(i=>i.code==="wall")).toBe(true);
});
it("does not promote stale fork evidence or inspection coordinates to worksite clearance",()=>{
 const p=plan();p.palletization!.config.forkInterface!.source="changed";expect(check(task(),p).state).toBe("unverified");p.workflow="pallet-only";expect(check(task(),p).issues[0].code).toBe("workflow");
 const open=plan();open.container.loadingAccess="open";expect(check(task(),open).issues[0].code).toBe("workflow");
 const invalid=plan();invalid.validation.valid=false;expect(check(task(),invalid).issues[0].code).toBe("plan");expect(inspectEquipmentAction(plan(),"missing",task()).state).toBe("unverified");
});
it("never detaches a spanning carton from a second supporting pallet",()=>{
 const p=plan();p.placements[0].palletIds!.push("second");expect(check(task(),p).issues.some(i=>i.code==="workflow")).toBe(true);
});
it("exports current geometry, sources, coordinate conversion and independent scope without mutating either strategy",()=>{
 const p=plan(),t=task(),before=structuredClone(p);p.strategyPlans={practical:structuredClone(p),maximum:structuredClone(p)};const snapshots=structuredClone(p.strategyPlans);
 const report=equipmentActionReport(p,p.pallets![0].id,t);expect(report.check.state).toBe("clear");expect(report.task.equipment.revision).toBe("e1");expect(report.snapshotCoordinateFrame).toContain("planClearance");expect(report.scope).toContain("No complete handling");expect(p.strategyPlans).toEqual(snapshots);delete p.strategyPlans;expect(p).toEqual(before);
 t.equipment.bodyWidth=6000;expect(equipmentActionReport(p,p.pallets![0].id,t).check.state).toBe("blocked");
});
