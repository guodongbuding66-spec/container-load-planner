import {calculateReverseCounts,restorePackingSnapshot} from "./engine";
import {packLoadingWorkflow} from "./pack-loading";
import {parseLoadingWorkflow,parsePalletBuild} from "./loading-workflow";
import type {PackingRequest,PackingResult,ProductInput} from "./types";

export const CAPACITY_TRIAL_CARTONS=4000;
export type OrderCapacityTrial={request:PackingRequest;arithmeticCartons:number;budgetLimited:boolean;heightChanges?:{id:string;name:string;from:number;to:number}[];packagingSelectionChange?:{from:"ordered";to:"compact"};tailReservationChange?:{groupId:string;units:number;changes:{id:string;sku:string;from:number;to:number}[];groups?:{id:string;name:string;units:number}[]}};

/** Hypothetical stock only. Geometry, ratings, packaging stock and rules stay intact. */
export function prepareOrderCapacityTrial(request:PackingRequest,volume:number,weight:number):OrderCapacityTrial{
 if(request.mode!=="mixed"||!["direct","palletized"].includes(parseLoadingWorkflow(request.workflow,request.mode)))throw Error("仅支持订单装柜试算 / Capacity trials require a direct or palletized order");
 if(!Number.isFinite(volume)||volume<=0||volume>1||!Number.isFinite(weight)||weight<=0||weight>1)throw Error("目标比例无效 / Invalid target ratios");
 const total=request.products.reduce((n,p)=>n+p.quantity,0);
 if(total<=0||total>CAPACITY_TRIAL_CARTONS)throw Error("补货试算支持 1–4000 箱订单；大订单请使用主求解器 / Trials support orders of 1–4000 cartons; use the main solver for larger orders");
 const arithmetic=calculateReverseCounts(request,volume,weight);
 const scale=Math.min(1,CAPACITY_TRIAL_CARTONS/Math.max(1,arithmetic.recommendedTotal));
 const bounded=scale<1?calculateReverseCounts(request,volume*scale,weight*scale):arithmetic;
 const quantities=new Map(bounded.quantities.map(q=>[q.productId,q.suggestedQuantity]));
 const products=request.products.map(p=>({...p,quantity:Math.max(p.quantity,quantities.get(p.id)??0)}));
 if(products.reduce((n,p)=>n+p.quantity,0)>CAPACITY_TRIAL_CARTONS)throw Error("试算箱数超过上限 / Trial carton budget exceeded");
 return {request:{...structuredClone(request),strategy:request.strategy??"practical",delivery:undefined,singleCartonLimit:undefined,products:structuredClone(products)},arithmeticCartons:arithmetic.recommendedTotal,budgetLimited:scale<1};
}

/** Worker output is independently checked against the frozen hypothetical input. */
export function reviewOrderCapacityTrial(trial:OrderCapacityTrial,raw:PackingResult):PackingResult{
 if(raw.strategy!==trial.request.strategy||raw.workflow!==parseLoadingWorkflow(trial.request.workflow,trial.request.mode))throw Error("试算策略或流程不一致 / Trial strategy or workflow mismatch");
 if(trial.request.workflow==="palletized"&&JSON.stringify(parsePalletBuild(raw.palletBuild))!==JSON.stringify(parsePalletBuild(trial.request.palletBuild)))throw Error("试算包装资料已变化 / Trial packaging rules changed");
 const plan=restorePackingSnapshot(trial.request,raw);
 if(!plan.validation.valid)throw Error(plan.validation.errors.join("; "));
 return {...plan,metrics:{...plan.metrics,solveTimeMs:raw.metrics.solveTimeMs},warnings:raw.warnings};
}

export function runOrderCapacityTrial(trial:OrderCapacityTrial){return reviewOrderCapacityTrial(trial,packLoadingWorkflow(trial.request));}

/** A trial can add stock; it cannot erase unmet original order quantities. */
export function replenishedOrder(products:readonly ProductInput[],plan:PackingResult){
 const loaded=new Map(plan.summaries.map(s=>[s.productId,s.loaded]));
 return products.map(p=>({...p,quantity:Math.max(p.quantity,loaded.get(p.id)??0)}));
}
