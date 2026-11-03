import {restorePackingSnapshot} from "./engine";
import {parsePalletBuild} from "./loading-workflow";
import {looseReservationErrors} from "./loose-cargo";
import {normalizedSetCode,normalizedUnitsPerSet} from "./set-utils";
import {improvesPalletTrial} from "./pallet-capacity";
import type {OrderCapacityTrial} from "./order-capacity";
import type {PackingRequest,PackingResult,ProductInput} from "./types";

export const TAIL_CARTON_BUDGET=64;
export const TAIL_CANDIDATE_LIMIT=5;
export const TAIL_JOINT_CANDIDATE_LIMIT=64;
export type TailSearchMode="quick"|"detailed"|"joint"|"triple"|"quad";
export type TailCandidate={trial:OrderCapacityTrial;plan:PackingResult};
export type TailCargoGroup={id:string;name:string;products:ProductInput[];cartonsPerUnit:number;availableUnits:number};

/** Display ledger after independent candidate review; counts actual source-row placements. */
export function tailCandidateRows(request:PackingRequest,baseline:PackingResult,candidate:PackingResult){
 const count=(plan:PackingResult)=>{const rows=new Map<string,{loose:number;palletized:number}>();for(const box of plan.placements){const n=rows.get(box.productId)??{loose:0,palletized:0};if(box.palletIds?.length)n.palletized++;else n.loose++;rows.set(box.productId,n);}return rows;};
 const before=count(baseline),after=count(candidate),skus=new Map<string,number>();for(const p of request.products)skus.set(p.sku,(skus.get(p.sku)??0)+1);
 return request.products.map(p=>{const a=before.get(p.id),b=after.get(p.id),loose=b?.loose??0,palletized=b?.palletized??0;return {id:p.id,label:(skus.get(p.sku)??0)>1?`${p.sku} [${p.id}]`:p.sku,requested:p.quantity,beforeLoaded:(a?.loose??0)+(a?.palletized??0),loaded:loose+palletized,beforeReserved:baseline.palletBuild?.looseQuantities?.[p.id]??0,reserved:candidate.palletBuild?.looseQuantities?.[p.id]??0,loose,palletized,unloaded:p.quantity-loose-palletized};});
}

/** Whole kits are one decision; no component can be silently diverted alone. */
export function tailCargoGroups(request:PackingRequest,plan?:PackingResult|null):TailCargoGroup[]{
 if(request.mode!=="mixed"||request.workflow!=="palletized"||!plan?.validation.valid)return [];
 const build=parsePalletBuild(request.palletBuild),groups=new Map<string,ProductInput[]>(),unloaded=new Map(plan.summaries.map(s=>[s.productId,s.unloaded])),skuCounts=new Map<string,number>();
 for(const p of request.products){const code=normalizedSetCode(p),id=code?`kit:${code}`:`row:${p.id}`;groups.set(id,[...groups.get(id)??[],p]);skuCounts.set(p.sku,(skuCounts.get(p.sku)??0)+1);}
 return [...groups].flatMap(([id,products])=>{
  if(products.some(p=>p.cargoType&&!["carton","loose"].includes(p.cargoType)))return [];
  const cartonsPerUnit=products.reduce((n,p)=>n+(normalizedSetCode(p)?normalizedUnitsPerSet(p):1),0);
  const availableUnits=Math.min(Math.floor(TAIL_CARTON_BUDGET/cartonsPerUnit),...products.map(p=>{
   const units=normalizedSetCode(p)?normalizedUnitsPerSet(p):1;
   return Math.min(Math.floor((p.quantity-(build.looseQuantities?.[p.id]??0))/units),Math.floor((unloaded.get(p.id)??0)/units));
  }));
  const first=products[0],name=normalizedSetCode(first)||((skuCounts.get(first.sku)??0)>1?`${first.sku} [${first.id}]`:first.sku);
  return availableUnits>0?[{id,name,products,cartonsPerUnit,availableUnits}]:[];
 });
}

/** Rebuild preview only. Existing reservations are a floor, never extra stock. */
function checkedTailBaseline(request:PackingRequest,baseline:PackingResult){
 const total=request.products.reduce((n,p)=>n+p.quantity,0);
 if(total<1||total>4000)throw Error("尾数试算支持 1–4000 箱订单 / Tail trials support orders of 1–4000 cartons");
 if(baseline.workflow!=="palletized"||baseline.strategy!==(request.strategy??"practical")||JSON.stringify(parsePalletBuild(baseline.palletBuild))!==JSON.stringify(parsePalletBuild(request.palletBuild)))throw Error("原方案与当前打托输入不一致 / Baseline and current packaging input differ");
 if(baseline.pallets?.some(p=>p.measuredEnvelope||p.locked))throw Error("实测或锁定整托不能参与重新打托 / Measured or locked units cannot be rebuilt");
 const reviewed=restorePackingSnapshot(request,baseline);
 if(!reviewed.validation.valid)throw Error("原方案未通过复核 / Baseline failed validation");
 return {total,groups:tailCargoGroups(request,reviewed)};
}

