import {palletDeckSupportGeometry} from "./deck-support";
import {palletLoadEnvelope} from "./unit-envelope";
import {buildSolidModel} from "./solid-model";
import type { PlacedBox,ProductInput,PlacedPallet } from './types';
import { subtractSpace } from './free-space';
/** Union of occupied envelopes, since genuine solids may share their outer bounding boxes. */
export function envelopeMetrics(placements:PlacedBox[],products:ProductInput[],effectiveVolume:number,pallets:PlacedPallet[]=[]){
 if(!products.some(p=>p.solidModel)&&!pallets.some(p=>p.enclosureHeight||p.measuredEnvelope))return {};
 placements=[...placements,...palletDeckSupportGeometry(pallets).boxes,...pallets.map(p=>({...p,...(p.measuredEnvelope?palletLoadEnvelope(p,placements.filter(b=>b.palletIds?.includes(p.id))):{dz:p.enclosureHeight??p.dz}),productId:p.id,sku:p.id,color:"#997947",layer:1}))];
 const solidVolumeApproximate=products.some(p=>p.solidModel&&!buildSolidModel(p.solidModel).volumeExact);
 const pieces:Array<Pick<PlacedBox,'x'|'y'|'z'|'dx'|'dy'|'dz'>>=[];
 for(const b of placements){let next=[b];for(const old of pieces){next=next.flatMap(p=>subtractSpace(p,old).map(s=>({...b,...s})));if(next.length+pieces.length>20000)return {solidVolumeApproximate,envelopeVolume:Math.min(effectiveVolume,placements.reduce((n,b)=>n+b.dx*b.dy*b.dz,0)),envelopeUtilization:Math.min(1,placements.reduce((n,b)=>n+b.dx*b.dy*b.dz,0)/effectiveVolume),envelopeApproximate:true};}pieces.push(...next);}
 const envelopeVolume=pieces.reduce((n,b)=>n+b.dx*b.dy*b.dz,0);return {solidVolumeApproximate,envelopeVolume,envelopeUtilization:envelopeVolume/effectiveVolume,envelopeApproximate:false};
}
