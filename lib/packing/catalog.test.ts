import { describe, expect, it } from "vitest";
import { orderCapacityFixture } from "../../tests/order-capacity-fixture";
import { calibrationReport, fieldCalibrationSignature, packagingSignature, parseCatalog, type FieldRecord } from "./catalog";
import { packLoadingWorkflow } from "./pack-loading";
import type { PackingResult, ProductInput } from "./types";

const request = orderCapacityFixture();
const plan = packLoadingWorkflow(request);
const createdAt = "2026-11-17T00:00:00.000Z";

async function entry(id: string, split: FieldRecord["split"], result = plan, products = request.products): Promise<FieldRecord> {
  return {
    id, name: id, split, container: result.container, packagingSignature: packagingSignature(products),
    settingsSignature: await fieldCalibrationSignature(result, products), predicted: 20, actual: 20,
    minutes: 10, reason: "fixture", photos: [], createdAt,
  };
}

describe("field calibration conditions", () => {
  it("keeps a different vehicle payload out of the acceptance sample's fitted ratio", async () => {
    const train = await entry("calibration", "calibration", {...plan, container: {...plan.container, maxWeight: 1000}});
    train.predicted = 10;
    train.actual = 7;
    const holdout = await entry("acceptance", "acceptance", {...plan, container: {...plan.container, maxWeight: 2000}});
    const report = calibrationReport([train, holdout]);
    expect(report.evaluate[0]).toMatchObject({predicted: 20, actual: 20, trainingCount: 0, errorPct: 0});
    expect(calibrationReport([train, {...holdout, settingsSignature: train.settingsSignature}]).evaluate[0].trainingCount).toBe(0);
  });

  it("isolates workflow, pallet carton limit, stacking rules and door clearance", async () => {
    const build = plan.palletBuild!;
    const differences: PackingResult[] = [
      {...plan, workflow: "direct", palletBuild: undefined, palletization: undefined},
      {...plan, palletBuild: {...build, primaryRule: {maxPallets: build.maxPallets, cartonLimit: 3}}},
      {...plan, palletBuild: {...build, config: {...build.config, unitStacking: {enabled: true, maxLayers: 4}}}},
      {...plan, container: {...plan.container, doorHeight: plan.container.doorHeight - 20}},
    ];
    const first = await fieldCalibrationSignature(plan, request.products);
    const keys = await Promise.all(differences.map(result => fieldCalibrationSignature(result, request.products)));
    expect(new Set([first, ...keys]).size).toBe(5);
    const changedLook = request.products.map(product => ({...product, color: "#121212", name: "Display name"}));
    expect(await fieldCalibrationSignature({...plan, id: "new", container: {...plan.container, name: "Renamed"}}, changedLook)).toBe(first);
  });

  it("matches identical conditions and only fits calibration rows", async () => {
    const train = {...await entry("train", "calibration"), predicted: 10, actual: 7};
    const evaluation = await entry("test", "acceptance");
    const secondHoldout = {...await entry("another test", "acceptance"), predicted: 10, actual: 50};
    expect(calibrationReport([train, evaluation, secondHoldout]).evaluate[0]).toMatchObject({predicted: 14, trainingCount: 1, errorPct: 30, legacy: false});
  });

  it("isolates revised pallet positions even when the original order inputs match", async () => {
    const edited = {...plan, palletization: {...plan.palletization!, editRevision: 1}};
    const moved = {...edited, placements: edited.placements.map((carton, index) => index === 0 ? {...carton, x: carton.x + 1} : carton)};
    expect(await fieldCalibrationSignature(edited, request.products)).not.toBe(await fieldCalibrationSignature(moved, request.products));
  });

  it("retains a long legacy record for raw comparison without fitting it", async () => {
    const legacySignature = JSON.stringify(Array.from({length: 100}, (_, i) => [`order-${i}`, "upright", 18, 12, 0, {length: 200}]));
    expect(legacySignature.length).toBeGreaterThan(2000);
    const legacy = {...await entry("legacy", "calibration"), settingsSignature: legacySignature, predicted: 10, actual: 7};
    const archive = {format: "cargo-fit-catalog", version: 1, entries: [], records: [legacy, {...legacy, id: "old-test", split: "acceptance", predicted: 20, actual: 20}]};
    const imported = parseCatalog(JSON.stringify(archive));
    expect(imported.records[0].settingsSignature).toBe(legacySignature);
    expect(calibrationReport(imported.records)).toMatchObject({trainingCount: 0, acceptanceCount: 1, legacyCount: 2, meanErrorPct: null, evaluate: [{predicted: 20, trainingCount: 0, legacy: true}]});
  });

  it("round-trips a large order archive with a compact key and all product rows", async () => {
    const products: ProductInput[] = Array.from({length: 1100}, (_, i) => ({...request.products[0], id: `line-${i}`, sku: `SKU-${i}`}));
    const record = await entry("large", "acceptance", plan, products);
    const archive = {format: "cargo-fit-catalog", version: 1,
      entries: [{id: "packaging", name: "Large order", revision: "R1", effectiveDate: "2026-11-17", notes: "", products, createdAt}], records: [record]};
    const imported = parseCatalog(JSON.stringify(archive));
    expect(record.settingsSignature).toMatch(/^v2:[0-9a-f]{64}$/);
    expect(imported.records[0].settingsSignature).toBe(record.settingsSignature);
    expect(imported.entries[0].products.map(product => product.id)).toEqual(products.map(product => product.id));
  });
});
