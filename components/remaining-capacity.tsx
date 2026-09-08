import type { PackingResult } from "../lib/packing/types";

type Props = { result: PackingResult; pending?: boolean };

export function RemainingCapacity({ result, pending = false }: Props) {
  if (pending) return (
    <section className="remaining-capacity" aria-label="集装箱剩余容量">
      <p role="status">尺寸尚未提交，剩余容量将在计算完成后更新。</p>
    </section>
  );
  if (!result.validation.valid) return (
    <section className="remaining-capacity" aria-label="集装箱剩余容量">
      <p role="status">当前方案未通过校验，暂不提供剩余容量参考。</p>
    </section>
  );
  // Use the selected coordinate plan's exact mm³ totals; do not subtract
  // requested cargo, quotation-rounded CBM, or animation-visible cartons.
  const total = result.metrics.effectiveVolume / 1_000_000_000;
  const used = result.metrics.loadedVolume / 1_000_000_000;
  const remaining = Math.max(0, total - used);
  const remainingWeight = Math.max(0, result.container.maxWeight - result.metrics.grossWeight);
  const remainingRatio = total > 0 ? Math.min(1, remaining / total) : 0;
  const strategy = result.strategy === "practical" ? "现场易执行" : "高密度参考";
  return (
    <section className="remaining-capacity" aria-label="集装箱剩余容量">
      <div className="remaining-capacity-heading"><strong>集装箱剩余容量</strong><span>{strategy} · 完整方案</span></div>
      <div className="remaining-capacity-grid">
        <article><span>剩余有效容积</span><strong>{remaining.toFixed(2)} <small>m³ / CBM</small></strong><small>占有效容积 {(remainingRatio * 100).toFixed(1)}%</small></article>
        <article><span>已用 / 有效总容积</span><strong>{used.toFixed(2)} / {total.toFixed(2)} <small>m³</small></strong><small>有效总容积已扣除安全间隙</small></article>
        <article><span>剩余可用载重</span><strong>{remainingWeight.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} <small>kg</small></strong><small>柜型上限减去已装货物毛重</small></article>
      </div>
      <p>剩余容积是各处空隙的合计，不代表一整块可用空间；继续加货还需校验尺寸、方向、承托和成套规则。播放进度与隐藏箱体不改变此数值。</p>
    </section>
  );
}
