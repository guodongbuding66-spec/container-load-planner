import * as THREE from "three";
import { cargoShapeOf, cylinderAxisOf, isRectilinearShape, type ShapeFields } from "./cargo-shape";
import type { OrientationCode, OrientationSigns } from "./types";
import { cargoBodyParts, orientationAxes } from "./cargo-body";

/** A unit envelope uses X=L, Y=H, Z=W. Geometry is rotated BEFORE envelope scaling. */
export function cargoShapeGeometry(p: ShapeFields, orientation: OrientationCode = "LWH", reduced = false, signs?:OrientationSigns) {
  const shape = cargoShapeOf(p);
  let geometry: THREE.BufferGeometry;
  if (shape === "cylinder" || shape === "frustum") {
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
  if (shape !== "box" && shape !== "irregular") {
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
export function cargoShapeFootprints(p:ShapeFields,orientation:OrientationCode,orientationSigns?:OrientationSigns) {
  if(!isRectilinearShape(p))return [cargoShapeFootprint(p,orientation,orientationSigns)];
  // Import-free geometry projection uses each disjoint rectangular part.
  return cargoBodyParts({x:0,y:0,z:0,dx:1,dy:1,dz:1,orientation,orientationSigns},p).map(b=>[
    [b.x-.5,b.y-.5],[b.x+b.dx-.5,b.y-.5],[b.x+b.dx-.5,b.y+b.dy-.5],[b.x-.5,b.y+b.dy-.5],
  ] as Array<[number,number]>);
}
