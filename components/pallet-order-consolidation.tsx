"use client";

import {useState} from "react";
import {Layers3} from "lucide-react";
import {MAX_ORDER_RELEASES} from "../lib/packing/pallet-edit";
import type {PackingResult,ProductInput} from "../lib/packing/types";
import {FeatureDialog} from "./feature-dialog";
import {tr,useLanguage} from "./language";
import {palletSearchMessage,usePalletSearch} from "./use-pallet-search";
import {usePlanEditor} from "./use-plan-editor";

type Props={
  plan:PackingResult;products:ProductInput[];disabled:boolean;preparation?:boolean;onAdopt:(plan:PackingResult)=>void;
};

const displayNumber=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:1});

export function PalletOrderConsolidationButton(props:Props){
  useLanguage();
  const [open,setOpen]=useState(false);
  const {plan,products,disabled,preparation,onAdopt}=props;
  if(!plan.palletization||!products.length||(plan.pallets?.length??0)<2)return null;
  const loading=!(preparation||plan.palletization.only);
  const title=loading?tr("已入柜减托","Consolidate loaded pallets"):tr("全单自动减托","Consolidate order pallets");
  return <>
    <button type="button" className="button" disabled={disabled||!plan.validation.valid} onClick={()=>setOpen(true)}><Layers3 size={16}/>{title}</button>
    {open&&<PalletOrderConsolidationDialog {...props} key={plan.id} loading={loading} title={title}
      onClose={()=>setOpen(false)} onAdopt={next=>{onAdopt(next);setOpen(false);}}/>}
  </>;
}

function PalletOrderConsolidationDialog({plan,products,disabled,preparation,onAdopt,loading,title,onClose}:Props&{
  loading:boolean;title:string;onClose:()=>void;
}){
  const editor=usePlanEditor(plan,products,disabled,onAdopt);
  const draft=editor.plan!;
  const eligible=draft.pallets!.filter(p=>!p.locked&&!p.measuredEnvelope);
  const blocked=disabled||eligible.length<2;
  const preview=usePalletSearch("order-consolidate",draft,products,"",blocked);
  const candidate=preview.result?.candidate;
  const released=new Set(candidate?.edit.steps.map(step=>step.releaseId));
  const useDraft=()=>{
    if(candidate&&editor.palletOrderEdit(candidate.edit))preview.clear();
  };
  const status=preview.running?tr("正在搜索可合并的尾托…","Searching for partial pallets to combine…"):
    preview.message?palletSearchMessage(preview.message):candidate?tr("减托候选通过坐标及装载校验。","The consolidation candidate passed layout validation."):
    preview.result?tr("本轮没有找到可通过校验的减托方案。","This search found no valid reduction."):
    blocked&&!disabled?tr("至少需要两托未锁定且未录入实测包络的托盘。","At least two unlocked pallets without measured envelopes are required."):"";

  return <FeatureDialog wide title={title} onClose={onClose} footer={<>
    <button type="button" className="button" onClick={onClose}>{tr("取消并关闭","Cancel and close")}</button>
    <button type="button" className="button primary" disabled={!editor.changed||disabled||preview.running} onClick={editor.apply}>
      {preparation?tr("应用托内布置","Apply pallet layout"):tr("采用托内调整","Apply pallet edits")}
    </button>
  </>}>
    <section className="order-consolidation-preview" aria-label={tr("全单减托预览","Order consolidation preview")}>
      <p className="helper-text">{loading
        ?tr("试排当前方案中已入柜的整托，保留整套货物、箱号和固定箱位。装柜前可在整体打托预览中检查所有已生成托盘。","Check pallets loaded in the current plan, retaining complete kits, carton IDs and fixed positions. The pre-load pallet preview covers all prepared units.")
        :tr("自动检查本次生成的所有规格及托盘，尝试合并尾托。货量、箱号、整套货物和固定箱位会保留。","Search across prepared pallets and specifications to combine partial units. Carton quantities, IDs, complete kits and fixed positions are retained.")}</p>
      <div className="order-consolidation-count"><strong>{draft.pallets!.length} {tr("托","pallets")} · {draft.metrics.loadedCount} {tr("箱","cartons")}</strong>
        {eligible.length<draft.pallets!.length&&<small>{draft.pallets!.length-eligible.length} {tr("托已锁定或已有实测包络","pallets locked or measured")}</small>}
      </div>
      <div className="upgrade-actions">
        <button type="button" className="button" data-dialog-autofocus disabled={blocked||preview.running} onClick={preview.run}>{tr("预览减托建议","Preview pallet reduction")}</button>
        {preview.running&&<button type="button" className="button" onClick={preview.cancel}>{tr("停止试排","Stop search")}</button>}
        <button type="button" className="button" disabled={disabled||!editor.undo.length||preview.running} onClick={editor.undoEdit}>{tr("撤销","Undo")}</button>
        <button type="button" className="button" disabled={disabled||!editor.redo.length||preview.running} onClick={editor.redoEdit}>{tr("重做","Redo")}</button>
      </div>
      <p role="status">{status}</p>
      {candidate&&<>
        <dl className="order-consolidation-metrics">
          <div><dt>{tr("整托数量","Pallets")}</dt><dd>{candidate.beforePallets} → {candidate.afterPallets}</dd></div>
          <div><dt>{tr("保留货量","Retained cartons")}</dt><dd>{candidate.cartons}</dd></div>
          <div><dt>{tr("减少包装自重","Packaging tare saved")}</dt><dd>{displayNumber(candidate.tareSavedKg)} kg</dd></div>
        </dl>
        <details className="record-disclosure">
          <summary><span>{tr("查看受影响托盘","Review affected pallets")}</span><small>{candidate.units.length} {tr("托","pallets")} · {candidate.changedCartons} {tr("箱参与调整","cartons moved")}</small></summary>
          <div className="coordinate-wrap record-table" role="region" aria-label={tr("减托前后明细","Before and after pallet list")} tabIndex={0}>
            <table className="coordinate-table"><thead><tr>
              <th>{tr("托盘","Pallet")}</th><th>{tr("调整前 / 后箱数","Cartons before / after")}</th>
              <th>{tr("调整后毛重 / 总高","New gross weight / height")}</th>
            </tr></thead><tbody>{candidate.units.map(unit=><tr key={unit.id}>
              <td>{unit.id}</td><td>{unit.before} → {unit.after}</td>
              <td>{released.has(unit.id)?tr("拟释放","Release"): `${displayNumber(unit.grossKg)} kg / ${displayNumber(unit.heightMm)} mm`}</td>
            </tr>)}</tbody></table>
          </div>
        </details>
        <div className="upgrade-actions"><button type="button" className="button primary" disabled={blocked||preview.running} onClick={useDraft}>{tr("将减托结果写入草稿","Use pallet reduction in draft")}</button></div>
      </>}
      {preview.result?.budgetReached&&<p className="helper-text">{candidate
        ?tr(`已达到本轮搜索上限（每轮最多释放 ${MAX_ORDER_RELEASES} 托）。写入草稿后可继续试排。`,`This run reached its search limit (up to ${MAX_ORDER_RELEASES} pallets). Use this result in the draft to search again.`)
        :tr("已达到本轮搜索上限。可在托内编辑中选几张尾托联合重排。","This run reached its search limit. Try consolidating a few selected tail pallets in the pallet editor.")}</p>}
      {editor.message&&<p role="status">{palletSearchMessage(editor.message)}</p>}
    </section>
  </FeatureDialog>;
}
