"use client";
import { useEffect } from "react";
import { CRATE_CORNERS, CRATE_REASON_TEXT, crateEvidence, crateEvidenceKey, crateSupportRegions, emptyCrateBearing, type CrateBearingProfile } from "../lib/packing/crate-bearing";
import { crateStructure } from "../lib/packing/crate-structure";
import type { FloorPalletConfig } from "../lib/packing/types";
import { NumericInput } from "./numeric-input";
import { tr, useLanguage } from "./language";

export function CrateBearingSettings({value,onChange,onValidityChange,resetToken=0,invalid=false}:{value:FloorPalletConfig;onChange:(v:FloorPalletConfig)=>void;onValidityChange:(key:string,valid:boolean)=>void;resetToken?:number;invalid?:boolean}){
  useLanguage();const p=value.crateBearing??emptyCrateBearing(),evidence=crateEvidence(value),regions=crateSupportRegions(value);
  const patch=(v:Partial<CrateBearingProfile>)=>onChange({...value,crateBearing:{...p,...v,reviewed:false,reviewedFor:""}});
  useEffect(()=>()=>{for(const key of ["top","layers",...CRATE_CORNERS])onValidityChange(`pallet-build:crate-${key}`,true);},[onValidityChange]);
  const reviewedCandidate={...p,reviewed:true,reviewedFor:crateEvidenceKey(value,p)};
  const canReview=!invalid&&crateEvidence({...value,crateBearing:reviewedCandidate}).state==="ready";
  return <details className="crate-bearing-settings"><summary>{tr("木箱额定资料与支承区","Crate ratings and bearing zones")} · {evidence.state==="ready"?tr("资料已核对","Evidence reviewed"):evidence.state==="prohibited"?tr("禁止叠放","Stacking prohibited"):tr("未核验","Unverified")}</summary>
    <p className="helper-text">{tr("本轮仅用于独立叠放预检；主求解器仍将木箱底置。额定值必须来自实际结构资料，不能按材质或示例数值推定。","Used only for independent stack preflight; the main solver still keeps crates on the floor. Use actual structural ratings, never inferred material values or examples.")}</p>
    <label>{tr("木箱叠放资料状态","Crate stacking evidence")}<select aria-label={tr("木箱叠放资料状态","Crate stacking evidence")} value={p.policy} disabled={invalid} onChange={e=>patch({policy:e.target.value as CrateBearingProfile["policy"]})}><option value="unverified">{tr("资料缺失／未核验","Missing / unverified")}</option><option value="prohibited">{tr("明确禁止叠放","Stacking explicitly prohibited")}</option><option value="rated">{tr("录入额定资料","Enter documented ratings")}</option></select></label>
    {p.policy==="rated"&&<><div className="crate-rating-grid">
      <label>{tr("结构版本","Structural revision")}<input aria-label={tr("木箱结构版本","Crate structural revision")} maxLength={120} value={p.revision} onChange={e=>patch({revision:e.target.value})}/></label>
      <label>{tr("额定来源／文件编号","Rating source / document ID")}<input aria-label={tr("木箱额定来源","Crate rating source")} maxLength={500} value={p.source} onChange={e=>patch({source:e.target.value})}/></label>
      <label>{tr("资料有效期（可留空）","Evidence expiry (optional)")}<input type="date" value={p.validUntil} onChange={e=>patch({validUntil:e.target.value})}/></label>
      <label>{tr("整箱额定顶载 kg（0 禁止上压）","Rated top load kg (0 forbids load)")}<NumericInput resetToken={resetToken} ariaLabel={tr("木箱额定顶载","Crate rated top load")} value={p.maxTopLoadKg} max={100000} onValueChange={maxTopLoadKg=>patch({maxTopLoadKg})} onValidityChange={v=>onValidityChange("pallet-build:crate-top",v)}/></label>
      <label>{tr("额定总层数（含本箱）","Rated layers including this crate")}<NumericInput resetToken={resetToken} ariaLabel={tr("木箱额定层数","Crate rated layers")} value={p.maxLayers} integer min={1} max={20} onValueChange={maxLayers=>patch({maxLayers})} onValidityChange={v=>onValidityChange("pallet-build:crate-layers",v)}/></label>
    </div><label>{tr("支承条件与适用范围","Support conditions and applicability")}<textarea aria-label={tr("木箱支承条件","Crate support conditions")} value={p.conditions} maxLength={2000} rows={3} onChange={e=>patch({conditions:e.target.value})}/></label>
    <div className="upgrade-actions">{(["LWH","WLH"] as const).map(code=><label key={code}><input type="checkbox" checked={p.allowedOrientations.includes(code)} onChange={e=>patch({allowedOrientations:e.target.checked?[...p.allowedOrientations,code]:p.allowedOrientations.filter(c=>c!==code)})}/>{tr("额定允许朝向","Rated orientation")} {code}</label>)}</div>
    <p className="helper-text">{tr("四角脚→同位置立柱→箱盖角部是唯一支持的传力关联。每条路径均按本箱毛重与全部上层毛重的总和核对，不假设四角均分。该上界较保守，不能代替结构试验。","Only corner foot → coaxial post → lid corner paths are supported. EACH path is checked against the full gross mass of this crate and all units above, without assuming equal quarter shares. This conservative bound does not replace structural testing.")}</p>
    <div className="upgrade-table-wrap"><table><caption>{tr("许可接触区与对应传力路径（局部 mm）","Permitted contacts and linked paths (local mm)")}</caption><thead><tr><th>{tr("角部／路径","Corner / path")}</th><th>X / Y / L / W</th><th>{tr("单路径额定值 kg","Per-path rating kg")}</th></tr></thead><tbody>{regions.map(r=><tr key={r.id}><th>{r.id}</th><td>{r.x} / {r.y} / {r.dx} / {r.dy}</td><td><NumericInput resetToken={resetToken} ariaLabel={`${tr("木箱路径额定值","Crate path rating")} ${r.id}`} value={p.columnCapacityKg[r.id]} max={100000} onValueChange={n=>patch({columnCapacityKg:{...p.columnCapacityKg,[r.id]:n}})} onValidityChange={v=>onValidityChange(`pallet-build:crate-${r.id}`,v)}/></td></tr>)}</tbody></table></div>
    <p className="helper-text">{crateStructure(value).complete?tr("四条实体路径几何连续：底脚、底板接触片、立柱、箱盖角部。几何连续不等于连接件或材料强度已核验。","Four physical paths are geometrically continuous: feet, deck contact patches, posts and lid corners. This does not verify joints or material strength."):tr("当前结构没有四条完整的实体路径，不能标记资料已核对。","This structure has no four complete physical paths and cannot be marked reviewed.")}</p>
    <svg className="crate-support-map" viewBox={`0 0 ${value.length} ${value.width}`} role="img" aria-label={tr("木箱四角许可支承区","Four permitted crate corner zones")}><rect width={value.length} height={value.width} fill="#edf4f5" stroke="#9bbcc5"/>{regions.map(r=><rect key={r.id} x={r.x} y={r.y} width={r.dx} height={r.dy} fill="#247d89"><title>{r.id}</title></rect>)}</svg>
    <label className="packaging-check"><input type="checkbox" checked={evidence.state==="ready"} disabled={!canReview&&evidence.state!=="ready"} onChange={e=>onChange({...value,crateBearing:{...p,reviewed:e.target.checked,reviewedFor:e.target.checked?crateEvidenceKey(value,p):""}})}/>{tr("已人工核对本结构版本、额定来源与实际适用条件","I reviewed this structural revision, rating source and actual applicability")}</label>
    </>}
    {evidence.state!=="ready"&&<ul className="feature-note">{evidence.reasons.map(code=><li key={code}>{tr(...CRATE_REASON_TEXT[code])}</li>)}</ul>}
    <p className="helper-text">{tr("结构尺寸、底座、围护、材质、自重或额定资料改变后，原核对标记失效；颜色和透明度仅影响显示。","Changes to dimensions, base, enclosure, material, tare or rating data invalidate review. Color and opacity only affect display.")}</p>
  </details>;
}
