import {getOrientations} from "./engine";
import {palletCargoCeiling} from "./floor-pallets";
import {parsePalletBuild} from "./loading-workflow";
import {packagingInterior} from "./packaging";
import {palletSpecifications} from "./pallet-specifications";
import type {OrderCapacityTrial} from "./order-capacity";
import type {PackingRequest} from "./types";

/** Geometric upper bounds only: they do not certify support, strength or a pack. */
export function inspectPalletHeights(request:PackingRequest){
 if(request.workflow!=="palletized"||!request.palletBuild)return [];
 let build;try{build=parsePalletBuild(request.palletBuild);}catch{return [];}
 return palletSpecifications(build).map(s=>{
  const c=s.config,inside=packagingInterior(c);
  const available=Math.max(0,palletCargoCeiling(request.container,request.clearance,{...c,maxCargoHeight:0})-c.height-inside.lid);
  const current=inside.crate?c.maxCargoHeight??0:Math.min(available,c.maxCargoHeight||available);
  const products=request.products.filter(p=>p.quantity>0&&(!s.productIds||s.productIds.includes(p.id))).map(p=>{
   const orientations=getOrientations(p).filter(o=>o.dx<=inside.length+.0001&&o.dy<=inside.width+.0001);
   const minHeight=orientations.length?Math.min(...orientations.map(o=>o.dz)):null;
   return {productId:p.id,sku:p.sku,minHeight,heightLayers:minHeight?Math.floor((current+.0001)/minHeight):0,
    configuredLayers:p.bottomOnly||p.stackable===false?1:p.maxStackLayers||null,
    payloadCartons:p.weight>0?Math.floor((c.maxLoad+.0001)/p.weight):null};
  });
  return {id:s.id,name:c.name,current,available,crate:inside.crate,stock:s.maxPallets,products,
   canRaise:!inside.crate&&s.maxPallets>0&&products.length>0&&current+.0001<available};
 });
}

/** Change only explicit open-pallet cargo ceilings; the original order stays intact. */
export function preparePalletHeightTrial(request:PackingRequest):OrderCapacityTrial{
 if(request.mode!=="mixed"||request.workflow!=="palletized"||!request.palletBuild)throw Error("限高试算仅支持先打托后装柜 / Height trials require a palletized order");
 const count=request.products.reduce((n,p)=>n+p.quantity,0);
 if(count<1||count>4000)throw Error("限高试算支持 1–4000 箱订单 / Height trials support orders of 1–4000 cartons");
 const reports=inspectPalletHeights(request).filter(s=>s.canRaise);
 if(!reports.length)throw Error("没有可提高限高的启用托盘规格；木箱内高保持不变 / No enabled open-pallet ceiling can be raised; crate interiors stay unchanged");
 const next=structuredClone(request),build=parsePalletBuild(next.palletBuild);
 for(const row of reports){
  if(row.id==="primary")build.config={...build.config,maxCargoHeight:row.available};
  else build.additionalSpecs=build.additionalSpecs?.map(s=>s.id===row.id?{...s,config:{...s.config,maxCargoHeight:row.available}}:s);
 }
 next.palletBuild=build;next.strategy=request.strategy??"practical";next.delivery=undefined;next.singleCartonLimit=undefined;
 return {request:next,arithmeticCartons:count,budgetLimited:false,heightChanges:reports.map(s=>({id:s.id,name:s.name,from:s.current,to:s.available}))};
}
