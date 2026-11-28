import { describe, expect, it } from "vitest";
import { optimizeKitCartonDimensions } from "./kit-dimension-optimizer";
import { auditOrderInputs } from "./order-data-auditor";
import { API_SCHEMA_VERSION, executeCargoFitApiV1 } from "./api-contract";
import type { ContainerSpec, ProductInput } from "./types";

const container20gp: ContainerSpec = {
  id: "20gp",
  name: "20GP",
  length: 5900,
  width: 2352,
  height: 2395,
  doorWidth: 2340,
  doorHeight: 2280,
  maxWeight: 28130,
};

function sku(id: string, L: number, W: number, H: number, wt: number, qty: number, extra: Partial<ProductInput> = {}): ProductInput {
  return {
    id,
    sku: id.toUpperCase(),
    name: id.toUpperCase(),
    length: L,
    width: W,
    height: H,
    weight: wt,
    quantity: qty,
    priority: 50,
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 0,
    maxTopLoadKg: 10000,
    color: "#2b8d83",
    ...extra,
  };
}

describe("CargoFit v1.2.0: Kit Reverse Dimension Optimizer (D03), Order Auditor (D11) & API Contract (D22)", () => {
  it("finds real kit capacity gain when reducing a borderline carton dimension", () => {
    // 1185mm width fits only 1 across 2352mm (2*1185 = 2370 > 2332), reducing by 20mm -> 1165mm fits 2 across!
    const products = [
      sku("kit-a", 1200, 1185, 600, 25, 20, { setCode: "SHED", unitsPerSet: 1 }),
      sku("kit-b", 600, 500, 400, 12, 20, { setCode: "SHED", unitsPerSet: 1 }),
    ];
    const report = optimizeKitCartonDimensions(products, container20gp, 10, {
      setCode: "SHED",
      deltasMm: [-20, -10],
    });
    expect(report.isKit).toBe(true);
    expect(report.evaluatedCount).toBeGreaterThan(1);
    expect(report.bestCandidate).not.toBeNull();
    expect(report.bestCandidate!.unitGain).toBeGreaterThan(0);
    expect(report.bestCandidate!.valid).toBe(true);
  });

  it("detects unit mix-ups, duplicate SKUs, extreme density, kit ratio mismatch, oversize, and payload exceedance", () => {
    const products = [
      sku("normal", 1000, 600, 400, 20, 10, { setCode: "K1", unitsPerSet: 1 }),
      sku("tiny-cm", 45, 30, 20, 15, 10), // looks like cm instead of mm AND extreme density!
      sku("dup", 500, 650, 300, 10, 5), // W > L
      sku("dup2", 500, 400, 300, 10, 5, { sku: "DUP" }), // duplicate SKU
      sku("kit-b", 500, 400, 300, 10, 15, { setCode: "K1", unitsPerSet: 2 }), // 15/2 = 7.5 not integer
      sku("huge", 3000, 3000, 3000, 30000, 1), // oversized + payload over
    ];
    const audit = auditOrderInputs(products, container20gp, 10);
    const codes = new Set(audit.issues.map((i) => i.code));
    expect(codes.has("unit_mismatch_suspected")).toBe(true);
    expect(codes.has("dimension_order_unusual")).toBe(true);
    expect(codes.has("density_extreme")).toBe(true);
    expect(codes.has("duplicate_sku")).toBe(true);
    expect(codes.has("kit_ratio_mismatch")).toBe(true);
    expect(codes.has("oversized_for_container")).toBe(true);
    expect(codes.has("total_weight_over_payload")).toBe(true);
  });

  it("executes deterministic CargoFit API v1.2 contract and rejects invalid schema", () => {
    const bad = executeCargoFitApiV1({ schema: "bad" as typeof API_SCHEMA_VERSION, request: null as never });
    expect(bad.ok).toBe(false);

    const good = executeCargoFitApiV1({
      schema: API_SCHEMA_VERSION,
      requestId: "req-123",
      request: {
        mode: "mixed",
        workflow: "direct",
        strategy: "maximum",
        clearance: 10,
        practicalTargetUtilization: 0.95,
        container: container20gp,
        products: [sku("box-1", 500, 400, 400, 10, 50)],
      },
    });
    expect(good.ok).toBe(true);
    expect(good.result?.metrics.loadedCount).toBe(50);
    expect(good.result?.validation.valid).toBe(true);
  });
});
