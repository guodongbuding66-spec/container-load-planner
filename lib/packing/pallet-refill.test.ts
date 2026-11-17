import {describe,expect,it} from "vitest";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {packLoadingWorkflow} from "./pack-loading";
import {editPalletContents,palletLocalBox,palletOrderPool} from "./pallet-edit";
import {refillPalletContents} from "./pallet-refill";
import {capturePreparedPalletLayout,palletPreparationRequest,type PreparedPalletLayout} from "./prepared-pallet-layout";
import {unitContentsKey} from "./unit-envelope";
import type {PackingRequest,PackingResult,ProductInput} from "./types";

const a:ProductInput={id:"a",sku:"A",name:"A",length:400,width:200,height:150,weight:18,quantity:4,
  priority:50,rotationPolicy:"upright",stackable:true,maxTopLoadKg:500,maxStackLayers:0,color:"#338877",setCode:"KIT",unitsPerSet:1};
const b:ProductInput={...a,id:"b",sku:"B",name:"B",quantity:8,unitsPerSet:2,weight:12,color:"#cc8833"};
const build={...DEFAULT_PALLET_BUILD,maxPallets:2,primaryRule:{maxPallets:2,cartonLimit:6},
  config:{...DEFAULT_PALLET_BUILD.config,length:800,width:600,height:50,maxCargoHeight:150,gap:0}};
const request:PackingRequest={workflow:"palletized",mode:"mixed",strategy:"practical",clearance:0,
  container:{id:"test",name:"Test",length:3000,width:1800,height:1800,doorWidth:1800,doorHeight:1800,maxWeight:4000},
  products:[a,b],palletBuild:build};
const boxesFor=(plan:PackingResult,id:string)=>plan.placements.filter(box=>box.palletIds?.[0]===id);
const carton={...a,setCode:undefined,unitsPerSet:undefined};

function withReturnedKit(){
  const original=packLoadingWorkflow(palletPreparationRequest(request,build));
  const [pallet,other]=original.pallets!;
  const first=boxesFor(original,pallet.id)[0];
  const plan=editPalletContents(original,request.products,pallet.id,{type:"remove",ids:[first.id]});
  return {plan,pallet,other};
}

