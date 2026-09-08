import { describe, expect, it } from "vitest";
import { parseWorkspaceBackup, serializeWorkspaceBackup, type WorkspaceInputs } from "./workspace-file";

const inputs: WorkspaceInputs = {
  mode: "mixed", strategy: "maximum", practicalTargetPercent: 84.5,
  container: { id: "40HQ", name: "40 高柜", length: 12032, width: 2350, height: 2700, doorWidth: 2340, doorHeight: 2597, maxWeight: 28600 },
  clearance: 10, products: [{ id: "a", sku: "A", name: "主箱", length: 1270, width: 550, height: 290,
    weight: 31, quantity: 230, priority: 100, rotationPolicy: "upright", stackable: true, maxStackLayers: 0,
    mustLoad: true, bottomOnly: false, setCode: "KIT", unitsPerSet: 2, color: "#abcdef" }],
  customContainers: [], targetVolumePercent: 90, targetWeightPercent: 90, lengthUnit: "cm", weightUnit: "lb",
};

describe("portable workspace backups", () => {
  it("preserves canonical measurements, units, set ratios and unlimited stacking", () => {
    expect(parseWorkspaceBackup(serializeWorkspaceBackup(inputs, "test"))).toEqual(inputs);
  });
  it("discards derived results and untrusted metadata", () => {
    const file = JSON.parse(serializeWorkspaceBackup(inputs, "old"));
    file.inputs.placements = [{ x: 999999 }];
    file.inputs.products[0].declaredVolumeCbm = 999;
    const restored = parseWorkspaceBackup(JSON.stringify(file));
    expect(restored).toEqual(inputs);
    expect(restored).not.toHaveProperty("placements");
  });
  it("rejects result exports and unknown versions", () => {
    expect(() => parseWorkspaceBackup('{"placements":[]}')).toThrow();
    const file = JSON.parse(serializeWorkspaceBackup(inputs, "test"));
    file.version = 2;
    expect(() => parseWorkspaceBackup(JSON.stringify(file))).toThrow();
  });
  it.each(["toString", "__proto__", "constructor", "feet"])("rejects unsupported unit %s", (unit) => {
    const file = JSON.parse(serializeWorkspaceBackup(inputs, "test"));
    file.inputs.lengthUnit = unit;
    expect(() => parseWorkspaceBackup(JSON.stringify(file))).toThrow();
    file.inputs.lengthUnit = "mm";
    file.inputs.weightUnit = unit;
    expect(() => parseWorkspaceBackup(JSON.stringify(file))).toThrow();
  });
  it.each([-1, 1.5, null, "20", 1000001])("rejects invalid carton counts %s", (quantity) => {
    const file = JSON.parse(serializeWorkspaceBackup(inputs, "test"));
    file.inputs.products[0].quantity = quantity;
    expect(() => parseWorkspaceBackup(JSON.stringify(file))).toThrow();
  });
  it("allows incomplete zero dimensions for drafts while preserving validation on recalculation", () => {
    const file = JSON.parse(serializeWorkspaceBackup(inputs, "test"));
    file.inputs.products[0].length = 0;
    expect(parseWorkspaceBackup(JSON.stringify(file)).products[0].length).toBe(0);
  });
  it("rejects non-finite dimensions and malformed structure", () => {
    const serialized = serializeWorkspaceBackup(inputs, "test");
    expect(() => parseWorkspaceBackup(serialized.replace('"length": 1270', '"length": 1e999'))).toThrow();
    const file = JSON.parse(serialized);
    file.inputs.products = {};
    expect(() => parseWorkspaceBackup(JSON.stringify(file))).toThrow();
  });
});
