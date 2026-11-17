import { expect, it } from "vitest";
import { crateHeightBreakdown, withCrateExteriorHeight } from "./packaging-height";
import { DEFAULT_PACKAGING, packagingHeight, packagingParts } from "./packaging";
import { DEFAULT_PALLET_BUILD } from "./loading-workflow";
import { parseFloorPalletConfig } from "./floor-pallets";
import { crateEvidenceKey, emptyCrateBearing } from "./crate-bearing";
import { packLoadingWorkflow } from "./pack-loading";
import { parseWorkspaceBackup, restoreWorkspacePlans, serializeWorkspaceBackup, type WorkspaceInputs } from "./workspace-file";
import { visiblePlanPallets } from "./prebuilt-pallets";
import type { FloorPalletConfig, PackingRequest } from "./types";

const config: FloorPalletConfig = { ...DEFAULT_PALLET_BUILD.config, length: 1700, width: 560, height: 144, weight: 25, maxCargoHeight: 1000, packaging: { ...DEFAULT_PACKAGING, base: "corner-feet", enclosure: "slatted", wallThickness: 30 } };
function request(c = withCrateExteriorHeight(config, 1200)): PackingRequest {
  return { workflow: "palletized", mode: "mixed", strategy: "maximum", clearance: 0,
    container: { id: "c", name: "QA", length: 3400, width: 560, height: 2400, doorWidth: 560, doorHeight: 2400, maxWeight: 1000 },
    palletBuild: { ...DEFAULT_PALLET_BUILD, config: c, maxPallets: 2 },
    products: [{ id: "p", sku: "LONG", name: "Long carton", length: 1600, width: 450, height: 500, weight: 10, quantity: 4, priority: 50, rotationPolicy: "fixed", stackable: true, maxStackLayers: 0, maxTopLoadKg: 100, color: "#338877" }] };
}
it("converts the screenshot's 1174 mm total into an editable 1200 mm crate without changing its base or tare", () => {
  const before = JSON.stringify(config), next = withCrateExteriorHeight(config, 1200);
  expect(crateHeightBreakdown(config)).toEqual({ base: 144, interior: 1000, lid: 30, exterior: 1174 });
  expect(next.maxCargoHeight).toBe(1026); expect(next.height).toBe(144); expect(next.weight).toBe(25);
  expect(packagingHeight(parseFloorPalletConfig(next))).toBe(1200);
  expect(Math.max(...packagingParts(next.length, next.width, next.height, next.packaging, next.maxCargoHeight).map(p => p.z + p.dz))).toBe(1200);
  expect(JSON.stringify(config)).toBe(before);
});
it("handles a lidless crate and fractional base/lid dimensions without a second exterior-height field", () => {
  const lidless = { ...config, packaging: { ...config.packaging!, lid: false } };
  expect(withCrateExteriorHeight(lidless, 1200).maxCargoHeight).toBe(1056);
  const fractional = withCrateExteriorHeight({ ...config, height: 144.2, packaging: { ...config.packaging!, wallThickness: 30.1 } }, 1200.4);
  expect(fractional.maxCargoHeight).toBe(1026.1); expect(packagingHeight(fractional)).toBeCloseTo(1200.4, 6);
  expect(Object.keys(fractional)).not.toContain("exteriorHeight");
});
it("rejects totals that leave no interior, non-finite values, oversized interiors and open pallets", () => {
  for (const n of [0, 144, 173, 174, -1, NaN, Infinity, 100175]) expect(() => withCrateExteriorHeight(config, n)).toThrow();
  expect(withCrateExteriorHeight(config, 100174).maxCargoHeight).toBe(100000);
  expect(() => withCrateExteriorHeight({ ...config, packaging: { ...config.packaging!, enclosure: "none" } }, 1200)).toThrow();
});
it("invalidates existing reviewed crate evidence through the same geometry key", () => {
  const rated = { ...config, crateBearing: { ...emptyCrateBearing(), reviewed: true } };
  rated.crateBearing.reviewedFor = crateEvidenceKey(rated);
  const next = withCrateExteriorHeight(rated, 1200);
  expect(next.crateBearing).toEqual(rated.crateBearing);
  expect(crateEvidenceKey(next)).not.toBe(next.crateBearing!.reviewedFor);
});
it("retains one physical base per complete unit, correct cargo Z and packaging tare", () => {
  const plan = packLoadingWorkflow(request());
  expect(plan.validation.valid).toBe(true); expect(plan.placements).toHaveLength(4); expect(plan.pallets).toHaveLength(2);
  expect(plan.metrics.grossWeight).toBe(90);
  for (const p of plan.pallets!) {
    expect(p.dz).toBe(144); expect(p.enclosureHeight).toBe(1200);
    const cargo = plan.placements.filter(b => b.palletIds?.includes(p.id));
    expect(cargo).toHaveLength(2); expect(Math.min(...cargo.map(b => b.z))).toBe(p.z + 144);
    const parts = packagingParts(p.dx, p.dy, p.dz, p.packaging, 1026);
    expect(parts.filter(b => b.bearingRole === "foot")).toHaveLength(4);
  }
  expect(visiblePlanPallets(plan, plan.placements.length)).toHaveLength(2);
});
it("checks the full user-entered crate height against the door, including lid and base", () => {
  const r = request();
  expect(() => packLoadingWorkflow({ ...r, container: { ...r.container, doorHeight: 1199 } })).toThrow(/Crate exterior/);
  expect(packLoadingWorkflow({ ...r, container: { ...r.container, doorHeight: 1200 } }).placements).toHaveLength(4);
});
it("round-trips the same total, bases, coordinates and gross weight through the existing workspace backup", () => {
  const r = request(), plan = packLoadingWorkflow(r);
  const inputs: WorkspaceInputs = { ...r, mode: "mixed", strategy: "maximum", practicalTargetPercent: 88, clearance: 0, customContainers: [], targetVolumePercent: 85, targetWeightPercent: 85, lengthUnit: "mm", weightUnit: "kg" };
  const file = serializeWorkspaceBackup(inputs, "0.60.0", plan), parsed = parseWorkspaceBackup(file), restored = restoreWorkspacePlans(file, parsed)!;
  expect(packagingHeight(parsed.palletBuild!.config)).toBe(1200);
  expect(restored.pallets).toEqual(plan.pallets); expect(restored.placements).toEqual(plan.placements); expect(restored.metrics.grossWeight).toBe(90);
});

