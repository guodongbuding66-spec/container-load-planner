import { describe, expect, it } from "vitest";
import {
  buildPlanSnapshot,
  parseCrewAuditCsv,
  summarizeFieldCalibration,
  type FieldFeedbackRecord,
} from "./field-calibration";
import type { PackingResult } from "./types";

describe("v1.7.0 D23 Field Calibration & D18 Plan Snapshot", () => {
  it("parses /crew scan-audit.csv with quoted notes and discrepancies accurately", () => {
    const csv = [
      "RecordType,ContainerNo,SealNo,SKU,PlannedQty,ScannedQty,Variance,DiscrepancyType,Note,Timestamp",
      "SKU_SCAN,MSCU9988776,SL102030,BED-205,60,58,-2,,,",
      "SKU_SCAN,MSCU9988776,SL102030,SHED-101,40,40,0,,,",
      'DISCREPANCY,MSCU9988776,SL102030,BED-205,,,-2,damaged,"Corner crushed, left 2 out",2026-11-28T05:00:00Z',
    ].join("\n");
    const parsed = parseCrewAuditCsv(csv);
    expect(parsed.containerNo).toBe("MSCU9988776");
    expect(parsed.plannedCartons).toBe(100);
    expect(parsed.actualCartons).toBe(98);
    expect(parsed.discrepancyCount).toBe(1);
  });

  it("computes calibration guidance and recommends clearance compensation when actual fill lags", () => {
    const samples: FieldFeedbackRecord[] = [
      {
        id: "r1",
        recordedAt: "2026-11-28T05:00:00Z",
        containerName: "40HQ",
        containerNo: "MSCU111",
        plannedCartons: 100,
        actualCartons: 94,
        plannedWeightKg: 10000,
        actualWeighedKg: 10300,
        plannedTailVoidMm: 500,
        actualTailVoidMm: 350,
        discrepancyCount: 1,
        note: "Carton bulging",
      },
    ];
    const summary = summarizeFieldCalibration(samples);
    expect(summary.sampleCount).toBe(1);
    expect(summary.meanFillAchievementPct).toBe(94);
    expect(summary.meanWeightBiasPct).toBe(3);
    expect(summary.meanTailVoidDeltaMm).toBe(-150);
    expect(summary.recommendedClearanceDeltaMm).toBe(6);
    expect(summary.recommendedPracticalCapPct).toBeLessThan(95);
  });

  it("builds a complete local engineering snapshot from a PackingResult", () => {
    const plan = {
      id: "p1",
      createdAt: "2026-11-28T05:00:00Z",
      engineVersion: "1.7.0",
      strategy: "practical",
      container: {
        id: "40hq",
        name: "40HQ 高柜",
        length: 12032,
        width: 2350,
        height: 2700,
        doorWidth: 2340,
        doorHeight: 2585,
        maxWeight: 28600,
      },
      clearance: 0,
      placements: [
        {
          id: "b1",
          productId: "p1",
          sku: "SKU-1",
          name: "SKU-1",
          color: "#0f766e",
          x: 0,
          y: 100,
          z: 0,
          dx: 1200,
          dy: 2000,
          dz: 1200,
          weight: 500,
          layer: 1,
          step: 1,
          orientation: "LWH",
        },
      ],
      unloaded: [],
      metrics: {
        requestedCount: 1,
        loadedCount: 1,
        unloadedCount: 0,
        volumeUtilization: 0.0377,
        weightUtilization: 0.0175,
        totalVolumeM3: 2.88,
        containerVolumeM3: 76.3,
        centerOfGravity: { x: 600, y: 1100, z: 600 },
        frontBackBalance: 0.5,
        leftRightBalance: 0.5,
        layerCount: 1,
      },
      validation: { valid: true, errors: [], warnings: [] },
      steps: [],
    } as unknown as PackingResult;

    const snap = buildPlanSnapshot(plan, "Baseline 40HQ");
    expect(snap.label).toBe("Baseline 40HQ");
    expect(snap.loadedCount).toBe(1);
    expect(snap.payloadKg).toBe(500);
    expect(snap.airbagCount).toBeGreaterThanOrEqual(1);
  });
});
