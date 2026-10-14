"use client";
import type { PalletBuildOptions } from "../lib/packing/types";
import { NumericInput } from "./numeric-input";
import { tr, useLanguage } from "./language";

export function PalletBuildSettings({ value, only, onChange, onValidityChange }: { value: PalletBuildOptions; only: boolean; onChange: (value: PalletBuildOptions) => void; onValidityChange: (key: string, valid: boolean) => void }) {
  useLanguage();
  const fields = [
    ["length", tr("托盘长", "Pallet length"), "mm", 1], ["width", tr("托盘宽", "Pallet width"), "mm", 1],
    ["height", tr("底座高", "Deck height"), "mm", 1], ["weight", tr("托盘自重", "Pallet tare"), "kg", 0],
    ["maxLoad", tr("每托承重", "Pallet payload"), "kg", 1], ["maxCargoHeight", tr("货物限高", "Cargo height limit"), "mm", only ? 1 : 0],
    ["gap", tr("整托保护间隙", "Pallet protection gap"), "mm", 0],
  ] as const;
  return <article className="panel pallet-build-settings" aria-label={tr("打托配置", "Pallet-building settings")}>
    <div className="panel-head"><div><span className="section-kicker">PALLET BUILD</span><h2>{tr(only ? "只打托，不装箱" : "先打托，后装箱", only ? "Palletize only" : "Palletize, then load")}</h2><p>{tr("货物限高不含底座；总高和总重均包含托盘。", "Cargo height excludes the deck; loaded height and gross weight include the pallet.")}</p></div></div>
    <div className="pallet-build-grid">{fields.map(([key, label, unit, min]) => <label key={key}>{label}<div className="pallet-build-number"><NumericInput ariaLabel={label} value={value.config[key] ?? 0} min={min} max={key === "gap" || key === "weight" ? 10000 : 100000} precision={1} onValueChange={v => onChange({ ...value, config: { ...value.config, [key]: v } })} onValidityChange={valid => onValidityChange(`pallet-build:${key}`, valid)}/><span>{unit}</span></div></label>)}
      <label>{tr("单品托 / 混托", "Pallet mix")}<select aria-label={tr("单品托 / 混托", "Pallet mix")} value={value.mix} onChange={e => onChange({ ...value, mix: e.target.value as "single" | "mixed" })}><option value="single">{tr("单 SKU / 完整套装", "One SKU / whole kits")}</option><option value="mixed">{tr("允许多 SKU 混托", "Allow mixed SKUs")}</option></select></label>
      {!only && <label>{tr("托盘方向", "Loaded pallet orientation")}<select aria-label={tr("托盘方向", "Loaded pallet orientation")} value={value.config.layout} onChange={e => onChange({ ...value, config: { ...value.config, layout: e.target.value as PalletBuildOptions["config"]["layout"] } })}><option value="auto">{tr("自动水平旋转", "Auto horizontal rotation")}</option><option value="long">{tr("长边沿柜长", "Length along vehicle")}</option><option value="cross">{tr("宽边沿柜长", "Width along vehicle")}</option></select></label>}
      <label>{tr("生成托盘上限", "Prepared pallet limit")}<NumericInput ariaLabel={tr("生成托盘上限", "Prepared pallet limit")} value={value.maxPallets} integer min={1} max={200} onValueChange={v => onChange({ ...value, maxPallets: v })} onValidityChange={valid => onValidityChange("pallet-build:limit", valid)}/></label>
      {!only && <><label>{tr("整托堆叠层数", "Loaded pallet stack layers")}<NumericInput ariaLabel={tr("整托堆叠层数", "Loaded pallet stack layers")} value={value.stackLayers} integer min={1} max={20} onValueChange={v => onChange({ ...value, stackLayers: v })} onValidityChange={valid => onValidityChange("pallet-build:layers", valid)}/></label><label>{tr("整托可承上压", "Loaded pallet top load")}<div className="pallet-build-number"><NumericInput ariaLabel={tr("整托可承上压", "Loaded pallet top load")} value={value.maxTopLoadKg} min={0} max={100000} precision={1} onValueChange={v => onChange({ ...value, maxTopLoadKg: v })} onValidityChange={valid => onValidityChange("pallet-build:top", valid)}/><span>kg</span></div></label></>}
    </div>
    <p className="helper-text">{only ? tr("按订单生成全部可行托盘并保留未打托数量；三维编组区只用于查看，利用率按每托包络计算。", "Build feasible pallets for the order and retain unmet quantities. The inspection area is for viewing; utilization uses pallet envelopes.") : tr("默认单层；启用多层需填写经过确认的整托上压。仅完整平顶且通过箱体、底座、累计上压和门洞校验的整托可堆叠。", "One layer by default. Stacking requires a confirmed unit top-load rating, a complete flat top, and cargo, deck, cumulative-load and door checks.")}</p>
  </article>;
}
