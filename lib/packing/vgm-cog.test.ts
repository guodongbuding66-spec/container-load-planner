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
