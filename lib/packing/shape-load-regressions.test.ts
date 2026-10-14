import { describe, expect, it } from "vitest";
import { explainUnloaded, inspectCargoFit, pack } from "./engine";
import { CARGO_SHAPES, ADVANCED_SHAPES } from "./cargo-shape";
import { buildSolidModel, defaultSolidModel, parseSolidModel, type ModelKind } from "./solid-model";
import { addModelFixture } from "./solid-templates";
import { boxCell } from "./solid-math";
import type { CargoShape, ProductInput } from "./types";
import { toMillimeters } from "./units";
import { translateDiagnostic } from "./translate-ui";

const container = { id: "shape-load", name: "Shape load", length: 1200, width: 1100, height: 1000, doorWidth: 1100, doorHeight: 1000, maxWeight: 1000 };
function cargo(shape: CargoShape): ProductInput {
  let solidModel = ADVANCED_SHAPES.includes(shape) ? defaultSolidModel(shape === "compound" || shape === "mesh" ? "box" : shape as ModelKind, [400, 300, 200]) : undefined;
  if (shape === "mesh" && solidModel) {
    const proxy = boxCell(0, 0, 0, 400, 300, 200);
    solidModel.parts[0] = { ...solidModel.parts[0], kind: "mesh", mesh: { vertices: proxy.vertices, triangles: proxy.faces.flatMap(f => f.slice(1, -1).map((_, i) => [f[0], f[i + 1], f[i + 2]])), proxy, closed: true, filename: "closed-box.gltf" } };
  }
  if (solidModel && ["bend", "ellipsoid", "capsule"].includes(shape)) solidModel = { ...addModelFixture(solidModel, 20, 1), antiRoll: true };
  if (solidModel) solidModel = parseSolidModel(solidModel)!;
  const [length, width, height] = solidModel ? buildSolidModel(solidModel).size : [400, 300, 200];
  return { id: shape, sku: shape, name: shape, cargoShape: shape, solidModel, length, width, height, weight: 10, quantity: 2, priority: 50, rotationPolicy: "fixed", allowedOrientations: ["LWH"], stackable: false, maxStackLayers: 0, color: "#338899" };
}

describe.each(["practical", "maximum"] as const)("shape loading in %s", strategy => {
  describe.each(["mixed", "single"] as const)("%s mode", mode => {
    for (const shape of CARGO_SHAPES) it(`loads fitting ${shape}`, () => {
      const product = cargo(shape);
      const result = pack({ mode, strategy, container, clearance: 0, products: [product], singleCartonLimit: 2 });
      expect(result.validation.errors, `${shape}/${mode}`).toEqual([]);
      expect(result.metrics.loadedCount, `${shape}/${mode}`).toBeGreaterThan(0);
    }, shape === "bend" ? 15000 : 5000);
  });
});

describe("zero-load causes", () => {
  it("does not repeat an identical failed placement for a large curved-cargo order", () => {
    const p = { ...cargo("ellipsoid"), quantity: 20000 };
    const result = pack({ mode: "mixed", strategy: "practical", clearance: 0, container: { ...container, length: p.length, width: p.width, height: p.height, doorWidth: p.width, doorHeight: p.height }, products: [p] });
    expect(result.validation.valid).toBe(true);expect(result.metrics.loadedCount).toBe(1);expect(result.summaries[0].unloaded).toBe(19999);
  });
  it.each(["practical", "maximum"] as const)("diagnoses the screenshot's 500 cm tube even when single mode has no unmet demand (%s)", strategy => {
    const model = defaultSolidModel("tube", [5000, 5000, 2000]);
    model.parts[0].dimensions.innerDiameter = toMillimeters(250, "cm");
    const p = { ...cargo("tube"), solidModel: parseSolidModel(model)!, length: 5000, width: 5000, height: 2000 };
    const hq = { ...container, length: 12032, width: 2350, height: 2700, doorWidth: 2340, doorHeight: 2597 };
    const result = pack({ mode: "single", strategy, container: hq, clearance: 10, products: [p], singleCartonLimit: 2 });
    expect(result.metrics.loadedCount).toBe(0);
    expect(result.summaries[0].unloaded).toBe(0);
    const issues = explainUnloaded(result, [p]);
    expect(issues).toHaveLength(1);
    expect(issues[0].reasons.some(r => r.includes("尺寸单位"))).toBe(true);
    for (const reason of issues[0].reasons) expect(translateDiagnostic(reason, "en")).not.toMatch(/[\u3400-\u9fff]/);
    const small = cargo("tube");
    expect(inspectCargoFit(small, hq, 10, strategy).reasons).toEqual([]);
    expect(pack({ mode: "single", strategy, container: hq, clearance: 10, products: [small], singleCartonLimit: 2 }).metrics.loadedCount).toBe(2);
  });
  it("reports curved support requirements and accepts a real restrained base", () => {
    const m = defaultSolidModel("ellipsoid", [400, 300, 200]);
    const p = { ...cargo("box"), cargoShape: "ellipsoid" as const, solidModel: parseSolidModel(m)! };
    expect(inspectCargoFit(p, container).reasons.join()).toContain("支架");
    const supported = cargo("ellipsoid");
    expect(inspectCargoFit(supported, container).reasons).toEqual([]);
    const unsupported = { ...supported, solidModel: { ...supported.solidModel!, antiRoll: false } };
    expect(inspectCargoFit(unsupported, container).reasons.join()).toContain("防滚");
  });
});
