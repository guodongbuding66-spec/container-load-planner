import {deckSupportMass,palletQuarterTurns} from "./deck-support";
import {getOrientations,searchPalletContents} from "./engine";
import {DEFAULT_LOADING_RULES} from "./loading-rules";
import {packagingInterior} from "./packaging";
import {packagingGroupKey,packagingPriorityGroups} from "./packaging-choice";
import {palletCartonPose,palletLocalBox} from "./pallet-edit";
import {specificationForPallet} from "./pallet-specifications";
import {normalizedSetCode,normalizedUnitsPerSet} from "./set-utils";
import type {FloorPalletConfig,OrientationCode,PackingResult,PackingStrategy,PlacedBox,PlacedPallet,ProductInput} from "./types";

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

const unitsInBatch=(product:ProductInput)=>normalizedSetCode(product)?normalizedUnitsPerSet(product):1;

/** Keep full kits together when screening a stock pool against a packaging specification. */
export function palletStockGroups(products:ProductInput[],stock:ReadonlyMap<string,number>,productIds:string[]|undefined,currentGroup:string|undefined,slots:number){
  const allowed=productIds?new Set(productIds):null;
  return packagingPriorityGroups(products).flatMap(group=>{
    if(currentGroup&&packagingGroupKey(group[0])!==currentGroup||allowed&&group.some(p=>!allowed.has(p.id)))return [];
    const size=group.reduce((sum,p)=>sum+unitsInBatch(p),0);
    const batches=Math.min(Math.floor(slots/size),...group.map(p=>Math.floor((stock.get(p.id)??0)/unitsInBatch(p))));
    return batches>0?[{group,size,batches}]:[];
  });
}

export function palletStockOptions(groups:ReturnType<typeof palletStockGroups>,single:boolean,slots:number){
  const options=groups.map(({group,size,batches})=>group.map(p=>({...p,quantity:Math.min(batches,Math.floor(slots/size))*unitsInBatch(p)})));
  return single?options:[options.flat()];
}

/** Search around fixed boxes with this pallet's actual interior, topside clearance and payload. */
export function searchPalletAdditions(plan:PackingResult,pallet:PlacedPallet,products:ProductInput[],fixed:PlacedBox[],stock:ProductInput[],slots:number,pass:number,load:{spareKg:number;removedId?:string}){
  const {config}=specificationForPallet(plan.palletization!,pallet);
  const vehicleHeight=plan.container.height-plan.clearance-pallet.z;
  const doorHeight=plan.palletization!.only||plan.container.loadingAccess==="open"?Infinity:plan.container.doorHeight-plan.clearance;
  const cargoHeight=config.maxCargoHeight?pallet.dz+config.maxCargoHeight:Infinity;
  const above=plan.pallets!.filter(other=>other.id!==load.removedId&&other.z>pallet.z&&pallet.x<other.x+other.dx&&other.x<pallet.x+pallet.dx&&pallet.y<other.y+other.dy&&other.y<pallet.y+pallet.dy);
  const height=Math.min(vehicleHeight,doorHeight,cargoHeight,...above.map(other=>other.z-pallet.z));
  const fixedKg=fixed.reduce((sum,b)=>sum+b.weight,0);
  const payload=Math.min(pallet.maxLoad-deckSupportMass(pallet),fixedKg+load.spareKg);
  if(height<=pallet.dz||payload<0||!stock.length||slots<=0)return [];

  const quantities=new Map(stock.map(p=>[p.id,p.quantity]));
  for(const box of fixed)quantities.set(box.productId,(quantities.get(box.productId)??0)+1);
  const {base,container,products:localProducts}=palletSearchFrame(pallet,config,
    products.filter(p=>quantities.has(p.id)).map(p=>({...p,quantity:quantities.get(p.id)!})),plan.strategy,height,Math.max(.0001,pallet.weight+payload));
  const fixedIds=new Set(fixed.map(b=>b.id));
  const fixedCargo=fixed.map(b=>{const local=palletLocalBox(b,pallet);return {...local,z:local.z+pallet.dz};});
  const candidate=searchPalletContents({palletBuildStage:true,mode:"mixed",strategy:plan.strategy,clearance:0,container,products:localProducts,
    palletCartonLimit:slots,loadingRules:{...DEFAULT_LOADING_RULES,...plan.loadingRules,layout:"layers"}},base,fixedCargo,pass);
  return candidate.filter(b=>!fixedIds.has(b.id)).map(b=>({...b,z:b.z-pallet.dz}));
}

/** Keep physical carton IDs and whole kit numbers across solver-generated positions. */
export function matchPalletCargo(positions:PlacedBox[],originals:PlacedBox[]){
  const kits=new Map<string,Set<number>>();
  const buckets=new Map<string,PlacedBox[]>();
  const key=(box:PlacedBox,setNumber=box.setNumber)=>JSON.stringify([box.productId,box.setCode??null,setNumber??null]);
  for(const box of originals){
    if(box.setCode){
      const numbers=kits.get(box.setCode)??new Set<number>();
      numbers.add(box.setNumber!);
      kits.set(box.setCode,numbers);
    }
    const id=key(box),list=buckets.get(id)??[];
    list.push(box);
    buckets.set(id,list);
  }
  const available=new Map([...kits].map(([code,numbers])=>[code,[...numbers].sort((a,b)=>a-b)]));
  const mapped=new Map<string,number>();
  return positions.map(box=>{
    let setNumber=box.setNumber;
    if(box.setCode){
      const slot=JSON.stringify([box.setCode,setNumber]);
      if(!mapped.has(slot)){
        const original=available.get(box.setCode)?.shift();
        if(original===undefined)throw Error("找不到对应的完整套装 / No matching complete source kit");
        mapped.set(slot,original);
      }
      setNumber=mapped.get(slot)!;
    }
    const original=buckets.get(key(box,setNumber))?.shift();
    if(!original)throw Error("找不到对应的原箱号 / No matching source carton");
    return {...original,...palletCartonPose(box)};
  });
}
