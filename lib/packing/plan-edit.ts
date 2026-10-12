import { revisePackingResult } from "./engine";
import { palletAnchors } from "./floor-pallets";
import type { PackingResult, PlacedBox, ProductInput } from "./types";
export type Delta={x:number;y:number;z:number};
export type EditGroup="selection"|"set"|"pallet"|"stack";
export function expandSelection(plan:PackingResult,ids:string[],group:EditGroup){
  const selected=new Set(ids),seed=plan.placements.filter(b=>selected.has(b.id));
  if(group==="set")for(const b of plan.placements)if(seed.some(s=>s.setCode&&s.setCode===b.setCode&&s.setNumber===b.setNumber))selected.add(b.id);
  if(group==="pallet")for(const b of plan.placements)if(seed.some(s=>s.palletIds?.some(id=>b.palletIds?.includes(id))))selected.add(b.id);
  if(group==="stack"){let changed=true;while(changed){changed=false;for(const b of plan.placements)if(!selected.has(b.id)&&plan.placements.some(s=>selected.has(s.id)&&Math.abs(s.z+s.dz-b.z)<.0001&&s.x<b.x+b.dx&&b.x<s.x+s.dx&&s.y<b.y+b.dy&&b.y<s.y+s.dy)){selected.add(b.id);changed=true;}}}
  return plan.placements.filter(b=>selected.has(b.id));
}
export function selectionBounds(boxes:PlacedBox[]){
  if(!boxes.length)return null;
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),z=Math.min(...boxes.map(b=>b.z));
  return {x,y,z,dx:Math.max(...boxes.map(b=>b.x+b.dx))-x,dy:Math.max(...boxes.map(b=>b.y+b.dy))-y,dz:Math.max(...boxes.map(b=>b.z+b.dz))-z};
}
export function snapGroupTranslation(plan:PackingResult,boxes:PlacedBox[],delta:Delta,grid:number,tolerance:number){
  const bounds=selectionBounds(boxes);if(!bounds)return delta;
  const out={...delta},ids=new Set(boxes.map(b=>b.id)),others=[...plan.placements,...palletAnchors(plan.pallets??[])].filter(b=>!ids.has(b.id));
  for(const axis of ["x","y","z"] as const){
    if(!delta[axis])continue; // Never move a stationary axis as a side effect of snapping.
    const d=({x:"dx",y:"dy",z:"dz"} as const)[axis],target=bounds[axis]+delta[axis];
    const max=({x:plan.container.length-2*plan.clearance,y:plan.container.width-2*plan.clearance,z:plan.container.height-plan.clearance})[axis];
    const candidates=[0,max-bounds[d],...others.flatMap(b=>[b[axis]-bounds[d],b[axis]+b[d]])];
    let best=grid>0?Math.round(target/grid)*grid:target;
    if(tolerance>0){const near=candidates.reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a,candidates[0]);if(Math.abs(near-target)<=tolerance)best=near;}
    out[axis]=best-bounds[axis];
  }
  return out;
}
export function editPlan(plan:PackingResult,products:ProductInput[],ids:string[],group:EditGroup,delta:Delta,grid=0,tolerance=0,rotate=false){
  if(!Object.values(delta).every(Number.isFinite)||grid<0||tolerance<0)throw new Error("Invalid movement");
  const boxes=expandSelection(plan,ids,group),palletIds=new Set(group==="pallet"&&plan.palletization?boxes.flatMap(b=>b.palletIds??[]):[]),movingPallets=palletAnchors(plan.pallets??[]).filter(p=>palletIds.has(p.id)),bounds=selectionBounds([...boxes,...movingPallets]);if(!bounds)throw new Error("Select cargo first");
  const selected=new Set(boxes.map(b=>b.id)),move=rotate?delta:snapGroupTranslation(plan,[...boxes,...movingPallets],delta,grid,tolerance);
  const placements=plan.placements.map(b=>!selected.has(b.id)?b:{...b,x:b.x+move.x,y:b.y+move.y,z:b.z+move.z,...(rotate?{x:bounds.x+b.y-bounds.y+move.x,y:bounds.y+bounds.dx-(b.x-bounds.x)-b.dx+move.y,dx:b.dy,dy:b.dx,orientation:`${b.orientation[1]}${b.orientation[0]}${b.orientation[2]}`}:{})});
  const pallets=(plan.pallets??[]).map(p=>!palletIds.has(p.id)?p:{...p,x:p.x+move.x,y:p.y+move.y,z:p.z+move.z,...(rotate?{x:bounds.x+p.y-bounds.y+move.x,y:bounds.y+bounds.dx-(p.x-bounds.x)-p.dx+move.y,dx:p.dy,dy:p.dx,orientation:p.orientation==="LWH"?"WLH" as const:"LWH" as const}:{})});
  return revisePackingResult(plan,placements,products,pallets);
}
