import { describe, expect, it } from "vitest";
import { buildShippingMarksHtml, buildVgmDeclarationHtml, computeCenterOfGravity } from "./vgm-cog";
import { computeLandedCostBreakdown } from "./landed-cost";
import { CONTAINER_PRESETS, SAMPLE_PRODUCTS } from "./presets";
import { pack } from "./engine";

describe("3D CoG, VGM Declaration, Shipping Marks & Landed Cost", () => {
  const plan = pack({
    workflow: "direct",
    mode: "mixed",
    strategy: "practical",
    container: CONTAINER_PRESETS[0],
    clearance: 10,
    products: SAMPLE_PRODUCTS.map((p) => ({ ...p, quantity: 10 })),
  });

  it("computes 3D center of gravity and front/rear axle split accurately", () => {
    const cog = computeCenterOfGravity(plan);
    expect(cog.totalWeightKg).toBeGreaterThan(0);
    expect(cog.frontAxlePct + cog.rearAxlePct).toBeCloseTo(100, 0);
    expect(cog.leftPct + cog.rightPct).toBeCloseTo(100, 0);
    expect(["balanced", "caution", "imbalanced"]).toContain(cog.status);
  });

  it("generates SOLAS VGM declaration HTML with total VGM = cargo + tare", () => {
    const html = buildVgmDeclarationHtml(plan, {
      containerNo: "MSCU1234567",
      sealNo: "SL998877",
      bookingNo: "BK202601",
      shipper: "CargoFit Export Co.",
      tareWeightKg: 3800,
      method: "Method 2",
    });
    expect(html).toContain("SOLAS VERIFIED GROSS MASS");
    expect(html).toContain("MSCU1234567");
    expect(html).toContain("3,800 kg");
  });

  it("generates sequential batch shipping marks HTML for all loaded SKUs", () => {
    const html = buildShippingMarksHtml(plan, SAMPLE_PRODUCTS, {
      consignee: "ACME IMPORTS LLC",
      destination: "LOS ANGELES",
      poNo: "PO-2026-88",
      origin: "MADE IN CHINA",
    });
    expect(html).toContain("ACME IMPORTS LLC");
    expect(html).toContain("PO-2026-88");
    expect(html).toContain("C/NO.: 1–");
  });

  it("allocates full DDP/CIF landed costs across SKUs by CBM and W/M", () => {
    const report = computeLandedCostBreakdown(
      plan,
      SAMPLE_PRODUCTS,
      {
        currency: "USD",
        oceanFreight: 2800,
        truckingFee: 450,
        customsAndPortFee: 350,
        insuranceFee: 100,
        dutyRatePercent: 8,
        allocationBasis: "cbm",
      },
      { [SAMPLE_PRODUCTS[0].sku]: 50 },
    );
    expect(report.totalLogisticsCost).toBe(3700);
    expect(report.rows.length).toBeGreaterThan(0);
    const allocatedSum = report.rows.reduce((s, r) => s + r.allocatedLogistics, 0);
    expect(allocatedSum).toBeCloseTo(3700, 0);
  });
});

import { validatePacking } from "./engine";
import type { PlacedPallet, ProductInput } from "./types";

describe("Branch(5) QA Hardening Regressions (BUG-001 to BUG-006)", () => {
  it("BUG-001 & BUG-002: separates identical SKUs with different specs/weights and never fabricates 92% net weight", () => {
    const lineA: ProductInput = {
      id: "line-a", sku: "SAME-SKU", name: "Item A",
      length: 500, width: 400, height: 300, weight: 10, quantity: 2,
      color: "#236f7a", allowRotate: false, rotationPolicy: "fixed", stackable: true, maxStackLayers: 5, priority: 1,
    };
    const lineB: ProductInput = {
      id: "line-b", sku: "SAME-SKU", name: "Item B",
      length: 600, width: 500, height: 400, weight: 25, quantity: 3,
      color: "#d97706", allowRotate: false, rotationPolicy: "fixed", stackable: true, maxStackLayers: 5, priority: 2,
    };
    const mixed = pack({
      workflow: "direct", mode: "mixed", strategy: "maximum",
      container: CONTAINER_PRESETS[0], clearance: 0, products: [lineA, lineB],
    });
    expect(mixed.metrics.loadedCount).toBe(5);

    const html = buildShippingMarksHtml(mixed, [lineA, lineB], {
      consignee: "BUYER", destination: "LA", poNo: "PO-1", origin: "MADE IN CHINA",
    });
    // Must render 2 separate cards (one per order line/spec), NOT merge into 1 card!
    expect((html.match(/class="mark-card"/g) ?? []).length).toBe(2);
    expect(html).toContain("10.0 KG");
    expect(html).toContain("25.0 KG");
    expect(html).toContain("50.0 × 40.0 × 30.0 CM");
    expect(html).toContain("60.0 × 50.0 × 40.0 CM");
    // Must NOT fabricate 23.0 KG (0.92 * 25) when netWeight is not supplied!
    expect(html).not.toContain("23.0 KG");
    expect(html).toContain("N/A (Not Specified)");

    // When explicit verified net weight is provided, render it accurately
    const withNw = buildShippingMarksHtml(mixed, [lineA, lineB], {
      consignee: "BUYER", destination: "LA", poNo: "PO-1", origin: "MADE IN CHINA",
      netWeightKgByProductId: { "line-b": 22.5 },
    });
    expect(withNw).toContain("22.5 KG");
  });

  it("BUG-003 & BUG-004: VGM rejects non-positive tare weight and requires verifiedScaleWeightKg for Method 1", () => {
    const p = pack({
      workflow: "direct", mode: "mixed", strategy: "maximum",
      container: CONTAINER_PRESETS[0], clearance: 0,
      products: [{ ...SAMPLE_PRODUCTS[0], quantity: 2 }],
    });
    expect(() =>
      buildVgmDeclarationHtml(p, {
        containerNo: "MSCU1234567", sealNo: "SL1", bookingNo: "BK1", shipper: "Co",
        tareWeightKg: -100, method: "Method 2",
      }),
    ).toThrow(/tare weight/i);
    expect(() =>
      buildVgmDeclarationHtml(p, {
        containerNo: "MSCU1234567", sealNo: "SL1", bookingNo: "BK1", shipper: "Co",
        tareWeightKg: 0, method: "Method 2",
      }),
    ).toThrow(/tare weight/i);
    expect(() =>
      buildVgmDeclarationHtml(p, {
        containerNo: "MSCU1234567", sealNo: "SL1", bookingNo: "BK1", shipper: "Co",
        tareWeightKg: 2200, method: "Method 1",
      }),
    ).toThrow(/Method 1/i);

    const m1 = buildVgmDeclarationHtml(p, {
      containerNo: "MSCU1234567", sealNo: "SL1", bookingNo: "BK1", shipper: "Co",
      tareWeightKg: 2200, method: "Method 1", verifiedScaleWeightKg: 2450.5, weighingScaleRef: "WB-991",
    });
    expect(m1).toContain("2,450.5 kg");
    expect(m1).toContain("WB-991");
  });

  it("BUG-006: validatePacking returns valid:false instead of throwing TypeError on null pallet entries", () => {
    const res = validatePacking(
      [], CONTAINER_PRESETS[0], 0, [], "maximum", "mixed",
      [null as unknown as PlacedPallet],
    );
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
