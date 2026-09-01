import { describe, expect, it } from "vitest";
import { isObsoleteCalculation } from "./calculation-state";

describe("calculation request state", () => {
  it("rejects results and errors produced for an older input revision", () => {
    expect(isObsoleteCalculation(4, 5)).toBe(true);
    expect(isObsoleteCalculation(5, 5)).toBe(false);
    expect(isObsoleteCalculation(null, 5)).toBe(false);
  });
});
