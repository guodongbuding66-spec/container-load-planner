"use client";
import type {PackingResult,ProductInput} from "../lib/packing/types";
import type {PlanEditor} from "./use-plan-editor";
import {tr,useLanguage} from "./language";
import {palletSearchMessage,usePalletSearch} from "./use-pallet-search";

export function usePalletRepackPreview(source:PackingResult,products:ProductInput[],id:string,blocked:boolean,onPendingChange?:(pending:boolean)=>void){
  return usePalletSearch("repack",source,products,id,blocked,onPendingChange);
}

export function PalletRepackControls({editor,products,id,blocked,onPendingChange}:{editor:PlanEditor;products:ProductInput[];id:string;blocked:boolean;onPendingChange?:(pending:boolean)=>void}){
  useLanguage();const preview=usePalletRepackPreview(editor.plan!,products,id,blocked,onPendingChange),r=preview.result;
  const apply=()=>{if(r?.improved&&editor.palletEdit(id,{type:"repack",positions:r.positions,sourceKey:r.sourceKey}))preview.clear();};
  const mm=(n:number)=>Math.round(n*1000)/1000;
  return <section className="panel pallet-repack" aria-label={tr("单托局部自动重排","Local pallet repacking")}>
    <h3>{tr("单托局部自动重排","Local pallet repacking")}</h3>
    <p>{tr("仅重排本托已有长方体箱规，先降低最高点，再缩小占地。同套、箱数、自重及包装库存保留，其他整托不移动；锁定箱体及其支撑链、同套组件保持原位。","Repack existing rectangular cartons on this pallet: lower the highest point first, then reduce footprint. Keep kits, quantities, tare and packaging stock. Other pallets stay in place; locked cargo, its supporters and complete kits remain fixed.")}</p>
    <p className="helper-text">{tr("最多 160 箱、4 轮搜索，可取消；未发现更优可行结果时保留原位。不自动补货，木箱外壳尺寸不随货物降低而改变。","Up to 160 cartons and four cancellable search passes. Keep original positions if no better feasible result is found. No automatic refill; crate exterior dimensions stay fixed.")}</p>
    <div className="upgrade-actions"><button type="button" className="button" disabled={blocked||preview.running} onClick={preview.run}>{tr("预览本托自动重排","Preview local repacking")}</button>{preview.running&&<button type="button" className="button" onClick={preview.cancel}>{tr("取消重排","Cancel repacking")}</button>}</div>
    <p role="status" aria-live="polite">{preview.running?tr("正在搜索本托，原方案保持不变…","Searching this pallet; the original plan is unchanged…"):preview.message?palletSearchMessage(preview.message):r?r.improved?tr("已找到更优且通过整柜校验的候选；尚未写入编辑草稿。","A better candidate passed full-plan validation; it has not entered the edit draft yet."):tr("本次有界搜索未发现更优方案，原箱位保留。","This bounded search found no better layout; original positions retained."):""}</p>
    {r&&<><div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>{tr("比较项目","Measure")}</th><th>{tr("重排前","Before")}</th><th>{tr("候选结果","Candidate")}</th></tr></thead><tbody>
      <tr><th>{tr("托面以上最高点 mm","Highest point above deck mm")}</th><td>{mm(r.before.cargoTopMm)}</td><td>{mm(r.after.cargoTopMm)}</td></tr>
      <tr><th>{tr("整托实际总高 mm","Complete unit height mm")}</th><td>{mm(r.before.unitHeightMm)}</td><td>{mm(r.after.unitHeightMm)}</td></tr>
      <tr><th>{tr("货物外包络占地 mm","Cargo bounding footprint mm")}</th><td>{mm(r.before.lengthMm)} × {mm(r.before.widthMm)}</td><td>{mm(r.after.lengthMm)} × {mm(r.after.widthMm)}</td></tr>
    </tbody></table></div><p>{tr("固定","Fixed")} {r.fixedCount} · {tr("移动","Moved")} {r.movedCount} · {tr("已搜索","Passes")} {r.attempts} / 4 · {Math.round(r.elapsedMs)} ms</p>
    {r.rejected>0&&<details><summary>{tr("未采用候选","Rejected candidates")} · {r.rejected}</summary>{r.issues.map(reason=><p key={reason}>{palletSearchMessage(reason)}</p>)}</details>}
    <button type="button" className="button" disabled={blocked||!r.improved} onClick={apply}>{tr("将重排结果写入草稿","Use repacked draft")}</button><p className="helper-text">{tr("写入后可撤销／重做，检查三维及清单后再“采用托内调整”。有界搜索不保证全局最优；本托、其他整托或输入变更会使当前预览失效。","Draft changes support undo/redo. Inspect the model and manifest before applying pallet edits. Bounded search is not globally optimal; changes to this pallet, other pallets or inputs invalidate the preview.")}</p></>}
  </section>;
}
