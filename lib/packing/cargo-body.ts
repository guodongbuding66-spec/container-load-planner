import { cargoShapeOf, isRectilinearShape, type ShapeFields } from "./cargo-shape";
import { buildSolidModel } from "./solid-model";
import { modelBodiesOverlap, modelSurfaces, modelTopLevels, worldModelCells } from "./model-body";
import { polygonRegion,intersectRegion,regionAreaBounds,regionBounds,regionWitnessHull,type Region } from "./planar-region";
import { boxCell, clipPolygon, polygonArea, cellBounds, type V2 } from "./solid-math";
import type { OrientationCode, OrientationSigns, PlacedBox } from "./types";

export type BodyBox = Pick<PlacedBox, "x" | "y" | "z" | "dx" | "dy" | "dz">;
export type Surface = Pick<BodyBox, "x" | "y" | "dx" | "dy"> & {polygon?: V2[];region?:Region;areaLower?:number;areaUpper?:number;coversOwn?:boolean};
const EPS = .0001;

/** Disjoint solid blocks in original L/W/H coordinates, normalized to 0–1. */
export function unitBodyParts(p: ShapeFields): BodyBox[] {
  const t = p.shapeWallRatio ?? .25, h = p.shapeWallHeightRatio ?? .25;
  switch (cargoShapeOf(p)) {
    case "l-profile": return [
      { x: 0, y: 0, z: 0, dx: t, dy: 1, dz: 1 },
      { x: t, y: 0, z: 0, dx: 1-t, dy: 1, dz: h },
    ];
    case "u-profile": return [
      { x: 0, y: 0, z: 0, dx: t, dy: 1, dz: 1 },
      { x: 1-t, y: 0, z: 0, dx: t, dy: 1, dz: 1 },
      { x: t, y: 0, z: 0, dx: 1-2*t, dy: 1, dz: h },
    ];
    case "t-profile": return [
      { x: (1-t)/2, y: 0, z: 0, dx: t, dy: 1, dz: 1-h },
      { x: 0, y: 0, z: 1-h, dx: 1, dy: 1, dz: h },
    ];
    case "step": {
      const l = p.shapeStepLengthRatio ?? .5, z = p.shapeStepHeightRatio ?? .5;
      return [ { x: 0, y: 0, z: 0, dx: 1, dy: 1, dz: z },
        { x: 0, y: 0, z, dx: l, dy: 1, dz: 1-z } ];
    }
    default: return [{ x: 0, y: 0, z: 0, dx: 1, dy: 1, dz: 1 }];
  }
}