describe("automatic refill of one pallet",()=>{
  it("refills a complete 1:2 kit, keeps original and locked carton coordinates, and loads the approved layout in both solvers",()=>{
    const {plan,pallet,other}=withReturnedKit();
    const id=pallet.id,products=request.products;
    const locked=editPalletContents(plan,products,id,{type:"lock-cargo",ids:[boxesFor(plan,id)[0].id],locked:true});
    const source=editPalletContents(locked,products,other.id,{type:"lock",locked:true});
    const before=JSON.stringify(source),preview=refillPalletContents(source,products,id);
    expect(preview.additions.map(box=>box.productId).sort()).toEqual(["a","b","b"]);
    expect(preview.kits).toBe(1);
    expect(preview.grossKg).toBe(pallet.weight+84);
    const filled=editPalletContents(source,products,id,{type:"refill",sourceKey:preview.sourceKey,additions:preview.additions});
    expect(filled.validation.valid).toBe(true);
    expect(filled.pallets).toEqual(source.pallets);
    expect(palletOrderPool(filled,products).map(row=>row.remaining)).toEqual([0,0]);
    for(const box of source.placements)expect(filled.placements.find(next=>next.id===box.id)).toEqual(box);
    expect(JSON.stringify(source)).toBe(before);
    const preparedPalletLayout=capturePreparedPalletLayout(filled);
    const signature=(plan:PackingResult)=>plan.pallets!.map(p=>boxesFor(plan,p.id).map(b=>{
      const local=palletLocalBox(b,p);
      return [local.productId,local.x,local.y,local.z,local.dx,local.dy,local.dz].join("/");
    }).sort().join("|")).sort();
    for(const strategy of ["practical","maximum"] as const){
      const loaded=packLoadingWorkflow({...request,strategy,preparedPalletLayout});
      expect(loaded.metrics.loadedCount).toBe(12);
      expect(loaded.setSummaries[0].loadedSets).toBe(4);
      expect(signature(loaded)).toEqual(signature(filled));
    }
  });

  it("rejects stale, incomplete-kit and overlapping candidates without mutating the source",()=>{
    const {plan,pallet,other}=withReturnedKit(),id=pallet.id,products=request.products;
    const r=refillPalletContents(plan,products,id),before=JSON.stringify(plan);
    expect(r.additions).toHaveLength(3);
    const action={type:"refill" as const,sourceKey:r.sourceKey,additions:r.additions};
    const changed=editPalletContents(plan,products,other.id,{type:"lock",locked:true});
    expect(()=>editPalletContents(changed,products,id,action)).toThrow(/预览已失效/);
    expect(()=>editPalletContents(plan,products,id,{...action,additions:r.additions.slice(0,2)})).toThrow(/套装|套内/);
    const occupied=palletLocalBox(boxesFor(plan,id)[0],pallet);
    expect(()=>editPalletContents(plan,products,id,{...action,additions:r.additions.map((b,i)=>i?b:{...b,x:occupied.x,y:occupied.y,z:occupied.z})})).toThrow();
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("accounts for loose reservations, SKU eligibility and the per-pallet carton count",()=>{
    const products=[{...carton,quantity:3},{...carton,id:"other",sku:"OTHER",quantity:4}];
    const input={...request,products,container:{...request.container,length:800,width:600,doorWidth:600,height:200,doorHeight:200},
      palletBuild:{...build,maxPallets:1,primaryRule:{maxPallets:1,productIds:[carton.id],cartonLimit:2},looseQuantities:{[carton.id]:1}}};
    const plan=packLoadingWorkflow(input),p=plan.pallets![0],id=p.id;
    expect(boxesFor(plan,id)).toHaveLength(2);
    expect(palletOrderPool(plan,products).map(row=>row.remaining)).toEqual([1,4]);
    expect(refillPalletContents(plan,products,id).reason).toBe("pallet-full");
    const removed=editPalletContents(plan,products,id,{type:"remove",ids:[boxesFor(plan,id)[0].id]});
    const r=refillPalletContents(removed,products,id);
    expect(r.additions.map(box=>box.productId)).toEqual([carton.id]);
    const higherLimit={...input,palletBuild:{...input.palletBuild,primaryRule:{...input.palletBuild.primaryRule,cartonLimit:3}}};
    const withSpace=packLoadingWorkflow(higherLimit);
    expect(refillPalletContents(withSpace,products,withSpace.pallets![0].id).reason).toBe("no-eligible-stock");
  });

  it("can fill the upper unit but does not grow a lower pallet through a supported upper unit",()=>{
    const cube={...carton,length:400,width:400,height:100,quantity:6};
    const unit={specificationId:"primary",cartons:[0,1].map(i=>({productId:cube.id,x:i*400,y:0,z:0,dx:400,dy:400,dz:100,weight:cube.weight,layer:1,orientation:"LWH"}))};
    const preparedPalletLayout:PreparedPalletLayout={version:1,units:[unit,unit]};
    const input={...request,strategy:"maximum" as const,products:[cube],preparedPalletLayout,
      container:{...request.container,length:800,width:400,doorWidth:400},
      palletBuild:{...build,stackLayers:3,maxTopLoadKg:1000,
        config:{...build.config,length:800,width:400,height:25,maxCargoHeight:400,layout:"long" as const}}};
    const plan=packLoadingWorkflow(input);
    expect(plan.metrics.loadedCount).toBe(4);
    const [lower,upper]=[...plan.pallets!].sort((a,b)=>a.z-b.z);
    expect(upper.z).toBe(125);
    expect(refillPalletContents(plan,[cube],lower.id).reason).toBe("no-fit");
    const r=refillPalletContents(plan,[cube],upper.id);
    expect(r.additions).toHaveLength(2);
    expect(r.additions.map(b=>b.z)).toEqual([100,100]);
    const filled=editPalletContents(plan,[cube],upper.id,{type:"refill",sourceKey:r.sourceKey,additions:r.additions});
    expect(filled.pallets).toEqual(plan.pallets);
    expect(boxesFor(filled,lower.id)).toEqual(boxesFor(plan,lower.id));
    expect(filled.metrics.loadedCount).toBe(6);
  });

  it("searches in original pallet axes for a crosswise loaded unit and pauses if it is locked or measured",()=>{
    const products=[{...carton,quantity:7}];
    const plan=packLoadingWorkflow({...request,products,palletBuild:{...build,maxPallets:1,primaryRule:{maxPallets:1,cartonLimit:6},config:{...build.config,layout:"cross"}}});
    const p=plan.pallets![0],id=p.id;
    expect(p.orientation).toBe("WLH");
    const source=editPalletContents(plan,products,id,{type:"remove",ids:[boxesFor(plan,id)[0].id]});
    const r=refillPalletContents(source,products,id);
    expect(r.additions).toHaveLength(1);
    const filled=editPalletContents(source,products,id,{type:"refill",sourceKey:r.sourceKey,additions:r.additions});
    const added=palletLocalBox(boxesFor(filled,id).find(b=>!source.placements.some(old=>old.id===b.id))!,p);
    expect([added.x,added.y,added.z,added.dx,added.dy]).toEqual(r.additions.map(b=>[b.x,b.y,b.z,b.dx,b.dy])[0]);
    const locked=editPalletContents(source,products,id,{type:"lock",locked:true});
    expect(()=>refillPalletContents(locked,products,id)).toThrow(/锁定/);
    const measured={...source,pallets:[{...p,measuredEnvelope:{version:1 as const,length:p.dx,width:p.dy,height:200,noseProtrusion:0,leftProtrusion:0,source:"fixture",date:"2026-11-17",contentsKey:unitContentsKey(p,boxesFor(source,id))}}]};
    expect(()=>refillPalletContents(measured,products,id)).toThrow(/实测包络/);
  });
});
