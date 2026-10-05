import { describe, expect, it } from "vitest";
import { calculateCameraFit, calculateCameraViewFit, type CameraPresetView, type SceneSize } from "./camera-fit";

describe("3D camera fitting", () => {
  const sizes: SceneSize[] = [
    [5.6, 1.26, 1.09],
    [5.6, 2.3, 2.3],
    [3, 3, 3],
  ];
  const viewports = [
    { width: 1300, height: 500 },
    { width: 900, height: 600 },
    { width: 390, height: 500 },
  ];

  it.each(sizes.flatMap((size) => viewports.map((viewport) => ({ size, viewport }))))(
    "keeps the whole container visible without shrinking it excessively: $size at $viewport",
    ({ size, viewport }) => {
      const fit = calculateCameraFit(size, viewport);

      expect(fit.maximumProjectedFill).toBeLessThanOrEqual(1);
      expect(fit.maximumProjectedFill).toBeGreaterThan(0.58);
      expect(fit.target[1]).toBeCloseTo(size[1] / 2);
      expect(fit.position[2]).toBeGreaterThan(0);
      expect(fit.minDistance).toBeLessThan(fit.distance);
      expect(fit.maxDistance).toBeGreaterThan(fit.distance);
    },
  );

  it.each(["perspective", "top", "side", "door", "bottom", "rear", "left"] satisfies CameraPresetView[])(
    "fits the full container when switching to the %s preset",
    (view) => {
      const fit = calculateCameraViewFit([5.6, 1.26, 1.09], { width: 920, height: 420 }, view);

      expect(fit.maximumProjectedFill).toBeLessThanOrEqual(1);
      expect(fit.maximumProjectedFill).toBeGreaterThan(0.58);
      expect(fit.position).not.toEqual(fit.target);
      expect(fit.up).toHaveLength(3);
      expect(fit.orthographicHalfWidth).toBeGreaterThan(0);
      expect(fit.orthographicHalfHeight).toBeGreaterThan(0);
    },
  );

  it("uses a non-singular camera up direction for the top view", () => {
    const fit = calculateCameraViewFit([5.6, 1.26, 1.09], { width: 920, height: 420 }, "top");

    expect(fit.position[1]).toBeGreaterThan(fit.target[1]);
    expect(fit.up).toEqual([0, 0, -1]);
  });

  it.each(viewports)("fits a true orthographic frustum at $width × $height", (viewport) => {
    const size: SceneSize = [5.6, 1.26, 1.09];
    const fit = calculateCameraViewFit(size, viewport, "side");
    const aspect = viewport.width / viewport.height;

    expect(fit.orthographicHalfWidth / fit.orthographicHalfHeight).toBeCloseTo(aspect, 6);
    expect(fit.orthographicHalfWidth * 2).toBeGreaterThanOrEqual(size[0]);
    expect(fit.orthographicHalfHeight * 2).toBeGreaterThanOrEqual(size[1]);
  });
});

