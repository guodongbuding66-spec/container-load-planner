import { describe, expect, it } from "vitest";
import { calculateReverseCounts, combineStrategyResults, pack, packWithComparison, recommendedPracticalTarget, validatePacking } from "./engine";
import {
  CONTAINER_PRESETS,
  DIMENSION_TEST_PRODUCTS,
  MULTI_CARTON_SET_PRODUCTS,
  REAL_WORLD_A64M_LOADING,
  REAL_WORLD_A64M_PRODUCTS,
  TWO_CARTON_SET_PRODUCTS,
} from "./presets";
import type { ContainerSpec, PackingRequest, ProductInput } from "./types";

const container: ContainerSpec = {
  id: "test-20gp",
  name: "测试 20GP",
  length: 5900,
  width: 2352,
  height: 2395,
  doorWidth: 2340,
  doorHeight: 2292,
  maxWeight: 28000,
};

function product(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    id: "box-a",
    sku: "BOX-A",
    name: "测试外箱",
    length: 1000,
    width: 1000,
    height: 1000,
    weight: 100,
    quantity: 20,
    priority: 50,
    rotationPolicy: "any",
    stackable: true,
    maxStackLayers: 0,
    color: "#2f7f89",
    ...overrides,
  };
}

function request(overrides: Partial<PackingRequest> = {}): PackingRequest {
  return {
    mode: "mixed",
    container,
    clearance: 0,
    products: [product()],
    ...overrides,
  };
}

