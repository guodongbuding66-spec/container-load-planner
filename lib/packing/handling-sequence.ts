import {EQUIPMENT_FIELDS,SITE_FIELDS,emptyEquipmentTask,inspectEquipmentAction,parseEquipmentTemplate,type EquipmentTask,type HandlingPose,type EquipmentCheck} from "./equipment-actions";
import {forkConfigForPallet,forkEvidenceKey} from "./fork-interface";
import type {PackingResult} from "./types";

export const HANDLING_MODEL="fixed-rear-sequence-v1";
export const HANDLING_KINDS=["approach","insert","lift","transfer","lower","withdraw","exit"] as const;
export type HandlingKind=typeof HANDLING_KINDS[number];
export type HandlingStep={id:string;kind:HandlingKind;from:HandlingPose;to:HandlingPose};
export type HandlingTask={version:1;model:typeof HANDLING_MODEL;unitId:string;revision:string;direction:"load"|"unload";outsideX:number;basis:string;equipment:EquipmentTask["equipment"];site:EquipmentTask["site"];steps:HandlingStep[]};
export type HandlingCode="basis"|"scope"|"sequence"|"continuity"|"alignment"|"engagement"|"support"|"destination"|"initial-support";
export const HANDLING_KIND_TEXT:Record<HandlingKind,[string,string]>={approach:["接近","Approach"],insert:["进叉并接联","Insert and engage"],lift:["起升","Lift"],transfer:["直线搬运／过门","Straight transfer / doorway"],lower:["落位与支承切换","Lower and establish support"],withdraw:["抽叉并解联","Withdraw and disengage"],exit:["退出","Exit"]};
export const HANDLING_CODE_TEXT:Record<HandlingCode,[string,string]>={basis:["方案、设备或现场资料已变化，须重新绑定任务","Plan, equipment or site changed; rebind the task"],scope:["首阶段仅支持底置整托、朝柜尾正 X 进叉和平整地面","This stage requires a floor unit, rear-facing +X fork entry and level ground"],sequence:["步骤缺失、重复或顺序错误","Steps are missing, duplicated or out of order"],continuity:["相邻步骤起终姿态不连续","Adjacent step poses are discontinuous"],alignment:["动作偏离固定进叉轴线或方向","Motion departs from the fixed fork axis or direction"],engagement:["进叉、接联或起升条件未满足","Insertion, engagement or lift conditions are unmet"],support:["整托未在已建模地面获得支承，禁止解联","Unit is not supported on the modeled floor; disengagement is forbidden"],destination:["整托未到达任务目标位置","Unit has not reached the task destination"],"initial-support":["门外起始整托缺少有效地面及作业区资料","Outside starting unit lacks valid floor and work-area data"]};
export type HandlingStepCheck={id:string;kind:HandlingKind;state:"clear"|"blocked"|"unverified"|"not-executed";issues:HandlingCode[];geometry?:EquipmentCheck;connected:boolean;supported:boolean};
export type HandlingSequenceCheck={state:"clear"|"blocked"|"unverified";issues:HandlingCode[];steps:HandlingStepCheck[];unitPose:HandlingPose;connected:boolean;supported:boolean;capacity:"unverified";turning:"not-executed"};
export const HANDLING_STATE_TEXT:Record<string,[string,string]>={clear:["保守几何与步骤衔接通过","Conservative geometry and step continuity clear"],blocked:["受阻／衔接失败","Blocked / invalid transition"],unverified:["未核验","Unverified"],"not-executed":["未执行","Not executed"]};
const EPS=.0001;
const num=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=100000;
const obj=(v:unknown)=>{if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Invalid handling task / 搬运任务格式无效");return v as Record<string,unknown>;};
const txt=(v:unknown,max:number)=>{if(typeof v!=="string"||v.length>max)throw Error("Invalid handling text / 搬运任务文字无效");return v;};
const pose=(v:unknown):HandlingPose=>{const p=obj(v);if(![p.x,p.y,p.lift].every(num)||Number(p.lift)<0)throw Error("Invalid handling pose / 搬运姿态无效");return {x:p.x as number,y:p.y as number,lift:p.lift as number};};
const same=(a:HandlingPose,b:HandlingPose)=>["x","y","lift"].every(k=>Math.abs(a[k as keyof HandlingPose]-b[k as keyof HandlingPose])<=EPS);
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
/** Explicitly select fields; imported computed results are discarded. Missing measured values remain null. */
export function parseHandlingTasks(value:unknown):HandlingTask[]|undefined{
 if(value===undefined)return undefined;if(!Array.isArray(value)||value.length>32)throw Error("At most 32 handling tasks / 搬运任务最多 32 个");const units=new Set<string>();
 const tasks=value.map(raw=>{const v=obj(raw),e=obj(v.equipment),s=obj(v.site),unitId=txt(v.unitId,120);
  if(v.version!==1||v.model!==HANDLING_MODEL||!unitId||units.has(unitId)||!["load","unload"].includes(String(v.direction))||!num(v.outsideX)||v.outsideX<0||!Array.isArray(v.steps)||v.steps.length>16)throw Error("Invalid handling version or identity / 搬运任务版本或标识无效");units.add(unitId);
  const equipment={...emptyEquipmentTask().equipment,name:txt(e.name,100),source:txt(e.source,500),revision:txt(e.revision,120)};
  for(const k of EQUIPMENT_FIELDS){const n=e[k];if(n!==null&&(!num(n)||n<0))throw Error("Invalid equipment dimensions / 设备尺寸无效");equipment[k]=n as number|null;}
  const site={...emptyEquipmentTask().site,source:txt(s.source,500),revision:txt(s.revision,120)};
  for(const k of SITE_FIELDS){const n=s[k];if(n!==null&&(!num(n)||!["outsideLeft","outsideFloor"].includes(k)&&n<0))throw Error("Invalid site dimensions / 现场尺寸无效");site[k]=n as number|null;}
  const ids=new Set<string>(),steps=v.steps.map(raw=>{const b=obj(raw),id=txt(b.id,80);if(!/^[-a-zA-Z0-9_]{1,80}$/.test(id)||ids.has(id)||!HANDLING_KINDS.includes(b.kind as HandlingKind))throw Error("Invalid step identity / 动作步骤标识无效");ids.add(id);return {id,kind:b.kind as HandlingKind,from:pose(b.from),to:pose(b.to)};});
  const revision=txt(v.revision,120),basis=txt(v.basis,100);if(!revision.trim())throw Error("Task revision is required / 请填写任务版本");
  return {version:1 as const,model:HANDLING_MODEL as typeof HANDLING_MODEL,unitId,revision,direction:v.direction as HandlingTask["direction"],outsideX:v.outsideX,basis,equipment,site,steps};
 });return tasks.length?tasks:undefined;
}
/** Non-security bookmark. Every geometry and state check still runs against current inputs. */
export function handlingBasis(plan:PackingResult,task:Pick<HandlingTask,"unitId"|"equipment"|"site"|"direction"|"outsideX">){
 const p=plan.pallets?.find(p=>p.id===task.unitId),cfg=p&&forkConfigForPallet(plan,p);
 let fork="";try{if(cfg)fork=forkEvidenceKey(cfg);}catch{fork="invalid";}
 const data=JSON.stringify(stable([HANDLING_MODEL,plan.workflow,plan.container,plan.clearance,plan.strategy,fork,plan.pallets?.map(p=>[p.id,p.x,p.y,p.z,p.dx,p.dy,p.dz,p.orientation,p.enclosureHeight,p.weight]),plan.placements.map(b=>[b.id,b.productId,b.x,b.y,b.z,b.dx,b.dy,b.dz,b.weight,b.palletIds]),task.unitId,task.equipment,task.site,task.direction,task.outsideX]));
 let a=2166136261,b=5381;for(let i=0;i<data.length;i++){a=Math.imul(a^data.charCodeAt(i),16777619);b=Math.imul(b,33)^data.charCodeAt(i);}return `v1-${(a>>>0).toString(16).padStart(8,"0")}${(b>>>0).toString(16).padStart(8,"0")}`;
}
export function rearForkEntry(plan:PackingResult,id:string){const p=plan.pallets?.find(p=>p.id===id),f=p&&forkConfigForPallet(plan,p)?.forkInterface;return !!(p&&f&&(p.orientation==="LWH"?f.direction==="x-max":f.direction==="y-max"));}
function floorSupport(plan:PackingResult,id:string,offset:HandlingPose,site:EquipmentTask["site"]){
 const p=plan.pallets?.find(p=>p.id===id);if(!p||p.z!==0||Math.abs(offset.lift)>EPS)return false;
 const x=p.x+plan.clearance+offset.x,y=p.y+plan.clearance+offset.y,c=plan.container;
 if(x>=-EPS&&x+p.dx<=c.length+EPS&&y>=-EPS&&y+p.dy<=c.width+EPS)return true;
 return !!(site.source.trim()&&site.revision.trim()&&site.outsideFloor===0&&[site.outsideLength,site.outsideLeft,site.outsideWidth,site.outsideHeight].every(num)&&site.outsideLength!>0&&site.outsideWidth!>0&&site.outsideHeight!>0&&x>=c.length-EPS&&x+p.dx<=c.length+site.outsideLength!+EPS&&y>=site.outsideLeft!-EPS&&y+p.dy<=site.outsideLeft!+site.outsideWidth!+EPS);
}
export function buildHandlingTask(plan:PackingResult,id:string,input:{equipment:EquipmentTask["equipment"];site:EquipmentTask["site"];revision:string;direction:"load"|"unload";outsideX:number;lift:number;approach:number;exit:number}):HandlingTask{
 const e=parseEquipmentTemplate(input.equipment),p=plan.pallets?.find(p=>p.id===id),f=p&&forkConfigForPallet(plan,p)?.forkInterface;
 if(!p||!f||![input.outsideX,input.lift,input.approach,input.exit].every(num)||Math.min(input.outsideX,input.approach,input.exit)<0||input.lift<=0||!input.revision.trim())throw Error("Complete task dimensions, fork data and revision / 请补全任务尺寸、叉具资料与版本");
 const outside=input.outsideX-p.x-plan.clearance,initial=input.direction==="load"?outside:0,dest=input.direction==="load"?0:outside,d=f.insertionDepth+f.withdrawalClearance+e.clearance!;
 const at=(x:number,lift=0):HandlingPose=>({x,y:0,lift});
 const points=[at(initial+d+input.approach),at(initial+d),at(initial),at(initial,input.lift),at(dest,input.lift),at(dest),at(dest+d),at(dest+d+input.exit)];
 const task:HandlingTask={version:1,model:HANDLING_MODEL,unitId:id,revision:input.revision,direction:input.direction,outsideX:input.outsideX,equipment:{...e},site:{...input.site},basis:"",steps:HANDLING_KINDS.map((kind,i)=>({id:`step-${i+1}`,kind,from:points[i],to:points[i+1]}))};task.basis=handlingBasis(plan,task);return parseHandlingTasks([task])![0];
}
export function inspectHandlingSequence(plan:PackingResult,raw:HandlingTask):HandlingSequenceCheck{
 const zero={x:0,y:0,lift:0},out:HandlingSequenceCheck={state:"unverified",issues:[],steps:[],unitPose:{...zero},connected:false,supported:false,capacity:"unverified",turning:"not-executed"};
 let task:HandlingTask;try{task=parseHandlingTasks([raw])![0];}catch{out.issues.push("sequence");return out;}
 const p=plan.pallets?.find(p=>p.id===task.unitId),f=p&&forkConfigForPallet(plan,p)?.forkInterface,outside=p?task.outsideX-p.x-plan.clearance:0;
 out.unitPose={x:task.direction==="load"?outside:0,y:0,lift:0};
 const dest={x:task.direction==="load"?0:outside,y:0,lift:0};
 if(!p||!f||p.z!==0||!rearForkEntry(plan,task.unitId)||plan.workflow==="pallet-only"||plan.container.loadingAccess==="open"||task.outsideX<plan.container.length-EPS)out.issues.push("scope");
 if(task.basis!==handlingBasis(plan,task))out.issues.push("basis");
 if(task.steps.length!==7||task.steps.some((s,i)=>s.kind!==HANDLING_KINDS[i]))out.issues.push("sequence");
 out.supported=floorSupport(plan,task.unitId,out.unitPose,task.site);if(!out.supported)out.issues.push("initial-support");
 const d=(f?.insertionDepth??0)+(f?.withdrawalClearance??0)+(task.equipment.clearance??0);let stopped=out.issues.length>0,previous:HandlingPose|undefined;
 const aligned=(v:HandlingPose)=>Math.abs(v.y)<=EPS;
 for(const step of task.steps){
  const row:HandlingStepCheck={id:step.id,kind:step.kind,state:"not-executed",issues:[],connected:out.connected,supported:out.supported};out.steps.push(row);if(stopped)continue;
  const {from,to,kind}=step,unit=out.unitPose,clear=(v:HandlingPose)=>aligned(v)&&v.x>=unit.x+d-EPS&&Math.abs(v.lift)<=EPS;
  if(previous&&!same(previous,from))row.issues.push("continuity");
  if(!aligned(from)||!aligned(to))row.issues.push("alignment");
  if(["approach","exit"].includes(kind)&&(!clear(from)||!clear(to)||out.connected||(kind==="approach"?to.x>from.x+EPS:to.x<from.x-EPS)))row.issues.push("engagement");
  if(kind==="insert"&&(!out.supported||out.connected||!clear(from)||!same(to,unit)))row.issues.push("engagement");
  if(kind==="lift"&&(!out.connected||!out.supported||!same(from,unit)||to.x!==from.x||to.y!==from.y||to.lift<=from.lift+EPS))row.issues.push("engagement");
  if(kind==="transfer"&&(!out.connected||out.supported||!same(from,unit)||from.lift<=EPS||to.lift!==from.lift))row.issues.push("engagement");
  if(kind==="lower"){
   if(!out.connected||out.supported||!same(from,unit)||to.x!==from.x||to.y!==from.y||from.lift<=EPS||to.lift!==0)row.issues.push("engagement");
   if(!same(to,dest))row.issues.push("destination");if(!floorSupport(plan,task.unitId,to,task.site))row.issues.push("support");
  }
  if(kind==="withdraw"&&(!out.connected||!out.supported||!same(from,unit)||!clear(to)))row.issues.push("support");
  if(row.issues.length){row.state="blocked";stopped=true;out.state="blocked";continue;}
  const loaded=["lift","transfer","lower"].includes(kind);
  row.geometry=inspectEquipmentAction(plan,task.unitId,{equipment:task.equipment,site:task.site,action:{mode:loaded?"loaded":"fork-only",from,to}},unit);row.state=row.geometry.state;
  if(row.state!=="clear"){stopped=true;out.state=row.state;continue;}
  if(kind==="insert")out.connected=true;
  if(loaded){out.unitPose={...to};out.supported=kind==="lower";}
  if(kind==="withdraw")out.connected=false;
  row.connected=out.connected;row.supported=out.supported;previous={...to};
 }
 if(!stopped)out.state=!out.connected&&out.supported&&same(out.unitPose,dest)?"clear":"unverified";return out;
}
export function setHandlingTask(plan:PackingResult,task:HandlingTask|undefined,id:string):PackingResult{
 if(task&&task.unitId!==id)throw Error("Task unit mismatch / 任务与整托不符");
 const tasks=plan.handlingTasks?.filter(t=>t.unitId!==id)??[];if(task)tasks.push(parseHandlingTasks([task])![0]);const handlingTasks=parseHandlingTasks(tasks);return {...plan,handlingTasks,strategyPlans:undefined};
}
export function handlingSequenceReport(plan:PackingResult,task:HandlingTask){return {format:"cargo-fit-handling-sequence",version:1,model:HANDLING_MODEL,planId:plan.id,engineVersion:plan.engineVersion,checkedAt:new Date().toISOString(),task:parseHandlingTasks([task])![0],check:inspectHandlingSequence(plan,task),plan:{...plan,strategyPlans:undefined},scope:"Fixed-heading rear transfer on modeled level floors only. Capacity, wheel pressure, dynamic stability and field authorization remain unverified; turning not executed."};}
