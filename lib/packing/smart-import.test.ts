import { describe, expect, it } from "vitest";
import { parseCombinedDimensions, parseSmartCargoText, smartRowsToProducts } from "./smart-import";

describe("smart-import (M6)", () => {
  it("parses single-column combined dimensions with units", () => {
    expect(parseCombinedDimensions("60*40*35cm")).toEqual({ l: 60, w: 40, h: 35, unit: "cm" });
    expect(parseCombinedDimensions('24" x 18" x 12"')).toEqual({ l: 24, w: 18, h: 12, unit: "in" });
    expect(parseCombinedDimensions("600×400×350 mm")).toEqual({ l: 600, w: 400, h: 350, unit: "mm" });
  });

  it("parses bilingual Excel TSV paste with headers and combined dimensions", () => {
    const tsv = [
      "货号\t品名\t外箱尺寸\t毛重(kg)\t箱数\t客户\t卸货顺序",
      "SKU-A\tChair\t60x40x35cm\t12.5\t40\tBuyer A\t1",
      "SKU-B\tTable\t120*60*15cm\t24\t20\tBuyer B\t2",
    ].join("\n");
    const res = parseSmartCargoText(tsv);
    expect(res.headerMatched).toBe(true);
    expect(res.validCount).toBe(2);
    expect(res.errorCount).toBe(0);
    expect(res.rows[0]).toMatchObject({
      sku: "SKU-A",
      lengthMm: 600,
      widthMm: 400,
      heightMm: 350,
      weightKg: 12.5,
      quantity: 40,
      customer: "Buyer A",
      unloadStop: 1,
    });
    const products = smartRowsToProducts(res.rows);
    expect(products).toHaveLength(2);
    expect(products[0].orderLine?.stop).toBe(1);
  });

  it("flags invalid negative rows and detects possible cm values", () => {
    const csv = "SKU-1,50,40,30,10,20\nSKU-BAD,-5,40,30,10,-2";
    const res = parseSmartCargoText(csv);
    expect(res.validCount).toBe(1);
    expect(res.errorCount).toBe(1);
    expect(res.unitHint).toBe("possible_cm");
  });
});
