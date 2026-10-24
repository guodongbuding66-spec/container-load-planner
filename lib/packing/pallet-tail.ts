import {restorePackingSnapshot} from "./engine";
import {parsePalletBuild} from "./loading-workflow";
import {looseReservationErrors} from "./loose-cargo";
import {normalizedSetCode,normalizedUnitsPerSet} from "./set-utils";
import type {OrderCapacityTrial} from "./order-capacity";
import type {PackingRequest,PackingResult,ProductInput} from "./types";

export const TAIL_CARTON_BUDGET=64;
export const TAIL_CANDIDATE_LIMIT=5;
export type TailCargoGroup={id:string;name:string;products:ProductInput[];cartonsPerUnit:number;availableUnits:number};

/** Whole kits are one decision; no component can be silently diverted alone. */
export function tailCargoGroups(request:PackingRequest,plan?:PackingResult|null):TailCargoGroup[]{
 if(request.mode!=="mixed"||request.workflow!=="palletized"||!plan?.validation.valid)return [];
 const build=parsePalletBuild(request.palletBuild),groups=new Map<string,ProductInput[]>(),unloaded=new Map(plan.summaries.map(s=>[s.productId,s.unloaded]));
 for(const p of request.products){const code=normalizedSetCode(p),id=code?`kit:${code}`:`row:${p.id}`;groups.set(id,[...groups.get(id)??[],p]);}
 return [...groups].flatMap(([id,products])=>{
  if(products.some(p=>p.cargoType&&!["carton","loose"].includes(p.cargoType)))return [];
  const cartonsPerUnit=products.reduce((n,p)=>n+(normalizedSetCode(p)?normalizedUnitsPerSet(p):1),0);
  const availableUnits=Math.min(Math.floor(TAIL_CARTON_BUDGET/cartonsPerUnit),...products.map(p=>{
   const units=normalizedSetCode(p)?normalizedUnitsPerSet(p):1;
   return Math.min(Math.floor((p.quantity-(build.looseQuantities?.[p.id]??0))/units),Math.floor((unloaded.get(p.id)??0)/units));
  }));
  return availableUnits>0?[{id,name:normalizedSetCode(products[0])||products[0].sku,products,cartonsPerUnit,availableUnits}]:[];
 });
}

/** Rebuild preview only. Existing reservations are a floor, never extra stock. */
export function preparePalletTailTrials(request:PackingRequest,baseline:PackingResult,groupId:string,limit:number):OrderCapacityTrial[]{
 const total=request.products.reduce((n,p)=>n+p.quantity,0);
 if(total<1||total>4000)throw Error("尾数试算支持 1–4000 箱订单 / Tail trials support orders of 1–4000 cartons");
 if(!Number.isSafeInteger(limit)||limit<1||limit>TAIL_CARTON_BUDGET)throw Error("尾数上限须为 1–64 的整数 / Tail limit must be an integer from 1 to 64");
 if(baseline.workflow!=="palletized"||baseline.strategy!==(request.strategy??"practical")||JSON.stringify(parsePalletBuild(baseline.palletBuild))!==JSON.stringify(parsePalletBuild(request.palletBuild)))throw Error("原方案与当前打托输入不一致 / Baseline and current packaging input differ");
 if(baseline.pallets?.some(p=>p.measuredEnvelope||p.locked))throw Error("实测或锁定整托不能参与重新打托 / Measured or locked units cannot be rebuilt");
 const reviewed=restorePackingSnapshot(request,baseline);
 if(!reviewed.validation.valid)throw Error("原方案未通过复核 / Baseline failed validation");
 const group=tailCargoGroups(request,reviewed).find(g=>g.id===groupId);
 if(!group||limit>group.availableUnits)throw Error("尾数超过剩余订单或完整套装上限 / Tail exceeds remaining demand or complete-kit limits");
 const amounts=[...new Set([1,2,4,8,limit].filter(n=>n<=limit))].sort((a,b)=>a-b).slice(0,TAIL_CANDIDATE_LIMIT);
 return amounts.map(units=>{
  const next=structuredClone(request),build=parsePalletBuild(next.palletBuild),before=build.looseQuantities??{},allocation={...before};
  const changes=group.products.map(p=>{const from=before[p.id]??0,to=from+units*(normalizedSetCode(p)?normalizedUnitsPerSet(p):1);allocation[p.id]=to;return {id:p.id,sku:p.sku,from,to};});
  const errors=looseReservationErrors(allocation,request.products);if(errors.length)throw Error(errors.join("; "));
  next.palletBuild={...build,looseQuantities:allocation};next.strategy=request.strategy??"practical";next.singleCartonLimit=undefined;
  return {request:next,arithmeticCartons:total,budgetLimited:false,tailReservationChange:{groupId,units,changes}};
 });
}
