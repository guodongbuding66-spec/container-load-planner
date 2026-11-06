"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { deliveryIdentityState } from "../lib/packing/delivery-identity";
import { assertFieldRecordsContext, fieldRecordsKey, readVersionFieldRecords, type FieldRecords } from "../lib/packing/field-records";
import { fleetFieldCsv, fleetFieldLedger, issueFleetVehicle, routeFleetTicket } from "../lib/packing/fleet-field";
import {
  issuedFleetPlans, MAX_FLEET_FIELD_BYTES, mergeFleetFieldEvidence, parseFleetFieldPacket, serializeFleetFieldPacket, type FleetFieldEvidence,
} from "../lib/packing/fleet-field-backup";
import type { FleetSnapshot } from "../lib/packing/fleet-tail";
import { operationKey, parseOperationRecords, type OperationRecords } from "../lib/packing/operations";
import type { PackingRequest, PackingResult } from "../lib/packing/types";
import {
  fleetWeightCsv, mergeUnitWeighing, parseUnitWeighing, reconcileFleetWeights, unitWeighingKey, type UnitWeighing,
} from "../lib/packing/unit-weighing";
import { FieldJournalWorkspace } from "./field-journal-panel";
import { FleetReplacementPanel } from "./fleet-replacement-panel";
import { FleetUnitWeighing } from "./fleet-unit-weighing";
import { OperationsPanel } from "./operations-panel";
import { tr, useLanguage } from "./language";

type Evidence = Map<string, FleetFieldEvidence>;
type Props = { request: PackingRequest; value: FleetSnapshot | null; disabled: boolean; onApply: (value: FleetSnapshot, status: string) => void };

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function message(error: unknown) {
  const [zh, en] = (error instanceof Error ? error.message : String(error)).split(" / ");
  return tr(zh, en ?? zh);
}

function localEvidence(plan: PackingResult, storage: Pick<Storage, "getItem">): FleetFieldEvidence {
  const field = readVersionFieldRecords(plan.deliveryIdentity!, storage) ?? undefined;
  if (field) assertFieldRecordsContext(plan, field);
  const rawWeight = storage.getItem(unitWeighingKey(plan));
  const rawOps = storage.getItem(operationKey(plan));
  return {
    field, weight: rawWeight ? parseUnitWeighing(plan, rawWeight) : undefined,
    operations: rawOps ? parseOperationRecords(plan, rawOps) : undefined,
  };
}

function collect(value: FleetSnapshot, memory: Evidence) {
  const evidence = new Map(memory);
  const storage = { getItem(key: string) { try { return localStorage.getItem(key); } catch { return null; } } };
  for (const [id, plan] of issuedFleetPlans(value)) {
    evidence.set(id, mergeFleetFieldEvidence(plan, evidence.get(id) ?? {}, localEvidence(plan, storage)));
  }
  return evidence;
}

function saveEvidence(plan: PackingResult, evidence: FleetFieldEvidence) {
  try {
    if (evidence.field) localStorage.setItem(fieldRecordsKey(plan.deliveryIdentity!), JSON.stringify(evidence.field));
    if (evidence.weight) localStorage.setItem(unitWeighingKey(plan), JSON.stringify(evidence.weight));
    if (evidence.operations) localStorage.setItem(operationKey(plan), JSON.stringify(evidence.operations));
    return true;
  } catch { return false; }
}

export function FleetFieldPanel(props: Props) {
  useLanguage();
  const [opened, setOpened] = useState(false);
  return <details className="upgrade-panel" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>{tr("跨柜实物台账与现场交接", "Fleet unit ledger and field handoff")}</summary>
    {opened && <FleetFieldWorkspace {...props} />}
  </details>;
}

