import { worldModelCells } from './model-body';
import { cellBounds,boxCell,convexOverlap,planesOf,dot,type SolidCell } from './solid-math';
import type { PlacedBox,ProductInput } from './types';
export type SpaceBox=Pick<PlacedBox,'x'|'y'|'z'|'dx'|'dy'|'dz'>;
const EPS=.0001;
const volume=(b:SpaceBox)=>b.dx*b.dy*b.dz;
function intersects(a:SpaceBox,b:SpaceBox){return a.x+a.dx>b.x+EPS&&b.x+b.dx>a.x+EPS&&a.y+a.dy>b.y+EPS&&b.y+b.dy>a.y+EPS&&a.z+a.dz>b.z+EPS&&b.z+b.dz>a.z+EPS;}
/** Only boxes with a proved separation from every conservative convex cell are returned. */
export function certifiedModelGaps(space:SpaceBox,placed:PlacedBox,product:Pick<ProductInput,'solidModel'>,budget=2400):{spaces:SpaceBox[];approximate:boolean;tested:number}{
 const cells=worldModelCells(placed,product),bounds=cells.map(c=>{const a=cellBounds(c);return {x:a.min[0],y:a.min[1],z:a.min[2],dx:a.max[0]-a.min[0],dy:a.max[1]-a.min[1],dz:a.max[2]-a.min[2]};}),result:SpaceBox[]=[],queue:Array<{box:SpaceBox;ids:number[];depth:number}>=[{box:space,ids:cells.map((_,i)=>i),depth:0}];let tested=0,approximate=false;
 const planes=new Map<SolidCell,ReturnType<typeof planesOf>>();
 const invariant=[0,1,2].map(axis=>cells.every(c=>{const a=cellBounds(c);return Math.abs(a.min[axis]-[placed.x,placed.y,placed.z][axis])<EPS&&Math.abs(a.max[axis]-[placed.x+placed.dx,placed.y+placed.dy,placed.z+placed.dz][axis])<EPS&&planesOf(c).every(p=>Math.abs(p.normal[axis])<EPS||Math.abs(p.normal[axis])>1-EPS);}));
 while(queue.length){const {box:b,ids,depth}=queue.pop()!,candidate=boxCell(b.x,b.y,b.z,b.dx,b.dy,b.dz),neighbors=ids.filter(i=>intersects(b,bounds[i])&&convexOverlap(candidate,cells[i]));tested++;
  if(!neighbors.length){result.push(b);continue;}
  const inside=neighbors.some(i=>{if(cells[i].padding)return false;let p=planes.get(cells[i]);if(!p){p=planesOf(cells[i]);planes.set(cells[i],p);}return candidate.vertices.every(v=>p!.every(a=>dot(a.normal,v)<=a.offset+1e-7));});if(inside)continue;
  if(tested+queue.length>=budget||depth>=15||Math.max(b.dx,b.dy,b.dz)<Math.max(2,Math.max(space.dx,space.dy,space.dz)/128)){approximate=true;continue;}
  const lengths=[b.dx,b.dy,b.dz],axis=lengths.indexOf(Math.max(...lengths.map((n,i)=>invariant[i]?0:n))),pos=(['x','y','z'] as const)[axis],size=(['dx','dy','dz'] as const)[axis],half=b[size]/2;
  queue.push({box:{...b,[pos]:b[pos]+half,[size]:half},ids:neighbors,depth:depth+1},{box:{...b,[size]:half},ids:neighbors,depth:depth+1});
 }
 return {spaces:result.filter(b=>volume(b)>EPS),approximate,tested};
}
