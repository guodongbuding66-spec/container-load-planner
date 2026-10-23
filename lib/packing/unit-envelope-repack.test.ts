import {measuredUnitFixture as fixture} from "../../tests/measured-unit-fixture";
import {expect,it} from "vitest";
import {deliveryIdentityState,issueDeliveryIdentity} from "./delivery-identity";
import {emptyEngineeringDocument} from "./engineering-checks";
import {measuredRepackInputs,repackMeasuredUnits} from "./unit-envelope-repack";
import {palletLoadEnvelope,parseMeasuredUnitEnvelope,unitContentsKey} from "./unit-envelope";
import {restorePackingSnapshot,revisePackingResult} from "./engine";
import {analyzeEmptySpaces,intersects} from "./free-space";
import {auditAccess} from "./access";
import {isolatePalletPlan} from "./pallet-inspection";
import {buildPlacementCsv,parseCsvRecords} from "./csv";
import {measuredEnvelopeHtml} from "./field-report";
import {projectionBoxes} from "./plan-projection";
import {editPalletContents} from "./pallet-edit";
import {packLoadingWorkflow} from "./pack-loading";
import {parseWorkspaceBackup,restoreWorkspacePlans,serializeWorkspaceBackup,type WorkspaceInputs} from "./workspace-file";
import type {PackingResult} from "./types";


