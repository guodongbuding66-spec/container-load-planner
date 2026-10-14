import { add, sub, mul, dot, cross, norm, boxCell, prismCell, orientFaces, clipCell, planesOf, cellVolumeCentroid, triangulatePolygon, ccw, polygonArea, unionCells, convexOverlap, cellBounds, type SolidCell, type V2, type V3 } from './solid-math';
import type { OrientationCode, OrientationSigns } from './types';
export const MODEL_KINDS=['box','cylinder','wedge','trapezoid','frustum','l-profile','u-profile','t-profile','step','polygon','tube','reel','bend','ellipsoid','capsule','custom-prism','mesh'] as const;
export type ModelKind=typeof MODEL_KINDS[number];
export type SignedFace='L-'|'L+'|'W-'|'W+'|'H-'|'H+';
export type ModelMesh={vertices:V3[];triangles:number[][];proxy:SolidCell;filename:string;closed:boolean};
export type ModelPart={id:string;name:string;kind:ModelKind;dimensions:Record<string,number>;axis:'L'|'W'|'H';position:V3;orientation:OrientationCode;orientationSigns?:OrientationSigns;section?:V2[];mesh?:ModelMesh;fixture?:boolean;weight?:number};
export type SolidModel={version:1;parts:ModelPart[];restFaces:SignedFace[];loadFaces:SignedFace[];antiRoll:boolean;calibration?:V3};
export type BuiltModel={cells:SolidCell[];display:SolidCell[];size:V3;minimum:V3;volumeRatio:number;volumeExact:boolean;center:V3;fixtureWeight:number;error:number;partCenters:{center:V3;volume:number}[];flatFaces:{points:V3[];normal:V3}[];caps:{center:V3;u:V3;v:V3;normal:V3;inner:number}[]};
const FACES:SignedFace[]=['L-','L+','W-','W+','H-','H+'];
const cache=new WeakMap<SolidModel,BuiltModel>();
const mapAxis=(p:V3,a:'L'|'W'|'H'):V3=>a==='L'?[p[2],p[0],p[1]]:a==='W'?[p[0],p[2],p[1]]:p;
const transform=(c:SolidCell,f:(p:V3)=>V3,reorient=true)=>{const changed={...c,vertices:c.vertices.map(f)};return reorient?orientFaces(changed):changed;};
const rotations=(code:OrientationCode,signs?:OrientationSigns)=>{const order=[...code].map(c=>'LWH'.indexOf(c));let odd=0;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(order[i]>order[j])odd++;return order.map((original,i)=>({original,negative:signs?signs[i]===-1:odd%2===1&&original===0}));};
function applyPart(c:SolidCell,p:ModelPart){const axes=rotations(p.orientation,p.orientationSigns);return transform(c,v=>axes.map((a,i)=>p.position[i]+v[a.original]*(a.negative?-1:1)) as V3,false);}
function clipBounds(c:SolidCell,size:V3){let out:SolidCell|null=c;for(let i=0;i<3&&out;i++){const n:V3=[0,0,0];n[i]=1;out=clipCell(out,{normal:n,offset:size[i]});if(out)out=clipCell(out,{normal:mul(n,-1),offset:0});}return out;}
function meshOfCells(cells:SolidCell[]){return cells.flatMap(c=>c.faces.map(f=>({points:f.map(i=>c.vertices[i]),normal:norm(cross(sub(c.vertices[f[1]],c.vertices[f[0]]),sub(c.vertices[f[2]],c.vertices[f[0]])))})));}
function radialPrism(rx:number,ry:number,h:number,top=1,n=32,outer=false):SolidCell{
 const factor=outer?1/Math.cos(Math.PI/n):1,vertices:V3[]=[];
 for(const [z,r] of [[0,1],[h,top]])for(let i=0;i<n;i++){const a=i*2*Math.PI/n;vertices.push([rx+Math.cos(a)*rx*r*factor,ry+Math.sin(a)*ry*r*factor,z]);}
 const c=orientFaces({vertices,faces:[Array.from({length:n},(_,i)=>i).reverse(),Array.from({length:n},(_,i)=>i+n),...Array.from({length:n},(_,i)=>[i,(i+1)%n,(i+1)%n+n,i+n])]});return outer?clipBounds(c,[rx*2,ry*2,h])!:c;
}
function ringCells(radius:number,inner:number,height:number,n=24,outer=false,z=0):SolidCell[]{
 if(!inner)return [transform(radialPrism(radius,radius,height,1,n,outer),v=>[v[0],v[1],v[2]+z])];
 const out:SolidCell[]=[];for(let i=0;i<n;i++){
  const a=2*Math.PI*i/n,b=2*Math.PI*(i+1)/n,ro=outer?radius/Math.cos(Math.PI/n):radius,ri=inner;
  const points:V2[]=[[ro*Math.cos(a)+radius,ro*Math.sin(a)+radius],[ro*Math.cos(b)+radius,ro*Math.sin(b)+radius],[ri*Math.cos(b)+radius,ri*Math.sin(b)+radius],[ri*Math.cos(a)+radius,ri*Math.sin(a)+radius]];
  let c=prismCell(points,height,2);if(outer)c=clipBounds(c,[radius*2,radius*2,height])!;if(c)out.push(transform(c,v=>[v[0],v[1],v[2]+z]));
 }return out;
}
function rounded(rx:number,ry:number,rz:number,straight:number,n=24,m=12,outer=false):SolidCell{
 const factor=outer?1/(Math.cos(Math.PI/n)*Math.cos(Math.PI/(2*m))):1,vertices:V3[]=[];
 for(let j=0;j<=m*2;j++){const a=Math.PI*j/(m*2),z=rz-rz*Math.cos(a)*factor+(j>m?straight:0);for(let i=0;i<n;i++){const b=2*Math.PI*i/n;vertices.push([rx+rx*Math.sin(a)*Math.cos(b)*factor,ry+ry*Math.sin(a)*Math.sin(b)*factor,z]);}}
 // A separate equatorial ring spans the capsule's cylindrical middle.
 if(straight>0){const equator=vertices.slice(m*n,(m+1)*n).map(v=>[v[0],v[1],v[2]+straight] as V3);vertices.splice((m+1)*n,0,...equator);}
 const rows=vertices.length/n,faces:number[][]=[];for(let j=0;j<rows-1;j++)for(let i=0;i<n;i++)faces.push([j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i]);
 const c=orientFaces({vertices,faces});return outer?clipBounds(c,[2*rx,2*ry,2*rz+straight])!:c;
}
function bendCells(radius:number,diameter:number,inner:number,angle:number,outer=false):SolidCell[]{
 const arc=angle*Math.PI/180,segments=Math.max(6,Math.ceil(angle/7.5)),n=16,r=diameter/2,ri=inner/2,cells:SolidCell[]=[],dphi=2*Math.PI/n;
 const angles=[...new Set([...Array.from({length:segments+1},(_,i)=>arc*i/segments),...Array.from({length:5},(_,i)=>i*Math.PI/2).filter(t=>t>0&&t<arc)])].sort((a,b)=>a-b);
 const point=(t:number,phi:number,rad:number):V3=>[(radius+rad*Math.cos(phi))*Math.cos(t),rad*Math.sin(phi),(radius+rad*Math.cos(phi))*Math.sin(t)];
 for(let j=0;j<angles.length-1;j++)for(let i=0;i<n;i++){
  const a=angles[j],b=angles[j+1],ds=b-a,p=i*dphi,q=(i+1)*dphi,ro=outer?r/Math.cos(dphi/2):r,rin=ri,vertices:V3[]=[];
  for(const t of [a,b])vertices.push(point(t,p,ro),point(t,q,ro),point(t,q,rin),point(t,p,rin));
  const c=orientFaces({vertices,faces:[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]});
  // Sagitta bounds the swept centerline and tube sector between both end planes.
  if(outer)c.padding=(radius+r)*(1-Math.cos(ds/2))+r*(1-Math.cos(dphi/2));cells.push(c);
 }return cells;
}
export type DimensionField={key:string;zh:string;en:string;zero?:boolean;integer?:boolean;unit?:'angle'|'count'};
export function modelFields(kind:ModelKind):DimensionField[]{
 const f=(key:string,zh:string,en:string,zero=false):DimensionField=>({key,zh,en,zero});
 const common=[f('length','长 L','Length L'),f('width','宽 W','Width W'),f('height','高 H','Height H')];
 if(kind==='polygon')return [f('diameter','外接圆直径 D','Circumcircle diameter D'),f('axial','轴向长度 h','Axial length h'),{key:'sides',zh:'截面边数',en:'Number of sides',integer:true,unit:'count'}];
 if(kind==='tube')return [f('diameter','外径 D','Outer diameter D'),f('innerDiameter','内径 d','Inner diameter d',true),f('axial','轴向长度 h','Axial length h')];
 if(kind==='reel')return [f('diameter','挡盘外径 D','Flange diameter D'),f('coreDiameter','卷芯外径','Core diameter'),f('innerDiameter','中心孔径','Bore diameter',true),f('axial','总轴向长度','Overall axial length'),f('flangeThickness','单侧挡盘厚度','Single flange thickness')];
 if(kind==='bend')return [f('radius','中心线弯曲半径 R','Centerline bend radius R'),{key:'angle',zh:'弯曲角度',en:'Bend angle',unit:'angle'},f('diameter','管外径 D','Tube outer diameter D'),f('innerDiameter','管内径 d','Tube inner diameter d',true)];
 if(kind==='capsule')return [f('diameter','圆头直径 D','Cap diameter D'),f('straight','中间直段长度','Straight middle length',true)];
 if(kind==='cylinder'||kind==='frustum')return [f('diameter','底部第一直径 D₁','Base diameter D₁'),f('diameter2','底部第二直径 D₂','Base diameter D₂'),f('axial','轴向长度 h','Axial length h'),...(kind==='frustum'?[f('topDiameter','顶部直径','Top diameter',true)]:[])];
 if(kind==='custom-prism')return [f('axial','截面延伸长度','Section extrusion length')];
 if(kind==='mesh')return [];
 if(kind.endsWith('-profile'))return [...common,f('verticalWall','竖壁／腹板厚度','Wall / web thickness'),f('horizontalWall','横壁／翼板厚度','Base / flange thickness')];
 if(kind==='step')return [...common,f('stepLength','高台长度','Raised-section length'),f('stepHeight','低台高度','Lower-level height')];
 if(kind==='trapezoid')return [...common,f('topLength','顶边长度','Top length')];
 return common;
}
export function defaultModelPart(kind:ModelKind,size:V3=[600,400,500],id='part-1'):ModelPart{
 const [length,width,height]=size,diameter=Math.min(length,width),axial=height;
 const dimensions={length,width,height,diameter,diameter2:diameter,axial,topDiameter:diameter/2,innerDiameter:diameter*.5,coreDiameter:diameter*.6,flangeThickness:axial*.12,radius:Math.max(length,height,diameter*2)*.6,angle:90,straight:Math.max(0,height-diameter),sides:6,verticalWall:length*.2,horizontalWall:height*.2,stepLength:length*.5,stepHeight:height*.5,topLength:length*.5};
 return {id,name:id,kind,dimensions,axis:'H',position:[0,0,0],orientation:'LWH',...(kind==='custom-prism'?{section:[[0,0],[length,0],[length,height*.25],[length*.25,height*.25],[length*.25,height],[0,height]] as V2[]}:{} )};
}
export function defaultSolidModel(kind:ModelKind,size?:V3):SolidModel{return {version:1,parts:[defaultModelPart(kind,size)],restFaces:[...FACES],loadFaces:[...FACES],antiRoll:false};}
function primitive(p:ModelPart):{cells:SolidCell[];display:SolidCell[];volume:number;exact:boolean;error:number;flat:{points:V3[];normal:V3}[];caps:BuiltModel["caps"]}{
 const d=p.dimensions;let cells:SolidCell[]=[],display:SolidCell[]=[],volume=0,error=0,exact=true;
 const L=d.length,W=d.width,H=d.height;
 if(['box','wedge','trapezoid','l-profile','u-profile','t-profile','step'].includes(p.kind)){
  let points:V2[];
  if(p.kind==='box')cells=[boxCell(0,0,0,L,W,H)];
  else{
   const t=d.verticalWall,h=d.horizontalWall;
   if(p.kind==='l-profile')points=[[0,0],[L,0],[L,h],[t,h],[t,H],[0,H]];
   else if(p.kind==='u-profile')points=[[0,0],[L,0],[L,H],[L-t,H],[L-t,h],[t,h],[t,H],[0,H]];
   else if(p.kind==='t-profile')points=[[(L-t)/2,0],[(L+t)/2,0],[(L+t)/2,H-h],[L,H-h],[L,H],[0,H],[0,H-h],[(L-t)/2,H-h]];
   else if(p.kind==='step')points=[[0,0],[L,0],[L,d.stepHeight],[d.stepLength,d.stepHeight],[d.stepLength,H],[0,H]];
   else if(p.kind==='wedge')points=[[0,0],[L,0],[0,H]];
   else points=[[0,0],[L,0],[(L+d.topLength)/2,H],[(L-d.topLength)/2,H]];
   const polygon=ccw(points!);cells=triangulatePolygon(polygon).map(t=>prismCell(t.map(i=>polygon[i]),W));
  }display=cells;volume=cells.reduce((n,c)=>n+cellVolumeCentroid(c).volume,0);
 }else if(p.kind==='cylinder'||p.kind==='frustum'||p.kind==='polygon'){
  const r=d.diameter/2,r2=p.kind==='polygon'?r:d.diameter2/2,top=p.kind==='frustum'?d.topDiameter/d.diameter:1,n=p.kind==='polygon'?d.sides:32;
  cells=[radialPrism(r,r2,d.axial,top,n,p.kind!=='polygon')];display=[radialPrism(r,r2,d.axial,top,p.kind==='polygon'?n:48)];
  volume=p.kind==='polygon'?n*Math.sin(2*Math.PI/n)*r*r*d.axial/2:Math.PI*r*r2*d.axial*(1+top+top*top)/3;error=p.kind==='polygon'?0:Math.max(r,r2)*(1/Math.cos(Math.PI/n)-1);
  cells=cells.map(c=>transform(c,v=>mapAxis(v,p.axis)));display=display.map(c=>transform(c,v=>mapAxis(v,p.axis)));
 }else if(p.kind==='tube'||p.kind==='reel'){
  const r=d.diameter/2,ri=d.innerDiameter/2;
  if(p.kind==='tube'){cells=ringCells(r,ri,d.axial,32,true);display=ringCells(r,ri,d.axial,48);volume=Math.PI*(r*r-ri*ri)*d.axial;}
  else{const c=d.coreDiameter/2,t=d.flangeThickness,mid=d.axial-2*t;cells=[...ringCells(r,ri,t,32,true),...ringCells(c,ri,mid,32,true,t).map(a=>transform(a,v=>[v[0]+r-c,v[1]+r-c,v[2]])),...ringCells(r,ri,t,32,true,d.axial-t)];display=[...ringCells(r,ri,t,48),...ringCells(c,ri,mid,48,false,t).map(a=>transform(a,v=>[v[0]+r-c,v[1]+r-c,v[2]])),...ringCells(r,ri,t,48,false,d.axial-t)];volume=Math.PI*((r*r-ri*ri)*2*t+(c*c-ri*ri)*mid);}
  cells=cells.map(c=>transform(c,v=>mapAxis(v,p.axis)));display=display.map(c=>transform(c,v=>mapAxis(v,p.axis)));error=r*(1/Math.cos(Math.PI/32)-1);
 }else if(p.kind==='ellipsoid'||p.kind==='capsule'){
  const a=p.kind==='capsule'?d.diameter/2:L/2,b=p.kind==='capsule'?d.diameter/2:W/2,c=p.kind==='capsule'?d.diameter/2:H/2,s=p.kind==='capsule'?d.straight:0;
  cells=[rounded(a,b,c,s,24,12,true)];display=[rounded(a,b,c,s,32,16)];volume=4*Math.PI*a*b*c/3+Math.PI*a*b*s;error=Math.max(a,b,c)*(1/(Math.cos(Math.PI/24)*Math.cos(Math.PI/24))-1);
  if(p.kind==='capsule'){cells=cells.map(c=>transform(c,v=>mapAxis(v,p.axis)));display=display.map(c=>transform(c,v=>mapAxis(v,p.axis)));}
 }else if(p.kind==='bend'){
  cells=bendCells(d.radius,d.diameter,d.innerDiameter,d.angle,true);display=bendCells(d.radius,d.diameter,d.innerDiameter,d.angle);
  volume=Math.PI*(d.diameter*d.diameter-d.innerDiameter*d.innerDiameter)/4*d.radius*d.angle*Math.PI/180;error=Math.max(...cells.map(c=>c.padding??0));
 }else if(p.kind==='custom-prism'){
  const points=ccw(p.section!);cells=triangulatePolygon(points).map(t=>prismCell(t.map(i=>points[i]),d.axial));display=cells;volume=polygonArea(points)*d.axial;
 }else if(p.kind==='mesh'){
  cells=[p.mesh!.proxy];display=[{vertices:p.mesh!.vertices,faces:p.mesh!.triangles}];volume=cellVolumeCentroid(p.mesh!.closed?display[0]:p.mesh!.proxy).volume;exact=false;
 }
 // Only genuine planar surfaces can support cargo; curved facets are excluded.
 const flat=(['ellipsoid','capsule','cylinder','frustum','tube','reel','bend'].includes(p.kind)||p.kind==='mesh'&&!p.mesh!.closed?[]:meshOfCells(display)).filter(f=>f.normal.some(n=>Math.abs(n)>1-1e-6));
 if(p.kind==='bend')exact=true;
 // Proper permutation of model coordinates changes all normals together with geometry.
 const localFlat=flat.map(f=>{const c=applyPart({vertices:f.points,faces:[f.points.map((_,i)=>i)]},p);const pts=c.vertices;return {points:pts,normal:norm(cross(sub(pts[1],pts[0]),sub(pts[2],pts[0])))};});
 const caps:BuiltModel["caps"]=[];
 const point=(v:V3)=>{const a=rotations(p.orientation,p.orientationSigns);return a.map((a,i)=>p.position[i]+v[a.original]*(a.negative?-1:1)) as V3;};
 const cap=(center:V3,u:V3,v:V3,normal:V3,inner=0)=>{const c=point(center),direction=(v:V3)=>sub(point(add(center,v)),c);caps.push({center:c,u:direction(u),v:direction(v),normal:norm(direction(normal)),inner});};
 const radialCap=(z:number,r:number,r2:number,positive:boolean,inner=0)=>cap(mapAxis([d.diameter/2,(d.diameter2??d.diameter)/2,z],p.axis),mapAxis([r,0,0],p.axis),mapAxis([0,r2,0],p.axis),mapAxis([0,0,positive?1:-1],p.axis),inner);
 if(p.kind==='cylinder'||p.kind==='frustum'){const k=p.kind==='frustum'?d.topDiameter/d.diameter:1;radialCap(0,d.diameter/2,d.diameter2/2,false);if(k>0)radialCap(d.axial,d.diameter*k/2,d.diameter2*k/2,true);}
 if(p.kind==='tube'){radialCap(0,d.diameter/2,d.diameter/2,false,d.innerDiameter/d.diameter);radialCap(d.axial,d.diameter/2,d.diameter/2,true,d.innerDiameter/d.diameter);}
 if(p.kind==='reel')for(const [z,r,positive] of [[0,d.diameter/2,false],[d.flangeThickness,d.diameter/2,true],[d.axial-d.flangeThickness,d.diameter/2,false],[d.axial,d.diameter/2,true],[d.flangeThickness,d.coreDiameter/2,false],[d.axial-d.flangeThickness,d.coreDiameter/2,true]] as [number,number,boolean][])radialCap(z,r,r,positive,d.innerDiameter/(2*r));
 if(p.kind==='bend')for(const [t,positive] of [[0,false],[d.angle*Math.PI/180,true]] as [number,boolean][]){const r=d.diameter/2;cap([d.radius*Math.cos(t),0,d.radius*Math.sin(t)],[r*Math.cos(t),0,r*Math.sin(t)],[0,r,0],mul([-Math.sin(t),0,Math.cos(t)],positive?1:-1),d.innerDiameter/d.diameter);}
 return {caps,cells:cells.map(c=>applyPart(c,p)),display:display.map(c=>applyPart(c,p)),volume,exact,error,flat:localFlat};
}
export function buildSolidModel(model:SolidModel):BuiltModel{
 const old=cache.get(model);if(old)return old;
 const scale=model.calibration??[1,1,1],volumeScale=scale[0]*scale[1]*scale[2];
 const parts=model.parts.map(primitive).map(p=>({...p,cells:p.cells.map(c=>({...transform(c,v=>v.map((n,i)=>n*scale[i]) as V3),padding:(c.padding??0)*Math.max(...scale)})),display:p.display.map(c=>transform(c,v=>v.map((n,i)=>n*scale[i]) as V3,false)),volume:p.volume*volumeScale,error:p.error*Math.max(...scale),flat:p.flat.map(f=>({points:f.points.map(v=>v.map((n,i)=>n*scale[i]) as V3),normal:norm(f.normal.map((n,i)=>n/scale[i]) as V3)}))})),display=parts.flatMap(p=>p.display),vertices=[...display.flatMap(c=>c.vertices),...parts.flatMap((p,i)=>model.parts[i].kind==="mesh"?p.cells.flatMap(c=>c.vertices):[])],minimum:V3=[Infinity,Infinity,Infinity],maximum:V3=[-Infinity,-Infinity,-Infinity];
 for(const p of vertices)for(let i=0;i<3;i++){minimum[i]=Math.min(minimum[i],p[i]);maximum[i]=Math.max(maximum[i],p[i]);}
 const size=maximum.map((n,i)=>n-minimum[i]) as V3;if(!size.every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(size[0]*size[1]*size[2]))throw Error('模型尺寸无效或超出有效范围。');
 const normalize=(p:V3)=>p.map((n,i)=>(n-minimum[i])/size[i]) as V3;
 let cells:SolidCell[]=parts.flatMap(p=>p.cells);if(cells.length>800)throw Error('模型分解超过 800 个凸体，请减少部件或弯管角度。');
 const actualBounds=parts.map((p,i)=>cellBounds({vertices:(model.parts[i].kind==='mesh'?p.cells:p.display).flatMap(c=>c.vertices),faces:[]}));
 const overlaps=parts.some((p,i)=>parts.slice(i+1).some((q,j)=>{const a=actualBounds[i],b=actualBounds[i+j+1];if(a.min.some((n,k)=>a.max[k]<=b.min[k]+1e-7||b.max[k]<=n+1e-7))return false;return p.cells.some(a=>q.cells.some(b=>convexOverlap(a,b)));}));
 const volumeExact=parts.every(p=>p.exact)&&!overlaps;let volume=parts.reduce((n,p)=>n+p.volume,0);
 let momentCells=display;if(overlaps){const union=unionCells(model.parts.some(p=>p.kind==="mesh")?cells:display,800);volume=union.reduce((n,c)=>n+cellVolumeCentroid(c).volume,0);momentCells=union;if(!cells.some(c=>c.padding))cells=unionCells(cells,800);}
 const volumeRatio=Math.min(1,Math.max(1e-12,volume/(size[0]*size[1]*size[2]))),moments=momentCells.map(cellVolumeCentroid),total=moments.reduce((n,m)=>n+m.volume,0),center=normalize(mul(moments.reduce((n,m)=>add(n,mul(m.center,m.volume)),[0,0,0]),1/(total||1)));
 const result:BuiltModel={cells:cells.map(c=>({...transform(c,normalize),padding:c.padding})),display:display.map(c=>transform(c,normalize,false)),minimum,size,volumeRatio,volumeExact,center,partCenters:parts.map(p=>{const moments=(p.exact?p.display:p.cells).map(cellVolumeCentroid),v=moments.reduce((n,m)=>n+m.volume,0);return {center:normalize(mul(moments.reduce((n,m)=>add(n,mul(m.center,m.volume)),[0,0,0]),1/(v||1))),volume:v};}),fixtureWeight:model.parts.filter(p=>p.fixture).reduce((n,p)=>n+(p.weight??0),0),error:Math.max(...parts.map(p=>p.error)),caps:parts.flatMap(p=>p.caps).map(c=>({...c,center:normalize(c.center.map((n,i)=>n*scale[i]) as V3),u:c.u.map((n,i)=>n*scale[i]/size[i]) as V3,v:c.v.map((n,i)=>n*scale[i]/size[i]) as V3,normal:norm(c.normal.map((n,i)=>n/scale[i]) as V3)})),flatFaces:parts.flatMap(p=>p.flat).map(f=>({points:f.points.map(normalize),normal:f.normal}))};cache.set(model,result);return result;
}
const parsedCache=new WeakMap<object,SolidModel>();
export function parseSolidModel(value:unknown):SolidModel|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('实体模型资料无效。');
 const known=parsedCache.get(value);if(known)return known;
 const v=value as Record<string,unknown>;if(v.version!==1||!Array.isArray(v.parts)||!v.parts.length||v.parts.length>24||typeof v.antiRoll!=='boolean')throw Error('实体模型版本、部件数量或防滚设置无效。');
 const vector=(x:unknown,n=3)=>{if(!Array.isArray(x)||x.length!==n||x.some(a=>typeof a!=='number'||!Number.isFinite(a)||Math.abs(a)>1e8))throw Error('模型坐标必须是有限数值。');return [...x];};
 const faces=(x:unknown)=>{if(!Array.isArray(x)||x.some(a=>!FACES.includes(a))||new Set(x).size!==x.length)throw Error('承托面设置无效。');return [...x] as SignedFace[];};
 const parts:ModelPart[]=v.parts.map((item:unknown)=>{
  if(!item||typeof item!=='object')throw Error('模型部件无效。');const p=item as ModelPart;
  if(!MODEL_KINDS.includes(p.kind)||typeof p.id!=='string'||!p.id.trim()||p.id.length>80||typeof p.name!=='string'||p.name.length>120||!['L','W','H'].includes(p.axis)||!['LWH','LHW','WLH','WHL','HLW','HWL'].includes(p.orientation))throw Error('模型部件名称、外形或方向无效。');
  if(!p.dimensions||typeof p.dimensions!=='object'||Array.isArray(p.dimensions))throw Error('模型部件尺寸无效。');const dimensions:Record<string,number>={};
  for(const field of modelFields(p.kind)){const n=p.dimensions[field.key];if(typeof n!=='number'||!Number.isFinite(n)||(field.zero?n<0:n<=0)||n>1e8||field.integer&&!Number.isInteger(n))throw Error('请填写全部有效的外形尺寸。');dimensions[field.key]=n;}
  const d=dimensions;
  if(p.kind==='polygon'&&(d.sides<3||d.sides>24))throw Error('多边形边数须为 3–24。');
  if(['tube','reel','bend'].includes(p.kind)&&d.innerDiameter>=d.diameter)throw Error('内径必须小于外径。');
  if(p.kind==='frustum'&&d.topDiameter>d.diameter)throw Error('顶部直径不能大于底部直径。');
  if(p.kind==='reel'&&(d.coreDiameter>=d.diameter||d.coreDiameter<=d.innerDiameter||2*d.flangeThickness>=d.axial))throw Error('卷盘须满足孔径 < 卷芯外径 < 挡盘外径，且两侧挡盘总厚度小于总长。');
  if(p.kind==='bend'&&(d.radius<=d.diameter/2||d.angle<15||d.angle>360))throw Error('弯曲半径须大于管外半径，角度须为 15–360°。');
  if(p.kind.endsWith('-profile')&&(d.verticalWall>=(p.kind==='u-profile'?d.length/2:d.length)||d.horizontalWall>=d.height))throw Error('型件壁厚无效，须保留有效截面空间');
  if(p.kind==='step'&&(d.stepLength>=d.length||d.stepHeight>=d.height))throw Error('高台长度和低台高度须分别小于总长、总高。');
  if(p.kind==='trapezoid'&&d.topLength>d.length)throw Error('顶边长度不能大于底边长度。');
  let section:V2[]|undefined,mesh:ModelMesh|undefined;
  if(p.kind==='custom-prism'){if(!Array.isArray(p.section)||p.section.length<3||p.section.length>48)throw Error('自定义截面须有 3–48 个顶点。');section=p.section.map(x=>vector(x,2) as V2);if(new Set(section.map(p=>p.join('/'))).size!==section.length||polygonArea(section)<1e-5)throw Error('截面包含重复点或面积为零。');for(let i=0;i<section.length;i++)for(let j=i+1;j<section.length;j++){if(j===i+1||i===0&&j===section.length-1)continue;const a=section[i],b=section[(i+1)%section.length],c=section[j],d=section[(j+1)%section.length];const turn=(a:V2,b:V2,c:V2)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);const on=(a:V2,b:V2,c:V2)=>Math.abs(turn(a,b,c))<1e-8&&c[0]>=Math.min(a[0],b[0])-1e-8&&c[0]<=Math.max(a[0],b[0])+1e-8&&c[1]>=Math.min(a[1],b[1])-1e-8&&c[1]<=Math.max(a[1],b[1])+1e-8;if(turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw Error('截面边不能相交或重叠。');}const signed=ccw(section);triangulatePolygon(signed);section=signed;}
  if(p.kind==='mesh'){
   const m=p.mesh;if(!m||!Array.isArray(m.vertices)||m.vertices.length<4||m.vertices.length>36000||!Array.isArray(m.triangles)||m.triangles.length<4||m.triangles.length>12000||typeof m.filename!=='string'||m.filename.length>200||typeof m.closed!=='boolean')throw Error('导入网格无效或超过 12000 个三角面。');
   const vertices=m.vertices.map(x=>vector(x) as V3),triangles=m.triangles.map(f=>{if(!Array.isArray(f)||f.length!==3||f.some(i=>!Number.isInteger(i)||i<0||i>=vertices.length))throw Error('网格三角面索引无效。');return [...f];});
   const proxy=m.proxy;if(!proxy||!Array.isArray(proxy.vertices)||proxy.vertices.length<4||proxy.vertices.length>2000||!Array.isArray(proxy.faces)||proxy.faces.length<4||proxy.faces.length>4000)throw Error('模型简化碰撞体无效。');
   const hull=orientFaces({vertices:proxy.vertices.map(x=>vector(x) as V3),faces:proxy.faces.map(f=>{if(!Array.isArray(f)||f.length<3||f.length>64||f.some(i=>!Number.isInteger(i)||i<0||i>=proxy.vertices.length))throw Error('碰撞体面索引无效。');return [...f];})});
   const edges=new Map<string,number>();for(const f of hull.faces)for(let i=0;i<f.length;i++){const a=hull.vertices[f[i]].join('/'),b=hull.vertices[f[(i+1)%f.length]].join('/'),key=[a,b].sort().join('|');edges.set(key,(edges.get(key)??0)+1);}if([...edges.values()].some(n=>n!==2))throw Error('碰撞体必须是封闭流形。');const planes=planesOf(hull);if(cellVolumeCentroid(hull).volume<=1e-6||planes.length<4||hull.vertices.some(p=>planes.some(a=>dot(a.normal,p)>a.offset+1e-5))||vertices.some(p=>planes.some(a=>dot(a.normal,p)>a.offset+1e-5)))throw Error('简化碰撞体必须完整包围模型，并且是有效凸体。');
   const triangleEdges=new Map<string,{count:number;balance:number}>();for(const f of triangles)for(let i=0;i<3;i++){const a=vertices[f[i]].join('/'),b=vertices[f[(i+1)%3]].join('/');if(a===b)continue;const key=[a,b].sort().join('|'),old=triangleEdges.get(key)??{count:0,balance:0};old.count++;old.balance+=a<b?1:-1;triangleEdges.set(key,old);}const closed=triangleEdges.size>0&&[...triangleEdges.values()].every(e=>e.count===2&&e.balance===0);mesh={vertices,triangles,proxy:hull,filename:m.filename,closed};
  }
  if(p.fixture&&p.weight===undefined)throw Error('请填写垫木／支架重量。');
  if(p.fixture!==undefined&&typeof p.fixture!=='boolean'||p.weight!==undefined&&(typeof p.weight!=='number'||!Number.isFinite(p.weight)||p.weight<0||p.weight>1e8))throw Error('垫木／支架重量无效。');
  let signs:OrientationSigns|undefined;if(p.orientationSigns!==undefined){if(!Array.isArray(p.orientationSigns)||p.orientationSigns.length!==3||p.orientationSigns.some(n=>n!==1&&n!==-1))throw Error('部件旋转符号无效。');const order=[...p.orientation].map(a=>'LWH'.indexOf(a));let inv=0;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(order[i]>order[j])inv++;if(p.orientationSigns.reduce<number>((n,s)=>n*s,1)!==(inv%2?-1:1))throw Error('部件旋转必须保留正确的实体朝向。');signs=[...p.orientationSigns];}
  return {id:p.id,name:p.name,kind:p.kind,dimensions,axis:p.axis,position:vector(p.position) as V3,orientation:p.orientation,...(signs?{orientationSigns:signs}:{}),...(section?{section}:{}),...(mesh?{mesh}:{}),...(p.fixture?{fixture:true}:{}),...(p.weight===undefined?{}:{weight:p.weight})};
 });
 if(new Set(parts.map(p=>p.id)).size!==parts.length)throw Error('模型部件 ID 不能重复。');
 let calibration:V3|undefined;if(v.calibration!==undefined){calibration=vector(v.calibration) as V3;if(calibration.some(n=>n<.000001||n>1e6))throw Error('模型缩放须为 0.000001–1000000。');}
 const model:SolidModel={version:1,parts,...(calibration?{calibration}:{}),restFaces:faces(v.restFaces),loadFaces:faces(v.loadFaces),antiRoll:v.antiRoll as boolean};buildSolidModel(model);parsedCache.set(value,model);return model;
}
export function modelToTriangles(model:SolidModel){const built=buildSolidModel(model),vertices:V3[]=[],triangles:number[][]=[];for(const c of built.display){const offset=vertices.length;vertices.push(...c.vertices);for(const f of c.faces)for(let i=1;i<f.length-1;i++)triangles.push([offset+f[0],offset+f[i],offset+f[i+1]]);}return {vertices,triangles};}
