"use client";
import { useMemo } from "react";
import { CRATE_STACK_STATE_TEXT, planCrateStackReview } from "../lib/packing/crate-auto-stack";
import type { PackingResult } from "../lib/packing/types";
import { tr, useLanguage } from "./language";

export function CrateActualStackReport({plan}:{plan:PackingResult}) {
  useLanguage();const report=useMemo(()=>planCrateStackReview(plan),[plan]);
  if(!report.cells.length)return null;
  return <section className="crate-stack-report" aria-label={tr("木箱实际叠放静载复核","Actual crate stack static review")}>
    <h3>{tr("木箱实际叠放静载复核","Actual crate stack static review")}</h3>
    <p>{tr("以下使用完整当前方案，查看筛选不改变结果。额定资料状态与实际叠放结果分开；每条路径均按本箱及全部上层毛重的总和核对。","Uses the complete current plan, independently of view filters. Evidence review and actual stacking results are separate. Each path is checked against this crate plus all upper gross mass.")}</p>
    <div className="upgrade-table-wrap"><table><thead><tr>{[tr("木箱","Crate"),tr("实际复核","Actual review"),tr("支承木箱／层","Supporting crate / tier"),tr("累计上压 kg","Cumulative top kg"),tr("每条路径总载荷上界 kg","Through-load bound for EACH path kg")].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.cells.map(c=><tr key={c.id}><th>{c.id}</th><td>{tr(...CRATE_STACK_STATE_TEXT[c.state])}</td><td>{c.supporterId??tr("柜底","Floor")} / {c.level}</td><td>{c.topLoadKg.toFixed(2)}</td><td>{c.throughLoadBoundKg.toFixed(2)}</td></tr>)}</tbody></table></div>
    {report.errors.length>0&&<ul role="alert">{report.errors.map(e=><li key={e}>{e}</li>)}</ul>}
    <p className="helper-text">{tr("不把每条路径上界相加计重；不核验材料、连接件、柜底局压、绑扎或运输动态强度。","Path bounds are not added as cargo weight. Material, joints, local floor pressure, securing and transport dynamics are unverified.")}</p>
  </section>;
}
