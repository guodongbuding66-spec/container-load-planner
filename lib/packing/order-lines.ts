import {parseDelivery,type DeliveryMap} from "./access";
import type {ContainerSpec,PalletBuildOptions,ProductInput,PackingResult} from "./types";
export type OrderLine={orderReference:string;lineReference:string;batch:string;customer:string;destination:string;stop:number};
export const EMPTY_ORDER_LINE:OrderLine={orderReference:"",lineReference:"",batch:"",customer:"",destination:"",stop:0};
export function parseOrderLine(value:unknown):OrderLine|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("订单行资料无效 / Invalid order-line details");
 const v=value as Record<string,unknown>,out={...EMPTY_ORDER_LINE};
 for(const k of ["orderReference","lineReference","batch","customer","destination"] as const){const s=v[k]??"";if(typeof s!=="string"||s.length>120)throw Error("订单行文字最多 120 字符 / Order-line text is limited to 120 characters");out[k]=s;}
 const stop=v.stop??0;if(typeof stop!=="number"||!Number.isInteger(stop)||stop<0||stop>999)throw Error("卸货站次须为 0–999 / Unload stop must be 0–999");out.stop=stop;return out;
}
export function assertOrderLineIds(products:readonly ProductInput[]){
 const seen=new Set<string>();for(const p of products){if(typeof p.id!=="string"||!p.id.trim()||p.id.length>120||["__proto__","constructor","prototype"].includes(p.id)||seen.has(p.id))throw Error("订单行 ID（产品 ID）不能为空、重复或超过 120 字符 / Order-line IDs must be unique, nonempty and at most 120 characters");seen.add(p.id);parseOrderLine(p.orderLine);}
}
/** Source rows own new delivery data. A contradictory saved result is rejected. */
export function orderDelivery(products:readonly ProductInput[],legacy?:unknown):DeliveryMap|undefined{
 const map={...parseDelivery(legacy,new Set(products.map(p=>p.id)))};
 for(const p of products){const line=parseOrderLine(p.orderLine);if(!line)continue;const d={customer:line.customer,destination:line.destination,stop:line.stop},old=map[p.id];if(old&&(old.customer!==d.customer||old.destination!==d.destination||old.stop!==d.stop))throw Error("结果站次与源订单行不一致 / Result delivery differs from its source order line");map[p.id]=d;}
 return Object.keys(map).length?map:undefined;
}
/** Preserve legacy result-only delivery on source adoption without changing geometry. */
export function adoptOrderDelivery(products:readonly ProductInput[],delivery?:DeliveryMap):ProductInput[]{
 const map=parseDelivery(delivery,new Set(products.map(p=>p.id)));return products.map(p=>map?.[p.id]?{...p,orderLine:{...(parseOrderLine(p.orderLine)??EMPTY_ORDER_LINE),...map[p.id]}}:p);
}
export function inheritOrderDelivery(products:readonly ProductInput[],delivery?:DeliveryMap):ProductInput[]{
 const legacyIds=new Set(products.filter(p=>!p.orderLine).map(p=>p.id));return adoptOrderDelivery(products,Object.fromEntries(Object.entries(delivery??{}).filter(([id])=>legacyIds.has(id))));
}
export function copyOrderRows(products:readonly ProductInput[],id:string,makeId:()=>string=()=>crypto.randomUUID()):ProductInput[]{
 const source=products.find(p=>p.id===id);if(!source)throw Error("订单行已不存在 / Order line no longer exists");const code=source.setCode?.trim(),members=code?products.filter(p=>p.setCode?.trim()===code):[source];
 const codes=new Set(products.map(p=>p.setCode));let nextCode:string|undefined;
 if(code){let n=1;do{nextCode=code.slice(0,65)+"-copy-"+n++;}while(codes.has(nextCode));}
 const added=members.map(p=>({...structuredClone(p),id:makeId(),source:undefined,setCode:nextCode,...(p.orderLine?{orderLine:{...p.orderLine,lineReference:""}}:{})}));const result=[...products,...added];assertOrderLineIds(result);return result;
}
export function importOrderRows(existing:readonly ProductInput[],incoming:readonly ProductInput[],mode:"replace"|"append",makeId:()=>string=()=>crypto.randomUUID()):ProductInput[]{
 assertOrderLineIds(existing);assertOrderLineIds(incoming);if(mode==="append"&&incoming.some(p=>p.setCode?.trim()&&existing.some(e=>e.setCode?.trim()===p.setCode!.trim())))throw Error("追加套装编码已存在，请使用新套装编码 / Appended kit code already exists; use a new kit code");const rows=mode==="append"?[...existing,...incoming.map(p=>({...p,id:makeId(),source:undefined}))]:[...incoming];if(rows.length>10000)throw Error("订单行最多 10,000 行 / Use at most 10,000 order lines");assertOrderLineIds(rows);return rows;
}
export function updateOrderQuantities(existing:readonly ProductInput[],updates:readonly {id:string;quantity:number}[]):ProductInput[]{
 assertOrderLineIds(existing);const ids=new Set(existing.map(p=>p.id)),map=new Map<string,number>();
 for(const u of updates){if(!ids.has(u.id)||map.has(u.id)||!Number.isInteger(u.quantity)||u.quantity<0||u.quantity>1000000)throw Error("数量更新须使用当前订单的唯一 ID 和有效箱数 / Quantity updates require unique current order-line IDs and valid quantities");map.set(u.id,u.quantity);}
 if(!map.size)throw Error("没有可更新的数量 / No quantity updates");return existing.map(p=>map.has(p.id)?{...p,quantity:map.get(p.id)!}:p);
}
/** Never broaden a packaging whitelist or remove a physical accessory reference silently. */
export function assertOrderReferences(products:readonly ProductInput[],build:PalletBuildOptions|undefined,container:ContainerSpec){
 const ids=new Set(products.map(p=>p.id)),refs=[...(build?.primaryRule?.productIds??[]),...(build?.additionalSpecs?.flatMap(s=>s.productIds??[])??[]),...Object.keys(build?.looseQuantities??{}),...(container.exclusions?.flatMap(z=>z.accessory?.relatedProductIds??[])??[])];
 if(refs.some(id=>!ids.has(id)))throw Error("导入会移除包装或附件关联的订单行，请保留原 ID 或先清除关联 / Import removes packaging or accessory order references; preserve IDs or clear references first");
 if(products.some(p=>(build?.looseQuantities?.[p.id]??0)>p.quantity))throw Error("更新数量小于已指定的散装数量 / Updated quantity is below the reserved loose quantity");
}

export function planOrderRows(plan:PackingResult){
 const needed=plan.summaries.some(s=>plan.cargoDetails?.[s.productId]?.orderLine)||new Set(plan.summaries.map(s=>s.sku)).size<plan.summaries.length;
 return !needed?[]:plan.summaries.map(s=>({id:s.productId,sku:s.sku,requested:s.requested,loaded:s.loaded,line:{...EMPTY_ORDER_LINE,...plan.cargoDetails?.[s.productId]?.orderLine,...plan.delivery?.[s.productId]}}));
}
