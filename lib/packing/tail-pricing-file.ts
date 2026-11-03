import {ENGINE_VERSION} from "./engine";
import {parsePalletBuild} from "./loading-workflow";
import {palletSpecifications} from "./pallet-specifications";
import {parseTailCostQuote,type TailCostQuote} from "./pallet-tail-costs";
import type {PackingRequest} from "./types";

export const MAX_TAIL_PRICING_BYTES=5*1024*1024;
const invalid=()=>Error("请选择独立报价 JSON 或尾数费用报告 JSON，并检查报价、来源与日期 / Choose pricing JSON or tail cost report JSON and check quotes, sources and dates");
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
/** Price applicability excludes demand and stock; physical definitions and order identities stay bound. */
export function tailPricingContext(request:PackingRequest){
 if(request.workflow!=="palletized"||!request.container||!Array.isArray(request.products))throw invalid();
 const specs=palletSpecifications(parsePalletBuild(request.palletBuild));
 if(request.products.some(p=>!p||typeof p.id!=="string"||typeof p.sku!=="string"))throw invalid();
 return {container:{...structuredClone(request.container),exclusions:structuredClone(request.container.exclusions??[])},packaging:specs.map(s=>({id:s.id,config:structuredClone(s.config)})).sort((a,b)=>a.id.localeCompare(b.id)),orderRows:request.products.map(p=>({id:p.id,sku:p.sku,orderLine:structuredClone(p.orderLine??null),setCode:p.setCode??"",unitsPerSet:p.unitsPerSet??1})).sort((a,b)=>a.id.localeCompare(b.id)),delivery:structuredClone(request.delivery??null)};
}
function timestamp(value:unknown){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw invalid();return value;}
export function serializeTailPricing(quote:TailCostQuote,request:PackingRequest,createdAt=new Date().toISOString()){
 const file={format:"cargo-fit-tail-pricing",version:1,engineVersion:ENGINE_VERSION,createdAt:timestamp(createdAt),context:tailPricingContext(request),quote:parseTailCostQuote(quote,request)};
 const text=JSON.stringify(file,null,2);if(new TextEncoder().encode(text).length>MAX_TAIL_PRICING_BYTES)throw Error("报价文件超过 5 MB / Pricing file exceeds 5 MB");return text;
}
export function parseTailPricing(contents:string,request:PackingRequest){
 if(new TextEncoder().encode(contents).length>MAX_TAIL_PRICING_BYTES)throw Error("报价文件超过 5 MB / Pricing file exceeds 5 MB");
 let file;try{file=JSON.parse(contents);}catch{throw invalid();}
 if(!file||typeof file!=="object"||Array.isArray(file)||file.version!==1)throw invalid();
 let context:unknown,quote:unknown;
 if(file.format==="cargo-fit-tail-pricing"){context=file.context;quote=file.quote;}
 else if(file.format==="cargo-fit-tail-cost-report"){try{context=tailPricingContext(file.trial?.input);quote=file.comparison?.quote;}catch{throw invalid();}}
 else throw invalid();
 if(stable(context)!==stable(tailPricingContext(request)))throw Error("报价适用的柜型、包装、订单行或送货资料已变化，请重新核对报价 / Pricing container, packaging, order-row or delivery context changed; review applicability");
 return {quote:parseTailCostQuote(quote,request),source:{format:file.format as "cargo-fit-tail-pricing"|"cargo-fit-tail-cost-report",createdAt:timestamp(file.createdAt)},context:tailPricingContext(request)};
}
export type TailPricingImport=ReturnType<typeof parseTailPricing>;