it("uses independent lid thickness in the preview, door check and saved bearing identity", () => {
  const crate = { ...config, maxCargoHeight: 1000,
    packaging: { ...config.packaging!, lidThickness: 18, railCount: 3, railHeight: 64 } };
  const parsed = parseFloorPalletConfig(crate);
  expect(crateHeightBreakdown(parsed)).toEqual({ base: 144, interior: 1000, lid: 18, exterior: 1162 });
  expect(packagingParts(parsed.length, parsed.width, parsed.height, parsed.packaging, 1000).find(p => p.kind === "lid")?.dz).toBe(18);
  expect(crateEvidenceKey(parsed)).not.toBe(crateEvidenceKey(config));
  const r = request(parsed);
  expect(() => packLoadingWorkflow({ ...r, container: { ...r.container, doorHeight: 1161 } })).toThrow(/Crate exterior/);
  expect(packLoadingWorkflow({ ...r, container: { ...r.container, doorHeight: 1162 } }).placements).toHaveLength(4);
});

it("rejects custom rail heights whose total exceeds the enclosure", () => {
  const crate = { ...config, maxCargoHeight: 180, packaging: { ...config.packaging!, railCount: 4, railHeight: 46 } };
  expect(() => parseFloorPalletConfig(crate)).toThrow(/Rails exceed/);
  expect(parseFloorPalletConfig({ ...crate, maxCargoHeight: 184 }).packaging?.railHeight).toBe(46);
});
