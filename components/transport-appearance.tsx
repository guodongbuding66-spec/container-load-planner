"use client";
import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import { Box, ScanLine } from "lucide-react";
import { DEFAULT_TRANSPARENCY, type TransportDisplayMode } from "../lib/packing/transport-model";
import { tr, useLanguage } from "./language";

type Appearance = { mode: TransportDisplayMode; transparency: number; setMode: (mode: TransportDisplayMode) => void; setTransparency: (value: number) => void };
const Context = createContext<Appearance | null>(null);
export function TransportAppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<TransportDisplayMode>("model");
  const [transparency, setTransparency] = useState(DEFAULT_TRANSPARENCY);
  const value = useMemo(() => ({ mode, setMode, transparency, setTransparency }), [mode, transparency]);
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
