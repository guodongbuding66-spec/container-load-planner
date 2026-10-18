"use client";
import { useState } from "react";
import { parseLongSupport, type LongSupportProfile } from "../lib/packing/long-support";
import type { ProductInput } from "../lib/packing/types";
import { cargoShapeOf } from "../lib/packing/cargo-shape";
import { tr, useLanguage } from "./language";

type Draft={ enabled:boolean; dimensions:LongSupportProfile["dimensions"]; axis:"L"|"W"; bands:string; ratio:string; span:string; overhang:string; source:string; revision:string };
function initial(product:ProductInput):Draft {
  const p=product.longSupport;
  return {enabled:!!p,dimensions:p?.dimensions??{length:product.length,width:product.width,height:product.height},axis:p?.axis??"L",bands:p?.bands.map(b=>`${b.start}, ${b.end}`).join("\n")??`0, ${product.length}`,ratio:String((p?.minimumContactRatio??1)*100),span:p?.maxSpanMm===undefined?"":String(p.maxSpanMm),overhang:p?.maxOverhangMm===undefined?"":String(p.maxOverhangMm),source:p?.source??"",revision:p?.revision??""};
}
export function supportSettingsValue(v:Draft):LongSupportProfile|undefined {
  if(!v.enabled)return undefined;
  const number=(s:string)=>s.trim()?Number(s):NaN;
  const bands=v.bands.split(/\r?\n/).filter(s=>s.trim()).map(line=>{const parts=line.split(/[,，]/);if(parts.length!==2)throw Error("Invalid band");return {start:number(parts[0]),end:number(parts[1])};});
  return parseLongSupport({version:1,dimensions:v.dimensions,axis:v.axis,bands,minimumContactRatio:number(v.ratio)/100,...(v.span.trim()?{maxSpanMm:number(v.span)}:{}),...(v.overhang.trim()?{maxOverhangMm:number(v.overhang)}:{}),source:v.source,revision:v.revision});
}
export function LongSupportSettings({product,onChange,onValidity}:{product:ProductInput;onChange:(value:LongSupportProfile|undefined)=>void;onValidity:(valid:boolean)=>void}) {
  useLanguage();
  const [draft,setDraft]=useState(()=>initial(product)),[invalid,setInvalid]=useState(false);
  const update=(patch:Partial<Draft>)=>{
    const next={...draft,...patch};setDraft(next);
    try{const value=supportSettingsValue(next);setInvalid(false);onValidity(true);onChange(value);}catch{setInvalid(true);onValidity(false);}
  };
  const stale=(["length","width","height"] as const).some(k=>Math.abs(product[k]-draft.dimensions[k])>.0001);
  const supported=!product.solidModel&&cargoShapeOf(product)==="box";
  return <details className="long-support-settings" open={draft.enabled||undefined}>
    <summary>{tr("长条箱承托与悬跨资料","Long-carton support and span data")}</summary>
    <p>{tr("独立几何预检，不自动重排或放行箱位。指定原始底面 H−；支承带沿原始 L 或 W，横跨整个另一方向，每条都须达到填写的接触比例。所有数值固定为 mm。","Independent geometry preflight; it neither repacks nor authorizes placements. Uses the original H− bottom face. Bands follow original L or W across the full transverse width; every band must meet the entered contact ratio. All dimensions here are always mm.")}</p>
    <label className="long-support-enable"><input type="checkbox" aria-label={tr("启用长条箱承托资料","Enable long-carton support data")} checked={draft.enabled} disabled={!supported&&!draft.enabled} onChange={e=>update({enabled:e.target.checked})}/>{tr("记录本 SKU 的承托资料","Record support data for this SKU")}</label>
    {!supported&&<p>{tr("首阶段仅检查普通长方体，异型件和实体模型保持未核验；可关闭此资料。","This stage checks ordinary rectangular cartons. Irregular and solid-model cargo remain unverified; this profile may be disabled.")}</p>}
    {draft.enabled&&<>
      <p>{tr("关联箱规 L × W × H","Bound carton L × W × H")}: {draft.dimensions.length} × {draft.dimensions.width} × {draft.dimensions.height} mm</p>
      {stale&&<p role="alert">{tr("箱规已变化，旧资料未核验。重新绑定会清空来源、版本和跨度上限，并把支承带重置为整面，请重新填写。","Dimensions changed; old evidence is unverified. Rebinding clears source, revision and span limits and resets the band to the full face; re-enter the data.")}<button type="button" className="button small" onClick={()=>update({...initial({...product,longSupport:undefined}),enabled:true})}>{tr("重新绑定当前箱规","Rebind current carton dimensions")}</button></p>}
      <div className="feature-form-grid">
        <label>{tr("支承带方向","Support band axis")}<select aria-label={tr("支承带方向","Support band axis")} value={draft.axis} onChange={e=>update({axis:e.target.value as "L"|"W"})}><option value="L">L</option><option value="W">W</option></select></label>
        <label>{tr("每带最小接触比例 %","Minimum contact per band %")}<input aria-label={tr("每带最小接触比例","Minimum contact per band")} inputMode="decimal" value={draft.ratio} onChange={e=>update({ratio:e.target.value})}/></label>
        <label>{tr("最大中部悬跨 mm（留空为未知）","Maximum internal span mm (blank = unknown)")}<input aria-label={tr("最大中部悬跨","Maximum internal span")} inputMode="decimal" value={draft.span} onChange={e=>update({span:e.target.value})}/></label>
        <label>{tr("每端最大悬挑 mm（留空为未知）","Maximum overhang at either end mm (blank = unknown)")}<input aria-label={tr("每端最大悬挑","Maximum end overhang")} inputMode="decimal" value={draft.overhang} onChange={e=>update({overhang:e.target.value})}/></label>
        <label>{tr("承托资料来源","Support evidence source")}<input aria-label={tr("承托资料来源","Support evidence source")} maxLength={500} value={draft.source} onChange={e=>update({source:e.target.value})}/></label>
        <label>{tr("承托资料版本","Support evidence revision")}<input aria-label={tr("承托资料版本","Support evidence revision")} maxLength={120} value={draft.revision} onChange={e=>update({revision:e.target.value})}/></label>
      </div>
      <label>{tr("必须接触的支承带：每行 起点,终点 mm，最多 12 条，不得重叠","Required bands: one start,end in mm per line, at most 12, no overlap")}<textarea aria-label={tr("必须接触的支承带","Required support bands")} rows={4} maxLength={10000} value={draft.bands} onChange={e=>update({bands:e.target.value})}/></label>
      <p>{tr("接触带以外的区域不禁止落地，但不抵扣指定带的缺口；中部跨度只计算横向接触比例达标的连续区段。填写 0 表示不允许悬空；留空表示未核验。资料不证明抗弯、抗倒或运输强度。","Contact outside the bands is allowed but does not make up a missing required band. Spans use intervals meeting the transverse contact ratio. Zero forbids unsupported space; blank means unverified. Evidence does not certify bending, tipping or transport strength.")}</p>
      {invalid&&<p role="alert">{tr("请检查支承带范围、重叠、比例和数字；无效输入不能保存。","Check band bounds, overlaps, ratios and numbers; invalid input cannot be saved.")}</p>}
    </>}
  </details>;
}
