import { describe, expect, it } from "vitest";
import { editPalletContents, palletLayers, palletLocalBox, palletOrderPool, palletWorldBox } from "./pallet-edit";
import { packLoadingWorkflow } from "./pack-loading";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { validatePalletizedCargo, visiblePlanPallets } from "./prebuilt-pallets";
import { DEFAULT_PACKAGING } from "./packaging";
import { auditPackingResult } from "./result-audit";
import { editPlan } from "./plan-edit";
import { fieldPlanFingerprint } from "./execution";
import { parseWorkspaceBackup, restoreWorkspacePlans, serializeWorkspaceBackup } from "./workspace-file";
import type { PackingRequest, ProductInput } from "./types";

const product:ProductInput={id:"p",sku:"P",name:"P",length:400,width:300,height:200,weight:10,quantity:20,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const build={...DEFAULT_PALLET_BUILD,maxPallets:2,config:{...DEFAULT_PALLET_BUILD.config,length:800,width:600,height:100,maxCargoHeight:400,weight:25}};
const request:PackingRequest={workflow:"pallet-only",mode:"mixed",strategy:"maximum",container:{id:"c",name:"C",length:5000,width:2500,height:2500,doorWidth:2500,doorHeight:2500,maxWeight:10000},clearance:0,products:[product],palletBuild:build};
const make=()=>packLoadingWorkflow(request);

describe("complete-plan pallet contents transactions",()=>{
  it("inverts local and world coordinates for both pallet orientations, asymmetric turns and an elevated deck",()=>{
    const p=make().pallets![0],box={...make().placements[0],x:40,y:50,z:80,dx:400,dy:300,orientation:"LWH"};
    for(const orientation of ["LWH","WLH"] as const){const pallet={...p,orientation,x:1000,y:2000,z:300,dx:orientation==="LWH"?800:600,dy:orientation==="LWH"?600:800};const actual=palletLocalBox(palletWorldBox(box,pallet),pallet);expect(actual).toMatchObject({x:40,y:50,z:80,dx:400,dy:300,dz:box.dz,orientation:"LWH"});}
  });
  it("returns deleted boxes to the order pool and rebuilds counts, volume, tare and revision without mutating the source",()=>{
    const plan=make(),before=JSON.stringify(plan),p=plan.pallets![0],ids=plan.placements.filter(b=>b.palletIds?.includes(p.id)&&b.z===300).map(b=>b.id);
    const next=editPalletContents(plan,[product],p.id,{type:"remove",ids});
    expect(ids).toHaveLength(4);expect(next.metrics.loadedCount).toBe(plan.metrics.loadedCount-4);expect(next.metrics.grossWeight).toBe(plan.metrics.grossWeight-40);
    expect(palletOrderPool(next,[product])[0].remaining).toBe(8);expect(next.palletization?.editRevision).toBe(1);expect(auditPackingResult(next,[product]).hasErrors).toBe(false);
    expect(fieldPlanFingerprint(next)).not.toBe(fieldPlanFingerprint(plan));expect(JSON.stringify(plan)).toBe(before);
    const copied=editPalletContents(next,[product],p.id,{type:"copy-layer",bottom:0});expect(copied.metrics.loadedCount).toBe(plan.metrics.loadedCount);expect(copied.metrics.grossWeight).toBe(plan.metrics.grossWeight);expect(new Set(copied.placements.map(b=>b.id)).size).toBe(copied.placements.length);
  });
  it("keeps an emptied pallet as a real accounted base and can refill it from the original order",()=>{
    const plan=make(),p=plan.pallets![0],empty=editPalletContents(plan,[product],p.id,{type:"remove",ids:plan.placements.filter(b=>b.palletIds?.includes(p.id)).map(b=>b.id)});
    expect(empty.pallets).toEqual(plan.pallets);expect(empty.metrics.grossWeight).toBe(130);expect(visiblePlanPallets(empty,empty.placements.length).map(p=>p.id)).toContain(p.id);
    const next=editPalletContents(empty,[product],p.id,{type:"add",productId:product.id,position:{x:0,y:0,z:0}});
    expect(next.metrics.loadedCount).toBe(9);expect(next.metrics.grossWeight).toBe(140);expect(auditPackingResult(next,[product]).hasErrors).toBe(false);
  });
  it("rejects unsupported removal, height overflow, collisions, disallowed turns and excess order quantity atomically",()=>{
    const plan=make(),p=plan.pallets![0],base=plan.placements.find(b=>b.palletIds?.includes(p.id)&&b.z===100)!,before=JSON.stringify(plan);
    expect(()=>editPalletContents(plan,[product],p.id,{type:"remove",ids:[base.id]})).toThrow();
    expect(()=>editPalletContents(plan,[product],p.id,{type:"move",ids:[base.id],delta:{x:10,y:0,z:0}})).toThrow();
    expect(()=>editPalletContents(plan,[product],p.id,{type:"copy-layer",bottom:200})).toThrow();
    expect(()=>editPalletContents(plan,[product],p.id,{type:"rotate",ids:[base.id]})).toThrow();
    expect(JSON.stringify(plan)).toBe(before);
    const fullProduct={...product,quantity:16},full=packLoadingWorkflow({...request,products:[fullProduct]});expect(()=>editPalletContents(full,[fullProduct],p.id,{type:"copy-layer",bottom:0})).toThrow(/订单/);
  });
  it("preserves identity and physical orientation through four quarter turns on a partially filled pallet",()=>{
    const plan=make(),p=plan.pallets![0],empty=editPalletContents(plan,[product],p.id,{type:"remove",ids:plan.placements.filter(b=>b.palletIds?.includes(p.id)).map(b=>b.id)});
    let next=editPalletContents(empty,[product],p.id,{type:"add",productId:product.id,position:{x:0,y:0,z:0}});
    const original=next.placements.find(b=>b.palletIds?.includes(p.id))!;
    for(let i=0;i<4;i++)next=editPalletContents(next,[product],p.id,{type:"rotate",ids:[original.id]});
    expect(next.placements.find(b=>b.id===original.id)).toEqual(original);expect(next.metrics.grossWeight).toBe(140);
  });
  it("moves complete kits across pallets with different orientations while keeping every component together",()=>{
    const a={...product,id:"a",sku:"A",length:300,width:200,height:100,quantity:8,setCode:"K",unitsPerSet:1},b={...a,id:"b",sku:"B",length:200},products=[a,b];
    const req={...request,workflow:"palletized" as const,products,palletBuild:{...build,config:{...build.config,maxCargoHeight:100,layout:"auto" as const}}};
    let plan=packLoadingWorkflow(req);expect(plan.pallets!.length).toBeGreaterThan(1);
    const [p,q]=plan.pallets!;plan=editPlan(plan,products,plan.placements.filter(b=>b.palletIds?.includes(q.id)).map(b=>b.id),"pallet",{x:3000-q.x,y:-q.y,z:0},0,0,p.orientation===q.orientation);
    expect(plan.pallets![0].orientation).not.toBe(plan.pallets![1].orientation);
    plan=editPalletContents(plan,products,q.id,{type:"remove",ids:plan.placements.filter(b=>b.palletIds?.includes(q.id)).map(b=>b.id)});
    const one=plan.placements.find(b=>b.palletIds?.includes(p.id))!,number=one.setNumber;
    const next=editPalletContents(plan,products,p.id,{type:"transfer",ids:[one.id],targetId:q.id,position:{x:0,y:0,z:0}});
    expect(next.placements.filter(b=>b.setNumber===number)).toHaveLength(2);expect(next.placements.filter(b=>b.setNumber===number).every(b=>b.palletIds?.[0]===q.id)).toBe(true);
    expect(next.metrics.grossWeight).toBe(plan.metrics.grossWeight);
  });
  it("transfers cargo in local coordinates, respects other pallet locks and protects them in the main editor",()=>{
    const plan=make(),[p,q]=plan.pallets!,top=plan.placements.find(b=>b.palletIds?.includes(q.id)&&b.z===300)!,origin=palletLocalBox(top,q);
    const removed=editPalletContents(plan,[product],q.id,{type:"remove",ids:[top.id]});
    const source=removed.placements.find(b=>b.palletIds?.includes(p.id)&&b.z===300)!;
    const moved=editPalletContents(removed,[product],p.id,{type:"transfer",ids:[source.id],targetId:q.id,position:origin});
    expect(moved.placements.find(b=>b.id===source.id)?.palletIds).toEqual([q.id]);expect(moved.metrics.grossWeight).toBe(removed.metrics.grossWeight);
    const locked=editPalletContents(plan,[product],p.id,{type:"lock-others",locked:true}),other=locked.placements.filter(b=>b.palletIds?.includes(q.id));
    expect(()=>editPalletContents(locked,[product],q.id,{type:"remove",ids:[top.id]})).toThrow(/锁定/);
    expect(()=>editPlan(locked,[product],other.map(b=>b.id),"pallet",{x:1,y:0,z:0})).toThrow(/锁定/);
    expect(()=>editPlan(locked,[product],[other[0].id],"selection",{x:1,y:0,z:0})).toThrow(/锁定/);
    const next=editPalletContents(locked,[product],p.id,{type:"remove",ids:locked.placements.filter(b=>b.palletIds?.includes(p.id)&&b.z===300).map(b=>b.id)});
    expect(next.placements.filter(b=>b.palletIds?.includes(q.id))).toEqual(other);
  });
  it("keeps whole 24-set A/B identities and 1296 kg cargo mass, including sparse kit IDs after deletion and backup restoration",()=>{
    const a={...product,id:"a",sku:"A",length:1280,width:540,height:110,weight:40,quantity:24,setCode:"KIT",unitsPerSet:1},b={...a,id:"b",sku:"B",length:680,weight:14},products=[a,b];
    const req={...request,products,palletBuild:{...build,maxPallets:30,config:{...build.config,length:2000,width:1200,maxCargoHeight:220}}};
    const plan=packLoadingWorkflow(req);expect(plan.placements).toHaveLength(48);expect(plan.metrics.grossWeight-plan.pallets!.reduce((n,p)=>n+p.weight,0)).toBe(1296);
    const first=plan.placements.find(b=>b.setNumber===1)!,p=plan.pallets!.find(p=>p.id===first.palletIds![0])!;
    // Remove the entire first pallet's contents so no retained carton loses support.
    const locked=editPalletContents(plan,products,p.id,{type:"lock-others",locked:true});
    const next=editPalletContents(locked,products,p.id,{type:"remove",ids:plan.placements.filter(b=>b.palletIds?.includes(p.id)).map(b=>b.id)});
    expect(next.placements.every(b=>b.setNumber!==1)).toBe(true);expect(auditPackingResult(next,products).hasErrors).toBe(false);
    expect(next.placements.filter(b=>b.palletIds?.[0]!==p.id)).toEqual(plan.placements.filter(b=>b.palletIds?.[0]!==p.id));
    const inputs={...req,mode:"mixed" as const,strategy:"maximum" as const,practicalTargetPercent:95,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
    const file=serializeWorkspaceBackup(inputs,"0.29.0",next),parsed=parseWorkspaceBackup(file),restored=restoreWorkspacePlans(file,parsed)!;
    expect(restored.placements).toEqual(next.placements);expect(restored.palletization?.editRevision).toBe(next.palletization?.editRevision);expect(restored.metrics.grossWeight).toBe(next.metrics.grossWeight);expect(restored.pallets).toEqual(next.pallets);
    expect(()=>editPalletContents(next,products,p.id,{type:"add",productId:a.id,position:{x:0,y:0,z:0}})).not.toThrow();
  });
  it("uses crate interior clearance and refuses a candidate exceeding actual pallet load",()=>{
    const crateProducts=[{...product,quantity:25}],crate=packLoadingWorkflow({...request,products:crateProducts,palletBuild:{...build,config:{...build.config,length:1000,width:800,packaging:{...DEFAULT_PACKAGING,enclosure:"panel",wallThickness:50}}}}),p=crate.pallets![0];
    expect(()=>editPalletContents(crate,crateProducts,p.id,{type:"add",productId:product.id,position:{x:0,y:0,z:0}})).toThrow(/净空/);
    expect(validatePalletizedCargo([], [p], {...crate.container,height:200,doorHeight:200},0,{...crate.palletization!,only:false,editRevision:1},[product]).some(e=>e.includes("height"))).toBe(true);
    const low={...request,palletBuild:{...build,config:{...build.config,maxLoad:10}},products:[{...product,quantity:4}]},plan=packLoadingWorkflow(low),unit=plan.pallets![0];
    expect(()=>editPalletContents(plan,low.products,unit.id,{type:"add",productId:product.id,position:{x:400,y:0,z:0}})).toThrow();
    expect(palletLayers(plan,unit.id).map(l=>l.bottom)).toEqual([0]);
  });
  it("does not bypass stock-limited packaging SKU eligibility when adding cargo from the pool",()=>{
    const other={...product,id:"other",sku:"OTHER",length:100,width:100,height:100,weight:1,quantity:1},products=[product,other];
    const plan=packLoadingWorkflow({...request,products,palletBuild:{...build,primaryRule:{maxPallets:2,productIds:[product.id]}}}),p=plan.pallets![0];
    const draft=editPalletContents(plan,products,p.id,{type:"remove",ids:plan.placements.filter(b=>b.palletIds?.includes(p.id)).map(b=>b.id)}),before=JSON.stringify(draft);
    expect(()=>editPalletContents(draft,products,p.id,{type:"add",productId:other.id,position:{x:0,y:0,z:0}})).toThrow(/eligible/);
    expect(JSON.stringify(draft)).toBe(before);
  });
});
