import { describe, expect, it } from "vitest";
import { auditMultiStopLifo, multiStopReportToCsv } from "./multi-stop-auditor";
import { analyzeSecuringVoids } from "./securing-void-analyzer";
import { packLoadingWorkflow } from "./pack-loading";
import type { PackingRequest, PackingResult } from "./types";
type Placement = PackingResult["placements"][number];

function makeMockResult(placements: Placement[], length = 5898, width = 2352, height = 2393): PackingResult {
  return {
    id: "test-v14",
    createdAt: "2026-11-28T00:00:00Z",
    engineVersion: "1.4.0",
    strategy: "practical",
    container: {
      id: "20gp",
      name: "20GP",
      length,
      width,
      height,
      doorWidth: width,
      doorHeight: height,
      maxWeight: 28000,
    },
    clearance: 0,
    placements,
    unloaded: [],
    metrics: {
      requestedCount: placements.length,
      loadedCount: placements.length,
      unloadedCount: 0,
      volumeUtilization: 0.5,
      weightUtilization: 0.2,
      totalWeight: placements.reduce((s, p) => s + p.weight, 0),
      totalVolumeM3: placements.reduce((s, p) => s + (p.dx * p.dy * p.dz) / 1e9, 0),
      containerVolumeM3: (length * width * height) / 1e9,
      centerOfGravity: { x: 2000, y: 1176, z: 500 },
      frontBackBalance: 0.5,
      leftRightBalance: 0.5,
      layerCount: 1,
    },
    validation: { valid: true, errors: [], warnings: [] },
    steps: [],
  } as unknown as PackingResult;
}

function box(id: string, sku: string, x: number, y: number, z: number, dx: number, dy: number, dz: number, weight = 100): Placement {
  return {
    id,
    productId: sku,
    sku,
    name: sku,
    color: "#0f766e",
    x,
    y,
    z,
    dx,
    dy,
    dz,
    weight,
    layer: 1,
    step: 1,
    orientation: "LWH",
  } as unknown as Placement;
}

describe("v1.4.0 D14 Multi-Stop LIFO Auditor", () => {
  it("passes cleanly when later stops sit deeper (nose) and earlier stops sit toward door (L+)", () => {
    const res = makeMockResult([
      box("b2", "SKU-STOP2", 0, 0, 0, 1000, 1000, 1000, 300),
      box("b1", "SKU-STOP1", 1000, 0, 0, 1000, 1000, 1000, 200),
    ]);
    const report = auditMultiStopLifo(res, { "SKU-STOP1": 1, "SKU-STOP2": 2 });
    expect(report.lifoCompliant).toBe(true);
    expect(report.conflictCount).toBe(0);
    expect(report.directUnloadablePct).toBe(100);
    expect(report.stops).toHaveLength(2);
    expect(report.stops[0].stop).toBe(1);
    expect(report.stops[0].loadOrderRank).toBe(2); // Stop 1 loaded second (after Stop 2)
    expect(report.stops[0].remainingWeightAfterUnloadKg).toBe(300);
    expect(report.stops[1].remainingCogXPct).toBeNull();
    expect(multiStopReportToCsv(report)).toContain("Stop 1,2,1");
  });

  it("detects door-path blocking when Stop 2 sits in front of Stop 1", () => {
    const res = makeMockResult([
      box("b1", "SKU-STOP1", 0, 0, 0, 1000, 1000, 1000, 200),
      box("b2", "SKU-STOP2", 1000, 0, 0, 1000, 1000, 1000, 300),
    ]);
    const report = auditMultiStopLifo(res, { "SKU-STOP1": 1, "SKU-STOP2": 2 });
    expect(report.lifoCompliant).toBe(false);
    expect(report.conflictCount).toBe(1);
    expect(report.conflicts[0].reason).toBe("door-path");
    expect(report.conflicts[0].blockedSku).toBe("SKU-STOP1");
    expect(report.conflicts[0].blockerSku).toBe("SKU-STOP2");
  });

  it("detects top-stack blocking when Stop 2 rests directly on top of Stop 1", () => {
    const res = makeMockResult([
      box("b1", "SKU-STOP1", 0, 0, 0, 1000, 1000, 1000, 200),
      box("b2", "SKU-STOP2", 0, 0, 1000, 1000, 1000, 1000, 150),
    ]);
    const report = auditMultiStopLifo(res, { "SKU-STOP1": 1, "SKU-STOP2": 2 });
    expect(report.lifoCompliant).toBe(false);
    expect(report.conflicts[0].reason).toBe("top-stack");
  });
});