function selectedTailGroup(groups:TailCargoGroup[],groupId:string,limit:number){
 if(!Number.isSafeInteger(limit)||limit<1||limit>TAIL_CARTON_BUDGET)throw Error("尾数上限须为 1–64 的整数 / Tail limit must be an integer from 1 to 64");
 const group=groups.find(g=>g.id===groupId);
 if(!group||limit>group.availableUnits)throw Error("尾数超过剩余订单或完整套装上限 / Tail exceeds remaining demand or complete-kit limits");
 return group;
}

function tailTrial(request:PackingRequest,total:number,rows:{group:TailCargoGroup;units:number}[],joint=false):OrderCapacityTrial{
 const next=structuredClone(request),build=parsePalletBuild(next.palletBuild),before=build.looseQuantities??{},allocation={...before};
 const changes=rows.flatMap(({group,units})=>units?group.products.map(p=>{const from=before[p.id]??0,to=from+units*(normalizedSetCode(p)?normalizedUnitsPerSet(p):1);allocation[p.id]=to;return {id:p.id,sku:p.sku,from,to};}):[]);
 const errors=looseReservationErrors(allocation,request.products);if(errors.length)throw Error(errors.join("; "));
 next.palletBuild={...build,looseQuantities:allocation};next.strategy=request.strategy??"practical";next.singleCartonLimit=undefined;
 return {request:next,arithmeticCartons:total,budgetLimited:false,tailReservationChange:{groupId:rows[0].group.id,units:rows.reduce((n,r)=>n+r.units,0),changes,...(joint?{groups:rows.map(r=>({id:r.group.id,name:r.group.name,units:r.units}))}:{})}};
}

export function preparePalletTailTrials(request:PackingRequest,baseline:PackingResult,groupId:string,limit:number,mode:Exclude<TailSearchMode,"joint"|"triple"|"quad">="quick"):OrderCapacityTrial[]{
 if(mode!=="quick"&&mode!=="detailed")throw Error("尾数搜索范围无效 / Invalid tail search mode");
 const {total,groups}=checkedTailBaseline(request,baseline),group=selectedTailGroup(groups,groupId,limit);
 const amounts=mode==="detailed"?Array.from({length:limit},(_,i)=>i+1):[...new Set([1,2,4,8,limit].filter(n=>n<=limit))].sort((a,b)=>a-b).slice(0,TAIL_CANDIDATE_LIMIT);
 return amounts.map(units=>tailTrial(request,total,[{group,units}]));
}

/** Complete two/three/four-group grid, including one-sided trials; reject oversized grids. */
export function prepareJointPalletTailTrials(request:PackingRequest,baseline:PackingResult,selections:readonly {groupId:string;limit:number}[]):OrderCapacityTrial[]{
 if(![2,3,4].includes(selections.length)||new Set(selections.map(s=>s.groupId)).size!==selections.length)throw Error("请选择两到四个不同的订单行或套装 / Select two to four distinct order rows or kits");
 const {total,groups}=checkedTailBaseline(request,baseline),selected=selections.map(s=>({...s,group:selectedTailGroup(groups,s.groupId,s.limit)}));
 if(selected.reduce((n,s)=>n*(s.limit+1),1)-1>TAIL_JOINT_CANDIDATE_LIMIT)throw Error("联合候选超过 64 个，请降低各组上限 / Joint grid exceeds 64 candidates; reduce the group ceilings");
 const allocations:{units:number[];cartons:number}[]=[];
 const visit=(index:number,units:number[],cartons:number)=>{
  if(index===selected.length){if(cartons>0)allocations.push({units,cartons});return;}
  for(let n=0;n<=selected[index].limit;n++){const next=cartons+n*selected[index].group.cartonsPerUnit;if(next<=TAIL_CARTON_BUDGET)visit(index+1,[...units,n],next);}
 };
 visit(0,[],0);
 return allocations.sort((a,b)=>a.cartons-b.cartons||a.units.reduce((diff,n,i)=>diff||n-b.units[i],0)).map(a=>tailTrial(request,total,selected.map((s,i)=>({group:s.group,units:a.units[i]})),true));
}

/** Tied totals keep the smallest reservation, not an arbitrary later allocation. */
export function betterTailCandidate(candidate:TailCandidate,baseline:PackingResult,best?:TailCandidate){
 if(!improvesPalletTrial(candidate.plan,baseline))return false;
 if(!best||candidate.plan.metrics.loadedCount>best.plan.metrics.loadedCount)return true;
 const reserved=(c:TailCandidate)=>Object.values(c.trial.request.palletBuild?.looseQuantities??{}).reduce((n,v)=>n+v,0);
 return candidate.plan.metrics.loadedCount===best.plan.metrics.loadedCount&&reserved(candidate)<reserved(best);
}
