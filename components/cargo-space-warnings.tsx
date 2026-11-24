"use client";
import {getOrientations} from "../lib/packing/engine";
import type {ContainerSpec,ProductInput} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

export function cargoSpaceWarnings(products:readonly ProductInput[],container:ContainerSpec,clearance:number){
 const length=container.length-2*clearance,width=container.width-2*clearance,height=container.height-clearance;
 return products.flatMap(p=>{
  if(p.quantity<=0)return [];
  const orientations=getOrientations(p);
  const space=orientations.some(o=>o.dx<=length&&o.dy<=width&&o.dz<=height);
  const door=container.loadingAccess==="open"||orientations.some(o=>o.dx<=length&&o.dy<=Math.min(width,container.doorWidth-2*clearance)&&o.dz<=Math.min(height,container.doorHeight-clearance));
  return !space||!door||p.weight>container.maxWeight?[{id:p.id,sku:p.sku,space:!space,door:space&&!door,weight:p.weight>container.maxWeight}]:[];
 });
}
export function CargoSpaceWarnings({products,container,clearance}:{products:readonly ProductInput[];container:ContainerSpec;clearance:number}){
 useLanguage();const rows=cargoSpaceWarnings(products,container,clearance);if(!rows.length)return null;
 return <aside className="cargo-space-warnings" role="status" aria-label={tr("装载超限预警","Loading limit warnings")}>
  <strong>{tr("请核对以下货物的尺寸或重量","Check these cargo dimensions or weights")}</strong>
  <ul>{rows.map(r=><li key={r.id}><b>{r.sku}</b> · {[r.space&&tr("所有允许朝向均超出可用内尺","Every allowed orientation exceeds the usable interior"),r.door&&tr("按当前允许朝向无法通过门洞","Cannot pass the door in an allowed orientation"),r.weight&&tr("单箱毛重超过整柜净载重","One carton exceeds the vehicle payload")].filter(Boolean).join("；")}</li>)}</ul>
  <small>{tr("这是录入预警；不会修改订单。包装、累计载荷和实际摆放仍在计算时核验。","These input warnings do not change the order. Packaging, cumulative loads and final positions are checked during calculation.")}</small>
 </aside>;
}
