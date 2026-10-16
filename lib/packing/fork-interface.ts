import {DEFAULT_PACKAGING,packagingParts,parsePackaging,validateBaseMeasurements,type PackagingPart} from "./packaging";
import {siteExclusionBoxes} from "./site-exclusions";
import {bodiesOverlap} from "./cargo-body";
import type {FloorPalletConfig,PackingResult,PlacedBox,PlacedPallet} from "./types";

export const FORK_MODEL_VERSION="rectangular-twin-forks-v1";
export const FORK_DIRECTIONS=["x-min","x-max","y-min","y-max"] as const;
export type ForkDirection=typeof FORK_DIRECTIONS[number];
export type ForkInterface={
 direction:ForkDirection;forkWidth:number;forkThickness:number;forkLength:number;spacing:number;
 center:number;bottomZ:number;insertionDepth:number;tipClearance:number;clearance:number;withdrawalClearance:number;
 source:string;revision:string;reviewedFor:string;
 ratings:{staticKg:number;dynamicKg:number;rackKg:number;source:string};
};
export const FORK_NUMBERS=["forkWidth","forkThickness","forkLength","spacing","center","bottomZ","insertionDepth","tipClearance","clearance","withdrawalClearance"] as const;
export const FORK_NUMBER_TEXT:Record<typeof FORK_NUMBERS[number],[string,string]>={
 forkWidth:["单叉宽","Single fork width"],forkThickness:["叉厚包络","Fork thickness envelope"],forkLength:["叉长包络","Fork length envelope"],spacing:["双叉中心间距","Fork center spacing"],center:["横向中心位置","Lateral center position"],bottomZ:["叉底离底座底面高度","Fork bottom above base bottom"],insertionDepth:["实际插入深度","Insertion depth"],tipClearance:["叉尖至对面最小余量","Minimum far-side tip reserve"],clearance:["几何检查间隙","Geometry clearance"],withdrawalClearance:["完全抽出后额外净距","Extra clearance after withdrawal"]
};
export const FORK_DIRECTION_TEXT:Record<ForkDirection,[string,string]>={"x-min":["从原长向 X 最小端","From local X minimum"],"x-max":["从原长向 X 最大端","From local X maximum"],"y-min":["从原宽向 Y 最小端","From local Y minimum"],"y-max":["从原宽向 Y 最大端","From local Y maximum"]};
export function emptyForkInterface(c:FloorPalletConfig):ForkInterface{return {direction:"x-min",forkWidth:0,forkThickness:0,forkLength:0,spacing:0,center:c.width/2,bottomZ:0,insertionDepth:0,tipClearance:0,clearance:0,withdrawalClearance:0,source:"",revision:"",reviewedFor:"",ratings:{staticKg:0,dynamicKg:0,rackKg:0,source:""}};}
export function parseForkInterface(value:unknown):ForkInterface{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("双叉接口格式无效");const p=value as ForkInterface;
 if(!FORK_DIRECTIONS.includes(p.direction))throw Error("进叉面无效");
 const n=(v:unknown)=>{if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>100000)throw Error("叉具尺寸与额定资料须为 0–100000 的有限数值");return v;};
 const text=(v:unknown,max:number)=>{if(typeof v!=="string"||v.length>max)throw Error("叉具资料来源或版本无效");return v.trim();};
 if(!p.ratings||typeof p.ratings!=="object"||Array.isArray(p.ratings))throw Error("搬运载荷资料格式无效");
 return {...Object.fromEntries(FORK_NUMBERS.map(k=>[k,n(p[k])])) as Pick<ForkInterface,typeof FORK_NUMBERS[number]>,direction:p.direction,source:text(p.source,500),revision:text(p.revision,120),reviewedFor:text(p.reviewedFor,32768),ratings:{staticKg:n(p.ratings.staticKg),dynamicKg:n(p.ratings.dynamicKg),rackKg:n(p.ratings.rackKg),source:text(p.ratings.source,500)}};
}
/** This is a review bookmark, not a signed attestation or a strength certificate. */
export function forkEvidenceKey(c:FloorPalletConfig,p=c.forkInterface??emptyForkInterface(c)){
 const spec=c.packaging??DEFAULT_PACKAGING;
 return JSON.stringify({model:FORK_MODEL_VERSION,dimensions:[c.length,c.width,c.height,c.maxCargoHeight??0,c.weight,c.maxLoad],structure:{base:spec.base,enclosure:spec.enclosure,material:spec.material,deckBoards:spec.deckBoards,runners:spec.runners,wallThickness:spec.wallThickness,lid:spec.lid,measurements:spec.measurements?{...spec.measurements,source:spec.measurements.source.trim(),revision:spec.measurements.revision.trim()}:null},probe:{...parseForkInterface(p),reviewedFor:undefined}});
}
export function forkEvidenceReady(c:FloorPalletConfig,p=c.forkInterface){try{validateBaseMeasurements(c.length,c.width,c.height,c.packaging);return !!(p&&c.packaging?.measurements?.source.trim()&&c.packaging.measurements.revision.trim()&&p.source.trim()&&p.revision.trim()&&p.reviewedFor===forkEvidenceKey(c,p));}catch{return false;}}
export type ForkWindow={lateral:number;z:number;width:number;height:number};
const EPS=.0001;
type Box=Pick<PlacedBox,"x"|"y"|"z"|"dx"|"dy"|"dz">;
const intersects=(a:Box,b:Box)=>a.x<b.x+b.dx-EPS&&a.x+a.dx>b.x+EPS&&a.y<b.y+b.dy-EPS&&a.y+a.dy>b.y+EPS&&a.z<b.z+b.dz-EPS&&a.z+a.dz>b.z+EPS;
export function forkBaseParts(c:FloorPalletConfig):PackagingPart[]{if(![c.length,c.width,c.height].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>0&&n<=100000))throw Error("Invalid base dimensions");const spec=parsePackaging(c.packaging??DEFAULT_PACKAGING);validateBaseMeasurements(c.length,c.width,c.height,spec);return packagingParts(c.length,c.width,c.height,spec);}
/** Exact free rectangles in the full-depth projection of this axis-aligned base recipe. */
export function forkWindows(c:FloorPalletConfig,axis:"x"|"y"):ForkWindow[]{
 const parts=forkBaseParts(c),span=axis==="x"?c.width:c.length;
 const zs=[...new Set([0,c.height,...parts.flatMap(b=>[b.z,b.z+b.dz])])].filter(z=>z>=0&&z<=c.height).sort((a,b)=>a-b),windows:ForkWindow[]=[];
 for(let i=1;i<zs.length;i++){
  const z=zs[i-1],height=zs[i]-z;if(height<=EPS)continue;
  const ranges=parts.filter(b=>b.z<z+height-EPS&&b.z+b.dz>z+EPS).map(b=>axis==="x"?[b.y,b.y+b.dy]:[b.x,b.x+b.dx]).sort((a,b)=>a[0]-b[0]);
  const free:Array<[number,number]>=[];let edge=0;
  for(const [a,b] of ranges){if(a>edge+EPS)free.push([edge,Math.min(span,a)]);edge=Math.max(edge,b);}if(edge<span-EPS)free.push([edge,span]);
  for(const [a,b] of free){const previous=windows.find(w=>Math.abs(w.lateral-a)<EPS&&Math.abs(w.width-(b-a))<EPS&&Math.abs(w.z+w.height-z)<EPS);if(previous)previous.height+=height;else windows.push({lateral:a,z,width:b-a,height});}
 }
 // Open gaps between deck boards are not enclosed fork channels.
 return windows.filter(w=>w.z+w.height<c.height-EPS);
}
export type ForkIssue="missing"|"structure"|"length"|"pair"|"bounds"|"tip"|"part"|"cargo"|"pallet"|"site"|"wall"|"door"|"open";
export const FORK_ISSUE_TEXT:Record<ForkIssue,[string,string]>={
 missing:["叉具宽、厚、长、间距或插深尚未填写","Fork width, thickness, length, spacing or insertion depth is missing"],structure:["底座结构数据无效","Base structure data is invalid"],length:["插深超过叉长包络","Insertion exceeds fork length"],pair:["双叉包络及检查间隙互相重叠","Fork envelopes and their clearances overlap"],bounds:["叉具超出底座横向或高度范围","Forks exceed the lateral or vertical base bounds"],tip:["叉尖到对面的预留不足","Insufficient far-side tip reserve"],part:["直线进叉／抽叉包络与底座部件相交","Straight fork insertion / withdrawal intersects base parts"],cargo:["抽叉直线包络与当前货物相交","Straight withdrawal intersects current cargo"],pallet:["抽叉直线包络进入其他整托保留空间","Straight withdrawal enters another unit envelope"],site:["抽叉直线包络与柜内禁占区相交","Straight withdrawal intersects a site region"],wall:["抽叉直线包络超出柜内侧壁、柜头或高度","Straight withdrawal exceeds the vehicle sides, nose or height"],door:["柜门外的叉具包络不在门洞净空内","Fork envelopes outside the rear exceed the door opening"],open:["开放装载面之外的实际作业边界未建模","Actual handling boundaries beyond open loading faces are not modeled"]
};
export type ForkCheck={state:"pass"|"fail"|"unverified";evidence:"reviewed"|"unverified";scope:"local"|"vehicle"|"inspection";issues:{code:ForkIssue;ids:string[]}[];forks:Box[];sweeps:Box[];windows:{x:ForkWindow[];y:ForkWindow[]};equipment:"unverified";ratings:{staticKg:number;dynamicKg:number;rackKg:number;source:string};};
export function inspectForkInterface(c:FloorPalletConfig):ForkCheck{
 const out:ForkCheck={state:"unverified",evidence:"unverified",scope:"local",issues:[],forks:[],sweeps:[],windows:{x:[],y:[]},equipment:"unverified",ratings:c.forkInterface?.ratings??{staticKg:0,dynamicKg:0,rackKg:0,source:""}};
 const add=(code:ForkIssue,ids:string[]=[])=>out.issues.push({code,ids});
 let parts:PackagingPart[],p:ForkInterface;
 try{if(![c.length,c.width,c.height].every(n=>Number.isFinite(n)&&n>0))throw Error();parts=forkBaseParts(c);out.windows={x:forkWindows(c,"x"),y:forkWindows(c,"y")};p=parseForkInterface(c.forkInterface??emptyForkInterface(c));}catch{add("structure");out.state="fail";return out;}
 out.evidence=forkEvidenceReady(c,p)?"reviewed":"unverified";
 if([p.forkWidth,p.forkThickness,p.forkLength,p.spacing,p.insertionDepth].some(n=>n<=0)){add("missing");return out;}
 const alongX=p.direction.startsWith("x"),reverse=p.direction.endsWith("max"),depth=alongX?c.length:c.width,span=alongX?c.width:c.length;
 if(p.insertionDepth>p.forkLength+EPS)add("length");
 if(p.spacing<p.forkWidth+2*p.clearance-EPS)add("pair");
 if(p.insertionDepth+p.tipClearance+p.clearance>depth+EPS)add("tip");
 const make=(lo:number,hi:number,lateral:number):Box=>{const a=reverse?depth-hi:lo,b=reverse?depth-lo:hi;return alongX?{x:a,y:lateral,z:p.bottomZ,dx:b-a,dy:p.forkWidth,dz:p.forkThickness}:{x:lateral,y:a,z:p.bottomZ,dx:p.forkWidth,dy:b-a,dz:p.forkThickness};};
 const pad=(b:Box):Box=>({x:b.x-p.clearance,y:b.y-p.clearance,z:b.z-p.clearance,dx:b.dx+2*p.clearance,dy:b.dy+2*p.clearance,dz:b.dz+2*p.clearance});
 for(const center of [p.center-p.spacing/2,p.center+p.spacing/2]){
  const lateral=center-p.forkWidth/2;
  if(lateral-p.clearance< -EPS||lateral+p.forkWidth+p.clearance>span+EPS||p.bottomZ-p.clearance< -EPS||p.bottomZ+p.forkThickness+p.clearance>c.height+EPS)add("bounds");
  const fork=make(p.insertionDepth-p.forkLength,p.insertionDepth,lateral),sweep=pad(make(-p.forkLength-p.withdrawalClearance,p.insertionDepth,lateral));out.forks.push(fork);out.sweeps.push(sweep);
  const hits=parts.flatMap((part,i)=>intersects(sweep,part)?[`base/${i+1}`]:[]);if(hits.length)add("part",hits);
 }
 out.state=out.issues.length?"fail":"pass";return out;
}
export function forkConfigForPallet(plan:PackingResult,p:PlacedPallet):FloorPalletConfig|undefined{
 const value=plan.palletization;return value?.specifications?value.specifications.find(s=>s.id===p.specificationId)?.config:value?.config??plan.floorPallets;
}
/** Same LWH/WLH rotation as placedPackagingParts. Coordinates are the plan's usable frame. */
export function placeForkBox(p:PlacedPallet,b:Box):Box{return p.orientation==="WLH"?{x:p.x+b.y,y:p.y+p.dy-b.x-b.dx,z:p.z+b.z,dx:b.dy,dy:b.dx,dz:b.dz}:{...b,x:p.x+b.x,y:p.y+b.y,z:p.z+b.z};}
export function inspectPlanFork(plan:PackingResult,id:string):ForkCheck{
 const p=plan.pallets?.find(p=>p.id===id),config=p&&forkConfigForPallet(plan,p);
 if(!p||!config)return {state:"unverified",evidence:"unverified",scope:"local",issues:[{code:"missing",ids:[id]}],forks:[],sweeps:[],windows:{x:[],y:[]},equipment:"unverified",ratings:{staticKg:0,dynamicKg:0,rackKg:0,source:""}};
 const out=inspectForkInterface(config);out.forks=out.forks.map(b=>placeForkBox(p,b));out.sweeps=out.sweeps.map(b=>placeForkBox(p,b));out.scope=plan.workflow==="pallet-only"||plan.palletization?.only?"inspection":"vehicle";
 if(out.state==="unverified"||out.scope==="inspection")return out;
 const add=(code:ForkIssue,ids:string[]=[])=>{if(ids.length||code==="wall"||code==="door")out.issues.push({code,ids});};
 let openBoundary=false;
 const length=plan.container.length-2*plan.clearance,width=plan.container.width-2*plan.clearance,height=plan.container.height-plan.clearance;
 for(const [index,b] of out.sweeps.entries()){
  const fork:PlacedBox={...b,id:`fork-${index}`,productId:"fork",sku:"Fork",name:"Fork",color:"#247d89",weight:0,layer:1,orientation:"LWH"};
  if(plan.container.loadingAccess==="open"&&(b.x< -EPS||b.x+b.dx>length+EPS||b.y< -EPS||b.y+b.dy>width+EPS||b.z< -EPS||b.z+b.dz>height+EPS))openBoundary=true;
  if(plan.container.loadingAccess!=="open"){
   if(b.x< -EPS||b.y< -EPS||b.y+b.dy>width+EPS||b.z< -EPS||b.z+b.dz>height+EPS)add("wall");
   if(b.x+b.dx>length+EPS&&(b.y+b.dy>plan.container.doorWidth-2*plan.clearance+EPS||b.z+b.dz>plan.container.doorHeight-plan.clearance+EPS))add("door");
  }
  add("cargo",plan.placements.filter(cargo=>bodiesOverlap(fork,cargo,undefined,plan.cargoDetails?.[cargo.productId])).map(cargo=>cargo.id));
  add("pallet",(plan.pallets??[]).filter(other=>other.id!==p.id&&intersects(b,{...other,dz:Math.max(other.dz,other.enclosureHeight??0,...plan.placements.filter(c=>c.palletIds?.includes(other.id)).map(c=>c.z+c.dz-other.z))})).map(other=>other.id));
  add("site",siteExclusionBoxes(plan.container,plan.clearance).filter(zone=>intersects(b,zone)).map(zone=>zone.id));
 }
 if(out.issues.length)out.state="fail";else if(openBoundary){out.issues.push({code:"open",ids:[]});out.state="unverified";}else out.state="pass";return out;
}
export function forkReport(plan:PackingResult,id:string){
 const pallet=plan.pallets?.find(p=>p.id===id),config=pallet&&forkConfigForPallet(plan,pallet);
 if(!pallet||!config||!plan.validation.valid)throw Error("A validated plan and known pallet are required");
 return {format:"cargo-fit-fork-preflight",version:1,model:FORK_MODEL_VERSION,planId:plan.id,planCreatedAt:plan.createdAt,checkedAt:new Date().toISOString(),engineVersion:plan.engineVersion,palletId:id,coordinateFrame:plan.workflow==="pallet-only"?"pallet-inspection":"vehicle-usable",pallet,config,check:inspectPlanFork(plan,id),scope:"Rectangular straight forks at final unit pose only; equipment, lifting, strength and handling sequence remain unverified"};
}
export function forkEvidenceGroups(plan:PackingResult){
 const map=new Map<string,{config:FloorPalletConfig;ids:string[]}>();for(const p of plan.pallets??[]){const c=forkConfigForPallet(plan,p);if(!c||!c.forkInterface&&!c.packaging?.measurements)continue;const key=JSON.stringify(c);const g=map.get(key)??{config:c,ids:[]};g.ids.push(p.id);map.set(key,g);}return [...map.values()];
}
