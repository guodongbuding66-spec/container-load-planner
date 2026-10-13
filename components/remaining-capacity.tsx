"use client";
import {tr, useLanguage} from "./language";
import type { PackingResult } from "../lib/packing/types";
import { palletSpaceSummary } from "../lib/packing/floor-pallets";

type Props={result:PackingResult;pending?:boolean};
export function RemainingCapacity({result,pending=false}:Props) {
  useLanguage();
  if(pending||!result.validation.valid)return <section className="remaining-capacity" aria-label={tr("集装箱剩余容量")}><p role="status">{pending?tr("尺寸尚未提交，剩余容量将在计算完成后更新。"):tr("当前方案未通过校验，暂不提供剩余容量参考。")}</p></section>;
  const cargoVolume=result.summaries.reduce((n,s)=>n+s.loadedVolume,0),cargoWeight=result.summaries.reduce((n,s)=>n+s.loadedWeight,0);
  const space=palletSpaceSummary(result.container,result.clearance,result.pallets??[],cargoVolume,cargoWeight);
  const total=space.effectiveVolume/1e9,used=result.metrics.loadedVolume/1e9,remaining=space.remainingVolume/1e9;
  const remainingRatio=total>0?Math.min(1,remaining/total):0;
  const number=(n:number)=>n.toLocaleString("zh-CN",{maximumFractionDigits:1});
  return <section className="remaining-capacity" aria-label={tr("集装箱剩余容量")}>
    <div className="remaining-capacity-heading"><strong>{tr("集装箱剩余容量")}</strong><span>{result.strategy==="practical"?tr("现场易执行"):tr("高密度参考")}{tr(" · 完整方案")}</span></div>
    <div className="remaining-capacity-grid">
      <article><span>{tr("剩余有效容积")}</span><strong>{remaining.toFixed(2)} <small>m³ / CBM</small></strong><small>{tr("占有效容积 ")}{(remainingRatio*100).toFixed(1)}%</small></article>
      <article><span>{tr("已用 / 有效总容积")}</span><strong>{used.toFixed(2)} / {total.toFixed(2)} <small>m³</small></strong><small>{result.pallets?.length?tr("已用包含货物与托盘；净空已扣安全间隙"):tr("有效总容积已扣除安全间隙")}</small></article>
      <article><span>{tr("剩余可用载重")}</span><strong>{number(space.remainingWeight)} <small>kg</small></strong><small>{result.pallets?.length?tr("已扣已装货物毛重与托盘总自重"):tr("柜型上限减去已装货物毛重")}</small></article>
    </div>
    <details className="capacity-details"><summary>{tr("容量计算明细", "Capacity breakdown")}</summary>
    {!!result.pallets?.length&&<div className="pallet-capacity-equation" aria-label={tr("托盘空间扣除明细")}><span>{tr("有效净空 ")}<b>{total.toFixed(3)} m³</b></span><i>−</i><span>{tr("托盘占用 ")}<b>{(space.reservedVolume/1e9).toFixed(3)} m³</b></span><i>=</i><span>{tr("货物可用 ")}<b>{(space.cargoCapacity/1e9).toFixed(3)} m³</b></span><i>−</i><span>{tr("实际货物 ")}<b>{(cargoVolume/1e9).toFixed(3)} m³</b></span><i>=</i><span>{tr("剩余 ")}<b>{remaining.toFixed(3)} m³</b></span><small>{result.pallets.length}{tr(" 个托盘 · 总自重 ")}{number(space.tareWeight)}{tr(" kg · 货物可用载重 ")}{number(space.cargoPayload)} kg</small></div>}
    <p>{tr("剩余容积是各处空隙的合计，不代表一整块可用空间；继续加货还需校验尺寸、方向、承托和成套规则。播放进度与隐藏箱体不改变此数值。")}</p>
    </details>
  </section>;
}
