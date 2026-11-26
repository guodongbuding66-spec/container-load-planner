import { describe, expect, it } from "vitest";
import { analyzeOogCargo } from "./oog-calculator";
import { mergeProductsIntoLibrary, SAMPLE_CLIENT_TEMPLATES, savedSkuToProduct } from "./sku-library";
import { CONTAINER_PRESETS, SAMPLE_PRODUCTS } from "./presets";

describe("v1.2 SKU Library & OOG Special Container Calculator", () => {
  it("merges products into SKU library without duplicating SKUs and converts back to ProductInput", () => {
    const lib = mergeProductsIntoLibrary([], SAMPLE_PRODUCTS, "VIP-Client");
    expect(lib.length).toBe(SAMPLE_PRODUCTS.length);
    expect(lib[0].clientTag).toBe("VIP-Client");

    const again = mergeProductsIntoLibrary(lib, [SAMPLE_PRODUCTS[0]], "VIP-Client");
    expect(again.length).toBe(SAMPLE_PRODUCTS.length);

    const prod = savedSkuToProduct(SAMPLE_CLIENT_TEMPLATES["US-Outdoor-Client"][0], 0);
    expect(prod.sku).toBe("PATIO-CHAIR-01");
    expect(prod.length).toBe(620);
  });

  it("detects OOG over-height and over-width protrusions and recommends Flat Rack / Open Top", () => {
    const std = CONTAINER_PRESETS[0]; // 40HQ
    const normal = analyzeOogCargo(std, SAMPLE_PRODUCTS);
    expect(normal.hasOogCargo).toBe(false);
    expect(normal.recommendedEquipment).toBe("Standard");

    const mach = { ...SAMPLE_PRODUCTS[0], sku: "CNC-LATHE-01", length: 4200, width: 2650, height: 2950, weight: 4800, quantity: 1, rotationPolicy: "fixed" as const };
    const oog = analyzeOogCargo(std, [mach]);
    expect(oog.hasOogCargo).toBe(true);
    expect(oog.maxOverHeightMm).toBe(2950 - std.height);
    expect(oog.maxOverWidthMm).toBe(2650 - std.width);
    expect(oog.recommendedEquipment).toBe("40FR (Flat Rack)");
    expect(oog.totalEstimatedLostSlots).toBeGreaterThanOrEqual(2);
    expect(oog.items[0].recommendedLashingStraps).toBeGreaterThanOrEqual(4);
  });
});
