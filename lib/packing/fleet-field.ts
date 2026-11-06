import { toCsvCell } from "./csv";
import { deliveryIdentityState, deliveryUnitBindings, issueDeliveryIdentity } from "./delivery-identity";
import { analyzeFieldJournal, parseUnitTicket, verifyUnitTicket } from "./field-journal";
import { assertFieldRecordsContext, type FieldRecords } from "./field-records";
import { allocateFleet, type FleetAllocationRestriction, type FleetResult } from "./fleet";
import { parseFleetBackup, serializeFleetBackup } from "./fleet-file";
import { fleetCanonical, validateFleet } from "./fleet-validation";
import { palletSpecifications } from "./pallet-specifications";
import { parsePalletBuild } from "./loading-workflow";
import type { FleetSnapshot } from "./fleet-tail";

export function retainedFleetPrefix(result: FleetResult) {
  return result.loads.findLastIndex(({ plan, frozen }) =>
    frozen !== undefined || plan.deliveryIdentity !== undefined ||
    plan.placements.some(box => box.locked) || plan.pallets?.some(pallet => pallet.locked || pallet.measuredEnvelope)
  ) + 1;
}

/** Issuing a vehicle binds its existing coordinates and identifiers without recording any physical loading. */
export function issueFleetVehicle(value: FleetSnapshot, index: number): FleetSnapshot {
  const source = parseFleetBackup(serializeFleetBackup(value));
  const loads = [...source.result.loads];
  const load = loads[index];
  if (!Number.isInteger(index) || !load) throw Error("选择有效柜号 / Select a valid vehicle");
  if (load.plan.deliveryIdentity) throw Error("该柜已有交付版本 / This vehicle already has a delivery revision");
  loads[index] = { ...load, plan: issueDeliveryIdentity(load.plan) };
  const next = { ...value, result: { ...value.result, loads } };
  serializeFleetBackup(next);
  return next;
}

/** Resolve a pasted QR code against the exact issued vehicle and revision. */
export function routeFleetTicket(result: FleetResult, text: string) {
  const ticket = parseUnitTicket(text);
  const index = result.loads.findIndex(load => load.plan.deliveryIdentity?.planId === ticket.planId);
  if (index < 0) throw Error("二维码不属于当前多柜计划 / This QR code belongs to another fleet plan");
  verifyUnitTicket(result.loads[index].plan, text);
  return index;
}

export function fleetFieldLedger(result: FleetResult, records: ReadonlyMap<string, FieldRecords>) {
  return result.loads.flatMap(({ plan }, index) => {
    const identity = plan.deliveryIdentity;
    if (!identity || deliveryIdentityState(plan) !== "current") return [];
    const record = records.get(identity.revisionId);
    if (record) assertFieldRecordsContext(plan, record);
    const states = record ? analyzeFieldJournal(record.current) : undefined;
    const boxes = new Map(plan.placements.map(box => [box.id, box]));
    const palletIds = new Map(identity.units.filter(unit => unit.kind === "pallet").map(unit => [unit.localId, unit.unitId]));
    return deliveryUnitBindings(plan).map(unit => {
      const observed = states?.get(unit.unitId!);
      const condition = observed?.state?.condition;
      const state = observed && !observed.state ? "conflict"
        : observed?.state?.loaded ? "loaded"
          : condition && condition !== "none" ? condition : "pending";
      const box = boxes.get(unit.localId);
      const orderLine = box ? plan.cargoDetails?.[box.productId]?.orderLine : undefined;
      return {
        vehicle: index + 1, planId: identity.planId, revision: identity.revision, revisionId: identity.revisionId,
        unitId: unit.unitId!, localId: unit.localId, kind: unit.kind, sourceId: unit.sourceId, label: unit.label,
        customer: orderLine?.customer ?? "", batch: orderLine?.batch ?? "",
        orderReference: orderLine?.orderReference ?? "", lineReference: orderLine?.lineReference ?? "",
        destination: orderLine?.destination ?? "", stop: orderLine?.stop,
        kit: box?.setCode ?? "", kitNumber: box?.setNumber,
        pallets: box?.palletIds?.map(id => palletIds.get(id) ?? "").filter(Boolean).join(" ") ?? "",
        state, condition: condition ?? "",
      };
    });
  });
}

