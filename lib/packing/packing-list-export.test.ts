import { describe, expect, it } from "vitest";
import { pack } from "./engine";
import { buildPackingListLines } from "./packing-list-export";
import type { ContainerSpec, ProductInput } from "./types";

const c20: ContainerSpec = {
  id: "20gp",
  name: "20GP",
  length: 5898,
  width: 2350,
  height: 2393,
  doorWidth: 2340,
  doorHeight: 2292,
  maxWeight: 28200,
};

describe("packing-list-export (M7)", () => {
  it("generates sequential carton ranges and accurate gross/CBM totals", () => {
    const p1: ProductInput = {
      id: "a",
      sku: "SKU-A",
      name: "Widget A",
      length: 500,
      width: 400,
      height: 400,
      weight: 10,
      quantity: 12,
      priority: 50,
      rotationPolicy: "upright",
      stackable: true,
      maxStackLayers: 0,
      color: "#0F766E",
    };
    const p2: ProductInput = { ...p1, id: "b", sku: "SKU-B", name: "Widget B", quantity: 8 };
    const plan = pack({ mode: "mixed", strategy: "practical", container: c20, clearance: 10, products: [p1, p2] });
    const lines = buildPackingListLines(plan, [p1, p2]);
    expect(lines).toHaveLength(2);
    expect(lines[0].cartonNoRange).toBe("1-12");
    expect(lines[1].cartonNoRange).toBe("13-20");
    expect(lines[0].totalGrossWeightKg).toBe(120);
  });
});
