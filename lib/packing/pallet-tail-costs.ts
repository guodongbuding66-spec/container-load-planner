import {parseTailCostQuote,type TailCostQuote} from "./tail-cost-quote";
import {priceTailCandidates} from "./tail-cost-table";
import {fleetCosts} from "./fleet-costs";
import {palletSpecifications} from "./pallet-specifications";
import {parsePalletBuild} from "./loading-workflow";
import {improvesPalletTrial} from "./pallet-capacity";
import {buildTailTrialReport,type TailReportInput} from "./pallet-tail-report";
import {toCsvCell} from "./csv";
import {restorePackingSnapshot} from "./engine";
import {reviewOrderCapacityTrial} from "./order-capacity";
import type {PackingRequest,PackingResult} from "./types";

export {parseTailCostQuote,type TailCostQuote} from "./tail-cost-quote";
export type TailCostSelection="quantity-first"|"quantity-first-then-equal-delivery-cost";
/** Account for the selected preview; the remaining order is outside this scope. */
export function compareTailCosts(request:PackingRequest,baseline:PackingResult,candidate:PackingResult,quote:TailCostQuote,selection:TailCostSelection="quantity-first"){
 if(request.workflow!=="palletized"||!baseline.validation.valid||!candidate.validation.valid||!improvesPalletTrial(candidate,baseline))throw Error("Invalid tail cost candidate");
 const {pricing}=parseTailCostQuote(quote,request);
 const specs=palletSpecifications(parsePalletBuild(request.palletBuild)),ids=new Set(specs.map(s=>s.id));
 for(const plan of [baseline,candidate])if((plan.pallets??[]).some(p=>!ids.has(p.specificationId??"primary")))throw Error("Stale packaging specification");
 const summarize=(plan:PackingResult)=>{
  const costs=fleetCosts([{plan,cost:quote.freight}],pricing),loaded=plan.metrics.loadedCount;
  return {loaded,pallets:plan.pallets?.length??0,loose:plan.placements.filter(p=>!p.palletIds?.length).length,grossWeightKg:plan.metrics.grossWeight,costs,costPerLoadedCarton:costs.total!==null&&loaded>0?costs.total/loaded:null};
 };
 const before=summarize(baseline),after=summarize(candidate);
 const packages=specs.map(s=>{
  const beforeQuantity=(baseline.pallets??[]).filter(p=>(p.specificationId??"primary")===s.id).length,quantity=(candidate.pallets??[]).filter(p=>(p.specificationId??"primary")===s.id).length,unitPrice=pricing.packaging[s.id]??null;
  return {id:s.id,name:s.config.name,beforeQuantity,quantity,unitPrice,beforeSubtotal:beforeQuantity===0?0:unitPrice===null?null:unitPrice*beforeQuantity,subtotal:quantity===0?0:unitPrice===null?null:unitPrice*quantity};
 });
 return {scope:"configured-single-container-costs" as const,selection,currency:pricing.currency,quote:structuredClone({freight:quote.freight,pricing}),before,after,packages,complete:before.costs.complete&&after.costs.complete,costDifference:before.costs.total!==null&&after.costs.total!==null?after.costs.total-before.costs.total:null};
}
export type TailCostComparison=ReturnType<typeof compareTailCosts>;

/** Rebuild and independently review the current complete trial before exporting accounting. */
export function buildTailCostReport(input:TailReportInput,quote:TailCostQuote,createdAt=new Date().toISOString(),selection:TailCostSelection="quantity-first"){
 if(!input.best)throw Error("No selected tail candidate for cost comparison");
 if(input.baseline.workflow!=="palletized"||input.baseline.strategy!==(input.request.strategy??"practical")||JSON.stringify(parsePalletBuild(input.baseline.palletBuild))!==JSON.stringify(parsePalletBuild(input.request.palletBuild)))throw Error("Stale tail cost baseline");
 const baseline={...restorePackingSnapshot(input.request,input.baseline),id:input.baseline.id},candidate=reviewOrderCapacityTrial(input.best.trial,input.best.plan);
 if(!baseline.validation.valid)throw Error("Invalid tail cost baseline");
 const trial=buildTailTrialReport({...input,baseline,best:{...input.best,plan:candidate}},createdAt);
 const comparison=compareTailCosts(input.request,baseline,candidate,quote,selection);
 return {format:"cargo-fit-tail-cost-report" as const,version:1 as const,engineVersion:trial.engineVersion,createdAt,status:"preview-not-applied" as const,comparison,trial,candidateCosts:priceTailCandidates(input.request,baseline,candidate,input.rows,quote,input.best.trial.tailReservationChange!.groups??[{id:input.groups[0].id,units:input.best.trial.tailReservationChange!.units}])};
}
export type TailCostReport=ReturnType<typeof buildTailCostReport>;

export function buildTailCostCsv(report:TailCostReport,en=false){
 const c=report.comparison,rows:(string|number|null)[][]=[];
 const add=(id:string,label:string,unit:string,before:number|null,after:number|null)=>rows.push([en?"Preview - not applied":"试算预览－未采用",report.engineVersion,report.createdAt,c.currency,c.scope,id,label,unit,before,after,before!==null&&after!==null?after-before:null]);
 add("loaded",en?"Loaded cartons":"已装箱数",en?"cartons":"箱",c.before.loaded,c.after.loaded);
 add("loose",en?"Loaded loose cartons":"实际散箱",en?"cartons":"箱",c.before.loose,c.after.loose);
 add("gross-weight",en?"Planned gross weight":"计划毛重","kg",c.before.grossWeightKg,c.after.grossWeightKg);
 for(const p of c.packages){add(`packaging:${p.id}:quantity`,p.name,en?"units":"个",p.beforeQuantity,p.quantity);add(`packaging:${p.id}:price`,p.name,c.currency,p.unitPrice,p.unitPrice);add(`packaging:${p.id}:subtotal`,p.name,c.currency,p.beforeSubtotal,p.subtotal);}
 add("freight",en?"Freight (zero means unquoted)":"运费（0 为未报价）",c.currency,c.quote.freight||null,c.quote.freight||null);
 for(const [i,line] of (c.after.costs.lines??[]).entries()){
  const b=c.before.costs.lines![i];add(`charge:${line.id}:quantity`,line.label,line.basis,b.quantity,line.quantity);add(`charge:${line.id}:price`,line.label,line.currency,line.amount,line.amount);add(`charge:${line.id}:rate`,line.label,en?"base / foreign":"本位币／外币",b.exchangeRate,line.exchangeRate);add(`charge:${line.id}:subtotal`,line.label,c.currency,b.subtotal,line.subtotal);
 }
 add("known-subtotal",en?"Known subtotal (incomplete quotes remain unknown)":"已知小计（缺报价仍未核算）",c.currency,c.before.costs.knownSubtotal,c.after.costs.knownSubtotal);
 add("quoted-total",en?"Total of configured quotes":"已配置项目完整合计",c.currency,c.before.costs.total,c.after.costs.total);
 add("per-loaded-carton",en?"Configured cost per loaded carton":"已装每箱配置费用",c.currency,c.before.costPerLoadedCarton,c.after.costPerLoadedCarton);
 const header=en?["Status","Engine","Created","Currency","Scope","Item ID","Item","Unit","Before","Candidate","Difference"]:["报告状态","引擎","生成时间","币种","核算范围","项目ID","项目","单位","原方案","候选","差额"];
 return "\uFEFF"+[header,...rows].map(r=>r.map(v=>toCsvCell(v??"")).join(",")).join("\r\n");
}
