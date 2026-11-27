import { describe, expect, it } from "vitest";
import { pack, validatePacking } from "./engine";
import { customerReport, offlineFieldHtml } from "./field-report";
import type { ContainerSpec, PlacedBox, ProductInput } from "./types";

const CUSTOM_CONTAINER: ContainerSpec = {
  id: "qa-custom",
  name: "Custom 2400x1200x1200",
  length: 2400,
  width: 1200,
  height: 1200,
  doorWidth: 1200,
  doorHeight: 1200,
  maxWeight: 10_000,
};

function makeBox(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    id: "prod-1",
    sku: "SKU-FIXED-800",
    name: "Fixed Box",
    length: 800,
    width: 400,
    height: 600,
    weight: 10,
    quantity: 18,
    priority: 10,
    rotationPolicy: "fixed",
    stackable: true,
    maxStackLayers: 0,
    color: "#3b82f6",
    ...overrides,
  };
}

describe("ALG-001 & ALG-002: validatePacking rejects tampered orientation labels", () => {
  it("rejects WLH and LHW label tampering on fixed-rotation boxes even when dx/dy/dz remain unchanged", () => {
    const product = makeBox({ rotationPolicy: "fixed" });
    const plan = pack({
      mode: "mixed",
      strategy: "maximum",
      container: CUSTOM_CONTAINER,
      clearance: 0,
      products: [product],
    });
    expect(plan.placements).toHaveLength(18);
    expect(validatePacking(plan.placements, CUSTOM_CONTAINER, 0, [product], "maximum", "mixed").valid).toBe(true);

    const tamperedWLH = plan.placements.map((b, i) => (i === 0 ? { ...b, orientation: "WLH" as const } : b));
    const resWLH = validatePacking(tamperedWLH, CUSTOM_CONTAINER, 0, [product], "maximum", "mixed");
    expect(resWLH.valid).toBe(false);
    expect(resWLH.errors.length).toBeGreaterThan(0);

    const tamperedLHW = plan.placements.map((b, i) => (i === 0 ? { ...b, orientation: "LHW" as const } : b));
    const resLHW = validatePacking(tamperedLHW, CUSTOM_CONTAINER, 0, [product], "maximum", "mixed");
    expect(resLHW.valid).toBe(false);
    expect(resLHW.errors.length).toBeGreaterThan(0);
  });

  it("handles equal-side upright boxes accurately: allows LWH/WLH, rejects LHW", () => {
    const squareUpright = makeBox({
      id: "sq-up",
      sku: "SQ-400",
      length: 400,
      width: 400,
      height: 600,
      quantity: 4,
      rotationPolicy: "upright",
    });
    const plan = pack({
      mode: "mixed",
      strategy: "maximum",
      container: CUSTOM_CONTAINER,
      clearance: 0,
      products: [squareUpright],
    });
    expect(plan.placements).toHaveLength(4);

    // WLH is a valid upright orientation for 400x400x600
    const asWLH = plan.placements.map((b, i) => (i === 0 ? { ...b, orientation: "WLH" as const, orientationSigns: undefined } : b));
    expect(validatePacking(asWLH, CUSTOM_CONTAINER, 0, [squareUpright], "maximum", "mixed").valid).toBe(true);

    // LHW is NOT allowed for upright policy
    const asLHW = plan.placements.map((b, i) => (i === 0 ? { ...b, orientation: "LHW" as const, orientationSigns: undefined } : b));
    expect(validatePacking(asLHW, CUSTOM_CONTAINER, 0, [squareUpright], "maximum", "mixed").valid).toBe(false);
  });

  it("rejects mismatched label on explicit allowedOrientations whitelist", () => {
    const wlProd = makeBox({
      id: "wl-1",
      sku: "WL-1",
      length: 400,
      width: 400,
      height: 400,
      quantity: 2,
      rotationPolicy: "any",
      allowedOrientations: ["WLH"],
    });
    const plan = pack({
      mode: "mixed",
      strategy: "maximum",
      container: CUSTOM_CONTAINER,
      clearance: 0,
      products: [wlProd],
    });
    expect(plan.placements).toHaveLength(2);
    expect(validatePacking(plan.placements, CUSTOM_CONTAINER, 0, [wlProd], "maximum", "mixed").valid).toBe(true);

    const wrongLabel = plan.placements.map((b, i) => (i === 0 ? { ...b, orientation: "LWH" as const } : b));
    expect(validatePacking(wrongLabel, CUSTOM_CONTAINER, 0, [wlProd], "maximum", "mixed").valid).toBe(false);
  });
});

