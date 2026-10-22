import {deliveryIdentityState} from "./delivery-identity";
import {plannedWeightBreakdown} from "./weighing";
import {palletEnvelopeTop} from "./deck-support";
import {siteExclusionBoxes} from "./site-exclusions";
import {intersects} from "./free-space";
import {modelMassCenter} from "./model-body";
import {packagingMassCenter} from "./packaging";
import {accessoryMassBoxes} from "./container-accessories";
import type {PackingResult} from "./types";
const EPS=.0001;
const fail=()=>Error("工程复核资料无效，请检查方案、数值、来源与日期 / Invalid engineering review: check plan, values, source and date");
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw fail();return v as Record<string,unknown>;}
function num(v:unknown,min=0,max=1e6){if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)throw fail();return v;}
function text(v:unknown,max=500){if(typeof v!=="string"||!v.trim()||v.length>max)throw fail();return v.trim();}
function date(v:unknown){const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw fail();return s;}
function complete(plan:PackingResult){if(!plan.validation.valid||plan.workflow==="pallet-only"||plan.metrics.loadedCount!==plan.placements.length||!plannedWeightBreakdown(plan).consistent)throw fail();}
export type AxleProfile={model:"rigid-two-supports";name:string;wheelbaseMm:number;containerNoseMm:number;frontEmptyKg:number;rearEmptyKg:number;frontLimitKg:number|null;rearLimitKg:number|null;grossLimitKg:number|null;payloadCenterFromNoseMm?:number|null;source:string;date:string};
export function parseAxleProfile(value:unknown):AxleProfile{
 const v=obj(value);if(v.model!=="rigid-two-supports")throw Error("只支持刚性两支点静态模型 / Only the rigid two-support static model is supported");
 const cap=(x:unknown)=>x===null?null:num(x,1);
 return {model:"rigid-two-supports",name:text(v.name,120),wheelbaseMm:num(v.wheelbaseMm,1,100000),containerNoseMm:num(v.containerNoseMm,-100000,100000),frontEmptyKg:num(v.frontEmptyKg),rearEmptyKg:num(v.rearEmptyKg),frontLimitKg:cap(v.frontLimitKg),rearLimitKg:cap(v.rearLimitKg),grossLimitKg:cap(v.grossLimitKg),...(v.payloadCenterFromNoseMm!==undefined?{payloadCenterFromNoseMm:v.payloadCenterFromNoseMm===null?null:num(v.payloadCenterFromNoseMm,0,100000)}:{}),source:text(v.source),date:date(v.date)};
}
/** Planned mass only; visual zero-weight surrogates must never enter a force balance. */
export function axleReactions(plan:PackingResult,value:unknown){
 complete(plan);const p=parseAxleProfile(value),w=plannedWeightBreakdown(plan);
 if(p.payloadCenterFromNoseMm!=null&&p.payloadCenterFromNoseMm>plan.container.length)throw fail();
 const masses=[...plan.placements.map(b=>({mass:b.weight,x:modelMassCenter(b,plan.cargoDetails?.[b.productId]??{})[0]})),...(plan.pallets??[]).map(b=>({mass:b.weight,x:packagingMassCenter(b)[0]})),...accessoryMassBoxes(plan.container,plan.clearance).map(b=>({mass:b.weight,x:b.x+b.dx/2}))];
 if(masses.some(b=>!Number.isFinite(b.mass)||b.mass<0||!Number.isFinite(b.x)))throw fail();
 const mass=masses.reduce((n,b)=>n+b.mass,0);if(Math.abs(mass-w.payloadKg)>EPS)throw fail();
 const center=p.payloadCenterFromNoseMm??(mass?masses.reduce((n,b)=>n+b.mass*b.x,0)/mass+plan.clearance:0),cargoCenterMm=p.containerNoseMm+center;
 const rearCargoKg=mass*cargoCenterMm/p.wheelbaseMm,frontCargoKg=mass-rearCargoKg,frontKg=p.frontEmptyKg+frontCargoKg,rearKg=p.rearEmptyKg+rearCargoKg,grossKg=mass+p.frontEmptyKg+p.rearEmptyKg;
 const excess=(kg:number,cap:number|null)=>cap===null?null:Math.max(0,kg-cap),frontExcessKg=excess(frontKg,p.frontLimitKg),rearExcessKg=excess(rearKg,p.rearLimitKg),grossExcessKg=excess(grossKg,p.grossLimitKg),uplift=frontKg< -EPS||rearKg< -EPS;
 const state=uplift||[frontExcessKg,rearExcessKg,grossExcessKg].some(n=>n!==null&&n>EPS)?"fail":[p.frontLimitKg,p.rearLimitKg,p.grossLimitKg].some(n=>n===null)?"unverified":"pass";
 return {state,payloadKg:mass,frontCargoKg,rearCargoKg,frontKg,rearKg,grossKg,cargoCenterMm,centerSource:p.payloadCenterFromNoseMm==null?"geometry":"declared",frontExcessKg,rearExcessKg,grossExcessKg,uplift,massResidualKg:frontKg+rearKg-grossKg};
}
export type UnitMeasurement={palletId:string;length:number;width:number;height:number;noseProtrusion:number;leftProtrusion:number;extraWeightKg:number;weightIncluded:boolean;source:string;date:string};
export function parseUnitMeasurement(plan:PackingResult,value:unknown):UnitMeasurement{
 const v=obj(value);if(!plan.palletization||typeof v.palletId!=="string"||!plan.pallets?.some(p=>p.id===v.palletId)||typeof v.weightIncluded!=="boolean")throw fail();
 return {palletId:v.palletId,length:num(v.length,1,100000),width:num(v.width,1,100000),height:num(v.height,1,100000),noseProtrusion:num(v.noseProtrusion,0,10000),leftProtrusion:num(v.leftProtrusion,0,10000),extraWeightKg:num(v.extraWeightKg,0,100000),weightIncluded:v.weightIncluded,source:text(v.source),date:date(v.date)};
}
/** Conservative union: a smaller reading cannot erase the committed cargo envelope. */
export function reviewUnitMeasurements(plan:PackingResult,values:unknown[]){
 complete(plan);if(!plan.palletization||values.length>200)throw fail();
 const readings=values.map(v=>parseUnitMeasurement(plan,v));if(new Set(readings.map(r=>r.palletId)).size!==readings.length)throw fail();
 const units=(plan.pallets??[]).map(p=>{const r=readings.find(v=>v.palletId===p.id),x=p.x-(r?.noseProtrusion??0),y=p.y-(r?.leftProtrusion??0),nominalHeight=palletEnvelopeTop(p,plan.placements.filter(b=>b.palletIds?.includes(p.id)))-p.z;
  return {id:p.id,x,y,z:p.z,dx:Math.max(p.x+p.dx,x+(r?.length??p.dx))-x,dy:Math.max(p.y+p.dy,y+(r?.width??p.dy))-y,dz:Math.max(nominalHeight,r?.height??0),reading:r,gap:plan.palletization?(plan.palletization.specifications?.find(s=>s.id===(p.specificationId??"primary"))?.config??plan.palletization.config).gap??0:0};
 });
 const margins=(u:typeof units[number])=>({nose:u.x,left:u.y,far:plan.container.length-2*plan.clearance-u.x-u.dx,right:plan.container.width-2*plan.clearance-u.y-u.dy,top:plan.container.height-plan.clearance-u.z-u.dz,doorWidth:plan.container.loadingAccess==="open"?Infinity:plan.container.doorWidth-2*plan.clearance-u.dy,doorHeight:plan.container.loadingAccess==="open"?Infinity:plan.container.doorHeight-plan.clearance-u.dz});
 const report=units.map(u=>{const reasons:string[]=[],m=margins(u);if(Object.values(m).some(n=>n< -EPS))reasons.push("boundary-or-door");
  for(const v of units.filter(v=>v.id!==u.id)){if(intersects(u,v))reasons.push(`unit:${v.id}`);else if(u.z<v.z+v.dz-EPS&&v.z<u.z+u.dz-EPS){const gx=Math.max(v.x-u.x-u.dx,u.x-v.x-v.dx,0),gy=Math.max(v.y-u.y-u.dy,u.y-v.y-v.dy,0);if(Math.max(gx,gy)<Math.max(u.gap,v.gap)-EPS)reasons.push(`gap:${v.id}`);}}
  for(const b of plan.placements.filter(b=>!b.palletIds?.length))if(intersects(u,b))reasons.push(`loose:${b.id}`);
  for(const b of siteExclusionBoxes(plan.container,plan.clearance))if(intersects(u,b))reasons.push(`region:${b.id}`);
  return {...u,margins:m,reasons,state:reasons.length?"fail":u.reading?"pass":"unverified"};
 });
 const extraKg=readings.reduce((n,r)=>n+(r.weightIncluded?0:r.extraWeightKg),0),plannedPayloadKg=plannedWeightBreakdown(plan).payloadKg,trialPayloadKg=plannedPayloadKg+extraKg,excessKg=Math.max(0,trialPayloadKg-plan.container.maxWeight);
 return {units:report,extraKg,plannedPayloadKg,trialPayloadKg,excessKg,geometryState:excessKg>EPS||report.some(u=>u.state==="fail")?"fail":report.some(u=>u.state==="unverified")?"unverified":"pass"};
}
export type EngineeringDocument={format:"cargo-fit-engineering";version:1;context:{planId:string;revisionId:string;signature:string};axle?:AxleProfile;units:UnitMeasurement[]};
export function emptyEngineeringDocument(plan:PackingResult):EngineeringDocument{
 if(deliveryIdentityState(plan)!=="current")throw fail();complete(plan);const {planId,revisionId,signature}=plan.deliveryIdentity!;return {format:"cargo-fit-engineering",version:1,context:{planId,revisionId,signature},units:[]};
}
export function engineeringKey(plan:PackingResult){const c=emptyEngineeringDocument(plan).context;return `cargo-fit-engineering-v1/${c.planId}/${c.revisionId}`;}
export function parseEngineeringDocument(plan:PackingResult,contents:string):EngineeringDocument{
 if(new TextEncoder().encode(contents).length>2*1024*1024)throw fail();
 const v=obj(JSON.parse(contents)),expected=emptyEngineeringDocument(plan),c=obj(v.context);
 if(v.format!==expected.format||v.version!==1||c.planId!==expected.context.planId||c.revisionId!==expected.context.revisionId||c.signature!==expected.context.signature||!Array.isArray(v.units)||v.units.length>200)throw fail();
 const units=v.units.map(r=>parseUnitMeasurement(plan,r));if(new Set(units.map(r=>r.palletId)).size!==units.length)throw fail();
 if(units.length)reviewUnitMeasurements(plan,units);
 const axle=v.axle===undefined?undefined:parseAxleProfile(v.axle);if(axle)axleReactions(plan,axle);
 return {...expected,units,...(axle?{axle}:{})};
}
