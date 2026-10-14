/** Certified planar support sets. Curves use interval bounds, never a faceted false full-contact area. */
import { polygonArea,convexHull2,pointInPolygon,type V2 } from './solid-math';
export type Interval=[number,number];
export type Region={kind:'polygon';points:V2[]}|{kind:'ellipse';cx:number;cy:number;rx:number;ry:number;inner:number}|{kind:'union';items:Region[]}|{kind:'intersection'|'difference';a:Region;b:Region};
const EPS=1e-9;
export const polygonRegion=(points:V2[]):Region=>({kind:'polygon',points});
export function unionRegion(items:Region[]):Region{return items.length===1?items[0]:{kind:'union',items};}
export function regionBounds(r:Region):[number,number,number,number]{
 if(r.kind==='polygon'){const x=r.points.map(p=>p[0]),y=r.points.map(p=>p[1]);return [Math.min(...x),Math.min(...y),Math.max(...x),Math.max(...y)];}
 if(r.kind==='ellipse')return [r.cx-r.rx,r.cy-r.ry,r.cx+r.rx,r.cy+r.ry];
 if(r.kind==='union'){const b=r.items.map(regionBounds);return b.length?[Math.min(...b.map(b=>b[0])),Math.min(...b.map(b=>b[1])),Math.max(...b.map(b=>b[2])),Math.max(...b.map(b=>b[3]))]:[0,0,0,0];}
 const a=regionBounds(r.a),b=regionBounds(r.b);return r.kind==='difference'?a:[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];
}
export function mergeIntervals(input:Interval[]):Interval[]{const out:Interval[]=[];for(const p of input.filter(p=>p[1]-p[0]>EPS).sort((a,b)=>a[0]-b[0])){const last=out.at(-1);if(last&&p[0]<=last[1]+EPS)last[1]=Math.max(last[1],p[1]);else out.push([...p]);}return out;}
export function intervalIntersection(a:Interval[],b:Interval[]):Interval[]{const out:Interval[]=[];for(const p of a)for(const q of b){const lo=Math.max(p[0],q[0]),hi=Math.min(p[1],q[1]);if(hi>lo+EPS)out.push([lo,hi]);}return mergeIntervals(out);}
export function intervalDifference(a:Interval[],b:Interval[]):Interval[]{let result=a;for(const q of b)result=result.flatMap(p=>q[1]<=p[0]||q[0]>=p[1]?[p]:[[p[0],Math.min(p[1],q[0])],[Math.max(p[0],q[1]),p[1]]].filter(v=>v[1]>v[0]+EPS) as Interval[]);return mergeIntervals(result);}
function primitiveBand(r:Extract<Region,{kind:'polygon'|'ellipse'}>,lo:number,hi:number):{lower:Interval[];upper:Interval[]}{
 if(r.kind==='polygon'){
  const bounds=regionBounds(r);if(hi<=bounds[0]||lo>=bounds[2])return {lower:[],upper:[]};
  const mid=(lo+hi)/2,edges=r.points.flatMap((a,i)=>{const b=r.points[(i+1)%r.points.length];if(!((a[0]<=mid&&b[0]>mid)||(b[0]<=mid&&a[0]>mid)))return [];const at=(x:number)=>a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);return [{mid:at(mid),lo:at(lo),hi:at(hi)}];}).sort((a,b)=>a.mid-b.mid);const lower:Interval[]=[],upper:Interval[]=[];for(let i=0;i+1<edges.length;i+=2){lower.push([Math.max(edges[i].lo,edges[i].hi),Math.min(edges[i+1].lo,edges[i+1].hi)]);upper.push([Math.min(edges[i].lo,edges[i].hi),Math.max(edges[i+1].lo,edges[i+1].hi)]);}return {lower:mergeIntervals(lower),upper:mergeIntervals(upper)};
 }
 const height=(x:number,scale=1)=>{const d=(x-r.cx)/(r.rx*scale);return Math.abs(d)>=1?0:r.ry*scale*Math.sqrt(Math.max(0,1-d*d));};
 const outerMin=Math.min(height(lo),height(hi)),outerMax=height(Math.max(lo,Math.min(hi,r.cx))),outerLow:Interval[]=outerMin>0?[[r.cy-outerMin,r.cy+outerMin]]:[],outerHigh:Interval[]=outerMax>0?[[r.cy-outerMax,r.cy+outerMax]]:[];
 if(!r.inner)return {lower:outerLow,upper:outerHigh};
 const innerMin=Math.min(height(lo,r.inner),height(hi,r.inner)),innerMax=height(Math.max(lo,Math.min(hi,r.cx)),r.inner);
 return {lower:intervalDifference(outerLow,innerMax?[[r.cy-innerMax,r.cy+innerMax]]:[]),upper:intervalDifference(outerHigh,innerMin?[[r.cy-innerMin,r.cy+innerMin]]:[])};
}
function band(r:Region,lo:number,hi:number):{lower:Interval[];upper:Interval[]}{
 if(r.kind==='polygon'||r.kind==='ellipse')return primitiveBand(r,lo,hi);
 if(r.kind==='union'){const b=r.items.map(r=>band(r,lo,hi));return {lower:mergeIntervals(b.flatMap(b=>b.lower)),upper:mergeIntervals(b.flatMap(b=>b.upper))};}
 const a=band(r.a,lo,hi),b=band(r.b,lo,hi);return r.kind==='intersection'?{lower:intervalIntersection(a.lower,b.lower),upper:intervalIntersection(a.upper,b.upper)}:{lower:intervalDifference(a.lower,b.upper),upper:intervalDifference(a.upper,b.lower)};
}
function breakpoints(r:Region):number[]{if(r.kind==='polygon')return r.points.map(p=>p[0]);if(r.kind==='ellipse')return [r.cx-r.rx,r.cx-r.rx*r.inner,r.cx,r.cx+r.rx*r.inner,r.cx+r.rx];if(r.kind==='union')return r.items.flatMap(breakpoints);return [...breakpoints(r.a),...breakpoints(r.b)];}
function knownArea(r:Region):number|null{if(r.kind==='polygon')return polygonArea(r.points);if(r.kind==='ellipse')return Math.PI*r.rx*r.ry*(1-r.inner*r.inner);return null;}
export function regionAreaBounds(r:Region,relativeError=.00005,budget=4096):{lower:number;upper:number;complete:boolean}{
 const exact=knownArea(r);if(exact!==null)return {lower:exact,upper:exact,complete:true};
 const [xmin,ymin,xmax,ymax]=regionBounds(r);if(xmax<=xmin||ymax<=ymin)return {lower:0,upper:0,complete:true};
 const xs=[...new Set([xmin,xmax,...breakpoints(r).filter(x=>x>xmin&&x<xmax)])].sort((a,b)=>a-b),width=(i:Interval[])=>i.reduce((n,p)=>n+p[1]-p[0],0);
 const leaf=(lo:number,hi:number)=>{const b=band(r,lo,hi);return {lo,hi,lower:Math.max(0,width(b.lower)*(hi-lo)),upper:Math.max(0,width(b.upper)*(hi-lo))};};
 const leaves=xs.slice(0,-1).map((x,i)=>leaf(x,xs[i+1]));let lower=leaves.reduce((n,b)=>n+b.lower,0),upper=leaves.reduce((n,b)=>n+b.upper,0),count=leaves.length;
 while(upper-lower>Math.max(1e-6,upper*relativeError)&&count<budget){let index=0;for(let i=1;i<leaves.length;i++)if(leaves[i].upper-leaves[i].lower>leaves[index].upper-leaves[index].lower)index=i;const old=leaves[index];if(old.hi-old.lo<1e-8)break;const mid=(old.lo+old.hi)/2,a=leaf(old.lo,mid),b=leaf(mid,old.hi);lower+=a.lower+b.lower-old.lower;upper+=a.upper+b.upper-old.upper;leaves[index]=a;leaves.push(b);count++;}
 return {lower:Math.max(0,lower),upper:Math.max(lower,upper),complete:upper-lower<=Math.max(1e-6,upper*relativeError)};
}
function same(a:Region,b:Region){return JSON.stringify(a)===JSON.stringify(b);}
function contains(container:Region,inside:Region):boolean{
 if(same(container,inside))return true;
 if(container.kind==='union')return container.items.some(r=>contains(r,inside));
 if(inside.kind==='union')return inside.items.every(r=>contains(container,r));
 if(container.kind==='polygon'&&inside.kind==='ellipse'){
  // A convex polygon contains an ellipse when its support function satisfies every edge half-plane.
  let sign=0;for(let i=0;i<container.points.length;i++){const a=container.points[i],b=container.points[(i+1)%container.points.length],c=container.points[(i+2)%container.points.length],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)>EPS){if(sign&&Math.sign(cross)!==sign)return false;sign=Math.sign(cross);}}
  return container.points.every((a,i)=>{const b=container.points[(i+1)%container.points.length],nx=(a[1]-b[1])*sign,ny=(b[0]-a[0])*sign;return nx*(inside.cx-a[0])+ny*(inside.cy-a[1])-Math.hypot(nx*inside.rx,ny*inside.ry)>=-EPS;});
 }
 if(container.kind==='ellipse'&&inside.kind==='ellipse'&&Math.abs(container.cx-inside.cx)<EPS&&Math.abs(container.cy-inside.cy)<EPS)return inside.rx<=container.rx+EPS&&inside.ry<=container.ry+EPS&&(!container.inner||(inside.inner*inside.rx>=container.inner*container.rx-EPS&&inside.inner*inside.ry>=container.inner*container.ry-EPS));
 if(container.kind==='ellipse'&&inside.kind==='polygon'){
  if(!inside.points.every(p=>((p[0]-container.cx)/container.rx)**2+((p[1]-container.cy)/container.ry)**2<=1+EPS))return false;
  if(!container.inner)return true;const transformed=inside.points.map(p=>[(p[0]-container.cx)/container.rx,(p[1]-container.cy)/container.ry] as V2);if(pointInPolygon([0,0],transformed))return false;
  return transformed.every((a,i)=>{const b=transformed[(i+1)%transformed.length],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy||1)));return (a[0]+t*dx)**2+(a[1]+t*dy)**2>=container.inner**2-EPS;});
 }
 return false;
}
export function intersectRegion(a:Region,b:Region):Region{if(contains(a,b))return b;if(contains(b,a))return a;return {kind:'intersection',a,b};}
export function differenceRegion(a:Region,b:Region):Region{if(contains(b,a))return {kind:'union',items:[]};return {kind:'difference',a,b};}
export function pointInRegion(p:V2,r:Region):boolean{
 if(r.kind==='polygon')return pointInPolygon(p,r.points);if(r.kind==='ellipse'){const q=((p[0]-r.cx)/r.rx)**2+((p[1]-r.cy)/r.ry)**2;return q<=1+EPS&&q>=r.inner*r.inner-EPS;}
 if(r.kind==='union')return r.items.some(r=>pointInRegion(p,r));return r.kind==='intersection'?pointInRegion(p,r.a)&&pointInRegion(p,r.b):pointInRegion(p,r.a)&&!pointInRegion(p,r.b);
}
function samples(r:Region):V2[]{if(r.kind==='polygon')return r.points;if(r.kind==='ellipse')return [1,...(r.inner?[r.inner]:[])].flatMap(scale=>Array.from({length:128},(_,i)=>{const t=2*Math.PI*i/128;return [r.cx+r.rx*scale*Math.cos(t),r.cy+r.ry*scale*Math.sin(t)] as V2;}));if(r.kind==='union')return r.items.flatMap(samples);return [...samples(r.a),...samples(r.b)];}
/** Stability witnesses are actual material-contact points, including region boundary crossings. */
export function regionWitnessHull(r:Region):V2[]{const p=samples(r).filter(p=>pointInRegion(p,r));const [lo,ym,hi,yM]=regionBounds(r);for(let i=0;i<=128;i++){const x=lo+(hi-lo)*i/128,b=band(r,x,x);for(const [a,c] of b.lower){const y=(a+c)/2;if(pointInRegion([x,y],r))p.push([x,y]);}}
 if(!p.length&&hi>lo&&yM>ym){const mid:[number,number]=[(lo+hi)/2,(ym+yM)/2];if(pointInRegion(mid,r))p.push(mid);}return convexHull2(p);
}
