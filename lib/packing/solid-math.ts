/** Pure convex geometry used identically by solver workers and independent validation. */
export type V3=[number,number,number];
export type V2=[number,number];
export type Polyhedron={vertices:V3[];faces:number[][];padding?:number};
export type SolidCell=Polyhedron;
export type Plane={normal:V3;offset:number};
export const add=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a:V3,b:V3):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const mul=(a:V3,n:number):V3=>[a[0]*n,a[1]*n,a[2]*n];
export const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=(a:V3):V3=>mul(a,1/(Math.hypot(...a)||1));
const EPS=1e-8;
export function boxCell(x:number,y:number,z:number,dx:number,dy:number,dz:number):SolidCell{
 return {vertices:[[x,y,z],[x+dx,y,z],[x+dx,y+dy,z],[x,y+dy,z],[x,y,z+dz],[x+dx,y,z+dz],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]],faces:[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]};
}
export function polygonArea(p:V2[]){return Math.abs(p.reduce((n,a,i)=>{const b=p[(i+1)%p.length];return n+a[0]*b[1]-b[0]*a[1];},0))/2;}
export function signedArea(p:V2[]){return p.reduce((n,a,i)=>{const b=p[(i+1)%p.length];return n+a[0]*b[1]-b[0]*a[1];},0)/2;}
export function ccw(p:V2[]){return signedArea(p)<0?[...p].reverse():p;}
export function clipPolygon(subject:V2[],clip:V2[]):V2[]{
 let out=subject;const c=ccw(clip);
 for(let i=0;i<c.length&&out.length;i++){
  const a=c[i],b=c[(i+1)%c.length],side=(p:V2)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),next:V2[]=[];
  for(let j=0;j<out.length;j++){const p=out[j],q=out[(j+1)%out.length],sp=side(p),sq=side(q);if(sp>=-EPS)next.push(p);if((sp>EPS&&sq<-EPS)||(sp<-EPS&&sq>EPS)){const t=sp/(sp-sq);next.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}
  out=next;
 }return polygonArea(out)>EPS?out:[];
}
export function subtractPolygon(subject:V2[],clip:V2[]):V2[][]{
 let inside=ccw(subject);const result:V2[][]=[],c=ccw(clip);
 for(let i=0;i<c.length&&inside.length;i++){
  const a=c[i],b=c[(i+1)%c.length],side=(p:V2)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),pos:V2[]=[],neg:V2[]=[];
  for(let j=0;j<inside.length;j++){const p=inside[j],q=inside[(j+1)%inside.length],sp=side(p),sq=side(q);if(sp>=-EPS)pos.push(p);if(sp<=EPS)neg.push(p);if((sp>EPS&&sq<-EPS)||(sp<-EPS&&sq>EPS)){const t=sp/(sp-sq),v:V2=[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];pos.push(v);neg.push(v);}}
  if(polygonArea(neg)>EPS)result.push(neg);inside=polygonArea(pos)>EPS?pos:[];
 }return result;
}
export function unionPolygons(input:V2[][]){const disjoint:V2[][]=[];for(const p of input){let parts=[ccw(p)];for(const old of disjoint)parts=parts.flatMap(a=>subtractPolygon(a,old));disjoint.push(...parts);}return disjoint;}
export function convexHull2(points:V2[]):V2[]{
 const a=[...new Map(points.map(p=>[p.join('/'),p])).values()].sort((p,q)=>p[0]-q[0]||p[1]-q[1]);if(a.length<3)return a;
 const c=(o:V2,p:V2,q:V2)=>(p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0]),half=(arr:V2[])=>{const h:V2[]=[];for(const p of arr){while(h.length>1&&c(h.at(-2)!,h.at(-1)!,p)<=EPS)h.pop();h.push(p);}return h;};
 return [...half(a).slice(0,-1),...half(a.toReversed()).slice(0,-1)];
}
export function pointInPolygon(p:V2,polygon:V2[]){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
 const a=polygon[i],b=polygon[j],dx=b[0]-a[0],dy=b[1]-a[1],s=(p[0]-a[0])*dy-(p[1]-a[1])*dx;if(Math.abs(s)<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS)return true;
 if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;}
