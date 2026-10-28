"use client";
import {tailCandidateRows} from "../lib/packing/pallet-tail";
import type {PackingRequest,PackingResult} from "../lib/packing/types";
import {tr} from "./language";

export function TailCandidateReview({request,baseline,candidate}:{request:PackingRequest;baseline:PackingResult;candidate:PackingResult}){
 const rows=tailCandidateRows(request,baseline,candidate),sum=(key:Exclude<keyof typeof rows[number],"id"|"label">)=>rows.reduce((n,r)=>n+r[key],0);
 return <div className="tail-order-review">
  <p className="helper-text">{tr("逐行对照覆盖本单全部货物，包括未参与本次联合的订单行。散箱预留是打托前分配的数量，可能没有全部装入；实际散箱 + 托内箱 + 未装箱 = 原订单箱数。","Every original order row is included, even rows outside this search. A loose reservation is allocated before palletizing and may not all load; actual loose + palletized + unloaded equals original demand.")}</p>
  <div className="pallet-capacity-table tail-candidate-table" tabIndex={0} role="region" aria-label={tr("候选逐行数量对照","Candidate order-row quantities")}><table>
   <caption>{tr("候选逐行数量对照（箱）","Candidate order-row quantities (cartons)")}</caption>
   <thead><tr><th scope="col">{tr("订单行","Order row")}</th><th scope="col">{tr("原订单","Demand")}</th><th scope="col">{tr("已装：原 → 候选","Loaded: before → candidate")}</th><th scope="col">{tr("散箱预留：原 → 候选","Reserved loose: before → candidate")}</th><th scope="col">{tr("实际散箱","Actual loose")}</th><th scope="col">{tr("托内箱","Palletized")}</th><th scope="col">{tr("未装箱","Unloaded")}</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.id}><th scope="row">{r.label}</th><td>{r.requested}</td><td>{r.beforeLoaded} → {r.loaded}</td><td>{r.beforeReserved} → {r.reserved}</td><td>{r.loose}</td><td>{r.palletized}</td><td>{r.unloaded}</td></tr>)}</tbody>
   <tfoot><tr><th scope="row">{tr("合计","Total")}</th><td>{sum("requested")}</td><td>{sum("beforeLoaded")} → {sum("loaded")}</td><td>{sum("beforeReserved")} → {sum("reserved")}</td><td>{sum("loose")}</td><td>{sum("palletized")}</td><td>{sum("unloaded")}</td></tr></tfoot>
  </table></div>
 </div>;
}
