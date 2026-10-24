import {deckSupportMass} from "./deck-support";
import {parsePalletBuild} from "./loading-workflow";
import {palletSpecifications} from "./pallet-specifications";
import {retainsLoadedRows} from "./set-utils";
import type {OrderCapacityTrial} from "./order-capacity";
import type {PackingRequest,PackingResult,PlacedBox} from "./types";

/** Union of physical base projections: stacked bases must not count twice. */
function baseProjectionArea(rows:readonly {x:number;y:number;dx:number;dy:number}[]){
 const xs=[...new Set(rows.flatMap(r=>[r.x,r.x+r.dx]))].sort((a,b)=>a-b);let area=0;
 for(let i=1;i<xs.length;i++){
  const strips=rows.filter(r=>r.x<xs[i]&&r.x+r.dx>xs[i-1]).map(r=>[r.y,r.y+r.dy]).sort((a,b)=>a[0]-b[0]);
  let covered=0,start=0,end=0,first=true;
  for(const [a,b] of strips){if(first){start=a;end=b;first=false;}else if(a>end){covered+=end-start;start=a;end=b;}else end=Math.max(end,b);}
  if(!first)covered+=end-start;area+=(xs[i]-xs[i-1])*covered;
 }
 return area;
}

/** Explain the saved plan, never unapplied draft dimensions or presumed free slots. */
export function inspectPalletCapacity(plan:PackingResult){
 if(!plan.palletization||!plan.pallets?.length)return null;
 const pallets=plan.pallets,byId=new Map(pallets.map(p=>[p.id,[] as PlacedBox[]]));
 let looseCartons=0,unassignedCartons=0;
 for(const b of plan.placements){
  const ids=b.palletIds??[];
  if(ids.length===1&&byId.has(ids[0]))byId.get(ids[0])!.push(b);
  else if(!ids.length&&(plan.palletization.looseQuantities?.[b.productId]??0)>0)looseCartons++;
  else unassignedCartons++;
 }
 const stacked=pallets.some(p=>p.z>.0001);
 const rows=pallets.map(p=>{
  const cargo=byId.get(p.id)!,supportMass=deckSupportMass(p);
  const cargoKg=cargo.every(b=>Number.isFinite(b.weight)&&b.weight>=0)?cargo.reduce((n,b)=>n+b.weight,0):null;
  const capacityKg=Number.isFinite(p.maxLoad)&&p.maxLoad>=0&&Number.isFinite(supportMass)?p.maxLoad-supportMass:null;
  const reasons=[...(stacked?["stacked-units"]:[]),...(p.measuredEnvelope?["measured-envelope"]:[]),...(unassignedCartons?["cargo-associations"]:[]),...(capacityKg===null||capacityKg<0||cargoKg===null?["missing-mass"]:[])];
  const remainingKg=!reasons.length&&capacityKg!==null&&cargoKg!==null?capacityKg-cargoKg:null;
  return {id:p.id,specificationId:p.specificationId??"primary",name:p.name,length:p.dx,width:p.dy,baseHeight:p.dz,
   cartons:cargo.length,cargoKg,capacityKg,remainingKg,reasons,
   cargoHeight:Math.max(0,...cargo.map(b=>b.z+b.dz-p.z-p.dz))};
 });
 const groups=new Map<string,{id:string;name:string;units:number;cartons:number}>();
 for(const r of rows){const g=groups.get(r.specificationId)??{id:r.specificationId,name:r.name,units:0,cartons:0};g.units++;g.cartons+=r.cartons;groups.set(g.id,g);}
 const floorArea=Math.max(0,plan.container.length-2*plan.clearance)*Math.max(0,plan.container.width-2*plan.clearance),baseArea=baseProjectionArea(pallets);
 const comparable=rows.every(r=>r.remainingKg!==null),capacityKg=comparable?rows.reduce((n,r)=>n+r.capacityKg!,0):null,cargoKg=comparable?rows.reduce((n,r)=>n+r.cargoKg!,0):null;
 return {rows,groups:[...groups.values()],looseCartons,unassignedCartons,baseArea,floorArea,baseCoverage:floorArea>0?baseArea/floorArea:null,
  payloadUtilization:capacityKg!==null&&capacityKg>0&&cargoKg!==null?cargoKg/capacityKg:null};
}

export function canCompareExistingPackaging(request:PackingRequest){
 if(request.mode!=="mixed"||request.workflow!=="palletized")return false;
 try{
  const build=parsePalletBuild(request.palletBuild);
  return build.selection!=="compact"&&palletSpecifications(build).filter(s=>s.maxPallets>0&&request.products.some(p=>p.quantity>0&&(!s.productIds||s.productIds.includes(p.id)))).length>1;
 }catch{return false;}
}

/** Existing physical specifications only; no new dimensions, stock or load ratings. */
export function preparePackagingComparisonTrial(request:PackingRequest):OrderCapacityTrial{
 if(!canCompareExistingPackaging(request))throw Error("请启用至少两种适用包装规格，并使用按列表顺序模式 / Enable at least two eligible packaging specifications in list-order mode");
 const count=request.products.reduce((n,p)=>n+p.quantity,0);
 if(count<1||count>4000)throw Error("包装比选支持 1–4000 箱订单 / Packaging trials support orders of 1–4000 cartons");
 const next=structuredClone(request);next.palletBuild={...parsePalletBuild(next.palletBuild),selection:"compact"};
 next.strategy=request.strategy??"practical";next.delivery=undefined;next.singleCartonLimit=undefined;
 return {request:next,arithmeticCartons:count,budgetLimited:false,packagingSelectionChange:{from:"ordered",to:"compact"}};
}

/** More cartons cannot silently displace a previously loaded order row. */
export function improvesPalletTrial(candidate:PackingResult,baseline:PackingResult){
 return candidate.validation.valid&&baseline.validation.valid&&candidate.metrics.loadedCount>baseline.metrics.loadedCount&&retainsLoadedRows(candidate.placements,baseline.placements);
}
