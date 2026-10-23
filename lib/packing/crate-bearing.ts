import type { FloorPalletConfig, PackingResult, PlacedPallet } from "./types";

import { CRATE_CORNERS, crateStructure, type CrateCorner, type CrateRegion, type CrateStructure } from "./crate-structure";
export { CRATE_CORNERS } from "./crate-structure";
export type { CrateCorner, CrateRegion } from "./crate-structure";
export type CrateBearingProfile = {
  /** Absent in old independent-preflight files: automatic stacking stays disabled. */
  automaticStacking?:boolean;
  policy:"unverified"|"prohibited"|"rated";
  revision:string; source:string; conditions:string; validUntil:string;
  allowedOrientations:("LWH"|"WLH")[];
  maxTopLoadKg:number; maxLayers:number;
  /** Conservative capacity for the entire through load at EACH vertical column/foot path. */
  columnCapacityKg:Record<CrateCorner,number>;
  reviewed:boolean; reviewedFor:string;
};
export function emptyCrateBearing():CrateBearingProfile{return {policy:"unverified",revision:"",source:"",conditions:"",validUntil:"",allowedOrientations:["LWH"],maxTopLoadKg:0,maxLayers:1,columnCapacityKg:{L0W0:0,L0W1:0,L1W0:0,L1W1:0},reviewed:false,reviewedFor:""};}
export function parseCrateBearing(value:unknown):CrateBearingProfile {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid crate bearing profile");
  const v=value as CrateBearingProfile;
  if(v.automaticStacking!==undefined&&typeof v.automaticStacking!=="boolean")throw new Error("Invalid automatic crate stacking option");
  const text=(value:unknown,max:number)=>{if(typeof value!=="string"||value.length>max)throw new Error("Invalid crate rating source");return value.trim();};
  const number=(value:unknown)=>{if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>100000)throw new Error("Crate ratings must be finite, 0–100000 kg");return value;};
  if(!["unverified","prohibited","rated"].includes(v.policy)||typeof v.reviewed!=="boolean"||!Number.isInteger(v.maxLayers)||v.maxLayers<1||v.maxLayers>20)throw new Error("Invalid crate rating policy or layers");
  if(!Array.isArray(v.allowedOrientations)||v.allowedOrientations.length>2||new Set(v.allowedOrientations).size!==v.allowedOrientations.length||v.allowedOrientations.some(c=>c!=="LWH"&&c!=="WLH"))throw new Error("Invalid crate rating orientation");
  if(!v.columnCapacityKg||typeof v.columnCapacityKg!=="object"||Array.isArray(v.columnCapacityKg)||Object.keys(v.columnCapacityKg).length!==4||Object.keys(v.columnCapacityKg).some(id=>!CRATE_CORNERS.includes(id as CrateCorner)))throw new Error("Exactly four linked column ratings are required");
  const validUntil=text(v.validUntil,10);
  if(validUntil&&(!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)||Number.isNaN(Date.parse(validUntil))||new Date(validUntil).toISOString().slice(0,10)!==validUntil))throw new Error("Invalid crate rating expiry date");
  return {...(v.automaticStacking===undefined?{}:{automaticStacking:v.automaticStacking}),policy:v.policy,revision:text(v.revision,120),source:text(v.source,500),conditions:text(v.conditions,2000),validUntil,allowedOrientations:[...v.allowedOrientations],maxTopLoadKg:number(v.maxTopLoadKg),maxLayers:v.maxLayers,columnCapacityKg:Object.fromEntries(CRATE_CORNERS.map(id=>[id,number(v.columnCapacityKg[id])])) as Record<CrateCorner,number>,reviewed:v.reviewed,reviewedFor:text(v.reviewedFor,32768)};
}
/** Exact geometry/version binding, not a security signature. Appearance and display name do not change it. */
export function crateStructureKey(c:FloorPalletConfig){const s=c.packaging;return JSON.stringify({length:c.length,width:c.width,height:c.height,weight:c.weight,maxLoad:c.maxLoad,maxCargoHeight:c.maxCargoHeight??0,base:s?.base,...(s?.bottomDeck==="none"?{bottomDeck:"none"}:{}),enclosure:s?.enclosure,material:s?.material,deckBoards:s?.deckBoards,runners:s?.runners,wallThickness:s?.wallThickness,lid:s?.lid,...(s?.measurements?{measurements:{...s.measurements,source:s.measurements.source.trim(),revision:s.measurements.revision.trim()}}:{})});}
export function crateEvidenceKey(c:FloorPalletConfig,p=c.crateBearing??emptyCrateBearing()) {return JSON.stringify({model:"four-corner-paths-v1",...(p.automaticStacking?{automaticStacking:true}:{}),structure:crateStructureKey(c),policy:p.policy,revision:p.revision.trim(),source:p.source.trim(),conditions:p.conditions.trim(),validUntil:p.validUntil,allowedOrientations:[...p.allowedOrientations].sort(),maxTopLoadKg:p.maxTopLoadKg,maxLayers:p.maxLayers,columnCapacityKg:CRATE_CORNERS.map(id=>p.columnCapacityKg[id])});}
export type CrateEvidenceState="unverified"|"prohibited"|"ready";
export type CrateReason="selection"|"missing"|"prohibited"|"unsupported"|"source"|"expired"|"stale"|"ratings"|"orientation"|"contact"|"top-load"|"column-load"|"layers"|"payload"|"geometry";
export const CRATE_REASON_TEXT:Record<CrateReason,[string,string]>={
  selection:["至少选择两只不同木箱才进行叠放预检","Select at least two distinct crates for a stack preflight"],
  missing:["缺少已核对的额定资料","Reviewed rating data is missing"],prohibited:["明确禁止叠放／上压","Stacking / top load is explicitly prohibited"],
  unsupported:["首版只核对四角承压脚、框架或条板围护及箱盖组成的垂直传力结构","This version only reviews four corner feet, frame/slatted walls and a lid with vertical load paths"],
  source:["缺少结构版本、额定来源或适用条件","Structural revision, rating source or applicable conditions are missing"],expired:["额定资料已过有效期","The rating evidence has expired"],
  stale:["结构或资料已改变，请重新人工核对","The structure or evidence changed; review it again"],ratings:["四条传力路径须分别提供正额定值","Each of the four load paths needs a positive rating"],
  orientation:["整箱朝向不在额定资料允许范围内","The unit orientation is not covered by its ratings"],contact:["上箱脚未被下箱许可区完整覆盖，或缺少唯一对应传力路径","An upper foot is not fully covered by one lower permitted zone with a unique load path"],
  "top-load":["累计上压超过额定顶载","Accumulated top load exceeds the entered rating"],"column-load":["单路径保守载荷上界超过额定值","The conservative load bound for a single path exceeds its rating"],
  layers:["叠放层数超过该箱额定值","The stack exceeds this unit's layer rating"],payload:["箱内货物超过包装承重","Cargo exceeds the packaging payload rating"],geometry:["木箱尺寸、重量或叠放位置无效","Crate dimensions, mass or proposed positions are invalid"]};
