"use client";
import type { ResultAudit, AuditCheckId } from "../lib/packing/result-audit";
import { tr, useLanguage } from "./language";
const TITLES:Record<AuditCheckId,[string,string]>={
  records:["追踪标识","Tracking identifiers"],products:["产品与模型来源","Product and model provenance"],dimensions:["尺寸与坐标边界","Dimensions and position bounds"],quantities:["数量与订单","Counts and order"],weight:["货物与包装重量","Cargo and packaging mass"],volume:["体积与包装预留","Volume and packaging reservation"],capacity:["利用率统计基准","Utilization denominators"],packaging:["包装结构与整托归属","Packaging and unit membership"],kits:["套装完整性","Kit completeness"],strength:["承重资料完整性","Bearing-data completeness"]
};
export function ResultAuditPanel({report}:{report:ResultAudit}){
  useLanguage();
  return <details className={`result-audit ${report.hasErrors?"has-errors":""}`} open={report.hasErrors||undefined}>
    <summary><strong>{tr("方案数据一致性","Plan data consistency")}</strong><span>{report.passed} {tr("项一致","passed")} · {report.unverified} {tr("项待复核","need review")}{report.failed>0&&` · ${report.failed} ${tr("项不一致","failed")}`}</span></summary>
    <p>{tr("按完整方案核对，播放、隐藏和剖切不改变结论。此报告核对数据一致性，不替代碰撞校验、实机画面验收或材料强度试验。","Checks use the complete plan; playback, hiding and sectioning do not change them. This report checks data consistency and does not replace collision validation, real-device visual testing or material-strength tests.")}</p>
    <ul>{report.checks.map(c=><li key={c.id} data-audit-check={c.id} data-audit-state={c.state}><div><strong>{tr(...TITLES[c.id])}</strong><span className={`audit-state ${c.state}`}>{c.state==="pass"?tr("一致","Passed"):c.state==="fail"?tr("不一致","Failed"):tr("待复核","Needs review")}</span></div><p>{tr(...c.message)}</p>{c.items.length>0&&<small>{c.items.join(" · ")}</small>}</li>)}</ul>
    {report.hasErrors&&<p role="alert">{tr("数据存在不一致，已暂停本页的方案导出。请重新计算，或修正原始资料后再生成方案。","Inconsistent data was found. Plan exports on this page are paused. Recalculate or correct the source data before generating a new plan.")}</p>}
  </details>;
}
