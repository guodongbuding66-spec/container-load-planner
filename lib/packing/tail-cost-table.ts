import {fleetCostsFromUsage,planCostUsage} from "./fleet-costs";
import {parsePalletBuild} from "./loading-workflow";
import {palletSpecifications} from "./pallet-specifications";
import {parseTailCostQuote,type TailCostQuote} from "./tail-cost-quote";
import {toCsvCell} from "./csv";
import type {TailComparisonRow} from "./pallet-tail-report";
import type {PackingRequest,PackingResult} from "./types";

/** Counts only; the worker's full candidate geometry is reviewed before this is captured. */
export type TailCostBasis={rows:{id:string;loaded:number}[];packagingIds:string[];accessories:{id:string;quantity:number}[];loose:number};
export function captureTailCostBasis(request:PackingRequest,plan:PackingResult):TailCostBasis{
 if(!plan.validation.valid)throw Error("Unreviewed tail cost basis");
 const counts=new Map<string,number>();for(const p of plan.placements)counts.set(p.productId,(counts.get(p.productId)??0)+1);
 if([...counts.keys()].some(id=>!request.products.some(p=>p.id===id)))throw Error("Unknown tail cost source row");
 const {packagingIds,accessories}=planCostUsage(plan,0);
 return {rows:request.products.map(p=>({id:p.id,loaded:counts.get(p.id)??0})),packagingIds,accessories,loose:plan.placements.filter(p=>!p.palletIds?.length).length};
}
export const tailAllocationKey=(groups:readonly {id:string;units:number}[])=>JSON.stringify(groups.map(g=>[g.id,g.units]));

export function priceTailCandidates(request:PackingRequest,baseline:PackingResult,selected:PackingResult,rows:readonly TailComparisonRow[],quote:TailCostQuote,selectedGroups:readonly {id:string;units:number}[]){
 const {freight,pricing}=parseTailCostQuote(quote,request),before=captureTailCostBasis(request,baseline),after=captureTailCostBasis(request,selected),build=parsePalletBuild(request.palletBuild),specs=palletSpecifications(build),chosen=tailAllocationKey(selectedGroups);
 const sameRows=(a:TailCostBasis,b:TailCostBasis)=>a.rows.every((r,i)=>r.id===b.rows[i]?.id&&r.loaded===b.rows[i]?.loaded)&&a.rows.length===b.rows.length;
 const total=(b:TailCostBasis)=>b.rows.reduce((n,r)=>n+r.loaded,0);
 const valid=(b:TailCostBasis|undefined,loaded:number|null):b is TailCostBasis=>{
  if(!b||!Array.isArray(b.rows)||b.rows.length!==request.products.length||b.rows.some((r,i)=>r.id!==request.products[i].id||!Number.isSafeInteger(r.loaded)||r.loaded<0||r.loaded>request.products[i].quantity)||total(b)!==loaded||!Number.isSafeInteger(b.loose)||b.loose<0||b.loose>total(b)||!Array.isArray(b.packagingIds)||b.packagingIds.length>build.maxPallets||b.packagingIds.some(id=>!specs.some(s=>s.id===id))||specs.some(s=>b.packagingIds.filter(id=>id===s.id).length>s.maxPallets)||JSON.stringify(b.accessories)!==JSON.stringify(before.accessories))return false;
  return true;
 };
 const priced=rows.map((r,index)=>{
  const b=r.costBasis,basisValid=valid(b,r.loaded),retained=basisValid&&b.rows.every((r,i)=>r.loaded>=before.rows[i].loaded),eligible=basisValid&&!r.problem&&r.retained&&retained&&total(b)>total(before),sameDelivery=eligible&&sameRows(b,after),current=tailAllocationKey(r.groups)===chosen;
  const matchesCurrent=!current||basisValid&&JSON.stringify(b)===JSON.stringify(after);
  const available=eligible&&matchesCurrent,costs=available?fleetCostsFromUsage([{cost:freight,packagingIds:b.packagingIds,accessories:b.accessories}],pricing):null;
  return {index,groups:structuredClone(r.groups),allocation:r.allocation??String(r.units),loaded:r.loaded,loose:basisValid?b.loose:null,packages:basisValid?specs.map(s=>({id:s.id,name:s.config.name,quantity:b.packagingIds.filter(id=>id===s.id).length})):[],available,sameDelivery:available&&sameDelivery,current,costs,difference:null as number|null,lowest:false,reason:!basisValid||!matchesCurrent?"missing-or-stale-basis":!eligible?"not-improving":!sameDelivery?"different-order-rows":null};
 });
 const selectedRow=priced.find(r=>r.current),selectedValid=priced.filter(r=>r.current).length===1&&!!selectedRow?.available&&selectedRow.sameDelivery;
 const comparable=priced.filter(r=>r.sameDelivery),unknownBasis=priced.some(r=>r.loaded===total(after)&&!r.available&&r.reason==="missing-or-stale-basis");
 const complete=selectedValid&&!unknownBasis&&comparable.every(r=>r.costs?.complete),canRank=complete&&comparable.length>=2;
 const minimum=canRank?Math.min(...comparable.map(r=>r.costs!.total!)):null;
 for(const r of priced){if(selectedValid&&r.sameDelivery&&r.costs?.total!=null&&selectedRow!.costs?.total!=null)r.difference=r.costs.total-selectedRow!.costs.total;if(minimum!==null&&r.sameDelivery&&r.costs?.total!=null)r.lowest=Math.abs(r.costs.total-minimum)<=Math.max(1e-7,Number.EPSILON*Math.max(Math.abs(minimum),Math.abs(r.costs.total))*8);}
 return {scope:"same-order-row-delivery" as const,selection:"explicit-quota-recalculation" as const,currency:pricing.currency,complete,canRank,comparableCount:comparable.length,minimum,rows:priced};
}
export type TailCandidateCosts=ReturnType<typeof priceTailCandidates>;

export function buildTailCandidateCostCsv(table:TailCandidateCosts,engineVersion:string,createdAt:string,en=false){
 const header=en?["Status","Engine","Created","Currency","Allocation","Loaded cartons","Loose cartons","Packaging units","Same order-row quantities","Known subtotal","Configured total","Difference from quantity candidate","Lowest in comparable batch","Review"]:["报告状态","引擎","生成时间","币种","配额组合","已装箱数","实际散箱","包装单元","各订单行数量相同","已知小计","配置费用合计","较数量优先候选差额","可比批次最低","复核"];
 const rows=table.rows.map(r=>[en?"Preview - not applied":"试算预览－未采用",engineVersion,createdAt,table.currency,r.allocation,r.loaded,r.loose,r.available?r.packages.reduce((n,p)=>n+p.quantity,0):null,r.sameDelivery,r.costs?.knownSubtotal,r.costs?.total,r.difference,r.lowest,r.reason??(r.costs?.complete?"quoted":"incomplete-quotes")]);
 return "\uFEFF"+[header,...rows].map(r=>r.map(v=>toCsvCell(typeof v==="boolean"?String(v):v??"")).join(",")).join("\r\n");
}
