"use client";
import {inspectPalletCapacity} from "../lib/packing/pallet-capacity";
import type {PackingResult} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

export function PalletCapacityDiagnostics({plan}:{plan?:PackingResult|null}){
 useLanguage();const report=plan?inspectPalletCapacity(plan):null;if(!report)return null;
 const kg=(n:number|null)=>n===null?tr("未核验","Unverified"):`${n.toFixed(1)} kg`;
 return <div className="pallet-capacity-diagnostics" aria-label={tr("整托占地与载荷诊断","Loaded-unit footprint and payload diagnosis")}>
  <p><strong>{report.rows.length} {tr("托／箱体单元","loaded units")}</strong> · {tr("底座投影","Base projection")} <strong>{report.baseCoverage===null?"—":`${(report.baseCoverage*100).toFixed(1)}%`}</strong> · {tr("托内额定载荷使用率","Own-cargo payload use")} <strong>{report.payloadUtilization===null?tr("未核验","Unverified"):`${(report.payloadUtilization*100).toFixed(1)}%`}</strong></p>
  <p className="helper-text">{tr("底座投影按柜内净长 × 净宽计算，叠放不重复计面积；未扣禁占区，也不代表可补货空间。载荷使用率只解释当前已入柜单元。","Base projections use net vehicle length × width, count stacked overlaps once, and do not subtract site exclusions or establish usable voids. Payload use describes currently loaded units only.")}</p>
  <details><summary>{tr("逐托占地、装箱数与载荷明细","Unit dimensions, carton counts and payload details")}</summary>
   <div className="table-scroll"><table><thead><tr><th>{tr("单元／规格","Unit / specification")}</th><th>{tr("底座尺寸 mm","Base size mm")}</th><th>{tr("托内箱数","Cartons")}</th><th>{tr("货物重量","Cargo mass")}</th><th>{tr("托内可用额定载荷","Rated own-cargo capacity")}</th><th>{tr("托内载荷余量","Own-cargo payload margin")}</th><th>{tr("货物堆高 mm","Cargo height mm")}</th></tr></thead>
    <tbody>{report.rows.map(r=><tr key={r.id}><td>{r.id}<br/>{r.name}</td><td>{r.length} × {r.width} × {r.baseHeight}</td><td>{r.cartons}</td><td>{kg(r.cargoKg)}</td><td>{kg(r.capacityKg)}</td><td>{kg(r.remainingKg)}{r.reasons.length>0&&<small>{tr("叠托、实测包络、关联或质量资料需复核","Review stacked units, measured envelopes, associations or mass data")}</small>}</td><td>{r.cargoHeight.toFixed(1)}</td></tr>)}</tbody></table></div>
   {report.looseCartons>0&&<p>{tr("另有散箱","Loose cartons")}: {report.looseCartons}</p>}{report.unassignedCartons>0&&<p role="status">{tr("整托关联未完整核对","Unresolved unit associations")}: {report.unassignedCartons}</p>}
   <p className="helper-text">{tr("托内可用额定载荷已扣新增支承件重量；余量仅作算术诊断，不替代承托、累计上压或运输固定校验。叠托、实测包络或关联不完整时不显示可用余量。","Rated own-cargo capacity subtracts added deck support mass. Margins are arithmetic diagnostics, not support, cumulative top-load or securing checks. No margin is stated for stacked units, measured envelopes or unresolved associations.")}</p>
  </details>
 </div>;
}
