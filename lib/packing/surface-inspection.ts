import {cargoShapeOf,parseShapeFields,type ShapeFields} from "./cargo-shape";
import {cargoSectionOutline} from "./cargo-profile";
import {orientationAxes,validOrientationSigns} from "./cargo-body";
import {pointInPolygon,triangulatePolygon,type V2} from "./solid-math";
import type {BoundsBox,Point3,SnapMode} from "./inspection";
import type {OrientationCode,OrientationSigns,PlacedBox} from "./types";

export const REGULAR_SURFACE_SHAPES=["box","wedge","trapezoid","l-profile","u-profile","t-profile","step"] as const;
export type RegularSurfaceSpec={profile:ShapeFields;orientation:OrientationCode;orientationSigns?:OrientationSigns};
const orientations=["LWH","LHW","WLH","WHL","HLW","HWL"];
/** Only parameters that affect this supported solid are archived. No imported model fallback. */
export function parseRegularSurfaceSpec(raw:unknown):RegularSurfaceSpec {
  const fail=()=>{throw new Error("Unsupported regular surface");};
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();
  const v=raw as Record<string,unknown>,p=v.profile as Record<string,unknown>;
  if(!p||typeof p!=="object"||Array.isArray(p)||p.solidModel!==undefined||p.cargoType!==undefined||!REGULAR_SURFACE_SHAPES.includes(p.cargoShape as typeof REGULAR_SURFACE_SHAPES[number])||!orientations.includes(String(v.orientation))||!validOrientationSigns(String(v.orientation),v.orientationSigns))return fail();
  parseShapeFields(p);
  const shape=p.cargoShape as ShapeFields["cargoShape"],profile:ShapeFields={cargoShape:shape};
  if(shape==="trapezoid")profile.shapeTopRatio=(p.shapeTopRatio as number|undefined)??.5;
  if(["l-profile","u-profile","t-profile"].includes(shape!)){profile.shapeWallRatio=(p.shapeWallRatio as number|undefined)??.25;profile.shapeWallHeightRatio=(p.shapeWallHeightRatio as number|undefined)??.25;}
  if(shape==="step"){profile.shapeStepLengthRatio=(p.shapeStepLengthRatio as number|undefined)??.5;profile.shapeStepHeightRatio=(p.shapeStepHeightRatio as number|undefined)??.5;}
  return {profile,orientation:v.orientation as OrientationCode,...(v.orientationSigns===undefined?{}:{orientationSigns:[...(v.orientationSigns as OrientationSigns)] as OrientationSigns})};
}
export function regularSurfaceSpec(box:Pick<PlacedBox,"orientation"|"orientationSigns"|"supportOnly">,p:ShapeFields={}):RegularSurfaceSpec|null {
  if(box.supportOnly||p.cargoType==="pallet"||p.solidModel)return null;
  try{return parseRegularSurfaceSpec({profile:{...p,cargoType:undefined,cargoShape:cargoShapeOf(p)},orientation:box.orientation,orientationSigns:box.orientationSigns});}catch{return null;}
}
const sub=(a:Point3,b:Point3)=>a.map((n,i)=>n-b[i]) as Point3;
const dot=(a:Point3,b:Point3)=>a.reduce((s,n,i)=>s+n*b[i],0);
const cross=(a:Point3,b:Point3):Point3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const distance=(a:Point3,b:Point3)=>Math.hypot(...sub(a,b));
const average=(points:Point3[])=>[0,1,2].map(i=>points.reduce((s,p)=>s+p[i],0)/points.length) as Point3;
const segment=(p:Point3,a:Point3,b:Point3):Point3=>{const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/dot(d,d)));return a.map((n,i)=>n+t*d[i]) as Point3;};
function faceFrame(face:Point3[]){
  const normal=cross(sub(face[1],face[0]),sub(face[2],face[0])),length=Math.hypot(...normal),n=normal.map(x=>x/length) as Point3,drop=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))),axes=[0,1,2].filter(i=>i!==drop);
  return {n,project:(p:Point3)=>axes.map(i=>p[i]) as V2};
}
function closestFace(p:Point3,face:Point3[]):Point3 {
  const {n,project}=faceFrame(face),offset=dot(sub(p,face[0]),n),q=p.map((x,i)=>x-offset*n[i]) as Point3;
  if(pointInPolygon(project(q),face.map(project)))return q;
  return face.map((a,i)=>segment(p,a,face[(i+1)%face.length])).sort((a,b)=>distance(a,p)-distance(b,p))[0];
}
/** Faces contain only real boundaries; cap triangulation diagonals never become snap edges. */
export function regularSurface(box:BoundsBox,spec:RegularSurfaceSpec){
  const outline=cargoSectionOutline(spec.profile)!,n=outline.length,axes=orientationAxes(spec.orientation,spec.orientationSigns),starts=[box.x,box.y,box.z],sizes=[box.dx,box.dy,box.dz];
  const vertices=[0,1].flatMap(w=>outline.map(([l,h])=>{const p=[l,w,h];return axes.map((a,i)=>starts[i]+(a.negative?1-p[a.original]:p[a.original])*sizes[i]) as Point3;}));
  const faces=[vertices.slice(0,n),vertices.slice(n),...outline.map((_,i)=>[vertices[i],vertices[(i+1)%n],vertices[(i+1)%n+n],vertices[i+n]])];
  const edges=outline.flatMap((_,i)=>[[vertices[i],vertices[(i+1)%n]],[vertices[i+n],vertices[(i+1)%n+n]],[vertices[i],vertices[i+n]]] as [Point3,Point3][]);
  const references=faces.map((face,i)=>{
    const mean=average(face),{project}=faceFrame(face),boundary=face.some((a,j)=>distance(segment(mean,a,face[(j+1)%face.length]),mean)<1e-7);
    if(!boundary&&pointInPolygon(project(mean),face.map(project)))return mean;
    // Concave cap means can lie in a recess. Use an interior triangle from the original CCW outline.
    const triangles=triangulatePolygon(outline),triangle=triangles.toSorted((a,b)=>{const area=(t:number[])=>Math.abs((outline[t[1]][0]-outline[t[0]][0])*(outline[t[2]][1]-outline[t[0]][1])-(outline[t[1]][1]-outline[t[0]][1])*(outline[t[2]][0]-outline[t[0]][0]));return area(b)-area(a);})[0];
    return i<2?average(triangle.map(j=>face[j])):mean;
  });
  return {vertices,edges,faces,references};
}
export function regularSurfaceFeatures(box:BoundsBox,spec:RegularSurfaceSpec,mode:SnapMode):Point3[]{const s=regularSurface(box,spec);return mode==="vertex"?s.vertices:mode==="edge"?s.edges.map(average):s.references;}
/** Distances are compared after rotation and scaling, in world millimetres. */
export function snapRegularSurface(box:BoundsBox,spec:RegularSurfaceSpec,p:Point3,mode:SnapMode):Point3 {
  const s=regularSurface(box,spec),candidates=mode==="vertex"?s.vertices:mode==="edge"?s.edges.map(([a,b])=>segment(p,a,b)):s.faces.map(f=>closestFace(p,f));
  return candidates.sort((a,b)=>distance(a,p)-distance(b,p))[0];
}
