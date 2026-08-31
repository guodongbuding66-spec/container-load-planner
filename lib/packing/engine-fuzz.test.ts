import { describe, expect, it } from "vitest";
import { pack, packWithComparison, recommendedPracticalTarget, validatePacking } from "./engine";
import { CONTAINER_PRESETS } from "./presets";
import type { PackingStrategy, ProductInput, RotationPolicy } from "./types";

function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function between(random: () => number, minimum: number, maximum: number) {
  return Math.floor(minimum + random() * (maximum - minimum + 1));
}

function randomProduct(random: () => number, caseIndex: number, productIndex: number): ProductInput {
  const policies: RotationPolicy[] = ["fixed", "upright", "any"];
  return {
    id: `fuzz-${caseIndex}-${productIndex}`,
    sku: `FUZZ-${caseIndex}-${productIndex}`,
    name: "确定性随机回归箱",
    length: between(random, 180, 1900),
    width: between(random, 120, 900),
    height: between(random, 80, 850),
    weight: between(random, 1, 120),
    quantity: between(random, 1, 24),
    priority: between(random, 0, 100),
    rotationPolicy: policies[between(random, 0, policies.length - 1)],
    stackable: random() > 0.15,
    maxStackLayers: random() > 0.65 ? between(random, 1, 8) : 0,
    mustLoad: random() > 0.3,
    bottomOnly: random() < 0.1,
    setCode: "",
    unitsPerSet: 1,
    color: productIndex % 2 ? "#c66a3d" : "#2f7f89",
  };
}

describe("deterministic packing stress regression", () => {
  it("keeps randomized mixed orders valid across both strategies and all standard containers", () => {
    const random = randomGenerator(0x5eedcafe);
    for (let caseIndex = 0; caseIndex < 24; caseIndex += 1) {
      const container = CONTAINER_PRESETS[caseIndex % CONTAINER_PRESETS.length];
      const strategy: PackingStrategy = caseIndex % 2 ? "practical" : "maximum";
      const products = Array.from(
        { length: between(random, 1, 4) },
        (_, productIndex) => randomProduct(random, caseIndex, productIndex),
      );
      const result = pack({
        mode: "mixed",
        strategy,
        practicalTargetUtilization: recommendedPracticalTarget(container),
        container,
        clearance: between(random, 0, 30),
        products,
      });

      expect(result.validation.valid, `case ${caseIndex}`).toBe(true);
      expect(result.metrics.loadedCount).toBe(result.placements.length);
      expect(result.metrics.grossWeight).toBeLessThanOrEqual(container.maxWeight);
      expect(validatePacking(result.placements, container, result.clearance, products, strategy).valid).toBe(true);
    }
  }, 20_000);

  it("never splits randomized 2–5 carton single-product sets", () => {
    const random = randomGenerator(0x51a7b0a);
    for (let caseIndex = 0; caseIndex < 12; caseIndex += 1) {
      const container = CONTAINER_PRESETS[caseIndex % CONTAINER_PRESETS.length];
      const componentCount = between(random, 2, 5);
      const products = Array.from({ length: componentCount }, (_, productIndex) => ({
        ...randomProduct(random, caseIndex + 100, productIndex),
        quantity: 1000,
        rotationPolicy: "upright" as const,
        stackable: true,
        bottomOnly: false,
        setCode: `FUZZ-SET-${caseIndex}`,
        unitsPerSet: between(random, 1, 2),
      }));
      const cartonsPerSet = products.reduce((sum, product) => sum + product.unitsPerSet, 0);
      const result = pack({
        mode: "single",
        strategy: "practical",
        practicalTargetUtilization: recommendedPracticalTarget(container),
        container,
        clearance: 10,
        products,
      });

      expect(result.validation.valid, `set case ${caseIndex}`).toBe(true);
      expect(result.metrics.loadedCount % cartonsPerSet).toBe(0);
      expect(result.setSummaries[0].loadedCartons).toBe(result.setSummaries[0].loadedSets * cartonsPerSet);
      expect(result.placements.every((box) => box.setCode === `FUZZ-SET-${caseIndex}`)).toBe(true);
    }
  }, 30_000);

  it("keeps both independently solved plans valid and never reports theory below field", () => {
    const random = randomGenerator(0xd0ab1e);
    for (let caseIndex = 0; caseIndex < 8; caseIndex += 1) {
      const container = CONTAINER_PRESETS[caseIndex % CONTAINER_PRESETS.length];
      const products = Array.from(
        { length: between(random, 1, 3) },
        (_, productIndex) => randomProduct(random, caseIndex + 200, productIndex),
      );
      const common = {
        mode: "mixed" as const,
        practicalTargetUtilization: recommendedPracticalTarget(container),
        container,
        clearance: between(random, 0, 25),
        products,
      };
      const practical = packWithComparison({ ...common, strategy: "practical" });
      const maximum = packWithComparison({ ...common, strategy: "maximum" });
      const comparison = practical.strategyComparison!;

      expect(practical.validation.valid, `practical case ${caseIndex}`).toBe(true);
      expect(maximum.validation.valid, `maximum case ${caseIndex}`).toBe(true);
      expect(comparison.maximum.displayQuantity).toBeGreaterThanOrEqual(comparison.practical.displayQuantity);
      expect(practical.metrics.loadedCount).toBe(comparison.practical.loadedCount);
      expect(maximum.metrics.loadedCount).toBe(maximum.strategyComparison!.maximum.loadedCount);
      expect(comparison.practical.executionComplexity.tippedCartonCount).toBe(0);
    }
  }, 30_000);
});
