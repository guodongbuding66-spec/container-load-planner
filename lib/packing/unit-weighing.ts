import { accessoryRegions } from "./container-accessories";
import { toCsvCell } from "./csv";
import { fieldContext } from "./field-journal";
import type { FleetResult } from "./fleet";
import { deliveryIdentityState } from "./delivery-identity";
import type { PackingResult } from "./types";
import { emptyWeighingRecords, plannedWeightBreakdown, type WeighingContext } from "./weighing";

export type UnitReading = {
  id: string;
  targetId: string;
  kg: number;
  measuredAt: string;
  source: string;
  reference: string;
  replaces: string[];
};
export type UnitWeighing = {
  format: "cargo-fit-unit-weighing";
  version: 1;
  context: WeighingContext;
  readings: UnitReading[];
};
const MAX_READINGS = 30_000;
export const MAX_UNIT_WEIGHING_BYTES = 12 * 1024 * 1024;
const MATERIALS = "installed-materials";
const invalid = () => new Error("逐件核重资料、编号或修订关系无效 / Invalid unit weighing values, identifiers or revision links");

type WeightTarget = { id: string; label: string; kind: "carton" | "pallet-gross" | "pallet-tare" | "materials"; plannedKg: number; cartons: number };

/** Each carton is covered exactly once, including when weighed inside its prebuilt unit. */
export function unitWeightTargets(plan: PackingResult): WeightTarget[] {
  const { atoms } = fieldContext(plan);
  const bindings = new Map(plan.deliveryIdentity!.units.map(unit => [unit.unitId, unit]));
  const names = new Map([
    ...plan.placements.map(box => [box.id, box.sku] as const),
    ...(plan.pallets ?? []).map(pallet => [pallet.id, pallet.name] as const),
  ]);
  const byId = new Map(atoms.map(atom => [atom.id, atom]));
  const covered = new Set(atoms.flatMap(atom => atom.children));
  const targets: WeightTarget[] = atoms.filter(atom => !covered.has(atom.id)).map(atom => ({
    id: atom.id,
    label: names.get(bindings.get(atom.id)!.localId)!,
    kind: atom.kind === "carton" ? "carton" : atom.children.length ? "pallet-gross" : "pallet-tare",
    plannedKg: atom.weightKg + atom.children.reduce((sum, child) => sum + byId.get(child)!.weightKg, 0),
    cartons: atom.kind === "carton" ? 1 : atom.children.length,
  }));
  const planned = plannedWeightBreakdown(plan);
  if (accessoryRegions(plan.container).some(region => region.kind === "obstacle"))
    targets.push({ id: MATERIALS, label: MATERIALS, kind: "materials", plannedKg: planned.accessoriesKg, cartons: 0 });
  const subtotal = targets.reduce((sum, target) => sum + target.plannedKg, 0);
  if (!planned.consistent || Math.abs(subtotal - planned.payloadKg) > Math.max(.00001, planned.payloadKg * 1e-9) ||
    targets.reduce((sum, target) => sum + target.cartons, 0) !== plan.placements.length)
    throw Error("逐件覆盖与计划重量不一致 / Unit coverage differs from the planned weight");
  return targets;
}

export function emptyUnitWeighing(plan: PackingResult): UnitWeighing {
  return { format: "cargo-fit-unit-weighing", version: 1, context: emptyWeighingRecords(plan).context, readings: [] };
}

