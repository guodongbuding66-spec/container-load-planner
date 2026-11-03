import {buildTailTrialReport,type TailReportInput} from "./pallet-tail-report";
import {buildTailCostReport,buildTailCostCsv} from "./pallet-tail-costs";
import {parseTailCostQuote,type TailCostQuote} from "./tail-cost-quote";
import {captureTailCostBasis,priceTailCandidates,tailAllocationKey} from "./tail-cost-table";
import {preparePalletTailTrials,prepareJointPalletTailTrials} from "./pallet-tail";
import {reviewOrderCapacityTrial} from "./order-capacity";
import {toCsvCell} from "./csv";
import type {PackingResult} from "./types";

/** Choose only within a complete reviewed batch with identical source-row delivery. */
export function prepareEconomicTailTrial(input:TailReportInput,value:TailCostQuote){
 const report=buildTailTrialReport(input),best=input.best;
 if(!best||!report.selectedCandidate)throw Error("需要完整数量候选 / A complete quantity candidate is required");
 const quote=parseTailCostQuote(value,input.request),groups=best.trial.tailReservationChange!.groups??[{id:input.groups[0].id,units:best.trial.tailReservationChange!.units}];
 const table=priceTailCandidates(input.request,input.baseline,best.plan,input.rows,quote,groups);
 if(!table.canRank)throw Error("同量候选不足或报价、用量不完整 / Equal-delivery candidates or complete quotes and usage are missing");
 const current=table.rows.find(r=>r.current)!,choices=table.rows.filter(r=>r.lowest);
 // Keep the quantity choice on a cost tie; otherwise prefer fewer added reservations.
 const reserved=(index:number)=>input.rows[index].groups.reduce((n,g,i)=>n+g.units*input.groups[i].cartonsPerUnit,0);
 choices.sort((a,b)=>Number(b.current)-Number(a.current)||reserved(a.index)-reserved(b.index)||a.index-b.index);
 const selected=choices[0],key=tailAllocationKey(selected.groups);
 const trials=input.mode==="quick"||input.mode==="detailed"?preparePalletTailTrials(input.request,input.baseline,input.groups[0].id,input.groups[0].limit,input.mode):prepareJointPalletTailTrials(input.request,input.baseline,input.groups.map(g=>({groupId:g.id,limit:g.limit})));
 const trial=trials.find(t=>tailAllocationKey(t.tailReservationChange!.groups??[{id:input.groups[0].id,units:t.tailReservationChange!.units}])===key);
 if(!trial||selected.costs?.total==null||current.costs?.total==null)throw Error("经济候选不在当前批次 / Economic candidate is outside the current batch");
 return {input:structuredClone(input),quote:structuredClone(quote),trial,rowIndex:selected.index,allocation:key,quantityAllocation:tailAllocationKey(groups),comparableCount:table.comparableCount,totalCandidates:input.rows.length,quantityTotal:current.costs.total,economicTotal:selected.costs.total,currency:table.currency};
}
export type EconomicTailTrial=ReturnType<typeof prepareEconomicTailTrial>;

/** A fresh solve must reproduce the reviewed row ledger and actual packaging usage. */
export function reviewEconomicTailTrial(prepared:EconomicTailTrial,raw:PackingResult,createdAt=new Date().toISOString()){
 const checked=prepareEconomicTailTrial(prepared.input,prepared.quote);
 if(JSON.stringify(checked)!==JSON.stringify(prepared))throw Error("经济候选已失效 / Economic candidate is stale");
 const plan=reviewOrderCapacityTrial(checked.trial,raw),basis=captureTailCostBasis(checked.input.request,plan),expected=checked.input.rows[checked.rowIndex].costBasis!;
 if(JSON.stringify(basis)!==JSON.stringify(expected))throw Error("复算交付数量或包装用量变化 / Recalculated delivery or packaging usage changed");
 const original=captureTailCostBasis(checked.input.request,checked.input.best!.plan);
 if(JSON.stringify(basis.rows)!==JSON.stringify(original.rows))throw Error("复算订单行数量不同 / Recalculated order-row quantities differ");
 const report=buildTailCostReport({...checked.input,best:{trial:checked.trial,plan}},checked.quote,createdAt,"quantity-first-then-equal-delivery-cost");
 if(!report.comparison.after.costs.complete||report.comparison.after.costs.total!==checked.economicTotal)throw Error("复算费用变化 / Recalculated costs changed");
 return {format:"cargo-fit-tail-economic-preview" as const,version:1 as const,engineVersion:report.engineVersion,createdAt,status:"preview-not-applied" as const,scope:"evaluated-same-order-row-batch" as const,selection:"quantity-first-then-equal-delivery-cost" as const,canApply:checked.input.canApply,quantityCandidate:{allocation:checked.quantityAllocation,loaded:checked.input.best!.plan.metrics.loadedCount,pallets:original.packagingIds.length,loose:original.loose,orderRows:original.rows,configuredTotal:checked.quantityTotal},economicCandidate:{allocation:checked.allocation,rowIndex:checked.rowIndex,configuredTotal:checked.economicTotal},comparableCount:checked.comparableCount,totalCandidates:checked.totalCandidates,currency:checked.currency,savings:Math.max(0,checked.quantityTotal-checked.economicTotal),recheck:{timeBudgetMs:30000,sameOrderRows:true as const,sameActualUsage:true as const},costReport:report};
}
export type EconomicTailReport=ReturnType<typeof reviewEconomicTailTrial>;

/** The ordinary accounting CSV plus explicit economic selection and quote totals. */
export function buildEconomicTailCsv(report:EconomicTailReport,en=false){
 const base=buildTailCostCsv(report.costReport,en);
 const labels=en?["Economic choice versus quantity candidate","Quantity candidate configured total","Economic candidate configured total","Configured savings","Comparable candidates","Economic allocation"]:["经济候选与数量候选对照","数量候选配置费用","经济候选配置费用","配置费用节省","可比候选数","经济配额"];
 const values=[report.selection,report.quantityCandidate.configuredTotal,report.economicCandidate.configuredTotal,report.savings,report.comparableCount,report.economicCandidate.allocation];
 const extra=labels.map((label,i)=>[en?"Preview - not applied":"试算预览－未采用",report.engineVersion,report.createdAt,report.currency,report.scope,`economic:${i}`,label,i===4?(en?"candidates":"候选"):i===0||i===5?"":report.currency,"",values[i],""].map(toCsvCell).join(","));
 return base+"\r\n"+extra.join("\r\n");
}
