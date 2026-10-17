import {forkConfigForPallet,inspectForkInterface,placeForkBox} from "./fork-interface";
import {placedPackagingParts} from "./packaging";
import type {PackingResult,PlacedBox} from "./types";

export const EQUIPMENT_MODEL="fixed-heading-linear-v1";
export const EQUIPMENT_STORAGE_KEY="cargo-fit-equipment-template-v1";
export const EQUIPMENT_FIELDS=["bodyLength","bodyWidth","bodyHeight","mastDepth","mastWidth","mastHeight","maxLift","clearance"] as const;
export type EquipmentTemplate={name:string;source:string;revision:string}&Record<typeof EQUIPMENT_FIELDS[number],number|null>;
export type HandlingSite={source:string;revision:string;doorLeft:number|null;doorBottom:number|null;frameDepth:number|null;outsideLength:number|null;outsideLeft:number|null;outsideWidth:number|null;outsideHeight:number|null;outsideFloor:number|null};
export const SITE_FIELDS=["doorLeft","doorBottom","frameDepth","outsideLength","outsideLeft","outsideWidth","outsideHeight","outsideFloor"] as const;
export type HandlingPose={x:number;y:number;lift:number};
export type EquipmentAction={mode:"loaded"|"fork-only";from:HandlingPose;to:HandlingPose};
export type EquipmentTask={equipment:EquipmentTemplate;site:HandlingSite;action:EquipmentAction};
type Box=Pick<PlacedBox,"x"|"y"|"z"|"dx"|"dy"|"dz">;
export type EquipmentIssueCode="missing"|"fork-evidence"|"fork-fit"|"plan"|"workflow"|"motion"|"lift"|"floor-level"|"wall"|"door"|"outside"|"obstacle"|"target";
export type EquipmentIssue={code:EquipmentIssueCode;component:string;ids:string[]};
export type EquipmentCheck={state:"clear"|"blocked"|"unverified";issues:EquipmentIssue[];sweeps:({component:string}&Box)[];forkEvidence:"reviewed"|"unverified";method:typeof EQUIPMENT_MODEL;unverified:string[]};
export const EQUIPMENT_ISSUE_TEXT:Record<EquipmentIssueCode,[string,string]>={
 missing:["缺少有效设备或现场资料","Valid equipment or site data is missing"],"fork-evidence":["底座／叉具资料尚未确认或已变更","Base / fork evidence is unreviewed or changed"],"fork-fit":["当前底座与双叉接口不通过","Current base and fork interface fails"],plan:["方案未通过布局校验或没有该整托","Plan layout is invalid or the unit is missing"],workflow:["只打托／开放装载的现场边界未实现","Worksite bounds for pallet-only / open loading are not implemented"],motion:["首阶段仅支持单轴平移或单独起升","Only single-axis translation or a separate lift is supported"],lift:["起升超过设备几何资料覆盖范围","Lift exceeds the documented equipment geometry range"],"floor-level":["门外地面高差尚未建模坡道","No ramp model for the outside floor level difference"],wall:["扫掠越过柜头、侧壁、地板或顶部","Sweep exceeds the nose, sides, floor or roof"],door:["扫掠不满足门框／门槛净空","Sweep violates the door frame / sill clearance"],outside:["扫掠超出已记录的门外作业区","Sweep exceeds the recorded exterior work area"],obstacle:["保守包络受当前货物／整托／区域阻挡","Conservative envelope is blocked by current cargo / units / regions"],target:["设备包络与目标整托实体部件／货物干涉","Equipment envelope interferes with target base parts / cargo"]
};
export const EQUIPMENT_COMPONENT_TEXT:Record<string,[string,string]>={equipment:["设备资料","Equipment data"],fork:["双叉接口","Fork interface"],action:["动作资料","Action data"],door:["门框资料","Door frame data"],outside:["门外作业区","Exterior work area"],body:["车体","Body"],mast:["门架最大包络","Maximum mast envelope"],"fork-1":["货叉 1","Fork 1"],"fork-2":["货叉 2","Fork 2"],load:["整托保守外包络","Conservative loaded-unit envelope"]};
export const EQUIPMENT_UNVERIFIED:[string,string][]=[
 ["完整接近、进叉、起升、门洞、转向、落位、抽叉和退出顺序未执行","Full approach, insertion, lift, doorway, turning, placement, withdrawal and exit sequence not executed"],
 ["转弯运动学、设备额定能力、载荷中心、挠曲和动态稳定未核验","Turning kinematics, rated capacity, load center, deflection and dynamic stability unverified"],
 ["地板轮压、临时承托、材料安装／拆除、人员和现场条件未核验","Wheel pressure, temporary supports, material installation / removal, personnel and field conditions unverified"]
];
export function emptyEquipment():EquipmentTemplate{return {name:"",source:"",revision:"",...Object.fromEntries(EQUIPMENT_FIELDS.map(k=>[k,null]))} as EquipmentTemplate;}
export function emptyHandlingSite():HandlingSite{return {source:"",revision:"",...Object.fromEntries(SITE_FIELDS.map(k=>[k,null]))} as HandlingSite;}
export function emptyEquipmentTask():EquipmentTask{return {equipment:emptyEquipment(),site:emptyHandlingSite(),action:{mode:"loaded",from:{x:0,y:0,lift:0},to:{x:0,y:0,lift:0}}};}
const finite=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=100000;
const source=(s:unknown,max=500):s is string=>typeof s==="string"&&!!s.trim()&&s.length<=max;
export function parseEquipmentTemplate(value:unknown):EquipmentTemplate{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid equipment template / 设备模板无效");const v=value as EquipmentTemplate;
 if(!source(v.name,100)||!source(v.source)||!source(v.revision,120)||!EQUIPMENT_FIELDS.every(k=>finite(v[k])&&(k==="clearance"||k==="maxLift"?v[k]>=0:v[k]>0)))throw Error("Complete measured equipment dimensions and sources / 请补全设备尺寸及来源");
 return {name:v.name.trim(),source:v.source.trim(),revision:v.revision.trim(),...Object.fromEntries(EQUIPMENT_FIELDS.map(k=>[k,v[k]]))} as EquipmentTemplate;
}
export function serializeEquipmentTemplate(value:unknown){return JSON.stringify({format:"cargo-fit-equipment-template",version:1,equipment:parseEquipmentTemplate(value)});}
export function readEquipmentTemplate(text:string){const v=JSON.parse(text);if(v?.format!=="cargo-fit-equipment-template"||v.version!==1)throw Error("Unknown equipment template / 未知设备模板");return parseEquipmentTemplate(v.equipment);}
const EPS=.0001;
const overlaps=(a:Box,b:Box)=>a.x<b.x+b.dx-EPS&&a.x+a.dx>b.x+EPS&&a.y<b.y+b.dy-EPS&&a.y+a.dy>b.y+EPS&&a.z<b.z+b.dz-EPS&&a.z+a.dz>b.z+EPS;
const moved=(b:Box,p:HandlingPose,lifts:boolean):Box=>({...b,x:b.x+p.x,y:b.y+p.y,z:b.z+(lifts?p.lift:0)});
function sweep(a:Box,b:Box,gap:number):Box{const x=Math.min(a.x,b.x)-gap,y=Math.min(a.y,b.y)-gap,z=Math.min(a.z,b.z)-gap;return {x,y,z,dx:Math.max(a.x+a.dx,b.x+b.dx)+gap-x,dy:Math.max(a.y+a.dy,b.y+b.dy)+gap-y,dz:Math.max(a.z+a.dz,b.z+b.dz)+gap-z};}
const inside=(b:Box,bounds:Box)=>b.x>=bounds.x-EPS&&b.y>=bounds.y-EPS&&b.z>=bounds.z-EPS&&b.x+b.dx<=bounds.x+bounds.dx+EPS&&b.y+b.dy<=bounds.y+bounds.dy+EPS&&b.z+b.dz<=bounds.z+bounds.dz+EPS;
/** Clip only for boundary checks; collision sweeps always retain their full size. */
function slice(b:Box,lo:number,hi:number):Box|null{const x=Math.max(b.x,lo),end=Math.min(b.x+b.dx,hi);return end>x+EPS?{...b,x,dx:end-x}:null;}
const physical=(b:Box,c:number):Box=>({...b,x:b.x+c,y:b.y+c});
function unitEnvelope(plan:PackingResult,id:string):Box{
 const p=plan.pallets!.find(p=>p.id===id)!,cargo=plan.placements.filter(b=>b.palletIds?.includes(id));
 const x=Math.min(p.x,...cargo.map(b=>b.x)),y=Math.min(p.y,...cargo.map(b=>b.y)),z=Math.min(p.z,...cargo.map(b=>b.z)),top=Math.max(p.z+(p.enclosureHeight??p.dz),...cargo.map(b=>b.z+b.dz));return {x,y,z,dx:Math.max(p.x+p.dx,...cargo.map(b=>b.x+b.dx))-x,dy:Math.max(p.y+p.dy,...cargo.map(b=>b.y+b.dy))-y,dz:top-z};
}
/** Continuous AABB sweep is exact for a rigid box translating on one axis. Rounded/concave loads use their conservative unit exterior. No path search or turn sampling. */
export function inspectEquipmentAction(plan:PackingResult,id:string,task:EquipmentTask):EquipmentCheck{
 const out:EquipmentCheck={state:"unverified",issues:[],sweeps:[],forkEvidence:"unverified",method:EQUIPMENT_MODEL,unverified:EQUIPMENT_UNVERIFIED.map(t=>t[1])};
 const add=(code:EquipmentIssueCode,component="",ids:string[]=[])=>{if(!out.issues.some(i=>i.code===code&&i.component===component&&JSON.stringify(i.ids)===JSON.stringify(ids)))out.issues.push({code,component,ids});};
 const p=plan.pallets?.find(p=>p.id===id),config=p&&forkConfigForPallet(plan,p);
 if(!p||!config||!plan.validation.valid){add("plan");return out;}
 if(plan.workflow==="pallet-only"||plan.palletization?.only||plan.container.loadingAccess==="open"){add("workflow");return out;}
 let e:EquipmentTemplate;try{e=parseEquipmentTemplate(task.equipment);}catch{add("missing","equipment");return out;}
 const {site:s,action:a}=task,validSite=source(s?.source)&&source(s?.revision,120);
 const pose=(v:HandlingPose)=>v&&[v.x,v.y,v.lift].every(finite)&&v.lift>=0;
 if(!a||!["loaded","fork-only"].includes(a.mode)||!pose(a.from)||!pose(a.to)){add("missing","action");return out;}
 if(["x","y","lift"].filter(k=>a.from[k as keyof HandlingPose]!==a.to[k as keyof HandlingPose]).length>1){add("motion");return out;}
 if(Math.max(a.from.lift,a.to.lift)>e.maxLift!+EPS){add("lift");return out;}
 const local=inspectForkInterface(config),f=config.forkInterface;out.forkEvidence=local.evidence;
 if(local.evidence!=="reviewed")add("fork-evidence");
 if(!f||local.state==="unverified"){add("missing","fork");return out;}
 if(local.state==="fail"){add("fork-fit","fork",local.issues.flatMap(i=>i.ids));return {...out,state:"blocked"};}
 const c=plan.container,g=e.clearance!,heel=f.insertionDepth-f.forkLength;
 const localBox=(depth:number,width:number,height:number):Box=>{
  const low=heel-depth,high=heel,t=f.center-width/2;
  if(f.direction==="x-min")return {x:low,y:t,z:0,dx:depth,dy:width,dz:height};
  if(f.direction==="x-max")return {x:config.length-high,y:t,z:0,dx:depth,dy:width,dz:height};
  if(f.direction==="y-min")return {x:t,y:low,z:0,dx:width,dy:depth,dz:height};
  return {x:t,y:config.width-high,z:0,dx:width,dy:depth,dz:height};
 };
 const components=[{component:"body",box:{...placeForkBox(p,localBox(e.bodyLength!,e.bodyWidth!,e.bodyHeight!)),z:0},lifts:false},{component:"mast",box:{...placeForkBox(p,localBox(e.mastDepth!,e.mastWidth!,e.mastHeight!)),z:0},lifts:false},...local.forks.map((b,i)=>({component:`fork-${i+1}`,box:placeForkBox(p,b),lifts:true}))];
 if(a.mode==="loaded")components.push({component:"load",box:unitEnvelope(plan,id),lifts:true});
 const targetCargo=plan.placements.filter(b=>b.palletIds?.includes(id));
 // Spanning cargo is not a safely detachable independent unit.
 if(targetCargo.some(b=>b.palletIds?.some(other=>other!==id))){add("workflow","load");return out;}
 const obstacles=[...plan.placements.filter(b=>!b.palletIds?.includes(id)).map(b=>({...physical(b,plan.clearance),id:b.id})),...(plan.pallets??[]).filter(b=>b.id!==id).map(b=>({...physical(unitEnvelope(plan,b.id),plan.clearance),id:b.id})),...(c.exclusions??[]).map(b=>({...b,id:`site-exclusion/${b.id}`}))];
 const target=[...placedPackagingParts({...p,packaging:config.packaging}).map((b,i)=>({...physical(b,plan.clearance),id:`${id}/base/${i+1}`})),...targetCargo.map(b=>({...physical(b,plan.clearance),id:b.id}))];
 const doorReady=validSite&&[s.doorLeft,s.doorBottom,s.frameDepth].every(n=>finite(n)&&n>=0)&&s.doorLeft!+c.doorWidth<=c.width+EPS&&s.doorBottom!+c.doorHeight<=c.height+EPS;
 const exteriorReady=validSite&&[s.outsideLength,s.outsideWidth,s.outsideHeight].every(n=>finite(n)&&n>0)&&finite(s.outsideLeft)&&finite(s.outsideFloor);
 for(const part of components){
  const start=physical(moved(part.box,a.from,part.lifts),plan.clearance),end=physical(moved(part.box,a.to,part.lifts),plan.clearance),b=sweep(start,end,g);
  // Clearance is a separation reserve, not a requirement to float above the floor.
  if(b.z<0&&Math.min(start.z,end.z)>=0){b.dz+=b.z;b.z=0;}
  out.sweeps.push({component:part.component,...b});
  const inner=slice(b,-Infinity,c.length);
  if(inner&&!inside(inner,{x:0,y:0,z:0,dx:c.length,dy:c.width,dz:c.height}))add("wall",part.component);
  const exterior=slice(b,c.length,Infinity);
  if(exterior){
   if(!exteriorReady)add("missing","outside");
   else {if(s.outsideFloor!==0)add("floor-level","outside");if(!inside(exterior,{x:c.length,y:s.outsideLeft!,z:s.outsideFloor!,dx:s.outsideLength!,dy:s.outsideWidth!,dz:s.outsideHeight!}))add("outside",part.component);}
  }
  const gate=slice(b,c.length-(finite(s?.frameDepth)?s.frameDepth:0),c.length+(finite(s?.frameDepth)?s.frameDepth:0));
  // Include the zero-depth door plane whenever a sweep crosses it.
  const crosses=b.x<=c.length+EPS&&b.x+b.dx>=c.length-EPS;
  if(gate||crosses){if(!doorReady)add("missing","door");else if(b.y<s.doorLeft!-EPS||b.y+b.dy>s.doorLeft!+c.doorWidth+EPS||b.z<s.doorBottom!-EPS||b.z+b.dz>s.doorBottom!+c.doorHeight+EPS)add("door",part.component);}
  const hits=obstacles.filter(o=>overlaps(b,o)).map(o=>o.id);if(hits.length)add("obstacle",part.component,hits);
  if(part.component!=="load"){
   // With a coupled load only the equipment-to-load relative pose is checked; fork and cargo move together.
   const relative=a.mode==="loaded"?sweep(physical(part.box,plan.clearance),physical(part.box,plan.clearance),g):b;
   // Vertical lift does not lift the chassis; compare its sweep to the carried unit sweep too.
   const targets=a.mode==="loaded"&&!part.lifts?target.map(t=>({...sweep(moved(t,{x:0,y:0,lift:a.from.lift},true),moved(t,{x:0,y:0,lift:a.to.lift},true),0),id:t.id})):target;
   const selfHits=targets.filter(t=>overlaps(relative,t)).map(t=>t.id);if(selfHits.length)add("target",part.component,selfHits);
  }
 }
 const blocked=new Set<EquipmentIssueCode>(["wall","door","outside","obstacle","target"]);
 out.state=out.issues.some(i=>blocked.has(i.code))?"blocked":out.issues.length?"unverified":"clear";return out;
}
/** Reports are snapshots, never reusable authorization. Recompute on every export. */
export function equipmentActionReport(plan:PackingResult,id:string,task:EquipmentTask){
 return {format:"cargo-fit-equipment-action",version:1,model:EQUIPMENT_MODEL,planId:plan.id,planCreatedAt:plan.createdAt,engineVersion:plan.engineVersion,checkedAt:new Date().toISOString(),palletId:id,coordinateFrame:"physical-inner-nose-left-floor-mm",snapshotCoordinateFrame:"vehicle-usable-mm; add planClearance to X and Y for physical coordinates",planClearance:plan.clearance,workflow:plan.workflow,layoutValidation:plan.validation,task,unit:plan.pallets?.find(p=>p.id===id),baseConfig:plan.pallets?.find(p=>p.id===id)&&forkConfigForPallet(plan,plan.pallets.find(p=>p.id===id)!),container:plan.container,placements:plan.placements,pallets:plan.pallets,check:inspectEquipmentAction(plan,id,task),scope:"Independent single straight action, fixed heading. All current cargo and accessory reservations remain obstacles. No complete handling, turn, capacity or field authorization."};
}
