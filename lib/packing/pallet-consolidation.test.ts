import {describe,expect,it} from "vitest";
import {packLoadingWorkflow} from "./pack-loading";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {consolidatePalletContents,consolidatePalletOrder} from "./pallet-consolidation";
import {editPalletContents,editPalletOrder,palletContentsSourceKey,palletLocalBox,palletOrderPool,type PalletConsolidationEdit} from "./pallet-edit";
import {capturePreparedPalletLayout,palletPreparationRequest,type PreparedPalletLayout} from "./prepared-pallet-layout";
import {auditPackingResult} from "./result-audit";
import {unitContentsKey} from "./unit-envelope";
import type {PackingRequest,PackingResult,ProductInput} from "./types";

const carton:ProductInput={id:"a",sku:"A",name:"A",length:400,width:200,height:100,weight:10,quantity:4,
  priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:500,color:"#237789"};
const config={...DEFAULT_PALLET_BUILD.config,length:800,width:600,height:50,maxCargoHeight:100};
const build={...DEFAULT_PALLET_BUILD,config,maxPallets:6,primaryRule:{maxPallets:6,cartonLimit:6}};
const vehicle={id:"c",name:"Container",length:4000,width:2400,height:2300,doorWidth:2400,doorHeight:2300,maxWeight:12000};
const base:PackingRequest={mode:"mixed",workflow:"palletized",strategy:"practical",clearance:0,container:vehicle,products:[carton],palletBuild:build};
type Unit=PreparedPalletLayout["units"][number];

function place(p:ProductInput,x=0,y=0,z=0):Unit["cartons"][number]{
  return {productId:p.id,x,y,z,dx:p.length,dy:p.width,dz:p.height,layer:Math.round(z/p.height)+1,weight:p.weight,orientation:"LWH"};
}
const unit=(cartons:Unit["cartons"],specificationId="primary"):Unit=>({specificationId,cartons});
const cargo=(plan:PackingResult,id:string)=>plan.placements.filter(b=>b.palletIds?.[0]===id);
const prep=(request:PackingRequest,units:Unit[])=>packLoadingWorkflow({...palletPreparationRequest(request,request.palletBuild!),preparedPalletLayout:{version:1,units}});

function kits(){
  const a={...carton,quantity:5,setCode:"SET",unitsPerSet:1};
  const b={...a,id:"b",sku:"B",quantity:10,weight:12,unitsPerSet:2};
  const products=[a,b];
  const kit=(n:number,x=0)=>[a,b,b].map((p,i)=>({...place(p,x,i*200),setCode:"SET",setNumber:n,setItemNumber:i+1}));
  const input={...base,products};
  const plan=prep(input,[unit(kit(1)),unit(kit(2)),unit([...kit(3),...kit(4,400)])]);
  return {plan,input,products};
}

