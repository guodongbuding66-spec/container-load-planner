"use client";
import { createContext, useContext, useId, useMemo, type ReactNode } from "react";
import { Box, ScanLine } from "lucide-react";
import { type TransportDisplayMode } from "../lib/packing/transport-model";
import { tr, useLanguage } from "./language";
import { type DimensionStyle, type DimensionUnit } from "../lib/packing/scene-dimensions";
import type { ViewPreferences } from "../lib/packing/view-preferences";
import { resetViewPreferences, updateViewPreferences, useViewPreferences } from "./view-preferences";

type Appearance = ViewPreferences & { setMode: (mode: TransportDisplayMode) => void; setTransparency: (value: number) => void;
  dimensions:boolean;setDimensions:(value:boolean)=>void; labels:boolean;setLabels:(value:boolean)=>void;setSkuSummaries:(value:boolean)=>void;
  dimensionUnit:DimensionUnit;setDimensionUnit:(unit:DimensionUnit)=>void;dimensionFontSize:number;setDimensionFontSize:(size:number)=>void;
  dimensionStyle:DimensionStyle;setDimensionStyle:(style:DimensionStyle)=>void;dimensionLineColor:string;setDimensionLineColor:(color:string)=>void;dimensionTextColor:string;setDimensionTextColor:(color:string)=>void;
  saveFailed:boolean;updatePreferences:typeof updateViewPreferences;resetPreferences:typeof resetViewPreferences;
};
const Context = createContext<Appearance | null>(null);
export function TransportAppearanceProvider({ children }: { children: ReactNode }) {
  const snapshot=useViewPreferences();
  const value=useMemo<Appearance>(()=>({...snapshot.preferences,saveFailed:snapshot.saveFailed,updatePreferences:updateViewPreferences,resetPreferences:resetViewPreferences,
    setMode:mode=>updateViewPreferences({mode}),setTransparency:transparency=>updateViewPreferences({transparency}),
    setDimensions:dimensions=>updateViewPreferences({dimensions}),setLabels:labels=>updateViewPreferences({labels}),setSkuSummaries:skuSummaries=>updateViewPreferences({skuSummaries}),
    setDimensionUnit:dimensionUnit=>updateViewPreferences({dimensionUnit}),setDimensionFontSize:dimensionFontSize=>updateViewPreferences({dimensionFontSize}),
    setDimensionStyle:dimensionStyle=>updateViewPreferences({dimensionStyle}),setDimensionLineColor:dimensionLineColor=>updateViewPreferences({dimensionLineColor}),setDimensionTextColor:dimensionTextColor=>updateViewPreferences({dimensionTextColor})
  }),[snapshot]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTransportAppearance() {
  const appearance = useContext(Context);
  if (!appearance) throw new Error("Transport appearance provider is missing");
  return appearance;
}
export function TransportModelControls() {
  useLanguage();
  const { mode, transparency, setMode, setTransparency } = useTransportAppearance();
  const id = useId();
  return <div className="transport-model-controls" role="group" aria-label={tr("柜体与车厢外观", "Container and vehicle appearance")}>
    <div className="transport-model-modes" role="group" aria-label={tr("模型显示方式", "Model display")}>
      <button type="button" aria-pressed={mode === "model"} onClick={() => setMode("model")}><Box size={14}/>{tr("实物模型", "Physical model")}</button>
      <button type="button" aria-pressed={mode === "wireframe"} onClick={() => setMode("wireframe")}><ScanLine size={14}/>{tr("线框", "Wireframe")}</button>
    </div>
    <label className="transport-opacity" htmlFor={id}><span>{tr("透明度", "Transparency")}</span><input id={id} type="range" min={0} max={100} step={5} value={transparency} disabled={mode === "wireframe"} aria-valuetext={`${transparency}%`} onChange={e => setTransparency(Number(e.target.value))}/><output htmlFor={id}>{transparency}%</output></label>
  </div>;
}
