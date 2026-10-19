import {accessoryRegions} from "./container-accessories";
import {siteExclusionBoxes,SITE_EXCLUSION_PREFIX} from "./site-exclusions";
import {bearingLoads} from "./bearing";
import type {ContainerSpec,PackingRequest,PackingResult,ProductInput} from "./types";

export const SUPPORT_WORKFLOW_ERROR="Fixed accessory supports currently require direct cargo loading / 固定支承件首阶段仅支持散箱直接装柜，请关闭支承声明或切换工作流";
export function hasAccessorySupports(c:Pick<ContainerSpec,"exclusions">){return accessoryRegions(c).some(z=>!!z.accessory.support);}
export function assertAccessorySupportWorkflow(r:PackingRequest){
  if(hasAccessorySupports(r.container)&&(r.floorPallets||r.palletBuildStage||r.workflow==="palletized"||r.workflow==="pallet-only"))throw Error(SUPPORT_WORKFLOW_ERROR);
}
/** Derived zero-mass anchors only: physical material mass/volume remain in existing accessory accounting. */
export function accessorySupportGeometry(c:ContainerSpec,clearance:number){
  const rows=new Map(accessoryRegions(c).filter(z=>z.accessory.support).map(z=>[`${SITE_EXCLUSION_PREFIX}${z.id}`,z]));
  if(!rows.size)return {boxes:[],products:[] as ProductInput[]};
  const boxes=siteExclusionBoxes(c,clearance).flatMap(b=>{
    const z=rows.get(b.id);
    // Clipping the top at the usable ceiling cannot create a new support surface.
    return z&&Math.abs(b.z+b.dz-z.z-z.dz)<.0001?[{...b,supportEvidence:{source:z.accessory.source,revision:z.accessory.revision}}]:[];
  });
  const products:ProductInput[]=boxes.map(b=>{const z=rows.get(b.id)!,limit=z.accessory.support!.maxLoadKg;return {
    id:b.productId,sku:b.sku,name:b.name,color:b.color,length:b.dx,width:b.dy,height:b.dz,weight:0,quantity:0,priority:0,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,...(limit===null?{}:{maxTopLoadKg:limit}),
  };});
  return {boxes,products};
}
export const ACCESSORY_SUPPORT_STATES:Record<"pass"|"fail"|"unverified",[string,string]>={pass:["输入静载检查通过","Entered static load check passed"],fail:["超过输入静载上限","Entered static load limit exceeded"],unverified:["未核验","Unverified"]};
/** Geometry-based area sharing, not beam bending, stiffness, floor pressure or dynamic certification. */
export function inspectAccessorySupports(plan:PackingResult,products:readonly ProductInput[]=[]){
  const regions=accessoryRegions(plan.container).filter(z=>z.accessory.support);if(!regions.length)return [];
  const complete=plan.placements.every(b=>products.some(p=>p.id===b.productId));
  const fixed=accessorySupportGeometry(plan.container,plan.clearance),loads=bearingLoads([...fixed.boxes,...plan.placements],[...products,...fixed.products]);
  return regions.map(z=>{
    const id=`${SITE_EXCLUSION_PREFIX}${z.id}`,loadKg=complete?loads.get(id)??0:undefined,limitKg=z.accessory.support!.maxLoadKg;
    const state=limitKg!==null&&loadKg!==undefined&&loadKg>limitKg+.00001?"fail":limitKg===null||!z.accessory.source.trim()||!z.accessory.revision.trim()||!complete?"unverified":"pass";
    return {id:z.id,name:z.name,loadKg,limitKg,state,source:z.accessory.source,revision:z.accessory.revision} as const;
  });
}
