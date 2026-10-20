import {parsePalletBuild} from "./loading-workflow";
import {palletSpecifications} from "./pallet-specifications";
import type {PackingRequest} from "./types";
import type {FleetLoad} from "./fleet";
export type FleetPricing={currency:string;packaging:Record<string,number|null>};
export type FleetCosts={currency:string;freight:number;packaging:number|null;knownPackagingSubtotal:number;total:number|null;knownSubtotal:number;complete:boolean;missing:string[];scope:"freight-and-packaging"};
export function parseFleetPricing(value:unknown,request:PackingRequest):FleetPricing|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("费用资料无效 / Invalid fleet pricing");
 const p=value as FleetPricing;
 if(typeof p.currency!=="string"||!/^[A-Z]{3}$/.test(p.currency)||!p.packaging||typeof p.packaging!=="object"||Array.isArray(p.packaging))throw Error("币种或包装报价无效 / Invalid currency or packaging prices");
 const ids=new Set(request.workflow==="palletized"?palletSpecifications(parsePalletBuild(request.palletBuild)).map(s=>s.id):request.floorPallets?["floor"]:[]);
 if(Object.entries(p.packaging).some(([id,n])=>!ids.has(id)||n!==null&&(typeof n!=="number"||!Number.isFinite(n)||n<0||n>1e9)))throw Error("包装单价无效或规格已删除 / Invalid or stale packaging price");
 return {currency:p.currency,packaging:{...p.packaging}};
}
export function requireFleetQuotes(request:PackingRequest,pricing:FleetPricing|undefined){
 if(request.workflow!=="palletized"){if(request.floorPallets&&pricing?.packaging.floor==null)throw Error("费用优先须填写铺底托盘单价 / Quote floor pallet prices for cost priority");return;}
 const b=parsePalletBuild(request.palletBuild);
 if(request.products.some(p=>p.quantity>(b.looseQuantities?.[p.id]??0))&&palletSpecifications(b).some(s=>s.maxPallets>0&&pricing?.packaging[s.id]==null))throw Error("费用优先须填写可用包装规格的单价，免费请明确报价为 0 / Quote all available packaging for cost priority; explicitly enter zero for free packaging");
}
export function fleetCosts(loads:readonly FleetLoad[],pricing?:FleetPricing):FleetCosts{
 let freight=0,knownPackagingSubtotal=0;const missing=new Set<string>();if(!loads.length)missing.add("no-loads");
 loads.forEach((l,i)=>{freight+=l.cost;if(l.cost===0)missing.add(`freight:${i+1}`);for(const p of l.plan.pallets??[]){const id=p.specificationId??(l.plan.palletization?"primary":"floor"),price=pricing?.packaging[id];if(price==null)missing.add(`packaging:${id}`);else knownPackagingSubtotal+=price;}});
 const complete=missing.size===0,packaging=[...missing].some(k=>k.startsWith("packaging:"))?null:knownPackagingSubtotal;
 return {currency:pricing?.currency??"",freight,packaging,knownPackagingSubtotal,total:complete?freight+knownPackagingSubtotal:null,knownSubtotal:freight+knownPackagingSubtotal,complete,missing:[...missing],scope:"freight-and-packaging"};
}
