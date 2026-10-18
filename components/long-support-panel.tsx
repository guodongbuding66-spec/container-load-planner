"use client";
import { useMemo } from "react";
import { inspectLongSupport, SUPPORT_ISSUES, type LongSupportRow } from "../lib/packing/long-support";
import type { PackingResult, ProductInput } from "../lib/packing/types";
import { tr, useLanguage } from "./language";
export const SUPPORT_STATES:Record<LongSupportRow["state"],[string,string]>={pass:["符合输入几何限制","Meets entered geometric limits"],fail:["不符合输入几何限制","Exceeds entered geometric limits"],unverified:["未核验","Unverified"]};
export function LongSupportPanel({plan,products}:{plan:PackingResult;products:readonly ProductInput[]}){
  useLanguage();const rows=useMemo(()=>inspectLongSupport(plan,products),[plan,products]);if(!rows.length)return null;
  const failed=rows.filter(r=>r.state==="fail").length,unknown=rows.filter(r=>r.state==="unverified").length;
  return <details className="long-support-report" open={failed>0||undefined}>
    <summary><strong>{tr("长条箱承托预检","Long-carton support preflight")}</strong> · {rows.length} {tr("箱","cartons")} · {failed} {tr("不符合","failed")} · {unknown} {tr("未核验","unverified")}</summary>
    <p>{tr("检查完整方案，不受播放、隐藏或剖切影响。蓝色为必须接触的支承带，绿色为已建模接触。托盘使用面板实体，不把板缝当实心；通用结构或非矩形接触不能视为已核验。不修改箱位或数量，材料强度仍未核验。","Checks the complete plan regardless of playback or visibility. Blue marks required bands; green marks modeled contact. Pallet boards are used, not solid deck envelopes. Generic bases and nonrectangular contact remain unverified. Placements and quantities are unchanged; material strength is unverified.")}</p>
    {rows.slice(0,80).map(row=><section key={row.id} className="long-support-row" data-support-state={row.state}>
      <h4>{row.sku} · {row.id} <span>{tr(...SUPPORT_STATES[row.state])}</span></h4>
      {row.profile&&<p>{tr("方向／来源／版本","Axis / source / revision")}: {row.profile.axis} · {row.profile.source||"—"} · {row.profile.revision||"—"}</p>}
      {row.length&&row.width&&<svg viewBox={`0 0 ${row.length} ${row.width}`} role="img" aria-label={tr("原始底面支承带与实际接触","Original-bottom bands and actual contact")} preserveAspectRatio="none"><rect width={row.length} height={row.width} fill="#eef3f5"/>{row.profile?.bands.map((b,i)=><rect key={`band-${i}`} x={b.start} width={b.end-b.start} height={row.width} fill="#d9e6ff" stroke="#3267ac" strokeWidth={(row.length??1)/500}/>)}{row.contacts.map((c,i)=><rect key={`contact-${i}`} x={c.start} y={c.low} width={c.end-c.start} height={c.high-c.low} fill="#328779" opacity=".65"/>)}</svg>}
      <p>{tr("每带接触比例","Band contact ratios")}: {row.bandRatios.length?row.bandRatios.map(n=>`${(Math.min(1,n)*100).toFixed(1)}%`).join(" / "):"—"} · {tr("中部最大悬跨／输入上限 mm","Largest internal span / entered limit mm")}: {row.spanMm?.toFixed(1)??"—"} / {row.profile?.maxSpanMm??"—"} · {tr("首尾悬挑／每端上限 mm","End overhangs / each-end limit mm")}: {row.overhangMm?.map(n=>n.toFixed(1)).join(" / ")??"—"} / {row.profile?.maxOverhangMm??"—"}</p>
      <p>{tr("接触来源","Contact sources")}: {row.supporterIds.join(" · ")||"—"}</p>
      {row.issues.length>0&&<ul>{row.issues.map(i=><li key={i}>{tr(...SUPPORT_ISSUES[i])}</li>)}</ul>}
    </section>)}
    {rows.length>80&&<p>{tr("页面仅显示前 80 箱；工作区和报告保留完整资料。","The page shows the first 80 cartons; workspace and reports retain complete data.")}</p>}
  </details>;
}
