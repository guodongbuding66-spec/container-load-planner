import { describe, expect, it } from "vitest";
import { bearingErrors, bearingLoads } from "./bearing";
import { allocateFleet } from "./fleet";
import { pack, revisePackingResult, restorePackingSnapshot, validatePacking, explainUnloaded } from "./engine";
import { addArchive, parseArchive } from "./archive";
import { parseWorkspaceBackup, serializeWorkspaceBackup, type WorkspaceInputs } from "./workspace-file";
import type { ContainerSpec, PackingRequest, PlacedBox, ProductInput } from "./types";
const container:ContainerSpec={id:"test",name:"测试柜",length:2000,width:1000,height:2000,doorWidth:1000,doorHeight:2000,maxWeight:10000};
const product:ProductInput={id:"a",sku:"A",name:"测试",length:1000,width:1000,height:500,weight:10,quantity:12,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,color:"#abcdef"};
const request=(products:ProductInput[]=[product]):PackingRequest=>({mode:"mixed",strategy:"maximum",container,clearance:0,products});
const box=(id:string,z:number,weight=10):PlacedBox=>({id,productId:"a",sku:"A",name:"测试",color:"#abcdef",x:0,y:0,z,dx:1000,dy:1000,dz:500,weight,orientation:"LWH",layer:z/500+1});

describe("quantitative bearing",()=>{
  it("propagates all upper-tier mass independent of input order",()=>{
    const boxes=[box("top",1000),box("bottom",0),box("middle",500)];
    const loads=bearingLoads(boxes);
    expect(loads.get("bottom")).toBe(20);expect(loads.get("middle")).toBe(10);
    expect(bearingErrors(boxes,[{...product,maxTopLoadKg:15}])).toHaveLength(1);
  });
  it("splits a bridge's mass across contact areas",()=>{
    const left={...box("left",0),dx:500};const right={...box("right",0),x:500,dx:500};
    const loads=bearingLoads([left,right,box("upper",500,20)]);
    expect(loads.get("left")).toBe(10);expect(loads.get("right")).toBe(10);
  });
  it("rejects overload independently and packs a safe floor-only result for zero bearing",()=>{
    const p={...product,maxTopLoadKg:0};
    expect(validatePacking([box("lower",0),box("upper",500)],container,0,[p],"maximum","mixed").valid).toBe(false);
    const result=pack(request([p]));
    expect(result.validation.valid).toBe(true);expect(result.metrics.loadedCount).toBe(2);
    expect(result.placements.every(b=>b.z===0)).toBe(true);
  });
  it("preserves the total single-product carton limit with 1:2 kits",()=>{
    const a={...product,length:500,width:500,height:500,setCode:"KIT",unitsPerSet:1,maxTopLoadKg:100};
    const b={...a,id:"b",sku:"B",unitsPerSet:2};
    const result=pack({...request([a,b]),mode:"single",singleCartonLimit:3});
    expect(result.validation.valid).toBe(true);expect(result.metrics.loadedCount).toBe(3);expect(result.setSummaries[0].loadedSets).toBe(1);
  });
  it("rejects invalid bearing rules",()=>{expect(()=>pack(request([{...product,maxTopLoadKg:-1}]))).toThrow();});
});

describe("manual plan validation",()=>{
  const plan=()=>pack(request([{...product,quantity:1}]));
  it("recomputes center of gravity after a valid move",()=>{
    const old=plan();const next=revisePackingResult(old,old.placements.map(b=>({...b,x:1000})),[{...product,quantity:1}]);
    expect(next.validation.valid).toBe(true);expect(next.metrics.centerOfGravity.x).toBe(1500);
    expect(next.strategyPlans).toBeUndefined();expect(next.quoteEstimate).toBeUndefined();
    expect(next.metrics.loadedVolume).toBe(old.metrics.loadedVolume);
  });
  it("refuses out-of-bounds moves and preserves original coordinates",()=>{
    const old=plan();expect(()=>revisePackingResult(old,old.placements.map(b=>({...b,x:2000})),[product])).toThrow();expect(old.placements[0].x).toBe(0);
  });
  it("refuses locked movement and movement which leaves upper boxes unsupported",()=>{
    const old=plan();const locked={...old,placements:old.placements.map(b=>({...b,locked:true}))};
    expect(()=>revisePackingResult(locked,locked.placements.map(b=>({...b,x:1000})),[product])).toThrow(/锁定/);
    const stacked=pack(request([{...product,quantity:3}]));
    const elevated=stacked.placements.map(b=>({...b,z:b.z+500}));
    expect(()=>revisePackingResult(stacked,elevated,[product])).toThrow();
  });
  it("explains proven weight bounds without claiming search optimality",()=>{
    const result=pack({...request(),container:{...container,maxWeight:10}});
    expect(explainUnloaded(result,[product])[0].reasons.some(x=>x.includes("剩余载重"))).toBe(true);
  });
});

