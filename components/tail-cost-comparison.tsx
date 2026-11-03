"use client";
import {useMemo,useState} from "react";
import {compareTailCosts,buildTailCostCsv,type TailCostQuote,type TailCostReport} from "../lib/packing/pallet-tail-costs";
import {priceTailCandidates,buildTailCandidateCostCsv} from "../lib/packing/tail-cost-table";
import type {TailComparisonRow} from "../lib/packing/pallet-tail-report";
import {TailCandidateCostTable} from "./tail-candidate-cost-table";
import {TailEconomicPreview} from "./tail-economic-preview";
import type {TailReportInput} from "../lib/packing/pallet-tail-report";
import {FleetPackagingPrices} from "./fleet-packaging";
import {NumericInput} from "./numeric-input";
import {TailPricingFiles} from "./tail-pricing-files";
import {tr,useLanguage} from "./language";
import type {PackingRequest,PackingResult} from "../lib/packing/types";

type Props={request:PackingRequest;baseline:PackingResult;candidate:PackingResult;disabled:boolean;getReport:(quote:TailCostQuote)=>TailCostReport|undefined;getTrialInput?:()=>TailReportInput|undefined;rows?:TailComparisonRow[];selectedGroups?:{id:string;units:number}[];canApply?:boolean;onAdopt?:(row:TailComparisonRow)=>boolean};
export function TailCostComparison({request,baseline,candidate,disabled,getReport,getTrialInput,rows,selectedGroups,canApply=false,onAdopt}:Props){
 const language=useLanguage(),[quote,setQuote]=useState<TailCostQuote>({freight:0,pricing:{currency:"CNY",packaging:{}}}),[validity,setValidity]=useState<Record<string,boolean>>({}),[failed,setFailed]=useState(false),[quoteRevision,setQuoteRevision]=useState(0);
 const invalid=Object.values(validity).some(v=>!v),costs=useMemo(()=>{try{return compareTailCosts(request,baseline,candidate,quote);}catch{return null;}},[request,baseline,candidate,quote]);
 const table=useMemo(()=>{try{return rows&&selectedGroups?priceTailCandidates(request,baseline,candidate,rows,quote,selectedGroups):null;}catch{return null;}},[request,baseline,candidate,rows,quote,selectedGroups]);
 const money=(n:number|null|undefined)=>n==null?tr("未核算","Unknown"):n.toFixed(2);
 const changeCurrency=(currency:string)=>{setQuote({freight:0,pricing:{...quote.pricing,currency,packaging:{},exchangeRates:undefined}});setValidity({});};
 const download=(format:"json"|"csv"|"candidates")=>{setFailed(false);try{if(disabled||invalid||!costs)return;const report=getReport(quote);if(!report)return;if(format==="candidates"&&!table)return;const text=format==="json"?JSON.stringify(report,null,2):format==="candidates"?buildTailCandidateCostCsv(report.candidateCosts,report.engineVersion,report.createdAt,language==="en"):buildTailCostCsv(report,language==="en"),url=URL.createObjectURL(new Blob([text],{type:format==="json"?"application/json;charset=utf-8":"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=`tail-cost-${report.engineVersion}${format==="candidates"?"-candidates":""}.${format==="json"?"json":"csv"}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setFailed(true);}};
 return <details className="tail-cost-comparison"><summary>{tr("原方案与尾数候选费用对照","Compare baseline and tail candidate costs")}</summary>
  <p className="helper-text">{tr("核算当前数量优先候选，报价不改变候选或自动采用。每边按一柜计费，每订单项目各计一次；余货后续运费、未配置项目及税费不在范围内。报价仅用于本次对照，请下载费用报告留存。","Account for the current quantity-first candidate; quotes do not change or apply it. Each side charges one container and each order charge once. Remaining shipments, unconfigured charges and taxes are outside scope. Quotes are for this comparison; download a cost report to retain them.")}</p>
  <TailPricingFiles request={request} value={quote} draftInvalid={invalid} disabled={disabled} onApply={next=>{setQuote(next);setValidity({});setFailed(false);setQuoteRevision(n=>n+1);}}/>
  <fieldset disabled={disabled}><legend>{tr("本柜运费","Freight for this container")}</legend><NumericInput key={`${quote.pricing.currency}:${quoteRevision}`} ariaLabel={tr("尾数比较本柜运费","Tail comparison freight")} value={quote.freight} min={0} max={1e9} precision={4} onValueChange={freight=>setQuote({...quote,freight})} onValidityChange={v=>setValidity(a=>({...a,freight:v}))}/><small>{tr("0 表示未报价；缺报价时不计算完整合计、差额和每箱费用。","Zero means unquoted. Missing quotes leave the total, difference and per-carton cost unknown.")}</small></fieldset>
  <FleetPackagingPrices key={`${quote.pricing.currency}:${quoteRevision}`} request={request} value={quote.pricing} onChange={pricing=>setQuote({...quote,pricing})} onCurrencyChange={changeCurrency} onValidity={(k,v)=>setValidity(a=>({...a,[k]:v}))} disabled={disabled}/>
  {(!costs||invalid)&&<p role="alert">{tr("请修正费用输入；附加报价需要有效名称、币种和来源，外币换算需要来源与日期。","Correct the cost inputs. Additional quotes need a valid name, currency and source; foreign rates need a source and date.")}</p>}
  {costs&&!invalid&&<>
   <p role="status">{costs.complete?tr("已配置项目报价完整；完整交付总成本仍取决于未配置项目和余货。","Configured quotes are complete; full delivery cost still depends on unconfigured items and remaining cargo."):tr("报价未完整：已知小计保留，完整合计与差额显示未核算。","Quotes are incomplete: known subtotals are retained; totals and differences remain unknown.")} {tr("币种","Currency")}: {costs.currency}</p>
   <div className="upgrade-table-wrap" tabIndex={0} role="region" aria-label={tr("尾数费用对照结果","Tail cost comparison results")}><table><thead><tr><th>{tr("项目","Item")}</th><th>{tr("原方案","Baseline")}</th><th>{tr("尾数候选","Tail candidate")}</th></tr></thead><tbody>
    <tr><th>{tr("已装箱数","Loaded cartons")}</th><td>{costs.before.loaded}</td><td>{costs.after.loaded}</td></tr>
    <tr><th>{tr("实际散箱","Loaded loose cartons")}</th><td>{costs.before.loose}</td><td>{costs.after.loose}</td></tr>
    <tr><th>{tr("包装单元","Packaging units")}</th><td>{costs.before.pallets}</td><td>{costs.after.pallets}</td></tr>
    <tr><th>{tr("计划毛重 kg","Planned gross kg")}</th><td>{costs.before.grossWeightKg}</td><td>{costs.after.grossWeightKg}</td></tr>
    <tr><th>{tr("已知费用小计","Known cost subtotal")}</th><td>{money(costs.before.costs.knownSubtotal)}</td><td>{money(costs.after.costs.knownSubtotal)}</td></tr>
    <tr><th>{tr("已配置项目完整合计","Total of configured quotes")}</th><td>{money(costs.before.costs.total)}</td><td>{money(costs.after.costs.total)}</td></tr>
    <tr><th>{tr("已装每箱配置费用","Configured cost per loaded carton")}</th><td>{money(costs.before.costPerLoadedCarton)}</td><td>{money(costs.after.costPerLoadedCarton)}</td></tr>
   </tbody></table></div>
   <p><strong>{tr("配置费用差额（候选减原方案）","Configured cost difference (candidate minus baseline)")}: {money(costs.costDifference)} {costs.currency}</strong></p>
   <div className="upgrade-table-wrap"><table><thead><tr><th>{tr("包装规格","Packaging specification")}</th><th>{tr("原数量","Before units")}</th><th>{tr("候选数量","Candidate units")}</th><th>{tr("包装单价","Packaging price")}</th><th>{tr("原费用","Before cost")}</th><th>{tr("候选费用","Candidate cost")}</th></tr></thead><tbody>{costs.packages.map(p=><tr key={p.id}><th>{p.name}</th><td>{p.beforeQuantity}</td><td>{p.quantity}</td><td>{money(p.unitPrice)}</td><td>{money(p.beforeSubtotal)}</td><td>{money(p.subtotal)}</td></tr>)}</tbody></table></div>
   {!!costs.after.costs.lines?.length&&<div className="upgrade-table-wrap"><table><thead><tr><th>{tr("附加项目","Additional charge")}</th><th>{tr("原数量／费用","Before quantity / cost")}</th><th>{tr("候选数量／费用","Candidate quantity / cost")}</th></tr></thead><tbody>{costs.after.costs.lines.map((l,i)=><tr key={l.id}><th>{l.label}</th><td>{costs.before.costs.lines![i].quantity} / {money(costs.before.costs.lines![i].subtotal)}</td><td>{l.quantity} / {money(l.subtotal)}</td></tr>)}</tbody></table></div>}
  </>}
  {table&&!invalid&&<TailCandidateCostTable table={table} rows={rows!} disabled={disabled} canApply={canApply} onAdopt={onAdopt}/>}
  {table&&getTrialInput&&<TailEconomicPreview sourceKey={JSON.stringify([request,baseline,candidate,rows,selectedGroups,quoteRevision])} quote={quote} enabled={!disabled&&!invalid&&table.canRank} canApply={canApply} getInput={getTrialInput} onAdopt={onAdopt}/>}
  <div className="upgrade-actions"><button type="button" className="button" disabled={disabled||invalid||!costs} onClick={()=>download("json")}>{tr("下载尾数费用 JSON","Download tail cost JSON")}</button><button type="button" className="button" disabled={disabled||invalid||!costs} onClick={()=>download("csv")}>{tr("下载尾数费用 CSV","Download tail cost CSV")}</button>{table&&<button type="button" className="button" disabled={disabled||invalid||!costs} onClick={()=>download("candidates")}>{tr("下载候选费用 CSV","Download candidate cost CSV")}</button>}</div>
  <small>{tr("费用报告标记为未采用预览，JSON 包含当前完整试算、逐行数量、五项复核和各候选费用。费用 CSV 中空值表示未核算。","Cost reports are unapplied previews. JSON includes the complete trial, row quantities, five reviews and candidate costs. Empty cost CSV cells mean unknown.")}</small>
  {failed&&<p role="alert">{tr("费用报告导出失败，请重新运行当前试算后重试。","Cost report export failed; rerun the current trial and try again.")}</p>}
 </details>;
}
