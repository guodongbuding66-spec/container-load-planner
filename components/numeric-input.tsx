"use client";

import { useEffect, useRef, useState } from "react";
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
}: Props) {
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

  return (
    <input
      aria-label={ariaLabel}
      aria-invalid={!valid}
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
  );
}
