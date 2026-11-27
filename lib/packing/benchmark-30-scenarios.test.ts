import { describe, expect, it } from "vitest";
import { pack, validatePacking } from "./engine";
import { CONTAINER_PRESETS, SAMPLE_PRODUCTS } from "./presets";
import type { ContainerSpec, ProductInput } from "./types";

const C20 = CONTAINER_PRESETS.find((c) => c.id === "20gp")!;
const C40 = CONTAINER_PRESETS.find((c) => c.id === "40gp")!;
const C40HQ = CONTAINER_PRESETS.find((c) => c.id === "40hq")!;
const BASE = SAMPLE_PRODUCTS[0];

function makeSku(overrides: Partial<ProductInput>): ProductInput {
  return {
    ...BASE,
    id: overrides.id ?? overrides.sku ?? "SKU-1",
    sku: overrides.sku ?? "SKU-1",
    name: overrides.name ?? overrides.sku ?? "Test Cargo",
    rotationPolicy: "fixed",
    stackable: true,
    maxStackLayers: 0,
    ...overrides,
  };
}

interface BenchmarkCase {
  id: string;
  container: ContainerSpec;
  products: ProductInput[];
  mode?: "single" | "mixed";
  strategy?: "maximum" | "practical";
  clearance?: number;
  expectedTotal: number;
  maxErrorPct: number;
  expectedBySku?: Record<string, number>;
}

