import {describe,expect,it} from "vitest";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {packLoadingWorkflow} from "./pack-loading";
import {editPalletContents,palletLayoutTargets,palletLocalBox} from "./pallet-edit";
import {editPlan} from "./plan-edit";
import {capturePreparedPalletLayout,palletPreparationRequest,type PreparedPalletLayout} from "./prepared-pallet-layout";
import {unitContentsKey} from "./unit-envelope";
import type {PackingRequest,PackingResult,ProductInput} from "./types";

const a:ProductInput={id:"a",sku:"A",name:"A",length:400,width:300,height:150,weight:18,quantity:4,
  priority:50,rotationPolicy:"upright",stackable:true,maxTopLoadKg:500,maxStackLayers:0,color:"#338877",setCode:"PAIR",unitsPerSet:1};
const b:ProductInput={...a,id:"b",sku:"B",length:300,weight:14,color:"#cc8833"};
const build={...DEFAULT_PALLET_BUILD,maxPallets:4,primaryRule:{maxPallets:4,cartonLimit:2},
  config:{...DEFAULT_PALLET_BUILD.config,length:1000,width:800,height:50,maxCargoHeight:150,gap:0,layout:"auto" as const}};
const request:PackingRequest={workflow:"palletized",mode:"mixed",strategy:"practical",clearance:0,
  container:{id:"test",name:"Test",length:6500,width:1000,height:1800,doorWidth:1000,doorHeight:1800,maxWeight:4000},
  products:[a,b],palletBuild:build};

const boxesFor=(plan:PackingResult,id:string)=>plan.placements.filter(b=>b.palletIds?.[0]===id);
const layoutFor=(plan:PackingResult,id:string)=>{
  const pallet=plan.pallets!.find(p=>p.id===id)!;
  return boxesFor(plan,id).map(b=>palletLocalBox(b,pallet)).sort((a,b)=>a.productId.localeCompare(b.productId))
    .map(({productId,x,y,z,orientation,orientationSigns})=>({productId,x,y,z,orientation,orientationSigns}));
};
const moveSource=(plan:PackingResult,id:string)=>
  editPalletContents(plan,request.products,id,{type:"move",ids:boxesFor(plan,id).map(b=>b.id),delta:{x:35,y:0,z:0}});