export function crateEvidence(c:FloorPalletConfig,today=new Date().toISOString().slice(0,10)):{state:CrateEvidenceState;reasons:CrateReason[]}{
  if(!c.crateBearing)return {state:"unverified",reasons:["missing"]};
  let p:CrateBearingProfile;try{p=parseCrateBearing(c.crateBearing);}catch{return {state:"unverified",reasons:["ratings"]};}
  if(p.policy==="prohibited"||p.policy==="rated"&&p.maxTopLoadKg===0)return {state:"prohibited",reasons:["prohibited"]};
  const reasons:CrateReason[]=[];
  if(p.policy!=="rated"||!p.reviewed)reasons.push("missing");
  if(!crateStructure(c).complete)reasons.push("unsupported");
  if(!p.revision||!p.source||!p.conditions)reasons.push("source");
  if(p.validUntil&&p.validUntil<today)reasons.push("expired");
  if(p.reviewedFor!==crateEvidenceKey(c,p))reasons.push("stale");
  if(CRATE_CORNERS.some(id=>p.columnCapacityKg[id]<=0)||!p.allowedOrientations.length)reasons.push("ratings");
  return {state:reasons.length?"unverified":"ready",reasons};
}
/** Bottom contact zones are extracted from physical feet, never a second rectangle recipe. */
export function crateSupportRegions(c:FloorPalletConfig,p:Pick<PlacedPallet,"x"|"y"|"orientation">={x:0,y:0,orientation:"LWH"}):CrateRegion[]{
  return crateStructure(c,{...p,z:0}).paths.flatMap(path=>path.bottom?[path.bottom]:[]);
}
export type CrateReviewUnit={pallet:PlacedPallet;config:FloorPalletConfig;cargoKg:number};
export type CrateStackIssue={unitId:string;code:CrateReason;corner?:CrateCorner};
export type CrateStackReview={kind:"crate-stack-preflight";state:"passed"|"failed"|"unverified"|"prohibited";issues:CrateStackIssue[];units:{id:string;grossKg:number;topLoadKg:number;throughLoadBoundKg:number;topRatingKg:number;columns:{id:CrateCorner;boundKg:number;ratingKg:number}[];evidence:CrateEvidenceState;structure:CrateStructure}[];contacts:{upperId:string;lowerId:string;foot:CrateRegion;zone?:CrateRegion;covered:boolean;footZ?:number;zoneZ?:number;lowerCorner?:CrateCorner;referenceZone?:CrateRegion;referenceZoneZ?:number}[];};
/** Independent, single-column preflight. It neither moves a plan nor certifies transport dynamics. */
export function reviewCrateStack(units:readonly CrateReviewUnit[],today=new Date().toISOString().slice(0,10)):CrateStackReview{
  const issues:CrateStackIssue[]=[],contacts:CrateStackReview["contacts"]=[],rows:CrateStackReview["units"]=[],EPS=.0001;
  if(!units.length||units.length>20||new Set(units.map(u=>u.pallet.id)).size!==units.length)throw new Error("Select 1–20 distinct crates");
  if(units.length<2)issues.push({unitId:units[0].pallet.id,code:"selection"});
  let above=0;
  for(let i=units.length-1;i>=0;i--){
    const {pallet:p,config:c,cargoKg}=units[i],e=crateEvidence(c,today),profile=c.crateBearing??emptyCrateBearing(),gross=p.weight+cargoKg;
    for(const code of e.reasons)issues.push({unitId:p.id,code});
    const height=c.height+(c.maxCargoHeight??0)+(c.packaging?.lid?c.packaging.wallThickness:0),expected=p.orientation==="WLH"?[c.width,c.length]:[c.length,c.width];
    if(![p.x,p.y,p.z,p.dx,p.dy,p.dz,p.weight,cargoKg].every(Number.isFinite)||cargoKg<0||p.weight<0||p.dx!==expected[0]||p.dy!==expected[1]||p.dz!==c.height||p.weight!==c.weight||p.maxLoad!==c.maxLoad||JSON.stringify(p.packaging)!==JSON.stringify(c.packaging)||p.enclosureHeight!==height||!["LWH","WLH"].includes(p.orientation)||i===0&&Math.abs(p.z)>EPS)issues.push({unitId:p.id,code:"geometry"});
    if(cargoKg>c.maxLoad+EPS)issues.push({unitId:p.id,code:"payload"});
    if(e.state==="ready"&&!profile.allowedOrientations.includes(p.orientation))issues.push({unitId:p.id,code:"orientation"});
    if(e.state==="ready"&&above>profile.maxTopLoadKg+EPS)issues.push({unitId:p.id,code:"top-load"});
    if(e.state==="ready"&&units.length-i>profile.maxLayers)issues.push({unitId:p.id,code:"layers"});
    const through=gross+above,columns=CRATE_CORNERS.map(id=>({id,boundKg:through,ratingKg:profile.columnCapacityKg[id]}));
    if(units.length>1&&e.state==="ready")for(const col of columns)if(col.boundKg>col.ratingKg+EPS)issues.push({unitId:p.id,code:"column-load",corner:col.id});
    rows.unshift({id:p.id,grossKg:gross,topLoadKg:above,throughLoadBoundKg:through,topRatingKg:profile.maxTopLoadKg,columns,evidence:e.state,structure:crateStructure(c,p)});above+=gross;
    if(i){
      const lower=units[i-1],lp=lower.pallet,lowerStructure=crateStructure(lower.config,lp),zones=lowerStructure.paths.filter(path=>path.continuous&&path.top).map(path=>({...path.top!,z:path.topZ!})),used=new Set<string>();
      const atTop=Math.abs(p.z-lp.z-(lp.enclosureHeight??0))<EPS,contained=p.x>=lp.x-EPS&&p.y>=lp.y-EPS&&p.x+p.dx<=lp.x+lp.dx+EPS&&p.y+p.dy<=lp.y+lp.dy+EPS;
      for(const path of crateStructure(c,p).paths){
        if(!path.bottom)continue;
        const foot=path.bottom;
        const candidates=zones.filter(z=>path.continuous&&Math.abs(path.bottomZ!-z.z)<EPS&&foot.dx>0&&foot.dy>0&&foot.x>=z.x-EPS&&foot.y>=z.y-EPS&&foot.x+foot.dx<=z.x+z.dx+EPS&&foot.y+foot.dy<=z.y+z.dy+EPS);
        const zone=candidates.length===1?candidates[0]:undefined,covered=!!zone&&!used.has(zone.id)&&atTop&&contained;
        const reference=[...zones].sort((a,b)=>Math.hypot(a.x+a.dx/2-foot.x-foot.dx/2,a.y+a.dy/2-foot.y-foot.dy/2)-Math.hypot(b.x+b.dx/2-foot.x-foot.dx/2,b.y+b.dy/2-foot.y-foot.dy/2))[0];
        if(zone)used.add(zone.id);contacts.push({upperId:p.id,lowerId:lp.id,foot,zone,covered,footZ:path.bottomZ,...(reference?{referenceZone:reference,referenceZoneZ:reference.z}:{}),...(zone?{zoneZ:zone.z,lowerCorner:zone.id}:{})});if(!covered)issues.push({unitId:p.id,code:"contact",corner:foot.id});
      }
    }
  }
  const hard=new Set<CrateReason>(["geometry","payload","orientation","contact","top-load","column-load","layers"]);
  return {kind:"crate-stack-preflight",state:issues.some(i=>hard.has(i.code))?"failed":issues.some(i=>i.code==="prohibited")?"prohibited":issues.length?"unverified":"passed",issues,units:rows,contacts};
}
export function planCrateUnits(plan:PackingResult):CrateReviewUnit[]{return (plan.pallets??[]).filter(p=>p.packaging&&p.packaging.enclosure!=="none").flatMap(p=>{
  const value=plan.palletization,config=value?.specifications?value.specifications.find(s=>s.id===p.specificationId)?.config:value?.config;
  return config?[{pallet:p,config,cargoKg:plan.placements.filter(b=>b.palletIds?.includes(p.id)).reduce((n,b)=>n+b.weight,0)}]:[];
});}
export function proposeCrateColumn(units:readonly CrateReviewUnit[],offsets:readonly {x:number;y:number}[]):CrateReviewUnit[]{
  if(offsets.length!==units.length-1||offsets.some(o=>![o.x,o.y].every(Number.isFinite)))throw new Error("Crate offsets must be finite and match every upper tier");
  return units.map((u,i)=>{const p={...u.pallet};if(!i){p.x=0;p.y=0;p.z=0;}else{const lower=units.slice(0,i).reduce((n,u)=>n+(u.pallet.enclosureHeight??0),0);p.x=offsets.slice(0,i).reduce((n,o)=>n+o.x,0);p.y=offsets.slice(0,i).reduce((n,o)=>n+o.y,0);p.z=lower;}return {...u,pallet:p};});
}