function FleetFieldWorkspace({ request, value, disabled, onApply }: Props) {
  const language = useLanguage();
  const [initial] = useState(() => {
    try { return { evidence: value ? collect(value, new Map()) : new Map() as Evidence, status: "" }; }
    catch (error) { return { evidence: new Map() as Evidence, status: message(error) }; }
  });
  const [evidence, setEvidence] = useState(initial.evidence);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState(initial.status);
  const [ticket, setTicket] = useState("");
  const [route, setRoute] = useState<{ revisionId: string; ticket: string; sequence: number }>();
  const [journalOpen, setJournalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const source = useRef({ request, value, disabled });
  useLayoutEffect(() => {
    source.current = { request, value, disabled };
    return () => { source.current = { request, value, disabled: true }; };
  }, [request, value, disabled]);

  const result = value?.result;
  const plan = result?.loads[selected]?.plan ?? result?.loads[0]?.plan;
  const identity = plan && deliveryIdentityState(plan) === "current" ? plan.deliveryIdentity : undefined;
  const fields = useMemo(() => new Map([...evidence].flatMap(([id, row]) => row.field ? [[id, row.field] as const] : [])), [evidence]);
  const weights = useMemo(() => new Map([...evidence].flatMap(([id, row]) => row.weight ? [[id, row.weight] as const] : [])), [evidence]);
  const ledger = useMemo(() => result ? fleetFieldLedger(result, fields) : [], [result, fields]);
  const balance = useMemo(() => result ? reconcileFleetWeights(result, weights) : undefined, [result, weights]);
  const byVehicle = useMemo(() => {
    const totals = new Map<number, { loaded: number; missing: number; damaged: number; conflicts: number }>();
    for (const row of ledger) {
      const count = totals.get(row.vehicle) ?? { loaded: 0, missing: 0, damaged: 0, conflicts: 0 };
      if (row.kind === "carton") {
        if (row.state === "loaded") count.loaded++;
        if (row.condition === "missing") count.missing++;
        if (row.condition === "damaged") count.damaged++;
        if (row.state === "conflict") count.conflicts++;
      }
      totals.set(row.vehicle, count);
    }
    return totals;
  }, [ledger]);

  const update = useCallback((id: string, patch: FleetFieldEvidence) => {
    setEvidence(previous => new Map(previous).set(id, { ...previous.get(id), ...patch }));
  }, []);
  const onField = useCallback((field: FieldRecords) => update(field.current.context.revisionId, { field }), [update]);
  const onOperations = useCallback((_key: string, operations: OperationRecords) => update(operations.context.revisionId, { operations }), [update]);
  const getField = (p: PackingResult) => evidence.get(p.deliveryIdentity!.revisionId)?.field;

  function saveWeight(weight: UnitWeighing) {
    if (!plan || disabled || busy) return false;
    let merged = weight;
    try {
      const raw = localStorage.getItem(unitWeighingKey(plan));
      if (raw) merged = mergeUnitWeighing(plan, weight, parseUnitWeighing(plan, raw));
    } catch {
      update(weight.context.revisionId, { weight });
      return false;
    }
    update(merged.context.revisionId, { weight: merged });
    return saveEvidence(plan, { weight: merged });
  }

  function issue() {
    if (!value || !plan || disabled || busy) return;
    try {
      const next = issueFleetVehicle(value, value.result.loads.findIndex(load => load.plan === plan));
      onApply(next, tr("已登记柜交付版本，请保存多柜交接备份。", "Vehicle delivery revision issued. Save a fleet handoff backup."));
      setStatus(tr("已登记交付版本。现场装载仍需逐件确认。", "Delivery revision issued. Confirm physical loading by unit."));
    } catch (error) { setStatus(message(error)); }
  }

  function routeScan() {
    if (!result || disabled || busy) return;
    try {
      const index = routeFleetTicket(result, ticket);
      const revisionId = result.loads[index].plan.deliveryIdentity!.revisionId;
      setSelected(index);
      setRoute(previous => ({ revisionId, ticket, sequence: (previous?.sequence ?? 0) + 1 }));
      setJournalOpen(true);
      setStatus(tr("二维码已定位至对应柜及版本，请核对后登记。", "The QR code matched its vehicle and revision. Review before recording."));
    } catch (error) { setStatus(message(error)); }
  }

  function exportPacket() {
    if (!value) return;
    try {
      let current = evidence, cached = true;
      try { current = collect(value, evidence); } catch { cached = false; }
      download("fleet-field-handoff.json", serializeFleetFieldPacket(value, current), "application/json");
      setStatus(cached ? tr("已发起完整多柜交接备份下载。", "Full fleet handoff backup download started.") :
        tr("本机有无法合并的记录，本次备份仅含本页可验证的记录。", "Some local records could not merge. This backup includes verified records on the page."));
    } catch (error) { setStatus(message(error)); }
  }

  async function restore(file: File) {
    if (disabled || busy) return;
    setBusy(true);
    try {
      if (file.size > MAX_FLEET_FIELD_BYTES) throw Error(tr("交接文件超过 64 MB。", "Handoff exceeds 64 MB."));
      const contents = await file.text();
      if (source.current.disabled || source.current.value !== value || source.current.request !== request)
        throw Error(tr("订单或方案已变化，请重新导入。", "The order or plan changed. Import the file again."));
      const imported = parseFleetFieldPacket(contents, request);
      const plans = issuedFleetPlans(imported.fleet);
      if (value) for (const [id, issued] of issuedFleetPlans(value)) {
        const incoming = plans.get(id);
        if (!incoming || incoming.deliveryIdentity!.signature !== issued.deliveryIdentity!.signature)
          throw Error(tr("交接备份不能覆盖当前已登记柜。", "The handoff cannot replace currently issued vehicles."));
      }
      const next = collect(imported.fleet, evidence);
      for (const [id, row] of imported.evidence) {
        next.set(id, mergeFleetFieldEvidence(plans.get(id)!, next.get(id) ?? {}, row));
      }
      let saved = true;
      for (const [id, issued] of plans) saved = saveEvidence(issued, next.get(id) ?? {}) && saved;
      setEvidence(next);
      setEpoch(value => value + 1);
      setRoute(undefined);
      setSelected(0);
      onApply(imported.fleet, tr("多柜交接文件已通过校验并恢复。", "Fleet handoff validated and restored."));
      setStatus(saved ? tr("交接已恢复，同版本记录已合并。", "Handoff restored and same-revision records merged.") :
        tr("交接已恢复到本页，本机存储写入不完整，请保存备份。", "Handoff restored on this page. Local storage was incomplete; save a backup."));
    } catch (error) { setStatus(message(error)); }
    finally { setBusy(false); }
  }

  const fmt = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString(language, { maximumFractionDigits: 3 });
  const locked = disabled || busy;
  return <div className="upgrade-body">
    <p>{tr("交付版本绑定原柜坐标和唯一箱托编号。交接 JSON 包含多柜方案和已登记版本的现场、逐件核重及作业记录，可跨浏览器手动恢复。", "Issued revisions bind vehicle coordinates to unique unit IDs. The handoff JSON carries the fleet plan and issued field, unit weighing and operation records for manual transfer between browsers.")}</p>
    <div className="upgrade-actions">
      <button className="button" disabled={locked || !value} onClick={exportPacket}>{tr("下载多柜交接备份", "Download fleet handoff backup")}</button>
      <button className="button" disabled={locked} onClick={() => input.current?.click()}>{tr("恢复多柜交接备份", "Restore fleet handoff backup")}</button>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void restore(file);
      }} />
      <button className="button" disabled={!ledger.length} onClick={() => download("fleet-unit-ledger.csv", fleetFieldCsv(ledger), "text/csv;charset=utf-8")}>{tr("导出跨柜实物台账 CSV", "Export fleet unit ledger CSV")}</button>
      <button className="button" disabled={!balance} onClick={() => { if (balance) download("fleet-unit-weighing.csv", fleetWeightCsv(balance), "text/csv;charset=utf-8"); }}>{tr("导出跨柜核重 CSV", "Export fleet weighing CSV")}</button>
    </div>
    <p role="status">{status}</p>
    {balance && <div className="upgrade-table-wrap">
      <table>
        <caption>{tr("跨柜装载与核重", "Fleet loading and weighing")}</caption>
        <thead><tr>{[
          tr("柜号", "Vehicle"), tr("交付版本", "Delivery revision"), tr("计划箱", "Planned cartons"),
          tr("已确认箱", "Confirmed cartons"), tr("缺箱／损伤／冲突", "Missing / damaged / conflicts"),
          tr("计划 kg", "Planned kg"), tr("已核小计 kg", "Measured subtotal kg"), tr("完整实称 kg", "Complete actual kg"),
        ].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{balance.vehicles.map(row => {
          const counts = byVehicle.get(row.vehicle);
          const id = row.plan.deliveryIdentity;
          return <tr key={row.vehicle}>
            <th scope="row">{row.vehicle} · {tr(row.plan.container.name)}</th>
            <td>{id ? `v${id.revision} · ${id.revisionId.slice(-12)}` : tr("未登记", "Unissued")}</td>
            <td>{row.plan.placements.length}</td><td>{counts?.loaded ?? "—"}</td>
            <td>{counts ? `${counts.missing} / ${counts.damaged} / ${counts.conflicts}` : "—"}</td>
            <td>{fmt(row.plan.metrics.grossWeight)}</td><td>{fmt(row.report?.subtotalKg)}</td><td>{fmt(row.report?.actualKg)}</td>
          </tr>;
        })}</tbody>
      </table>
      <p>{tr("整单计划", "Fleet planned")} {fmt(balance.plannedKg)} kg · {tr("实称小计", "Measured subtotal")} {fmt(balance.subtotalKg)} kg · {tr("完整实称", "Complete actual")} {fmt(balance.actualKg)} kg · {tr("差额", "Difference")} {fmt(balance.differenceKg)} kg</p>
    </div>}
    {result?.loads.length ? <>
      <label>{tr("现场作业柜", "Field vehicle")}<select value={result.loads[selected] ? selected : 0} onChange={event => { setSelected(Number(event.target.value)); setRoute(undefined); }}>
        {result.loads.map((load, index) => <option key={index} value={index}>{index + 1} · {tr(load.plan.container.name)}</option>)}
      </select></label>
      {!plan?.deliveryIdentity && <button className="button primary" disabled={locked} onClick={issue}>{tr("登记此柜交付版本", "Issue this vehicle revision")}</button>}
      <label>{tr("跨柜二维码内容或链接", "Fleet QR content or link")}<input maxLength={4096} value={ticket} onChange={event => setTicket(event.target.value)} /></label>
      <button className="button" disabled={locked || !ticket.trim()} onClick={routeScan}>{tr("定位扫码柜及实物", "Locate scanned vehicle and unit")}</button>
    </> : null}
    {identity && plan && <>
      <details open={journalOpen} onToggle={event => setJournalOpen(event.currentTarget.open)}>
        <summary>{tr("当前柜扫码与现场记录", "Current vehicle scanning and field records")}</summary>
        {journalOpen && <FieldJournalWorkspace key={`${identity.revisionId}/${epoch}/${route?.sequence ?? 0}`} plan={plan} disabled={locked}
          initialTicket={route?.revisionId === identity.revisionId ? route.ticket : undefined} getRecords={getField} onRecords={onField} />}
      </details>
      <FleetUnitWeighing key={identity.revisionId} plan={plan} records={evidence.get(identity.revisionId)?.weight} disabled={locked} onSave={saveWeight} />
      <OperationsPanel key={`${identity.revisionId}/${epoch}`} plan={plan} disabled={locked}
        getRecords={() => evidence.get(identity.revisionId)?.operations} onRecords={onOperations} />
    </>}
    {value && <FleetReplacementPanel value={value} disabled={locked} onApply={next =>
      onApply(next, tr("余货替代方案已采用。", "Remainder replacement adopted."))} />}
  </div>;
}
