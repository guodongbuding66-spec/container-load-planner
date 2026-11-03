import {ENGINE_VERSION} from "./engine";
import {toCsvCell} from "./csv";
import {parsePalletBuild} from "./loading-workflow";
import {reviewOrderCapacityTrial} from "./order-capacity";
import {improvesPalletTrial} from "./pallet-capacity";
import {reviewPlan,REVIEW_STATES,type PlanReview} from "./plan-review";
import {tailCargoGroups,tailCandidateRows,TAIL_CARTON_BUDGET,TAIL_JOINT_CANDIDATE_LIMIT,type TailCandidate,type TailSearchMode} from "./pallet-tail";
import type {PackingRequest,PackingResult} from "./types";

import type {TailCostBasis} from "./tail-cost-table";

export type TailReportGroup={id:string;name:string;limit:number;cartonsPerUnit:number};
export type TailComparisonRow={units:number;allocation?:string;groups:{id:string;name:string;units:number}[];loaded:number|null;retained:boolean;problem?:string;costBasis?:TailCostBasis};
export type TailReportInput={request:PackingRequest;baseline:PackingResult;mode:TailSearchMode;groups:TailReportGroup[];rows:TailComparisonRow[];best?:TailCandidate;canApply:boolean};

/** Serialize a complete current batch; this format is intentionally separate from workspace backups. */
export function buildTailTrialReport({request,baseline,mode,groups,rows,best,canApply}:TailReportInput,createdAt=new Date().toISOString()){
 const count=mode==="joint"?2:mode==="triple"?3:1;
 if(!["quick","detailed","joint","triple"].includes(mode)||groups.length!==count||new Set(groups.map(g=>g.id)).size!==count||groups.some(g=>!Number.isSafeInteger(g.limit)||g.limit<1||g.limit>64||!Number.isSafeInteger(g.cartonsPerUnit)||g.cartonsPerUnit<1)||!baseline.validation.valid)throw Error("Invalid tail report scope");
 const eligible=tailCargoGroups(request,baseline);if(groups.some(g=>!eligible.some(e=>e.id===g.id&&e.cartonsPerUnit===g.cartonsPerUnit&&e.name===g.name&&g.limit<=e.availableUnits)))throw Error("Tail report groups differ from original demand");
 const grid=groups.reduce((n,g)=>n*(g.limit+1),1)-1;
 if(count>1&&grid>TAIL_JOINT_CANDIDATE_LIMIT)throw Error("Tail report grid exceeds budget");
 const expected=new Set<string>();
 if(count===1){const limit=groups[0].limit,amounts=mode==="quick"?[...new Set([1,2,4,8,limit].filter(n=>n<=limit))]:Array.from({length:limit},(_,i)=>i+1);for(const n of amounts)if(n*groups[0].cartonsPerUnit<=TAIL_CARTON_BUDGET)expected.add(JSON.stringify([n]));}
 else{const visit=(i:number,values:number[],cartons:number)=>{if(i===count){if(cartons>0)expected.add(JSON.stringify(values));return;}for(let n=0;n<=groups[i].limit;n++){const next=cartons+n*groups[i].cartonsPerUnit;if(next<=TAIL_CARTON_BUDGET)visit(i+1,[...values,n],next);}};visit(0,[],0);}
 const keys=rows.map(r=>JSON.stringify(r.groups.map(g=>g.units))),demand=request.products.reduce((n,p)=>n+p.quantity,0);
 if(!rows.length||rows.length!==expected.size||new Set(keys).size!==expected.size||keys.some(k=>!expected.has(k))||rows.some(r=>r.groups.length!==count||r.groups.some((g,i)=>g.id!==groups[i].id)||r.loaded!==null&&(!Number.isSafeInteger(r.loaded)||r.loaded<0||r.loaded>demand)))throw Error("Only a complete tail batch can be reported");
 let candidate:null|{looseQuantities:Record<string,number>;loaded:number;grossWeightKg:number;pallets:number;orderRows:ReturnType<typeof tailCandidateRows>;modelValidation:PackingResult["validation"];review:PlanReview}=null;
 if(best){
  const expectedRequest=structuredClone(request);expectedRequest.palletBuild={...parsePalletBuild(request.palletBuild),looseQuantities:best.trial.request.palletBuild?.looseQuantities};expectedRequest.strategy=request.strategy??"practical";expectedRequest.singleCartonLimit=undefined;
  if(JSON.stringify(expectedRequest)!==JSON.stringify(best.trial.request))throw Error("Tail report candidate changes original inputs");
  const reviewed=reviewOrderCapacityTrial(best.trial,best.plan);
  if(!improvesPalletTrial(reviewed,baseline))throw Error("Tail report candidate does not improve every loaded row");
  const selected=best.trial.tailReservationChange?.groups??[{id:groups[0].id,units:best.trial.tailReservationChange?.units}],key=JSON.stringify(selected.map(g=>g.units)),row=rows.find((r,i)=>keys[i]===key);
  if(selected.length!==count||selected.some((g,i)=>g.id!==groups[i].id)||!row?.retained||row.loaded!==reviewed.metrics.loadedCount)throw Error("Selected tail report candidate is outside this batch");
  candidate={looseQuantities:structuredClone(reviewed.palletBuild?.looseQuantities??{}),loaded:reviewed.metrics.loadedCount,grossWeightKg:reviewed.metrics.grossWeight,pallets:reviewed.pallets?.length??0,orderRows:tailCandidateRows(request,baseline,reviewed),modelValidation:structuredClone(reviewed.validation),review:reviewPlan(reviewed,request.products)};
 }
 return {format:"cargo-fit-tail-trial-report" as const,version:1 as const,engineVersion:ENGINE_VERSION,createdAt,status:"preview-not-applied" as const,complete:true as const,canApply,scope:{mode,groups:structuredClone(groups)},limits:{maxAdditionalCartons:64,maxCandidates:mode==="quick"?5:64,maxOrderCartons:4000,batchTimeMs:30000},input:structuredClone(request),baseline:{id:baseline.id,strategy:baseline.strategy,requested:baseline.metrics.requestedCount,loaded:baseline.metrics.loadedCount,grossWeightKg:baseline.metrics.grossWeight,pallets:baseline.pallets?.length??0},candidates:rows.map(r=>({...structuredClone(r),outcome:r.loaded===null?"review-failed":!r.retained?"row-reduced":r.loaded<=baseline.metrics.loadedCount?"no-increase":"improves"})),selectedCandidate:candidate};
}
export type TailTrialReport=ReturnType<typeof buildTailTrialReport>;

