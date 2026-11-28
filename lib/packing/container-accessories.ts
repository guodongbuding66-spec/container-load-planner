import type {ContainerSpec, PackingResult, PlacedBox} from "./types";
import type {SiteExclusion} from "./site-exclusions";

export const ACCESSORY_TYPES = ["timber", "airbag", "strap", "bar", "desiccant", "other"] as const;
export const ACCESSORY_TYPE_TEXT:Record<typeof ACCESSORY_TYPES[number],[string,string]> = {
  timber:["垫木／挡木","Timber / blocking"],airbag:["充气袋","Dunnage bag"],strap:["绑带","Lashing"],bar:["挡杆／支架","Bar / brace"],desiccant:["防潮附件","Moisture accessory"],other:["其他材料","Other material"],
};
/** One region encloses the ENTIRE row quantity. Distributed parts need separate rows. */
export type ContainerAccessory = {
  type:typeof ACCESSORY_TYPES[number];
  quantity:number;
  unitWeightKg:number|null;
  phase:"before-cargo"|"after-cargo";
  relatedProductIds:string[];
  afterAccessoryIds:string[];
  source:string;
  revision:string;
  note:string;
  /** Explicit solid, flat-top floor support; never inferred from the material name. */
  support?:{version:1;surface:"solid-rectangle";maxLoadKg:number|null};
};
const identity=(x:unknown)=>typeof x==="string"&&x.length>0&&x.length<=300;
export function parseContainerAccessory(value:unknown,kind:SiteExclusion["kind"],draft=false):ContainerAccessory|undefined{
  if(value===undefined)return undefined;
  const fail=()=>{throw Error("Invalid container accessory / 整柜附件的类型、数量、计划重量或安装资料无效");};
  if(!value||typeof value!=="object"||Array.isArray(value))return fail();
  const v=value as ContainerAccessory;
  if(!ACCESSORY_TYPES.includes(v.type)||!Number.isSafeInteger(v.quantity)||v.quantity<1||v.quantity>10000||!["before-cargo","after-cargo"].includes(v.phase))return fail();
  if(!(draft&&v.unitWeightKg===null)&&(typeof v.unitWeightKg!=="number"||!Number.isFinite(v.unitWeightKg)||v.unitWeightKg<0||v.unitWeightKg>1000000))return fail();
  if(kind==="reserved"&&v.unitWeightKg!==0)return fail();
  for(const key of ["relatedProductIds","afterAccessoryIds"] as const){const a=v[key];if(!Array.isArray(a)||a.length>200||a.some(x=>!identity(x))||new Set(a).size!==a.length)return fail();}
  for(const key of ["source","revision","note"] as const)if(typeof v[key]!=="string"||v[key].length>(key==="revision"?100:500))return fail();
  if(v.support!==undefined){
    const s=v.support;
    if(!s||typeof s!=="object"||Array.isArray(s)||s.version!==1||s.surface!=="solid-rectangle"||!(s.maxLoadKg===null||typeof s.maxLoadKg==="number"&&Number.isFinite(s.maxLoadKg)&&s.maxLoadKg>=0&&s.maxLoadKg<=1000000))return fail();
    if(!draft&&(kind!=="obstacle"||!["timber","bar","other"].includes(v.type)||v.quantity!==1||v.phase!=="before-cargo"))throw Error("Support requires one physical timber / brace / other piece installed before cargo / 支承件必须为装货前安装的单件实心垫木、支架或其他实体");
  }
  return {type:v.type,quantity:v.quantity,unitWeightKg:v.unitWeightKg,phase:v.phase,relatedProductIds:[...v.relatedProductIds],afterAccessoryIds:[...v.afterAccessoryIds],source:v.source.trim(),revision:v.revision.trim(),note:v.note.trim(),...(v.support?{support:{version:1 as const,surface:"solid-rectangle" as const,maxLoadKg:v.support.maxLoadKg}}:{})};
}
export function accessoryRegions(c?:Pick<ContainerSpec,"exclusions">){return (c?.exclusions??[]).filter((z):z is SiteExclusion&{accessory:ContainerAccessory}=>!!z.accessory);}
/** Dependencies refer only to other accessory rows, never to anonymous obstacles. */
export function orderedAccessories(zones:readonly SiteExclusion[]){
  const rows=accessoryRegions({exclusions:[...zones]}),byId=new Map(rows.map(z=>[z.id,z])),done=new Set<string>(),active=new Set<string>(),out:typeof rows=[];
  const visit=(z:typeof rows[number])=>{
    if(active.has(z.id))throw Error("Accessory installation dependency cycle / 附件安装依赖存在循环");
    if(done.has(z.id))return;
    active.add(z.id);
    for(const id of z.accessory.afterAccessoryIds){const before=byId.get(id);if(!before||z.accessory.phase==="before-cargo"&&before.accessory.phase==="after-cargo")throw Error("Invalid accessory installation dependency / 附件依赖不存在或安装阶段冲突");visit(before);}
    active.delete(z.id);done.add(z.id);out.push(z);
  };
  rows.filter(z=>z.accessory.phase==="before-cargo").forEach(visit);rows.forEach(visit);return out;
}
export function accessoryProductErrors(c:Pick<ContainerSpec,"exclusions">,ids:ReadonlySet<string>){return accessoryRegions(c).filter(z=>!Array.isArray(z.accessory.relatedProductIds)||z.accessory.relatedProductIds.some(id=>!ids.has(id))).map(z=>z.id);}
/** Planned on-board mass only; reservations are massless, even when overlapping a material. */
export function containerAccessoryWeight(c:Pick<ContainerSpec,"exclusions">){return accessoryRegions(c).reduce((n,z)=>n+(z.kind==="obstacle"?z.accessory.unitWeightKg===null?NaN:z.accessory.quantity*z.accessory.unitWeightKg:0),0);}
/** Unclipped physical envelope center for planned mass/balance; never inserted into support indexes. */
export function accessoryMassBoxes(c:ContainerSpec,clearance:number):PlacedBox[]{
  return accessoryRegions(c).flatMap(z=>{const weight=z.kind==="obstacle"?z.accessory.quantity*(z.accessory.unitWeightKg??0):0;return weight>0?[{id:`accessory-mass/${z.id}`,productId:`accessory-mass/${z.id}`,sku:z.name,name:z.name,color:"#bc5e38",x:z.x-clearance,y:z.y-clearance,z:z.z,dx:z.dx,dy:z.dy,dz:z.dz,weight,orientation:"LWH" as const,layer:1,supportOnly:true}]:[];});
}
/** Record ordering only, not a proof that an installer or tool can reach the location. */
export function accessoryInstallationPlan(plan:PackingResult){
  const ready=new Map<string,number>(),missingById=new Map<string,string[]>();
  return orderedAccessories(plan.container.exclusions??[]).map((z,index)=>{
    const a=z.accessory,ids=a.relatedProductIds;
    const missing=ids.filter(id=>!plan.summaries.some(s=>s.productId===id&&s.loaded>0&&s.loaded===s.requested));
    let afterCargoStep=a.phase==="before-cargo"?0:ids.length?Math.max(0,...plan.placements.map((b,i)=>ids.includes(b.productId)?i+1:0)):plan.placements.length;
    for(const id of a.afterAccessoryIds){afterCargoStep=Math.max(afterCargoStep,ready.get(id)??0);missing.push(...missingById.get(id)??[]);}
    missingById.set(z.id,[...new Set(missing)]);
    ready.set(z.id,afterCargoStep);
    return {region:z,index:index+1,afterCargoStep,missingProductIds:[...new Set(missing)],weightKg:z.kind==="obstacle"?a.quantity*(a.unitWeightKg??NaN):0};
  });
}