export function triangulatePolygon(points:V2[]):number[][]{
 const p=ccw(points),indices=p.map((_,i)=>i),out:number[][]=[];
 const side=(a:V2,b:V2,c:V2)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 while(indices.length>3){let found=false;for(let i=0;i<indices.length;i++){const a=indices[(i+indices.length-1)%indices.length],b=indices[i],c=indices[(i+1)%indices.length];if(side(p[a],p[b],p[c])<=EPS)continue;
 if(indices.some(j=>j!==a&&j!==b&&j!==c&&side(p[a],p[b],p[j])>=-EPS&&side(p[b],p[c],p[j])>=-EPS&&side(p[c],p[a],p[j])>=-EPS))continue;
 out.push([a,b,c]);indices.splice(i,1);found=true;break;}if(!found)throw Error('截面不能自交或包含重复、共线退化点。');}
 out.push(indices);return out;
}
export function prismCell(points:V2[],depth:number,axis=1):SolidCell{
 const p=ccw(points),n=p.length,map=(a:V2,d:number):V3=>axis===0?[d,a[0],a[1]]:axis===2?[a[0],a[1],d]:[a[0],d,a[1]];
 const vertices=[...p.map(a=>map(a,0)),...p.map(a=>map(a,depth))],faces=[p.map((_,i)=>i).reverse(),p.map((_,i)=>i+n),...p.map((_,i)=>[i,(i+1)%n,(i+1)%n+n,i+n])];
 return orientFaces({vertices,faces});
}
export function orientFaces(cell:SolidCell):SolidCell{
 const center=mul(cell.vertices.reduce(add,[0,0,0]),1/cell.vertices.length);
 return {...cell,faces:cell.faces.map(f=>dot(cross(sub(cell.vertices[f[1]],cell.vertices[f[0]]),sub(cell.vertices[f[2]],cell.vertices[f[0]])),sub(cell.vertices[f[0]],center))<0?[...f].reverse():f)};
}
export function planesOf(cell:SolidCell):Plane[]{return cell.faces.flatMap(f=>{const n=norm(cross(sub(cell.vertices[f[1]],cell.vertices[f[0]]),sub(cell.vertices[f[2]],cell.vertices[f[0]])));return Math.hypot(...n)>EPS?[{normal:n,offset:dot(n,cell.vertices[f[0]])}]:[];});}
export function cellBounds(c:SolidCell){const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];for(const p of c.vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]-(c.padding??0));max[i]=Math.max(max[i],p[i]+(c.padding??0));}return {min,max};}
export function cellVolumeCentroid(cell:SolidCell){const origin=cell.vertices[0];let volume=0,c:V3=[0,0,0];for(const f of cell.faces)for(let i=1;i<f.length-1;i++){const a=sub(cell.vertices[f[0]],origin),b=sub(cell.vertices[f[i]],origin),d=sub(cell.vertices[f[i+1]],origin),v=dot(a,cross(b,d))/6;volume+=v;c=add(c,mul(add(add(a,b),d),v/4));}return {volume:Math.abs(volume),center:Math.abs(volume)>EPS?add(origin,mul(c,1/volume)):mul(cell.vertices.reduce(add,[0,0,0]),1/cell.vertices.length)};}
const collisionCache=new WeakMap<SolidCell,{bounds:ReturnType<typeof cellBounds>;normals?:V3[];edges?:V3[];planes?:Plane[];center?:V3}>();
function collisionInfo(c:SolidCell){let data=collisionCache.get(c);if(data)return data;data={bounds:cellBounds(c)};collisionCache.set(c,data);return data;}
function collisionPlanes(c:SolidCell){const info=collisionInfo(c);return info.planes??(info.planes=planesOf(c));}
function cellCenter(c:SolidCell){const info=collisionInfo(c);return info.center??(info.center=mul(c.vertices.reduce(add,[0,0,0]),1/c.vertices.length));}
function strictInside(point:V3,cell:SolidCell){return collisionPlanes(cell).every(p=>dot(p.normal,point)<p.offset-EPS);}
function cellNormals(c:SolidCell){const info=collisionInfo(c);if(info.normals)return info.normals;const normals:V3[]=[];for(const p of collisionPlanes(c))if(!normals.some(a=>Math.abs(dot(a,p.normal))>1-1e-9))normals.push(p.normal);info.normals=normals;return normals;}
function cellEdges(c:SolidCell){const info=collisionInfo(c);if(info.edges)return info.edges;const edges:V3[]=[];for(const f of c.faces)for(let i=0;i<f.length;i++){const v=norm(sub(c.vertices[f[(i+1)%f.length]],c.vertices[f[i]]));if(Math.hypot(...v)>EPS&&!edges.some(a=>Math.abs(dot(a,v))>1-1e-9))edges.push(v);}info.edges=edges;return edges;}
/** SAT is exact for convex polytopes; padding adds conservative separation distance. */
export function convexOverlap(a:SolidCell,b:SolidCell,gap=0){
 const ai=collisionInfo(a),bi=collisionInfo(b),ab=ai.bounds,bb=bi.bounds,padding=(a.padding??0)+(b.padding??0)+gap;
 if(ab.min.some((n,i)=>ab.max[i]+gap<=bb.min[i]+EPS||bb.max[i]+gap<=n+EPS))return false;
 // An interior witness proves real penetration without enumerating every edge-cross axis.
 const ac=cellCenter(a),bc=cellCenter(b),mid=mul(add(ac,bc),.5);
 if(strictInside(ac,b)||strictInside(bc,a)||(strictInside(mid,a)&&strictInside(mid,b)))return true;
 const separated=(n:V3)=>{let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;for(const v of a.vertices){const d=dot(v,n);amin=Math.min(amin,d);amax=Math.max(amax,d);}for(const v of b.vertices){const d=dot(v,n);bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}return amax+padding<=bmin+EPS||bmax+padding<=amin+EPS;};
 for(const n of cellNormals(a))if(separated(n))return false;for(const n of cellNormals(b))if(separated(n))return false;
 for(const x of cellEdges(a))for(const y of cellEdges(b)){const n=cross(x,y);if(Math.hypot(...n)>1e-7&&separated(norm(n)))return false;}
 return true;
}
export function clipCell(c:SolidCell,plane:Plane):SolidCell|null{
 const faces:V3[][]=[],cut:V3[]=[];
 for(const f of c.faces){const p=f.map(i=>c.vertices[i]),out:V3[]=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],da=dot(plane.normal,a)-plane.offset,db=dot(plane.normal,b)-plane.offset;if(da<=EPS)out.push(a);if((da>EPS&&db<-EPS)||(da<-EPS&&db>EPS)){const q=add(a,mul(sub(b,a),da/(da-db)));out.push(q);cut.push(q);}}if(out.length>=3)faces.push(out);}
 if(cut.length>=3){const u=norm(cross(plane.normal,Math.abs(plane.normal[0])<.8?[1,0,0]:[0,1,0])),v=cross(plane.normal,u),center=mul(cut.reduce(add,[0,0,0]),1/cut.length);cut.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));faces.push(cut);}
 const vertices:V3[]=[],indices=faces.map(f=>f.map(p=>{let i=vertices.findIndex(q=>Math.hypot(...sub(q,p))<EPS);if(i<0){i=vertices.length;vertices.push(p);}return i;})).map(f=>[...new Set(f)]).filter(f=>f.length>=3);
 if(vertices.length<4||!indices.length)return null;const out=orientFaces({vertices,faces:indices});return cellVolumeCentroid(out).volume>EPS?out:null;
}
export function subtractCell(a:SolidCell,b:SolidCell):SolidCell[]{let inside:SolidCell|null=a;const out:SolidCell[]=[];for(const p of planesOf(b)){if(!inside)break;const outside=clipCell(inside,{normal:mul(p.normal,-1),offset:-p.offset});if(outside)out.push(outside);inside=clipCell(inside,p);}return out;}
export function unionCells(cells:SolidCell[],limit=600){const out:SolidCell[]=[];for(const c of cells){let pieces=[c];for(const old of out){pieces=pieces.flatMap(p=>convexOverlap(p,old)?subtractCell(p,old):[p]);if(pieces.length+out.length>limit)throw Error('组合模型过于复杂，请减少基本形体或简化截面。');}out.push(...pieces);}return out;}
