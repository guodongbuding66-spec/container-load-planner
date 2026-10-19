import {palletEnvelopeTop} from "./deck-support";
import {siteExclusionBoxes} from "./site-exclusions";
import {findManeuverRoute,DEFAULT_ACCESS,type ManeuverRoute,type AccessConfig} from "./maneuver";
import type { PackingResult, PlacedBox } from "./types";
import { bodyContactArea } from "./cargo-body";
import { palletAnchors } from "./floor-pallets";
export type Delivery={customer:string;destination:string;stop:number};
export type DeliveryMap=Record<string,Delivery>;
export type PathIssue={id:string;phase:"load"|"unload";reason:"door"|"blocked"|"support"|"unassigned"|"mixed-stop"|"search";obstacles:string[]};
const EPS=.0001;
function corridor(a:PlacedBox,b:PlacedBox){return a.x>=b.x+b.dx-EPS&&a.y<b.y+b.dy-EPS&&b.y<a.y+a.dy-EPS&&a.z<b.z+b.dz-EPS&&b.z<a.z+a.dz-EPS;}
/** Door centered on cabinet width. At the final Y/Z, straight motion is the ONLY tested path. */
function throughDoor(b:PlacedBox,plan:PackingResult){const lo=(plan.container.width-plan.container.doorWidth)/2,hi=lo+plan.container.doorWidth-2*plan.clearance;return b.y>=lo-EPS&&b.y+b.dy<=hi+EPS&&b.z+b.dz<=plan.container.doorHeight-plan.clearance+EPS;}
export function auditAccess(plan:PackingResult,delivery:DeliveryMap=plan.delivery??{},config:AccessConfig=plan.accessConfig??DEFAULT_ACCESS){
  const routes:Record<string,ManeuverRoute>={},issues:PathIssue[]=[],open=plan.container.loadingAccess==="open";
  const fixed=siteExclusionBoxes(plan.container,plan.clearance);
  const stops={...delivery},ranks=new Map<string,number>();
  plan.placements.forEach((b,i)=>{ranks.set(b.id,i);for(const id of b.palletIds??[])if(!ranks.has(id))ranks.set(id,i);});
  const items=plan.palletization?palletAnchors(plan.pallets??[]).map(p=>{const cargo=plan.placements.filter(b=>b.palletIds?.includes(p.id)),values=cargo.map(b=>delivery[b.productId]),numbers=new Set(values.filter(d=>d?.stop>0).map(d=>d.stop));if(numbers.size>1)issues.push({id:p.id,phase:"unload",reason:"mixed-stop",obstacles:cargo.map(b=>b.id)});if(values.length&&values.every(d=>d?.stop>0))stops[p.id]={customer:"",destination:"",stop:Math.min(...values.map(d=>d.stop))};return {...p,dz:palletEnvelopeTop((plan.pallets??[]).find(q=>q.id===p.id)!,cargo)-p.z,weight:p.weight+cargo.reduce((n,b)=>n+b.weight,0)};}).concat(plan.placements.filter(b=>!b.palletIds?.length)).sort((a,b)=>(ranks.get(a.id)??0)-(ranks.get(b.id)??0)):plan.placements;
  const seen:PlacedBox[]=[...fixed,...(plan.palletization?[]:palletAnchors(plan.pallets??[]))];
  for(const b of items){if(!open){const obstacles=seen.filter(a=>corridor(a,b)).map(a=>a.id);if(!throughDoor(b,plan))issues.push({id:b.id,phase:"load",reason:"door",obstacles:[]});if(obstacles.length)issues.push({id:b.id,phase:"load",reason:"blocked",obstacles});}seen.push(b);}
  const order=[...items].sort((a,b)=>(stops[a.productId]?.stop||999)-(stops[b.productId]?.stop||999)||b.x-a.x||b.z-a.z||b.y-a.y),remaining=new Set(order.map(b=>b.id));
  for(const b of order){
    if(!stops[b.productId]?.stop)issues.push({id:b.id,phase:"unload",reason:"unassigned",obstacles:[]});
    const other=items.filter(a=>a.id!==b.id&&remaining.has(a.id));
    if(!open){const obstacles=[...fixed,...other].filter(a=>corridor(a,b)).map(a=>a.id);if(!throughDoor(b,plan))issues.push({id:b.id,phase:"unload",reason:"door",obstacles:[]});if(obstacles.length)issues.push({id:b.id,phase:"unload",reason:"blocked",obstacles});}
    const above=other.filter(a=>bodyContactArea(a,b,plan.cargoDetails?.[a.productId],plan.cargoDetails?.[b.productId])>EPS).map(a=>a.id);if(above.length)issues.push({id:b.id,phase:"unload",reason:"support",obstacles:above});
    remaining.delete(b.id);
  }
  if(config.maneuver&&!open){for(const [phase,sequence] of [["load",items],["unload",order]] as const){let context:PlacedBox[]=[...fixed,...(phase==='load'?(plan.palletization?[]:palletAnchors(plan.pallets??[])):[...items])];for(let i=0;i<sequence.length;i++){const b=sequence[i],others=context.filter(a=>a.id!==b.id),route=i<60?findManeuverRoute(b,others,plan,config):{status:'not-found' as const,steps:[],visited:0,distance:0,turns:0,maxLift:0,maxDrop:0};routes[`${phase}/${b.id}`]=phase==='load'&&route.status==='verified'?{...route,steps:[...route.steps].reverse()}:route;for(let n=issues.length-1;n>=0;n--)if(issues[n].id===b.id&&issues[n].phase===phase&&['door','blocked'].includes(issues[n].reason))issues.splice(n,1);if(route.status!=='verified')issues.push({id:b.id,phase,reason:'search',obstacles:others.filter(a=>corridor(a,b)).map(a=>a.id)});if(phase==='load')context.push(b);else context=context.filter(a=>a.id!==b.id);}}}
  return {routes,issues,order,model:open?"open-access":config.maneuver?"bounded-maneuver":"straight-rear",complete:order.every(b=>!!stops[b.productId]?.stop),valid:issues.every(i=>i.reason==="unassigned")};
}
export function parseDelivery(value:unknown,productIds:Set<string>):DeliveryMap|undefined{
  if(value===undefined)return undefined;
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid delivery settings");
  const map:DeliveryMap={};for(const [id,v] of Object.entries(value)){
    if(!productIds.has(id)||!v||typeof v!=="object")throw new Error("Invalid delivery SKU");
    const d=v as Delivery;if(typeof d.customer!=="string"||typeof d.destination!=="string"||d.customer.length>120||d.destination.length>120||!Number.isInteger(d.stop)||d.stop<0||d.stop>999)throw new Error("Invalid unload stop");
    map[id]={customer:d.customer,destination:d.destination,stop:d.stop};
  }return map;
}