export function unitWeighingKey(plan: PackingResult) {
  const { planId, revisionId } = emptyUnitWeighing(plan).context;
  return `cargo-fit-unit-weighing-v1/${planId}/${revisionId}`;
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  return raw as Record<string, unknown>;
}
function text(raw: unknown, max: number) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > max) throw invalid();
  return raw.trim();
}
function id(raw: unknown) {
  const value = text(raw, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw invalid();
  return value;
}

export function parseUnitWeighing(plan: PackingResult, contents: string): UnitWeighing {
  if (new TextEncoder().encode(contents).length > MAX_UNIT_WEIGHING_BYTES) throw invalid();
  const value = object(JSON.parse(contents));
  const base = emptyUnitWeighing(plan);
  const context = object(value.context);
  for (const key of ["planId", "revisionId", "revision", "signature"] as const) {
    if (context[key] !== base.context[key]) throw Error("核重属于其他柜或交付版本 / Weighing belongs to another vehicle or revision");
  }
  if (value.format !== base.format || value.version !== base.version || !Array.isArray(value.readings) || value.readings.length > MAX_READINGS) throw invalid();
  const targets = new Set(unitWeightTargets(plan).map(target => target.id));
  const readings = value.readings.map((raw): UnitReading => {
    const row = object(raw);
    const targetId = id(row.targetId);
    const measuredAt = text(row.measuredAt, 24);
    if (!targets.has(targetId) || typeof row.kg !== "number" || !Number.isFinite(row.kg) || row.kg < 0 || row.kg > 10_000_000 ||
      !Number.isFinite(Date.parse(measuredAt)) || new Date(measuredAt).toISOString() !== measuredAt ||
      !Array.isArray(row.replaces) || row.replaces.length > 100) throw invalid();
    const replaces = row.replaces.map(id).sort();
    if (new Set(replaces).size !== replaces.length) throw invalid();
    return { id: id(row.id), targetId, kg: row.kg, measuredAt, source: text(row.source, 300), reference: text(row.reference, 300), replaces };
  });
  const byId = new Map(readings.map(row => [row.id, row]));
  if (byId.size !== readings.length) throw invalid();
  const waiting = new Map(readings.map(row => [row.id, row.replaces.length]));
  const successors = new Map<string, string[]>();
  const ready = readings.filter(row => !row.replaces.length).map(row => row.id);
  for (const row of readings) for (const parent of row.replaces) {
    if (byId.get(parent)?.targetId !== row.targetId) throw invalid();
    const children = successors.get(parent) ?? [];
    children.push(row.id);
    successors.set(parent, children);
  }
  for (let i = 0; i < ready.length; i++) for (const next of successors.get(ready[i]) ?? []) {
    const count = waiting.get(next)! - 1;
    waiting.set(next, count);
    if (!count) ready.push(next);
  }
  if (ready.length !== readings.length) throw invalid();
  return { ...base, readings: readings.sort((a, b) => a.id.localeCompare(b.id)) };
}

function activeReadings(records: UnitWeighing) {
  const replaced = new Set(records.readings.flatMap(reading => reading.replaces));
  const heads = new Map<string, UnitReading[]>();
  for (const reading of records.readings) if (!replaced.has(reading.id)) {
    const values = heads.get(reading.targetId) ?? [];
    values.push(reading);
    heads.set(reading.targetId, values);
  }
  return heads;
}

export function appendUnitReading(plan: PackingResult, current: UnitWeighing, input: Omit<UnitReading, "id" | "replaces">) {
  const existing = parseUnitWeighing(plan, JSON.stringify(current));
  const replaces = activeReadings(existing).get(input.targetId)?.map(reading => reading.id) ?? [];
  return parseUnitWeighing(plan, JSON.stringify({
    ...existing, readings: [...existing.readings, { ...input, id: `reading-${crypto.randomUUID()}`, replaces }],
  }));
}

export function mergeUnitWeighing(plan: PackingResult, a: UnitWeighing, b: UnitWeighing) {
  const left = parseUnitWeighing(plan, JSON.stringify(a));
  const right = parseUnitWeighing(plan, JSON.stringify(b));
  const readings = new Map(left.readings.map(row => [row.id, row]));
  for (const row of right.readings) {
    const existing = readings.get(row.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row))
      throw Error("相同核重记录编号存在内容冲突 / Conflicting content for the same weighing record");
    readings.set(row.id, row);
  }
  return parseUnitWeighing(plan, JSON.stringify({ ...left, readings: [...readings.values()] }));
}

export function reconcileUnitWeights(plan: PackingResult, records?: UnitWeighing) {
  const heads = activeReadings(records ? parseUnitWeighing(plan, JSON.stringify(records)) : emptyUnitWeighing(plan));
  const targets = unitWeightTargets(plan).map(target => {
    const readings = heads.get(target.id) ?? [];
    return { ...target, readings, actualKg: readings.length === 1 ? readings[0].kg : null };
  });
  const measured = targets.filter(target => target.actualKg !== null);
  const subtotalKg = measured.reduce((sum, target) => sum + target.actualKg!, 0);
  const complete = measured.length === targets.length;
  const plannedKg = plannedWeightBreakdown(plan).payloadKg;
  return {
    targets, measured: measured.length, conflicts: targets.filter(target => target.readings.length > 1).length,
    subtotalKg, actualKg: complete ? subtotalKg : null, plannedKg,
    differenceKg: complete ? subtotalKg - plannedKg : null,
    overloadKg: Math.max(0, subtotalKg - plan.container.maxWeight),
  };
}

export function reconcileFleetWeights(result: FleetResult, records: ReadonlyMap<string, UnitWeighing>) {
  const vehicles = result.loads.map(({ plan }, index) => {
    const current = deliveryIdentityState(plan) === "current";
    const report = current ? reconcileUnitWeights(plan, records.get(plan.deliveryIdentity!.revisionId)) : null;
    return { vehicle: index + 1, plan, report };
  });
  const plannedKg = vehicles.reduce((sum, row) => sum + row.plan.metrics.grossWeight, 0);
  const subtotalKg = vehicles.reduce((sum, row) => sum + (row.report?.subtotalKg ?? 0), 0);
  const complete = vehicles.length > 0 && vehicles.every(row => row.report && row.report.actualKg !== null);
  return { vehicles, plannedKg, subtotalKg, actualKg: complete ? subtotalKg : null, differenceKg: complete ? subtotalKg - plannedKg : null };
}

export function fleetWeightCsv(value: ReturnType<typeof reconcileFleetWeights>) {
  return [
    ["vehicle", "planId", "revisionId", "scopeId", "kind", "label", "cartons", "plannedKg", "acceptedKg", "readingId", "measuredAt", "source", "reference", "status"],
    ...value.vehicles.flatMap(({ vehicle, plan, report }) => {
      const columns = [vehicle, plan.deliveryIdentity?.planId, plan.deliveryIdentity?.revisionId];
      if (!report) return [[...columns, "", "vehicle", "", plan.placements.length, plan.metrics.grossWeight, "", "", "", "", "", "unissued"]];
      return report.targets.flatMap(target => {
        const prefix = [...columns, target.id, target.kind, target.label, target.cartons, target.plannedKg, target.actualKg];
        return target.readings.length
          ? target.readings.map(row => [...prefix, row.id, row.measuredAt, row.source, row.reference, target.readings.length === 1 ? "measured" : "conflict"])
          : [[...prefix, "", "", "", "", "pending"]];
      });
    }),
  ].map(row => row.map(toCsvCell).join(",")).join("\r\n");
}
