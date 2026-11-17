"use client";

import { useEffect, useId, useRef, useState } from "react";
import { tr, useLanguage } from "./language";
import { formatEditableNumber, parseNumericDraft } from "../lib/packing/numeric-draft";

type Props = {
  value: number;
  onValueChange: (value: number) => void;
  onValidityChange?: (valid: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  ariaLabel: string;
  integer?: boolean;
  min?: number;
  max?: number;
  precision?: number;
  className?: string;
  resetToken?: number;
  showError?: boolean;
};

export function NumericInput({
  value,
  onValueChange,
  onValidityChange,
  onFocusChange,
  ariaLabel,
  integer = false,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  precision = integer ? 0 : 4,
  className,
  resetToken,
  showError = false,
}: Props) {
  useLanguage();
  const errorId = useId();
  const [draft, setDraft] = useState(() => formatEditableNumber(value, precision));
  const [valid, setValid] = useState(true);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(formatEditableNumber(value, precision));
      setValid(true);
    }
  }, [precision, resetToken, value]);

  const updateValidity = (nextValid: boolean) => {
    setValid(nextValid);
    onValidityChange?.(nextValid);
  };

  const error = showError && !valid ? (() => {
    if (!draft.trim()) return tr("此处需要填写数字","Enter a value");
    const number = Number(draft);
    const fmt = (n:number) => n.toLocaleString(undefined, { maximumFractionDigits: 8 });
    if (number < min) return min === 0 ? tr("请填写非负数","Enter zero or a positive number")
      : tr(`不得小于 ${fmt(min)}`,`Minimum ${fmt(min)}`);
    if (number > max) return tr(`不得超过 ${fmt(max)}`,`Maximum ${fmt(max)}`);
    return integer ? tr("请填写整数","Enter a whole number") : tr("请填写数字","Enter a number");
  })() : "";
  return (
    <>
    <input
      aria-label={ariaLabel}
      aria-invalid={!valid}
      aria-describedby={error?errorId:undefined}
      className={["numeric-input", className].filter(Boolean).join(" ")}
      inputMode={integer ? "numeric" : "decimal"}
      type="text"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
        onFocusChange?.(true);
      }}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        const parsed = parseNumericDraft(nextDraft, { integer, min, max });
        if (parsed.state !== "valid") {
          updateValidity(false);
          return;
        }
        updateValidity(true);
        onValueChange(parsed.value);
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = parseNumericDraft(draft, { integer, min, max });
        if (parsed.state === "valid") setDraft(formatEditableNumber(parsed.value, precision));
        onFocusChange?.(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
    {error&&<small className="numeric-error" id={errorId}>{error}</small>}
    </>
  );
}
