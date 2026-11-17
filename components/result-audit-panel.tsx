"use client";
import type { ResultAudit, AuditCheckId } from "../lib/packing/result-audit";
import { REVIEW_STATES, REVIEW_TITLES, type PlanReview } from "../lib/packing/plan-review";
import type { PathIssue } from "../lib/packing/access";
import type { PackingResult } from "../lib/packing/types";
import { SITE_EXCLUSION_PREFIX } from "../lib/packing/site-exclusions";
import { tr, trText, useLanguage } from "./language";
const TITLES:Record<AuditCheckId,[string,string]>={
  records:["追踪标识","Tracking identifiers"],products:["产品与模型来源","Product and model provenance"],dimensions:["尺寸与坐标边界","Dimensions and position bounds"],quantities:["数量与订单","Counts and order"],weight:["货物与包装重量","Cargo and packaging mass"],volume:["体积与包装预留","Volume and packaging reservation"],capacity:["利用率统计基准","Utilization denominators"],packaging:["包装结构与整托归属","Packaging and unit membership"],kits:["套装完整性","Kit completeness"],strength:["承重资料完整性","Bearing-data completeness"],engineering:["地板载荷与配重","Floor load and balance"]
};
const ACCESS_REASONS: Record<PathIssue["reason"],[string,string]> = {
  door:["最终箱位无法沿直线通过门洞","Cannot pass the door in a straight line at this position"],
  blocked:["通道有占挡","Travel path is blocked"],
  support:["仍承托上层货物","Cargo above still needs this support"],
  unassigned:["未填写卸货站次","Unload stop is missing"],
  "mixed-stop":["同一托货物分属多个卸货站","The pallet contains cargo for multiple unload stops"],
  search:["有限搜索未验证可行路径","The bounded search did not verify a route"],
};

export function PlanReviewPanel({report,plan,onLocate}:{report:PlanReview;plan?:PackingResult;onLocate?:(id:string)=>void}){
  useLanguage();
  const refs=new Map<string,{label:string;locatable:boolean}>();
  plan?.placements.forEach((box,index)=>{
    const name=`#${index+1}`;
    refs.set(box.id,{label:`${box.sku} · ${tr("箱","Carton")} ${name}`,locatable:true});
    refs.set(box.productId,{label:box.sku,locatable:false});
  });
  plan?.pallets?.forEach((pallet,index)=>refs.set(pallet.id,{label:`${tr("整托","Pallet")} ${index+1} · ${pallet.name}`,locatable:true}));
  plan?.container.exclusions?.forEach(row=>{
    const ref={label:row.name,locatable:false};
    refs.set(row.id,ref);refs.set(SITE_EXCLUSION_PREFIX+row.id,ref);
  });
  const showRef=(id:string)=>{
    const ref=refs.get(id);
    if(ref?.locatable&&onLocate)return <button type="button" className="review-locate-button" onClick={()=>onLocate(id)} aria-label={`${tr("定位","Locate")} ${ref.label}`}>{ref.label}</button>;
    return ref?.label??trText(id);
  };
  return <details className={`result-audit ${report.failed?"has-errors":""}`} open={report.failed>0||undefined}>
    <summary><strong>{tr("方案复核", "Plan review")}</strong><span>{report.passed} {tr("项通过", "passed")} · {report.unverified} {tr("项未核验", "unverified")}{report.failed>0&&` · ${report.failed} ${tr("项不通过", "failed")}`}</span></summary>
    <p>{tr("按完整方案复核。通过仅适用于下列模型范围；未核验项仍需补充资料或现场确认。", "Reviews the complete plan. A pass applies only to the stated model scope; unverified checks need data or on-site confirmation.")}</p>
    <ul>{report.checks.map(c=><li key={c.id} data-review-check={c.id} data-review-state={c.state}><div><strong>{tr(...REVIEW_TITLES[c.id])}</strong><span className={`audit-state ${c.state}`}>{tr(...REVIEW_STATES[c.state])}</span></div><p>{tr(...c.scope)}</p>
      {c.pathIssues?.length ? <ol className="review-issue-list">{c.pathIssues.slice(0,8).map((issue,i)=><li key={`${issue.id}/${issue.phase}/${issue.reason}/${i}`}>
        {showRef(issue.id)} · {issue.phase==="load"?tr("装货","Loading"):tr("卸货","Unloading")} · {tr(...ACCESS_REASONS[issue.reason])}
        {issue.obstacles.length>0&&<small>{tr("关联单元","Related units")} {issue.obstacles.slice(0,4).map((id,index)=><span key={id}>{index>0&&" · "}{showRef(id)}</span>)}{issue.obstacles.length>4&&` +${issue.obstacles.length-4}`}</small>}
      </li>)}</ol>:c.items.length>0&&<small>{c.items.slice(0,8).map((item,i)=><span key={i}>{i>0&&" · "}{showRef(item)}</span>)}</small>}
      {c.items.length>8&&<small>{tr("仅显示前 8 项","First 8 shown")} · {c.items.length} {tr("条","records")}</small>}
    </li>)}</ul>
  </details>;
}
export function ResultAuditPanel({report}:{report:ResultAudit}){
  useLanguage();
  return <details className={`result-audit ${report.hasErrors?"has-errors":""}`} open={report.hasErrors||undefined}>
    <summary><strong>{tr("方案数据一致性","Plan data consistency")}</strong><span>{report.passed} {tr("项一致","passed")} · {report.unverified} {tr("项待复核","need review")}{report.failed>0&&` · ${report.failed} ${tr("项不一致","failed")}`}</span></summary>
    <p>{tr("按完整方案核对，播放、隐藏和剖切不改变结论。此报告核对数据一致性，不替代碰撞校验、实机画面验收或材料强度试验。","Checks use the complete plan; playback, hiding and sectioning do not change them. This report checks data consistency and does not replace collision validation, real-device visual testing or material-strength tests.")}</p>
    <ul>{report.checks.map(c=><li key={c.id} data-audit-check={c.id} data-audit-state={c.state}><div><strong>{tr(...TITLES[c.id])}</strong><span className={`audit-state ${c.state}`}>{c.state==="pass"?tr("一致","Passed"):c.state==="fail"?tr("不一致","Failed"):tr("待复核","Needs review")}</span></div><p>{tr(...c.message)}</p>{c.items.length>0&&<small>{c.items.join(" · ")}</small>}</li>)}</ul>
    {report.hasErrors&&<p role="alert">{tr("数据存在不一致，已暂停本页的方案导出。请重新计算，或修正原始资料后再生成方案。","Inconsistent data was found. Plan exports on this page are paused. Recalculate or correct the source data before generating a new plan.")}</p>}
  </details>;
}
