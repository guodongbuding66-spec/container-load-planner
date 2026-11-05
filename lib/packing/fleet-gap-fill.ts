import {restorePackingSnapshot,searchFixedCargo} from "./engine";
import {fleetPool} from "./fleet-inventory";
import {finishFleet,type FleetLoad,type FleetResult} from "./fleet";
import {looseOutsideUnit} from "./loose-cargo";
import {palletLoadEnvelope} from "./unit-envelope";
import {specificationForPallet} from "./pallet-specifications";
import {normalizedSetCode,normalizedUnitsPerSet} from "./set-utils";
import type {FleetPricing} from "./fleet-costs";
import type {PackingRequest,PlacedBox,ProductInput} from "./types";

/** Add only still-unloaded whole loose groups. Existing cartons and complete units never move. */
export function fillFleetGaps(request:PackingRequest,baseline:FleetResult,prefix:readonly FleetLoad[],pricing?:FleetPricing):FleetResult{
 const counts=new Map<string,number>(),looseCounts=new Map<string,number>(),added=new Map<string,number>();
 for(const l of baseline.loads)for(const b of l.plan.placements){counts.set(b.productId,(counts.get(b.productId)??0)+1);if(!b.palletIds?.length)looseCounts.set(b.productId,(looseCounts.get(b.productId)??0)+1);}
 const loads:FleetLoad[]=[...prefix];
 for(const old of baseline.loads.slice(prefix.length)){
  if(old.frozen||old.plan.deliveryIdentity)throw Error("已交付柜不能补入新箱，请保留该柜前缀 / Preserve issued containers before filling gaps");
  const local=fleetPool(request,loads).request,build=local.palletBuild!;
  const palletization={...old.plan.palletization!,looseQuantities:build.looseQuantities};
  const rebound=restorePackingSnapshot(local,{...old.plan,palletBuild:build,palletization,deliveryIdentity:undefined});
  const oldIds=new Set(old.plan.placements.map(b=>b.id)),oldLoose=old.plan.placements.filter(b=>!b.palletIds?.length),ownCounts=new Map<string,number>();
  for(const b of oldLoose)ownCounts.set(b.productId,(ownCounts.get(b.productId)??0)+1);
  const allowance=new Map(request.products.map(p=>[p.id,Math.max(0,Math.min(p.quantity-(counts.get(p.id)??0)-(added.get(p.id)??0),(request.palletBuild?.looseQuantities?.[p.id]??0)-(looseCounts.get(p.id)??0)-(added.get(p.id)??0)))]));
  const kits=new Map<string,ProductInput[]>();for(const p of request.products){const code=normalizedSetCode(p);if(code)kits.set(code,[...kits.get(code)??[],p]);}
  for(const kit of kits.values()){const n=Math.min(...kit.map(p=>Math.floor((allowance.get(p.id)??0)/normalizedUnitsPerSet(p))));for(const p of kit)allowance.set(p.id,n*normalizedUnitsPerSet(p));}
  if(![...allowance.values()].some(n=>n>0)){loads.push({plan:{...rebound,id:old.plan.id,createdAt:old.plan.createdAt},cost:old.cost});continue;}
  const reserved=new Set(request.products.map(p=>p.id));
  const units=(old.plan.pallets??[]).map((p,i)=>{
   let id=`__gap_unit_${i}`;while(reserved.has(id))id="_"+id;reserved.add(id);
   const cargo=old.plan.placements.filter(b=>b.palletIds?.includes(p.id)),envelope=palletLoadEnvelope(p,cargo),weight=p.weight+cargo.reduce((n,b)=>n+b.weight,0);
   const product:ProductInput={id,sku:id,name:p.name,length:envelope.dx,width:envelope.dy,height:envelope.dz,weight,quantity:1,priority:100,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:true,maxStackLayers:0,minimumSupportRatio:1,color:"#997947"};
   const box:PlacedBox={...envelope,id,productId:id,sku:id,name:p.name,weight,color:product.color,layer:1,orientation:"LWH"};
   return {product,box,gap:specificationForPallet(old.plan.palletization!,p).config.gap};
  });
  const products=[...units.map(u=>u.product),...request.products.map(p=>({...p,quantity:(ownCounts.get(p.id)??0)+(allowance.get(p.id)??0)}))];
  const searchRequest: PackingRequest={...local,workflow:"direct",palletBuild:undefined,floorPallets:undefined,products};
  const unitIds=new Set(units.map(u=>u.product.id)),fixed=[...units.map(u=>u.box),...oldLoose];let best=rebound,newBoxes:PlacedBox[]=[];
  for(let pass=0;pass<4;pass++){
   const found=searchFixedCargo(searchRequest,fixed,pass,c=>units.every(u=>looseOutsideUnit(c,u.box,Math.max(u.gap,request.products.find(p=>p.id===c.productId)?.protectionGap??0))));
   const fresh=found.filter(b=>!unitIds.has(b.productId)&&!oldIds.has(b.id));if(!fresh.length)continue;
   const used=new Set(oldIds),setMap=new Map<string,number>(),setMax=new Map<string,number>();for(const b of old.plan.placements)if(b.setCode)setMax.set(b.setCode,Math.max(setMax.get(b.setCode)??0,b.setNumber??0));
   const additions=fresh.map((b,i)=>{
    let id=`gap-${i+1}`;while(used.has(id))id="_"+id;used.add(id);
    let setNumber=b.setNumber;if(b.setCode){const key=`${b.setCode}/${b.setNumber}`;if(!setMap.has(key)){const next=(setMax.get(b.setCode)??0)+1;setMax.set(b.setCode,next);setMap.set(key,next);}setNumber=setMap.get(key);}
    return {...b,id,palletIds:undefined,setNumber};
   });
   const candidate=restorePackingSnapshot(local,{...rebound,placements:[...old.plan.placements,...additions],deliveryIdentity:undefined});
   if(candidate.placements.length>best.placements.length){best=candidate;newBoxes=additions;}
  }
  for(const b of newBoxes)added.set(b.productId,(added.get(b.productId)??0)+1);
  best.id=newBoxes.length?`gap-${old.plan.id}-${newBoxes.length}`:old.plan.id;
  loads.push({plan:best,cost:old.cost});
 }
 return finishFleet(request,loads,"保留原箱托位置，现有柜空隙补入已完成 / Existing-container gap search completed with original positions retained",pricing);
}
