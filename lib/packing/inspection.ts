import type { PackingResult, PlacedBox } from "./types";
import type { DimensionUnit } from "./scene-dimensions";

export type Point3 = [number, number, number];
export type BoundsBox = Pick<PlacedBox,"x"|"y"|"z"|"dx"|"dy"|"dz">;
export type SnapMode = "vertex" | "edge" | "face";
export type MeasureMode = "off" | "points" | "gap" | "wall";
export type WallSide = "x-" | "x+" | "y-" | "y+" | "z-" | "z+";
export type Section = { axis: "off" | "x" | "y" | "z"; percent: number; reverse: boolean; isolation: "all" | "carton" | "layer" | "pallet" | "set"; target: string };
export const EMPTY_SECTION: Section = {axis:"off",percent:100,reverse:false,isolation:"all",target:""};
export type Measurement = { a: Point3; b: Point3; distance: number; deltas: Point3 };
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function boxBounds(box:BoundsBox):[Point3,Point3] {return [[box.x,box.y,box.z],[box.x+box.dx,box.y+box.dy,box.z+box.dz]];}
export function boxFeatures(box:BoundsBox,mode:SnapMode):Point3[] {
  const [lo,hi]=boxBounds(box),mid=lo.map((v,i)=>(v+hi[i])/2) as Point3;
  if(mode==="vertex")return [lo[0],hi[0]].flatMap(x=>[lo[1],hi[1]].flatMap(y=>[lo[2],hi[2]].map(z=>[x,y,z] as Point3)));
  if(mode==="face")return [0,1,2].flatMap(axis=>[lo[axis],hi[axis]].map(v=>mid.map((n,i)=>i===axis?v:n) as Point3));
  return [0,1,2].flatMap(axis=>[0,1,2].filter(i=>i!==axis).reduce<Point3[]>((points,i)=>points.flatMap(p=>[lo[i],hi[i]].map(v=>p.map((n,j)=>j===i?v:n) as Point3)),[mid]));
}
/** Face mode preserves the picked surface point; edge mode finds the nearest point on a real edge. */
export function snapBoxPoint(box:BoundsBox,point:Point3,mode:SnapMode):Point3 {
  const [lo,hi]=boxBounds(box),p=point.map((v,i)=>clamp(v,lo[i],hi[i])) as Point3;
  const distance=(q:Point3)=>q.reduce((sum,v,i)=>sum+(v-p[i])**2,0);
  if(mode==="vertex")return boxFeatures(box,mode).sort((a,b)=>distance(a)-distance(b))[0];
  const candidates=mode==="face"?[0,1,2].flatMap(axis=>[lo[axis],hi[axis]].map(v=>p.map((n,i)=>i===axis?v:n) as Point3)):
    [0,1,2].flatMap(axis=>[0,1,2].filter(i=>i!==axis).reduce<Point3[]>((points,i)=>points.flatMap(q=>[lo[i],hi[i]].map(v=>q.map((n,j)=>j===i?v:n) as Point3)),[p]));
  return candidates.sort((a,b)=>distance(a)-distance(b))[0];
}
export function measurePoints(a:Point3,b:Point3):Measurement {
  const deltas=b.map((v,i)=>Math.abs(v-a[i])) as Point3;
  return {a:[...a],b:[...b],deltas,distance:Math.hypot(...deltas)};
}
/** Closest witnesses on two axis-aligned outer cartons; overlapping intervals use their common midpoint. */
export function measureBoxGap(first:BoundsBox,second:BoundsBox):Measurement {
  const [a0,a1]=boxBounds(first),[b0,b1]=boxBounds(second),a:Point3=[0,0,0],b:Point3=[0,0,0];
  for(let i=0;i<3;i++){
    if(a1[i]<b0[i]){a[i]=a1[i];b[i]=b0[i];}
    else if(b1[i]<a0[i]){a[i]=a0[i];b[i]=b1[i];}
    else a[i]=b[i]=(Math.max(a0[i],b0[i])+Math.min(a1[i],b1[i]))/2;
  }
  return measurePoints(a,b);
}
export function measureWall(box:BoundsBox,result:{container:Pick<PackingResult["container"],"length"|"width"|"height">;clearance:number},side:WallSide):Measurement {
  const [lo,hi]=boxBounds(box),axis="xyz".indexOf(side[0]),upper=side[1]==="+";
  const limits=[result.container.length-result.clearance,result.container.width-result.clearance,result.container.height];
  const a=lo.map((v,i)=>(v+hi[i])/2) as Point3;a[axis]=upper?hi[axis]:lo[axis];
  const b=[...a] as Point3;b[axis]=upper?limits[axis]:axis===2?0:-result.clearance;
  return measurePoints(a,b);
}
export function formatMeasure(value:number,unit:DimensionUnit,precision:number) {
  return `${(value/(unit==="m"?1000:unit==="cm"?10:1)).toFixed(clamp(Math.round(precision),0,3))} ${unit}`;
}
export function isolationKey(box:PlacedBox,type:Section["isolation"]) {
  return type==="carton"?box.id:type==="layer"?String(box.layer):type==="set"&&box.setCode&&box.setNumber!==undefined?JSON.stringify([box.setCode,box.setNumber]):"";
}
export function sectionLimits(result:Pick<PackingResult,"container"|"clearance">,section:Section) {
  const axis="xyz".indexOf(section.axis),lo=axis===2?0:-result.clearance;
  const size=[result.container.length,result.container.width,result.container.height][axis]??0;
  return {axis,threshold:lo+size*clamp(section.percent,0,100)/100};
}
/** Return display geometry without changing a single solver coordinate or metric. */
export function sectionBox<T extends BoundsBox>(box:T,result:Pick<PackingResult,"container"|"clearance">,section:Section):T|null {
  if(section.axis==="off")return box;
  const {axis,threshold}=sectionLimits(result,section),pos=[box.x,box.y,box.z],size=[box.dx,box.dy,box.dz];
  const end=pos[axis]+size[axis];
  const start=section.reverse?Math.max(pos[axis],threshold):pos[axis],finish=section.reverse?end:Math.min(end,threshold);
  if(finish-start<1e-6)return null;
  pos[axis]=start;size[axis]=finish-start;
  return {...box,x:pos[0],y:pos[1],z:pos[2],dx:size[0],dy:size[1],dz:size[2]};
}
export function inspectBoxes(result:PackingResult,visibleProducts:Set<string>,visibleCount:number,section:Section) {
  const wholeGroup=section.isolation==="pallet"||section.isolation==="set";
  return result.placements.slice(0,visibleCount).filter(b=>(wholeGroup||visibleProducts.has(b.productId))&&(
    section.isolation==="all"||(!!section.target&&(section.isolation==="pallet"?b.palletIds?.includes(section.target):isolationKey(b,section.isolation)===section.target))
  )).flatMap(b=>{const display=sectionBox(b,result,section);return display?[display]:[];});
}
