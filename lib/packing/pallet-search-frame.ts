import {palletQuarterTurns} from "./deck-support";
import {getOrientations} from "./engine";
import {packagingInterior} from "./packaging";
import type {FloorPalletConfig, OrientationCode, PackingStrategy, PlacedPallet, ProductInput} from "./types";

/** Search in the packaging's original axes, using the order's world-direction rules. */
export function palletSearchFrame(pallet:PlacedPallet,config:FloorPalletConfig,products:ProductInput[],strategy:PackingStrategy,height:number,maxWeight:number){
  const {length,width}=config;
  const {inset}=packagingInterior(config);
  const cross=palletQuarterTurns(pallet)%2===1;
  const walls=inset>0?[
    {x:0,y:0,dx:inset,dy:width},{x:length-inset,y:0,dx:inset,dy:width},
    {x:inset,y:0,dx:length-2*inset,dy:inset},{x:inset,y:width-inset,dx:length-2*inset,dy:inset},
  ]:[];
  return {
    base:{...pallet,x:0,y:0,z:0,dx:length,dy:width,orientation:"LWH" as const,quarterTurns:0 as const},
    container:{id:"local-pallet-search",name:config.name,category:"pallet" as const,loadingAccess:"open" as const,length,width,height,doorWidth:width,doorHeight:height,maxWeight,
      exclusions:walls.map((wall,index)=>({...wall,id:`pallet-wall-${index}`,name:"Packaging interior",kind:"obstacle" as const,z:pallet.dz,dz:height-pallet.dz}))},
    products:products.map(product=>{
      const directions=!product.allowedOrientations&&strategy==="practical"&&product.rotationPolicy==="any"?{...product,rotationPolicy:"upright" as const}:product;
      const allowedOrientations=getOrientations(directions,false).map(({label})=>(cross?`${label[1]}${label[0]}${label[2]}`:label) as OrientationCode);
      return {...product,allowedOrientations};
    }),
  };
}
