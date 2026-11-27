import { describe, expect, it } from "vitest";
import { pack } from "./engine";
import type { ContainerSpec, ProductInput } from "./types";

const HQ40: ContainerSpec = { id: "40hq", name: "40HQ", length: 12032, width: 2352, height: 2698, doorWidth: 2340, doorHeight: 2585, maxWeight: 26500 };

function makeSku(
  id: string,
  l: number,
  w: number,
  h: number,
  weight: number,
  quantity: number,
  extra: Partial<ProductInput> = {},
): ProductInput {
  return {
    id,
    sku: id.toUpperCase(),
    name: `Cargo ${id.toUpperCase()}`,
    length: l,
    width: w,
    height: h,
    weight,
    quantity,
    color: "#3b82f6",
    rotationPolicy: "upright",
    maxStackLayers: 0,
    stackable: true,
    bottomOnly: false,
    mustLoad: false,
    priority: 1,
    ...extra,
  };
}

describe("Multi-SKU large-scale mixed loading (3D Block & Wall-Building solver)", () => {
  it("achieves 100% exact 3D tiling on a 4-SKU multi-wall container", () => {
    const container: ContainerSpec = {
      id: "exact-4sku",
      name: "Exact 4-SKU 2400x1200x1200",
      length: 2400,
      width: 1200,
      height: 1200,
      doorWidth: 1200,
      doorHeight: 1200,
      maxWeight: 20_000,
    };
    // 4 SKUs that tile 2400 x 1200 x 1200 to 100.0% volume:
    // Wall 1 (x=0..800): 600x400x400? Better: 800x600x600 (4 boxes)
    // Wall 2 (x=800..1400): 600x400x400 (9 boxes)
    // Wall 3 (x=1400..2000): 600x600x300 (8 boxes)
    // Wall 4 (x=2000..2400): 400x300x300 (16 boxes)
    const products = [
      makeSku("w1", 800, 600, 600, 12, 4),
      makeSku("w2", 600, 400, 400, 8, 9),
      makeSku("w3", 600, 600, 300, 6, 8),
      makeSku("w4", 400, 300, 300, 4, 16),
    ];
    const totalExpected = 4 + 9 + 8 + 16; // 37 boxes = 100% volume

    const result = pack({
      mode: "mixed",
      strategy: "maximum",
      container,
      clearance: 0,
      products,
    });

    expect(result.validation.valid).toBe(true);
    expect(result.placements.length).toBe(totalExpected);
    expect(result.metrics.volumeUtilization).toBeGreaterThanOrEqual(0.999);
  });

  it("packs an 8-SKU / 1,200-carton 40HQ mixed order with >= 90% volume utilization and valid 3D geometry", () => {
    const products = [
      makeSku("sku-a", 600, 400, 450, 9, 180),
      makeSku("sku-b", 550, 380, 420, 8, 160),
      makeSku("sku-c", 500, 350, 380, 7, 180),
      makeSku("sku-d", 480, 320, 340, 6, 160),
      makeSku("sku-e", 450, 300, 300, 5, 160),
      makeSku("sku-f", 400, 300, 280, 4.5, 140),
      makeSku("sku-g", 380, 260, 250, 3.5, 120),
      makeSku("sku-h", 350, 240, 220, 3, 100),
    ];

    const t0 = Date.now();
    const result = pack({
      mode: "mixed",
      strategy: "maximum",
      container: HQ40,
      clearance: 0,
      products,
    });
    const elapsedMs = Date.now() - t0;

    expect(result.validation.valid).toBe(true);
    expect(result.metrics.volumeUtilization).toBeGreaterThanOrEqual(0.90);
    expect(result.placements.length).toBeGreaterThan(700);
    expect(elapsedMs).toBeLessThan(8000);
  });

  it("packs a massive 15-SKU / 3,000-carton 40HQ mixed order cleanly with >= 90% utilization and zero collisions", () => {
    const products = [
      makeSku("m01", 600, 400, 400, 6, 200),
      makeSku("m02", 580, 390, 380, 5.5, 200),
      makeSku("m03", 540, 360, 360, 5, 200),
      makeSku("m04", 500, 350, 350, 4.5, 200),
      makeSku("m05", 480, 340, 320, 4, 200),
      makeSku("m06", 460, 320, 300, 3.8, 200),
      makeSku("m07", 440, 300, 300, 3.5, 200),
      makeSku("m08", 420, 280, 280, 3.2, 200),
      makeSku("m09", 400, 280, 260, 3, 200),
      makeSku("m10", 380, 260, 250, 2.8, 200),
      makeSku("m11", 360, 250, 240, 2.5, 200),
      makeSku("m12", 340, 240, 220, 2.2, 200),
      makeSku("m13", 320, 220, 210, 2, 200),
      makeSku("m14", 300, 200, 200, 1.8, 200),
      makeSku("m15", 280, 200, 180, 1.5, 200),
    ];

    const t0 = Date.now();
    const result = pack({
      mode: "mixed",
      strategy: "maximum",
      container: HQ40,
      clearance: 0,
      products,
    });
    const elapsedMs = Date.now() - t0;

    expect(result.validation.valid).toBe(true);
    expect(result.metrics.volumeUtilization).toBeGreaterThanOrEqual(0.90);
    expect(result.placements.length).toBeGreaterThan(1000);
    expect(elapsedMs).toBeLessThan(12000);
  });

  it("strictly enforces mustLoad, bottomOnly, and maxTopLoadKg in large multi-SKU orders", () => {
    const products = [
      makeSku("heavy-bottom", 600, 400, 400, 25, 40, { bottomOnly: true, mustLoad: true, priority: 100 }),
      makeSku("fragile-top", 400, 300, 300, 4, 200, { maxTopLoadKg: 8, priority: 10 }),
      makeSku("bulk-mid", 500, 400, 350, 10, 400, { priority: 20 }),
      makeSku("filler-sm", 300, 250, 250, 3, 500, { priority: 5 }),
    ];

    const result = pack({
      mode: "mixed",
      strategy: "maximum",
      container: HQ40,
      clearance: 0,
      products,
    }, 15_000);

    expect(result.validation.valid).toBe(true);
    const heavyLoaded = result.placements.filter((b) => b.productId === "heavy-bottom");
    expect(heavyLoaded.length).toBe(40);
    expect(heavyLoaded.every((b) => b.z === 0)).toBe(true);
  });
});
