import {convexHull2,polygonArea,unionPolygons,type V2} from "./solid-math";
import * as THREE from "three";
import { ADVANCED_SHAPES, cargoShapeOf, cylinderAxisOf, isRectilinearShape, type ShapeFields } from "./cargo-shape";
import type { OrientationCode, OrientationSigns } from "./types";
import { defaultSolidModel, buildSolidModel, type ModelKind } from "./solid-model";
import { cargoBodyParts, orientationAxes } from "./cargo-body";

/** A unit envelope uses X=L, Y=H, Z=W. Geometry is rotated BEFORE envelope scaling. */
export function cargoShapeGeometry(p: ShapeFields, orientation: OrientationCode = "LWH", reduced = false, signs?:OrientationSigns,collisionProxy=false) {
  const shape = cargoShapeOf(p);
  let geometry: THREE.BufferGeometry;
  const model=p.solidModel??(ADVANCED_SHAPES.includes(shape)&&shape!=="mesh"?defaultSolidModel(shape==="compound"?"box":shape as ModelKind,[1,1,1]):undefined);
  if(model){
    const built=buildSolidModel(model),parts=collisionProxy||reduced&&built.display.reduce((n,c)=>n+c.faces.length,0)>1500?built.cells:built.display,positions:number[]=[];
    const faces=new Map<string,{points:number[][];signs:Set<number>}>();
    for(const cell of parts)for(const f of cell.faces){const points=f.map(i=>cell.vertices[i]),key=points.map(v=>v.map(n=>n.toFixed(8)).join('/')).sort().join('|'),a=points[0],b=points[1],c=points[2],u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],sign=Math.sign(normal.find(n=>Math.abs(n)>1e-10)??0),old=faces.get(key);if(old)old.signs.add(sign);else faces.set(key,{points,signs:new Set([sign])});}
    for(const {points,signs} of faces.values()){if(signs.has(-1)&&signs.has(1))continue;for(let i=1;i<points.length-1;i++)for(const index of [0,i+1,i]){const v=points[index];positions.push(v[0]-.5,v[2]-.5,v[1]-.5);}}
    geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.addGroup(0,positions.length/3,0);
  } else if (shape === "cylinder" || shape === "frustum") {
    geometry = new THREE.CylinderGeometry(shape === "frustum" ? (p.shapeTopRatio ?? .5)/2 : .5, .5, 1, reduced ? 12 : 24);
    const axis = cylinderAxisOf(p);
    if (axis === "L") geometry.rotateZ(Math.PI / 2);
    if (axis === "W") geometry.rotateX(Math.PI / 2);
  } else if (shape === "wedge" || shape === "trapezoid" || isRectilinearShape(p)) {
    const outline = new THREE.Shape();
    const t=p.shapeWallRatio??.25,h=p.shapeWallHeightRatio??.25;
    let points:number[][];
    if(shape==="l-profile")points=[[0,0],[1,0],[1,h],[t,h],[t,1],[0,1]];
    else if(shape==="u-profile")points=[[0,0],[1,0],[1,1],[1-t,1],[1-t,h],[t,h],[t,1],[0,1]];
    else if(shape==="t-profile")points=[[(1-t)/2,0],[(1+t)/2,0],[(1+t)/2,1-h],[1,1-h],[1,1],[0,1],[0,1-h],[(1-t)/2,1-h]];
    else if(shape==="step"){const l=p.shapeStepLengthRatio??.5,z=p.shapeStepHeightRatio??.5;points=[[0,0],[1,0],[1,z],[l,z],[l,1],[0,1]];}
    else if(shape==="wedge")points=[[0,0],[1,0],[0,1]];
    else {const ratio=p.shapeTopRatio??.5;points=[[0,0],[1,0],[(1+ratio)/2,1],[(1-ratio)/2,1]];}
    points.forEach(([x,y],i)=>i?outline.lineTo(x-.5,y-.5):outline.moveTo(x-.5,y-.5));
    outline.closePath();
    geometry = new THREE.ExtrudeGeometry(outline, { depth: 1, bevelEnabled: false, steps: 1 });
    geometry.translate(0, 0, -.5);
  } else geometry = new THREE.BoxGeometry(1, 1, 1);
  if (model || shape !== "box" && shape !== "irregular") {
    const axes=orientationAxes(orientation,signs),originalToThree=[0,2,1];
    const row=(i:number)=>[0,1,2].map(j=>originalToThree[axes[i].original]===j?(axes[i].negative?-1:1):0);
    const x=row(0),y=row(2),z=row(1);
    const m = new THREE.Matrix4().set(x[0],x[1],x[2],0,y[0],y[1],y[2],0,z[0],z[1],z[2],0,0,0,0,1);
    geometry.applyMatrix4(m);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.name = `cargo-shape:${shape}`;
  return geometry;
}

