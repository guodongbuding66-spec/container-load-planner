import { describe, expect, it } from "vitest";
import {
  fromKilograms,
  fromMillimeters,
  isLengthUnit,
  isWeightUnit,
  toKilograms,
  toMillimeters,
} from "./units";

describe("packing unit conversions", () => {
  it("keeps millimeters and kilograms as the canonical engine units", () => {
    expect(toMillimeters(127, "cm")).toBe(1270);
    expect(toMillimeters(1.8, "m")).toBe(1800);
    expect(toMillimeters(50, "in")).toBe(1270);
    expect(toKilograms(100, "lb")).toBeCloseTo(45.359237, 8);
  });

  it("round-trips display values without changing canonical geometry", () => {
    expect(toMillimeters(fromMillimeters(1270, "in"), "in")).toBeCloseTo(1270, 10);
    expect(toKilograms(fromKilograms(31, "lb"), "lb")).toBeCloseTo(31, 10);
  });

  it("accepts only supported persisted unit codes", () => {
    expect(isLengthUnit("cm")).toBe(true);
    expect(isLengthUnit("feet")).toBe(false);
    expect(isWeightUnit("lb")).toBe(true);
    expect(isWeightUnit("g")).toBe(false);
  });
});
