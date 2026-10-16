import { packagingParts, placedPackagingParts, type PackagingPart } from "./packaging";
import type { FloorPalletConfig, PlacedPallet } from "./types";

export const CRATE_CORNERS = ["L0W0", "L0W1", "L1W0", "L1W1"] as const;
export type CrateCorner = typeof CRATE_CORNERS[number];
export type CrateRegion = { id: CrateCorner; x: number; y: number; dx: number; dy: number };
export type CratePathSegment = Pick<PackagingPart, "x" | "y" | "z" | "dx" | "dy" | "dz"> & { role: "foot" | "deck" | "post" | "cap" };
export type CrateStructuralPath = { id: CrateCorner; continuous: boolean; segments: CratePathSegment[]; bottom?: CrateRegion; top?: CrateRegion; bottomZ?: number; topZ?: number };
export type CrateStructure = { model: "four-corner-paths-v1"; complete: boolean; paths: CrateStructuralPath[] };
const EPS = .0001;
const finitePart = (b: PackagingPart) => [b.x,b.y,b.z,b.dx,b.dy,b.dz].every(Number.isFinite) && b.dx > 0 && b.dy > 0 && b.dz > 0;

/** A geometric continuity check, never a test of joints or material strength. */
export function inspectCratePaths(parts: readonly PackagingPart[]): CrateStructure {
  const paths = CRATE_CORNERS.map(id => {
    const feet = parts.filter(b => b.bearingRole === "foot" && b.corner === id);
    const posts = parts.filter(b => b.bearingRole === "post" && b.corner === id);
    const decks = parts.filter(b => b.bearingRole === "deck");
    const caps = parts.filter(b => b.bearingRole === "cap");
    const foot = feet[0], post = posts[0], deck = decks[0], cap = caps[0];
    const valid = feet.length === 1 && posts.length === 1 && decks.length === 1 && caps.length === 1 && [foot,deck,post,cap].every(finitePart);
    const segments: CratePathSegment[] = [];
    if (valid) {
      // The wide boards contribute only the patch directly over this physical foot/post.
      segments.push({...foot, role:"foot"}, {...deck,x:foot.x,y:foot.y,dx:foot.dx,dy:foot.dy,role:"deck"}, {...post,role:"post"}, {...cap,x:post.x,y:post.y,dx:post.dx,dy:post.dy,role:"cap"});
    }
    const contains = (outer: PackagingPart, inner: PackagingPart) => inner.x >= outer.x-EPS && inner.y >= outer.y-EPS && inner.x+inner.dx <= outer.x+outer.dx+EPS && inner.y+inner.dy <= outer.y+outer.dy+EPS;
    const coaxial = valid && Math.abs(foot.x-post.x)<EPS && Math.abs(foot.y-post.y)<EPS && Math.abs(foot.dx-post.dx)<EPS && Math.abs(foot.dy-post.dy)<EPS;
    const continuous = !!(valid && coaxial && contains(deck,foot) && contains(cap,post) && segments.slice(1).every((s,i)=>Math.abs(segments[i].z+segments[i].dz-s.z)<EPS));
    const region = (b: PackagingPart): CrateRegion => ({id,x:b.x,y:b.y,dx:b.dx,dy:b.dy});
    return {id,continuous,segments,...(valid?{bottom:region(foot),top:region(post),bottomZ:foot.z,topZ:cap.z+cap.dz}:{})};
  });
  return {model:"four-corner-paths-v1",complete:paths.every(p=>p.continuous),paths};
}

/** Read the very same tagged components used by GPU and CPU packaging renderers. */
export function crateStructure(c: FloorPalletConfig, pose?: Pick<PlacedPallet,"x"|"y"|"z"|"orientation">): CrateStructure {
  const spec=c.packaging;
  if (!spec || spec.base!=="corner-feet" || !["frame","slatted"].includes(spec.enclosure) || !spec.lid || ![c.length,c.width,c.height,c.maxCargoHeight,spec.wallThickness].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>0) || c.length<=2*spec.wallThickness || c.width<=2*spec.wallThickness) return {model:"four-corner-paths-v1",complete:false,paths:[]};
  if (!pose) return inspectCratePaths(packagingParts(c.length,c.width,c.height,spec,c.maxCargoHeight));
  if (![pose.x,pose.y,pose.z].every(Number.isFinite) || !["LWH","WLH"].includes(pose.orientation)) return {model:"four-corner-paths-v1",complete:false,paths:[]};
  const cross=pose.orientation==="WLH";
  const p:PlacedPallet={...pose,id:"structure",presetId:c.presetId,name:c.name,dx:cross?c.width:c.length,dy:cross?c.length:c.width,dz:c.height,weight:c.weight,maxLoad:c.maxLoad,packaging:spec,enclosureHeight:c.height+c.maxCargoHeight!+spec.wallThickness};
  return inspectCratePaths(placedPackagingParts(p));
}