export function fleetFieldCsv(ledger: ReturnType<typeof fleetFieldLedger>) {
  return [
    ["vehicle", "planId", "revision", "revisionId", "unitId", "localId", "kind", "sourceId", "label", "customer", "batch", "orderReference", "lineReference", "destination", "stop", "kit", "kitNumber", "palletIds", "state", "condition"],
    ...ledger.map(row => [row.vehicle, row.planId, row.revision, row.revisionId, row.unitId, row.localId, row.kind, row.sourceId, row.label, row.customer, row.batch, row.orderReference, row.lineReference, row.destination, row.stop, row.kit, row.kitNumber, row.pallets, row.state, row.condition]),
  ].map(row => row.map(toCsvCell).join(",")).join("\r\n");
}

export function validateFieldReplacement(value: FleetSnapshot, restriction: FleetAllocationRestriction, result: FleetResult) {
  const prefix = retainedFleetPrefix(value.result);
  const previous = value.result.loads.slice(0, prefix);
  if (fleetCanonical(result.loads.slice(0, prefix)) !== fleetCanonical(previous))
    throw Error("替代方案修改了已保留柜 / Replacement changed a retained vehicle");
  if (fleetCanonical(result.pricing) !== fleetCanonical(value.pricing))
    throw Error("替代方案改动了报价 / Replacement changed the quotes");
  for (const load of result.loads.slice(prefix)) {
    if (load.frozen || load.plan.deliveryIdentity || load.plan.placements.some(box => box.locked) ||
      load.plan.pallets?.some(pallet => pallet.locked || pallet.measuredEnvelope))
      throw Error("替代方案不能新增现场状态 / Replacement cannot add field state");
    if (restriction.vehicleId && load.plan.container.id !== restriction.vehicleId)
      throw Error("替代方案使用了其他柜型 / Replacement used a different vehicle");
    if (restriction.unavailablePackaging && load.plan.pallets?.some(pallet => (pallet.specificationId ?? "primary") === restriction.unavailablePackaging))
      throw Error("替代方案使用了缺货包装 / Replacement used unavailable packaging");
  }
  const valid = validateFleet(value.request, result, value.options, value.limit);
  if (!valid.valid) throw Error(valid.errors.join("; "));
  const before = new Map(value.result.remaining.map(row => [row.id, row.quantity]));
  return { prefix, canAdopt: result.remaining.every(row => row.quantity <= (before.get(row.id) ?? -1)) };
}

export function previewFieldReplacement(value: FleetSnapshot, restriction: FleetAllocationRestriction) {
  const source = parseFleetBackup(serializeFleetBackup(value));
  if (!restriction.vehicleId && !restriction.unavailablePackaging)
    throw Error("请指定替代柜型或缺货包装 / Select a replacement vehicle or unavailable packaging");
  if (restriction.vehicleId && !source.options.some(option => option.container.id === restriction.vehicleId))
    throw Error("替代柜型需在已验证候选内 / Select a vehicle in the verified options");
  if (restriction.unavailablePackaging && (source.request.workflow !== "palletized" ||
    !palletSpecifications(parsePalletBuild(source.request.palletBuild)).some(spec => spec.id === restriction.unavailablePackaging)))
    throw Error("缺货包装需为订单内已登记规格 / Select a packaging specification from the order");
  if (source.limit > 20 || source.request.products.reduce((total, row) => total + row.quantity, 0) > 4000)
    throw Error("替代试算限 20 柜和 4,000 箱 / Replacement preview is limited to 20 vehicles and 4,000 cartons");
  const prefix = retainedFleetPrefix(source.result);
  const result = allocateFleet(source.request, source.options, source.limit, source.objective, undefined, source.pricing,
    source.result.loads.slice(0, prefix), restriction);
  validateFieldReplacement(source, restriction, result);
  return result;
}
