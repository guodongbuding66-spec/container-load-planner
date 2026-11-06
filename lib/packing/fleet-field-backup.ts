import { deliveryIdentityState } from "./delivery-identity";
import { assertFieldRecordsContext, mergeFieldRecords, parseFieldRecords, type FieldRecords } from "./field-records";
import { parseFleetBackup, serializeFleetBackup, type FleetBackup } from "./fleet-file";
import type { FleetSnapshot } from "./fleet-tail";
import { mergeOperationRecords, parseOperationRecords, type OperationRecords } from "./operations";
import type { PackingRequest, PackingResult } from "./types";
import { mergeUnitWeighing, parseUnitWeighing, type UnitWeighing } from "./unit-weighing";

export type FleetFieldEvidence = { field?: FieldRecords; weight?: UnitWeighing; operations?: OperationRecords };
export type FleetFieldPacket = { fleet: FleetBackup; evidence: Map<string, FleetFieldEvidence> };
export const MAX_FLEET_FIELD_BYTES = 64 * 1024 * 1024;
const invalid = () => new Error("多柜交接文件无效或版本不匹配 / Invalid fleet handoff file or revision mismatch");

export function issuedFleetPlans(value: FleetSnapshot) {
  const plans = new Map<string, PackingResult>();
  for (const { plan } of value.result.loads) if (deliveryIdentityState(plan) === "current") {
    plans.set(plan.deliveryIdentity!.revisionId, plan);
  }
  return plans;
}

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  return raw as Record<string, unknown>;
}

export function parseFleetFieldPacket(contents: string, expected?: PackingRequest): FleetFieldPacket {
  if (new TextEncoder().encode(contents).length > MAX_FLEET_FIELD_BYTES) throw invalid();
  const raw = record(JSON.parse(contents));
  if (raw.format !== "cargo-fit-fleet-field" || raw.version !== 1 || !Array.isArray(raw.evidence) || raw.evidence.length > 50) throw invalid();
  const fleet = parseFleetBackup(JSON.stringify(raw.fleet), expected);
  const plans = issuedFleetPlans(fleet);
  const evidence = new Map<string, FleetFieldEvidence>();
  for (const item of raw.evidence) {
    const row = record(item);
    if (typeof row.revisionId !== "string" || evidence.has(row.revisionId)) throw invalid();
    const plan = plans.get(row.revisionId);
    if (!plan) throw invalid();
    const field = row.field === undefined ? undefined : parseFieldRecords(JSON.stringify(row.field));
    if (field) assertFieldRecordsContext(plan, field);
    const weight = row.weight === undefined ? undefined : parseUnitWeighing(plan, JSON.stringify(row.weight));
    const operations = row.operations === undefined ? undefined : parseOperationRecords(plan, JSON.stringify(row.operations));
    if (!field && !weight && !operations) throw invalid();
    evidence.set(row.revisionId, { field, weight, operations });
  }
  return { fleet, evidence };
}

export function serializeFleetFieldPacket(value: FleetSnapshot, evidence: ReadonlyMap<string, FleetFieldEvidence>) {
  const fleet = JSON.parse(serializeFleetBackup(value)) as FleetBackup;
  const rows = [...issuedFleetPlans(fleet).keys()].flatMap(revisionId => {
    const row = evidence.get(revisionId);
    return row && (row.field || row.weight || row.operations) ? [{ revisionId, ...row }] : [];
  });
  const contents = JSON.stringify({ format: "cargo-fit-fleet-field", version: 1, fleet, evidence: rows });
  parseFleetFieldPacket(contents, value.request);
  return contents;
}

export function mergeFleetFieldEvidence(plan: PackingResult, left: FleetFieldEvidence, right: FleetFieldEvidence): FleetFieldEvidence {
  return {
    field: left.field && right.field ? mergeFieldRecords(plan, left.field, right.field) : left.field ?? right.field,
    weight: left.weight && right.weight ? mergeUnitWeighing(plan, left.weight, right.weight) : left.weight ?? right.weight,
    operations: left.operations && right.operations ? mergeOperationRecords(plan, left.operations, right.operations) : left.operations ?? right.operations,
  };
}
