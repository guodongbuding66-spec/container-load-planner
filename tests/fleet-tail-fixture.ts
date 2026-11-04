import {allocateFleet} from "../lib/packing/fleet";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import type {FleetSnapshot} from "../lib/packing/fleet-tail";
import type {PackingStrategy} from "../lib/packing/types";

export function fleetTailFixture(strategy:PackingStrategy="maximum"):FleetSnapshot{
 const request={workflow:"palletized" as const,mode:"mixed" as const,strategy,clearance:0,
  container:{id:"fleet-tail-qa",name:"Fleet Tail QA",category:"other" as const,length:1500,width:1000,height:300,doorWidth:1000,doorHeight:300,maxWeight:1000},
  products:[{id:"p",sku:"FLEET-TAIL",name:"Fleet carton",length:500,width:500,height:200,weight:10,quantity:12,priority:50,rotationPolicy:"fixed" as const,allowedOrientations:["LWH" as const],stackable:true,maxStackLayers:0,maxTopLoadKg:100,color:"#337788"}],
  palletBuild:{...structuredClone(DEFAULT_PALLET_BUILD),maxPallets:3,looseQuantities:{p:2},config:{...structuredClone(DEFAULT_PALLET_BUILD.config),name:"Fleet QA pallet",length:1000,width:1000,height:100,weight:20,maxCargoHeight:200}}};
 const options=[{container:request.container,cost:100,available:5}],pricing={currency:"CNY",packaging:{primary:5}},limit=5,objective="count" as const;
 return {request,options,pricing,limit,objective,result:allocateFleet(request,options,limit,objective,undefined,pricing)};
}

/** Each source row needs two stock-limited units until its one-carton tail is reserved. */
export function jointFleetTailFixture(count=4,strategy:PackingStrategy="maximum"):FleetSnapshot{
 const source=fleetTailFixture(strategy),request=source.request,build=request.palletBuild!,first=request.products[0];
 request.practicalTargetUtilization=.95;
 request.products=Array.from({length:count},(_,i)=>({...first,id:`row-${i+1}`,sku:`FLEET-${String.fromCharCode(65+i)}`,quantity:5}));
 build.looseQuantities=undefined;build.maxPallets=count*2;build.primaryRule={maxPallets:2,productIds:[request.products[0].id]};
 build.additionalSpecs=request.products.slice(1).map((p,i)=>({id:`spec-${i+2}`,config:{...structuredClone(build.config),name:`Pallet ${i+2}`},productIds:[p.id],maxPallets:2,stackLayers:1,maxTopLoadKg:0}));
 source.limit=10;source.options[0].available=10;source.pricing={currency:"CNY",packaging:Object.fromEntries(["primary",...build.additionalSpecs.map(s=>s.id)].map(id=>[id,5]))};
 source.result=allocateFleet(request,source.options,source.limit,source.objective,undefined,source.pricing);return source;
}
