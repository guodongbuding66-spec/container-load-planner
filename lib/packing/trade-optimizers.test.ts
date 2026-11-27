import { describe, expect, it } from "vitest";
import { pack } from "./engine";
import {
  analyzePinwheelPallets,
  calculateConsigneeFreightSplit,
  optimizeCartonDimensions,
  optimizeMasterCartonFromUnit,
  suggestGapFill,
} from "./trade-optimizers";
import type { ContainerSpec, ProductInput } from "./types";

const c20gp: ContainerSpec = {
  id: "20gp",
  name: "20GP",
  length: 5898,
  width: 2350,
  height: 2393,
  doorWidth: 2340,
  doorHeight: 2292,
  maxWeight: 28200,
};

const hq40: ContainerSpec = {
  id: "40hq",
  name: "40HQ",
  length: 12032,
  width: 2350,
  height: 2700,
  doorWidth: 2340,
  doorHeight: 2597,
  maxWeight: 28600,
};

describe("trade-optimizers (M1, M2, M3, M4)", () => {
  it("M2: increases pallet count in a 20GP using pinwheel layout (1200x1000 -> 9, EUR 1200x800 -> 11)", () => {
    const ind = analyzePinwheelPallets(c20gp, 1200, 1000, 0);
    expect(ind.pinwheelCount).toBe(9);
    expect(ind.requiresFourWayPallet).toBe(true);
    expect(ind.gainOverAligned).toBe(1);

    const eur = analyzePinwheelPallets(c20gp, 1200, 800, 0);
    expect(eur.pinwheelCount).toBe(11);
    expect(eur.gainOverAligned).toBe(3);
  });

  it("M1: suggests extra cartons to raise container utilization without exceeding payload", () => {
    const prod: ProductInput = {
      id: "a",
      sku: "SKU-A",
      name: "Carton A",
      length: 600,
      width: 400,
      height: 400,
      weight: 15,
      quantity: 100,
      priority: 50,
      rotationPolicy: "upright",
      stackable: true,
      maxStackLayers: 0,
      color: "#0F766E",
    };
    const plan = pack({ mode: "mixed", strategy: "practical", container: hq40, clearance: 10, products: [prod] });
    const rec = suggestGapFill(plan, [prod], { strategy: "max_volume", targetUtilizationPct: 92 });
    expect(rec.suggestions.length).toBe(1);
    expect(rec.suggestions[0].recommendedAddQty).toBeGreaterThan(0);
    expect(rec.afterVolumePct).toBeGreaterThan(rec.beforeVolumePct);
    expect(rec.afterWeightPct).toBeLessThanOrEqual(100);
  });

  it("M3: identifies carton dimension trim that increases container capacity", () => {
    const opt = optimizeCartonDimensions({ length: 610, width: 410, height: 460, weight: 12 }, hq40, 10, {
      maxDeltaMm: 25,
      stepMm: 5,
      containerFreightUsd: 3000,
    });
    expect(opt.baselineCount).toBeGreaterThan(0);
    expect(opt.candidates.length).toBeGreaterThan(0);
    expect(opt.candidates[0].gainCartons).toBeGreaterThan(0);
    expect(opt.candidates[0].freightSavedPerCartonUsd).toBeGreaterThan(0);
  });

  it("M4: reconciles multi-consignee freight split exactly to total freight", () => {
    const p1: ProductInput = {
      id: "c1",
      sku: "CUST-1",
      name: "Item 1",
      length: 1000,
      width: 1000,
      height: 1000,
      weight: 200,
      quantity: 4,
      priority: 80,
      rotationPolicy: "upright",
      stackable: true,
      maxStackLayers: 0,
      color: "#0F766E",
      orderLine: { orderReference: "", lineReference: "l1", batch: "", customer: "Buyer Alpha", destination: "LA", stop: 2 },
    };
    const p2: ProductInput = {
      ...p1,
      id: "c2",
      sku: "CUST-2",
      priority: 40,
      quantity: 2,
      orderLine: { orderReference: "", lineReference: "l2", batch: "", customer: "Buyer Beta", destination: "Long Beach", stop: 1 },
    };
    const plan = pack({ mode: "mixed", strategy: "practical", container: c20gp, clearance: 10, products: [p1, p2] });
    const split = calculateConsigneeFreightSplit(plan, [p1, p2], 3200, "USD", "cbm");
    expect(split.rows).toHaveLength(2);
    const sum = Number(split.rows.reduce((s, r) => s + r.allocatedFreight, 0).toFixed(2));
    expect(sum).toBe(3200);
  });

  it("M3 Mode B: recommends master carton spec from retail unit dimensions under FBA weight limit", () => {
    const recs = optimizeMasterCartonFromUnit(
      { unitLengthMm: 180, unitWidthMm: 120, unitHeightMm: 100, unitWeightKg: 0.85, maxCartonWeightKg: 22.5, minPcsPerCarton: 6, maxPcsPerCarton: 24 },
      hq40,
      10,
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].cartonWeightKg).toBeLessThanOrEqual(22.5);
    expect(recs[0].totalUnitsPerContainer).toBeGreaterThan(1000);
  });

});
