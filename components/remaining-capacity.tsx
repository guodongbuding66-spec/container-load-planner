"use client";
import {tr, useLanguage} from "./language";
import type { PackingResult } from "../lib/packing/types";
import { palletSpaceSummary } from "../lib/packing/floor-pallets";
import { useMemo } from "react";
import { packingCapacityPrefixes } from "../lib/packing/progress";

type Props={result:PackingResult;pending?:boolean;visibleCount?:number};
export function RemainingCapacity({result,pending=false,visibleCount=result.placements.length}:Props) {
  useLanguage();
  const prefixes=useMemo(()=>packingCapacityPrefixes(result),[result]);
  if(pending||!result.validation.valid)return <section className="remaining-capacity" aria-label={tr(result.workflow === "pallet-only" ? "托盘剩余容量" : "集装箱剩余容量", result.workflow === "pallet-only" ? "Pallet capacity remaining" : "Remaining container capacity")}><p role="status">{pending?tr("尺寸尚未提交，剩余容量将在计算完成后更新。"):tr("当前方案未通过校验，暂不提供剩余容量参考。")}</p></section>;
  const count=Math.max(0,Math.min(result.placements.length,Math.floor(visibleCount)));
  const cargoVolume=prefixes.volumes[count],cargoWeight=prefixes.weights[count];
  const space=palletSpaceSummary(result.container,result.clearance,result.pallets??[],cargoVolume,cargoWeight);
  if(result.workflow === "pallet-only") { space.effectiveVolume=result.metrics.effectiveVolume;space.cargoCapacity=Math.max(0,space.effectiveVolume-space.reservedVolume);space.remainingVolume=Math.max(0,space.cargoCapacity-cargoVolume); }
  const total=space.effectiveVolume/1e9,used=(cargoVolume+space.reservedVolume)/1e9,remaining=space.remainingVolume/1e9;
  const remainingRatio=total>0?Math.min(1,remaining/total):0;
  const number=(n:number)=>n.toLocaleString("zh-CN",{maximumFractionDigits:1});
  return <section className="remaining-capacity" aria-label={tr(result.workflow === "pallet-only" ? "托盘剩余容量" : "集装箱剩余容量", result.workflow === "pallet-only" ? "Pallet capacity remaining" : "Remaining container capacity")}>
    <div className="remaining-capacity-heading"><strong>{tr(result.workflow === "pallet-only" ? "托盘剩余容量" : "集装箱剩余容量", result.workflow === "pallet-only" ? "Pallet capacity remaining" : "Remaining container capacity")}</strong><span>{tr("当前装载", "Current load")} {count} / {result.placements.length} {tr("箱")}</span></div>
    <div className="remaining-capacity-grid">
      <article><span>{tr("剩余有效容积")}</span><strong>{remaining.toFixed(2)} <small>m³ / CBM</small></strong><small>{tr("占有效容积 ")}{(remainingRatio*100).toFixed(1)}%</small></article>
      <article><span>{tr("已用 / 有效总容积")}</span><strong>{used.toFixed(2)} / {total.toFixed(2)} <small>m³</small></strong><small>{result.pallets?.length?tr("已用包含货物与托盘；净空已扣安全间隙"):tr("有效总容积已扣除安全间隙")}</small></article>
      <article><span>{tr("剩余可用载重")}</span><strong>{number(space.remainingWeight)} <small>kg</small></strong><small>{result.pallets?.length?tr("已扣已装货物毛重与托盘总自重"):tr("柜型上限减去已装货物毛重")}</small></article>
    </div>
    <details className="capacity-details"><summary>{tr("容量计算明细", "Capacity breakdown")}</summary>
    {!!result.pallets?.length&&<div className="pallet-capacity-equation" aria-label={tr("托盘空间扣除明细")}><span>{tr("有效净空 ")}<b>{total.toFixed(3)} m³</b></span><i>−</i><span>{tr("托盘占用 ")}<b>{(space.reservedVolume/1e9).toFixed(3)} m³</b></span><i>=</i><span>{tr("货物可用 ")}<b>{(space.cargoCapacity/1e9).toFixed(3)} m³</b></span><i>−</i><span>{tr("实际货物 ")}<b>{(cargoVolume/1e9).toFixed(3)} m³</b></span><i>=</i><span>{tr("剩余 ")}<b>{remaining.toFixed(3)} m³</b></span><small>{result.pallets.length}{tr(" 个托盘 · 总自重 ")}{number(space.tareWeight)}{tr(" kg · 货物可用载重 ")}{number(space.cargoPayload)} kg</small></div>}
    <p>{tr("容量随装载进度实时更新；铺设的托盘始终计入占用和自重。隐藏或剖切不改变装载数量。剩余容积是各处空隙的合计；补货仍须通过尺寸、方向、承托和成套校验。", "Capacity follows loading progress; placed pallets always count toward space and tare. Hiding or sectioning does not change the load. Remaining volume is the sum of separate gaps; extra cargo still needs dimension, orientation, support and kit checks.")}</p>
    </details>
  </section>;
}
