import { describe, expect, it } from "vitest";
import { pack } from "./engine";
import { packLoadingWorkflow } from "./pack-loading";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { issueDeliveryIdentity } from "./delivery-identity";
import { appendWeightMeasurement, emptyWeighingRecords, MAX_WEIGHING_BYTES, mergeWeighingRecords, parseWeighingRecords, plannedWeightBreakdown, reconcileMeasurement, weighingCsv, weighingKey, type WeightMeasurement } from "./weighing";
import { parseCsvRecords } from "./csv";
import type { ProductInput } from "./types";
const cargo:ProductInput={id:"cargo",sku:"SHED-BOX",name:"Shed carton",length:500,width:500,height:200,weight:10,quantity:6,priority:50,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,maxStackLayers:0,maxTopLoadKg:100,color:"#337788"};
const raw=pack({mode:"mixed",strategy:"maximum",clearance:0,container:{id:"c",name:"C",length:1500,width:1000,height:500,doorWidth:1000,doorHeight:500,maxWeight:1000},products:[cargo]});
const weighingPlan=issueDeliveryIdentity(raw);
const at="2026-10-21T08:00:00.000Z",measurement:Omit<WeightMeasurement,"id"|"recordedAt"|"scope">={method:"gross-minus-tare",readingKg:3062,tareKg:3000,tareSource:"Container C plate",measuredAt:at,source:"Scale S1",reference:"Ticket T1",note:"Entire completed load"};
const add=(m:Partial<typeof measurement>={},id="reading-1")=>appendWeightMeasurement(weighingPlan,emptyWeighingRecords(weighingPlan),{...measurement,...m},{id,at});
describe("Separate planned and measured complete-load mass",()=>{
  it("does not treat planned mass as a reading and requires an issued valid revision",()=>{
    expect(emptyWeighingRecords(weighingPlan).measurements).toEqual([]);expect(()=>emptyWeighingRecords(raw)).toThrow();expect(()=>emptyWeighingRecords({...weighingPlan,clearance:1})).toThrow();expect(()=>emptyWeighingRecords({...weighingPlan,validation:{...weighingPlan.validation,valid:false}})).toThrow();
  });
  it("separates real pallet tare and accessory mass without counting a reservation or cargo twice",()=>{
    const plan=packLoadingWorkflow({mode:"mixed",workflow:"palletized",strategy:"maximum",clearance:0,products:[cargo],container:{...raw.container,exclusions:[{id:"material",name:"Material",kind:"obstacle",x:1490,y:990,z:0,dx:10,dy:10,dz:10,accessory:{type:"timber",quantity:2,unitWeightKg:3,phase:"before-cargo",relatedProductIds:[],afterAccessoryIds:[],source:"Packing list",revision:"1",note:""}}]},palletBuild:{...DEFAULT_PALLET_BUILD,looseQuantities:{cargo:2},config:{...DEFAULT_PALLET_BUILD.config,length:1000,width:1000,height:100,weight:20,maxCargoHeight:200},stackLayers:1}});
    expect(plan.validation.errors).toEqual([]);expect(plannedWeightBreakdown(plan)).toEqual({cargoKg:60,packagingKg:20,accessoriesKg:6,payloadKg:86,consistent:true});
  });
  it("subtracts tare exactly once and leaves immutable plan counts and coordinates unchanged",()=>{
    const before=JSON.stringify(weighingPlan),r=add(),v=reconcileMeasurement(weighingPlan,r.measurements[0]);expect(v.payloadKg).toBe(62);expect(v.differenceKg).toBe(2);expect(v.differencePercent).toBeCloseTo(100/30);expect(JSON.stringify(weighingPlan)).toBe(before);
  });
  it("accepts direct payload with unknown container tare and handles zero payload without invented percentages",()=>{
    const r=add({method:"payload",readingKg:62,tareKg:null,tareSource:""});expect(reconcileMeasurement(weighingPlan,r.measurements[0]).payloadKg).toBe(62);
    const zero=issueDeliveryIdentity(pack({...raw,products:[{...cargo,weight:0}]}));expect(reconcileMeasurement(zero,r.measurements[0]).differencePercent).toBeNull();
  });
  it.each([{readingKg:-1},{readingKg:Infinity},{tareKg:-1},{tareKg:null},{tareKg:4000},{source:" "},{reference:""},{tareSource:""},{measuredAt:"2026-02-30T08:00:00.000Z"},{method:"payload",tareKg:0},{method:"payload",tareKg:null,tareSource:"plate"}])("rejects invalid or incomplete source readings %j",patch=>{expect(()=>add(patch as Partial<typeof measurement>)).toThrow();});
  it("records overload as evidence and reports the actual excess rather than hiding the reading",()=>{
    const r=add({readingKg:4200}),v=reconcileMeasurement(weighingPlan,r.measurements[0]);expect(v.overPayloadKg).toBe(200);expect(v.differenceKg).toBe(1140);
  });
  it("retains all reweighings and merges duplicates idempotently with atomic conflict rejection",()=>{
    const a=add(),b=add({readingKg:3061,reference:"T2"},"reading-2"),both=mergeWeighingRecords(weighingPlan,a,b);expect(both.measurements).toHaveLength(2);expect(mergeWeighingRecords(weighingPlan,both,a)).toEqual(both);
    expect(()=>mergeWeighingRecords(weighingPlan,a,add({readingKg:3063}))).toThrow(/conflict/i);expect(a.measurements).toHaveLength(1);
  });
  it("rejects old revisions and copied plans even if the geometry is identical",()=>{
    const r=add(),next=issueDeliveryIdentity({...weighingPlan,delivery:{cargo:{customer:"B",destination:"Port",stop:1}}}),copy=issueDeliveryIdentity(weighingPlan,true);for(const plan of [next,copy]){expect(weighingKey(plan)).not.toBe(weighingKey(weighingPlan));expect(()=>parseWeighingRecords(plan,JSON.stringify(r))).toThrow(/revision/);}
  });
  it("blocks inconsistent planned components and unbounded or duplicated imports",()=>{
    expect(plannedWeightBreakdown({...weighingPlan,metrics:{...weighingPlan.metrics,grossWeight:1}}).consistent).toBe(false);
    expect(()=>appendWeightMeasurement({...weighingPlan,metrics:{...weighingPlan.metrics,grossWeight:1}},emptyWeighingRecords(weighingPlan),measurement)).toThrow(/disagree/);
    const r=add();expect(()=>parseWeighingRecords(weighingPlan,JSON.stringify({...r,measurements:[...r.measurements,...r.measurements]}))).toThrow();expect(()=>parseWeighingRecords(weighingPlan," ".repeat(MAX_WEIGHING_BYTES+1))).toThrow(/1 MB/);expect(()=>parseWeighingRecords(weighingPlan,JSON.stringify({...r,measurements:Array.from({length:101},(_,i)=>({...r.measurements[0],id:`m-${i}`}))}))).toThrow();
  });
  it("exports measured and planned components, provenance and safe spreadsheet cells",()=>{
    const r=add({source:"=HYPERLINK(\"x\")",note:"multi\nline, quoted"}),csv=weighingCsv(weighingPlan,r),rows=parseCsvRecords(csv);expect(rows).toHaveLength(2);expect(rows[0]).toContain("measuredPayloadKg");expect(rows[1][13]).toBe("62");expect(rows[1][17]).toBe("60");expect(rows[1][18]).toBe("2");expect(rows[1][8].startsWith("'")).toBe(true);expect(rows[1][21]).toBe("multi\nline, quoted");
  });
});
