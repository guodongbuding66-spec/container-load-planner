"use client";
import {getOrientations} from "../lib/packing/engine";
import type {ContainerSpec,ProductInput,PalletBuildOptions} from "../lib/packing/types";
import {palletSpecifications} from "../lib/packing/pallet-specifications";
import {packagingInterior} from "../lib/packing/packaging";
import {deckSupportMass,deckSupportHeight} from "../lib/packing/deck-support";
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
export function cargoPalletWarnings(products:readonly ProductInput[],build:PalletBuildOptions){
 const specs=palletSpecifications(build).filter(s=>s.maxPallets>0);
 return products.flatMap(p=>{
  if(p.quantity<=0)return [];
  const eligible=specs.filter(s=>!s.productIds||s.productIds.includes(p.id));
  const fitted=eligible.filter(s=>{const i=packagingInterior(s.config),h=s.config.maxCargoHeight??0;return getOrientations(p).some(o=>o.dx<=i.length&&o.dy<=i.width&&(!h||o.dz<=h-deckSupportHeight(s.config)));});
  const space=fitted.length>0;
  const weight=(space?fitted:eligible).some(s=>p.weight<=s.config.maxLoad-deckSupportMass(s.config));
  return !space||!weight?[{id:p.id,sku:p.sku,space:!space,weight:!weight}]:[];
 });
}
export function CargoSpaceWarnings({products,container,clearance,palletBuild}:{products:readonly ProductInput[];container:ContainerSpec;clearance:number;palletBuild?:PalletBuildOptions}){
 useLanguage();if(palletBuild){const rows=cargoPalletWarnings(products,palletBuild);return rows.length?<aside className="cargo-space-warnings" role="status" aria-label={tr("打托超限预警","Pallet limit warnings")}><strong>{tr("请核对货物与已选包装是否匹配","Check cargo against the selected packaging")}</strong><ul>{rows.map(r=><li key={r.id}><b>{r.sku}</b> · {[r.space&&tr("所有适用包装均无法容纳允许朝向的单箱","No eligible packaging fits an allowed carton orientation"),r.weight&&tr("单箱毛重超过适用托盘的可用载荷","One carton exceeds the eligible pallet payload")].filter(Boolean).join("；")}</li>)}</ul><small>{tr("按启用规格的内部底面、货物限高及扣除支承件后的载荷预警；累计载荷和完整套装仍需计算核验。","Checks enabled interiors, cargo ceilings and payload after supports. Cumulative loads and complete kits still require calculation.")}</small></aside>:null;}
 return <VehicleWarnings products={products} container={container} clearance={clearance}/>;
}
function VehicleWarnings({products,container,clearance}:{products:readonly ProductInput[];container:ContainerSpec;clearance:number}){
 useLanguage();const rows=cargoSpaceWarnings(products,container,clearance);if(!rows.length)return null;
 return <aside className="cargo-space-warnings" role="status" aria-label={tr("装载超限预警","Loading limit warnings")}>
  <strong>{tr("请核对以下货物的尺寸或重量","Check these cargo dimensions or weights")}</strong>
  <ul>{rows.map(r=><li key={r.id}><b>{r.sku}</b> · {[r.space&&tr("所有允许朝向均超出可用内尺","Every allowed orientation exceeds the usable interior"),r.door&&tr("按当前允许朝向无法通过门洞","Cannot pass the door in an allowed orientation"),r.weight&&tr("单箱毛重超过整柜净载重","One carton exceeds the vehicle payload")].filter(Boolean).join("；")}</li>)}</ul>
  <small>{tr("这是录入预警；不会修改订单。包装、累计载荷和实际摆放仍在计算时核验。","These input warnings do not change the order. Packaging, cumulative loads and final positions are checked during calculation.")}</small>
 </aside>;
}
