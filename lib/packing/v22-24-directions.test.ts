import { describe, expect, it } from "vitest";
import {
  generate3dsMaxCargoFitBridgeScript,
  parseIgesCadEnvelope,
  parseStepCadEnvelope,
} from "./cad-step-iges-bridge";
import {
  createGovernedPlanRecord,
  diffGovernedPlans,
  transitionApprovalStatus,
} from "./enterprise-governance";
import { solveFlexibleCompressionPacking } from "./irregular-nesting-engine";
import { evaluateReversePackagingMatrix } from "./reverse-packaging-optimizer";
import { designEconomicalPallet } from "./smart-pallet-designer";
import { CargoFitClient, computeWebhookDigest, verifyWebhookDigest } from "../sdk/cargofit-sdk";
import { CONTAINER_PRESETS } from "./presets";
import type { ProductInput } from "./types";

const SAMPLE_PRODUCT: ProductInput = {
  id: "v22-p1",
  sku: "SHED-BOX-A",
  name: "Metal Shed Carton A",
  length: 600,
  width: 400,
  height: 350,
  weight: 18,
  quantity: 240,
  priority: 50,
  rotationPolicy: "upright",
  stackable: true,
  maxStackLayers: 6,
  color: "#2563eb",
};

describe("CargoFit v2.2.0 Full 24-Direction Deepened Capabilities", () => {
  it("D03: Reverse packaging matrix evaluates 20GP/40GP/40HQ capacity & optimal pallet footprint", () => {
    const matrix = evaluateReversePackagingMatrix(SAMPLE_PRODUCT, { length: 580, width: 390, height: 340 });
    expect(matrix.containers.length).toBe(3);
    expect(matrix.containers.every((c) => c.loadedCartons > 0 && c.freightPerCartonUsd > 0)).toBe(true);
    expect(matrix.cartonsPerPalletLayer).toBeGreaterThan(0);
  });

  it("D05: Flexible packaging compression model bounds compression and labels measured-deformation tier", () => {
    const res = solveFlexibleCompressionPacking(
      { length: 12032, width: 2352, height: 2698 },
      { length: 600, width: 400, height: 400 },
      12,
      "height",
    );
    expect(res.capabilityTier).toBe("measured-deformation");
    expect(res.compressedCapacity).toBeGreaterThanOrEqual(res.nominalCapacity);
    expect(res.compressedDimsMm.height).toBe(352);
  });

  it("D06: STEP & IGES CAD parsers extract real mm envelopes and generate 3ds Max MAXScript bridge", () => {
    const sampleStep = `
ISO-10303-21;
DATA;
#1 = SI_UNIT(.MILLI.,.METRE.);
#10 = CARTESIAN_POINT('p1',(0.0, 0.0, 0.0));
#11 = CARTESIAN_POINT('p2',(850.0, 0.0, 0.0));
#12 = CARTESIAN_POINT('p3',(850.0, 520.0, 0.0));
#13 = CARTESIAN_POINT('p4',(0.0, 520.0, 410.0));
ENDSEC;
END-ISO-10303-21;`;
    const stepEnv = parseStepCadEnvelope(sampleStep);
    expect(stepEnv).not.toBeNull();
    expect(stepEnv!.lengthMm).toBe(850);
    expect(stepEnv!.widthMm).toBe(520);
    expect(stepEnv!.heightMm).toBe(410);
    expect(stepEnv!.supportableFlatFaces).toContain("bottom");

    const sampleIges = [
      "1H,,1H;,,,,,,2HMM,1,0.0,,,,,;                                           G      1",
      "110,0.0,0.0,0.0,700.0,450.0,320.0;                                     1P      1",
    ].join("\n");
    const igesEnv = parseIgesCadEnvelope(sampleIges);
    expect(igesEnv).not.toBeNull();
    expect(igesEnv!.lengthMm).toBe(700);
    expect(igesEnv!.heightMm).toBe(320);

    const ms = generate3dsMaxCargoFitBridgeScript();
    expect(ms).toContain("nodeGetBoundingBox");
    expect(ms).toContain("cargofit_weight_kg");
  });

  it("D07: Smart Pallet Economic Designer ranks EUR1/EUR2/GMA/Asia/ISO by real pallet cost & layer pattern", () => {
    const report = designEconomicalPallet(SAMPLE_PRODUCT, 2200, 0);
    expect(report.options.length).toBe(5);
    expect(report.recommended).not.toBeNull();
    expect(report.recommended!.totalPalletCostUsd).toBeLessThanOrEqual(report.options[report.options.length - 1].totalPalletCostUsd);
    expect(report.recommended!.cartonsPerPallet).toBeGreaterThan(0);
  });

  it("D21: Enterprise Governance enforces approval state transitions, immutable issued state, and revision diff", () => {
    const rec = createGovernedPlanRecord("plan-101", "Order #101", { loadedCartons: 220, volumeUtilPct: 86.5, totalWeightKg: 3960 }, "alice");
    const r1 = transitionApprovalStatus(rec, "pending_review", "alice", "planner");
    expect(r1.ok).toBe(true);
    const r2 = transitionApprovalStatus(r1.record, "approved", "bob", "manager", "Approved for dispatch");
    expect(r2.ok).toBe(true);
    const r3 = transitionApprovalStatus(r2.record, "issued", "bob", "manager");
    expect(r3.ok).toBe(true);
    // Issued record must reject further edits
    const blocked = transitionApprovalStatus(r3.record, "draft", "alice", "planner");
    expect(blocked.ok).toBe(false);

    const rev2 = { ...r3.record, revision: 2, loadedCartons: 240, volumeUtilPct: 91.2, totalWeightKg: 4320 };
    const diff = diffGovernedPlans(r3.record, rev2);
    expect(diff.cartonsDelta).toBe(20);
  });

  it("D22: Official TypeScript SDK executes embedded deterministic engine & verifies Webhook digest", async () => {
    const client = new CargoFitClient();
    const res = await client.calculatePlan({
      schema: "cargo-fit-api-v1.8",
      request: {
        container: CONTAINER_PRESETS[2],
        mode: "mixed",
        strategy: "maximum",
        clearance: 10,
        products: [{ ...SAMPLE_PRODUCT, id: "sdk-1", sku: "SDK-1", quantity: 60 }],
      },
    });
    expect(res.ok).toBe(true);
    expect(res.result?.metrics.loadedCount).toBe(60);

    const body = JSON.stringify({ eventType: "plan.calculated", loaded: 60 });
    const sig = computeWebhookDigest("secret-key", body);
    expect(verifyWebhookDigest("secret-key", body, sig)).toBe(true);
    expect(verifyWebhookDigest("wrong-key", body, sig)).toBe(false);
  });
});