describe("v1.4.0 D15 Securing Void Analyzer", () => {
  it("recommends dunnage airbags for 80-450mm lateral voids and tail-gate lashing for free tail space", () => {
    // Container width 2352mm, cargo width 2100mm -> 252mm lateral void (airbag range), length 2400mm -> 3498mm tail void
    const res = makeMockResult([
      box("b1", "SKU-A", 0, 0, 0, 1200, 2100, 1700, 500),
      box("b2", "SKU-B", 1200, 0, 0, 1200, 2100, 1700, 500),
    ]);
    const analysis = analyzeSecuringVoids(res);
    expect(analysis.maxLateralGapMm).toBe(252);
    expect(analysis.tailVoidLengthMm).toBe(5898 - 2400);
    expect(analysis.airbagCount).toBeGreaterThanOrEqual(2);
    expect(analysis.tailSecuringCount).toBeGreaterThanOrEqual(1);
    expect(analysis.recommendations.some((r) => r.kind === "airbag")).toBe(true);
    expect(analysis.recommendations.some((r) => r.zone === "tail-gate")).toBe(true);
  });

  it("recommends timber blocking when lateral void exceeds 450mm airbag cap", () => {
    const res = makeMockResult([
      box("b1", "SKU-NARROW", 0, 0, 0, 1200, 1500, 1000, 300),
    ]);
    const analysis = analyzeSecuringVoids(res);
    expect(analysis.maxLateralGapMm).toBe(852);
    expect(analysis.timberBlockingCount).toBeGreaterThanOrEqual(1);
    expect(analysis.recommendations.some((r) => r.kind === "timber-blocking" && r.severity === "critical")).toBe(true);
  });

  it("integrates cleanly with live packLoadingWorkflow output", () => {
    const req: PackingRequest = {
      container: {
        id: "20gp",
        name: "20GP",
        length: 5898,
        width: 2352,
        height: 2393,
        doorWidth: 2340,
        doorHeight: 2280,
        maxWeight: 28000,
      },
      clearance: 0,
      strategy: "practical",
      mode: "mixed", workflow: "direct",
      products: [
        {
          id: "p1",
          sku: "MOTOR-A",
          name: "Motor A",
          length: 800,
          width: 600,
          height: 500,
          weight: 45,
          quantity: 12,
          color: "#0f766e",
          priority: 50,
          maxStackLayers: 5,
          rotationPolicy: "any",
          stackable: true,
        },
        {
          id: "p2",
          sku: "PUMP-B",
          name: "Pump B",
          length: 600,
          width: 500,
          height: 400,
          weight: 30,
          quantity: 15,
          color: "#0369a1",
          priority: 50,
          maxStackLayers: 5,
          rotationPolicy: "any",
          stackable: true,
        },
      ],
    };
    const packed = packLoadingWorkflow(req);
    const lifo = auditMultiStopLifo(packed, { p1: 2, p2: 1 });
    const securing = analyzeSecuringVoids(packed);
    expect(lifo.totalBoxes).toBe(packed.metrics.loadedCount);
    expect(lifo.totalStops).toBe(2);
    expect(securing.containerLengthMm).toBe(5898);
    expect(securing.maxLoadedXMm).toBeGreaterThan(0);
  });
});
