"use client";
import { useEffect, useRef } from "react";
import { crateHeightBreakdown, withCrateExteriorHeight } from "../lib/packing/packaging-height";
import { formatEditableNumber } from "../lib/packing/numeric-draft";
import type { FloorPalletConfig } from "../lib/packing/types";
import { NumericInput } from "./numeric-input";
import { tr, useLanguage } from "./language";

const KEY = "pallet-build:exterior-height";
export function CrateExteriorHeight({ value, onChange, onValidityChange, resetToken = 0 }: {
  value: FloorPalletConfig; onChange: (config: FloorPalletConfig) => void;
  onValidityChange: (key: string, valid: boolean) => void; resetToken?: number;
}) {
  useLanguage();
  const height = crateHeightBreakdown(value), validity = useRef(onValidityChange);
  useEffect(() => { validity.current = onValidityChange; }, [onValidityChange]);
  // External dimension/template changes reset the draft; unmounting must release its validation key.
  useEffect(() => { validity.current(KEY, true); return () => validity.current(KEY, true); }, [height.base, height.interior, height.lid, resetToken]);
  const fmt = (n: number) => formatEditableNumber(n, 6);
  return <section className="crate-exterior-height" aria-label={tr("木箱高度设置", "Crate height settings")}>
    <label>{tr("木箱外部总高（含底座和箱盖）", "Crate exterior height (including base and lid)")}
      <div className="pallet-build-number"><NumericInput value={height.exterior} precision={1} min={height.base + height.lid + .000001} max={height.base + height.lid + 100000} resetToken={resetToken}
        ariaLabel={tr("木箱外部总高", "Crate exterior height")} onValueChange={n => onChange(withCrateExteriorHeight(value, n))} onValidityChange={valid => onValidityChange(KEY, valid)}/><span>mm</span></div>
    </label>
    <p className="helper-text">{tr("底座", "Base")} {fmt(height.base)} + {tr("内部净高", "Interior")} {fmt(height.interior)} + {tr("箱盖", "Lid")} {fmt(height.lid)} = {tr("外部总高", "Exterior")} {fmt(height.exterior)} mm</p>
    <p className="helper-text">{tr("直接输入实物木箱总高，自动换算内部净高；总高必须大于底座和箱盖之和。之后修改底座、内部净高或箱盖，总高会同步更新。", "Enter the actual complete crate height to calculate the interior height. It must exceed the base plus lid. Later changes to the base, interior or lid update the exterior height.")}</p>
  </section>;
}
