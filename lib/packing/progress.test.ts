import { describe, expect, it } from "vitest";
import { packingCapacityPrefixes, summarizePackingProgress } from "./progress";
import type { PackingResult, PlacedBox } from "./types";

function box(id: string, setNumber: number, setItemNumber: number): PlacedBox {
  return {
    id,
    productId: setItemNumber === 1 ? "a" : "b",
    sku: setItemNumber === 1 ? "A" : "B",
    name: "测试箱",
    color: "#2f7f89",
    x: 0,
    y: 0,
    z: 0,
    dx: 100,
    dy: 100,
    dz: 100,
    weight: 1,
    orientation: "L×W×H",
    layer: 1,
    setCode: "KIT",
    setNumber,
    setItemNumber,
  };
}

const result = {
  mode: "single",
  placements: [box("a-1", 1, 1), box("a-2", 2, 1), box("b-1", 1, 2), box("b-2", 2, 2)],
  setSummaries: [{ setCode: "KIT", loadedSets: 2, cartonsPerSet: 2 }],
} as PackingResult;

describe("packing progress", () => {
  it("accumulates actual shape volume and fixture-inclusive weight in loading order",()=>{
    const r={...result,summaries:[{productId:'a',loaded:2,loadedVolume:600000},{productId:'b',loaded:2,loadedVolume:200000}]} as PackingResult;
    const totals=packingCapacityPrefixes(r);
    expect(totals.volumes).toEqual([0,300000,600000,700000,800000]);
    expect(totals.weights).toEqual([0,1,2,3,4]);
  });
  it("uses completed sets as the primary count without losing carton-level loading order", () => {
    expect(summarizePackingProgress(result, 2)).toMatchObject({
      isSetMode: true,
      visibleCartons: 2,
      totalCartons: 4,
      completedSets: 0,
      totalSets: 2,
      currentSetNumber: 2,
      currentSetItemNumber: 1,
      currentSetCartons: 2,
    });
    expect(summarizePackingProgress(result, 3)).toMatchObject({
      completedSets: 1,
      currentSetNumber: 1,
      currentSetItemNumber: 2,
    });
    expect(summarizePackingProgress(result, 4)).toMatchObject({
      completedSets: 2,
      totalSets: 2,
      visibleCartons: 4,
      totalCartons: 4,
    });
  });
});
