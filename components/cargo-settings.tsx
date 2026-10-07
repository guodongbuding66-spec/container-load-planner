"use client";
import { useState } from "react";
import { Box, Check, Package } from "lucide-react";
import type { ProductInput, PackingMode, OrientationCode } from "../lib/packing/types";
import { CARGO_TYPES, CARGO_LABELS, ORIENTATION_CODES, parseOrientations } from "../lib/packing/loading-rules";
import { fromMillimeters, toMillimeters, fromKilograms, toKilograms, type LengthUnit, type WeightUnit } from "../lib/packing/units";
import { FeatureDialog } from "./feature-dialog";
import { tr, useLanguage } from "./language";

function OrientationPreview({ code }: { code: OrientationCode }) { return <svg viewBox="0 0 88 64" aria-hidden="true"><path d="M14 22 53 10 76 24 37 36Z" fill="#b7dce1"/><path d="M14 22 37 36 37 58 14 44Z" fill="#78b7c0"/><path d="M37 36 76 24 76 46 37 58Z" fill="#338391"/><text x="47" y="48" fill="white" fontSize="12" fontWeight="700">{code[2]} ↑</text><text x="20" y="40" fill="#fff" fontSize="9">{code[1]}</text><text x="47" y="24" fill="#245261" fontSize="9">{code[0]}</text></svg>; }
export function CargoSettings({ product, mode, lengthUnit, weightUnit, onClose, onSave }: { product: ProductInput; mode: PackingMode; lengthUnit: LengthUnit; weightUnit: WeightUnit; onClose: () => void; onSave: (product: ProductInput) => void }) {
  useLanguage();
  const [draft, setDraft] = useState({ ...product, cargoType: product.cargoType ?? "carton" });
  const [directions, setDirections] = useState<OrientationCode[]>(product.allowedOrientations ?? (product.rotationPolicy === "fixed" ? ["LWH"] : product.rotationPolicy === "upright" ? ["LWH", "WLH"] : [...ORIENTATION_CODES]));
  const [values, setValues] = useState({ length: String(fromMillimeters(product.length, lengthUnit)), width: String(fromMillimeters(product.width, lengthUnit)), height: String(fromMillimeters(product.height, lengthUnit)), weight: String(fromKilograms(product.weight, weightUnit)), quantity: String(product.quantity), layers: String(product.maxStackLayers), base: String(fromMillimeters(product.palletBaseHeight ?? 144, lengthUnit)) });
  const [error, setError] = useState("");
  const update = (key: keyof typeof values, value: string) => setValues(v => ({ ...v, [key]: value }));
  const save = () => { try {
    const numeric = (key: keyof typeof values, min: number, integer = false) => { const n = Number(values[key]); if (!values[key].trim() || !Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) throw new Error(tr("请完成所有数字，并使用有效的尺寸、重量和数量。", "Complete every numeric field with valid dimensions, weight and quantity.")); return n; };
    const length = toMillimeters(numeric("length", Number.MIN_VALUE), lengthUnit), width = toMillimeters(numeric("width", Number.MIN_VALUE), lengthUnit), height = toMillimeters(numeric("height", Number.MIN_VALUE), lengthUnit);
    const base = draft.cargoType === "pallet" ? toMillimeters(numeric("base", 0), lengthUnit) : undefined;
    if (base !== undefined && base >= height) throw new Error(tr("托盘底座已包含在总高内，必须小于总高。", "Pallet base is included in total height and must be smaller."));
    const layers = numeric("layers", 0, true), quantity = numeric("quantity", 0, true);
    if (layers > 99 || quantity > 1_000_000 || !draft.sku.trim()) throw new Error(tr("请检查 SKU、层数和数量。", "Check SKU, layer limit and quantity."));
    onSave({ ...draft, length, width, height, weight: toKilograms(numeric("weight", 0), weightUnit), quantity, maxStackLayers: layers, allowedOrientations: parseOrientations(directions), palletBaseHeight: base }); onClose();
  } catch (e) { setError(e instanceof Error ? e.message : "Invalid input"); } };
  return <FeatureDialog title={tr("货物设置")} subtitle={product.sku} onClose={onClose} footer={<><p role="alert">{error || tr("全部录入完成后保存；第二步确认配置后统一计算。", "Save all cargo fields, then confirm loading setup.")}</p><button className="button" onClick={onClose}>{tr("取消")}</button><button className="button primary" onClick={save}>{tr("保存设置")}</button></>}>
    <div className="feature-choice-grid cargo-type-choices">{CARGO_TYPES.map(type => <button className={`feature-choice ${draft.cargoType === type ? "selected" : ""}`} key={type} aria-pressed={draft.cargoType === type} onClick={() => setDraft(v => ({ ...v, cargoType: type }))}><Package size={20}/><strong>{tr(CARGO_LABELS[type])}</strong></button>)}</div>
    <div className="feature-form-grid"><label>SKU<input value={draft.sku} maxLength={80} onChange={e => setDraft(v => ({ ...v, sku: e.target.value }))}/></label><label>{tr("品名", "Name")}<input value={tr(draft.name)} maxLength={200} onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}/></label><label>{tr("颜色", "Color")}<input type="color" value={draft.color} onChange={e => setDraft(v => ({ ...v, color: e.target.value }))}/></label>
      {(["length", "width", "height"] as const).map((key, i) => <label key={key}>{tr(["长", "宽", "高"][i])} ({lengthUnit})<input inputMode="decimal" value={values[key]} onChange={e => update(key, e.target.value)}/></label>)}
      <label>{tr("重量")} ({weightUnit})<input inputMode="decimal" value={values.weight} onChange={e => update("weight", e.target.value)}/></label>{mode === "mixed" && <label>{tr("数量")}<input inputMode="numeric" value={values.quantity} onChange={e => update("quantity", e.target.value)}/></label>}<label>{tr("层数上限")}<input inputMode="numeric" value={values.layers} onChange={e => update("layers", e.target.value)}/><small>{tr("0 = 按空间自动计算", "0 = determined by available space")}</small></label>
      {draft.cargoType === "pallet" && <label>{tr("托盘底座高度", "Pallet base height")} ({lengthUnit})<input inputMode="decimal" value={values.base} onChange={e => update("base", e.target.value)}/><small>{tr("已包含在外箱总高内", "Included in outer height")}</small></label>}
    </div><div className="feature-toggle-row"><label><input type="checkbox" checked={draft.stackable} onChange={e => setDraft(v => ({ ...v, stackable: e.target.checked }))}/>{tr("可承托")}</label><label><input type="checkbox" checked={draft.bottomOnly ?? false} onChange={e => setDraft(v => ({ ...v, bottomOnly: e.target.checked }))}/>{tr("必须底置")}</label></div>
    <h3 className="feature-section-heading"><Box size={17}/>{tr("摆放方向")}</h3><p className="feature-muted">{tr("L／W／H 对应原始长／宽／高；箭头为朝上方向。至少保留一种。", "L / W / H refer to original length, width and height. Arrow indicates the upward axis. Select at least one.")}</p>
    <div className="orientation-choices">{ORIENTATION_CODES.map(code => <button key={code} className={`orientation-choice ${directions.includes(code) ? "selected" : ""}`} aria-pressed={directions.includes(code)} onClick={() => setDirections(v => v.includes(code) ? v.filter(c => c !== code) : [...v, code])}><OrientationPreview code={code}/><strong>{code}</strong>{directions.includes(code) && <Check size={15}/>}</button>)}</div><p className="feature-note">{tr("圆桶、卷材、散件使用矩形外包络；承托比例和上压承重可分别设置。", "Drums, rolls and loose cargo use rectangular envelopes. Support area and top-load weight are separate constraints.")}</p>
  </FeatureDialog>;
}