describe("consolidating selected pallets",()=>{
  it("releases one tail, retains 1:2 kit and carton IDs, and applies the reduced pallet count to both loading strategies",()=>{
    const {plan,products,input}=kits();
    const [first,second,third]=plan.pallets!;
    const source=editPalletContents(plan,products,third.id,{type:"lock",locked:true});
    const untouched=JSON.stringify(source);
    const report=consolidatePalletContents(source,products,first.id,[first.id,second.id]);
    expect(report.candidate,report.issues.join(" | ")).toBeTruthy();
    const {edit,units,kitsMoved,tareSavedKg}=report.candidate!;
    expect(edit.moves).toHaveLength(3);
    expect(units.map(u=>u.after).sort()).toEqual([0,6]);
    expect(kitsMoved).toBe(1);
    expect(tareSavedKg).toBe(25);
    const result=editPalletContents(source,products,first.id,edit);
    expect(result.pallets).toEqual(source.pallets!.filter(p=>p.id!==edit.releaseId));
    expect(result.metrics.grossWeight).toBe(source.metrics.grossWeight-25);
    expect(result.palletization?.preparedCount).toBe(2);
    expect(result.palletization?.preparedBySpecification).toEqual({primary:2});
    expect(palletOrderPool(result,products)).toEqual(palletOrderPool(source,products));
    expect(cargo(result,third.id)).toEqual(cargo(source,third.id));
    for(const box of source.placements){
      const other=result.placements.find(b=>b.id===box.id);
      expect(other).toMatchObject({productId:box.productId,setCode:box.setCode,setNumber:box.setNumber,setItemNumber:box.setItemNumber,weight:box.weight});
    }
    expect(auditPackingResult(result,products).hasErrors).toBe(false);
    expect(JSON.stringify(source)).toBe(untouched);
    const preparedPalletLayout=capturePreparedPalletLayout(result);
    for(const strategy of ["practical","maximum"] as const){
      const loaded=packLoadingWorkflow({...input,strategy,preparedPalletLayout});
      expect(loaded.metrics.loadedCount).toBe(12);
      expect(loaded.pallets).toHaveLength(2);
      expect(loaded.setSummaries[0].loadedSets).toBe(4);
    }
  });

  it("allocates a mixed tail across two locked-carton receivers with different allowed SKUs",()=>{
    const a={...carton,quantity:2},b={...a,id:"b",sku:"B"};
    const products=[a,b];
    const rule=(id:string,productId:string)=>({id,config,maxPallets:1,productIds:[productId],cartonLimit:2,stackLayers:1,maxTopLoadKg:0});
    const palletBuild={...build,mix:"mixed" as const,additionalSpecs:[rule("a-only",a.id),rule("b-only",b.id)]};
    const plan=prep({...base,products,palletBuild},[unit([place(a),place(b,400)]),unit([place(a)],"a-only"),unit([place(b)],"b-only")]);
    const [donor,first,second]=plan.pallets!;
    let source=editPalletContents(plan,products,first.id,{type:"lock-cargo",ids:cargo(plan,first.id).map(b=>b.id),locked:true});
    source=editPalletContents(source,products,second.id,{type:"lock-cargo",ids:cargo(source,second.id).map(b=>b.id),locked:true});
    const report=consolidatePalletContents(source,products,first.id,[first.id,donor.id,second.id]);
    const result=report.candidate;
    expect(result?.edit.releaseId,report.issues.join(" | ")).toBe(donor.id);
    expect(new Set(result?.edit.moves.map(move=>move.targetId))).toEqual(new Set([first.id,second.id]));
    const applied=editPalletContents(source,products,first.id,result!.edit);
    expect(cargo(applied,first.id).map(b=>b.sku)).toEqual(["A","A"]);
    expect(cargo(applied,second.id).map(b=>b.sku)).toEqual(["B","B"]);
    for(const box of source.placements.filter(b=>b.locked))expect(applied.placements.find(b=>b.id===box.id)).toEqual(box);
    expect(applied.palletization?.preparedBySpecification).toEqual({primary:0,"a-only":1,"b-only":1});
  });

  it("repositions movable receiver cartons when no original gap fits the donor",()=>{
    const products=[{...carton,quantity:2}];
    const palletBuild={...build,config:{...config,width:400}};
    const plan=prep({...base,products,palletBuild},[unit([place(products[0],200,100)]),unit([place(products[0],200,100)])]);
    const [a,b]=plan.pallets!;
    const candidate=consolidatePalletContents(plan,products,a.id,[a.id,b.id]).candidate;
    expect(candidate?.edit.moves).toHaveLength(2);
    const result=editPalletContents(plan,products,a.id,candidate!.edit);
    const receiver=result.pallets![0];
    expect(cargo(result,receiver.id).map(b=>palletLocalBox(b,receiver).y)).toEqual([0,0]);
    expect(result.metrics.loadedCount).toBe(2);
    expect(result.pallets).toHaveLength(1);
  });

  it("releases an upper pallet when legal and keeps the base if another unit depends on it",()=>{
    const p={...carton,width:400,quantity:3};
    const products=[p];
    const palletBuild={...build,config:{...config,width:400,maxCargoHeight:400,layout:"long" as const},stackLayers:3,maxTopLoadKg:1000};
    const request={...base,products,palletBuild,container:{...vehicle,length:800,width:400,doorWidth:400},
      preparedPalletLayout:{version:1 as const,units:[unit([place(p),place(p,400)]),unit([place(p)])]}};
    const plan=packLoadingWorkflow(request);
    const [lower,upper]=[...plan.pallets!].sort((a,b)=>a.z-b.z);
    expect(upper.z).toBe(150);
    const ids=[lower.id,upper.id];
    const report=consolidatePalletContents(plan,products,lower.id,ids);
    expect(report.candidate?.edit.releaseId).toBe(upper.id);
    const applied=editPalletContents(plan,products,lower.id,report.candidate!.edit);
    expect(applied.pallets).toEqual([lower]);
    expect(applied.metrics.loadedCount).toBe(3);
    const locked=editPalletContents(plan,products,upper.id,{type:"lock-cargo",locked:true,ids:cargo(plan,upper.id).map(b=>b.id)});
    expect(consolidatePalletContents(locked,products,lower.id,ids).candidate).toBeNull();
    const forged:PalletConsolidationEdit={type:"consolidate",palletIds:ids,releaseId:lower.id,sourceKey:palletContentsSourceKey(locked,products,lower.id),
      moves:cargo(locked,lower.id).map((b,i)=>({cartonId:b.id,targetId:upper.id,pose:place(p,i*400,0,100-i*100)}))};
    expect(()=>editPalletContents(locked,products,lower.id,forged)).toThrow();
    expect(locked.pallets).toHaveLength(2);
  });

  it("rejects stale, partial, out-of-scope and measured-pallet candidates",()=>{
    const {plan,products}=kits();
    const [a,b,c]=plan.pallets!,ids=[a.id,b.id];
    const edit=consolidatePalletContents(plan,products,a.id,ids).candidate!.edit;
    const changed=editPalletContents(plan,products,c.id,{type:"lock",locked:true});
    expect(()=>editPalletContents(changed,products,a.id,edit)).toThrow(/预览已失效/);
    expect(()=>editPalletContents(plan,products,a.id,{...edit,moves:edit.moves.slice(1)})).toThrow(/移完/);
    expect(()=>editPalletContents(plan,products,a.id,{...edit,moves:edit.moves.map(move=>({...move,targetId:c.id}))})).toThrow(/移完/);
    const measured={...plan,pallets:plan.pallets!.map(p=>p.id===b.id?{...p,measuredEnvelope:{version:1 as const,length:p.dx,width:p.dy,height:150,noseProtrusion:0,leftProtrusion:0,source:"fixture",date:"2026-11-17",contentsKey:unitContentsKey(p,cargo(plan,p.id))}}:p)};
    expect(()=>consolidatePalletContents(measured,products,a.id,ids)).toThrow(/实测包络/);
    expect(plan.metrics.loadedCount).toBe(12);
  });
});

