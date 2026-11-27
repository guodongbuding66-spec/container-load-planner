import { describe, expect, it } from "vitest";
import {
  buildNestedColumnBoxes,
  calcNestedStackHeight,
  compareCylinderPacking,
  estimateDunnageBom,
  inspectReeferAirflow,
  packHexCylinders,
  recommendedPayloadLimitKg,
} from "./trade-compliance";
import { pack } from "./engine";
import type { ContainerSpec, ProductInput } from "./types";

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

const sampleProduct: ProductInput = {
  id: "p1",
  sku: "BOX-1",
  name: "Box",
  length: 1000,
  width: 1000,
  height: 1000,
  weight: 100,
  quantity: 10,
  priority: 50,
  rotationPolicy: "upright",
  stackable: true,
  maxStackLayers: 0,
  color: "#0F766E",
};

describe("trade-compliance (M5)", () => {
  it("calculates vertical nesting height accurately", () => {
    expect(calcNestedStackHeight(300, 60, 1)).toBe(300);
    expect(calcNestedStackHeight(300, 60, 5)).toBe(540);
  });

  it("shows staggered hex packing outperforms matrix grid for drums in 20GP", () => {
    const cmp = compareCylinderPacking(5898, 2350, 400);
    expect(cmp.hexStaggeredCount).toBeGreaterThan(cmp.matrixCount);
    expect(cmp.gainPercent).toBeGreaterThan(0);
  });

  it("applies US IPI and EU 40T road payload limits", () => {
    expect(recommendedPayloadLimitKg(hq40, "us_ipi_road")).toBe(19900);
    expect(recommendedPayloadLimitKg({ ...hq40, id: "20gp", length: 5898 }, "us_ipi_road")).toBe(17500);
    expect(recommendedPayloadLimitKg(hq40, "eu_40t_road")).toBe(23500);
  });

  it("estimates dunnage airbags, desiccant poles, and reefer airflow compliance", () => {
    const plan = pack({ mode: "mixed", strategy: "practical", container: hq40, clearance: 10, products: [sampleProduct] });
    const bom = estimateDunnageBom(plan);
    expect(bom.desiccantPoles).toBe(14);
    expect(bom.airbagsRecommended).toBeGreaterThan(0);
    expect(bom.rearDoorClearanceOk).toBe(true);

    const rf = inspectReeferAirflow({ ...plan, container: { ...hq40, id: "40rh", name: "40RH 冷藏高柜", height: 2544 } });
    expect(rf.isReefer).toBe(true);
    expect(rf.redLineHeightMm).toBe(2414);
  });

  it("generates non-overlapping 3D hex cylinder coordinates and nested Z-slices", () => {
    const cyls = packHexCylinders({ ...hq40, id: "20gp", length: 5898 }, 400, 800, 20, 100, 10);
    expect(cyls.length).toBeGreaterThan(70);
    const layer1 = cyls.filter((c) => c.layer === 1);
    for (let i = 0; i < layer1.length; i++) {
      for (let j = i + 1; j < layer1.length; j++) {
        const dist = Math.hypot(layer1[i].cx - layer1[j].cx, layer1[i].cy - layer1[j].cy);
        expect(dist).toBeGreaterThanOrEqual(400 - 1e-4);
      }
    }
    const nested = buildNestedColumnBoxes(300, 60, 600, 10);
    expect(nested).toHaveLength(6);
    expect(nested[5].cumulativeHeightMm).toBe(600);
  });
});
