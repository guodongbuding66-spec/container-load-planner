import { getOrientations, searchRigidUnits, restorePackingSnapshot } from "./engine";
import { parseEngineeringDocument } from "./engineering-checks";
import { palletLoadEnvelope, unitContentsKey } from "./unit-envelope";
import {palletQuarterTurns,rotateDeckRect} from "./deck-support";
import {quarterTurnOrientation} from "./cargo-body";
import {specificationForPallet} from "./pallet-specifications";
import { deliveryPlanSignature } from "./delivery-identity";
import type { EngineeringDocument } from "./engineering-checks";
import type { PackingRequest, PackingResult, PlacedBox, PlacedPallet, ProductInput } from "./types";

export const MAX_MEASURED_REPACK_UNITS=60;
export function measuredRepackInputs(plan:PackingResult,document:EngineeringDocument,products:ProductInput[]) {
  const doc=parseEngineeringDocument(plan,JSON.stringify(document));
  if(!plan.palletization||plan.workflow!=="palletized"||!plan.pallets?.length||plan.pallets.length>MAX_MEASURED_REPACK_UNITS||plan.placements.some(b=>b.palletIds?.length!==1))throw Error("首阶段仅支持最多 60 个完整整托，不含散箱 / This stage supports up to 60 complete units without loose cargo");
  if(plan.pallets.some(p=>p.measuredEnvelope))throw Error("当前方案已采用实测，请恢复采用前备份后重新测量 / Measurements are already adopted; restore the original backup before measuring again");
  if(plan.pallets.some(p=>p.z!==0||p.locked)||plan.placements.some(b=>b.locked))throw Error("仅支持底置且未锁定的整托，请先核对已装记录 / Only floor-level unlocked units are supported; review loaded records first");
  if(doc.units.length!==plan.pallets.length)throw Error("请完成当前全部整托的实测资料 / Complete measurements for every current unit first");
  if(doc.units.some(r=>r.extraWeightKg>0&&!r.weightIncluded))throw Error("附件增重尚未计入计划，不能只采用尺寸 / Additional attachment mass is not in the plan; dimensions cannot be adopted alone");
  const requested=new Map(products.map(p=>[p.id,p]));
  if(plan.summaries.some(s=>!requested.has(s.productId)||s.requested!==requested.get(s.productId)!.quantity))throw Error("订单输入已改变，请重新计算后测量 / Order inputs changed; recalculate and measure again");
  const pallets=plan.pallets.map(p=>{const cargo=plan.placements.filter(b=>b.palletIds?.includes(p.id)),r=doc.units.find(r=>r.palletId===p.id)!;
    if(!cargo.length)throw Error("空托不参与实测重排 / Empty pallets are not supported in measured repacking");
    return {...p,measuredEnvelope:{version:1 as const,length:r.length,width:r.width,height:r.height,noseProtrusion:r.noseProtrusion,leftProtrusion:r.leftProtrusion,source:r.source,date:r.date,contentsKey:unitContentsKey(p,cargo)}};
  });
  return {doc,pallets,sourceSignature:deliveryPlanSignature(plan)};
}
type UnitPose={pallet:PlacedPallet;cargo:PlacedBox[]};
function measuredPoses(plan:PackingResult,document:EngineeringDocument,products:ProductInput[],allowTurn:boolean){
 const {pallets}=measuredRepackInputs(plan,document,products),rules=new Map(products.map(p=>[p.id,p]));
 return pallets.map(pallet=>{
  const cargo=plan.placements.filter(b=>b.palletIds?.includes(pallet.id)),original={pallet,cargo};
  const {config}=specificationForPallet(plan.palletization!,pallet);
  if(!allowTurn||config.layout!=="auto")return {original};
  const rotatedCargo=cargo.map(b=>{
   const rect=rotateDeckRect({...b,x:b.x-pallet.x,y:b.y-pallet.y},pallet.dx,pallet.dy,1);
   return {...rect,x:pallet.x+rect.x,y:pallet.y+rect.y,...quarterTurnOrientation(b)};
  });
  if(rotatedCargo.some(b=>!getOrientations(rules.get(b.productId)!,false).some(o=>o.label===b.orientation&&o.dx===b.dx&&o.dy===b.dy&&o.dz===b.dz)))return {original};
  const envelope=palletLoadEnvelope(pallet,cargo),turned=rotateDeckRect({...envelope,x:envelope.x-pallet.x,y:envelope.y-pallet.y},pallet.dx,pallet.dy,1);
  const rotation=(palletQuarterTurns(pallet)+1)%4 as 0|1|2|3;
  const base:PlacedPallet={...pallet,dx:pallet.dy,dy:pallet.dx,orientation:rotation%2?"WLH":"LWH",quarterTurns:rotation};
  base.measuredEnvelope={...pallet.measuredEnvelope!,length:turned.dx,width:turned.dy,height:envelope.dz,
   noseProtrusion:Math.max(0,-turned.x),leftProtrusion:Math.max(0,-turned.y),contentsKey:unitContentsKey(base,rotatedCargo)};
  return {original,rotated:{pallet:base,cargo:rotatedCargo}};
 });
}