describe("packing engine", () => {
  it("calculates the deterministic rule-grid maximum for a single SKU", () => {
    const result = pack(request({ mode: "single" }));

    expect(result.metrics.loadedCount).toBe(20);
    expect(result.placements).toHaveLength(20);
    expect(result.validation.valid).toBe(true);
    expect(result.metrics.grossWeight).toBe(2000);
  });

  it("reorders the theoretical plan from the container nose toward the doors without violating support order", () => {
    const sequenceContainer: ContainerSpec = {
      id: "sequence-container",
      name: "顺序测试柜",
      length: 300,
      width: 100,
      height: 200,
      doorWidth: 100,
      doorHeight: 200,
      maxWeight: 1000,
    };
    const result = pack(request({
      mode: "single",
      strategy: "maximum",
      container: sequenceContainer,
      products: [product({
        id: "sequence-box",
        sku: "SEQUENCE-BOX",
        length: 100,
        width: 100,
        height: 100,
        weight: 1,
        rotationPolicy: "fixed",
      })],
    }));

    expect(result.placements.map((box) => [box.x, box.z])).toEqual([
      [0, 0],
      [0, 100],
      [100, 0],
      [100, 100],
      [200, 0],
      [200, 100],
    ]);
    expect(result.validation.valid).toBe(true);
    expect(result.warnings.join(" ")).toContain("柜内到箱门");
  });

  it("rejects a carton when no allowed orientation fits through the door", () => {
    const tall = product({
      id: "too-large",
      sku: "TOO-LARGE",
      length: 3000,
      width: 2500,
      height: 2400,
      rotationPolicy: "fixed",
    });
    const result = pack(request({ mode: "single", products: [tall] }));

    expect(result.metrics.loadedCount).toBe(0);
    expect(result.placements).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("门洞");
  });

  it("creates a mixed-SKU plan without overlap, overflow, or excess payload", () => {
    const products = [
      product({ id: "a", sku: "A", length: 1200, width: 600, height: 400, weight: 50, quantity: 18, priority: 100 }),
      product({ id: "b", sku: "B", length: 900, width: 550, height: 500, weight: 35, quantity: 20, priority: 80 }),
    ];
    const result = pack(request({ products }));

    expect(result.placements.length).toBeGreaterThan(0);
    expect(result.metrics.loadedCount).toBe(result.placements.length);
    expect(result.metrics.grossWeight).toBeLessThanOrEqual(container.maxWeight);
    expect(validatePacking(result.placements, container, 0, products).valid).toBe(true);
  });

  it("honors the payload limit", () => {
    const lightContainer = { ...container, maxWeight: 250 };
    const result = pack(
      request({
        container: lightContainer,
        products: [product({ weight: 100, quantity: 10 })],
      }),
    );

    expect(result.metrics.loadedCount).toBe(2);
    expect(result.metrics.grossWeight).toBe(200);
    expect(result.validation.valid).toBe(true);
  });

  it("keeps cartons upright when the rotation policy forbids tipping", () => {
    const lowContainer = { ...container, length: 1200, width: 1000, height: 500, doorWidth: 1000, doorHeight: 500 };
    const uprightOnly = product({
      length: 700,
      width: 400,
      height: 600,
      quantity: 1,
      rotationPolicy: "upright",
    });
    const anyDirection = { ...uprightOnly, rotationPolicy: "any" as const };

    expect(pack(request({ mode: "single", container: lowContainer, products: [uprightOnly] })).metrics.loadedCount).toBe(0);
    expect(pack(request({ mode: "single", container: lowContainer, products: [anyDirection] })).metrics.loadedCount).toBeGreaterThan(0);
  });

  it("honors the configured stack-layer limit", () => {
    const cubeContainer = { ...container, length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000 };
    const limited = product({ length: 500, width: 500, height: 200, rotationPolicy: "fixed", maxStackLayers: 2 });
    const result = pack(request({ mode: "single", container: cubeContainer, products: [limited] }));

    expect(result.metrics.loadedCount).toBe(8);
    expect(Math.max(...result.placements.map((box) => box.layer))).toBe(2);
  });

  it("keeps bottom-only cargo on the container floor", () => {
    const cubeContainer = { ...container, length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000 };
    const bottomOnly = product({
      length: 500,
      width: 500,
      height: 200,
      rotationPolicy: "fixed",
      bottomOnly: true,
    });
    const result = pack(request({ mode: "single", container: cubeContainer, products: [bottomOnly] }));

    expect(result.metrics.loadedCount).toBe(4);
    expect(result.placements.every((box) => box.z === 0)).toBe(true);
    expect(result.validation.valid).toBe(true);
  });

  it("loads mandatory cargo before higher-priority filler cargo", () => {
    const oneBoxContainer = { ...container, length: 500, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const mandatory = product({ id: "must", sku: "MUST", length: 500, width: 500, height: 500, quantity: 1, priority: 0, mustLoad: true });
    const filler = product({ id: "fill", sku: "FILL", length: 500, width: 500, height: 500, quantity: 1, priority: 100, mustLoad: false });
    const result = pack(request({ container: oneBoxContainer, products: [filler, mandatory] }));

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0].sku).toBe("MUST");
    expect(result.warnings.join(" ")).not.toContain("必装货物 MUST");
  });

  it("does not place cartons on top of a non-stackable product", () => {
    const narrowContainer = { ...container, length: 500, width: 500, height: 1500, doorWidth: 500, doorHeight: 1500 };
    const nonStackable = product({
      length: 500,
      width: 500,
      height: 500,
      quantity: 3,
      rotationPolicy: "fixed",
      stackable: false,
    });
    const result = pack(request({ container: narrowContainer, products: [nonStackable] }));

    expect(result.metrics.loadedCount).toBe(1);
    expect(result.validation.valid).toBe(true);
  });

  it("reports a normalized center of gravity for every populated plan", () => {
    const result = pack(request());
    const center = result.metrics.centerOfGravity;

    expect(center.longitudinalRatio).toBeGreaterThan(0);
    expect(center.longitudinalRatio).toBeLessThanOrEqual(1);
    expect(center.lateralRatio).toBeGreaterThan(0);
    expect(center.lateralRatio).toBeLessThanOrEqual(1);
  });

  it("reverse-calculates volume and payload counts for a single carton", () => {
    const simpleContainer = { ...container, length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000, maxWeight: 1000 };
    const estimate = calculateReverseCounts(
      request({
        mode: "single",
        container: simpleContainer,
        products: [product({ length: 500, width: 500, height: 500, weight: 100 })],
      }),
      0.75,
      0.8,
    );

    expect(estimate.volumeLimitedTotal).toBe(6);
    expect(estimate.weightLimitedTotal).toBe(8);
    expect(estimate.recommendedTotal).toBe(6);
    expect(estimate.limitingFactor).toBe("volume");
    expect(estimate.quantities[0].suggestedQuantity).toBe(6);
    expect(estimate).toMatchObject({ displayUnit: "carton", cartonsPerSet: 1, recommendedDisplay: 6 });
  });

  it("returns complete sets as the primary reverse-count unit for multi-carton products", () => {
    const simpleContainer = { ...container, id: "custom", length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000, maxWeight: 10_000 };
    const products = [
      product({ id: "set-display-a", sku: "SET-A", length: 500, width: 500, height: 500, weight: 10, setCode: "DISPLAY-SET", unitsPerSet: 1 }),
      product({ id: "set-display-b", sku: "SET-B", length: 500, width: 500, height: 500, weight: 10, setCode: "DISPLAY-SET", unitsPerSet: 1 }),
    ];
    const estimate = calculateReverseCounts(
      request({ mode: "single", container: simpleContainer, products }),
      1,
      1,
    );

    expect(estimate).toMatchObject({
      displayUnit: "set",
      cartonsPerSet: 2,
      volumeLimitedTotal: 8,
      volumeLimitedDisplay: 4,
      recommendedTotal: 8,
      recommendedDisplay: 4,
    });
    expect(estimate.quantities.map((item) => item.suggestedQuantity)).toEqual([4, 4]);
  });

  it("uses container-specific worker-practical utilization defaults", () => {
    expect(CONTAINER_PRESETS.map((item) => recommendedPracticalTarget(item))).toEqual([0.805, 0.845, 0.88]);
    expect(recommendedPracticalTarget({ id: "custom" })).toBe(0.845);
  });

  it("preserves the current mixed-SKU ratio when distributing a reverse plan", () => {
    const products = [
      product({ id: "ratio-a", sku: "A", quantity: 1, length: 100, width: 100, height: 100, weight: 1 }),
      product({ id: "ratio-b", sku: "B", quantity: 3, length: 100, width: 100, height: 100, weight: 1 }),
    ];
    const estimate = calculateReverseCounts(
      request({ container: { ...container, length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000, maxWeight: 10000 }, products }),
      0.01,
      1,
    );

    expect(estimate.recommendedTotal).toBe(10);
    expect(estimate.quantities.map((item) => item.suggestedQuantity)).toEqual([3, 7]);
    expect(estimate.quantities.reduce((sum, item) => sum + item.suggestedQuantity, 0)).toBe(10);
  });

  it("uses volume as the fallback when carton weight is not supplied", () => {
    const estimate = calculateReverseCounts(
      request({ mode: "single", products: [product({ weight: 0 })] }),
      0.8,
      0.8,
    );

    expect(estimate.weightLimitedTotal).toBeNull();
    expect(estimate.recommendedTotal).toBe(estimate.volumeLimitedTotal);
  });

  it("keeps a two-carton product set atomic when only one complete set fits", () => {
    const setContainer = { ...container, length: 1300, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const products = [
      product({ id: "set-a", sku: "SET-A", length: 600, width: 500, height: 500, quantity: 3, setCode: "KIT-01", unitsPerSet: 1, rotationPolicy: "fixed" }),
      product({ id: "set-b", sku: "SET-B", length: 600, width: 500, height: 500, quantity: 3, setCode: "KIT-01", unitsPerSet: 1, rotationPolicy: "fixed" }),
    ];
    const result = pack(request({ container: setContainer, products }));

    expect(result.summaries.map((summary) => summary.loaded)).toEqual([1, 1]);
    expect(result.setSummaries).toHaveLength(1);
    expect(result.setSummaries[0]).toMatchObject({ setCode: "KIT-01", requestedSets: 3, loadedSets: 1, unloadedSets: 2 });
    expect(result.validation.valid).toBe(true);
  });

  it("maximizes a multi-carton product without changing single-product mode", () => {
    const setContainer = { ...container, length: 1300, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const products = [
      product({ id: "single-set-a", sku: "SET-A", length: 600, width: 500, height: 500, quantity: 999, setCode: "ONE-PRODUCT", unitsPerSet: 1, rotationPolicy: "fixed" }),
      product({ id: "single-set-b", sku: "SET-B", length: 600, width: 500, height: 500, quantity: 1, setCode: "ONE-PRODUCT", unitsPerSet: 1, rotationPolicy: "fixed" }),
      product({ id: "unrelated", sku: "OTHER", length: 100, width: 100, height: 100, quantity: 999, setCode: "OTHER-PRODUCT", unitsPerSet: 1 }),
    ];
    const result = pack(request({ mode: "single", container: setContainer, products }));

    expect(result.mode).toBe("single");
    expect(result.summaries.map((summary) => summary.productId)).toEqual(["single-set-a", "single-set-b"]);
    expect(result.metrics.loadedCount).toBe(2);
    expect(result.metrics.requestedCount).toBe(2);
    expect(result.setSummaries[0]).toMatchObject({ setCode: "ONE-PRODUCT", loadedSets: 1, requestedSets: 1, unloadedSets: 0 });
    expect(result.placements.every((box) => box.setCode === "ONE-PRODUCT" && box.setNumber === 1)).toBe(true);
    expect(result.validation.valid).toBe(true);
  });

  it("supports multiple cartons of the same SKU per set", () => {
    const setContainer = { ...container, length: 1500, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const component = product({
      id: "pair",
      sku: "PAIR",
      length: 500,
      width: 500,
      height: 500,
      quantity: 3,
      setCode: "PAIR-SET",
      unitsPerSet: 2,
      rotationPolicy: "fixed",
    });
    const result = pack(request({ container: setContainer, products: [component] }));

    expect(result.metrics.loadedCount).toBe(2);
    expect(result.setSummaries[0].loadedSets).toBe(1);
    expect(result.validation.valid).toBe(true);
  });

  it.each([3, 4, 5])("keeps a %s-carton multi-SKU set atomic and assigns traceable set numbers", (cartonCount) => {
    const setContainer = {
      ...container,
      length: cartonCount * 500,
      width: 500,
      height: 500,
      doorWidth: 500,
      doorHeight: 500,
    };
    const products = Array.from({ length: cartonCount }, (_, index) => product({
      id: `kit-${cartonCount}-${index}`,
      sku: `KIT-${cartonCount}-${index + 1}`,
      length: 500,
      width: 500,
      height: 500,
      weight: 10,
      quantity: 2,
      setCode: `KIT-${cartonCount}BOX`,
      unitsPerSet: 1,
      rotationPolicy: "fixed",
    }));

    const result = pack(request({ container: setContainer, products }));

    expect(result.metrics.loadedCount).toBe(cartonCount);
    expect(result.summaries.map((summary) => summary.loaded)).toEqual(Array.from({ length: cartonCount }, () => 1));
    expect(result.setSummaries[0]).toMatchObject({
      componentCount: cartonCount,
      cartonsPerSet: cartonCount,
      requestedSets: 2,
      loadedSets: 1,
      unloadedSets: 1,
      loadedCartons: cartonCount,
    });
    expect(result.placements.every((box) => box.setCode === `KIT-${cartonCount}BOX` && box.setNumber === 1)).toBe(true);
    expect(result.placements.map((box) => box.setItemNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: cartonCount }, (_, index) => index + 1),
    );
    expect(result.validation.valid).toBe(true);
  });

  it("supports a five-carton set expressed as a 1:2:2 ratio", () => {
    const setContainer = { ...container, length: 2500, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const products = [
      product({ id: "ratio-a", sku: "RATIO-A", length: 500, width: 500, height: 500, weight: 10, quantity: 2, setCode: "RATIO-122", unitsPerSet: 1, rotationPolicy: "fixed" }),
      product({ id: "ratio-b", sku: "RATIO-B", length: 500, width: 500, height: 500, weight: 10, quantity: 4, setCode: "RATIO-122", unitsPerSet: 2, rotationPolicy: "fixed" }),
      product({ id: "ratio-c", sku: "RATIO-C", length: 500, width: 500, height: 500, weight: 10, quantity: 4, setCode: "RATIO-122", unitsPerSet: 2, rotationPolicy: "fixed" }),
    ];

    const result = pack(request({ container: setContainer, products }));

    expect(result.summaries.map((summary) => summary.loaded)).toEqual([1, 2, 2]);
    expect(result.setSummaries[0]).toMatchObject({ componentCount: 3, cartonsPerSet: 5, requestedSets: 2, loadedSets: 1 });
    expect(result.placements.map((box) => box.setItemNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5]);
    expect(result.validation.valid).toBe(true);
  });

  it("independently rejects an incomplete set trace sequence", () => {
    const setContainer = { ...container, length: 1500, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const products = Array.from({ length: 3 }, (_, index) => product({
      id: `trace-${index}`,
      sku: `TRACE-${index + 1}`,
      length: 500,
      width: 500,
      height: 500,
      weight: 10,
      quantity: 1,
      setCode: "TRACE-3BOX",
      unitsPerSet: 1,
      rotationPolicy: "fixed",
    }));
    const result = pack(request({ container: setContainer, products }));
    const corrupted = result.placements.map((box, index) => index === 1 ? { ...box, setItemNumber: undefined } : box);

    const validation = validatePacking(corrupted, setContainer, 0, products);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("套号或套内序号");
  });

  it("rejects complete set quantities when all trace metadata is stripped", () => {
    const setContainer = { ...container, length: 1000, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const products = [
      product({ id: "missing-a", sku: "MISSING-A", length: 500, width: 500, height: 500, weight: 10, quantity: 1, setCode: "MISSING-TRACE", unitsPerSet: 1, rotationPolicy: "fixed" }),
      product({ id: "missing-b", sku: "MISSING-B", length: 500, width: 500, height: 500, weight: 10, quantity: 1, setCode: "MISSING-TRACE", unitsPerSet: 1, rotationPolicy: "fixed" }),
    ];
    const result = pack(request({ container: setContainer, products }));
    const corrupted = result.placements.map((box) => ({ ...box, setCode: undefined, setNumber: undefined, setItemNumber: undefined }));

    const validation = validatePacking(corrupted, setContainer, 0, products);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("套装编码、套号或套内序号");
  });

  it("rejects cross-set component substitution even when total ratios still match", () => {
    const setContainer = { ...container, length: 2000, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const products = [
      product({ id: "composition-a", sku: "COMPOSITION-A", length: 500, width: 500, height: 500, weight: 10, quantity: 2, setCode: "COMPOSITION", unitsPerSet: 1, rotationPolicy: "fixed" }),
      product({ id: "composition-b", sku: "COMPOSITION-B", length: 500, width: 500, height: 500, weight: 10, quantity: 2, setCode: "COMPOSITION", unitsPerSet: 1, rotationPolicy: "fixed" }),
    ];
    const result = pack(request({ container: setContainer, products }));
    const corrupted = result.placements.map((box) => {
      if (box.setNumber === 1 && box.productId === "composition-b") return { ...box, productId: "composition-a", sku: "COMPOSITION-A" };
      if (box.setNumber === 2 && box.productId === "composition-a") return { ...box, productId: "composition-b", sku: "COMPOSITION-B" };
      return box;
    });

    const validation = validatePacking(corrupted, setContainer, 0, products);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("实际为");
  });

  it("rejects non-contiguous set numbers", () => {
    const setContainer = { ...container, length: 2000, width: 500, height: 500, doorWidth: 500, doorHeight: 500 };
    const products = [
      product({ id: "sequence-a", sku: "SEQUENCE-A", length: 500, width: 500, height: 500, weight: 10, quantity: 2, setCode: "SEQUENCE", unitsPerSet: 1, rotationPolicy: "fixed" }),
      product({ id: "sequence-b", sku: "SEQUENCE-B", length: 500, width: 500, height: 500, weight: 10, quantity: 2, setCode: "SEQUENCE", unitsPerSet: 1, rotationPolicy: "fixed" }),
    ];
    const result = pack(request({ container: setContainer, products }));
    const corrupted = result.placements.map((box) => box.setNumber === 2 ? { ...box, setNumber: 3 } : box);

    const validation = validatePacking(corrupted, setContainer, 0, products);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("套号不连续");
  });

  it("uses product master data when independently validating payload weight", () => {
    const limitedContainer = { ...container, length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000, maxWeight: 50 };
    const cargo = product({ id: "weight-master", sku: "WEIGHT-MASTER", weight: 100, quantity: 1 });
    const forged = [{
      id: "forged-weight",
      productId: cargo.id,
      sku: cargo.sku,
      name: cargo.name,
      color: cargo.color,
      x: 0,
      y: 0,
      z: 0,
      dx: 1000,
      dy: 1000,
      dz: 1000,
      weight: 0,
      orientation: "LWH",
      layer: 1,
    }];

    const validation = validatePacking(forged, limitedContainer, 0, [cargo]);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("重量与产品资料不一致");
    expect(validation.errors.join(" ")).toContain("最大载重");
  });

  it("rejects invalid requests instead of silently replacing bad dimensions", () => {
    expect(() => pack(request({ products: [product({ length: 0 })] }))).toThrow("外箱尺寸");
    expect(() => pack(request({ clearance: container.width }))).toThrow("安全间隙过大");
    expect(() => pack(request({ container: { ...container, doorWidth: container.width + 1 } }))).toThrow("柜门尺寸");
    expect(() => pack(request({ container: { ...container, doorHeight: container.height + 1 } }))).toThrow("柜门尺寸");
    expect(() => pack(request({ products: [product({ id: "duplicate" }), product({ id: "duplicate" })] }))).toThrow("产品 ID");
    expect(() => pack(request({ products: [product({ quantity: 1.5 })] }))).toThrow("非负整数");
    expect(() => pack(request({ strategy: "practical", practicalTargetUtilization: 0.99 }))).toThrow("50%–95%");
  });

  it("independently rejects invalid placement layers and misleading product labels", () => {
    const cargo = product({ id: "layer-master", sku: "LAYER-MASTER", quantity: 2, rotationPolicy: "fixed" });
    const valid = pack(request({ products: [cargo] })).placements[0];

    const invalidLayer = validatePacking([{ ...valid, layer: 0 }], container, 0, [cargo]);
    const fractionalLayer = validatePacking([{ ...valid, layer: 1.5 }], container, 0, [cargo]);
    const wrongSku = validatePacking([{ ...valid, sku: "WRONG-SKU" }], container, 0, [cargo]);

    expect(invalidLayer.valid).toBe(false);
    expect(fractionalLayer.valid).toBe(false);
    expect(invalidLayer.errors.join(" ")).toContain("层级");
    expect(fractionalLayer.errors.join(" ")).toContain("层级");
    expect(wrongSku.valid).toBe(false);
    expect(wrongSku.errors.join(" ")).toContain("SKU");
  });

  it("independently rejects a mixed plan that loads more cartons than ordered", () => {
    const cargo = product({ id: "demand-master", sku: "DEMAND-MASTER", quantity: 1, rotationPolicy: "fixed" });
    const first = pack(request({ products: [cargo] })).placements[0];
    const second = { ...first, id: "demand-master-extra", x: 1000 };

    const validation = validatePacking([first, second], container, 0, [cargo]);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("超过订单需求");
  });

  it("keeps decimal-height support levels stable across floating-point rounding", () => {
    const decimalContainer = {
      ...container,
      length: 1,
      width: 1,
      height: 1,
      doorWidth: 1,
      doorHeight: 1,
      maxWeight: 100,
    };
    const products = [
      product({ id: "decimal-a", sku: "DECIMAL-A", length: 1, width: 1, height: 0.1, weight: 1, quantity: 1, rotationPolicy: "fixed" }),
      product({ id: "decimal-b", sku: "DECIMAL-B", length: 1, width: 1, height: 0.2, weight: 1, quantity: 1, rotationPolicy: "fixed" }),
      product({ id: "decimal-c", sku: "DECIMAL-C", length: 1, width: 1, height: 0.1, weight: 1, quantity: 1, rotationPolicy: "fixed" }),
    ];
    const placements = products.map((item, index) => ({
      id: `decimal-${index}`,
      productId: item.id,
      sku: item.sku,
      name: item.name,
      color: item.color,
      x: 0,
      y: 0,
      z: [0, 0.1, 0.3][index],
      dx: 1,
      dy: 1,
      dz: item.height,
      weight: item.weight,
      orientation: "LWH",
      layer: index + 1,
    }));

    const validation = validatePacking(placements, decimalContainer, 0, products, "maximum", "mixed");

    expect(validation.valid).toBe(true);
  });

  it("allows a simple planar side strip but rejects tipped practical orientations and partial support", () => {
    const practicalProduct = product({
      id: "practical-box",
      sku: "PRACTICAL",
      length: 500,
      width: 250,
      height: 250,
      rotationPolicy: "upright",
    });
    const first = {
      id: "practical-1", productId: practicalProduct.id, sku: practicalProduct.sku, name: practicalProduct.name,
      color: practicalProduct.color, x: 0, y: 0, z: 0, dx: 500, dy: 250, dz: 250,
      weight: practicalProduct.weight, orientation: "LWH", layer: 1,
    };
    const rotated = {
      ...first,
      id: "practical-2",
      x: 500,
      dx: 250,
      dy: 500,
      orientation: "WLH",
    };
    const orientationValidation = validatePacking([first, rotated], { ...container, length: 1000, width: 1000, doorWidth: 1000 }, 0, [practicalProduct], "practical");
    expect(orientationValidation.valid).toBe(true);

    const tipped = {
      ...first,
      id: "practical-3",
      x: 750,
      dx: 250,
      dy: 250,
      dz: 500,
      orientation: "WHL",
    };
    const tippedValidation = validatePacking([first, rotated, tipped], { ...container, length: 1000, width: 1000, doorWidth: 1000 }, 0, [practicalProduct], "practical");
    expect(tippedValidation.valid).toBe(false);
    expect(tippedValidation.errors.join(" ")).toContain("不允许侧翻补缝");

    const square = product({ id: "support-box", sku: "SUPPORT", length: 500, width: 500, height: 500, rotationPolicy: "fixed" });
    const supportValidation = validatePacking([
      { ...first, id: "support-1", productId: square.id, sku: square.sku, dx: 500, dy: 500, dz: 500, weight: square.weight },
      { ...first, id: "support-2", productId: square.id, sku: square.sku, x: 250, z: 500, dx: 500, dy: 500, dz: 500, weight: square.weight, layer: 2 },
    ], { ...container, length: 1000, width: 1000, height: 1000, doorWidth: 1000, doorHeight: 1000 }, 0, [square], "practical");
    expect(supportValidation.valid).toBe(false);
    expect(supportValidation.errors.join(" ")).toContain("99.5%");
  });

  it("aligns reverse-calculated quantities to complete set ratios", () => {
    const products = [
      product({ id: "kit-a", sku: "KIT-A", quantity: 10, setCode: "KIT", unitsPerSet: 1 }),
      product({ id: "kit-b", sku: "KIT-B", quantity: 20, setCode: "KIT", unitsPerSet: 2 }),
    ];
    const estimate = calculateReverseCounts(request({ products }), 0.8, 0.8);

    expect(estimate.quantities[1].suggestedQuantity).toBe(estimate.quantities[0].suggestedQuantity * 2);
    expect(estimate.recommendedTotal).toBe(estimate.quantities.reduce((sum, item) => sum + item.suggestedQuantity, 0));
  });

  it("preserves the supplied test dimensions, rounded CBM, and gross weights", () => {
    const expected = [
      { dimensions: [1280, 540, 130], calculatedCbm: 0.089856, declaredCbm: 0.09, weight: 49 },
      { dimensions: [1280, 540, 110], calculatedCbm: 0.076032, declaredCbm: 0.08, weight: 40 },
      { dimensions: [1030, 620, 120], calculatedCbm: 0.076632, declaredCbm: 0.08, weight: 30 },
    ];

    DIMENSION_TEST_PRODUCTS.forEach((item, index) => {
      expect([item.length, item.width, item.height]).toEqual(expected[index].dimensions);
      expect((item.length * item.width * item.height) / 1_000_000_000).toBeCloseTo(expected[index].calculatedCbm, 6);
      expect(item.declaredVolumeCbm).toBe(expected[index].declaredCbm);
      expect(item.weight).toBe(expected[index].weight);
    });
    expect((TWO_CARTON_SET_PRODUCTS[1].length * TWO_CARTON_SET_PRODUCTS[1].width * TWO_CARTON_SET_PRODUCTS[1].height) / 1_000_000_000).toBeCloseTo(0.040392, 6);
    expect(TWO_CARTON_SET_PRODUCTS.every((item) => item.setCode === "SET-2BOX" && item.unitsPerSet === 1)).toBe(true);
    expect(MULTI_CARTON_SET_PRODUCTS).toHaveLength(5);
    expect(MULTI_CARTON_SET_PRODUCTS.every((item) => item.setCode === "SET-5BOX" && item.unitsPerSet === 1)).toBe(true);
  });

  it("produces validated 40HQ plans for both supplied test scenarios", () => {
    const common = { mode: "mixed" as const, container: { ...container, ...{ id: "40hq-test", length: 12032, width: 2350, height: 2700, doorWidth: 2340, doorHeight: 2597, maxWeight: 28600 } }, clearance: 10 };
    const dimensions = pack({ ...common, products: DIMENSION_TEST_PRODUCTS });
    const twoCartonSet = pack({ ...common, products: TWO_CARTON_SET_PRODUCTS });

    expect(dimensions.validation.valid).toBe(true);
    expect(dimensions.metrics.loadedCount).toBe(720);
    expect(dimensions.metrics.grossWeight).toBe(28560);
    expect(twoCartonSet.validation.valid).toBe(true);
    expect(twoCartonSet.setSummaries[0]).toMatchObject({ requestedSets: 400, loadedSets: 400, unloadedSets: 0 });
    expect(twoCartonSet.metrics.loadedCount).toBe(800);
  }, 15_000);

  it("calculates the supplied two-carton product as a single-product maximum", () => {
    const result = pack({
      mode: "single",
      container: { ...container, id: "40hq-single-set", length: 12032, width: 2350, height: 2700, doorWidth: 2340, doorHeight: 2597, maxWeight: 28600 },
      clearance: 10,
      products: TWO_CARTON_SET_PRODUCTS,
    });

    expect(result.mode).toBe("single");
    expect(result.validation.valid).toBe(true);
    expect(result.setSummaries).toHaveLength(1);
    expect(result.setSummaries[0].loadedSets).toBeGreaterThan(0);
    expect(result.setSummaries[0].requestedSets).toBe(result.setSummaries[0].loadedSets);
    expect(result.setSummaries[0].items.map((item) => item.loadedQuantity)).toEqual([
      result.setSummaries[0].loadedSets,
      result.setSummaries[0].loadedSets,
    ]);
    expect(result.metrics.grossWeight).toBeLessThanOrEqual(28600);
  }, 15_000);

  it("separates a utilization-capped field plan from the uncapped capacity ceiling", () => {
    const singleSetContainer: ContainerSpec = {
      ...container,
      id: "40hq-plan-vs-capacity",
      length: 12032,
      width: 2350,
      height: 2700,
      doorWidth: 2340,
      doorHeight: 2597,
      maxWeight: 28600,
    };
    const baseRequest: PackingRequest = {
      mode: "single",
      strategy: "practical",
      practicalTargetUtilization: 0.88,
      container: singleSetContainer,
      clearance: 10,
      products: TWO_CARTON_SET_PRODUCTS,
    };
    const reversePlan = calculateReverseCounts(baseRequest, 0.85, 0.9);
    const capacity = pack(baseRequest);
    const planned = packWithComparison({
      ...baseRequest,
      singleCartonLimit: reversePlan.recommendedTotal,
    });

    expect(reversePlan).toMatchObject({
      displayUnit: "set",
      recommendedDisplay: 476,
      recommendedTotal: 952,
      limitingFactor: "weight",
    });
    expect(capacity.setSummaries[0].loadedSets).toBe(529);
    expect(capacity.metrics.weightUtilization).toBeCloseTo(0.9988, 3);
    expect(planned.singleCartonLimit).toBe(952);
    expect(planned.setSummaries[0].loadedSets).toBe(476);
    expect(planned.metrics.loadedCount).toBe(952);
    expect(planned.metrics.weightUtilization).toBeLessThanOrEqual(0.9);
    expect(planned.strategyComparison).toMatchObject({
      practical: { displayQuantity: 476 },
      maximum: { displayQuantity: 529 },
      gainQuantity: 53,
      sameQuantity: false,
    });
    expect(planned.validation.valid).toBe(true);
    expect(planned.strategyPlans?.practical).toMatchObject({
      strategy: "practical",
      singleCartonLimit: 952,
      metrics: { loadedCount: 952 },
    });
    expect(planned.strategyPlans?.maximum).toMatchObject({
      strategy: "maximum",
      metrics: { loadedCount: 1058 },
    });
    expect(planned.strategyPlans?.maximum?.singleCartonLimit).toBeUndefined();
    expect(planned.strategyPlans?.practical?.metrics.solveTimeMs).toBeLessThan(1_000);
    expect(planned.strategyPlans?.practical?.id).not.toBe(planned.strategyPlans?.maximum?.id);
    expect(planned.strategyPlans?.practical?.setSummaries[0].loadedSets).toBe(476);
    expect(planned.strategyPlans?.maximum?.setSummaries[0].loadedSets).toBe(529);
    expect(planned.strategyPlans?.practical?.validation.valid).toBe(true);
    expect(planned.strategyPlans?.maximum?.validation.valid).toBe(true);
    expect(planned.strategyPlans?.practical?.warnings.join(" ")).toContain("已跳过不会增加数量");
    const recombinedMaximum = combineStrategyResults(
      planned.strategyPlans!.practical!,
      planned.strategyPlans!.maximum!,
      "maximum",
    );
    expect(recombinedMaximum.strategy).toBe("maximum");
    expect(recombinedMaximum.setSummaries[0].loadedSets).toBe(529);
    expect(recombinedMaximum.strategyPlans?.practical?.setSummaries[0].loadedSets).toBe(476);
    const maximumPlan = planned.strategyPlans!.maximum!;
    const firstThird = maximumPlan.placements.slice(0, Math.ceil(maximumPlan.placements.length * 0.32));
    const firstThirdLongitudinalEnd = Math.max(...firstThird.map((box) => box.x + box.dx));
    const fullLongitudinalEnd = Math.max(...maximumPlan.placements.map((box) => box.x + box.dx));
    expect(firstThirdLongitudinalEnd).toBeLessThan(fullLongitudinalEnd * 0.6);

    const fullTarget = calculateReverseCounts(baseRequest, 1, 1);
    const fullTargetPlan = packWithComparison({
      ...baseRequest,
      singleCartonLimit: fullTarget.recommendedTotal,
    });
    expect(fullTarget.recommendedDisplay).toBe(529);
    expect(fullTargetPlan.setSummaries[0].loadedSets).toBe(529);
    expect(fullTargetPlan.warnings.join(" ")).toContain("当前计划上限 529 个完整套");
    expect(fullTargetPlan.strategyComparison?.guidance).toContainEqual(expect.objectContaining({
      title: "现场方案已达到当前极限搜索结果",
      detail: expect.stringContaining("两套求解器分别运行"),
    }));
  }, 45_000);

  it("separates the confirmed A64M quotation quantity from the physical 3D plan", () => {
    const result = pack({
      mode: "single",
      strategy: "practical",
      practicalTargetUtilization: 0.845,
      container: CONTAINER_PRESETS.find((item) => item.id === "40hq")!,
      clearance: 10,
      products: REAL_WORLD_A64M_PRODUCTS,
    });

    expect(REAL_WORLD_A64M_LOADING["40hq"]).toEqual({ cartons: 792, sets: 396 });
    const setVolume = REAL_WORLD_A64M_PRODUCTS.reduce(
      (sum, item) => sum + item.length * item.width * item.height * (item.unitsPerSet ?? 1),
      0,
    );
    const physicalContainerVolume = result.metrics.effectiveVolume;
    expect((REAL_WORLD_A64M_LOADING["40hq"].sets * setVolume) / physicalContainerVolume).toBeGreaterThan(1.6);
    expect((198 * setVolume) / physicalContainerVolume).toBeCloseTo(0.844, 3);
    expect(result.strategy).toBe("practical");
    expect(result.validation.valid).toBe(true);
    expect(result.setSummaries[0].loadedSets).toBe(198);
    expect(result.metrics.loadedCount).toBe(396);
    expect(result.metrics.executionComplexity.maxOrientationsPerSku).toBe(1);
    expect(result.metrics.executionComplexity.partialSupportCount).toBe(0);
    expect(result.metrics.volumeUtilization).toBeLessThanOrEqual(0.85);
    expect(result.quoteEstimate).toMatchObject({
      source: "historical-exact",
      confidence: "verified",
      predictedSets: 396,
      physicalLoadedSets: 198,
      gapSets: 198,
      physicallyPossibleByBounds: false,
    });
    expect(result.quoteEstimate!.volumeBoundRatio).toBeGreaterThan(1.6);

    result.placements.forEach((upper, upperIndex) => {
      if (upper.z === 0) return;
      const directSupports = result.placements
        .map((lower, lowerIndex) => ({ lower, lowerIndex }))
        .filter(({ lower }) =>
          Math.abs(lower.z + lower.dz - upper.z) < 0.001 &&
          Math.min(upper.x + upper.dx, lower.x + lower.dx) > Math.max(upper.x, lower.x) &&
          Math.min(upper.y + upper.dy, lower.y + lower.dy) > Math.max(upper.y, lower.y),
        );
      expect(directSupports.length).toBeGreaterThan(0);
      expect(directSupports.every(({ lowerIndex }) => lowerIndex < upperIndex)).toBe(true);
    });
  }, 20_000);

  it("keeps large practical loading sequences responsive and independently valid", () => {
    const result = pack({
      mode: "single",
      strategy: "practical",
      practicalTargetUtilization: 0.845,
      container,
      clearance: 0,
      products: [product({
        id: "bulk-box",
        sku: "BULK-BOX",
        length: 100,
        width: 100,
        height: 100,
        weight: 10,
        rotationPolicy: "fixed",
      })],
    });

    expect(result.metrics.loadedCount).toBe(2800);
    expect(result.validation.valid).toBe(true);
    expect(result.metrics.executionComplexity.maxOrientationsPerSku).toBe(1);
    expect(result.metrics.executionComplexity.partialSupportCount).toBe(0);
  }, 20_000);

  it("keeps maximum utilization available as an explicit comparison strategy", () => {
    const common: Omit<PackingRequest, "strategy"> = {
      mode: "single" as const,
      container: CONTAINER_PRESETS.find((item) => item.id === "40hq")!,
      clearance: 10,
      products: REAL_WORLD_A64M_PRODUCTS,
    };
    const practical = pack({ ...common, strategy: "practical", practicalTargetUtilization: 0.845 });
    const maximum = pack({ ...common, strategy: "maximum" });

    expect(maximum.validation.valid).toBe(true);
    expect(maximum.metrics.loadedCount).toBeGreaterThanOrEqual(practical.metrics.loadedCount);
    expect(maximum.practicalTargetUtilization).toBe(0.88);
  }, 30_000);

  it("runs independent practical and theoretical solvers and reports a useful gap", () => {
    const common: Omit<PackingRequest, "strategy"> = {
      mode: "single",
      practicalTargetUtilization: 0.88,
      container: CONTAINER_PRESETS.find((item) => item.id === "40hq")!,
      clearance: 10,
      products: [product({
        id: "dense-fixed",
        sku: "DENSE-FIXED",
        length: 1000,
        width: 466,
        height: 269,
        weight: 20,
        rotationPolicy: "fixed",
      })],
    };
    const comparison = packWithComparison({ ...common, strategy: "practical" });
    const theoretical = packWithComparison({ ...common, strategy: "maximum" });

    expect(comparison.validation.valid).toBe(true);
    expect(theoretical.validation.valid).toBe(true);
    expect(comparison.strategyComparison).toBeDefined();
    expect(comparison.strategyComparison!.maximum.displayQuantity)
      .toBeGreaterThan(comparison.strategyComparison!.practical.displayQuantity);
    expect(comparison.metrics.loadedCount).toBe(comparison.strategyComparison!.practical.loadedCount);
    expect(theoretical.metrics.loadedCount).toBe(theoretical.strategyComparison!.maximum.loadedCount);
    expect(theoretical.metrics.loadedCount).toBeGreaterThan(comparison.metrics.loadedCount);
    expect(comparison.strategyComparison!.gainQuantity).toBeGreaterThan(0);
    expect(comparison.strategyComparison!.practicalUsesTheoreticalGuide).toBe(true);
    expect(comparison.strategyComparison!.guidance.some((item) => item.level === "review")).toBe(true);
  }, 30_000);

  it("never tips a carton in the practical solver even when arbitrary rotation is allowed", () => {
    const result = pack({
      mode: "single",
      strategy: "practical",
      practicalTargetUtilization: 0.88,
      container,
      clearance: 0,
      products: [product({
        id: "upright-field-box",
        sku: "UPRIGHT-FIELD-BOX",
        length: 1200,
        width: 500,
        height: 250,
        rotationPolicy: "any",
      })],
    });

    expect(result.validation.valid).toBe(true);
    expect(result.metrics.executionComplexity.tippedCartonCount).toBe(0);
    expect(result.placements.every((box) => box.dz === 250)).toBe(true);
  });
});
