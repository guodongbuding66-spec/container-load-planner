import { placedPackagingParts, type PackagingPart } from "./packaging";
import type { CrateReviewUnit, CrateStackReview } from "./crate-bearing";
import type { CrateCorner, CratePathSegment } from "./crate-structure";
import type { SceneSize } from "./camera-fit";
import type { TransportPart } from "./transport-model";

export type CratePreview = { parts: (PackagingPart & {unitId:string})[]; highlights: CratePathSegment[]; targets: CratePathSegment[]; color: string; size: SceneSize; offset: SceneSize; projectionParts: TransportPart[]; projectionHighlights: TransportPart[]; projectionTargets:TransportPart[] };
/** Packaging only. Original cargo, poses, mass and validation are never rewritten for display. */
export function cratePreview(units: readonly CrateReviewUnit[], report: CrateStackReview, unitId: string, corner: CrateCorner): CratePreview | null {
  if (!units.length || units.some(({pallet:p})=>![p.x,p.y,p.z,p.dx,p.dy,p.dz,p.enclosureHeight].every(n=>typeof n==="number"&&Number.isFinite(n)) || p.dx<=0 || p.dy<=0 || p.dz<=0 || p.enclosureHeight!<=0)) return null;
  const parts=units.flatMap(u=>placedPackagingParts(u.pallet).map(p=>({...p,unitId:u.pallet.id})));
  if (!parts.length || parts.some(p=>![p.x,p.y,p.z,p.dx,p.dy,p.dz].every(Number.isFinite)||p.dx<=0||p.dy<=0||p.dz<=0)) return null;
  const minX=Math.min(...parts.map(p=>p.x)),minY=Math.min(...parts.map(p=>p.y)),minZ=Math.min(...parts.map(p=>p.z));
  const length=Math.max(...parts.map(p=>p.x+p.dx))-minX,width=Math.max(...parts.map(p=>p.y+p.dy))-minY,height=Math.max(...parts.map(p=>p.z+p.dz))-minZ;
  const size:SceneSize=[length,height,width],offset:SceneSize=[-minX-length/2,-minZ,-minY-width/2];
  const row=report.units.find(u=>u.id===unitId),path=row?.structure.paths.find(p=>p.id===corner),highlights=path?.segments??[];
  const contact=report.contacts.find(c=>c.upperId===unitId&&c.foot.id===corner),target=contact?.referenceZone;
  const targets:CratePathSegment[]=target&&contact.referenceZoneZ!==undefined?[{...target,z:contact.referenceZoneZ, dz:Math.max(.1,Math.min(...size)*.001),role:"cap"}]:[];
  const issues=report.issues.filter(i=>i.unitId===unitId&&(!i.corner||i.corner===corner));
  const color=issues.some(i=>["contact","column-load","top-load","geometry","payload","orientation","layers","prohibited"].includes(i.code))?"#b63b36":row?.evidence==="ready"&&path?.continuous?"#167d76":"#7b8490";
  const part=(p:Pick<PackagingPart,"x"|"y"|"z"|"dx"|"dy"|"dz">,name:string,color:string):TransportPart=>({name,shape:"box",role:"frame",color,position:[p.x+p.dx/2+offset[0],p.z+p.dz/2+offset[1],p.y+p.dy/2+offset[2]],size:[p.dx,p.dz,p.dy]});
  return {parts,highlights,targets,color,size,offset,projectionParts:parts.map((p,i)=>part(p,`${p.unitId}-${i}`,p.unitId===unitId?"#c5a574":"#becbd0")),projectionHighlights:highlights.map(p=>part(p,p.role,color)),projectionTargets:targets.map(p=>part(p,"lower-reference","#237da1"))};
}
