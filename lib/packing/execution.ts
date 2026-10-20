import { palletAnchors } from "./floor-pallets";
import type { PackingResult, PlacedBox } from "./types";

/** Progress is tied to cargo identity and executable order, not a transient plan ID. */
export function fieldPlanFingerprint(plan: PackingResult) {
  return JSON.stringify([...(plan.deliveryIdentity?[plan.deliveryIdentity]:[]),plan.container.id, plan.container.length, plan.container.width, plan.container.height,
    plan.container.doorWidth, plan.container.doorHeight, plan.clearance, plan.strategy,
    ...(plan.container.exclusions?.length?[plan.container.exclusions]:[]),
    ...(plan.handlingTasks?.length?[plan.handlingTasks]:[]),
    plan.pallets??[], plan.floorPallets??null, plan.palletization??null, plan.delivery??null,plan.accessConfig??null, plan.cargoDetails??null, plan.placements.map(b => [b.id, b.productId, b.sku, b.x, b.y, b.z, b.dx, b.dy, b.dz, b.orientation,b.orientationSigns,b.weight, b.setCode, b.setNumber, b.setItemNumber])]);
}

/** Conservative straight translation through the door at final Y/Z. Does not model lifting/tilting. */
export function executionAudit(plan: PackingResult) {
  const blockers: { boxId:string; obstacleIds:string[] }[]=[];
  const seen:PlacedBox[]=[];
  for(const b of plan.placements){
    const obstacleIds=seen.filter(a=>a.x>=b.x+b.dx-0.0001 && a.y<b.y+b.dy-0.0001 && b.y<a.y+a.dy-0.0001 && a.z<b.z+b.dz-0.0001 && b.z<a.z+a.dz-0.0001).map(a=>a.id);
    if(obstacleIds.length || b.z+b.dz>plan.container.doorHeight-plan.clearance)blockers.push({boxId:b.id,obstacleIds});
    seen.push(b);
  }
  let transitions=0,mixedLayers=0;
  const zones=new Map<string,Set<number>>();
  plan.placements.forEach((b,i)=>{if(i&&plan.placements[i-1].sku!==b.sku)transitions++;const z=Math.floor(b.x/1000);if(!zones.has(b.sku))zones.set(b.sku,new Set());zones.get(b.sku)!.add(z);});
  const layers=new Map<number,Set<string>>();plan.placements.forEach(b=>{if(!layers.has(b.z))layers.set(b.z,new Set());layers.get(b.z)!.add(b.sku);});
  mixedLayers=[...layers.values()].filter(s=>s.size>1).length;
  return {blockers,transitions,mixedLayers,skuZones:[...zones].map(([sku,z])=>({sku,zones:z.size})),score:transitions+mixedLayers*3+blockers.length*20+plan.metrics.executionComplexity.tippedCartonCount*5};
}
export function snapTranslation(box:PlacedBox, delta:{x:number;y:number;z:number}, plan:PackingResult, tolerance=30){
  const out={...delta};const bounds={x:plan.container.length-2*plan.clearance,y:plan.container.width-2*plan.clearance,z:plan.container.height-plan.clearance};
  for(const axis of ["x","y","z"] as const){const size=({x:"dx",y:"dy",z:"dz"} as const)[axis];const target=box[axis]+delta[axis];const positions=[0,bounds[axis]-box[size],...[...palletAnchors(plan.pallets??[]),...plan.placements].filter(b=>b.id!==box.id).flatMap(b=>[b[axis]-box[size],b[axis]+b[size]])];const nearest=positions.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0];if(Math.abs(nearest-target)<=tolerance)out[axis]=nearest-box[axis];}
  return out;
}
export function fieldBlocks(plan:PackingResult){
  const groups:{key:string;sku:string;indices:number[];orientation:string;zone:number}[]=[];
  plan.placements.forEach((b,i)=>{const zone=Math.floor(b.x/1000)+1;const key=`${plan.palletization?(b.palletIds?.[0]??"loose"):""}-${zone}-${b.sku}-${b.dx}/${b.dy}/${b.dz}-${b.z}`;const last=groups.at(-1);if(last?.key===key)last.indices.push(i);else groups.push({key,sku:b.sku,indices:[i],orientation:`${b.dx} × ${b.dy} × ${b.dz}`,zone});});return groups;
}
