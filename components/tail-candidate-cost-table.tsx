"use client";
import {useState} from "react";
import {tr} from "./language";
import type {TailCandidateCosts} from "../lib/packing/tail-cost-table";
import type {TailComparisonRow} from "../lib/packing/pallet-tail-report";

type Props={table:TailCandidateCosts;rows:readonly TailComparisonRow[];disabled:boolean;canApply:boolean;onAdopt?:(row:TailComparisonRow)=>boolean};
export function TailCandidateCostTable({table,rows,disabled,canApply,onAdopt}:Props){
 const [failed,setFailed]=useState(false),money=(n:number|null|undefined)=>n==null?tr("未核算","Unknown"):n.toFixed(2);
 return <section aria-label={tr("同量尾数候选费用比较","Costs for equal-delivery tail candidates")}>
  <h4>{tr("同量尾数候选费用比较","Costs for equal-delivery tail candidates")}</h4>
  <p role="status">{table.canRank?tr("各订单行已装数量相同的候选报价完整，已标出本批次最低配置费用（含并列）。","Quotes are complete for candidates with identical loaded quantities in every order row. The lowest configured cost in this batch is marked, including ties."):table.comparableCount<2?tr("可比候选不足两个，不能比较最低费用。","Fewer than two comparable candidates; no cost ranking is available."):tr("可比候选存在缺失报价或用量资料，暂不标记批次最低费用。","Comparable candidates have missing quotes or usage data; no batch minimum is marked.")} {tr("可比候选","Comparable candidates")}: {table.comparableCount} · {table.currency}</p>
  <div className="upgrade-table-wrap tabular-nums" tabIndex={0} role="region" aria-label={tr("候选配额费用明细","Candidate allocation costs")}><table><thead><tr>
   <th>{tr("散箱配额组合","Loose allocation")}</th><th>{tr("已装箱数","Loaded cartons")}</th><th>{tr("实际散箱","Actual loose")}</th><th>{tr("实际包装用量","Actual packaging usage")}</th><th>{tr("配置费用合计","Configured total")}</th><th>{tr("较数量优先候选","Versus quantity candidate")}</th><th>{tr("比较状态","Comparison status")}</th><th>{tr("操作","Action")}</th>
  </tr></thead><tbody>{table.rows.map(r=><tr key={r.index}>
   <th scope="row">{r.allocation}</th><td>{r.loaded??tr("未通过复核","Not validated")}</td><td>{r.loose??tr("未知","Unknown")}</td><td>{r.available?r.packages.filter(p=>p.quantity>0).map(p=>`${p.name} × ${p.quantity}`).join(" / ")||"0":tr("未知","Unknown")}</td>
   <td>{money(r.costs?.total)}{r.costs&&!r.costs.complete&&<small>{tr("已知小计","Known subtotal")}: {money(r.costs.knownSubtotal)}</small>}</td><td>{money(r.difference)}</td>
   <td>{r.current&&<strong>{tr("当前数量优先候选","Current quantity candidate")} · </strong>}{r.lowest?<strong>{tr("本批次同量最低","Lowest for equal delivery in this batch")}</strong>:!r.available?tr("用量缺失或未增加装量","Usage unavailable or no loading improvement"):!r.sameDelivery?tr("订单行数量不同，不参与排名","Different order-row quantities; excluded from ranking"):tr("同量候选","Equal-delivery candidate")}</td>
   <td><button type="button" className="button" aria-label={`${tr("采用配额","Apply allocation")} ${r.allocation} ${tr("并重新计算","and recalculate")}`} disabled={disabled||!canApply||!onAdopt||r.current||!r.sameDelivery||!r.costs?.complete} onClick={()=>{setFailed(!onAdopt?.(rows[r.index]));}}>{tr("采用此配额并重新计算","Apply allocation and recalculate")}</button></td>
  </tr>)}</tbody></table></div>
  <p className="helper-text">{tr("只对本批次通过模型复核、逐订单行不减量且交付数量与当前候选完全相同的配额比较费用。采用后重新打托、装柜和校验；正式结果以重新计算为准。表中最低不代表全局最优或完整交付总成本。","Compare costs only for model-reviewed allocations that retain each baseline row and deliver exactly the same quantities as the current candidate. Applying an allocation rebuilds, repacks and validates the plan; the recalculated result is authoritative. The batch minimum is neither a global optimum nor the full delivery cost.")}</p>
  {failed&&<p role="alert">{tr("该候选已失效，请重新运行当前试算。","This candidate is stale; rerun the current trial.")}</p>}
 </section>;
}
