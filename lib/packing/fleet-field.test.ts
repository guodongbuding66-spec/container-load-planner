import { describe, expect, it } from "vitest";
import { fleetTailFixture } from "../../tests/fleet-tail-fixture";
import { deliveryIdentityState } from "./delivery-identity";
import { appendFieldEvent, emptyFieldJournal, unitTicket, unitTicketUrl } from "./field-journal";
import { recordsFromJournal } from "./field-records";
import { allocateFleet } from "./fleet";
import { parseFleetFieldPacket, serializeFleetFieldPacket } from "./fleet-field-backup";
import { fleetFieldCsv, fleetFieldLedger, issueFleetVehicle, previewFieldReplacement, retainedFleetPrefix, routeFleetTicket, validateFieldReplacement } from "./fleet-field";
import { parseFleetBackup, serializeFleetBackup } from "./fleet-file";
import { appendOperation, emptyOperationRecords } from "./operations";
import { appendUnitReading, emptyUnitWeighing, fleetWeightCsv, mergeUnitWeighing, parseUnitWeighing, reconcileFleetWeights, reconcileUnitWeights, unitWeightTargets } from "./unit-weighing";

const measuredAt = "2026-11-06T00:00:00.000Z";
function readUnit(targetId: string, kg: number) {
  return { targetId, kg, measuredAt, source: "Controlled scale", reference: "QA-01" };
}

describe("issued multi-vehicle field handoff", () => {
  it("restores legacy fleet backups and binds unique unit IDs while preserving coordinates and quantities", () => {
    const original = fleetTailFixture();
    const source = parseFleetBackup(serializeFleetBackup(original));
    const issued = issueFleetVehicle(issueFleetVehicle(source, 0), 1);
    const recovered = parseFleetBackup(serializeFleetBackup(issued), original.request);
    expect(recovered.result.loads.slice(0, 2).every(load => deliveryIdentityState(load.plan) === "current")).toBe(true);
    expect(recovered.result.loads.map(load => load.plan.placements)).toEqual(original.result.loads.map(load => load.plan.placements));
    const rows = fleetFieldLedger(recovered.result, new Map());
    expect(new Set(rows.map(row => row.unitId)).size).toBe(rows.length);
    expect(rows.every(row => row.state === "pending")).toBe(true);
    expect(rows.filter(row => row.pallets).every(row => rows.some(pallet => pallet.unitId === row.pallets && pallet.vehicle === row.vehicle))).toBe(true);
    expect(retainedFleetPrefix(recovered.result)).toBe(2);
  });

  it("routes a fleet QR to its verified revision and rejects forged or duplicated identity", () => {
    const source = issueFleetVehicle(issueFleetVehicle(fleetTailFixture(), 0), 1);
    const second = source.result.loads[1].plan;
    const ticket = unitTicket(second, second.deliveryIdentity!.units[0].unitId);
    expect(routeFleetTicket(source.result, unitTicketUrl(ticket, "https://example.test"))).toBe(1);
    expect(() => routeFleetTicket(source.result, JSON.stringify({ ...ticket, revisionId: "old" }))).toThrow(/older delivery/);
    const modified = structuredClone(source);
    modified.result.loads[1].plan.deliveryIdentity = modified.result.loads[0].plan.deliveryIdentity;
    expect(() => serializeFleetBackup(modified)).toThrow(/Duplicate fleet delivery/);
  });

  it("round-trips recorded loading, unit weights and operations in one source-bound handoff", () => {
    const fleet = issueFleetVehicle(fleetTailFixture(), 0);
    const plan = fleet.result.loads[0].plan;
    const id = plan.deliveryIdentity!.revisionId;
    const journal = emptyFieldJournal(plan);
    const atom = journal.context.atoms.find(a => a.children.length)!;
    const field = recordsFromJournal(appendFieldEvent(plan, journal, atom.id, "load", { deviceId: "qa" }).journal);
    const weight = appendUnitReading(plan, emptyUnitWeighing(plan), readUnit(atom.id, 62));
    const operations = appendOperation(plan, emptyOperationRecords(plan), "load:inspect", "confirm", "qa", "Controlled review", { at: measuredAt });
    const packet = serializeFleetFieldPacket(fleet, new Map([[id, { field, weight, operations }]]));
    const restored = parseFleetFieldPacket(packet, fleet.request);
    expect(restored.evidence.get(id)).toEqual({ field, weight, operations });
    const ledger = fleetFieldLedger(restored.fleet.result, new Map([[id, field]]));
    expect(ledger.filter(row => row.kind === "carton" && row.state === "loaded")).toHaveLength(atom.children.length);
    expect(fleetFieldCsv(ledger)).toContain(atom.id);
    const altered = JSON.parse(packet);
    altered.evidence[0].revisionId = "other-revision";
    expect(() => parseFleetFieldPacket(JSON.stringify(altered), fleet.request)).toThrow(/revision mismatch/);
  });

  it("replaces only unissued vehicles and blocks a candidate that loses a source order row", () => {
    const baseline = fleetTailFixture();
    const alternate = { ...baseline.request.container, id: "replacement", name: "Replacement vehicle" };
    baseline.options.push({ container: alternate, cost: 105, available: 5 });
    const source = issueFleetVehicle(baseline, 0);
    const restriction = { vehicleId: alternate.id };
    const result = previewFieldReplacement(source, restriction);
    expect(result.loads[0]).toEqual(source.result.loads[0]);
    expect(result.loads.slice(1).every(load => load.plan.container.id === alternate.id)).toBe(true);
    expect(validateFieldReplacement(source, restriction, result)).toEqual({ prefix: 1, canAdopt: true });
    const short = { ...source, options: source.options.map(option => option.container.id === alternate.id ? { ...option, available: 1 } : option) };
    const insufficient = previewFieldReplacement(short, restriction);
    expect(validateFieldReplacement(short, restriction, insufficient).canAdopt).toBe(false);
    const forged = structuredClone(result);
    forged.loads[0].plan.id = "modified";
    expect(() => validateFieldReplacement(source, restriction, forged)).toThrow(/retained vehicle/);
  });

  it("excludes a shortage for remaining cargo without consuming the retained unit again", () => {
    const baseline = fleetTailFixture();
    const build = baseline.request.palletBuild!;
    build.additionalSpecs = [{ id: "spare", config: { ...build.config, name: "Spare pallet" }, maxPallets: 3, stackLayers: 1, maxTopLoadKg: 0 }];
    baseline.pricing!.packaging.spare = 7;
    baseline.result = allocateFleet(baseline.request, baseline.options, baseline.limit, baseline.objective, undefined, baseline.pricing);
    const source = issueFleetVehicle(baseline, 0);
    const restriction = { unavailablePackaging: "primary" };
    const result = previewFieldReplacement(source, restriction);
    expect(result.loads[0]).toEqual(source.result.loads[0]);
    expect(result.loads.slice(1).flatMap(load => load.plan.pallets ?? []).map(pallet => pallet.specificationId)).toEqual(["spare", "spare"]);
    expect(validateFieldReplacement(source, restriction, result).canAdopt).toBe(true);
    expect(() => serializeFleetBackup({ ...source, result })).not.toThrow();
  });
});