export function crateEvidenceGroups(plan:PackingResult){
  const groups=new Map<string,{config:FloorPalletConfig;ids:string[]}>();
  for(const u of planCrateUnits(plan)){const key=JSON.stringify({structure:crateStructureKey(u.config),profile:u.config.crateBearing??null});const existing=groups.get(key);if(existing)existing.ids.push(u.pallet.id);else groups.set(key,{config:u.config,ids:[u.pallet.id]});}
  return [...groups.values()];
}

/** Independent evidence format, deliberately unrelated to restorable workspace snapshots. */
export function crateStackEvidence(plan:PackingResult,units:readonly CrateReviewUnit[],createdAt=new Date().toISOString()) {
  const source=new Map(planCrateUnits(plan).map(u=>[u.pallet.id,u]));
  for(const u of units){
    const original=source.get(u.pallet.id);
    if(!original||u.cargoKg!==original.cargoKg||JSON.stringify(u.config)!==JSON.stringify(original.config)||JSON.stringify({...original.pallet,x:u.pallet.x,y:u.pallet.y,z:u.pallet.z})!==JSON.stringify(u.pallet))throw new Error("Preflight units must come from unchanged complete source crates");
  }
  if(Number.isNaN(Date.parse(createdAt))||new Date(createdAt).toISOString()!==createdAt)throw new Error("Invalid preflight evidence date");
  return {format:"cargo-fit-crate-stack-preflight",version:2,geometryModel:"four-corner-paths-v1",createdAt,sourcePlanId:plan.id,engineVersion:plan.engineVersion,scope:"independent-preflight-only",units,report:reviewCrateStack(units,createdAt.slice(0,10))};
}
