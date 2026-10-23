import {packLoadingWorkflow} from "../lib/packing/pack-loading";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {issueDeliveryIdentity} from "../lib/packing/delivery-identity";
import {emptyEngineeringDocument} from "../lib/packing/engineering-checks";
import type {PackingRequest} from "../lib/packing/types";
export function measuredUnitFixture(){
 const request:PackingRequest={workflow:"palletized",mode:"mixed",strategy:"maximum",clearance:0,
  container:{id:"qa",name:"QA",length:2000,width:1200,height:600,doorWidth:1200,doorHeight:600,maxWeight:1000},
  palletBuild:{...DEFAULT_PALLET_BUILD,config:{...DEFAULT_PALLET_BUILD.config,length:500,width:500,height:100,weight:20,maxCargoHeight:200},maxPallets:4},
  products:[{id:"p",sku:"P",name:"Carton",length:500,width:500,height:200,weight:10,quantity:4,priority:100,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:50,color:"#338877"}]};
 const plan=issueDeliveryIdentity(packLoadingWorkflow(request));
 const document=emptyEngineeringDocument(plan);document.units=plan.pallets!.map(p=>({palletId:p.id,length:600,width:600,height:350,noseProtrusion:20,leftProtrusion:20,extraWeightKg:0,weightIncluded:false,source:"QA ruler",date:"2026-10-23"}));
 return {request,plan,document};
}
