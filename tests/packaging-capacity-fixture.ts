import {palletHeightFixture} from "./pallet-height-fixture";

/** Registered alternative stock, never inferred from a photo or created by the trial. */
export function packagingCapacityFixture(stock=13){
 const request=palletHeightFixture(),build=request.palletBuild!;
 request.products[0].rotationPolicy="upright";
 Object.assign(build.config,{name:"Large registered pallet",maxCargoHeight:2527});
 build.additionalSpecs=[{id:"long-small",config:{...structuredClone(build.config),name:"Small registered pallet",length:1800,width:1100},maxPallets:stock,stackLayers:1,maxTopLoadKg:0}];
 return request;
}