describe("physical weighing scope and concurrent evidence", () => {
  it("weighs gross prebuilt units exactly once and leaves the fleet total open until complete", () => {
    const fleet = issueFleetVehicle(fleetTailFixture(), 0), plan = fleet.result.loads[0].plan;
    const targets = unitWeightTargets(plan);
    expect(targets.map(row => [row.kind, row.plannedKg, row.cartons])).toEqual([
      ["carton", 10, 1], ["carton", 10, 1], ["pallet-gross", 60, 4],
    ]);
    const childId = emptyFieldJournal(plan).context.atoms.find(atom => atom.children.length)!.children[0];
    expect(() => appendUnitReading(plan, emptyUnitWeighing(plan), readUnit(childId, 10))).toThrow(/Invalid unit weighing/);
    const weight = targets.reduce((records, target) =>
      appendUnitReading(plan, records, readUnit(target.id, target.plannedKg + (target.kind === "pallet-gross" ? 2 : 0))), emptyUnitWeighing(plan));
    const report = reconcileFleetWeights(fleet.result, new Map([[weight.context.revisionId, weight]]));
    expect(report).toMatchObject({ subtotalKg: 82, actualKg: null, differenceKg: null });
    expect(report.vehicles[0].report).toMatchObject({ actualKg: 82, differenceKg: 2 });
    expect(fleetWeightCsv(report)).toContain("unissued");
  });

  it("keeps concurrent readings out of totals until a new witnessed measurement resolves both", () => {
    const plan = issueFleetVehicle(fleetTailFixture(), 0).result.loads[0].plan;
    const target = unitWeightTargets(plan).find(row => row.kind === "pallet-gross")!;
    const empty = emptyUnitWeighing(plan);
    const a = appendUnitReading(plan, empty, readUnit(target.id, 59));
    const b = appendUnitReading(plan, empty, readUnit(target.id, 62));
    const combined = mergeUnitWeighing(plan, a, b);
    expect(reconcileUnitWeights(plan, combined)).toMatchObject({ conflicts: 1, actualKg: null, subtotalKg: 0 });
    const revised = appendUnitReading(plan, combined, readUnit(target.id, 61));
    expect(reconcileUnitWeights(plan, revised)).toMatchObject({ conflicts: 0, actualKg: null, subtotalKg: 61 });
    expect(revised.readings).toHaveLength(3);
    const forged = structuredClone(revised);
    forged.readings[0].replaces = [forged.readings[0].id];
    expect(() => parseUnitWeighing(plan, JSON.stringify(forged))).toThrow(/Invalid unit weighing/);
  });
});
