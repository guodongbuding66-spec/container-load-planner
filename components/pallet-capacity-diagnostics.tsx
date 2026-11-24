"use client";
import {useMemo,useState} from "react";
import {ExcelDataGrid,type GridColumn} from "./ui/excel-data-grid";
import {StatusBadge} from "./ui/status-badge";
import {inspectPalletCapacity} from "../lib/packing/pallet-capacity";
import {palletDiagnosticGroups,type CapacityRow} from "../lib/packing/pallet-diagnostic-groups";
import type {PackingResult} from "../lib/packing/types";
import {tr,useLanguage} from "./language";
type Row=CapacityRow&{search:string;count:number;detail?:boolean;members?:CapacityRow[]};
export function PalletCapacityDiagnostics({plan}:{plan?:PackingResult|null}){
 useLanguage();const report=useMemo(()=>plan?inspectPalletCapacity(plan):null,[plan]);
 const [grouped,setGrouped]=useState(true),[expanded,setExpanded]=useState<Set<string>>(new Set());
 if(!report||!plan)return null;
 const original:Row[]=report.rows.map(r=>({...r,count:1,search:`${r.id} ${r.name}`}));
 const rows:Row[]=grouped?palletDiagnosticGroups(plan,report.rows).flatMap((members,i)=>{
  if(members.length===1)return [{...members[0],count:1,search:`${members[0].id} ${members[0].name}`}];
  const id=`group-${i}-${members[0].id}`,group={...members[0],id,count:members.length,members,search:members.map(r=>`${r.id} ${r.name}`).join(" ")};
  return [group,...(expanded.has(id)?members.map(r=>({...r,count:1,detail:true,search:`${r.id} ${r.name}`})):[])];
 }):original;
 const quantity=(n:number|null)=>n===null?<StatusBadge tone="warning">{tr("未核验","Unverified")}</StatusBadge>:n.toFixed(1);
 const columns:GridColumn<Row>[]=[
  {id:"unit",header:tr("单元／规格","Unit / specification"),value:r=>r.members?`${r.members[0].id} … ${r.members.at(-1)!.id}`:r.id,render:r=><>{r.members?<button type="button" className="grid-expand" aria-expanded={expanded.has(r.id)} onClick={()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(r.id))next.delete(r.id);else next.add(r.id);return next;})}>{expanded.has(r.id)?tr("收起","Collapse"):tr("展开","Expand")} · {r.members[0].id} … {r.members.at(-1)!.id}</button>:<strong className={r.detail?"grid-child-unit":undefined}>{r.id}</strong>}<small>{r.name}</small></>},
  {id:"units",header:tr("托数","Units"),numeric:true,value:r=>r.count},
  {id:"size",header:tr("底座尺寸 mm","Base size mm"),value:r=>`${r.length} × ${r.width} × ${r.baseHeight}`},
  {id:"cartons",header:tr("箱数／托","Cartons / unit"),numeric:true,value:r=>r.cartons},
  {id:"mass",header:tr("货重 kg／托","Cargo kg / unit"),numeric:true,value:r=>r.cargoKg,render:r=>quantity(r.cargoKg)},
  {id:"capacity",header:tr("额定载荷 kg／托","Payload kg / unit"),numeric:true,value:r=>r.capacityKg,render:r=>quantity(r.capacityKg)},
  {id:"margin",header:tr("载荷余量 kg／托","Margin kg / unit"),numeric:true,value:r=>r.remainingKg,render:r=><>{quantity(r.remainingKg)}{r.reasons.length>0&&<small>{tr("资料需复核","Review evidence")}</small>}</>},
  {id:"height",header:tr("货物堆高 mm","Cargo height mm"),numeric:true,value:r=>r.cargoHeight,render:r=>r.cargoHeight.toFixed(1)}
 ];
 return <div className="pallet-capacity-diagnostics" aria-label={tr("整托占地与载荷诊断","Loaded-unit footprint and payload diagnosis")}>
  <p><strong>{report.rows.length} {tr("托／箱体单元","loaded units")}</strong> · {tr("底座投影","Base projection")} <strong>{report.baseCoverage===null?"—":`${(report.baseCoverage*100).toFixed(1)}%`}</strong> · {tr("托内额定载荷使用率","Own-cargo payload use")} <strong>{report.payloadUtilization===null?<StatusBadge tone="warning">{tr("未核验","Unverified")}</StatusBadge>:`${(report.payloadUtilization*100).toFixed(1)}%`}</strong></p>
  <p className="helper-text">{tr("底座投影按柜内净长 × 净宽计算，叠放不重复计面积；未扣禁占区，也不代表可补货空间。载荷使用率只解释当前已入柜单元。","Base projections use net vehicle length × width, count stacked overlaps once, and do not subtract site exclusions or establish usable voids. Payload use describes currently loaded units only.")}</p>
  <details><summary>{tr("逐托占地、装箱数与载荷明细","Unit dimensions, carton counts and payload details")}</summary>
   <label className="grid-group-toggle"><input type="checkbox" checked={grouped} onChange={e=>setGrouped(e.target.checked)}/>{tr("合并同类托盘","Group identical pallets")}</label>
   <p className="helper-text">{tr("合并行显示每托数值；展开可查看全部托号。复制和 Excel 始终包含全部原始明细。","Grouped rows show per-unit values. Expand to see each unit. Copy and Excel always include every original row.")}</p>
   <ExcelDataGrid rows={rows} columns={columns} exportRows={original} label={tr("搜索载荷明细","Search payload details")}/>
   {report.looseCartons>0&&<p>{tr("另有散箱","Loose cartons")}: {report.looseCartons}</p>}{report.unassignedCartons>0&&<p role="status">{tr("整托关联未完整核对","Unresolved unit associations")}: {report.unassignedCartons}</p>}
   <p className="helper-text">{tr("托内可用额定载荷已扣新增支承件重量；余量仅作算术诊断，不替代承托、累计上压或运输固定校验。叠托、实测包络或关联不完整时不显示可用余量。","Rated own-cargo capacity subtracts added deck support mass. Margins are arithmetic diagnostics, not support, cumulative top-load or securing checks. No margin is stated for stacked units, measured envelopes or unresolved associations.")}</p>
  </details>
 </div>;
}
