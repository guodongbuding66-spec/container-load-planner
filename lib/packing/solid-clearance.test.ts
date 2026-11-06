import { expect, it } from "vitest";
import { createMeasurementReport, measurementReportHtml } from "./measurement-report";
import { EMPTY_SECTION, measureBoxGap } from "./inspection";
import { captureMeasurement, parseMeasurements, savedMeasureValue, serializeMeasurements } from "./saved-measurements";
import { measureRegularSurfaceGap, parseRegularSurfaceSpec } from "./surface-inspection";
import { pack } from "./engine";
import type { PlacedBox } from "./types";

const cuboid = parseRegularSurfaceSpec({ profile: { cargoShape: "box" }, orientation: "LWH" });
const uShape = parseRegularSurfaceSpec({ profile: { cargoShape: "u-profile", shapeWallRatio: .25, shapeWallHeightRatio: .25 }, orientation: "LWH" });
const outer = { x: 0, y: 0, z: 0, dx: 100, dy: 100, dz: 100 };
const inner = { x: 45, y: 30, z: 40, dx: 10, dy: 10, dz: 10 };

it("measures the real recess when the outer boxes overlap", () => {
  expect(measureBoxGap(outer, inner).distance).toBe(0);
  expect(measureRegularSurfaceGap(outer, uShape, inner, cuboid).distance).toBeCloseTo(15);
  expect(measureRegularSurfaceGap(inner, cuboid, outer, uShape).distance).toBeCloseTo(15);
  expect(measureRegularSurfaceGap(outer, uShape, { ...inner, z: 20 }, cuboid).distance).toBe(0);
});

it("archives solid witnesses separately from v2, recomputes distances, and exports selectable escaped text", () => {
  const plan = pack({ container: { id: "qa", name: "QA", length: 300, width: 300, height: 300, doorWidth: 300, doorHeight: 300, maxWeight: 100 },
    products: [{ id: "b", sku: "B", name: "Box", length: 100, width: 100, height: 100, weight: 2, quantity: 2,
      priority: 50, rotationPolicy: "fixed", stackable: false, maxStackLayers: 1, color: "#338877" }],
    mode: "mixed", clearance: 0, strategy: "maximum" });
  const boxes: PlacedBox[] = [{ ...plan.placements[0], ...outer }, { ...plan.placements[1], ...inner }];
  const item = captureMeasurement(plan, "gap", boxes, [], [], "x-", EMPTY_SECTION, "<QA>", "qa-solid", "2026-11-06T00:00:00.000Z", undefined, [uShape, cuboid]);
  const raw = serializeMeasurements([item]);
  expect(JSON.parse(raw).version).toBe(3);
  expect(() => parseMeasurements(raw.replace('"version": 3', '"version": 2'))).toThrow();
  expect(savedMeasureValue(parseMeasurements(raw)[0]).distance).toBeCloseTo(15);
  const html = measurementReportHtml(createMeasurementReport(plan, [item], { language: "en", unit: "mm", precision: 2 }));
  expect(html).toContain("15.00 mm");
  expect(html).toContain("&lt;QA&gt;");
  expect(html).toContain("Minimum regular-solid clearance");
});
