import type {ContainerSpec,PlacedBox} from "./types";
import {parseContainerAccessory,orderedAccessories} from "./container-accessories";
export type SiteExclusion={id:string;name:string;kind:"obstacle"|"reserved";x:number;y:number;z:number;dx:number;dy:number;dz:number;accessory?:import("./container-accessories").ContainerAccessory};
export const MAX_SITE_EXCLUSIONS=16;
export const SITE_EXCLUSION_PREFIX="site-exclusion/";
/** Longitudinal clearance is reserved only for rear-loading equipment. */
export function usableCargoLength(c:ContainerSpec,clearance:number){return Math.max(0,c.length-2*Math.max(0,clearance)-(c.loadingAccess==="open"?0:Math.max(0,c.rearDoorClearanceMm??0)));}
/** Input coordinates use the physical inner nose/left/floor origin, always mm. */
export function parseSiteExclusions(value:unknown,c:Pick<ContainerSpec,"length"|"width"|"height">,draft=false):SiteExclusion[]|undefined{
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>MAX_SITE_EXCLUSIONS)throw Error("Use at most 16 site regions / 柜内区域最多 16 个");
 const ids=new Set<string>();const zones=value.map(raw=>{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Invalid site region / 柜内区域格式无效");const v=raw as SiteExclusion;
  if(typeof v.id!=="string"||!/^[-a-zA-Z0-9_]{1,80}$/.test(v.id)||ids.has(v.id)||typeof v.name!=="string"||!draft&&!v.name.trim()||v.name.length>100||!["obstacle","reserved"].includes(v.kind))throw Error("Invalid site region identity / 柜内区域名称、类型或标识无效");
  if(![v.x,v.y,v.z,v.dx,v.dy,v.dz].every(n=>typeof n==="number"&&Number.isFinite(n))||Math.min(v.x,v.y,v.z)<0||Math.min(v.dx,v.dy,v.dz)<=0||!draft&&(v.x+v.dx>c.length+.0001||v.y+v.dy>c.width+.0001||v.z+v.dz>c.height+.0001))throw Error("Site region must stay inside the physical interior / 区域必须位于实际柜内，尺寸为有效正数");
  const accessory=parseContainerAccessory(v.accessory,v.kind,draft);
  ids.add(v.id);return {id:v.id,name:v.name.trim(),kind:v.kind,x:v.x,y:v.y,z:v.z,dx:v.dx,dy:v.dy,dz:v.dz,...(accessory?{accessory}:{})};
 });if(!draft){
  orderedAccessories(zones);
  for(const s of zones.filter(z=>z.accessory?.support)){
   if(s.z!==0)throw Error("Support must rest on the floor / 首阶段支承件必须直接落地，Z 为 0");
   if(zones.some(b=>b.id!==s.id&&b.kind==="obstacle"&&s.x<b.x+b.dx-.0001&&b.x<s.x+s.dx-.0001&&s.y<b.y+b.dy-.0001&&b.y<s.y+s.dy-.0001&&s.z<b.z+b.dz-.0001&&b.z<s.z+s.dz-.0001))throw Error("Support overlaps another physical region / 支承件与其他实体区域相交");
  }
 }return zones.length?zones:undefined;
}
/** Clip only the part intersecting the usable envelope; walls already consume the safety margin. */
export function siteExclusionBoxes(c:ContainerSpec,clearance:number):PlacedBox[]{
 const length=usableCargoLength(c,clearance),width=c.width-2*clearance,height=c.height-clearance;
 return (parseSiteExclusions(c.exclusions,c)??[]).flatMap(v=>{
  const x=Math.max(0,v.x-clearance),y=Math.max(0,v.y-clearance),z=v.z,X=Math.min(length,v.x+v.dx-clearance),Y=Math.min(width,v.y+v.dy-clearance),Z=Math.min(height,v.z+v.dz);
  return X>x&&Y>y&&Z>z?[{id:`${SITE_EXCLUSION_PREFIX}${v.id}`,productId:`${SITE_EXCLUSION_PREFIX}${v.id}`,sku:v.name,name:v.name,color:v.accessory?.support?"#348566":v.kind==="obstacle"?"#bc5e38":"#8571b5",x,y,z,dx:X-x,dy:Y-y,dz:Z-z,weight:0,layer:1,orientation:"LWH" as const,supportOnly:true}]:[];
 });
}
/** Exact AABB union: overlaps are subtracted once. Planned accessory mass is accounted separately. */
export function siteExcludedVolume(c:ContainerSpec,clearance:number){
 const boxes=siteExclusionBoxes(c,clearance);if(!boxes.length)return 0;
 const xs=[...new Set(boxes.flatMap(b=>[b.x,b.x+b.dx]))].sort((a,b)=>a-b);let total=0;
 for(let i=1;i<xs.length;i++){
  const bs=boxes.filter(b=>b.x<xs[i]&&b.x+b.dx>xs[i-1]),ys=[...new Set(bs.flatMap(b=>[b.y,b.y+b.dy]))].sort((a,b)=>a-b);let area=0;
  for(let j=1;j<ys.length;j++){
   const ranges=bs.filter(b=>b.y<ys[j]&&b.y+b.dy>ys[j-1]).map(b=>[b.z,b.z+b.dz]).sort((a,b)=>a[0]-b[0]);let lo=0,hi=0,covered=0;
   for(const [a,b] of ranges){if(a>hi){covered+=hi-lo;lo=a;hi=b;}else hi=Math.max(hi,b);}covered+=hi-lo;area+=(ys[j]-ys[j-1])*covered;
  }total+=(xs[i]-xs[i-1])*area;
 }return total;
}
export function availablePackingVolume(c:ContainerSpec,clearance:number){return Math.max(0,usableCargoLength(c,clearance)*Math.max(0,c.width-2*clearance)*Math.max(0,c.height-clearance)-siteExcludedVolume(c,clearance));}
