import { searchRigidUnits, restorePackingSnapshot } from "./engine";
import { parseEngineeringDocument } from "./engineering-checks";
import { palletLoadEnvelope, unitContentsKey } from "./unit-envelope";
import { deliveryPlanSignature } from "./delivery-identity";
import type { EngineeringDocument } from "./engineering-checks";
import type { PackingRequest, PackingResult, PlacedPallet, ProductInput } from "./types";

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
/** Intact floor units retain their orientation, cartons, kits, structure, mass and identities. */
export function repackMeasuredUnits(plan:PackingResult,document:EngineeringDocument,products:ProductInput[]):PackingResult {
  const {pallets}=measuredRepackInputs(plan,document,products);
  const byId=new Map(pallets.map(p=>[p.id,p])),sourceRows=new Map(products.map(p=>[p.id,p]));
  const proxies:ProductInput[]=pallets.map(p=>{const cargo=plan.placements.filter(b=>b.palletIds?.includes(p.id)),e=palletLoadEnvelope(p,cargo);
    return {id:p.id,sku:p.id,name:p.name,length:e.dx,width:e.dy,height:e.dz,weight:p.weight+cargo.reduce((n,b)=>n+b.weight,0),quantity:1,priority:Math.max(...cargo.map(b=>sourceRows.get(b.productId)!.priority)),mustLoad:true,rotationPolicy:"fixed",allowedOrientations:["LWH"],stackable:false,bottomOnly:true,maxStackLayers:1,protectionGap:plan.palletization!.specifications?.find(s=>s.id===p.specificationId)?.config.gap??plan.palletization!.config.gap,color:"#997947"};
  });
  const outerRequest:PackingRequest={mode:"mixed",strategy:plan.strategy,practicalTargetUtilization:plan.practicalTargetUtilization,loadingRules:plan.loadingRules?{...plan.loadingRules,supportByType:undefined}:undefined,container:{...plan.container,exclusions:plan.container.exclusions?.map(r=>r.accessory?{...r,accessory:{...r.accessory,relatedProductIds:[]}}:r)},clearance:plan.clearance,products:proxies};
  const outer=searchRigidUnits(outerRequest,()=>true);
  if(!outer.validation.valid||outer.placements.length!==pallets.length)throw Error("有限搜索未找到保留全部整托的实测方案，原方案保持不变；这不证明绝对装不下 / Bounded search found no measured layout retaining all units; the original plan is unchanged, not a proof of infeasibility");
  const moved=new Map<string,PlacedPallet>();
  for(const b of outer.placements){const p=byId.get(b.productId)!;moved.set(p.id,{...p,x:b.x+p.measuredEnvelope!.noseProtrusion,y:b.y+p.measuredEnvelope!.leftProtrusion,z:0});}
  const placements=plan.placements.map(b=>{const old=byId.get(b.palletIds![0])!,next=moved.get(old.id)!;return {...b,x:b.x+next.x-old.x,y:b.y+next.y-old.y,z:b.z};});
  const request:PackingRequest={workflow:plan.workflow,mode:plan.mode,strategy:plan.strategy,practicalTargetUtilization:plan.practicalTargetUtilization,container:plan.container,clearance:plan.clearance,products,palletBuild:plan.palletBuild,loadingRules:plan.loadingRules,delivery:plan.delivery,accessConfig:plan.accessConfig};
  const candidate=restorePackingSnapshot(request,{...plan,placements,pallets:pallets.map(p=>moved.get(p.id)!),strategyPlans:undefined,strategyComparison:undefined,deliveryIdentity:plan.deliveryIdentity});
  return {...candidate,warnings:[...candidate.warnings,"已按实测保守包络底置重排，底座与托内箱位不变。重新计算整个订单使用原标称输入；修改托内货物需恢复原备份并重新测量 / Repacked floor units using measured conservative envelopes; physical bases and local contents stay unchanged. Whole-order recalculation uses nominal inputs; changed contents require the original backup and new measurements"]};
}