describe("multi-container order conservation",()=>{
  it("allocates multiple containers without duplicating or losing cartons",()=>{
    const progress:number[]=[];
    const result=allocateFleet(request(),[{container,cost:200,available:5}],5,"count",r=>progress.push(r.loads.length));
    expect(result.complete).toBe(true);expect(result.loads.length).toBe(2);expect(result.totalCost).toBe(400);
    expect(result.loads.reduce((n,l)=>n+l.plan.metrics.loadedCount,0)).toBe(product.quantity);
    expect(result.loads.every(l=>l.plan.validation.valid)).toBe(true);expect(progress).toEqual([1,2]);
  });
  it("keeps mismatched set leftovers visible and never splits a set",()=>{
    const a={...product,length:500,width:500,setCode:"SET",unitsPerSet:1,quantity:5};
    const b={...a,id:"b",sku:"B",quantity:3};
    const result=allocateFleet(request([a,b]),[{container,cost:10,available:5}],5,"count");
    expect(result.complete).toBe(false);expect(result.remaining.map(p=>p.quantity)).toEqual([2,0]);
    expect(result.loads.every(l=>l.plan.setSummaries[0].loadedCartons===l.plan.setSummaries[0].loadedSets*2)).toBe(true);
  });
  it("respects stock limits and keeps an unallocated remainder",()=>{
    const result=allocateFleet(request(),[{container,cost:50,available:1}],5,"count");
    expect(result.loads.length).toBe(1);expect(result.complete).toBe(false);expect(result.remaining[0].quantity).toBe(4);
  });
  it("requires actual prices for the cost objective and chooses the cheaper complete candidate",()=>{
    expect(()=>allocateFleet(request(),[{container,cost:0,available:1}],1,"cost")).toThrow();
    const result=allocateFleet(request([{...product,quantity:1}]),[{container,cost:500,available:1},{container:{...container,id:"cheap"},cost:100,available:1}],1,"cost");
    expect(result.loads[0].plan.container.id).toBe("cheap");
  });
});

describe("versioned workspace archive",()=>{
  const inputs:WorkspaceInputs={...request(),strategy:"maximum",practicalTargetPercent:88,customContainers:[],targetVolumePercent:85,targetWeightPercent:90,lengthUnit:"cm",weightUnit:"kg"};
  it("retains old versions and round-trips bearing rules",()=>{
    const backup=serializeWorkspaceBackup({...inputs,products:[{...product,maxTopLoadKg:15}]},"test");
    const v1=addArchive([],"客户订单","project",backup);const v2=addArchive(v1,"客户订单","project",backup);
    const restored=parseArchive(JSON.stringify(v2));expect(restored.map(e=>e.version)).toEqual([2,1]);expect(parseWorkspaceBackup(restored[0].backup).products[0].maxTopLoadKg).toBe(15);
  });
  it("rejects corrupted files and does not mutate an existing archive",()=>{
    const first=addArchive([],"订单","project",serializeWorkspaceBackup(inputs,"test"));
    expect(()=>addArchive(first,"订单","project",'{}')).toThrow();expect(first).toHaveLength(1);
    expect(()=>parseArchive('[{"name":"bad"}]')).toThrow();
  });
});


describe("saved coordinate integrity",()=>{
  it("rebuilds totals and preserves validated locks instead of trusting archived metrics",()=>{
    const original=pack(request([{...product,quantity:1}]));
    const snapshot={strategy:"maximum",placements:original.placements.map(b=>({...b,locked:true})),metrics:{grossWeight:0,loadedCount:999}};
    const restored=restorePackingSnapshot(request([{...product,quantity:1}]),snapshot);
    expect(restored.metrics.grossWeight).toBe(10);expect(restored.metrics.loadedCount).toBe(1);expect(restored.placements[0].locked).toBe(true);
  });
  it("rejects a forged weight and overlapping or unknown boxes",()=>{
    const original=pack(request([{...product,quantity:1}]));
    const snapshot={strategy:"maximum",placements:original.placements.map(b=>({...b,weight:0}))};
    expect(()=>restorePackingSnapshot(request(),snapshot)).toThrow();
    expect(()=>restorePackingSnapshot(request(),{strategy:"maximum",placements:[original.placements[0],{...original.placements[0],id:"another"}]})).toThrow();
    expect(()=>restorePackingSnapshot(request(),{strategy:"maximum",placements:[{...original.placements[0],productId:"unknown"}]})).toThrow();
  });
});
