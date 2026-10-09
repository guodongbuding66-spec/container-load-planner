"use client";
import { Ruler } from "lucide-react";
import { useTransportAppearance } from "./transport-appearance";
import { tr, useLanguage } from "./language";
import type { DimensionUnit } from "../lib/packing/scene-dimensions";

export function DimensionControls() {
  useLanguage();
  const { dimensions, setDimensions, dimensionUnit, setDimensionUnit, dimensionFontSize, setDimensionFontSize }=useTransportAppearance();
  return <div className="dimension-controls" role="group" aria-label={tr("三维尺寸标注", "3D dimension annotations")}>
    <button type="button" aria-pressed={dimensions} onClick={()=>setDimensions(!dimensions)} title={tr("统一显示或隐藏柜体、箱体和托盘的尺寸线与文字。", "Show or hide dimension lines and text for spaces, cartons and pallets.")}><Ruler size={14}/>{tr("尺寸", "Dimensions")}</button>
    <label><span>{tr("单位", "Unit")}</span><select aria-label={tr("尺寸单位", "Dimension unit")} disabled={!dimensions} value={dimensionUnit} onChange={e=>setDimensionUnit(e.target.value as DimensionUnit)}>{["mm","cm","m"].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    <label><span>{tr("字号", "Text")}</span><select aria-label={tr("尺寸字号", "Dimension text size")} disabled={!dimensions} value={dimensionFontSize} onChange={e=>setDimensionFontSize(Number(e.target.value))}>{[14,18,22,26].map(v=><option key={v} value={v}>{v} px</option>)}</select></label>
  </div>;
}
