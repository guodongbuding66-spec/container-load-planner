import type { PackingResult,PlacedBox } from './types';
export type AccessConfig={maneuver:boolean;maxLift:number;clearance:number;turn:boolean;budget:number};
export const DEFAULT_ACCESS:AccessConfig={maneuver:false,maxLift:500,clearance:0,turn:true,budget:1500};
export type RouteStep={x:number;y:number;z:number;dx:number;dy:number;dz:number;turned:boolean};
export type ManeuverRoute={status:'verified'|'not-found';steps:RouteStep[];visited:number;distance:number;turns:number;maxLift:number;maxDrop:number};
export function parseAccessConfig(value:unknown):AccessConfig|undefined{if(value===undefined)return undefined;if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid access configuration');const v=value as AccessConfig;if(typeof v.maneuver!=='boolean'||typeof v.turn!=='boolean'||![v.maxLift,v.clearance,v.budget].every(Number.isFinite)||v.maxLift<0||v.maxLift>100000||v.clearance<0||v.clearance>10000||!Number.isInteger(v.budget)||v.budget<100||v.budget>5000)throw Error('Invalid access configuration');return {maneuver:v.maneuver,maxLift:v.maxLift,clearance:v.clearance,turn:v.turn,budget:v.budget};}
const EPS=1e-5;
const overlap=(a:RouteStep,b:Pick<PlacedBox,'x'|'y'|'z'|'dx'|'dy'|'dz'>,m:number)=>a.x+a.dx+m>b.x+EPS&&b.x+b.dx+m>a.x+EPS&&a.y+a.dy+m>b.y+EPS&&b.y+b.dy+m>a.y+EPS&&a.z+a.dz+m>b.z+EPS&&b.z+b.dz+m>a.z+EPS;
/** Every accepted edge reserves its entire bounding sweep. A route is a clearance witness, not an equipment simulation. */
export function findManeuverRoute(b:PlacedBox,obstacles:PlacedBox[],plan:PackingResult,config:AccessConfig):ManeuverRoute{
 const c=plan.container,L=c.length-2*plan.clearance,W=c.width-2*plan.clearance,H=c.height-plan.clearance,m=config.clearance,doorLo=(c.width-c.doorWidth)/2,doorHi=doorLo+c.doorWidth-2*plan.clearance,doorH=c.doorHeight-plan.clearance,outside=L+Math.max(b.dx,b.dy)+m+1,maxZ=Math.min(H-b.dz,b.z+config.maxLift),minZ=Math.max(0,b.z-config.maxLift);
 const initial:RouteStep={x:b.x,y:b.y,z:b.z,dx:b.dx,dy:b.dy,dz:b.dz,turned:false};
 const inside=(s:RouteStep)=>s.x>=-EPS&&s.y>=-EPS&&s.z>=minZ-EPS&&s.y+s.dy<=W+EPS&&s.z+s.dz<=H+EPS&&s.z<=maxZ+EPS;
 const admissible=(s:RouteStep)=>inside(s)&&(s.x+s.dx<=L+EPS||s.y>=doorLo+m-EPS&&s.y+s.dy<=doorHi-m+EPS&&s.z+s.dz<=doorH-m+EPS)&&!obstacles.some(o=>overlap(s,o,m));
 const sweep=(a:RouteStep,z:RouteStep)=>{const s={...a,x:Math.min(a.x,z.x),y:Math.min(a.y,z.y),z:Math.min(a.z,z.z),dx:a.dx+Math.abs(a.x-z.x),dy:a.dy+Math.abs(a.y-z.y),dz:a.dz+Math.abs(a.z-z.z)};if(!inside(s))return false;if(s.x+s.dx>L+EPS&&(s.y<doorLo+m-EPS||s.y+s.dy>doorHi-m+EPS||s.z+s.dz>doorH-m+EPS))return false;return !obstacles.some(o=>overlap(s,o,m));};
 const clean=(values:number[],min:number,max:number)=>[...new Set(values.filter(n=>n>=min-EPS&&n<=max+EPS).map(n=>Math.round(n*10000)/10000))].sort((a,b)=>a-b).slice(0,80);
 const sizes=[b.dx,b.dy],grids=[clean([b.x,0,outside,L-b.dx,L-b.dy,...obstacles.flatMap(o=>[o.x-Math.max(...sizes)-m,o.x+o.dx+m])],0,outside),clean([b.y,0,doorLo+m,doorHi-b.dy-m,doorHi-b.dx-m,(c.width-b.dy)/2,(c.width-b.dx)/2,W-b.dy,W-b.dx,...obstacles.flatMap(o=>[o.y-b.dy-m,o.y-b.dx-m,o.y+o.dy+m])],0,W),clean([b.z,minZ,maxZ,...obstacles.flatMap(o=>[o.z-b.dz-m,o.z+o.dz+m])],minZ,maxZ)];
 const key=(s:RouteStep)=>[s.x,s.y,s.z,s.turned].join('/'),queue=[initial],seen=new Map<string,{state:RouteStep;parent:string|null}>([[key(initial),{state:initial,parent:null}]]);let cursor=0,goal:RouteStep|undefined;
 while(cursor<queue.length&&cursor<config.budget){const s=queue[cursor++];if(s.x>=L-EPS){goal=s;break;}
  const coords=[s.x,s.y,s.z];const next:RouteStep[]=[];for(let axis=0;axis<3;axis++){const vals=grids[axis],lo=vals.filter(v=>v<coords[axis]-EPS).at(-1),hi=vals.find(v=>v>coords[axis]+EPS);for(const v of [lo,hi])if(v!==undefined)next.push({...s,[['x','y','z'][axis]]:v});}
  for(const n of next){const k=key(n);if(seen.has(k)||!admissible(n)||!sweep(s,n))continue;seen.set(k,{state:n,parent:key(s)});queue.push(n);}
  if(config.turn){const radius=Math.hypot(s.dx,s.dy)/2,cx=s.x+s.dx/2,cy=s.y+s.dy/2,turnSweep={...s,x:cx-radius,y:cy-radius,dx:radius*2,dy:radius*2},n={...s,x:cx-s.dy/2,y:cy-s.dx/2,dx:s.dy,dy:s.dx,turned:!s.turned},k=key(n);if(!seen.has(k)&&turnSweep.x+turnSweep.dx<=L+EPS&&inside(turnSweep)&&admissible(n)&&!obstacles.some(o=>overlap(turnSweep,o,m))){seen.set(k,{state:n,parent:key(s)});queue.push(n);}}
 }
 if(!goal)return {status:'not-found',steps:[],visited:cursor,distance:0,turns:0,maxLift:0,maxDrop:0};const steps:RouteStep[]=[];let k:string|null=key(goal);while(k){const row:{state:RouteStep;parent:string|null}=seen.get(k)!;steps.unshift(row.state);k=row.parent;}return {status:'verified',steps,visited:cursor,distance:steps.slice(1).reduce((n,s,i)=>n+Math.hypot(s.x-steps[i].x,s.y-steps[i].y,s.z-steps[i].z),0),turns:steps.slice(1).filter((s,i)=>s.turned!==steps[i].turned).length,maxLift:Math.max(...steps.map(s=>s.z))-b.z,maxDrop:b.z-Math.min(...steps.map(s=>s.z))};
}
