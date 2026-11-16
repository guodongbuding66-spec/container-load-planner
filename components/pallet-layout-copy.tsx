"use client";

import {useMemo,useState} from "react";
import {PALLET_LAYOUT_ISSUE_TEXT,palletLayoutTargets} from "../lib/packing/pallet-edit";
import type {PackingResult} from "../lib/packing/types";
import {RecordPageControls,useRecordPage} from "./record-page";
import {tr,useLanguage} from "./language";

export function PalletLayoutCopy({plan,id,disabled,onCopy}:{
  plan:PackingResult;id:string;disabled:boolean;onCopy:(ids:string[])=>boolean|null;
}) {
  useLanguage();
  const rows=useMemo(()=>palletLayoutTargets(plan,id).filter(t=>t.issue!=="specification")
    .map(t=>({...t,search:`${t.id} ${t.name}`})),[plan,id]);
  const page=useRecordPage(rows,8);
  const [selected,setSelected]=useState<string[]>([]);
  const eligible=rows.filter(t=>!t.issue);
  const chosen=eligible.filter(t=>selected.includes(t.id)).map(t=>t.id);
  const title=tr("批量套用托内摆放","Copy pallet layout in bulk");
  if(!rows.length)return null;

  const toggle=(id:string,checked:boolean)=>setSelected(current=>checked?[...current,id]:current.filter(value=>value!==id));
  const copy=()=>{
    if(disabled||!chosen.length)return;
    if(onCopy(chosen))setSelected([]);
  };
  return <details className="pallet-layout-copy" aria-label={title}>
    <summary>{title} · {eligible.length} {tr("托可套用","eligible pallets")}</summary>
    <p>{tr("复制本托的托内位置和朝向。目标须有相同的包装规格、订单行与套装构成，原箱号和套号保留。","Copy local positions and orientations from this pallet. Targets must match the packaging, order rows and kit contents. Their carton and kit identifiers stay intact.")}</p>
    <RecordPageControls page={page} label={tr("搜索目标托盘","Search target pallets")} placeholder={tr("托号或包装名称","Pallet ID or packaging name")}/>
    {page.rows.length>0&&<div className="coordinate-wrap record-table pallet-layout-targets" role="region" aria-label={tr("目标托盘清单","Target pallet list")} tabIndex={0}>
      <table className="coordinate-table">
        <thead><tr><th>{tr("选择","Select")}</th><th>{tr("托盘","Pallet")}</th><th>{tr("箱数","Cartons")}</th><th>{tr("状态","Status")}</th></tr></thead>
        <tbody>{page.rows.map(row=><tr key={row.id}>
          <td><input type="checkbox" aria-label={`${tr("选择目标托盘","Select target pallet")} ${row.id}`} checked={chosen.includes(row.id)} disabled={disabled||!!row.issue} onChange={e=>toggle(row.id,e.currentTarget.checked)}/></td>
          <td><strong>{row.id}</strong><small>{row.name}</small></td><td>{row.count}</td>
          <td>{row.issue?tr(...PALLET_LAYOUT_ISSUE_TEXT[row.issue]):tr("可套用","Eligible")}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="upgrade-actions">
      <button type="button" className="button" disabled={disabled||!eligible.length||chosen.length===eligible.length} onClick={()=>setSelected(eligible.map(t=>t.id))}>{tr("全选可套用托盘","Select all eligible pallets")}</button>
      <button type="button" className="button" disabled={!chosen.length} onClick={()=>setSelected([])}>{tr("清除目标选择","Clear target selection")}</button>
      <button type="button" className="button primary" disabled={disabled||!chosen.length} onClick={copy}>{tr("套用到已选托盘","Copy to selected pallets")} · {chosen.length}</button>
    </div>
  </details>;
}
