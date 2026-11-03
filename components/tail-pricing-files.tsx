"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {MAX_TAIL_PRICING_BYTES,parseTailPricing,serializeTailPricing,type TailPricingImport} from "../lib/packing/tail-pricing-file";
import type {TailCostQuote} from "../lib/packing/pallet-tail-costs";
import type {PackingRequest} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

type Props={request:PackingRequest;value:TailCostQuote;draftInvalid:boolean;disabled:boolean;onApply:(quote:TailCostQuote)=>void};
export function useTailPricingFiles({request,value,draftInvalid,disabled,onApply}:Props){
 const identity=useMemo(()=>({request,value,draftInvalid,disabled}),[request,value,draftInvalid,disabled]),latest=useRef<typeof identity|null>(identity),job=useRef(0);
 const [state,setState]=useState<{identity:typeof identity;loading?:boolean;preview?:TailPricingImport;error?:string}|null>(null);
 useLayoutEffect(()=>{latest.current=identity;return()=>{latest.current=null;};},[identity]);
 const current=state?.identity===identity?state:null;
 const load=async(file:Pick<File,"size"|"text">)=>{
  if(disabled||latest.current!==identity)return;const task=++job.current,active=()=>latest.current===identity&&task===job.current;
  setState({identity,loading:true});try{if(file.size>MAX_TAIL_PRICING_BYTES)throw Error("报价文件超过 5 MB / Pricing file exceeds 5 MB");const contents=await file.text();if(!active())return;const preview=parseTailPricing(contents,request);if(active())setState({identity,preview});}catch(error){if(active())setState({identity,error:error instanceof Error?error.message:String(error)});}
 };
 const apply=()=>{if(disabled||latest.current!==identity||!current?.preview)return;onApply(structuredClone(current.preview.quote));setState(null);};
 return {current,load,apply};
}
export function TailPricingFiles(props:Props){
 const language=useLanguage(),{current,load,apply}=useTailPricingFiles(props),input=useRef<HTMLInputElement>(null),[exportFailed,setExportFailed]=useState(false),p=current?.preview;
 let exportable=!props.disabled&&!props.draftInvalid;try{if(exportable)serializeTailPricing(props.value,props.request);}catch{exportable=false;}
 const save=()=>{setExportFailed(false);try{if(!exportable)return;const text=serializeTailPricing(props.value,props.request),url=URL.createObjectURL(new Blob([text],{type:"application/json;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="tail-pricing.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setExportFailed(true);}};
 const message=current?.error?.split(" / ");
 return <section className="tail-pricing-files" aria-label={tr("报价保存与复用","Save and reuse pricing")}><h4>{tr("报价保存与复用","Save and reuse pricing")}</h4>
  <p className="helper-text">{tr("独立报价和尾数费用报告均可导入，最多 5 MB。先核对来源与适用性，再明确替换当前报价；数量、箱位和复核结果使用当前方案。柜型、包装定义、订单行身份与送货资料须相同，货量及库存变化后按当前用量重新计费。","Import pricing JSON or a tail cost report, up to 5 MB. Review source and applicability before replacing current quotes. Quantities, positions and reviews come from the current plan. Container, packaging definitions, order-row identities and delivery data must match; demand and stock changes use current quantities.")}</p>
  <div className="upgrade-actions"><button type="button" className="button" disabled={!exportable} onClick={save}>{tr("下载独立报价 JSON","Download pricing JSON")}</button><button type="button" className="button" disabled={props.disabled||!!current?.loading} onClick={()=>input.current?.click()}>{tr("导入费用报价","Import pricing")}</button><input ref={input} type="file" hidden accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void load(file);}}/></div>
  {current?.loading&&<p role="status">{tr("正在读取报价，当前报价保持。","Reading pricing; current quotes are retained.")}</p>}
  {message&&<p role="alert">{message.length===2?message[language==="en"?1:0]:tr("报价导入失败，当前报价保持；请检查文件与适用配置。","Pricing import failed; current quotes are retained. Check the file and applicability.")}</p>}
  {p&&<div className="tail-pricing-preview"><p><strong>{tr("待导入报价预览","Pricing import preview")}</strong> · {tr("文件生成时间","File created")}: {p.source.createdAt}</p><p>{tr("币种／本柜运费","Currency / container freight")}: {p.quote.pricing.currency} / {p.quote.freight} · {tr("0 运费为未报价；文件声明不代表当前报价有效，请核对来源。","Zero freight is unquoted. File declarations do not verify current quote validity; review sources.")}</p>
   <div className="upgrade-table-wrap"><table><thead><tr><th>{tr("包装","Packaging")}</th><th>{tr("单价","Unit price")}</th></tr></thead><tbody>{p.context.packaging.map(s=><tr key={s.id}><th>{s.config.name}</th><td>{p.quote.pricing.packaging[s.id]??tr("未报价","Unquoted")}</td></tr>)}</tbody></table></div>
   {!!p.quote.pricing.charges?.length&&<div className="upgrade-table-wrap"><table><thead><tr><th>{tr("附加项目／计费单位","Charge / basis")}</th><th>{tr("单价／币种","Price / currency")}</th><th>{tr("来源","Source")}</th></tr></thead><tbody>{p.quote.pricing.charges.map(c=><tr key={c.id}><th>{c.label} / {{order:tr("每订单一次","Once per order"),container:tr("每柜","Per container"),packaging:tr("每包装","Per packaging"),accessory:tr("指定材料每件","Per selected material")}[c.basis]}{c.refId?` · ${p.context.packaging.find(s=>s.id===c.refId)?.config.name??p.context.container.exclusions.find(e=>e.id===c.refId)?.name??c.refId}`:c.basis==="packaging"?tr("（全部包装）"," (all packaging)"):""}</th><td>{c.amount??tr("未报价","Unquoted")} {c.currency}</td><td>{c.source}</td></tr>)}</tbody></table></div>}
   {!!p.quote.pricing.exchangeRates?.length&&<div className="upgrade-table-wrap"><table><thead><tr><th>{tr("外币／汇率","Foreign currency / rate")}</th><th>{tr("来源／日期","Source / date")}</th></tr></thead><tbody>{p.quote.pricing.exchangeRates.map(r=><tr key={r.currency}><th>{r.currency} / {r.rate}</th><td>{r.source} / {r.date}</td></tr>)}</tbody></table></div>}
   <button type="button" className="button" disabled={props.disabled} onClick={apply}>{tr("采用导入报价","Apply imported pricing")}</button><small>{tr("明确采用后替换本面板报价，旧费用按当前方案重算；不导入旧候选或采用装载方案。","Applying replaces this panel's quotes and recalculates costs for the current plan. Old candidates and loading plans are not imported.")}</small>
  </div>}
  {exportFailed&&<p role="alert">{tr("独立报价导出失败，请检查当前输入。","Pricing export failed; check current inputs.")}</p>}
 </section>;
}
