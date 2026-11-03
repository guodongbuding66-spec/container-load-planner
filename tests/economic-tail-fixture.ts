import {economicTailFixture} from "./pallet-tail-fixture";
import {preparePalletTailTrials,betterTailCandidate,type TailCandidate} from "../lib/packing/pallet-tail";
import {runOrderCapacityTrial,reviewOrderCapacityTrial} from "../lib/packing/order-capacity";
import {captureTailCostBasis} from "../lib/packing/tail-cost-table";
import type {TailReportInput} from "../lib/packing/pallet-tail-report";

export const economicQuote={freight:100,pricing:{currency:"CNY",packaging:{primary:20}}};
export function economicTailBatch(mode:"detailed"|"quick"="detailed"):TailReportInput{
 const {request,baseline}=economicTailFixture();let best:TailCandidate|undefined;
 const trials=preparePalletTailTrials(request,baseline,"row:a",6,mode),rows=trials.map(trial=>{
  const plan=reviewOrderCapacityTrial(trial,runOrderCapacityTrial(trial));if(betterTailCandidate({trial,plan},baseline,best))best={trial,plan};
  return {units:trial.tailReservationChange!.units,groups:[{id:"row:a",name:"TAIL-A",units:trial.tailReservationChange!.units}],loaded:plan.metrics.loadedCount,retained:true,costBasis:captureTailCostBasis(request,plan)};
 });
 return {request,baseline,rows,best,mode,canApply:true,groups:[{id:"row:a",name:"TAIL-A",limit:6,cartonsPerUnit:1}]};
}
