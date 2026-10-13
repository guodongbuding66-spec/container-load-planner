import * as THREE from "three";
import { cargoShapeOf, cylinderAxisOf, type ShapeFields } from "./cargo-shape";
import type { OrientationCode } from "./types";

/** A unit envelope uses X=L, Y=H, Z=W. Geometry is rotated BEFORE envelope scaling. */
export function cargoShapeGeometry(p: ShapeFields, orientation: OrientationCode = "LWH", reduced = false) {
  const shape = cargoShapeOf(p);
  let geometry: THREE.BufferGeometry;
  if (shape === "cylinder") {
    geometry = new THREE.CylinderGeometry(.5, .5, 1, reduced ? 12 : 24);
    const axis = cylinderAxisOf(p);
    if (axis === "L") geometry.rotateZ(Math.PI / 2);
    if (axis === "W") geometry.rotateX(Math.PI / 2);
  } else if (shape === "wedge" || shape === "trapezoid") {
    const outline = new THREE.Shape();
    outline.moveTo(-.5, -.5); outline.lineTo(.5, -.5);
    if (shape === "wedge") outline.lineTo(-.5, .5);
    else { const ratio = p.shapeTopRatio ?? .5; outline.lineTo(ratio / 2, .5); outline.lineTo(-ratio / 2, .5); }
    outline.closePath();
    geometry = new THREE.ExtrudeGeometry(outline, { depth: 1, bevelEnabled: false, steps: 1 });
    geometry.translate(0, 0, -.5);
  } else geometry = new THREE.BoxGeometry(1, 1, 1);
  if (shape !== "box" && shape !== "irregular") {
    const axis = { L: 0, H: 1, W: 2 }, rows = [orientation[0], orientation[2], orientation[1]];
    const m = new THREE.Matrix4().set(
      +(axis[rows[0] as "L" | "W" | "H"] === 0), +(axis[rows[0] as "L" | "W" | "H"] === 1), +(axis[rows[0] as "L" | "W" | "H"] === 2), 0,
      +(axis[rows[1] as "L" | "W" | "H"] === 0), +(axis[rows[1] as "L" | "W" | "H"] === 1), +(axis[rows[1] as "L" | "W" | "H"] === 2), 0,
      +(axis[rows[2] as "L" | "W" | "H"] === 0), +(axis[rows[2] as "L" | "W" | "H"] === 1), +(axis[rows[2] as "L" | "W" | "H"] === 2), 0,
      0, 0, 0, 1,
    );
    // An axis permutation may reflect a mesh: choose the equivalent proper rotation.
    if (m.determinant() < 0) { m.elements[0] *= -1; m.elements[1] *= -1; m.elements[2] *= -1; }
    geometry.applyMatrix4(m);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.name = `cargo-shape:${shape}`;
  return geometry;
}

/** Convex silhouette of the real model projected onto the container floor. */
export function cargoShapeFootprint(p: ShapeFields, orientation: OrientationCode) {
  const geometry = cargoShapeGeometry(p, orientation, true), positions = geometry.getAttribute("position");
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
