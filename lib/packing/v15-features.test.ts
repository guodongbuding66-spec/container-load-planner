import { describe, expect, it } from "vitest";
import { estimateAxleLoad } from "./axle-load-estimator";
import {
  aggregatePlannedSkus,
  applyCrewScan,
  buildCrewAuditCsv,
  normalizeScanToken,
} from "./crew-scanner";
import type { CrewSlicePayload } from "./crew-payload";
import type { PackingResult } from "./types";

type Placement = PackingResult["placements"][number];

function makeResult(placements: Placement[], length = 12032, width = 2350, height = 2700): PackingResult {
  return {
    id: "v15-test",
    createdAt: "2026-11-28T00:00:00Z",
    engineVersion: "1.5.0",
    strategy: "practical",
    container: {
      id: "40hq",
      name: "40HQ",
      length,
      width,
      height,
      doorWidth: width,
      doorHeight: height,
      maxWeight: 28600,
    },
    clearance: 0,
    placements,
    unloaded: [],
    metrics: {
      requestedCount: placements.length,
      loadedCount: placements.length,
      unloadedCount: 0,
      volumeUtilization: 0.5,
      weightUtilization: 0.5,
      totalWeight: placements.reduce((s, p) => s + p.weight, 0),
      totalVolumeM3: 10,
      containerVolumeM3: 76,
      centerOfGravity: { x: 6000, y: 1175, z: 1000 },
      frontBackBalance: 0.5,
      leftRightBalance: 0.5,
      layerCount: 1,
    },
    validation: { valid: true, errors: [], warnings: [] },
    steps: [],
  } as unknown as PackingResult;
}

function mkBox(id: string, x: number, y: number, dx: number, dy: number, weight: number): Placement {
  return {
    id,
    productId: id,
    sku: id,
    name: id,
    color: "#0f766e",
    x,
    y,
    z: 0,
    dx,
    dy,
    dz: 1000,
    weight,
    layer: 1,
    step: 1,
    orientation: "LWH",
  } as unknown as Placement;
}

describe("v1.5.0 D13 Axle Load & Lateral Imbalance Estimator", () => {
  it("computes static lever distribution accurately and keeps balanced cargo in ok state", () => {
    const res = makeResult([
      mkBox("b1", 3000, 100, 2000, 2150, 8000),
      mkBox("b2", 6000, 100, 2000, 2150, 8000),
    ]);
    const est = estimateAxleLoad(res, "container-chassis");
    expect(est.cargoWeightKg).toBe(16000);
    expect(Math.round(est.frontCargoLoadKg + est.rearCargoLoadKg)).toBe(16000);
    expect(est.lateralOffsetPct).toBeLessThan(1);
    expect(est.status).toBe("ok");
  });

  it("flags front kingpin overload when heavy cargo is packed strictly at container nose", () => {
    const res = makeResult([mkBox("heavy-nose", 0, 175, 2000, 2000, 15000)]);
    const est = estimateAxleLoad(res, "container-chassis");
    expect(est.frontCargoLoadKg).toBeGreaterThan(11500);
    expect(est.status).toBe("overload");
    expect(est.warningsZh.length).toBeGreaterThan(0);
  });

  it("flags lateral imbalance warning when cargo is shifted to one side wall", () => {
    const res = makeResult([mkBox("left-wall", 5000, 0, 2000, 800, 6000)]);
    const est = estimateAxleLoad(res, "container-chassis");
    expect(est.lateralOffsetPct).toBeGreaterThan(12);
    expect(est.leftSideKg).toBe(6000);
    expect(est.rightSideKg).toBe(0);
    expect(est.status).toBe("warn");
  });
});

describe("v1.5.0 D17 Crew Offline Barcode Scanner & Discrepancy Audit", () => {
  const payload: CrewSlicePayload = {
    v: 1,
    c: "40HQ",
    L: 12032,
    W: 2350,
    H: 2700,
    tot: 5,
    wt: 120,
    vol: 4.5,
    slices: [
      { idx: 1, xFrom: 0, xTo: 1200, items: [{ sku: "BED-205", qty: 2, dx: 600, dy: 400, dz: 400, col: "#0f766e" }] },
      { idx: 2, xFrom: 1200, xTo: 2400, items: [{ sku: "BED-205", qty: 1, dx: 600, dy: 400, dz: 400, col: "#0f766e" }, { sku: "SHED-101", qty: 2, dx: 500, dy: 400, dz: 300, col: "#0369a1" }] },
    ],
  };

  it("aggregates planned SKUs and normalizes scanner prefixes", () => {
    const planned = aggregatePlannedSkus(payload);
    expect(planned).toEqual({ "BED-205": 3, "SHED-101": 2 });
    expect(normalizeScanToken("  SKU: bed-205 \r\n")).toBe("bed-205");
  });

  it("increments scanned counts, blocks over-scan, and rejects unknown SKUs", () => {
    const planned = aggregatePlannedSkus(payload);
    let counts: Record<string, number> = {};

    const s1 = applyCrewScan(counts, planned, "SKU:shed-101");
    expect(s1.ok).toBe(true);
    expect(s1.status).toBe("matched");
    expect(s1.scannedCount).toBe(1);
    counts = s1.nextCounts;

    const s2 = applyCrewScan(counts, planned, "SHED-101");
    expect(s2.ok).toBe(true);
    expect(s2.scannedCount).toBe(2);
    counts = s2.nextCounts;

    // 3rd scan exceeds planned=2 -> over-scan guard
    const s3 = applyCrewScan(counts, planned, "SHED-101");
    expect(s3.ok).toBe(false);
    expect(s3.status).toBe("over-scan");
    expect(s3.scannedCount).toBe(2);

    const bad = applyCrewScan(counts, planned, "UNKNOWN-999");
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe("unknown");
  });

  it("builds standard CSV with scan variances and discrepancy records", () => {
    const csv = buildCrewAuditCsv(
      payload,
      "MSCU1234567",
      "SL882910",
      { "BED-205": 2, "SHED-101": 2 },
      [
        {
          id: "d1",
          timestamp: "2026-11-28T04:00:00Z",
          sku: "BED-205",
          kind: "damaged",
          qtyDelta: -1,
          note: "Corner crushed during forklift transfer",
        },
      ],
    );
    expect(csv).toContain("SKU_SCAN,MSCU1234567,SL882910,BED-205,3,2,-1");
    expect(csv).toContain("DISCREPANCY,MSCU1234567,SL882910,BED-205,,,-1,damaged,Corner crushed during forklift transfer");
  });
});
