"use client";

import {useMemo,useState} from "react";
import {MAX_CONSOLIDATION_CARTONS,MAX_CONSOLIDATION_PALLETS,palletConsolidationUnits,type PalletConsolidationMove} from "../lib/packing/pallet-edit";
import type {PackingResult,ProductInput} from "../lib/packing/types";
import {tr,useLanguage} from "./language";
import {RecordPageControls,useRecordPage} from "./record-page";
import {palletSearchMessage,usePalletSearch} from "./use-pallet-search";
import type {PlanEditor} from "./use-plan-editor";

const round=(n:number)=>Math.round(n*1000)/1000;

function ConsolidationMoveTable({plan,moves}:{plan:PackingResult;moves:PalletConsolidationMove[]}){
  const rows=useMemo(()=>{
    const boxes=new Map(plan.placements.map(box=>[box.id,box]));
    return moves.map(move=>{
      const box=boxes.get(move.cartonId)!;
      const from=box.palletIds?.[0]??"";
      return {...move,from,sku:box.sku,search:[box.sku,box.id,from,move.targetId,box.setCode].join(" ")};
    });
  },[plan,moves]);
  const page=useRecordPage(rows,10);
  return <details>
    <summary>{tr("查看调整箱位","View changed positions")} · {moves.length}</summary>
    <RecordPageControls page={page} label={tr("搜索重排箱位","Search changed positions")} placeholder={tr("箱号、SKU 或托号","Carton ID, SKU or pallet ID")}/>
    <div className="coordinate-wrap record-table" role="region" aria-label={tr("调整箱位清单","Changed position list")} tabIndex={0}>
      <table className="coordinate-table">
        <thead><tr><th>SKU / ID</th><th>{tr("原托盘","Source pallet")}</th><th>{tr("目标托盘","Destination pallet")}</th><th>{tr("目标托内 X / Y / Z (mm)","Destination local X / Y / Z (mm)")}</th></tr></thead>
        <tbody>{page.rows.map(row=><tr key={row.cartonId}>
          <td>{row.sku}<small>{row.cartonId}</small></td><td>{row.from}</td><td>{row.targetId}</td><td>{[row.pose.x,row.pose.y,row.pose.z].map(round).join(" / ")}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

export function PalletConsolidationControls({editor,products,id,disabled,onPendingChange,onViewPallet}:{
  editor:PlanEditor;products:ProductInput[];id:string;disabled:boolean;onPendingChange:(pending:boolean)=>void;onViewPallet?:(id:string)=>void;
}) {
  useLanguage();
  const plan=editor.plan!;
  const rows=useMemo(()=>palletConsolidationUnits(plan).map(({pallet,cargo})=>({
    id:pallet.id,name:pallet.name,count:cargo.length,locked:pallet.locked,measured:!!pallet.measuredEnvelope,
    search:[pallet.id,pallet.name,...new Set(cargo.flatMap(b=>[b.sku,b.setCode]))].join(" "),
  })).sort((a,b)=>Number(b.id===id)-Number(a.id===id)||a.count-b.count||a.id.localeCompare(b.id)),[plan,id]);
  const page=useRecordPage(rows,8);
  const [selected,setSelected]=useState<string[]>([]);
  const chosen=rows.filter(row=>row.id===id||!row.locked&&!row.measured&&selected.includes(row.id));
  const chosenIds=chosen.map(row=>row.id);
  const cartonCount=chosen.reduce((n,row)=>n+row.count,0);
  const limited=cartonCount>MAX_CONSOLIDATION_CARTONS;
  const blocked=disabled||chosen.length<2||limited||chosen.some(row=>row.locked||row.measured);
  const preview=usePalletSearch("consolidate",plan,products,id,blocked,onPendingChange,chosenIds);
  const result=preview.result,candidate=result?.candidate;
  const toggle=(target:string,checked:boolean)=>setSelected(current=>checked?[...current,target]:current.filter(value=>value!==target));
  const apply=()=>{
    if(!candidate||blocked||!editor.palletEdit(id,candidate.edit))return;
    preview.clear();
    setSelected([]);
    if(candidate.edit.releaseId===id){
      const target=candidate.edit.moves[0]?.targetId??candidate.edit.palletIds.find(p=>p!==id)!;
      onViewPallet?.(target);
    }
  };
  if(rows.length<2)return null;
  const title=tr("跨托联合重排","Consolidate selected pallets");
  const validated=plan.palletization?.only?tr("打托校验通过","Pallet layout validated"):tr("整柜校验通过","Full plan validated");
  const status=preview.running?tr("正在试排所选托盘…","Searching the selected pallets…"):
    preview.message?palletSearchMessage(preview.message):candidate?`${tr("可释放","Can release")} ${candidate.edit.releaseId} · ${validated}`:
    result?.reason==="locked-cargo"?tr("各托均有锁定箱位。请选择还可释放的托盘。","All selected units hold locked cargo. Select a pallet that can be released."):
    result?.reason==="no-fit"?tr("本次试排未找到能减少一托的可行布局。","This trial found no valid layout with one fewer pallet."):"";
  return <details className="pallet-layout-copy pallet-consolidation" aria-label={title} onToggle={event=>{if(!event.currentTarget.open&&preview.running)preview.cancel();}}>
    <summary>{title}</summary>
    <p>{tr("勾选与本托一起试排的托盘。系统按整套转移货物，尝试腾出一托。","Select pallets to combine with this one. The search moves complete kits and tries to release one pallet.")}</p>
    <RecordPageControls page={page} label={tr("搜索参与托盘","Search participating pallets")} placeholder={tr("托号、SKU 或包装名称","Pallet ID, SKU or packaging name")}/>
    {page.rows.length>0&&<div className="coordinate-wrap record-table" role="region" aria-label={tr("参与托盘清单","Participating pallet list")} tabIndex={0}>
      <table className="coordinate-table">
        <thead><tr><th>{tr("选择","Select")}</th><th>{tr("托盘","Pallet")}</th><th>{tr("箱数","Cartons")}</th><th>{tr("状态","Status")}</th></tr></thead>
        <tbody>{page.rows.map(row=>{
          const checked=chosenIds.includes(row.id);
          return <tr key={row.id}>
            <td><input type="checkbox" aria-label={`${tr("参与联合重排","Include in consolidation")} ${row.id}`} checked={checked} disabled={disabled||preview.running||row.id===id||row.locked||row.measured||!checked&&chosen.length>=MAX_CONSOLIDATION_PALLETS} onChange={event=>toggle(row.id,event.currentTarget.checked)}/></td>
            <td><strong>{row.id}</strong><small>{row.name}</small></td><td>{row.count}</td>
            <td>{row.locked?tr("整托锁定","Pallet locked"):row.measured?tr("已有实测包络","Measured envelope"):row.id===id?tr("当前托","Current pallet"):tr("可参与","Eligible")}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    <div className="upgrade-actions">
      <button type="button" className="button" disabled={blocked||preview.running} onClick={preview.run}>{tr("预览联合重排","Preview consolidation")}</button>
      {preview.running&&<button type="button" className="button" onClick={preview.cancel}>{tr("取消联合试排","Cancel consolidation search")}</button>}
      <p>{tr("已选","Selected")} {chosen.length} {tr("托","pallets")} · {cartonCount} {tr("箱","cartons")} · {tr("每次最多 6 托、240 箱","Up to 6 pallets and 240 cartons per trial")}</p>
    </div>
    {limited&&<p role="status">{tr("已选箱数超过 240，请减少参与托盘。","The selection exceeds 240 cartons. Select fewer pallets.")}</p>}
    <p className="pallet-consolidation-status" role="status">{status}</p>
    {candidate&&<>
      <p>{tr("调整","Adjust")} {candidate.edit.moves.length} {tr("箱","cartons")} · {candidate.kitsMoved} {tr("套","kits")} · {tr("减少包装自重","Packaging tare saved")} {round(candidate.tareSavedKg)} kg</p>
      <div className="coordinate-wrap"><table className="coordinate-table">
        <thead><tr><th>{tr("托盘","Pallet")}</th><th>{tr("调整前 / 后箱数","Cartons before / after")}</th><th>{tr("调整后毛重 / 总高","New gross weight / height")}</th></tr></thead>
        <tbody>{candidate.units.map(row=><tr key={row.id}><td>{row.id}</td><td>{row.before} → {row.after}</td><td>{row.id===candidate.edit.releaseId?tr("拟释放","Release"):`${round(row.grossKg)} kg / ${round(row.heightMm)} mm`}</td></tr>)}</tbody>
      </table></div>
      {candidate.edit.moves.length>0&&<ConsolidationMoveTable plan={plan} moves={candidate.edit.moves}/>}
      <div className="upgrade-actions"><button type="button" className="button primary" disabled={blocked||preview.running} onClick={apply}>{tr("将联合重排写入草稿","Use consolidation in draft")}</button></div>
    </>}
    {!candidate&&result?.budgetReached&&<p>{tr("已达到本次试排预算，可缩小范围后重试。","The trial budget was reached. Try a smaller selection.")}</p>}
    {!candidate&&result?.issues.length? <details><summary>{tr("查看候选复核反馈","Review candidate validation")}</summary>{result.issues.map(issue=><p key={issue}>{palletSearchMessage(issue)}</p>)}</details>:null}
  </details>;
}
