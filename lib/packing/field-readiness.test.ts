import { expect, it } from "vitest";
import { issueDeliveryIdentity } from "./delivery-identity";
import { pack, restorePackingSnapshot } from "./engine";
import { fieldReadinessReport, reviewMoistureBudget, reviewShippingMark } from "./field-readiness";
import type { PackingRequest } from "./types";

const request: PackingRequest = {
  mode: "mixed", strategy: "maximum", clearance: 0,
  container: { id: "qa", name: "QA", length: 900, width: 250, height: 250, doorWidth: 250, doorHeight: 250, maxWeight: 1000 },
  products: [{ id: "r", sku: "QA", name: "Carton", length: 100, width: 100, height: 100, weight: 10,
    quantity: 2, priority: 50, rotationPolicy: "fixed", stackable: false, maxStackLayers: 1, color: "#338877" }],
};

it("checks the centred label against a real planar face and a nearby occluding carton", () => {
  const result = pack(request);
  const plan = issueDeliveryIdentity(restorePackingSnapshot(request, { ...result, placements: result.placements.map((box, i) => ({ ...box, x: i * 110, y: 0, z: 0 })) }));
  const first = plan.deliveryIdentity!.units[0];
  const input = { unitId: first.unitId, face: "x+" as const, widthMm: 50, heightMm: 40, accessMm: 20 };
  expect(reviewShippingMark(plan, input)).toMatchObject({ status: "obstructed", clearanceMm: 10, obstruction: plan.placements[1].id });
  expect(reviewShippingMark(plan, { ...input, accessMm: 5 }).status).toBe("clear");
  expect(reviewShippingMark(plan, { ...input, widthMm: 150 }).status).toBe("does-not-fit");
});

it("counts only explicitly matched material rows in the documented absorption budget", () => {
  const source = structuredClone(request);
  const material = { type: "desiccant" as const, quantity: 2, unitWeightKg: .2, phase: "after-cargo" as const,
    relatedProductIds: [], afterAccessoryIds: [], source: "QA rated absorption", revision: "A", note: "" };
  source.container.exclusions = [
    { id: "rated", name: "Rated test bags", kind: "obstacle", x: 700, y: 0, z: 0, dx: 50, dy: 50, dz: 50, accessory: material },
    { id: "other", name: "Different test bags", kind: "obstacle", x: 750, y: 0, z: 0, dx: 50, dy: 50, dz: 50,
      accessory: { ...material, source: "Different condition", quantity: 5 } },
  ];
  const plan = issueDeliveryIdentity(pack(source));
  const input = { waterGrams: 800, ratedGramsPerUnit: 400, safetyFactor: 1.25, source: "QA test condition", accessoryIds: ["rated"] };
  expect(reviewMoistureBudget(plan, input)).toEqual({ requiredGrams: 1000, requiredUnits: 3, plannedUnits: 2, shortage: 1, accessoryIds: ["rated"] });
  expect(() => reviewMoistureBudget(plan, { ...input, accessoryIds: ["unknown"] })).toThrow(/Invalid field review/);
  expect(fieldReadinessReport(plan, undefined, input).context.revisionId).toBe(plan.deliveryIdentity!.revisionId);
});
