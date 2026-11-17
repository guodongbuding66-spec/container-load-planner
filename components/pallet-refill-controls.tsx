"use client";
import type {PalletRefillResult} from "../lib/packing/pallet-refill";
import type {ProductInput} from "../lib/packing/types";
import {tr,useLanguage} from "./language";
import {palletSearchMessage,usePalletSearch} from "./use-pallet-search";
import type {PlanEditor} from "./use-plan-editor";

const reasons:Record<NonNullable<PalletRefillResult["reason"]>,[string,string]>={
  "no-order-stock":["订单已全部分配。","The entire order is assigned."],
  "pallet-full":["本托已达到设定的每托箱数。","This pallet has reached its carton limit."],
  "placement-limit":["当前方案已达到自动补货的箱位数量上限。","This plan has reached the refill placement limit."],
  "no-eligible-stock":["余量中没有符合本托规格、散箱预留和剩余箱数要求的单箱或整套。","No unassigned carton or complete kit matches the packaging, loose reservations and remaining carton allowance."],
  "no-fit":["本次搜索没有找到通过复核的补货箱位。","This search found no refill placements that passed validation."],
};

export function PalletRefillControls({editor,products,id,blocked,onPendingChange}:{editor:PlanEditor;products:ProductInput[];id:string;blocked:boolean;onPendingChange:(pending:boolean)=>void}){
  useLanguage();
  const plan=editor.plan!;
  const measured=Boolean(plan.pallets?.find(p=>p.id===id)?.measuredEnvelope);
  const preview=usePalletSearch("refill",plan,products,id,blocked||measured,onPendingChange),result=preview.result;
  const added=result?.additions.length??0;
  const rounded=(value:number)=>Math.round(value*1000)/1000;
  const kitSummary=result?.kits?` · ${result.kits} ${tr("套完整套装","complete kits")}`:"";
  const outcome=result?.reason?tr(...reasons[result.reason]):added?`${tr("可补","Can add")} ${added} ${tr("箱","cartons")}${kitSummary} · ${tr("校验通过","Validated")}`:"";
  const feedback=preview.running?tr("正在搜索本托的可用箱位…","Searching for open positions on this pallet…"):preview.message?palletSearchMessage(preview.message):outcome;
  const apply=()=>{
    if(result?.additions.length&&editor.palletEdit(id,{type:"refill",additions:result.additions,sourceKey:result.sourceKey}))preview.clear();
  };
  return <section className="pallet-refill" aria-label={tr("单托自动补货","Automatic pallet refill")}>
    <div className="upgrade-actions">
      <button type="button" className="button" disabled={blocked||measured||preview.running} onClick={preview.run}>{tr("预览本托自动补货","Preview automatic pallet refill")}</button>
      {preview.running&&<button type="button" className="button" onClick={preview.cancel}>{tr("取消补货搜索","Cancel refill search")}</button>}
      <p className="helper-text">{measured?tr("本托已录入实测包络，暂不可自动补货。","Automatic refill is paused for this pallet’s measured envelope."):tr("从订单余量找箱位，套装按整套补入。","Find placements in the unassigned order pool and keep kits complete.")}</p>
    </div>
    <p role="status">{feedback}</p>
    {result&&added>0&&<>
      <p>{tr("补货后整托高度","Refilled unit height")} {rounded(result.unitHeightMm)} mm · {tr("整托毛重","Unit gross weight")} {rounded(result.grossKg)} kg</p>
      <details>
        <summary>{tr("查看新增箱位","View new carton positions")} · {added}</summary>
        <div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>SKU</th><th>{tr("托内 X / Y / Z (mm)","Local X / Y / Z (mm)")}</th><th>{tr("方向","Orientation")}</th><th>{tr("套装","Kit")}</th></tr></thead><tbody>
          {result.additions.map(box=><tr key={box.id}><td>{box.sku}</td><td>{[box.x,box.y,box.z].map(rounded).join(" / ")}</td><td>{box.orientation}</td><td>{box.setCode??"—"}</td></tr>)}
        </tbody></table></div>
      </details>
      <div className="upgrade-actions">
        <button type="button" className="button" disabled={blocked||measured||preview.running} onClick={apply}>{tr("将补货结果写入草稿","Use refill in draft")}</button>
        {result.batchLimitReached&&<p className="helper-text">{tr("已达到本次预览的搜索箱数。写入后可继续试算。","This preview reached its search count. Use it in the draft to search again.")}</p>}
      </div>
    </>}
    {result?.issues.length? <details><summary>{tr("查看候选复核反馈","Review candidate validation")}</summary>{result.issues.map(issue=><p key={issue}>{palletSearchMessage(issue)}</p>)}</details>:null}
  </section>;
}
