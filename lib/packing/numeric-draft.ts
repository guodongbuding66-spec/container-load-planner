export type NumericDraftOptions = {
  integer?: boolean;
  min?: number;
  max?: number;
};

export type NumericDraftResult =
  | { state: "empty" | "invalid" }
  | { state: "valid"; value: number };

export function parseNumericDraft(draft: string, options: NumericDraftOptions = {}): NumericDraftResult {
  const trimmed = draft.trim();
  if (!trimmed) return { state: "empty" };

  // Signed offsets are valid only for controls that explicitly allow negatives.
  const signed = (options.min ?? 0) < 0;
  const pattern = options.integer
    ? (signed ? /^-?\d+$/ : /^\d+$/)
    : (signed ? /^-?(?:\d+(?:\.\d*)?|\.\d+)$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/);
  if (!pattern.test(trimmed)) return { state: "invalid" };

  const value = Number(trimmed);
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value) || value < min || value > max) return { state: "invalid" };
  return { state: "valid", value };
}

export function formatEditableNumber(value: number, precision = 4) {
  if (!Number.isFinite(value)) return "";
  const factor = 10 ** Math.max(0, precision);
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return String(rounded);
}
