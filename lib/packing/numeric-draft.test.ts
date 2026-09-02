import { describe, expect, it } from "vitest";
import { formatEditableNumber, parseNumericDraft } from "./numeric-draft";

describe("numeric draft input", () => {
  it("allows an empty intermediate draft instead of coercing it to zero", () => {
    expect(parseNumericDraft("")).toEqual({ state: "empty" });
    expect(parseNumericDraft("20")).toEqual({ state: "valid", value: 20 });
  });

  it("rejects partial or out-of-range values until editing is complete", () => {
    expect(parseNumericDraft(".")).toEqual({ state: "invalid" });
    expect(parseNumericDraft("2.5", { integer: true })).toEqual({ state: "invalid" });
    expect(parseNumericDraft("101", { integer: true, max: 100 })).toEqual({ state: "invalid" });
  });

  it("formats editable numbers without grouping or padded zeroes", () => {
    expect(formatEditableNumber(20, 2)).toBe("20");
    expect(formatEditableNumber(127 / 2.54, 3)).toBe("50");
  });
});