describe("ALG-003 & ALG-004: validatePacking handles null, non-object, and malformed-ID placements without throwing", () => {
  const product = makeBox({ quantity: 2 });
  const basePlan = pack({
    mode: "mixed",
    strategy: "maximum",
    container: CUSTOM_CONTAINER,
    clearance: 0,
    products: [product],
  });

  it("returns structured invalid report for null, undefined, primitive, and array placement entries", () => {
    for (const badEntry of [null, undefined, 42, "bad", []]) {
      const res = validatePacking([badEntry as unknown as PlacedBox], CUSTOM_CONTAINER, 0, [product], "maximum", "mixed");
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    }
  });

  it("returns structured invalid report for numeric, empty, whitespace, object, array, and duplicate IDs", () => {
    const validFirst = basePlan.placements[0];
    for (const badId of [42, null, undefined, "", "   ", {}, []]) {
      const mutated = [{ ...validFirst, id: badId as unknown as string }];
      const res = validatePacking(mutated, CUSTOM_CONTAINER, 0, [product], "maximum", "mixed");
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    }

    // Duplicate ID
    const dup = [basePlan.placements[0], { ...basePlan.placements[1], id: basePlan.placements[0].id }];
    const dupRes = validatePacking(dup, CUSTOM_CONTAINER, 0, [product], "maximum", "mixed");
    expect(dupRes.valid).toBe(false);
    expect(dupRes.errors.some((e) => e.includes("重复"))).toBe(true);

    // Non-string productId / sku / orientation
    for (const patch of [{ productId: 99 }, { sku: 123 }, { orientation: 456 }]) {
      const mutated = [{ ...validFirst, ...(patch as unknown as Partial<PlacedBox>) }];
      const res = validatePacking(mutated, CUSTOM_CONTAINER, 0, [product], "maximum", "mixed");
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("UI-001 & UI-002: offlineFieldHtml and customerReport include responsive table-wrap & file-input bounds", () => {
  it("wraps all tables in .table-wrap and constrains file inputs without horizontal overflow", () => {
    const product = makeBox({ sku: "VERY-LONG-INDUSTRIAL-SKU-CODE-2026-EXPORT-SERIES", quantity: 6 });
    const plan = pack({
      mode: "mixed",
      strategy: "maximum",
      container: CUSTOM_CONTAINER,
      clearance: 0,
      products: [product],
    });

    const fieldHtml = offlineFieldHtml(plan, [product]);
    const reportZh = customerReport(plan, [product], {
      language: "zh",
      customer: "测试超长外贸客户名称股份有限公司-2026",
      order: "PO-2026-LONG-ORDER-REFERENCE-998877",
      currency: "USD",
      freight: 1850,
    });
    const reportEn = customerReport(plan, [product], {
      language: "en",
      customer: "International Logistics & Industrial Manufacturing Holdings Ltd.",
      order: "PO-2026-LONG-ORDER-REFERENCE-998877",
      currency: "USD",
      freight: 1850,
    });

    for (const html of [fieldHtml, reportZh, reportEn]) {
      expect(html).toContain("box-sizing:border-box");
      expect(html).toContain(".table-wrap{");
      expect(html).toContain('<div class="table-wrap"><table>');
      expect(html).not.toMatch(/(?<!<div class="table-wrap">)<table>/);
    }
  });
});
