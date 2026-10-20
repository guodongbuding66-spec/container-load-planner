"use client";
import {useState} from "react";
import {EMPTY_ORDER_LINE,parseOrderLine,type OrderLine} from "../lib/packing/order-lines";
import type {ProductInput} from "../lib/packing/types";
import type {DeliveryMap} from "../lib/packing/access";
import {FeatureDialog} from "./feature-dialog";
import {NumericInput} from "./numeric-input";
import {tr,trText,useLanguage} from "./language";
export function OrderLineEditor({product,delivery,onSave,onCopy,onClose}:{product:ProductInput;delivery?:DeliveryMap;onSave:(line:OrderLine)=>void;onCopy:()=>void;onClose:()=>void}){
 useLanguage();const [draft,setDraft]=useState<OrderLine>(()=>({...EMPTY_ORDER_LINE,...product.orderLine,...(!product.orderLine?delivery?.[product.id]:{})})),[valid,setValid]=useState(true),[error,setError]=useState("");
 const fields=[["orderReference","订单编号","Order reference"],["lineReference","业务行号","Business line reference"],["batch","批次","Batch"],["customer","客户","Customer"],["destination","目的地","Destination"]] as const;
 return <FeatureDialog title={tr("订单行资料","Order-line details")} subtitle={product.sku} onClose={onClose} footer={<><button className="button" onClick={onClose}>{tr("取消","Cancel")}</button><button className="button primary" disabled={!valid} onClick={()=>{try{onSave(parseOrderLine(draft)!);}catch(e){setError(String(e instanceof Error?e.message:e));}}}>{tr("保存订单行","Save order line")}</button></>}>
  <p>{tr("相同 SKU 可以有多行；计算、数量更新与追踪使用下面的独立 ID。","The same SKU may occur on several rows. Calculation, quantity updates and tracking use this independent ID.")}</p>
  <label>{tr("稳定订单行 ID","Stable order-line ID")}<input aria-label={tr("稳定订单行 ID","Stable order-line ID")} value={product.id} readOnly/></label>
  <div className="tool-form-grid">{fields.map(([key,zh,en])=><label key={key}>{tr(zh,en)}<input aria-label={tr(zh,en)} value={draft[key]} maxLength={120} onChange={e=>setDraft(s=>({...s,[key]:e.target.value}))}/></label>)}<label>{tr("卸货站次（0 未填写）","Unload stop (0 unassigned)")}<NumericInput ariaLabel={tr("订单行卸货站次","Order-line unload stop")} value={draft.stop} min={0} max={999} integer onValueChange={stop=>setDraft(s=>({...s,stop}))} onValidityChange={setValid}/></label></div>
  <p>{tr("客户、批次与站次随工作区备份和订单行 CSV 保存。业务行号不是内部 ID。","Customer, batch and stop are saved with workspace backups and order-row CSV. The business reference is not the internal ID.")}</p>
  <button className="button" onClick={onCopy}>{product.setCode?.trim()?tr("复制完整套装为新订单行","Copy whole kit as new order rows"):tr("复制为新订单行","Copy as a new order row")}</button>
  <p>{tr("复制会增加需求数量，生成新 ID；业务行号留空，完整套装使用新套装编码。","Copying increases demand and creates new IDs. Business line references are cleared; whole kits receive a new kit code.")}</p>
  <p role="alert">{trText(error)}</p>
 </FeatureDialog>;
}