const CASES: BenchmarkCase[] = [
  // 1-6: Exact modular grid cartons across 20GP / 40GP / 40HQ
  { id: "01-20gp-modular-500x400x300", container: C20, products: [makeSku({ sku: "M1", length: 500, width: 400, height: 300, weight: 10, quantity: 500 })], mode: "single", expectedTotal: Math.floor(C20.length / 500) * Math.floor(C20.width / 400) * Math.floor(C20.height / 300), maxErrorPct: 3 },
  { id: "02-40gp-modular-600x400x400", container: C40, products: [makeSku({ sku: "M2", length: 600, width: 400, height: 400, weight: 12, quantity: 1000 })], mode: "single", expectedTotal: Math.floor(C40.length / 600) * Math.floor(C40.width / 400) * Math.floor(C40.height / 400), maxErrorPct: 3 },
  { id: "03-40hq-modular-600x450x450", container: C40HQ, products: [makeSku({ sku: "M3", length: 600, width: 450, height: 450, weight: 14, quantity: 1000 })], mode: "single", expectedTotal: Math.floor(C40HQ.length / 600) * Math.floor(C40HQ.width / 450) * Math.floor(C40HQ.height / 450), maxErrorPct: 3 },
  { id: "04-20gp-practical-sample", container: C20, products: SAMPLE_PRODUCTS, mode: "mixed", strategy: "practical", expectedTotal: 116, maxErrorPct: 3 },
  { id: "05-40gp-practical-sample", container: C40, products: SAMPLE_PRODUCTS, mode: "mixed", strategy: "practical", expectedTotal: 116, maxErrorPct: 3 },
  { id: "06-40hq-practical-sample", container: C40HQ, products: SAMPLE_PRODUCTS, mode: "mixed", strategy: "practical", expectedTotal: 116, maxErrorPct: 3 },

  // 7-12: Payload-capped heavy cargo & non-stackable / layer-capped constraints
  { id: "07-20gp-heavy-250kg-cap", container: { ...C20, maxWeight: 17500 }, products: [makeSku({ sku: "HVY1", length: 600, width: 500, height: 500, weight: 250, quantity: 200 })], mode: "mixed", expectedTotal: 70, maxErrorPct: 3 },
  { id: "08-40hq-us-ipi-19900kg", container: { ...C40HQ, maxWeight: 19900 }, products: [makeSku({ sku: "IPI1", length: 500, width: 400, height: 400, weight: 199, quantity: 200 })], mode: "mixed", expectedTotal: 100, maxErrorPct: 3 },
  { id: "09-nonstackable-floor-only", container: { ...C20, length: 4000, width: 2000, height: 2000, doorWidth: 2000, doorHeight: 2000 }, products: [makeSku({ sku: "NS1", length: 1000, width: 1000, height: 800, weight: 50, quantity: 50, stackable: false })], mode: "mixed", expectedTotal: 8, maxErrorPct: 3 },
  { id: "10-two-layer-max", container: { ...C20, length: 4000, width: 2000, height: 2000, doorWidth: 2000, doorHeight: 2000 }, products: [makeSku({ sku: "L2", length: 1000, width: 1000, height: 500, weight: 30, quantity: 50, maxStackLayers: 2 })], mode: "mixed", expectedTotal: 16, maxErrorPct: 3 },
  { id: "11-three-layer-max", container: { ...C20, length: 3000, width: 2000, height: 2000, doorWidth: 2000, doorHeight: 2000 }, products: [makeSku({ sku: "L3", length: 1000, width: 1000, height: 500, weight: 30, quantity: 50, maxStackLayers: 3 })], mode: "mixed", expectedTotal: 18, maxErrorPct: 3 },
  { id: "12-rear-door-buffer-500mm", container: { ...C20, length: 2500, width: 1200, height: 1200, doorWidth: 1200, doorHeight: 1200, rearDoorClearanceMm: 500 }, products: [makeSku({ sku: "RB1", length: 500, width: 400, height: 300, weight: 10, quantity: 100 })], mode: "mixed", expectedTotal: 48, maxErrorPct: 3 },

  // 13-18: Multi-SKU mixed orders with per-SKU exact verification
  {
    id: "13-two-sku-balanced-20gp",
    container: C20,
    products: [
      makeSku({ id: "A1", sku: "A1", length: 600, width: 400, height: 400, weight: 12, quantity: 40 }),
      makeSku({ id: "B1", sku: "B1", length: 500, width: 400, height: 350, weight: 10, quantity: 50 }),
    ],
    mode: "mixed",
    expectedTotal: 90,
    maxErrorPct: 3,
    expectedBySku: { A1: 40, B1: 50 },
  },
  {
    id: "14-three-sku-furniture-40hq",
    container: C40HQ,
    products: [
      makeSku({ id: "SOFA", sku: "SOFA", length: 1200, width: 800, height: 800, weight: 45, quantity: 20 }),
      makeSku({ id: "TABLE", sku: "TABLE", length: 1000, width: 600, height: 200, weight: 22, quantity: 40 }),
      makeSku({ id: "LAMP", sku: "LAMP", length: 400, width: 400, height: 500, weight: 8, quantity: 60 }),
    ],
    mode: "mixed",
    expectedTotal: 120,
    maxErrorPct: 3,
    expectedBySku: { SOFA: 20, TABLE: 40, LAMP: 60 },
  },
  {
    id: "15-four-sku-electronics-40gp",
    container: C40,
    products: [
      makeSku({ id: "TV55", sku: "TV55", length: 1350, width: 180, height: 850, weight: 18, quantity: 40 }),
      makeSku({ id: "MON27", sku: "MON27", length: 680, width: 160, height: 450, weight: 7, quantity: 80 }),
      makeSku({ id: "SPK", sku: "SPK", length: 450, width: 350, height: 350, weight: 9, quantity: 60 }),
      makeSku({ id: "ACC", sku: "ACC", length: 300, width: 250, height: 200, weight: 4, quantity: 100 }),
    ],
    mode: "mixed",
    expectedTotal: 280,
    maxErrorPct: 3,
    expectedBySku: { TV55: 40, MON27: 80, SPK: 60, ACC: 100 },
  },
  {
    id: "16-upright-rotation-wide-box",
    container: { ...C20, length: 3000, width: 1200, height: 1200, doorWidth: 1200, doorHeight: 1200 },
    products: [makeSku({ sku: "ROT1", length: 600, width: 1000, height: 400, weight: 15, quantity: 15, rotationPolicy: "upright" })],
    mode: "mixed",
    expectedTotal: 15,
    maxErrorPct: 3,
  },
  {
    id: "17-any-rotation-compact",
    container: { ...C20, length: 2400, width: 1200, height: 1200, doorWidth: 1200, doorHeight: 1200 },
    products: [makeSku({ sku: "ANY1", length: 600, width: 400, height: 300, weight: 8, quantity: 48, rotationPolicy: "any" })],
    mode: "mixed",
    expectedTotal: 48,
    maxErrorPct: 3,
  },
  {
    id: "18-clearance-10mm-exact",
    container: { ...C20, length: 2020, width: 1020, height: 1010, doorWidth: 1020, doorHeight: 1010 },
    products: [makeSku({ sku: "CLR1", length: 500, width: 500, height: 500, weight: 10, quantity: 20 })],
    mode: "mixed",
    clearance: 10,
    expectedTotal: 16,
    maxErrorPct: 3,
  },

  // 19-24: True 3D Vertical Nesting ΔH scenarios (buckets, flowerpots, chairs) with full nominal dz retained
  {
    id: "19-nested-buckets-mixed",
    container: { ...C20, length: 2000, width: 1200, height: 1200, doorWidth: 1200, doorHeight: 1200 },
    products: [makeSku({ sku: "BUCKET-20L", length: 500, width: 400, height: 300, weight: 2, quantity: 100, nestingDeltaHeightMm: 100 })],
    mode: "mixed",
    expectedTotal: 100,
    maxErrorPct: 3,
  },
  {
    id: "20-nested-buckets-single-full-col",
    container: { ...C20, length: 2000, width: 1200, height: 1200, doorWidth: 1200, doorHeight: 1200 },
    products: [makeSku({ sku: "BUCKET-FULL", length: 500, width: 400, height: 300, weight: 2, quantity: 150, nestingDeltaHeightMm: 100 })],
    mode: "single",
    expectedTotal: 120,
    maxErrorPct: 3,
  },
  {
    id: "21-nested-flowerpots-delta50",
    container: { ...C20, length: 1500, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000 },
    products: [makeSku({ sku: "POT-300", length: 500, width: 500, height: 300, weight: 1.5, quantity: 90, nestingDeltaHeightMm: 50 })],
    mode: "single",
    expectedTotal: 90, // 3x2 cols * (1 + (1000-300)/50 = 15) = 90
    maxErrorPct: 3,
  },
  {
    id: "22-nested-chairs-40hq-mixed",
    container: { ...C40HQ, length: 2400, width: 1200, height: 2400, doorWidth: 1200, doorHeight: 2400 },
    products: [makeSku({ sku: "CHAIR-STACK", length: 600, width: 600, height: 800, weight: 4, quantity: 72, nestingDeltaHeightMm: 200 })],
    mode: "mixed",
    expectedTotal: 72, // 4x2 cols * (1 + (2400-800)/200 = 9) = 72
    maxErrorPct: 3,
  },
  {
    id: "23-nested-with-max-layers-cap",
    container: { ...C20, length: 1000, width: 800, height: 1200, doorWidth: 800, doorHeight: 1200 },
    products: [makeSku({ sku: "TUB-CAP6", length: 500, width: 400, height: 300, weight: 3, quantity: 50, nestingDeltaHeightMm: 100, maxStackLayers: 6 })],
    mode: "single",
    expectedTotal: 24, // 2x2 cols * 6 capped layers = 24
    maxErrorPct: 3,
  },
  {
    id: "24-nested-plus-regular-mixed",
    container: { ...C20, length: 2000, width: 1200, height: 1200, doorWidth: 1200, doorHeight: 1200 },
    products: [
      makeSku({ id: "NEST-A", sku: "NEST-A", length: 500, width: 400, height: 300, weight: 2, quantity: 40, nestingDeltaHeightMm: 100 }),
      makeSku({ id: "REG-B", sku: "REG-B", length: 500, width: 400, height: 300, weight: 10, quantity: 20 }),
    ],
    mode: "mixed",
    expectedTotal: 60,
    maxErrorPct: 3,
    expectedBySku: { "NEST-A": 40, "REG-B": 20 },
  },

  // 25-30: High-volume mixed retail, pallet-sized boxes, tall narrow appliances, and door-width edge cases
  { id: "25-tall-fridge-40hq", container: C40HQ, products: [makeSku({ sku: "FRIDGE", length: 700, width: 700, height: 1900, weight: 65, quantity: 50, stackable: false })], mode: "mixed", expectedTotal: 50, maxErrorPct: 3 },
  { id: "26-door-width-exact-fit", container: { ...C20, length: 2000, width: 1200, height: 1200, doorWidth: 1000, doorHeight: 1000 }, products: [makeSku({ sku: "DOOR-OK", length: 1000, width: 1000, height: 1000, weight: 50, quantity: 2 })], mode: "mixed", expectedTotal: 2, maxErrorPct: 3 },
  { id: "27-door-width-blocked", container: { ...C20, length: 2000, width: 1200, height: 1200, doorWidth: 999, doorHeight: 1000 }, products: [makeSku({ sku: "DOOR-NO", length: 1000, width: 1000, height: 1000, weight: 50, quantity: 2 })], mode: "mixed", expectedTotal: 0, maxErrorPct: 3 },
  { id: "28-40hq-mixed-apparel-120", container: C40HQ, products: [makeSku({ id: "APP1", sku: "APP1", length: 600, width: 400, height: 400, weight: 11, quantity: 60 }), makeSku({ id: "APP2", sku: "APP2", length: 550, width: 380, height: 350, weight: 9, quantity: 60 })], mode: "mixed", expectedTotal: 120, maxErrorPct: 3, expectedBySku: { APP1: 60, APP2: 60 } },
  { id: "29-20gp-spare-parts-100", container: C20, products: [makeSku({ id: "PRT1", sku: "PRT1", length: 400, width: 300, height: 250, weight: 15, quantity: 50 }), makeSku({ id: "PRT2", sku: "PRT2", length: 450, width: 350, height: 300, weight: 18, quantity: 50 })], mode: "mixed", expectedTotal: 100, maxErrorPct: 3, expectedBySku: { PRT1: 50, PRT2: 50 } },
  { id: "30-40gp-mixed-hardware-150", container: C40, products: [makeSku({ id: "HW1", sku: "HW1", length: 500, width: 350, height: 300, weight: 14, quantity: 75 }), makeSku({ id: "HW2", sku: "HW2", length: 450, width: 400, height: 320, weight: 12, quantity: 75 })], mode: "mixed", expectedTotal: 150, maxErrorPct: 3, expectedBySku: { HW1: 75, HW2: 75 } },
];

