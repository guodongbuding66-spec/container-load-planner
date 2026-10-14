import { buildSolidModel, type SignedFace, type SolidModel } from './solid-model';
import { polygonRegion,unionRegion,differenceRegion,regionBounds,regionAreaBounds,regionWitnessHull,type Region } from './planar-region';
import { add, sub, mul, convexOverlap, convexHull2, polygonArea, unionPolygons, subtractPolygon, type SolidCell, type V2, type V3 } from './solid-math';
import type { ProductInput, PlacedBox, OrientationCode, OrientationSigns } from './types';
export type ModelBody=Pick<PlacedBox,'x'|'y'|'z'|'dx'|'dy'|'dz'> & {orientation?:string;orientationSigns?:OrientationSigns};
export type PolygonSurface={x:number;y:number;dx:number;dy:number;polygon:V2[];region?:Region;areaLower?:number;areaUpper?:number};
type Shape=Pick<ProductInput,'solidModel'|'protectionGap'> & {weight?:number};
const EPS=.0001;
function axesOf(code:OrientationCode,signs?:OrientationSigns){const o=[...code].map(a=>'LWH'.indexOf(a));let inv=0;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(o[i]>o[j])inv++;return o.map((original,i)=>({original,negative:signs?signs[i]===-1:inv%2===1&&original===0}));}
function mapPoint(b:ModelBody,p:V3){const a=axesOf((b.orientation??'LWH') as OrientationCode,b.orientationSigns),pos=[b.x,b.y,b.z],size=[b.dx,b.dy,b.dz];return a.map((axis,i)=>pos[i]+(axis.negative?1-p[axis.original]:p[axis.original])*size[i]) as V3;}
function faceKey(n:V3){const i=n.findIndex(a=>Math.abs(a)>1-1e-6);return i<0?null:`${'LWH'[i]}${n[i]<0?'-':'+'}` as SignedFace;}
const worldCellCache=new WeakMap<ModelBody,Map<object,{key:string;cells:SolidCell[]}>>();
export function worldModelCells(b:ModelBody,p:Shape):SolidCell[]{
 if(!p.solidModel)return [];
 const key=[b.x,b.y,b.z,b.dx,b.dy,b.dz,b.orientation,b.orientationSigns?.join()].join("/"),bucket=worldCellCache.get(b)??new Map<object,{key:string;cells:SolidCell[]}>(),old=bucket.get(p.solidModel);if(old?.key===key)return old.cells;
 const built=buildSolidModel(p.solidModel),axes=axesOf((b.orientation??'LWH') as OrientationCode,b.orientationSigns),sizes=[b.dx,b.dy,b.dz],factor=Math.max(...axes.map((a,i)=>sizes[i]/built.size[a.original]));
 const cells=built.cells.map(c=>({...c,vertices:c.vertices.map(v=>mapPoint(b,v)),padding:(c.padding??0)*factor}));bucket.set(p.solidModel,{key,cells});worldCellCache.set(b,bucket);return cells;
}
function slice(c:SolidCell,z:number):V2[]{const points:V2[]=[];for(const f of c.faces)for(let i=0;i<f.length;i++){const a=c.vertices[f[i]],b=c.vertices[f[(i+1)%f.length]];if(Math.abs(a[2]-z)<EPS)points.push([a[0],a[1]]);if((a[2]<z-EPS&&b[2]>z+EPS)||(a[2]>z+EPS&&b[2]<z-EPS)){const t=(z-a[2])/(b[2]-a[2]);points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}const hull=convexHull2(points);return polygonArea(hull)>EPS?hull:[];}
function buildModelSurfaces(b:ModelBody,p:Shape,level:number,top:boolean):PolygonSurface[]{
 if(!p.solidModel)return [];
 const model=p.solidModel,built=buildSolidModel(model),permissions=top?model.loadFaces:model.restFaces,axes=axesOf((b.orientation??'LWH') as OrientationCode,b.orientationSigns);
 const raw=built.flatFaces.flatMap(f=>{
  const key=faceKey(f.normal);if(!key||!permissions.includes(key))return [];
  const normal=axes.map(a=>f.normal[a.original]*(a.negative?-1:1));if(top?normal[2]<.999999:normal[2]>-.999999)return [];
  const points=f.points.map(v=>mapPoint(b,v));if(points.some(v=>Math.abs(v[2]-level)>EPS))return [];
  const poly=points.map(v=>[v[0],v[1]] as V2);return polygonArea(poly)>EPS?[poly]:[];
 });
 const caps=built.caps.flatMap(c=>{const key=faceKey(c.normal);if(!key||!permissions.includes(key))return [];const normal=axes.map(a=>c.normal[a.original]*(a.negative?-1:1));if(top?normal[2]<.999999:normal[2]>-.999999)return [];const center=mapPoint(b,c.center);if(Math.abs(center[2]-level)>EPS)return [];const u=sub(mapPoint(b,add(c.center,c.u)),center),v=sub(mapPoint(b,add(c.center,c.v)),center);return [{kind:'ellipse',cx:center[0],cy:center[1],rx:Math.hypot(u[0],v[0]),ry:Math.hypot(u[1],v[1]),inner:c.inner} as Region];});
 const polygons=unionPolygons(raw);if(!caps.length){let exposed=polygons;if(top)for(const c of worldModelCells(b,p).filter(c=>Math.min(...c.vertices.map(v=>v[2]))<=level+EPS&&Math.max(...c.vertices.map(v=>v[2]))>level+EPS)){const mask=slice(c,level);if(mask.length)exposed=exposed.flatMap(a=>subtractPolygon(a,mask));}return exposed.map(polygon=>{const [x,y,X,Y]=regionBounds(polygonRegion(polygon));return {x,y,dx:X-x,dy:Y-y,polygon};});}
 let region=unionRegion([...polygons.map(polygonRegion),...caps]);if(top){const masks=worldModelCells(b,p).filter(c=>Math.min(...c.vertices.map(v=>v[2]))<=level+EPS&&Math.max(...c.vertices.map(v=>v[2]))>level+EPS).map(c=>slice(c,level)).filter(c=>c.length);if(masks.length)region=differenceRegion(region,unionRegion(unionPolygons(masks).map(polygonRegion)));}
 const area=regionAreaBounds(region,.0002,512);if(area.upper<EPS)return [];const [x,y,X,Y]=regionBounds(region);return [{x,y,dx:X-x,dy:Y-y,polygon:regionWitnessHull(region),region,areaLower:area.lower,areaUpper:area.upper}];
}
const surfaceCache=new WeakMap<SolidModel,Map<string,PolygonSurface[]>>();
function shiftRegion(region:Region,x:number,y:number):Region{
 if(region.kind==='polygon')return {...region,points:region.points.map(p=>[p[0]+x,p[1]+y])};
 if(region.kind==='ellipse')return {...region,cx:region.cx+x,cy:region.cy+y};
 if(region.kind==='union')return {...region,items:region.items.map(r=>shiftRegion(r,x,y))};
 return {...region,a:shiftRegion(region.a,x,y),b:shiftRegion(region.b,x,y)};
}
/** Cache local support geometry; translations preserve contact area and certified witnesses. */
export function modelSurfaces(b:ModelBody,p:Shape,level:number,top:boolean):PolygonSurface[]{
 if(!p.solidModel)return [];
 const relative=level-b.z,key=[b.dx,b.dy,b.dz,b.orientation??'LWH',b.orientationSigns?.join(),relative.toFixed(8),top].join('/');
 const bucket=surfaceCache.get(p.solidModel)??new Map<string,PolygonSurface[]>();let surfaces=bucket.get(key);
 if(!surfaces){surfaces=buildModelSurfaces({...b,x:0,y:0,z:0},p,relative,top);if(bucket.size>=128)bucket.clear();bucket.set(key,surfaces);surfaceCache.set(p.solidModel,bucket);}
 if(!b.x&&!b.y)return surfaces;
 return surfaces.map(s=>({...s,x:s.x+b.x,y:s.y+b.y,polygon:s.polygon.map(v=>[v[0]+b.x,v[1]+b.y]),...(s.region?{region:shiftRegion(s.region,b.x,b.y)}:{})}));
}
export function modelTopLevels(b:ModelBody,p:Shape){if(!p.solidModel)return [];const built=buildSolidModel(p.solidModel),axes=axesOf((b.orientation??'LWH') as OrientationCode,b.orientationSigns),faces=[...built.flatFaces.map(f=>({point:f.points[0],normal:f.normal})),...built.caps.map(c=>({point:c.center,normal:c.normal}))];return [...new Set(faces.filter(f=>{const k=faceKey(f.normal);return k&&p.solidModel!.loadFaces.includes(k)&&f.normal[axes[2].original]*(axes[2].negative?-1:1)>.999999;}).map(f=>mapPoint(b,f.point)[2]))].filter(z=>modelSurfaces(b,p,z,true).length);}
export function modelBodiesOverlap(a:ModelBody,b:ModelBody,pa:Shape,pb:Shape,fallbackA:SolidCell[],fallbackB:SolidCell[],gap=0){const ac=pa.solidModel?worldModelCells(a,pa):fallbackA,bc=pb.solidModel?worldModelCells(b,pb):fallbackB;return ac.some(a=>bc.some(b=>convexOverlap(a,b,gap)));}
export function modelMassCenter(b:ModelBody,p:Shape){
 if(!p.solidModel)return [b.x+b.dx/2,b.y+b.dy/2,b.z+b.dz/2] as V3;
 const built=buildSolidModel(p.solidModel);let center=built.center;
 if(p.weight&&p.solidModel.parts.some(a=>a.weight!==undefined)){
  const known=p.solidModel.parts.reduce((n,a)=>n+(a.weight??0),0),unknown=p.solidModel.parts.reduce((n,a,i)=>n+(a.weight===undefined?built.partCenters[i].volume:0),0),remaining=Math.max(0,p.weight-known);let mass=0,sum:V3=[0,0,0];
  p.solidModel.parts.forEach((a,i)=>{const w=a.weight??remaining*built.partCenters[i].volume/(unknown||1);mass+=w;sum=add(sum,mul(built.partCenters[i].center,w));});if(mass)center=mul(sum,1/mass);
 }return mapPoint(b,center);
}
export function modelRestError(b:ModelBody,p:Shape):string|null{
 if(!p.solidModel)return null;
 if(!modelSurfaces(b,p,b.z,false).length)return '该朝向没有有效平底或支架，不能仅用外接矩形承托。';
 // Curved models need a real base in the assembly before rolling restraint is relevant.
 const rolling=p.solidModel.parts.some(part=>['tube','cylinder','reel','ellipsoid','capsule','bend','mesh'].includes(part.kind));
 if(rolling&&!p.solidModel.antiRoll&&p.solidModel.parts.some(part=>part.fixture))return '带曲面货物的支架须确认防滚固定。';
 return null;
}
export function modelStable(b:ModelBody,p:Shape,surfaces:PolygonSurface[]){
 if(!p.solidModel)return true;const cg=modelMassCenter(b,p),hull=convexHull2(surfaces.flatMap(s=>s.polygon));if(hull.length<3)return false;
 const center:[number,number]=[cg[0],cg[1]];return hull.every((a,i)=>{const q=hull[(i+1)%hull.length];return (q[0]-a[0])*(center[1]-a[1])-(q[1]-a[1])*(center[0]-a[0])>=-EPS;});
}
