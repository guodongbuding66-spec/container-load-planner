import type { FloorPalletConfig, PlacedPallet } from "./types";

export type PackagingSpec = {
  base: "block" | "stringer" | "solid" | "corner-feet";
  enclosure: "none" | "slatted" | "panel" | "frame";
  material: "wood" | "plywood" | "plastic" | "steel";
  color: string;
  opacity: number;
  deckBoards: number;
  runners: number;
  wallThickness: number;
  lid: boolean;
};
export const DEFAULT_PACKAGING: PackagingSpec = { base:"block", enclosure:"none", material:"wood", color:"#d4af7b", opacity:.65, deckBoards:5, runners:3, wallThickness:30, lid:true };
export function parsePackaging(value: unknown): PackagingSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid packaging structure");
  const p=value as PackagingSpec;
  if (!["block","stringer","solid","corner-feet"].includes(p.base)||!["none","slatted","panel","frame"].includes(p.enclosure)||!["wood","plywood","plastic","steel"].includes(p.material)||!/^#[0-9a-f]{6}$/i.test(p.color)||typeof p.lid!=="boolean") throw new Error("Invalid packaging appearance");
  if (!Number.isFinite(p.opacity)||p.opacity<.05||p.opacity>1||!Number.isInteger(p.deckBoards)||p.deckBoards<2||p.deckBoards>12||!Number.isInteger(p.runners)||p.runners<2||p.runners>5||!Number.isFinite(p.wallThickness)||p.wallThickness<1||p.wallThickness>200) throw new Error("Invalid packaging dimensions");
  return {base:p.base,enclosure:p.enclosure,material:p.material,color:p.color.toLowerCase(),opacity:p.opacity,deckBoards:p.deckBoards,runners:p.runners,wallThickness:p.wallThickness,lid:p.lid};
}
export function packagingInterior(c: FloorPalletConfig) {
  const crate=!!c.packaging && c.packaging.enclosure!=="none", inset=crate?c.packaging!.wallThickness:0, lid=crate&&c.packaging!.lid?inset:0;
  return {crate,inset,lid,length:c.length-2*inset,width:c.width-2*inset};
}
export function packagingHeight(c: FloorPalletConfig) { return c.height+(c.maxCargoHeight??0)+packagingInterior(c).lid; }
export function packagingReservedVolume(p: PlacedPallet) {
  const t=p.packaging?.enclosure!=="none"&&p.enclosureHeight?p.packaging?.wallThickness??0:0;
  const innerHeight=p.enclosureHeight? p.enclosureHeight-p.dz-(p.packaging?.lid?t:0):0;
  return p.dx*p.dy*p.dz+(t? p.dx*p.dy*(p.enclosureHeight!-p.dz)-(p.dx-2*t)*(p.dy-2*t)*innerHeight:0);
}
export type PackagingPart={x:number;y:number;z:number;dx:number;dy:number;dz:number;kind:"board"|"block"|"wall"|"lid";bearingRole?:"foot"|"deck"|"post"|"cap";corner?:"L0W0"|"L0W1"|"L1W0"|"L1W1"};
/** Both renderers use this bounded recipe; fork openings and wall margins remain reserved. */
export function packagingParts(length:number,width:number,height:number,spec:PackagingSpec=DEFAULT_PACKAGING,cargoHeight=0):PackagingPart[] {
  const parts:PackagingPart[]=[], add=(x:number,y:number,z:number,dx:number,dy:number,dz:number,kind:PackagingPart["kind"]="board",tag:Pick<PackagingPart,"bearingRole"|"corner">={})=>parts.push({x,y,z,dx,dy,dz,kind,...tag});
  const t=height*22/144, n=spec.runners, rw=width*.42/n;
  if(spec.base==="corner-feet"){
    const foot=Math.min(spec.wallThickness,length/2,width/2),deck=Math.min(t,height/3);
    for(const [i,x] of [0,length-foot].entries())for(const [j,y] of [0,width-foot].entries())add(x,y,0,foot,foot,height-deck,"block",{bearingRole:"foot",corner:`L${i}W${j}` as PackagingPart["corner"]});
    add(0,0,height-deck,length,width,deck,"board",{bearingRole:"deck"});
  }else if(spec.base==="solid"||height<50)add(0,0,0,length,width,height);
  else {
    for(let j=0;j<n;j++){const y=j*(width-rw)/(n-1);add(0,y,0,length,rw,t);
      if(spec.base==="stringer")add(0,y,t,length,rw,height-2*t,"block");
      else for(let i=0;i<3;i++)add(i*(length-length*.12)/2,y,t,length*.12,rw,height-3*t,"block");
    }
    if(spec.base==="block")for(let i=0;i<3;i++)add(i*(length-length*.12)/2,0,height-2*t,length*.12,width,t);
    const bw=width*.84/spec.deckBoards;
    for(let i=0;i<spec.deckBoards;i++)add(0,i*(width-bw)/(spec.deckBoards-1),height-t,length,bw,t);
  }
  if(spec.enclosure!=="none"&&cargoHeight>0){
    const w=spec.wallThickness,h=cargoHeight;
    // Opposing side walls and inset end walls never enter the usable interior.
    if(spec.enclosure==="panel"){
      for(const y of [0,width-w])add(0,y,height,length,w,h,"wall");
      for(const x of [0,length-w])add(x,w,height,w,width-2*w,h,"wall");
    }else{
      for(const [i,x] of [0,length-w].entries())for(const [j,y] of [0,width-w].entries())add(x,y,height,w,w,h,"wall",{bearingRole:"post",corner:`L${i}W${j}` as PackagingPart["corner"]});
      const count=spec.enclosure==="frame"?2:5, bh=Math.min(w,h/count*.65);
      for(let i=0;i<count;i++){const z=height+i*(h-bh)/(count-1);
        for(const y of [0,width-w])add(w,y,z,length-2*w,w,bh,"wall");
        for(const x of [0,length-w])add(x,w,z,w,width-2*w,bh,"wall");
      }
    }
    if(spec.lid)add(0,0,height+h,length,width,w,"lid",{bearingRole:"cap"});
  }
  return parts;
}
export function placedPackagingParts(p:PlacedPallet) {
  const cross=p.orientation==="WLH", l=cross?p.dy:p.dx,w=cross?p.dx:p.dy;
  const spec=p.packaging??DEFAULT_PACKAGING, h=Math.max(0,(p.enclosureHeight??p.dz)-p.dz-(spec.enclosure!=="none"&&spec.lid?spec.wallThickness:0));
  return packagingParts(l,w,p.dz,spec,h).map(b=>({...b,x:p.x+(cross?b.y:b.x),y:p.y+(cross?l-b.x-b.dx:b.y),z:p.z+b.z,dx:cross?b.dy:b.dx,dy:cross?b.dx:b.dy}));
}
/** Conservative reserved walls, including gaps in slatted and frame constructions. */
export function packagingReservations(p:PlacedPallet) {
  const cross=p.orientation==="WLH", l=cross?p.dy:p.dx,w=cross?p.dx:p.dy,spec=p.packaging??DEFAULT_PACKAGING;
  const h=Math.max(0,(p.enclosureHeight??p.dz)-p.dz-(spec.enclosure!=="none"&&spec.lid?spec.wallThickness:0));
  return packagingParts(l,w,p.dz,{...spec,base:"solid",enclosure:spec.enclosure==="none"?"none":"panel"},h).map(b=>({...b,x:p.x+(cross?b.y:b.x),y:p.y+(cross?l-b.x-b.dx:b.y),z:p.z+b.z,dx:cross?b.dy:b.dx,dy:cross?b.dx:b.dy}));
}
/** A uniform-material estimate from the physical recipe; total tare is never duplicated. */
export function packagingMassCenter(p:PlacedPallet):[number,number,number] {
  if(!p.packaging)return [p.x+p.dx/2,p.y+p.dy/2,p.z+p.dz/2];
  let volume=0,x=0,y=0,z=0;
  for(const b of placedPackagingParts(p)){const v=b.dx*b.dy*b.dz;volume+=v;x+=(b.x+b.dx/2)*v;y+=(b.y+b.dy/2)*v;z+=(b.z+b.dz/2)*v;}
  return [x/volume,y/volume,z/volume];
}
