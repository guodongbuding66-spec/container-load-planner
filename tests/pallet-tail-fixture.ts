import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {restorePackingSnapshot} from "../lib/packing/engine";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import type {PackingRequest} from "../lib/packing/types";
export function palletTailFixture():PackingRequest{
 const build=structuredClone(DEFAULT_PALLET_BUILD);Object.assign(build.config,{name:"Tail test pallet",length:800,width:1000,height:100,maxCargoHeight:400});build.maxPallets=1;
 return {mode:"mixed",workflow:"palletized",strategy:"practical",container:{id:"tail-test",name:"Tail test vehicle",category:"other",loadingAccess:"rear",length:1200,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:10000},clearance:0,palletBuild:build,
  products:[{id:"a",sku:"TAIL-A",name:"Tail carton",length:400,width:400,height:200,weight:10,quantity:20,priority:100,rotationPolicy:"fixed",stackable:true,maxTopLoadKg:1000,maxStackLayers:0,color:"#2f7f89"}]};
}

/** Two stock-limited SKU-specific pallets share one remaining floor strip. */
export function jointPalletTailFixture():PackingRequest{
 const r=palletTailFixture();r.container.length=2000;r.products[0].quantity=12;
 r.products.push({...structuredClone(r.products[0]),id:"b",sku:"TAIL-B"});
 const build=r.palletBuild!;build.maxPallets=2;build.primaryRule={maxPallets:1,productIds:["a"]};
 build.additionalSpecs=[{id:"sku-b",config:{...structuredClone(build.config),name:"SKU B pallet"},productIds:["b"],maxPallets:1,stackLayers:1,maxTopLoadKg:0}];
 return r;
}

/** Three SKU-specific pallets leave one shared strip for six original loose cartons. */
export function triplePalletTailFixture():PackingRequest{
 const r=jointPalletTailFixture();r.container.length=2800;r.products.forEach(p=>p.quantity=10);
 r.products.push({...structuredClone(r.products[0]),id:"c",sku:"TAIL-C"});
 r.palletBuild!.maxPallets=3;r.palletBuild!.additionalSpecs!.push({id:"sku-c",config:{...structuredClone(r.palletBuild!.config),name:"SKU C pallet"},productIds:["c"],maxPallets:1,stackLayers:1,maxTopLoadKg:0});
 return r;
}

export function tripleKitPalletTailFixture():PackingRequest{
 const r=palletTailFixture();r.container.length=2800;r.palletBuild!.config.maxLoad=30;r.palletBuild!.maxPallets=3;
 r.products[0]={...r.products[0],length:200,width:200,height:100,quantity:10,setCode:"KIT",unitsPerSet:1};
 r.products.push({...r.products[0],id:"b",sku:"TAIL-B",quantity:20,unitsPerSet:2},{...r.products[0],id:"c",sku:"TAIL-C",setCode:"",unitsPerSet:1},{...r.products[0],id:"d",sku:"TAIL-D",setCode:"",unitsPerSet:1});
 return r;
}

/** A valid manual partial plan: one loaded pallet, with six original cartons unmet. */
export function economicTailFixture(){
 const request=palletTailFixture();request.products[0].quantity=14;request.container.length=2000;request.container.height=600;request.container.doorHeight=600;request.palletBuild!.maxPallets=2;
 const partial=packLoadingWorkflow(request),removed=partial.pallets![1].id;partial.pallets=partial.pallets!.slice(0,1);partial.placements=partial.placements.filter(p=>!p.palletIds?.includes(removed));
 const baseline=restorePackingSnapshot(request,partial);
 return {request,baseline};
}
