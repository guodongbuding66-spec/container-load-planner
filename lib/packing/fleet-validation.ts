import {orderDelivery} from "./order-lines";
import {parseAccessConfig} from "./maneuver";
import {assertValidRequest,restorePackingSnapshot} from "./engine";
import {auditPackingResult} from "./result-audit";
import {fleetPool,frozenFleetRequest} from "./fleet-inventory";
import {fleetCosts,parseFleetPricing,requireFleetQuotes,type FleetPricing} from "./fleet-costs";
import type {PackingRequest} from "./types";
import type {FleetOption,FleetResult} from "./fleet";
export function fleetCanonical(v:unknown):string{
 if(v===undefined)return "";if(Array.isArray(v))return `[${v.map(fleetCanonical).join(",")}]`;
 if(v&&typeof v==="object")return `{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${fleetCanonical(x)}`).join(",")}}`;
 return JSON.stringify(v)??"";
}
export function assertFleetSettings(request:PackingRequest,options:FleetOption[],limit:number,objective:"count"|"cost",pricing?:FleetPricing){
 assertValidRequest(request);fleetPool(request);parseFleetPricing(pricing,request);
 if(!Array.isArray(options)||!options.length||options.length>50||!Number.isInteger(limit)||limit<1||limit>50||!["count","cost"].includes(objective))throw Error("请选择柜型，柜数上限为 1–50 / Select vehicles and a limit of 1–50");
 if(new Set(options.map(o=>o.container.id)).size!==options.length)throw Error("候选柜型标识不能重复 / Duplicate fleet vehicle identifier");
 for(const o of options){if(!Number.isFinite(o.cost)||o.cost<0||o.cost>1e9||!Number.isInteger(o.available)||o.available<1||o.available>50)throw Error("运费或可用柜数无效 / Invalid freight or vehicle availability");assertValidRequest({...request,container:o.container});}
 if(objective==="cost"){if(options.some(o=>o.cost<=0))throw Error("费用优先需要填写实际运费 / Cost priority requires quoted freight");requireFleetQuotes(request,pricing);}
}
/** Rebuild every container using the original order and the remaining shared inventory. */
export function validateFleet(request:PackingRequest,result:FleetResult,options:FleetOption[],limit=50){
 const errors:string[]=[];try{
  assertFleetSettings(request,options,limit,"count",result.pricing);
  if(!Array.isArray(result.loads)||result.loads.length>limit)throw Error("多柜数量超限 / Fleet container limit exceeded");
  const issued=new Set<string>(),counts=new Map<string,number>(),prefix:FleetResult["loads"]=[];let freeStarted=false;
  for(const l of result.loads){
   const o=options.find(o=>o.container.id===l.plan.container.id);if(!o||l.cost!==o.cost||fleetCanonical(l.plan.container)!==fleetCanonical(o.container))throw Error("柜型或运费与候选设置不一致 / Vehicle or freight differs from fleet settings");
   counts.set(o.container.id,(counts.get(o.container.id)??0)+1);if(counts.get(o.container.id)!>o.available)throw Error("跨柜柜型库存超限 / Vehicle availability exceeded");
   const committed=l.frozen!==undefined;
   if(committed&&freeStarted)throw Error("已装柜必须是连续前缀 / Committed containers must form one contiguous prefix");
   if(!committed)freeStarted=true;
   const context=committed?frozenFleetRequest(request,l.frozen):request,pool=fleetPool(context,prefix),local={...pool.request,container:o.container};
   const restored=restorePackingSnapshot(local,l.plan);
   const identity=restored.deliveryIdentity;
   if(identity)for(const id of [identity.planId,identity.revisionId,...identity.units.map(unit=>unit.unitId),...identity.withdrawn.map(unit=>unit.unitId)]){
    if(issued.has(id))throw Error("跨柜交付或箱托编号重复 / Duplicate fleet delivery or unit identifier");
    issued.add(id);
   }
   if(fleetCanonical(l.plan.delivery)!==fleetCanonical(orderDelivery(request.products,request.delivery))||fleetCanonical(l.plan.accessConfig)!==fleetCanonical(parseAccessConfig(request.accessConfig)))throw Error("站次或路径输入不一致 / Delivery or access inputs disagree");
   if(restored.metrics.loadedCount<1||restored.workflow!==pool.request.workflow||request.strategy!==undefined&&restored.strategy!==request.strategy||!l.plan.validation.valid||auditPackingResult(l.plan,local.products).hasErrors)throw Error("单柜方案未通过同源校验 / A container failed source-bound validation");
   if(restored.metrics.loadedCount!==l.plan.metrics.loadedCount||Math.abs(restored.metrics.grossWeight-l.plan.metrics.grossWeight)>.0001)throw Error("单柜数量或重量不一致 / Container counts or weight disagree");
   prefix.push(l);
  }
  const pool=fleetPool(request,prefix),costs=fleetCosts(prefix,result.pricing);
  if(fleetCanonical(result.remaining)!==fleetCanonical(pool.products)||result.complete!==pool.products.every(p=>p.quantity===0))throw Error("整单余货或完成状态不一致 / Fleet remaining quantities disagree");
  if(!Number.isFinite(result.totalCost)||Math.abs(result.totalCost-costs.freight)>.0001||fleetCanonical(result.costs)!==fleetCanonical(costs)||fleetCanonical(result.inventory)!==fleetCanonical(pool.inventory))throw Error("库存或费用汇总不一致 / Fleet inventory or cost summary disagrees");
 }catch(e){errors.push(e instanceof Error?e.message:String(e));}
 return {valid:errors.length===0,errors};
}
