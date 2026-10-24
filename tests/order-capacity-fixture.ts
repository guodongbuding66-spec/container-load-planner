import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {CONTAINER_PRESETS} from "../lib/packing/presets";
import type {PackingRequest} from "../lib/packing/types";
export function orderCapacityFixture(quantity=16):PackingRequest{
 const build=structuredClone(DEFAULT_PALLET_BUILD);Object.assign(build.config,{name:"Long carton pallet",length:1800,width:1100,height:144,maxCargoHeight:1000});
 return {mode:"mixed",workflow:"palletized",strategy:"practical",container:{...CONTAINER_PRESETS[2]},clearance:10,palletBuild:build,practicalTargetUtilization:.88,
  products:[{id:"long",sku:"REAL-1CTN",name:"Long carton",length:1640,width:545,height:120,weight:42,quantity,priority:100,rotationPolicy:"upright",stackable:true,maxStackLayers:0,color:"#2f7f89"}]};
}
