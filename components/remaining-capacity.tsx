import type { PackingResult } from "../lib/packing/types";
import { palletSpaceSummary } from "../lib/packing/floor-pallets";

type Props={result:PackingResult;pending?:boolean};
export function RemainingCapacity({result,pending=false}:Props) {
  if(pending||!result.validation.valid)return <section className="remaining-capacity" aria-label="集装箱剩余容量"><p role="status">{pending?"尺寸尚未提交，剩余容量将在计算完成后更新。":"当前方案未通过校验，暂不提供剩余容量参考。"}</p></section>;
  const cargoVolume=result.summaries.reduce((n,s)=>n+s.loadedVolume,0),cargoWeight=result.summaries.reduce((n,s)=>n+s.loadedWeight,0);
  const space=palletSpaceSummary(result.container,result.clearance,result.pallets??[],cargoVolume,cargoWeight);
  const total=space.effectiveVolume/1e9,used=result.metrics.loadedVolume/1e9,remaining=space.remainingVolume/1e9;
  const remainingRatio=total>0?Math.min(1,remaining/total):0;
  const number=(n:number)=>n.toLocaleString("zh-CN",{maximumFractionDigits:1});
  return <section className="remaining-capacity" aria-label="集装箱剩余容量">
    <div className="remaining-capacity-heading"><strong>集装箱剩余容量</strong><span>{result.strategy==="practical"?"现场易执行":"高密度参考"} · 完整方案</span></div>
    <div className="remaining-capacity-grid">
      <article><span>剩余有效容积</span><strong>{remaining.toFixed(2)} <small>m³ / CBM</small></strong><small>占有效容积 {(remainingRatio*100).toFixed(1)}%</small></article>
      <article><span>已用 / 有效总容积</span><strong>{used.toFixed(2)} / {total.toFixed(2)} <small>m³</small></strong><small>{result.pallets?.length?"已用包含货物与托盘；净空已扣安全间隙":"有效总容积已扣除安全间隙"}</small></article>
      <article><span>剩余可用载重</span><strong>{number(space.remainingWeight)} <small>kg</small></strong><small>{result.pallets?.length?"已扣已装货物毛重与托盘总自重":"柜型上限减去已装货物毛重"}</small></article>
    </div>
    {!!result.pallets?.length&&<div className="pallet-capacity-equation" aria-label="托盘空间扣除明细"><span>有效净空 <b>{total.toFixed(3)} m³</b></span><i>−</i><span>托盘占用 <b>{(space.reservedVolume/1e9).toFixed(3)} m³</b></span><i>=</i><span>货物可用 <b>{(space.cargoCapacity/1e9).toFixed(3)} m³</b></span><i>−</i><span>实际货物 <b>{(cargoVolume/1e9).toFixed(3)} m³</b></span><i>=</i><span>剩余 <b>{remaining.toFixed(3)} m³</b></span><small>{result.pallets.length} 个托盘 · 总自重 {number(space.tareWeight)} kg · 货物可用载重 {number(space.cargoPayload)} kg</small></div>}
    <p>剩余容积是各处空隙的合计，不代表一整块可用空间；继续加货还需校验尺寸、方向、承托和成套规则。播放进度与隐藏箱体不改变此数值。</p>
  </section>;
}
