"use client";
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { explainUnloaded, inspectCargoFit } from "../lib/packing/engine";
import { fromMillimeters, type LengthUnit } from "../lib/packing/units";
import type { ContainerSpec, PackingResult, PackingStrategy, ProductInput } from "../lib/packing/types";
import { tr, trText, useLanguage } from "./language";

function dimensions(values: number[], unit: LengthUnit) {
  return `${values.map(n => Number(fromMillimeters(n, unit).toPrecision(8)).toLocaleString(undefined, { maximumFractionDigits: 5 })).join(" × ")} ${unit}`;
}

export function CargoFitNotice({ product, container, clearance, strategy, unit }: { product: ProductInput; container: ContainerSpec; clearance: number; strategy: PackingStrategy; unit: LengthUnit }) {
  useLanguage();
  const report = useMemo(() => inspectCargoFit(product, container, clearance, strategy), [product, container, clearance, strategy]);
  if (!report.reasons.length) return null;
  return <section className="cargo-fit-notice" role="status" aria-label={tr("基础装载条件提示", "Basic loading constraints")}>
    <strong><AlertTriangle size={16}/>{tr("当前参数存在装载限制", "Current inputs have loading constraints")}</strong>
    <span>{tr("货物外接尺寸", "Cargo envelope")}: {dimensions([product.length, product.width, product.height], unit)}{unit !== "m" && ` (${dimensions([product.length, product.width, product.height], "m")})`}</span>
    <span>{tr("柜内净空", "Usable interior")}: {dimensions([report.effective.length, report.effective.width, report.effective.height], unit)} · {tr("门洞净空", "Clear door opening")}: {dimensions([report.effective.doorWidth, report.effective.doorHeight], unit)}</span>
    <ul>{report.reasons.map(reason => <li key={reason}>{trText(reason)}</li>)}</ul>
    <small>{tr("保存可保留货物资料；装载时仍需满足这些条件。单位切换会换算数值，保持实际尺寸。", "You can save the cargo record; loading still requires these conditions. Switching units converts values and preserves physical size.")}</small>
  </section>;
}

export function ZeroLoadNotice({ result, products, unit, onEdit }: { result: PackingResult; products: ProductInput[]; unit: LengthUnit; onEdit: (id?: string) => void }) {
  useLanguage();
  const items = useMemo(() => explainUnloaded(result, products), [result, products]);
  return <section className="zero-load-notice" role="status" aria-label={tr("零装载原因", "Zero-load diagnosis")}>
    <div><AlertTriangle size={20}/><strong>{tr("未生成可执行装载方案", "No executable load plan was generated")}</strong></div>
    <p>{tr("当前条件下未装入货物。请先核对以下限制；有限搜索返回 0 件，并不总能证明绝对装不下。", "No cargo was loaded under the current conditions. Review these constraints first; a bounded search returning zero does not always prove that loading is impossible.")}</p>
    {items.map(item => {
      const product = products.find(p => p.id === item.productId);
      return <article key={item.productId}><div><strong>{item.sku}</strong>{product && <span>{dimensions([product.length, product.width, product.height], unit)}{unit !== "m" && ` (${dimensions([product.length, product.width, product.height], "m")})`}</span>}<button className="button small" onClick={() => onEdit(item.productId)}>{tr("修改货物与单位", "Edit cargo and units")}</button></div><ul>{item.reasons.map(reason => <li key={reason}>{trText(reason)}</li>)}</ul></article>;
    })}
    {!items.length && <p>{tr("当前清单没有待装需求，请检查货物数量。", "The manifest has no cargo demand; check the quantities.")}</p>}
    <button className="button small" onClick={() => onEdit()}>{tr("返回货物清单", "Return to cargo manifest")}</button>
  </section>;
}
