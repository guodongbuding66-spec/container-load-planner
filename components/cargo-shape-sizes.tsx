"use client";
import { sizeFields, isRoundShape, type ShapeSizeDraft, type ShapeSizeOptions, type SizeKey } from "../lib/packing/shape-dimensions";
import type { CargoShape } from "../lib/packing/types";
import type { LengthUnit } from "../lib/packing/units";
import { tr, useLanguage } from "./language";

export function CargoShapeSizes({shape,values,options,unit,onChange,onOptions,onFocus}:{shape:CargoShape;values:ShapeSizeDraft;options:ShapeSizeOptions;unit:LengthUnit;onChange:(key:SizeKey,value:string)=>void;onOptions:(options:Partial<ShapeSizeOptions>)=>void;onFocus:(key:SizeKey|undefined)=>void}) {
  useLanguage();
  const round=isRoundShape(shape),fields=sizeFields(shape,options);
  return <div className="cargo-shape-sizes">
    <h4>{tr("外形尺寸","Shape dimensions")} <span>({unit})</span></h4>
    {round&&<div className="cargo-round-options">
      <label>{tr("截面","Cross-section")}<select aria-label={tr("截面形状","Cross-section shape")} value={options.elliptical?"ellipse":"circle"} onChange={e=>onOptions({elliptical:e.target.value==="ellipse"})}><option value="circle">{tr("圆形","Circle")}</option><option value="ellipse">{tr("椭圆形","Ellipse")}</option></select></label>
      <label>{tr("输入方式","Entry mode")}<select aria-label={tr("直径或半径","Diameter or radius")} value={options.radialMode} onChange={e=>onOptions({radialMode:e.target.value as ShapeSizeOptions["radialMode"]})}><option value="diameter">{tr("直径 D","Diameter D")}</option><option value="radius">{tr("半径 r","Radius r")}</option></select></label>
      <label>{tr("轴向","Axis")}<select aria-label={tr("圆筒轴向","Cylinder axis")} value={options.axis} onChange={e=>onOptions({axis:e.target.value as ShapeSizeOptions["axis"]})}>{["L","W","H"].map(a=><option key={a} value={a}>{tr(a==="L"?"沿原始长 L":a==="W"?"沿原始宽 W":"沿原始高 H",`Along original ${a}`)}</option>)}</select></label>
    </div>}
    <div className="cargo-size-fields">{fields.map(field=><label key={field.key}><span><b>{field.code}</b>{tr(field.zh,field.en)}</span><div><input aria-label={tr(field.zh,field.en)} inputMode="decimal" value={values[field.key]} onChange={e=>onChange(field.key,e.target.value)} onFocus={()=>onFocus(field.key)} onBlur={()=>onFocus(undefined)}/><span>{unit}</span></div></label>)}</div>
    <p className="cargo-size-guide">{round?tr("D 为端面直径，r = D ÷ 2；h 为两端面之间的轴向长度。换轴向保留这些尺寸。","D spans the end face, r = D ÷ 2; h is the distance between end faces. Changing axis preserves these sizes."):shape.endsWith("-profile")?tr("A、B 为截面宽高，C 为延伸长度；tᵥ、tₕ 填实际壁厚。聚焦字段可高亮对应标线。","A/B are section width/height; C is extrusion length. Enter actual wall thicknesses tᵥ/tₕ. Focus a field to highlight its dimension."):shape==="step"?tr("a 是顶部高台长度；h₁ 是底部低台高度。两块作为一件货物装载。","a is the raised section length; h₁ is the lower level height. Both blocks load as one rigid item."):shape==="trapezoid"?tr("L 为底边，b 为居中的顶边，H 为截面高；沿 W 拉伸。","L is the base, b the centered top, H the section height; extruded along W."):shape==="wedge"?tr("L、H 构成直角三角截面；沿 W 拉伸。","L/H define a right-triangle section, extruded along W."):shape==="irregular"?tr("当前仅使用最大外接尺寸；不代表任意真实曲面。","Currently uses maximum bounding dimensions; this is not a custom surface model."):tr("L、W、H 对应模型的原始长、宽、高。","L/W/H are the model's original length, width and height.")}</p>
    {shape==="frustum"&&<p className="cargo-size-guide">{tr("顶部直径填 0 即为圆锥；椭圆截面的两轴按同一比例收缩。","A zero top diameter makes a cone. Elliptical top axes shrink by the same ratio.")}</p>}
  </div>;
}