function restorePoses(plan:PackingResult,products:ProductInput[],units:UnitPose[]){
 const request:PackingRequest={workflow:plan.workflow,mode:plan.mode,strategy:plan.strategy,practicalTargetUtilization:plan.practicalTargetUtilization,container:plan.container,clearance:plan.clearance,products,palletBuild:plan.palletBuild,loadingRules:plan.loadingRules,delivery:plan.delivery,accessConfig:plan.accessConfig};
 const candidate=restorePackingSnapshot(request,{...plan,placements:units.flatMap(u=>u.cargo),pallets:units.map(u=>u.pallet),strategyPlans:undefined,strategyComparison:undefined});
 return {...candidate,warnings:[...candidate.warnings,"实测包络与整托内容一起平移或水平转向。保留实际箱托、质量和原实测来源 / The measured envelope moves or turns with the complete unit, preserving its cartons, mass and measurement source"]};
}

function moveUnit(unit:UnitPose,x:number,y:number):UnitPose{
 const dx=x-unit.pallet.x,dy=y-unit.pallet.y;
 return {pallet:{...unit.pallet,x,y},cargo:unit.cargo.map(b=>({...b,x:b.x+dx,y:b.y+dy}))};
}

/** Rebuild a worker candidate from immutable measurements, allowed turns and whole-unit coordinates. */
export function reviewMeasuredRepackCandidate(plan:PackingResult,document:EngineeringDocument,products:ProductInput[],candidate:PackingResult,allowTurn=false){
 const choices=measuredPoses(plan,document,products,allowTurn);
 if(candidate.pallets?.length!==choices.length||!candidate.validation.valid)throw Error("实测整托候选数量不一致 / Measured-unit candidate counts disagree");
 const units=choices.map(({original,rotated})=>{
  const actual=candidate.pallets!.find(p=>p.id===original.pallet.id);
  const pose=actual?.orientation===original.pallet.orientation?original:rotated;
  if(!actual||!pose||actual.z!==0||palletQuarterTurns(actual)!==palletQuarterTurns(pose.pallet))throw Error("整托转向与实测候选不一致 / Measured-unit turn differs from the permitted pose");
  return moveUnit(pose,actual.x,actual.y);
 });
 const checked=restorePoses(plan,products,units);
 if(candidate.engineVersion!==checked.engineVersion||deliveryPlanSignature(checked)!==deliveryPlanSignature(candidate)||JSON.stringify(checked.metrics)!==JSON.stringify(candidate.metrics))throw Error("实测候选位置、内容或重量未通过复核 / Measured-unit positions, contents or mass failed review");
}

/** The outer search moves complete measured units; the inner cargo is never repacked. */
export function repackMeasuredUnits(plan:PackingResult,document:EngineeringDocument,products:ProductInput[],allowTurn=false):PackingResult {
 const choices=measuredPoses(plan,document,products,allowTurn),sourceRows=new Map(products.map(p=>[p.id,p]));
 const proxies:ProductInput[]=choices.map(({original:{pallet:p,cargo},rotated})=>{
  const e=palletLoadEnvelope(p,cargo);
  return {id:p.id,sku:p.id,name:p.name,length:e.dx,width:e.dy,height:e.dz,weight:p.weight+cargo.reduce((n,b)=>n+b.weight,0),quantity:1,
   priority:Math.max(...cargo.map(b=>sourceRows.get(b.productId)!.priority)),mustLoad:true,rotationPolicy:rotated?"upright":"fixed",allowedOrientations:rotated?["LWH","WLH"]:["LWH"],stackable:false,bottomOnly:true,maxStackLayers:1,
   protectionGap:specificationForPallet(plan.palletization!,p).config.gap,color:"#997947"};
 });
 const outerRequest:PackingRequest={mode:"mixed",strategy:plan.strategy,practicalTargetUtilization:plan.practicalTargetUtilization,loadingRules:plan.loadingRules?{...plan.loadingRules,supportByType:undefined}:undefined,
  container:{...plan.container,engineering:undefined,exclusions:plan.container.exclusions?.map(r=>r.accessory?{...r,accessory:{...r.accessory,relatedProductIds:[]}}:r)},clearance:plan.clearance,products:proxies};
 const outer=searchRigidUnits(outerRequest,()=>true);
 if(!outer.validation.valid||outer.placements.length!==choices.length)throw Error("有限搜索未找到保留全部整托的实测方案 / Bounded search found no measured layout retaining all units");
 const positions=new Map(outer.placements.map(b=>[b.productId,b]));
 return restorePoses(plan,products,choices.map(({original,rotated})=>{
  const pos=positions.get(original.pallet.id)!,unit=pos.orientation==="WLH"?rotated!:original;
  return moveUnit(unit,pos.x+unit.pallet.measuredEnvelope!.noseProtrusion,pos.y+unit.pallet.measuredEnvelope!.leftProtrusion);
 }));
}