/** Same proper axis rotation as the scene, including the L-axis sign on odd permutations. */
export function orientationAxes(code: OrientationCode, signs?: OrientationSigns) {
  const order = [...code].map(c => "LWH".indexOf(c));
  let inversions = 0;
  for (let i=0;i<3;i++) for (let j=i+1;j<3;j++) if (order[i]>order[j]) inversions++;
  return [...code].map((c,i) => ({ original: "LWH".indexOf(c), negative: signs ? signs[i]===-1 : inversions%2 === 1 && c === "L" }));
}
export function validOrientationSigns(code:string,signs:unknown) {
  if(signs===undefined)return true;
  if(!Array.isArray(signs)||signs.length!==3||signs.some(n=>n!==1&&n!==-1)||!["LWH","LHW","WLH","WHL","HLW","HWL"].includes(code))return false;
  const canonical=orientationAxes(code as OrientationCode).reduce((n,a)=>n*(a.negative?-1:1),1);
  return signs.reduce((n,s)=>n*s,1)===canonical;
}
export function quarterTurnOrientation(b:Pick<PlacedBox,"orientation"|"orientationSigns">) {
  const orientation=`${b.orientation[1]}${b.orientation[0]}${b.orientation[2]}` as OrientationCode;
  const axes=orientationAxes(b.orientation as OrientationCode,b.orientationSigns);
  const signs:OrientationSigns=[axes[1].negative?-1:1,axes[0].negative?1:-1,axes[2].negative?-1:1];
  const canonical=orientationAxes(orientation).map(a=>a.negative?-1:1);
  return {orientation,orientationSigns:signs.every((s,i)=>s===canonical[i])?undefined:signs};
}
type OrientedBody = BodyBox & { orientation?: string; orientationSigns?: OrientationSigns };
export function cargoBodyParts(b: OrientedBody, p: ShapeFields = {}): BodyBox[] {
  if(p.solidModel)return worldModelCells(b,p).map(c=>{const {min,max}=cellBounds(c);return {x:Math.max(b.x,min[0]),y:Math.max(b.y,min[1]),z:Math.max(b.z,min[2]),dx:Math.min(b.x+b.dx,max[0])-Math.max(b.x,min[0]),dy:Math.min(b.y+b.dy,max[1])-Math.max(b.y,min[1]),dz:Math.min(b.z+b.dz,max[2])-Math.max(b.z,min[2])};}).filter(c=>c.dx>EPS&&c.dy>EPS&&c.dz>EPS);
  if (!isRectilinearShape(p)) return [b]; // Curves, slopes and unknown meshes retain their full envelope.
  const axes = orientationAxes((b.orientation ?? "LWH") as OrientationCode,b.orientationSigns);
  return unitBodyParts(p).map(part => {
    const pos=[part.x,part.y,part.z], size=[part.dx,part.dy,part.dz];
    const starts=axes.map(a => a.negative ? 1-pos[a.original]-size[a.original] : pos[a.original]);
    const sizes=axes.map(a=>size[a.original]);
    return {x:b.x+starts[0]*b.dx,y:b.y+starts[1]*b.dy,z:b.z+starts[2]*b.dz,dx:sizes[0]*b.dx,dy:sizes[1]*b.dy,dz:sizes[2]*b.dz};
  });
}
export function bodyVolumeRatio(p: ShapeFields) { return p.solidModel?buildSolidModel(p.solidModel).volumeRatio:isRectilinearShape(p)?unitBodyParts(p).reduce((n,b)=>n+b.dx*b.dy*b.dz,0):1; }
export function bodiesOverlap(a: OrientedBody, b: OrientedBody, pa:ShapeFields={}, pb:ShapeFields={}) {
  const overlap=(a:BodyBox,b:BodyBox)=>a.x+a.dx>b.x+EPS&&b.x+b.dx>a.x+EPS&&a.y+a.dy>b.y+EPS&&b.y+b.dy>a.y+EPS&&a.z+a.dz>b.z+EPS&&b.z+b.dz>a.z+EPS;
  const gap=Math.max(pa.protectionGap??0,pb.protectionGap??0),broad=a.x+a.dx+gap>b.x+EPS&&b.x+b.dx+gap>a.x+EPS&&a.y+a.dy+gap>b.y+EPS&&b.y+b.dy+gap>a.y+EPS&&a.z+a.dz+gap>b.z+EPS&&b.z+b.dz+gap>a.z+EPS;
  if(!broad)return false;
  const contact=gap&&(bodyContactArea(a,b,pa,pb)>EPS||bodyContactArea(b,a,pb,pa)>EPS);
  if(pa.solidModel||pb.solidModel||gap)return modelBodiesOverlap(a,b,pa,pb,cargoBodyParts(a,pa).map(c=>boxCell(c.x,c.y,c.z,c.dx,c.dy,c.dz)),cargoBodyParts(b,pb).map(c=>boxCell(c.x,c.y,c.z,c.dx,c.dy,c.dz)),contact?0:gap);
  return overlap(a,b) && cargoBodyParts(a,pa).some(x=>cargoBodyParts(b,pb).some(y=>overlap(x,y)));
}
export function surfaceArea(s: Surface) { return s.areaUpper??(s.polygon?polygonArea(s.polygon):s.dx*s.dy); }
export function supportedSurfaceArea(s:Surface){return s.areaLower??surfaceArea(s);}
export function surfacePolygon(s:Surface):V2[]{return s.polygon??[[s.x,s.y],[s.x+s.dx,s.y],[s.x+s.dx,s.y+s.dy],[s.x,s.y+s.dy]];}
export function intersectSurface(a: Surface, b: Surface): Surface {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  if(a.region||b.region){const own=a.region??polygonRegion(surfacePolygon(a)),region=intersectRegion(own,b.region??polygonRegion(surfacePolygon(b))),area=regionAreaBounds(region,.0002,512),[x,y,X,Y]=regionBounds(region);return {x,y,dx:Math.max(0,X-x),dy:Math.max(0,Y-y),region,polygon:regionWitnessHull(region),areaLower:area.lower,areaUpper:area.upper,coversOwn:region===own};}
  if(a.polygon||b.polygon){const polygon=clipPolygon(surfacePolygon(a),surfacePolygon(b));return {x,y,dx:0,dy:0,polygon,coversOwn:Math.abs(polygonArea(polygon)-surfaceArea(a))<EPS};}
  return {x,y,dx:Math.max(0,Math.min(a.x+a.dx,b.x+b.dx)-x),dy:Math.max(0,Math.min(a.y+a.dy,b.y+b.dy)-y)};
}
function subtractSurface(a:Surface,b:Surface):Surface[] {
  const i=intersectSurface(a,b);if(i.dx<=EPS||i.dy<=EPS)return [a];
  return [{x:a.x,y:a.y,dx:i.x-a.x,dy:a.dy},{x:i.x+i.dx,y:a.y,dx:a.x+a.dx-i.x-i.dx,dy:a.dy},
    {x:i.x,y:a.y,dx:i.dx,dy:i.y-a.y},{x:i.x,y:i.y+i.dy,dx:i.dx,dy:a.y+a.dy-i.y-i.dy}].filter(s=>s.dx>EPS&&s.dy>EPS);
}
export function bodyBottomPatches(b:OrientedBody,p:ShapeFields={}):Surface[] {
  if(p.solidModel)return modelSurfaces(b,p,b.z,false);
  return cargoBodyParts(b,p).filter(c=>Math.abs(c.z-b.z)<EPS).map(c=>({x:c.x,y:c.y,dx:c.dx,dy:c.dy}));
}
/** Exclude internal joints; exposed ledges can support cargo without inventing a full top. */
export function bodyTopPatches(b:OrientedBody,p:ShapeFields={},level=b.z+b.dz):Surface[] {
  if(p.solidModel)return modelSurfaces(b,p,level,true);
  const parts=cargoBodyParts(b,p),covers=parts.filter(c=>c.z<=level+EPS&&c.z+c.dz>level+EPS);
  return parts.filter(c=>Math.abs(c.z+c.dz-level)<EPS).flatMap(c=>covers.reduce((surfaces,cover)=>surfaces.flatMap(s=>subtractSurface(s,cover)),[{x:c.x,y:c.y,dx:c.dx,dy:c.dy}]));
}
export function bodyTopLevels(b:OrientedBody,p:ShapeFields={}) {
  if(p.solidModel)return modelTopLevels(b,p);
  if(!isRectilinearShape(p))return [b.z+b.dz];
  return [...new Set(cargoBodyParts(b,p).map(c=>c.z+c.dz))].filter(z=>bodyTopPatches(b,p,z).length);
}
export function bodyContactArea(upper:OrientedBody,lower:OrientedBody,pu:ShapeFields={},pl:ShapeFields={}) {
  if(!pu.solidModel&&!pl.solidModel&&!isRectilinearShape(pu)&&!isRectilinearShape(pl))return Math.abs(lower.z+lower.dz-upper.z)<EPS?surfaceArea(intersectSurface(upper,lower)):0;
  return bodyBottomPatches(upper,pu).reduce((area,u)=>area+bodyTopPatches(lower,pl,upper.z).reduce((n,l)=>n+supportedSurfaceArea(intersectSurface(u,l)),0),0);
}
