import { describe, expect, it } from "vitest";
import { exactCartonVolumeCbm, roundedCartonVolumeCbm } from "./volume";

describe("carton CBM calculation", () => {
  it.each([
    [{ length: 1270, width: 550, height: 290 }, 0.202565, 0.2],
    [{ length: 1670, width: 730, height: 130 }, 0.158483, 0.16],
    [{ length: 1640, width: 545, height: 120 }, 0.107256, 0.11],
  ])("calculates exact geometry and quotation-rounded CBM", (carton, exact, rounded) => {
    expect(exactCartonVolumeCbm(carton)).toBeCloseTo(exact, 6);
    expect(roundedCartonVolumeCbm(carton)).toBe(rounded);
  });

  it("never returns a negative or non-finite volume", () => {
    expect(exactCartonVolumeCbm({ length: -1, width: 500, height: 500 })).toBe(0);
    expect(exactCartonVolumeCbm({ length: Number.NaN, width: 500, height: 500 })).toBe(0);
  });
});
