import { pack, restorePackingSnapshot, getOrientations } from "./engine";
import { quarterTurnOrientation } from "./cargo-body";
import { parseFloorPalletConfig, palletCargoCeiling } from "./floor-pallets";
import type { PackingRequest, PackingResult, PlacedBox, PlacedPallet, ProductInput, FloorPalletConfig } from "./types";
export type PreparedUnit={id:string;cargo:PlacedBox[];height:number;weight:number;tail:boolean};
/** Pack cargo FIRST, then solve indivisible loaded-pallet envelopes in the truck. */
export function palletizeThenPack(request:PackingRequest,input:FloorPalletConfig,mix:"single"|"mixed",maxPallets=20){
  const config=parseFloorPalletConfig(input);if(!Number.isInteger(maxPallets)||maxPallets<1||maxPallets>50)throw new Error("Pallet limit must be 1–50");
  if(request.mode!=="mixed")throw new Error("Prebuilt pallets use an explicit order in mixed mode");
  const cargoHeight=palletCargoCeiling(request.container,request.clearance,config)-config.height;if(cargoHeight<=0)throw new Error("No height remains above the pallet");
  const remaining=request.products.map(p=>({...p})),prepared:PreparedUnit[]=[],failed=new Set<string>();
  while(prepared.length<maxPallets){
    const first=remaining.find(p=>p.quantity>0&&!failed.has(p.id));if(!first)break;
    const products=remaining.filter(p=>p.quantity>0&&(mix==="mixed"||(first.setCode?.trim()?p.setCode===first.setCode:p.id===first.id)));
    const local=pack({...request,floorPallets:undefined,mode:"mixed",strategy:"practical",practicalTargetUtilization:.95,container:{id:"build-pallet",name:config.name,category:"pallet",loadingAccess:"open",length:config.length,width:config.width,height:cargoHeight,doorWidth:config.width,doorHeight:cargoHeight,maxWeight:config.maxLoad},clearance:0,products});
    if(!local.validation.valid)throw new Error(local.validation.errors.join("; "));
    if(!local.placements.length){products.forEach(p=>failed.add(p.id));if(mix==="mixed")break;continue;}
    const height=Math.max(...local.placements.map(b=>b.z+b.dz));
    prepared.push({id:`unit-${prepared.length+1}`,cargo:local.placements,height:height+config.height,weight:local.metrics.grossWeight+config.weight,tail:local.summaries.every(s=>s.unloaded===0)});
    for(const p of remaining)p.quantity-=local.placements.filter(b=>b.productId===p.id).length;
  }
  if(!prepared.length)throw new Error("No complete cargo load fits the chosen pallet");
  const units:ProductInput[]=prepared.map(p=>({id:p.id,sku:p.id,name:config.name,length:config.length,width:config.width,height:p.height,weight:p.weight,quantity:1,priority:50,rotationPolicy:"upright",allowedOrientations:p.cargo.every(b=>{const input=request.products.find(q=>q.id===b.productId)!;return getOrientations(input,false).some(o=>o.dx===b.dy&&o.dy===b.dx&&o.dz===b.dz&&(!input.allowedOrientations||o.label===`${b.orientation[1]}${b.orientation[0]}${b.orientation[2]}`));})?["LWH","WLH"]:["LWH"],stackable:false,maxStackLayers:1,bottomOnly:true,cargoType:"pallet",palletBaseHeight:config.height,color:"#997947"}));
  const outer=pack({...request,floorPallets:undefined,products:units,loadingRules:request.loadingRules?{...request.loadingRules,supportByType:undefined}:undefined,mode:"mixed",strategy:"practical"});
  if(!outer.validation.valid)throw new Error(outer.validation.errors.join("; "));
  const placements:PlacedBox[]=[],pallets:PlacedPallet[]=[],setCounters=new Map<string,number>();
  for(const b of outer.placements){const unit=prepared.find(p=>p.id===b.productId)!,cross=b.orientation==="WLH",palletId=`floor-pallet-${pallets.length+1}`,setMap=new Map<string,number>();
    pallets.push({id:palletId,presetId:config.presetId,name:config.name,x:b.x,y:b.y,z:0,dx:b.dx,dy:b.dy,dz:config.height,weight:config.weight,maxLoad:config.maxLoad,orientation:cross?"WLH":"LWH"});
    for(const c of unit.cargo){let setNumber=c.setNumber;if(c.setCode){const key=`${c.setCode}/${c.setNumber}`;if(!setMap.has(key)){const next=(setCounters.get(c.setCode)??0)+1;setCounters.set(c.setCode,next);setMap.set(key,next);}setNumber=setMap.get(key);}
      placements.push({...c,id:`prebuilt-${placements.length+1}`,x:b.x+(cross?c.y:c.x),y:b.y+(cross?config.length-c.x-c.dx:c.y),z:c.z+config.height,dx:cross?c.dy:c.dx,dy:cross?c.dx:c.dy,...(cross?quarterTurnOrientation(c):{}),setNumber,palletIds:[palletId]});
    }
  }
  const plan:PackingResult=restorePackingSnapshot({...request,floorPallets:undefined,strategy:"practical"},{strategy:"practical",placements,pallets,palletization:{config,mix}});
  return {plan,prepared,loadedPallets:pallets.length,unloadedPallets:prepared.length-pallets.length,remaining:plan.summaries.filter(s=>s.unloaded>0),bounded:prepared.length===maxPallets&&remaining.some(p=>p.quantity>0)};
}