export function buildTailTrialCsv(report:TailTrialReport,en=false){
 if(!report.selectedCandidate)throw Error("No selected candidate for row CSV");
 const header=en?["Status","Engine","Created","Baseline plan ID","Scope","Order row ID","SKU / row label","Demand cartons","Loaded before","Loaded candidate","Reserved before","Reserved candidate","Actual loose","Palletized","Unloaded","Candidate-wide data review","Candidate-wide geometry review","Candidate-wide bearing review","Candidate-wide access review","Candidate-wide securing review"]:["报告状态","引擎","生成时间","原方案ID","搜索范围","订单行ID","SKU／订单行标识","原订单箱数","原已装箱数","候选已装箱数","原散箱预留","候选散箱预留","实际散箱","托内箱","未装箱","候选整体－数据复核","候选整体－几何复核","候选整体－承重复核","候选整体－路径复核","候选整体－固定复核"];
 const checks=["data","geometry","bearing","path","securing"].map(id=>{const state=report.selectedCandidate!.review.checks.find(c=>c.id===id)?.state??"unverified";return REVIEW_STATES[state][en?1:0];});
 const rows=report.selectedCandidate.orderRows.map(r=>[en?"Preview - not applied":"试算预览－未采用",report.engineVersion,report.createdAt,report.baseline.id,report.scope.mode,r.id,r.label,r.requested,r.beforeLoaded,r.loaded,r.beforeReserved,r.reserved,r.loose,r.palletized,r.unloaded,...checks]);
 return "\uFEFF"+[header,...rows].map(r=>r.map(toCsvCell).join(",")).join("\r\n");
}
