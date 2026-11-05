import {restorePackingSnapshot,searchFixedCargo} from "./engine";
import {fleetPool} from "./fleet-inventory";
import {finishFleet,type FleetLoad,type FleetResult} from "./fleet";
import {intersects} from "./free-space";
import {palletizeThenPack} from "./palletize";
import {palletSpecifications,specificationForPallet} from "./pallet-specifications";
import {siteExclusionBoxes} from "./site-exclusions";
import {palletLoadEnvelope} from "./unit-envelope";
import type {FleetPricing} from "./fleet-costs";
import type {PackingRequest,PackingResult,PlacedBox,PlacedPallet,ProductInput} from "./types";

const EPS=.0001;
type GapBody=Pick<PlacedBox,"x"|"y"|"z"|"dx"|"dy"|"dz"|"weight">;
type Occupant={body:GapBody;gap:number};

function completeUnit(plan:PackingResult,pallet:PlacedPallet){
 const cargo=plan.placements.filter(b=>b.palletIds?.includes(pallet.id));
 const spec=specificationForPallet(plan.palletization!,pallet);
 return {pallet,cargo,body:{...palletLoadEnvelope(pallet,cargo),weight:pallet.weight+cargo.reduce((n,b)=>n+b.weight,0)},gap:spec.config.gap};
}

function occupied(plan:PackingResult,products:readonly ProductInput[]):Occupant[]{
 const gapByProduct=new Map(products.map(p=>[p.id,p.protectionGap??0]));
 return [...(plan.pallets??[]).map(p=>completeUnit(plan,p)),...plan.placements.filter(b=>!b.palletIds?.length).map(body=>({body,gap:gapByProduct.get(body.productId)??0}))];
}

/** Only an unobstructed straight insertion from the rear door or the open top is proposed. */
function insertionFits(container:PackingResult["container"],clearance:number,body:GapBody,blockers:readonly GapBody[]){
 if(Math.abs(body.z)>EPS)return false;
 if(container.loadingAccess==="open")return blockers.every(b=>!intersects({...body,dz:container.height-clearance-body.z},b));
 const left=(container.width-container.doorWidth)/2;
 if(body.y<left-EPS||body.y+body.dy>left+container.doorWidth-2*clearance+EPS||body.dz>container.doorHeight-clearance+EPS)return false;
 return blockers.every(b=>!intersects({...body,dx:container.length-2*clearance-body.x},b));
}

/** Verify the order of new whole units against the original cargo and fixed regions. */
export function gapUnitInsertionValid(before:PackingResult,after:PackingResult,products:readonly ProductInput[]){
 const ids=new Set(before.pallets?.map(p=>p.id));
 const blockers:GapBody[]=[...occupied(before,products).map(v=>v.body),...siteExclusionBoxes(before.container,before.clearance)];
 for(const pallet of after.pallets??[])if(!ids.has(pallet.id)){
  const {body}=completeUnit(after,pallet);
  if(!insertionFits(before.container,before.clearance,body,blockers))return false;
  blockers.push(body);
 }
 return true;
}

function proxy(id:string,{body,gap}:Occupant){
 const product:ProductInput={id,sku:id,name:id,length:body.dx,width:body.dy,height:body.dz,weight:body.weight,quantity:1,priority:1,
  rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:false,bottomOnly:true,maxStackLayers:1,protectionGap:gap,color:"#997947"};
 const box:PlacedBox={...body,id,productId:id,sku:id,name:id,color:product.color,layer:1,orientation:"LWH"};
 return {product,box};
}

