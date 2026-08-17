import { describe, expect, it } from "vitest";
import { alignSetQuantities, summarizeSetInputs } from "./set-utils";
import type { ProductInput } from "./types";

function component(id: string, quantity: number, unitsPerSet: number): ProductInput {
  return {
    id,
    sku: id.toUpperCase(),
    name: id,
    length: 500,
    width: 400,
    height: 300,
    weight: 10,
    quantity,
    priority: 50,
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 0,
    setCode: "KIT-122",
    unitsPerSet,
    color: "#2f7f89",
  };
}

describe("multi-carton set helpers", () => {
  it("summarizes arbitrary component counts and per-set ratios", () => {
    const summary = summarizeSetInputs([
      component("a", 10, 1),
      component("b", 20, 2),
      component("c", 20, 2),
    ])[0];

    expect(summary).toMatchObject({
      setCode: "KIT-122",
      componentCount: 3,
      cartonsPerSet: 5,
      completeSets: 10,
      maximumSetDemand: 10,
      looseCartons: 0,
      quantitiesAligned: true,
    });
  });

  it("detects loose cartons and aligns safely without increasing the order", () => {
    const products = [
      component("a", 10, 1),
      component("b", 19, 2),
      component("c", 22, 2),
    ];
    const before = summarizeSetInputs(products)[0];
    const aligned = alignSetQuantities(products, "KIT-122");
    const after = summarizeSetInputs(aligned)[0];

    expect(before).toMatchObject({ completeSets: 9, looseCartons: 6, quantitiesAligned: false });
    expect(aligned.map((item) => item.quantity)).toEqual([9, 18, 18]);
    expect(after).toMatchObject({ completeSets: 9, looseCartons: 0, quantitiesAligned: true });
    aligned.forEach((item, index) => expect(item.quantity).toBeLessThanOrEqual(products[index].quantity));
  });
});
