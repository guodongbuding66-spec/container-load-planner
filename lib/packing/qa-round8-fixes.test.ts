import { describe, expect, it } from "vitest";
import { projectDimensions } from "./scene-dimensions";
import { projectModelPreview } from "./model-preview";
import { transportSceneBounds } from "./transport-model";
import type { SceneSize } from "./camera-fit";

describe("QA Round 8 regression: ruler ticks never emit orphan 0 on short edges", () => {
  it("omits bogus 0 tick labels on 40HQ simplified fallback preview", () => {
    const target = {
      id: "40hq",
      name: "40HQ",
      length: 12032,
      width: 2350,
      height: 2700,
      doorWidth: 2340,
      doorHeight: 2597,
      maxWeight: 28600,
    };
    const viewport = { width: 520, height: 245 };
    const bounds = transportSceneBounds(target, 1, "model", 0);
    const orbit = { yaw: 0.72, pitch: 0.42 };
    const { project } = projectModelPreview(
      [],
      bounds,
      [Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch)],
      viewport.width,
      viewport.height,
      undefined,
      52,
    );
    const marks = projectDimensions(
      { min: [-target.length / 2, 0, -target.width / 2], max: [target.length / 2, target.height, target.width / 2] },
      { L: target.length, W: target.width, H: target.height },
      project,
      viewport,
      { unit: "mm", fontSize: 18, style: "ruler", bottomInset: 25, occupied: [{ x: 0, y: 0, width: viewport.width, height: 40 }] },
    );
    expect(marks.length).toBe(3);
    const allTickTexts = marks.flatMap((m) => m.ticks.map((t) => t.text));
    expect(allTickTexts).not.toContain("0");
  });

  it("omits bogus 0 tick labels on pallet 1200x2300x144 fallback preview", () => {
    const length = 1200, width = 2300, height = 144;
    const viewport = { width: 520, height: 245 };
    const bounds = { size: [length, height, width] as SceneSize, origin: [0, 0, 0] as SceneSize };
    const orbit = { yaw: 0.72, pitch: 0.42 };
    const { project } = projectModelPreview(
      [],
      bounds,
      [Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch)],
      viewport.width,
      viewport.height,
      undefined,
      52,
    );
    const marks = projectDimensions(
      { min: [-length / 2, 0, -width / 2], max: [length / 2, height, width / 2] },
      { L: length, W: width, H: height },
      project,
      viewport,
      { unit: "mm", fontSize: 18, style: "ruler", bottomInset: 25, occupied: [{ x: 0, y: 0, width: viewport.width, height: 40 }] },
    );
    const allTickTexts = marks.flatMap((m) => m.ticks.map((t) => t.text));
    expect(allTickTexts).not.toContain("0");
  });
});