describe("30-Scenario Container & Per-SKU Accuracy Benchmark (<= 3% error)", () => {
  it("passes all 30 diverse scenarios with valid 3D geometry, nominal dimensions, and <= 3% error", () => {
    expect(CASES).toHaveLength(30);
    for (const tc of CASES) {
      const result = pack({
        container: tc.container,
        products: tc.products,
        clearance: tc.clearance ?? 0,
        strategy: tc.strategy ?? "maximum",
        mode: tc.mode ?? "mixed",
      });

      expect(result.validation.valid, `${tc.id}: ${result.validation.errors.join("; ")}`).toBe(true);
      const actual = result.placements.length;
      if (tc.expectedTotal === 0) {
        expect(actual, tc.id).toBe(0);
      } else {
        const errPct = (Math.abs(actual - tc.expectedTotal) / tc.expectedTotal) * 100;
        expect(errPct, `${tc.id}: expected ${tc.expectedTotal}, got ${actual} (${errPct.toFixed(2)}%)`).toBeLessThanOrEqual(tc.maxErrorPct);
      }

      // Verify full nominal physical height is retained even for nested stacks
      for (const p of tc.products) {
        if (p.nestingDeltaHeightMm) {
          const placedOfSku = result.placements.filter((b) => b.productId === p.id);
          expect(placedOfSku.every((b) => Math.abs(b.dz - p.height) <= 1e-6), `${tc.id} nominal height retained`).toBe(true);
        }
      }

      if (tc.expectedBySku) {
        for (const [sku, expQty] of Object.entries(tc.expectedBySku)) {
          const gotQty = result.placements.filter((b) => b.sku === sku).length;
          const skuErrPct = expQty === 0 ? (gotQty === 0 ? 0 : 100) : (Math.abs(gotQty - expQty) / expQty) * 100;
          expect(skuErrPct, `${tc.id} SKU ${sku}: expected ${expQty}, got ${gotQty}`).toBeLessThanOrEqual(tc.maxErrorPct);
        }
      }
    }
  });

  it("rejects 1mm intrusion collision between non-nested boxes in validatePacking", () => {
    const p = makeSku({ id: "COLL", sku: "COLL", length: 500, width: 400, height: 300, weight: 10, quantity: 2 });
    const c: ContainerSpec = { ...C20, length: 2000, width: 1200, height: 1200, doorWidth: 1200, doorHeight: 1200 };
    const report = validatePacking(
      [
        { id: "b1", productId: "COLL", sku: "COLL", name: "COLL", color: "#0F766E", x: 0, y: 0, z: 0, dx: 500, dy: 400, dz: 300, weight: 10, orientation: "LWH", layer: 1 },
        { id: "b2", productId: "COLL", sku: "COLL", name: "COLL", color: "#0F766E", x: 499, y: 0, z: 0, dx: 500, dy: 400, dz: 300, weight: 10, orientation: "LWH", layer: 1 },
      ],
      c,
      0,
      [p],
    );
    expect(report.valid).toBe(false);
  });
});
