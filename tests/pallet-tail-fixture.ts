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