function restoreWithUnits(local:PackingRequest,old:PackingResult,donor?:PackingResult,matches:readonly PlacedBox[]=[]){
 const pallets=[...old.pallets??[]],placements=[...old.placements],build=local.palletBuild!,specifications=palletSpecifications(build);
 const palletIds=new Set(pallets.map(p=>p.id)),boxIds=new Set(placements.map(b=>b.id));
 const nextKit=new Map<string,number>();
 for(const box of placements)if(box.setCode)nextKit.set(box.setCode,Math.max(nextKit.get(box.setCode)??0,box.setNumber??0));
 const choices=[...old.palletization?.selectionChoices??[]];
 for(const match of matches){
  const from=donor!.pallets!.find(p=>p.id===match.productId)!;
  const {body,cargo}=completeUnit(donor!,from);
  const dx=match.x-body.x,dy=match.y-body.y,dz=match.z-body.z;
  let id=`gap-unit-${pallets.length+1}`;while(palletIds.has(id))id=`_${id}`;palletIds.add(id);
  pallets.push({...from,id,x:from.x+dx,y:from.y+dy,z:from.z+dz});
  const choice=donor!.palletization?.selectionChoices?.find(c=>c.palletId===from.id);
  if(choice)choices.push({...choice,palletId:id});
  const kits=new Map<string,number>();
  for(const box of cargo){
   let boxId=`gap-carton-${placements.length+1}`;while(boxIds.has(boxId))boxId=`_${boxId}`;boxIds.add(boxId);
   let setNumber=box.setNumber;
   if(box.setCode){
    const key=JSON.stringify([box.setCode,box.setNumber]);
    if(!kits.has(key)){const n=(nextKit.get(box.setCode)??0)+1;kits.set(key,n);nextKit.set(box.setCode,n);}
    setNumber=kits.get(key);
   }
   placements.push({...box,id:boxId,x:box.x+dx,y:box.y+dy,z:box.z+dz,palletIds:[id],setNumber});
  }
 }
 const preparedBySpecification=Object.fromEntries(specifications.map(s=>[s.id,pallets.filter(p=>(p.specificationId??"primary")===s.id).length]));
 const palletization={...old.palletization!,looseQuantities:build.looseQuantities,specifications,preparedCount:pallets.length,preparedBySpecification,
  ...(choices.length?{selectionChoices:choices}:{})};
 const plan=restorePackingSnapshot(local,{...old,palletBuild:build,palletization,pallets,placements,deliveryIdentity:undefined});
 return {...plan,id:matches.length?`gap-units-${old.id}-${matches.length}`:old.id,createdAt:old.createdAt};
}

/** Prepare trial units from genuinely unallocated order quantities, then translate them intact into free floor space. */
export function fillFleetUnitGaps(request:PackingRequest,baseline:FleetResult,prefix:readonly FleetLoad[],cartonAllowance:ReadonlyMap<string,number>,pricing?:FleetPricing):FleetResult{
 const loads=[...prefix],allowance=new Map(cartonAllowance);
 for(let i=prefix.length;i<baseline.loads.length;i++){
  const old=baseline.loads[i];
  if(old.frozen||old.plan.deliveryIdentity)throw Error("请保留已交付柜前缀 / Preserve issued containers before filling gaps");
  const local={...fleetPool(request,loads).request,container:old.plan.container};
  const residual=fleetPool(request,[...loads,...baseline.loads.slice(i)]),stock=residual.inventory!;
  const loose=new Map(stock.loose.map(p=>[p.productId,p.remaining]));
  const products=residual.products.map(p=>({...p,quantity:Math.max(0,Math.min(allowance.get(p.id)??0,p.quantity-(loose.get(p.id)??0)))}));
  let best=restoreWithUnits(local,old.plan);
  if(stock.totalUsed<stock.totalLimit&&stock.packages.some(p=>p.remaining>0)&&products.some(p=>p.quantity>0)){
   const build={...residual.request.palletBuild!,looseQuantities:undefined};
   let donor:PackingResult|undefined;
   try{donor=palletizeThenPack({...residual.request,container:{...old.plan.container,engineering:undefined},products,palletBuild:build},build.config,build.mix,build.maxPallets,build).plan;}catch{/* No complete trial unit can be prepared under these settings. */}
   if(donor?.pallets?.length){
    const fixed=occupied(old.plan,request.products).map((body,j)=>proxy(`fixed-gap-${j}`,body));
    const donors=donor.pallets.map(p=>proxy(p.id,completeUnit(donor!,p)));
    const ids=new Set(donors.map(p=>p.product.id)),anchors=fixed.map(p=>p.box);
    const exclusions=siteExclusionBoxes(old.plan.container,request.clearance);
    const container={...old.plan.container,engineering:undefined,exclusions:old.plan.container.exclusions?.map(z=>z.accessory?{...z,accessory:{...z.accessory,relatedProductIds:[]}}:z)};
    const search:PackingRequest={...local,container,products:[...fixed,...donors].map(p=>p.product),workflow:"direct",delivery:undefined,palletBuild:undefined,floorPallets:undefined};
    for(let pass=0;pass<4;pass++){
     const found=searchFixedCargo(search,anchors,pass,(box,placed)=>insertionFits(container,request.clearance,box,[...exclusions,...placed]));
     const matches=found.filter(b=>ids.has(b.productId));
     if(!matches.length)continue;
     try{
      const candidate=restoreWithUnits(local,old.plan,donor,matches);
      if(candidate.placements.length>best.placements.length)best=candidate;
     }catch{/* A proxy placement cannot bypass validation of the complete physical plan. */}
    }
   }
  }
  const originalIds=new Set(old.plan.placements.map(b=>b.id));
  for(const b of best.placements)if(!originalIds.has(b.id))allowance.set(b.productId,(allowance.get(b.productId)??0)-1);
  loads.push({plan:best,cost:old.cost});
 }
 return finishFleet(request,loads,"原位补入完整整托 / Complete units added into existing floor gaps",pricing);
}