describe("order-wide pallet reductions",()=>{
  it("releases a loaded upper pallet without changing cargo counts or the lower pallet position",()=>{
    const p={...carton,width:400,quantity:3};
    const products=[p];
    const palletBuild={...build,config:{...config,width:400,maxCargoHeight:400,layout:"long" as const},stackLayers:3,maxTopLoadKg:1000};
    const request={...base,products,palletBuild,container:{...vehicle,length:800,width:400,doorWidth:400},
      preparedPalletLayout:{version:1 as const,units:[unit([place(p),place(p,400)]),unit([place(p)])]}};
    const plan=packLoadingWorkflow(request);
    const [lower,upper]=[...plan.pallets!].sort((a,b)=>a.z-b.z);

    const candidate=consolidatePalletOrder(plan,products).candidate;
    expect(candidate).toMatchObject({beforePallets:2,afterPallets:1,cartons:3,tareSavedKg:25});
    expect(candidate?.edit.steps.map(step=>step.releaseId)).toEqual([upper.id]);
    const adjusted=editPalletOrder(plan,products,candidate!.edit);
    expect(adjusted.pallets).toEqual([lower]);
    expect(adjusted.placements.map(box=>box.id).sort()).toEqual(plan.placements.map(box=>box.id).sort());
    expect(auditPackingResult(adjusted,products).hasErrors).toBe(false);

    const locked=editPalletContents(plan,products,upper.id,{type:"lock-cargo",ids:cargo(plan,upper.id).map(box=>box.id),locked:true});
    expect(consolidatePalletOrder(locked,products).candidate).toBeNull();
  });

  it("finds two reductions across prepared units and carries the complete kits into both loading strategies",()=>{
    const {input,products}=kits();
    const a=products[0],b=products[1];
    const kit=(n:number)=>[a,b,b].map((p,i)=>({...place(p,0,i*200),setCode:"SET",setNumber:n,setItemNumber:i+1}));
    let plan=prep(input,[1,2,3,4,5].map(n=>unit(kit(n))));
    const protectedId=plan.pallets![0].id;
    plan=editPalletContents(plan,products,protectedId,{type:"lock",locked:true});
    const report=consolidatePalletOrder(plan,products);
    expect(report.protectedPallets).toBe(1);
    expect(report.candidate).toMatchObject({beforePallets:5,afterPallets:3,cartons:15,tareSavedKg:50});
    const edit=report.candidate!.edit;
    expect(edit.steps).toHaveLength(2);
    expect(edit.steps.flatMap(step=>step.palletIds)).not.toContain(protectedId);
    const original=JSON.stringify(plan);
    const reduced=editPalletOrder(plan,products,edit);
    expect(cargo(reduced,protectedId)).toEqual(cargo(plan,protectedId));
    expect(reduced.metrics.grossWeight).toBe(plan.metrics.grossWeight-50);
    expect(reduced.palletization?.preparedBySpecification).toEqual({primary:3});
    expect(reduced.placements.map(b=>[b.id,b.setCode,b.setNumber,b.setItemNumber]).sort()).toEqual(
      plan.placements.map(b=>[b.id,b.setCode,b.setNumber,b.setItemNumber]).sort(),
    );
    expect(palletOrderPool(reduced,products)).toEqual(palletOrderPool(plan,products));
    const preparedPalletLayout=capturePreparedPalletLayout(reduced);
    for(const strategy of ["practical","maximum"] as const){
      const full=packLoadingWorkflow({...input,strategy,preparedPalletLayout});
      expect(full.pallets).toHaveLength(3);
      expect(full.metrics.loadedCount).toBe(15);
      expect(full.setSummaries[0].loadedSets).toBe(5);
      expect(auditPackingResult(full,products).hasErrors).toBe(false);
    }
    expect(JSON.stringify(plan)).toBe(original);
    expect(consolidatePalletOrder(reduced,products).candidate).toBeNull();
  });

  it("finds a tail that must split across different eligible packaging specifications",()=>{
    const a={...carton,quantity:2},b={...a,id:"b",sku:"B"};
    const products=[a,b];
    const rule=(id:string,productId:string)=>({id,config,maxPallets:1,productIds:[productId],cartonLimit:2,stackLayers:1,maxTopLoadKg:0});
    const palletBuild={...build,mix:"mixed" as const,additionalSpecs:[rule("a-only",a.id),rule("b-only",b.id)]};
    const plan=prep({...base,products,palletBuild},[unit([place(a),place(b,400)]),unit([place(a)],"a-only"),unit([place(b)],"b-only")]);
    const [tail,first,second]=plan.pallets!;
    let locked=editPalletContents(plan,products,first.id,{type:"lock-cargo",ids:cargo(plan,first.id).map(b=>b.id),locked:true});
    locked=editPalletContents(locked,products,second.id,{type:"lock-cargo",ids:cargo(locked,second.id).map(b=>b.id),locked:true});
    const candidate=consolidatePalletOrder(locked,products).candidate;
    expect(candidate?.edit.steps.map(step=>step.releaseId)).toEqual([tail.id]);
    const reduced=editPalletOrder(locked,products,candidate!.edit);
    expect(cargo(reduced,first.id).map(b=>b.sku)).toEqual(["A","A"]);
    expect(cargo(reduced,second.id).map(b=>b.sku)).toEqual(["B","B"]);
  });

  it("rejects stale or malformed batches and leaves both source and prior reductions intact",()=>{
    const products=[{...carton,quantity:4}];
    const palletBuild={...build,primaryRule:{...build.primaryRule,cartonLimit:2}};
    const plan=prep({...base,products,palletBuild},Array.from({length:4},()=>unit([place(products[0])])));
    const candidate=consolidatePalletOrder(plan,products).candidate!;
    expect(candidate.edit.steps).toHaveLength(2);
    const locked=editPalletContents(plan,products,plan.pallets![0].id,{type:"lock",locked:true});
    expect(()=>editPalletOrder(locked,products,candidate.edit)).toThrow(/预览已失效/);
    const [first,second]=candidate.edit.steps;
    const original=JSON.stringify(plan);
    expect(()=>editPalletOrder(plan,products,{...candidate.edit,steps:[first,{...second,moves:[]}]})).toThrow(/移完/);
    expect(JSON.stringify(plan)).toBe(original);
    const applied=editPalletOrder(plan,products,candidate.edit);
    expect(applied.pallets).toHaveLength(2);
    expect(applied.metrics.loadedCount).toBe(4);
  });
});
