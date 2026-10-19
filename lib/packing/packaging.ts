import {parseDeckSupports,deckSupportMass,palletQuarterTurns,rotateDeckRect} from "./deck-support";
import type { FloorPalletConfig, PlacedPallet } from "./types";

export type BaseMeasurements = {
  deckThickness:number; bottomThickness:number; bearerThickness:number; deckBoardWidth:number;
  supportLength:number; supportWidth:number; source:string; revision:string;
};

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
  measurements?: BaseMeasurements;
  deckSupports?: import("./deck-support").DeckSupport[];
};
export function baseMeasurements(length:number,width:number,height:number,spec:PackagingSpec):BaseMeasurements {
  const t=height*22/144,foot=Math.min(spec.wallThickness,length/2,width/2);
  return {deckThickness:spec.base==="corner-feet"?Math.min(t,height/3):t,bottomThickness:t,bearerThickness:t,deckBoardWidth:width*.84/spec.deckBoards,supportLength:spec.base==="corner-feet"?foot:length*.12,supportWidth:spec.base==="corner-feet"?foot:width*.42/spec.runners,source:"",revision:""};
}
export function parseBaseMeasurements(value:unknown):BaseMeasurements {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("底座实测尺寸格式无效");
  const v=value as BaseMeasurements;
  for(const key of ["deckThickness","bottomThickness","bearerThickness","deckBoardWidth","supportLength","supportWidth"] as const)if(typeof v[key]!=="number"||!Number.isFinite(v[key])||v[key]<1||v[key]>100000)throw Error("底座实测尺寸须为 1–100000 mm");
  if(typeof v.source!=="string"||v.source.length>500||typeof v.revision!=="string"||v.revision.length>120)throw Error("底座实测来源或版本无效");
  return {deckThickness:v.deckThickness,bottomThickness:v.bottomThickness,bearerThickness:v.bearerThickness,deckBoardWidth:v.deckBoardWidth,supportLength:v.supportLength,supportWidth:v.supportWidth,source:v.source.trim(),revision:v.revision.trim()};
}
export function validateBaseMeasurements(length:number,width:number,height:number,spec?:PackagingSpec) {
  const m=spec?.measurements;if(!m)return;
  const t=parseBaseMeasurements(m);
  if(spec.base==="solid"||t.deckThickness>=height||t.supportLength>length||t.supportWidth>width)throw Error("实测底座部件超出底座外包络");
  if(spec.base==="corner-feet"){
    if(2*t.supportLength>length||2*t.supportWidth>width)throw Error("实测角脚互相重叠");
  }else if(spec.deckBoards*t.deckBoardWidth>width||spec.runners*t.supportWidth>width||t.deckThickness+t.bottomThickness+(spec.base==="block"?t.bearerThickness:0)>=height||spec.base==="block"&&3*t.supportLength>length)throw Error("实测面板、底梁或支承块重叠，或没有有效叉孔高度");
}
export const DEFAULT_PACKAGING: PackagingSpec = { base:"block", enclosure:"none", material:"wood", color:"#d4af7b", opacity:.65, deckBoards:5, runners:3, wallThickness:30, lid:true };
export function parsePackaging(value: unknown): PackagingSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid packaging structure");
  const p=value as PackagingSpec;
  if (!["block","stringer","solid","corner-feet"].includes(p.base)||!["none","slatted","panel","frame"].includes(p.enclosure)||!["wood","plywood","plastic","steel"].includes(p.material)||!/^#[0-9a-f]{6}$/i.test(p.color)||typeof p.lid!=="boolean") throw new Error("Invalid packaging appearance");
  if (!Number.isFinite(p.opacity)||p.opacity<.05||p.opacity>1||!Number.isInteger(p.deckBoards)||p.deckBoards<2||p.deckBoards>12||!Number.isInteger(p.runners)||p.runners<2||p.runners>5||!Number.isFinite(p.wallThickness)||p.wallThickness<1||p.wallThickness>200) throw new Error("Invalid packaging dimensions");
  return {base:p.base,enclosure:p.enclosure,material:p.material,color:p.color.toLowerCase(),opacity:p.opacity,deckBoards:p.deckBoards,runners:p.runners,wallThickness:p.wallThickness,lid:p.lid,...(p.measurements===undefined?{}:{measurements:parseBaseMeasurements(p.measurements)}),...(p.deckSupports===undefined?{}:{deckSupports:parseDeckSupports(p.deckSupports)})};
}
export function packagingInterior(c: FloorPalletConfig) {
  const crate=!!c.packaging && c.packaging.enclosure!=="none", inset=crate?c.packaging!.wallThickness:0, lid=crate&&c.packaging!.lid?inset:0;
  return {crate,inset,lid,length:c.length-2*inset,width:c.width-2*inset};
}
export function packagingHeight(c: FloorPalletConfig) { return c.height+(c.maxCargoHeight??0)+packagingInterior(c).lid; }
export function packagingReservedVolume(p: PlacedPallet) {
  const t=p.packaging?.enclosure!=="none"&&p.enclosureHeight?p.packaging?.wallThickness??0:0;
  const innerHeight=p.enclosureHeight? p.enclosureHeight-p.dz-(p.packaging?.lid?t:0):0;
  const added=p.packaging?.deckSupports?.reduce((n,s)=>n+s.dx*s.dy*s.dz,0)??0;
  return added+p.dx*p.dy*p.dz+(t? p.dx*p.dy*(p.enclosureHeight!-p.dz)-(p.dx-2*t)*(p.dy-2*t)*innerHeight:0);
}
export type PackagingPart={x:number;y:number;z:number;dx:number;dy:number;dz:number;kind:"board"|"block"|"wall"|"lid"|"support";bearingRole?:"foot"|"deck"|"post"|"cap";corner?:"L0W0"|"L0W1"|"L1W0"|"L1W1"};
/** Both renderers use this bounded recipe; fork openings and wall margins remain reserved. */
export function packagingParts(length:number,width:number,height:number,spec:PackagingSpec=DEFAULT_PACKAGING,cargoHeight=0):PackagingPart[] {
  const parts:PackagingPart[]=[], add=(x:number,y:number,z:number,dx:number,dy:number,dz:number,kind:PackagingPart["kind"]="board",tag:Pick<PackagingPart,"bearingRole"|"corner">={})=>parts.push({x,y,z,dx,dy,dz,kind,...tag});
  const t=height*22/144, n=spec.runners, rw=width*.42/n;
  if(spec.measurements){
    const m=spec.measurements;
    if(spec.base==="corner-feet"){
      for(const [i,x] of [0,length-m.supportLength].entries())for(const [j,y] of [0,width-m.supportWidth].entries())add(x,y,0,m.supportLength,m.supportWidth,height-m.deckThickness,"block",{bearingRole:"foot",corner:`L${i}W${j}` as PackagingPart["corner"]});
      add(0,0,height-m.deckThickness,length,width,m.deckThickness,"board",{bearingRole:"deck"});
    }else{
      for(let j=0;j<n;j++){const y=j*(width-m.supportWidth)/(n-1);add(0,y,0,length,m.supportWidth,m.bottomThickness);
        if(spec.base==="stringer")add(0,y,m.bottomThickness,length,m.supportWidth,height-m.deckThickness-m.bottomThickness,"block");
        else for(let i=0;i<3;i++)add(i*(length-m.supportLength)/2,y,m.bottomThickness,m.supportLength,m.supportWidth,height-m.deckThickness-m.bearerThickness-m.bottomThickness,"block");
      }
      if(spec.base==="block")for(let i=0;i<3;i++)add(i*(length-m.supportLength)/2,0,height-m.deckThickness-m.bearerThickness,m.supportLength,width,m.bearerThickness);
      const bw=m.deckBoardWidth;
      for(let i=0;i<spec.deckBoards;i++)add(0,i*(width-bw)/(spec.deckBoards-1),height-m.deckThickness,length,bw,m.deckThickness);
    }
  }else if(spec.base==="corner-feet"){
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
  for(const s of spec.deckSupports??[])add(s.x,s.y,height,s.dx,s.dy,s.dz,"support");
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
  return packagingParts(l,w,p.dz,spec,h).map(b=>{const r=rotateDeckRect(b,l,w,palletQuarterTurns(p));return {...r,x:p.x+r.x,y:p.y+r.y,z:p.z+b.z};});
}
/** Conservative reserved walls, including gaps in slatted and frame constructions. */
export function packagingReservations(p:PlacedPallet) {
  const cross=p.orientation==="WLH", l=cross?p.dy:p.dx,w=cross?p.dx:p.dy,spec=p.packaging??DEFAULT_PACKAGING;
  const h=Math.max(0,(p.enclosureHeight??p.dz)-p.dz-(spec.enclosure!=="none"&&spec.lid?spec.wallThickness:0));
  return packagingParts(l,w,p.dz,{...spec,base:"solid",enclosure:spec.enclosure==="none"?"none":"panel"},h).map(b=>{const r=rotateDeckRect(b,l,w,palletQuarterTurns(p));return {...r,x:p.x+r.x,y:p.y+r.y,z:p.z+b.z};});
}
/** A uniform-material estimate from the physical recipe; total tare is never duplicated. */
export function packagingMassCenter(p:PlacedPallet):[number,number,number] {
  if(!p.packaging)return [p.x+p.dx/2,p.y+p.dy/2,p.z+p.dz/2];
  let volume=0,x=0,y=0,z=0;
  for(const b of placedPackagingParts(p).filter(b=>b.kind!=="support")){const v=b.dx*b.dy*b.dz;volume+=v;x+=(b.x+b.dx/2)*v;y+=(b.y+b.dy/2)*v;z+=(b.z+b.dz/2)*v;}
  const mass=deckSupportMass(p),baseMass=p.weight-mass,cross=p.orientation==="WLH",l=cross?p.dy:p.dx;
  const moment=[x/volume*baseMass,y/volume*baseMass,z/volume*baseMass];
  for(const s of p.packaging.deckSupports??[]){const b=rotateDeckRect(s,l,cross?p.dx:p.dy,palletQuarterTurns(p)),center=[p.x+b.x+b.dx/2,p.y+b.y+b.dy/2,p.z+p.dz+s.dz/2];center.forEach((v,i)=>moment[i]+=v*(s.weightKg??0));}
  return p.weight>0?moment.map(v=>v/p.weight) as [number,number,number]:[p.x+p.dx/2,p.y+p.dy/2,p.z+p.dz/2];
}

/** First stage: each solid piece rests directly on known flat deck geometry, never bridges a gap. */
export function validateDeckSupports(c:FloorPalletConfig){
 const rows=c.packaging?.deckSupports;if(!rows?.length)return;
 const inside=packagingInterior(c),parts=packagingParts(c.length,c.width,c.height,{...c.packaging!,deckSupports:undefined}).filter(p=>Math.abs(p.z+p.dz-c.height)<.0001);
 if(c.weight+deckSupportMass(c)>10000||deckSupportMass(c)>=c.maxLoad)throw Error("Deck support mass exceeds packaging or payload limit / 支承件使整托自重超限或占满额定载荷");
 for(const s of rows){
  if(s.x<inside.inset||s.y<inside.inset||s.x+s.dx>c.length-inside.inset+.0001||s.y+s.dy>c.width-inside.inset+.0001||c.maxCargoHeight&&s.dz>c.maxCargoHeight)throw Error("Deck support exceeds usable packaging interior / 托内支承件超出可用内尺寸或货物限高");
  if(rows.some(b=>b.id!==s.id&&Math.min(s.x+s.dx,b.x+b.dx)-Math.max(s.x,b.x)>.0001&&Math.min(s.y+s.dy,b.y+b.dy)-Math.max(s.y,b.y)>.0001))throw Error("Deck supports overlap / 托内支承件不能相交或叠放");
  const area=parts.reduce((n,b)=>n+Math.max(0,Math.min(s.x+s.dx,b.x+b.dx)-Math.max(s.x,b.x))*Math.max(0,Math.min(s.y+s.dy,b.y+b.dy)-Math.max(s.y,b.y)),0);
  if(area+.0001<s.dx*s.dy)throw Error("Deck support must have full bottom contact / 托内支承件底部须完全贴合实际面板，不支持跨板缝架空");
 }
}