const cargo=(p:PackingResult,id:string)=>p.placements.filter(b=>b.palletIds?.includes(id));
it("repositions complete measured floor units while preserving physical bases, local cartons, mass and IDs",()=>{
 const {request,plan,document}=fixture(),before=JSON.stringify(plan),next=repackMeasuredUnits(plan,document,request.products);
 expect(next.validation.valid).toBe(true);expect(next.pallets).toHaveLength(4);expect(next.metrics.grossWeight).toBe(120);expect(next.metrics.loadedCount).toBe(4);expect(deliveryIdentityState(next)).toBe("draft");
 for(const p of next.pallets!){const old=plan.pallets!.find(q=>q.id===p.id)!;expect([p.dx,p.dy,p.dz,p.weight,p.orientation]).toEqual([old.dx,old.dy,old.dz,old.weight,old.orientation]);expect(p.measuredEnvelope?.source).toBe("QA ruler");expect(palletLoadEnvelope(p,cargo(next,p.id))).toMatchObject({dx:600,dy:600,dz:350});expect(unitContentsKey(p,cargo(next,p.id))).toBe(unitContentsKey(old,cargo(plan,old.id)));}
 expect(JSON.stringify(plan)).toBe(before);
});
it("never shrinks the nominal unit when a reading is smaller",()=>{
 const {request,plan,document}=fixture();document.units=document.units.map(r=>({...r,length:100,width:100,height:100}));const next=repackMeasuredUnits(plan,document,request.products);
 expect(palletLoadEnvelope(next.pallets![0],cargo(next,next.pallets![0].id))).toMatchObject({dx:520,dy:520,dz:300});
});
it("keeps all measured space occupied in free-space analysis and envelope metrics",()=>{
 const {request,plan,document}=fixture(),next=repackMeasuredUnits(plan,document,request.products),spaces=analyzeEmptySpaces(next).spaces;
 for(const p of next.pallets!)for(const s of spaces)expect(intersects(s,palletLoadEnvelope(p,cargo(next,p.id)))).toBe(false);
 expect(next.metrics.envelopeVolume).toBe(4*600*600*350);expect(next.metrics.envelopeUtilization).toBeCloseTo(4*600*600*350/(2000*1200*600));
});
it("uses complete measured width for loading and unloading door checks",()=>{
 const {request,plan,document}=fixture();const next=repackMeasuredUnits(plan,document,request.products),p=next.pallets![0],report=auditAccess({...next,container:{...next.container,doorWidth:550}});
 expect(report.issues.some(i=>i.id===p.id&&i.reason==="door")).toBe(true);
});
it("rejects missing measurements and attachment mass that has not entered the plan",()=>{
 const {request,plan,document}=fixture();expect(()=>measuredRepackInputs(plan,{...document,units:document.units.slice(1)},request.products)).toThrow(/every current unit/);
 document.units[0].extraWeightKg=2;expect(()=>repackMeasuredUnits(plan,document,request.products)).toThrow(/attachment mass/);
 document.units[0].weightIncluded=true;expect(repackMeasuredUnits(plan,document,request.products).metrics.grossWeight).toBe(plan.metrics.grossWeight);
});
it("rejects locked units, loose cargo, old revision records and double adoption",()=>{
 const {request,plan,document}=fixture();const locked={...plan,pallets:plan.pallets!.map((p,i)=>({...p,locked:i===0}))};
 expect(()=>measuredRepackInputs(issueDeliveryIdentity(locked),document,request.products)).toThrow();
 expect(()=>measuredRepackInputs({...plan,placements:plan.placements.map(b=>({...b,palletIds:undefined}))},document,request.products)).toThrow();
 const next=issueDeliveryIdentity(repackMeasuredUnits(plan,document,request.products));expect(()=>measuredRepackInputs(next,document,request.products)).toThrow();
 const newDoc=emptyEngineeringDocument(next);newDoc.units=document.units;expect(()=>measuredRepackInputs(next,newDoc,request.products)).toThrow(/already adopted/);
});
it("fails a bounded search without dropping units or changing the source",()=>{
 const {request,plan,document}=fixture(),before=JSON.stringify(plan);document.units=document.units.map(r=>({...r,length:1900,width:1100}));
 expect(()=>repackMeasuredUnits(plan,document,request.products)).toThrow(/retaining all units/);expect(JSON.stringify(plan)).toBe(before);
});
it("rejects excessive door height, malformed readings and stale local cargo geometry on restore",()=>{
 const {request,plan,document}=fixture();document.units[0].height=700;expect(()=>repackMeasuredUnits(plan,document,request.products)).toThrow();document.units[0].height=350;
 const next=repackMeasuredUnits(plan,document,request.products),bad=structuredClone(next);bad.pallets![0].measuredEnvelope!.height=NaN;
 expect(()=>restorePackingSnapshot(request,bad)).toThrow();
 const stale=structuredClone(next);stale.placements[0].x+=1;expect(()=>restorePackingSnapshot(request,stale)).toThrow();
 expect(()=>parseMeasuredUnitEnvelope({...next.pallets![0].measuredEnvelope,date:"2026-02-30"})).toThrow();
});
it("preserves measured envelopes through native workspace restoration and revalidates forged overlaps",()=>{
 const {request,plan,document}=fixture(),next=issueDeliveryIdentity(repackMeasuredUnits(plan,document,request.products));
 const inputs:WorkspaceInputs={...request,workflow:"palletized",palletBuild:request.palletBuild!,strategy:"maximum",mode:"mixed",practicalTargetPercent:next.practicalTargetUtilization*100,customContainers:[],targetVolumePercent:100,targetWeightPercent:100,lengthUnit:"mm",weightUnit:"kg"};
 const text=serializeWorkspaceBackup(inputs,"0.61.0",next),restored=restoreWorkspacePlans(text,parseWorkspaceBackup(text))!;
 expect(restored.pallets).toEqual(next.pallets);expect(restored.placements).toEqual(next.placements);expect(deliveryIdentityState(restored)).toBe("current");
 const bad=structuredClone(next),p=bad.pallets![1],old={...p};p.x=bad.pallets![0].x+510;p.y=bad.pallets![0].y;
 bad.placements=bad.placements.map(b=>b.palletIds?.includes(p.id)?{...b,x:b.x+p.x-old.x,y:b.y+p.y-old.y}:b);
 expect(()=>restorePackingSnapshot(request,bad)).toThrow();
});
it("allows intact translation but refuses rotation or local edits with stale measurements",()=>{
 const {request,plan,document}=fixture(),next=repackMeasuredUnits(plan,document,request.products);
 const p=next.pallets![0],boxes=next.placements.map(b=>({...b,z:b.z+1}));expect(()=>revisePackingResult(next,boxes,request.products)).toThrow();
 const shifted=structuredClone(next);shifted.pallets![0].orientation="WLH";
 expect(()=>restorePackingSnapshot(request,shifted)).toThrow();expect(p.measuredEnvelope).toBeDefined();
});
it("keeps measured data and zero-based envelope bounds in isolated unit inspection",()=>{
 const {request,plan,document}=fixture(),next=repackMeasuredUnits(plan,document,request.products),p=next.pallets![0],unit=isolatePalletPlan(next,p.id);
 expect(unit.container).toMatchObject({length:600,width:600,height:350});expect(palletLoadEnvelope(unit.pallets![0],unit.placements)).toEqual({x:0,y:0,z:0,dx:600,dy:600,dz:350});expect(unit.pallets![0]).toMatchObject({x:20,y:20,dx:500,dy:500,dz:100});expect(unit.metrics.grossWeight).toBe(30);
});
it("exports separate measured occupancy without changing physical base dimensions or CSV alignment",()=>{
 const {request,plan,document}=fixture(),next=issueDeliveryIdentity(repackMeasuredUnits(plan,document,request.products)),records=parseCsvRecords(buildPlacementCsv(next)),header=records[0],column=header.indexOf("实测保守装载包络JSON");
 expect(column).toBeGreaterThan(0);for(const row of records)expect(row).toHaveLength(header.length);
 const row=records.find(r=>r[1]===next.pallets![0].id)!;const envelope=JSON.parse(row[column]);expect(envelope).toMatchObject({dx:600,dy:600,dz:350,source:"QA ruler"});expect(row[header.indexOf("长(mm)")]).toBe("500");
 const projection=projectionBoxes(next.pallets!,next.placements).find(b=>b.id.startsWith("measured-envelope/"));expect(projection).toMatchObject({dx:600,dy:600,dz:350,weight:0,supportOnly:true});
});
it("escapes measurement provenance and provides an English report with measured occupancy",()=>{
 const {request,plan,document}=fixture();document.units[0].source="QA <script>alert(1)</script>";const next=repackMeasuredUnits(plan,document,request.products),html=measuredEnvelopeHtml(next,true);
 expect(html).toContain("600 × 600 × 350");expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
it("preserves non-1:1 complete kits on their original units",()=>{
 const f=fixture(),a={...f.request.products[0],id:"a",sku:"A",length:250,width:250,quantity:2,setCode:"KIT",unitsPerSet:1},b={...a,id:"b",sku:"B",quantity:4,unitsPerSet:2},request={...f.request,products:[a,b]},plan=issueDeliveryIdentity(packLoadingWorkflow(request)),document=emptyEngineeringDocument(plan);
 document.units=plan.pallets!.map(p=>({...f.document.units[0],palletId:p.id}));const next=repackMeasuredUnits(plan,document,request.products);
 expect(next.placements).toHaveLength(6);for(const p of next.pallets!){const rows=cargo(next,p.id);expect(rows.filter(b=>b.sku==="A")).toHaveLength(1);expect(rows.filter(b=>b.sku==="B")).toHaveLength(2);expect(new Set(rows.map(b=>b.setNumber)).size).toBe(1);}
});
it("refuses stripping occupancy during manual moves and changing local contents through the pallet editor",()=>{
 const {request,plan,document}=fixture(),next=repackMeasuredUnits(plan,document,request.products),stripped=next.pallets!.map(p=>({...p,measuredEnvelope:undefined}));
 expect(()=>revisePackingResult(next,next.placements,request.products,stripped)).toThrow(/cannot remove/);
 expect(()=>editPalletContents(next,request.products,next.pallets![0].id,{type:"remove",ids:[next.placements[0].id]})).toThrow();
});