/** Convex silhouette of the real model projected onto the container floor. */
export function cargoShapeFootprint(p: ShapeFields, orientation: OrientationCode,signs?:OrientationSigns) {
  const geometry = cargoShapeGeometry(p, orientation, true,signs), positions = geometry.getAttribute("position");
  const unique = new Map<string, [number,number]>();
  for (let i=0;i<positions.count;i++) { const x=positions.getX(i),z=positions.getZ(i); unique.set(`${x.toFixed(6)}/${z.toFixed(6)}`,[x,z]); }
  geometry.dispose();
  const points = [...unique.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o:number[],a:number[],b:number[])=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower: [number,number][]=[],upper: [number,number][]=[];
  for(const p of points){while(lower.length>=2&&cross(lower.at(-2)!,lower.at(-1)!,p)<=1e-8)lower.pop();lower.push(p);}
  for(const p of points.toReversed()){while(upper.length>=2&&cross(upper.at(-2)!,upper.at(-1)!,p)<=1e-8)upper.pop();upper.push(p);}
  return [...lower.slice(0,-1),...upper.slice(0,-1)];
}

/** Keep concave footprints instead of filling an L/U/T recess with a convex hull. */
export type CargoProjectionView='top'|'side'|'door';
const projectionCache=new WeakMap<object,Map<string,V2[][]>>();
/** Project actual display faces; a hole stays empty only when no face projects over it. */
export function cargoShapeProjections(p:ShapeFields,orientation:OrientationCode,view:CargoProjectionView,orientationSigns?:OrientationSigns):V2[][] {
  const source=p.solidModel??p,key=orientation+'/'+orientationSigns?.join()+'/'+view,bucket=projectionCache.get(source)??new Map<string,V2[][]>(),old=bucket.get(key);if(old)return old;
  const worldAxes=view==='top'?[0,1]:view==='side'?[0,2]:[1,2];let polys:V2[][]=[];
  if(p.solidModel){
    const axes=orientationAxes(orientation,orientationSigns),project=(v:number[]):V2=>worldAxes.map(i=>{const a=axes[i];return (a.negative?1-v[a.original]:v[a.original])-.5;}) as V2;
    for(const cell of buildSolidModel(p.solidModel).display)for(const face of cell.faces){const poly=convexHull2(face.map(i=>project(cell.vertices[i])));if(polygonArea(poly)>1e-8)polys.push(poly);}
  }else if(isRectilinearShape(p)||cargoShapeOf(p)==='box'){
    const positions=['x','y','z'] as const,sizes=['dx','dy','dz'] as const;
    polys=cargoBodyParts({x:0,y:0,z:0,dx:1,dy:1,dz:1,orientation,orientationSigns},p).map(b=>{const [a,c]=worldAxes,x=b[positions[a]]-.5,y=b[positions[c]]-.5,w=b[sizes[a]],h=b[sizes[c]];return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];});
  }else{
    const g=cargoShapeGeometry(p,orientation,false,orientationSigns),positions=g.getAttribute('position'),indices=g.getIndex(),n=indices?.count??positions.count,axes=view==='top'?[0,2]:view==='side'?[0,1]:[2,1];
    for(let i=0;i+2<n;i+=3){const points=[0,1,2].map(j=>{const k=indices?indices.getX(i+j):i+j;return axes.map(a=>a===0?positions.getX(k):a===1?positions.getY(k):positions.getZ(k)) as V2;});const poly=convexHull2(points);if(polygonArea(poly)>1e-8)polys.push(poly);}
    g.dispose();
  }
  const unique=new Map<string,V2[]>();for(const poly of polys){const k=poly.map(v=>v.map(n=>n.toFixed(8)).join('/')).sort().join('|');if(!unique.has(k))unique.set(k,poly);}
  polys=[...unique.values()];let result=polys;
  if(!p.solidModel?.parts.some(part=>part.kind==='mesh')&&polys.length<=128){try{result=unionPolygons(polys);}catch{result=polys;}}
  if(bucket.size>=128)bucket.clear();bucket.set(key,result);projectionCache.set(source,bucket);return result;
}
export function cargoShapeFootprints(p:ShapeFields,orientation:OrientationCode,orientationSigns?:OrientationSigns){return cargoShapeProjections(p,orientation,'top',orientationSigns);}
