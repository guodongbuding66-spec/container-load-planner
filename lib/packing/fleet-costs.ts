import {parsePalletBuild} from "./loading-workflow";
import {palletSpecifications} from "./pallet-specifications";
import type {PackingRequest} from "./types";
import type {FleetLoad} from "./fleet";
export type DeliveryCharge={id:string;label:string;category:"materials"|"labor"|"rework"|"other";basis:"order"|"container"|"packaging"|"accessory";refId?:string;amount:number|null;currency:string;source:string};
export type QuotedExchangeRate={currency:string;rate:number;source:string;date:string};
export type FleetPricing={currency:string;packaging:Record<string,number|null>;charges?:DeliveryCharge[];exchangeRates?:QuotedExchangeRate[]};
export type CostLine=DeliveryCharge&{quantity:number;exchangeRate:number|null;subtotal:number|null};
export type FleetCosts={currency:string;freight:number;packaging:number|null;knownPackagingSubtotal:number;total:number|null;knownSubtotal:number;complete:boolean;missing:string[];scope:"freight-and-packaging"|"quoted-delivery-charges";additional?:number|null;knownAdditionalSubtotal?:number;lines?:CostLine[]};
export function parseFleetPricing(value:unknown,request:PackingRequest):FleetPricing|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("费用资料无效 / Invalid fleet pricing");
 const p=value as FleetPricing;
 if(typeof p.currency!=="string"||!/^[A-Z]{3}$/.test(p.currency)||!p.packaging||typeof p.packaging!=="object"||Array.isArray(p.packaging))throw Error("币种或包装报价无效 / Invalid currency or packaging prices");
 const ids=new Set(request.workflow==="palletized"?palletSpecifications(parsePalletBuild(request.palletBuild)).map(s=>s.id):request.floorPallets?["floor"]:[]);
 if(Object.entries(p.packaging).some(([id,n])=>!ids.has(id)||n!==null&&(typeof n!=="number"||!Number.isFinite(n)||n<0||n>1e9)))throw Error("包装单价无效或规格已删除 / Invalid or stale packaging price");
 const bad=()=>Error("附加费用或汇率资料无效，请补齐金额、币种、来源与日期 / Invalid additional quotes or exchange rates; supply amounts, currencies, sources and dates");
 const text=(v:unknown,max:number,required=false)=>typeof v==="string"&&v.length<=max&&(!required||v.trim().length>0);
 const money=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1e9;
 const specs=ids,accessories=new Set((request.container.exclusions??[]).filter(e=>e.kind==="obstacle"&&e.accessory).map(e=>e.id));
 if(p.charges!==undefined&&(!Array.isArray(p.charges)||p.charges.length>30))throw bad();
 const charges=p.charges?.map((c):DeliveryCharge=>{
  if(!c||typeof c!=="object"||!text(c.id,120,true)||!/^[-A-Za-z0-9_:]+$/.test(c.id)||!text(c.label,300,true)||!["materials","labor","rework","other"].includes(c.category)||!["order","container","packaging","accessory"].includes(c.basis)||c.amount!==null&&!money(c.amount)||!text(c.currency,3)||!/^[A-Z]{3}$/.test(c.currency)||!text(c.source,500,c.amount!==null))throw bad();
  if(c.basis==="accessory"&&(!c.refId||!accessories.has(c.refId))||c.basis==="packaging"&&c.refId!==undefined&&!specs.has(c.refId)||!["accessory","packaging"].includes(c.basis)&&c.refId!==undefined)throw bad();
  return {id:c.id,label:c.label,category:c.category,basis:c.basis,...(c.refId!==undefined?{refId:c.refId}:{}),amount:c.amount,currency:c.currency,source:c.source};
 });
 if(charges&&new Set(charges.map(c=>c.id)).size!==charges.length)throw bad();
 if(p.exchangeRates!==undefined&&(!Array.isArray(p.exchangeRates)||p.exchangeRates.length>15))throw bad();
 const exchangeRates=p.exchangeRates?.map((r):QuotedExchangeRate=>{
  if(!r||typeof r!=="object"||typeof r.currency!=="string"||!/^[A-Z]{3}$/.test(r.currency)||r.currency===p.currency||typeof r.rate!=="number"||!Number.isFinite(r.rate)||r.rate<=0||r.rate>1e6||!text(r.source,500,true)||typeof r.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date)throw bad();
  return {currency:r.currency,rate:r.rate,source:r.source,date:r.date};
 });
 if(exchangeRates&&new Set(exchangeRates.map(r=>r.currency)).size!==exchangeRates.length)throw bad();
 return {currency:p.currency,packaging:{...p.packaging},...(charges!==undefined?{charges}:{}),...(exchangeRates!==undefined?{exchangeRates}:{})};
}
export function requireFleetQuotes(request:PackingRequest,pricing:FleetPricing|undefined){
 if(pricing?.charges?.some(c=>c.amount===null||c.currency!==pricing.currency&&!pricing.exchangeRates?.some(r=>r.currency===c.currency)))throw Error("费用优先须补齐附加报价和汇率 / Complete additional quotes and exchange rates for cost priority");
 if(request.workflow!=="palletized"){if(request.floorPallets&&pricing?.packaging.floor==null)throw Error("费用优先须填写铺底托盘单价 / Quote floor pallet prices for cost priority");return;}
 const b=parsePalletBuild(request.palletBuild);
 if(request.products.some(p=>p.quantity>(b.looseQuantities?.[p.id]??0))&&palletSpecifications(b).some(s=>s.maxPallets>0&&pricing?.packaging[s.id]==null))throw Error("费用优先须填写可用包装规格的单价，免费请明确报价为 0 / Quote all available packaging for cost priority; explicitly enter zero for free packaging");
}
/** Small accounting basis captured from an independently validated plan. */
export type FleetCostUsage={cost:number;packagingIds:string[];accessories:{id:string;quantity:number}[]};
export function planCostUsage(plan:FleetLoad["plan"],cost:number):FleetCostUsage{
 return {cost,packagingIds:(plan.pallets??[]).map(p=>p.specificationId??(plan.palletization?"primary":"floor")),accessories:(plan.container.exclusions??[]).filter(e=>e.kind==="obstacle"&&e.accessory).map(e=>({id:e.id,quantity:e.accessory!.quantity}))};
}
export function fleetCosts(loads:readonly FleetLoad[],pricing?:FleetPricing):FleetCosts{
 return fleetCostsFromUsage(loads.map(l=>planCostUsage(l.plan,l.cost)),pricing);
}
export function fleetCostsFromUsage(loads:readonly FleetCostUsage[],pricing?:FleetPricing):FleetCosts{
 let freight=0,knownPackagingSubtotal=0;const missing=new Set<string>();if(!loads.length)missing.add("no-loads");
 loads.forEach((l,i)=>{freight+=l.cost;if(l.cost===0)missing.add(`freight:${i+1}`);for(const id of l.packagingIds){const price=pricing?.packaging[id];if(price==null)missing.add(`packaging:${id}`);else knownPackagingSubtotal+=price;}});
 const lines:CostLine[]=(pricing?.charges??[]).map(c=>{
  const quantity=c.basis==="order"?Number(loads.length>0):c.basis==="container"?loads.length:c.basis==="packaging"?loads.reduce((n,l)=>n+l.packagingIds.filter(id=>!c.refId||id===c.refId).length,0):loads.reduce((n,l)=>n+l.accessories.filter(e=>e.id===c.refId).reduce((s,e)=>s+e.quantity,0),0);
  const exchangeRate=c.currency===pricing!.currency?1:pricing!.exchangeRates?.find(r=>r.currency===c.currency)?.rate??null;
  const subtotal=quantity===0?0:c.amount===null||exchangeRate===null?null:c.amount*quantity*exchangeRate;
  if(subtotal!==null&&(!Number.isFinite(subtotal)||subtotal>1e12))throw Error("费用超出可核算范围 / Cost exceeds supported accounting range");
  if(subtotal===null)missing.add(`charge:${c.id}`);
  return {...c,quantity,exchangeRate,subtotal};
 });
 const knownAdditionalSubtotal=lines.reduce((n,c)=>n+(c.subtotal??0),0),knownSubtotal=freight+knownPackagingSubtotal+knownAdditionalSubtotal;
 if(!Number.isFinite(knownSubtotal)||knownSubtotal>1e12)throw Error("费用超出可核算范围 / Cost exceeds supported accounting range");
 const complete=missing.size===0,packaging=[...missing].some(k=>k.startsWith("packaging:"))?null:knownPackagingSubtotal;
 return {currency:pricing?.currency??"",freight,packaging,knownPackagingSubtotal,total:complete?knownSubtotal:null,knownSubtotal,complete,missing:[...missing],scope:lines.length?"quoted-delivery-charges":"freight-and-packaging",...(lines.length?{lines,knownAdditionalSubtotal,additional:lines.some(c=>c.subtotal===null)?null:knownAdditionalSubtotal}:{})};
}