describe("batch reuse of complete pallet layouts",()=>{
  it("copies only chosen units, retains every carton and kit identity, and feeds both vehicle strategies",()=>{
    const inspection=palletPreparationRequest(request,build);
    const initial=packLoadingWorkflow(inspection);
    const [source,t1,t2,untouched]=initial.pallets!;
    expect(palletLayoutTargets(initial,source.id)).toHaveLength(3);
    const edited=moveSource(initial,source.id);
    const next=editPalletContents(edited,request.products,source.id,{type:"copy-layout",targetIds:[t1.id,t2.id]});
    for(const p of [t1,t2]){
      expect(layoutFor(next,p.id)).toEqual(layoutFor(edited,source.id));
      expect(layoutFor(edited,p.id)).not.toEqual(layoutFor(next,p.id));
    }
    expect(boxesFor(next,source.id)).toEqual(boxesFor(edited,source.id));
    expect(boxesFor(next,untouched.id)).toEqual(boxesFor(edited,untouched.id));
    const identities=(plan:PackingResult)=>plan.placements.map(b=>[b.id,b.productId,b.weight,b.setNumber,b.setCode,b.setItemNumber,b.palletIds]).sort();
    expect(identities(next)).toEqual(identities(initial));
    expect(next.metrics.grossWeight).toBe(initial.metrics.grossWeight);
    expect(next.palletization?.editRevision).toBe(2);
    const preparedPalletLayout=capturePreparedPalletLayout(next);
    for(const strategy of ["practical","maximum"] as const){
      const loaded=packLoadingWorkflow({...request,strategy,preparedPalletLayout});
      expect(loaded.metrics.loadedCount).toBe(8);
      expect(loaded.pallets!.filter(p=>JSON.stringify(layoutFor(loaded,p.id))===JSON.stringify(layoutFor(next,source.id)))).toHaveLength(3);
      expect(loaded.setSummaries[0]?.loadedSets).toBe(4);
    }
  });

  it("uses the target pallet's original length and width axes after a vehicle turn",()=>{
    const initial=packLoadingWorkflow({...request,container:{...request.container,width:2400,doorWidth:2400}});
    const [source,target]=initial.pallets!;
    const ids=boxesFor(initial,target.id).map(b=>b.id);
    const turned=editPlan(initial,request.products,ids,"pallet",{x:5000-target.x,y:-target.y,z:0},0,0,source.orientation===target.orientation);
    expect(turned.pallets!.find(p=>p.id===target.id)?.orientation).not.toBe(source.orientation);
    const edited=moveSource(turned,source.id);
    const next=editPalletContents(edited,request.products,source.id,{type:"copy-layout",targetIds:[target.id]});
    expect(layoutFor(next,target.id)).toEqual(layoutFor(next,source.id));
    expect(next.pallets).toEqual(edited.pallets);
    expect(boxesFor(next,target.id).map(b=>b.orientation)).not.toEqual(boxesFor(next,source.id).map(b=>b.orientation));
  });

  it("allows a locked source and rejects locked, measured and different contents targets before writing any changes",()=>{
    const inspection=palletPreparationRequest(request,build);
    const initial=packLoadingWorkflow(inspection);
    const [source,locked,measured,empty]=initial.pallets!;
    let plan=moveSource(initial,source.id);
    plan=editPalletContents(plan,request.products,source.id,{type:"lock",locked:true});
    plan=editPalletContents(plan,request.products,locked.id,{type:"lock-cargo",locked:true,ids:[boxesFor(plan,locked.id)[0].id]});
    expect(palletLayoutTargets(plan,source.id).find(t=>t.id===locked.id)?.issue).toBe("locked");
    const original=JSON.stringify(plan);
    expect(()=>editPalletContents(plan,request.products,source.id,{type:"copy-layout",targetIds:[empty.id,locked.id]})).toThrow(/锁定/);
    expect(JSON.stringify(plan)).toBe(original);
    expect(()=>editPalletContents(plan,request.products,source.id,{type:"copy-layout",targetIds:[source.id]})).toThrow(/目标托盘/);
    const copied=editPalletContents(plan,request.products,source.id,{type:"copy-layout",targetIds:[empty.id]});
    expect(layoutFor(copied,empty.id)).toEqual(layoutFor(copied,source.id));
    expect(()=>editPalletContents(copied,request.products,source.id,{type:"copy-layout",targetIds:[empty.id]})).toThrow(/摆放已一致/);
    plan=editPalletContents(plan,request.products,empty.id,{type:"remove",ids:[boxesFor(plan,empty.id)[0].id]});
    plan={...plan,pallets:plan.pallets!.map(p=>p.id===measured.id?{...p,measuredEnvelope:{
      version:1,length:p.dx,width:p.dy,height:200,noseProtrusion:0,leftProtrusion:0,source:"fixture",date:"2026-11-16",
      contentsKey:unitContentsKey(p,boxesFor(plan,p.id)),
    }}:p)};
    expect(palletLayoutTargets(plan,source.id).map(t=>t.issue)).toEqual(["locked","measured","contents"]);
  });

  it("blocks a mixed batch if copying a tall pattern would remove support for another loaded pallet",()=>{
    const carton:ProductInput={...a,length:400,width:400,height:100,quantity:6,setCode:""};
    const palletBuild={...build,maxPallets:3,stackLayers:3,maxTopLoadKg:1000,
      config:{...build.config,length:800,width:400,height:25,maxCargoHeight:400,layout:"long" as const}};
    const makeUnit=(stacked:boolean)=>({specificationId:"primary",cartons:[0,1].map(i=>({
      productId:carton.id,x:stacked?0:i*400,y:0,z:stacked?i*100:0,dx:400,dy:400,dz:100,weight:carton.weight,
      layer:stacked?i+1:1,orientation:"LWH",
    }))});
    const preparedPalletLayout:PreparedPalletLayout={version:1,units:[makeUnit(true),makeUnit(false),makeUnit(false)]};
    const plan=packLoadingWorkflow({...request,strategy:"maximum",products:[carton],palletBuild,preparedPalletLayout,
      container:{...request.container,length:800,width:800,doorWidth:800}});
    expect(plan.metrics.loadedCount).toBe(6);
    const source=plan.pallets!.find(p=>layoutFor(plan,p.id).some(b=>b.z===100))!;
    const top=plan.pallets!.find(p=>p.z>0)!;
    const lower=plan.pallets!.find(p=>p.z===0&&p.x===top.x&&p.y===top.y)!;
    expect(source.id).not.toBe(top.id);
    expect(source.id).not.toBe(lower.id);
    expect(palletLayoutTargets(plan,source.id).find(t=>t.id===lower.id)?.issue).toBeUndefined();
    const before=JSON.stringify(plan);
    expect(()=>editPalletContents(plan,[carton],source.id,{type:"copy-layout",targetIds:[top.id,lower.id]})).toThrow();
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("copies a 600-carton preparation in one validated transaction across 119 target pallets",()=>{
    const carton:ProductInput={...a,length:200,width:160,quantity:600,setCode:""};
    const palletBuild={...build,maxPallets:120,primaryRule:{maxPallets:120,cartonLimit:5}};
    const input={...request,workflow:"pallet-only" as const,products:[carton],palletBuild};
    const initial=packLoadingWorkflow(input);
    expect(initial.pallets).toHaveLength(120);
    const [source,...targets]=initial.pallets!;
    const edit=editPalletContents(initial,input.products,source.id,{type:"move",ids:boxesFor(initial,source.id).map(b=>b.id),delta:{x:20,y:0,z:0}});
    const next=editPalletContents(edit,input.products,source.id,{type:"copy-layout",targetIds:targets.map(p=>p.id)});
    expect(next.metrics.loadedCount).toBe(600);
    expect(next.palletization?.editRevision).toBe(2);
    const fingerprint=(plan:PackingResult,id:string)=>layoutFor(plan,id).map(b=>`${b.x}/${b.y}/${b.z}/${b.orientation}`).sort().join("|");
    const expected=fingerprint(edit,source.id);
    expect(targets.every(p=>fingerprint(next,p.id)===expected)).toBe(true);
    expect(next.validation.valid).toBe(true);
  });
});
