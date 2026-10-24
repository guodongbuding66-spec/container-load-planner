import {orderCapacityFixture} from "./order-capacity-fixture";

/** A controlled 596-order / 16-loaded case, not the user's missing workspace. */
export function palletHeightFixture(){
 const request=orderCapacityFixture(596);
 Object.assign(request.palletBuild!.config,{length:2743,width:2233,height:60,maxCargoHeight:120});
 request.products[0].rotationPolicy="fixed";
 return request;
}
