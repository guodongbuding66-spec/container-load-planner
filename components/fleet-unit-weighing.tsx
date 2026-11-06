"use client";

import { useMemo, useState, type FormEvent } from "react";
import { appendUnitReading, emptyUnitWeighing, reconcileUnitWeights, type UnitWeighing } from "../lib/packing/unit-weighing";
import type { PackingResult } from "../lib/packing/types";
import { tr, useLanguage } from "./language";

type Props = { plan: PackingResult; records?: UnitWeighing; disabled: boolean; onSave: (records: UnitWeighing) => boolean };
const kinds = {
  carton: ["散箱毛重", "Carton gross"],
  "pallet-gross": ["整托／木箱毛重", "Loaded pallet / crate gross"],
  "pallet-tare": ["底座自重", "Base tare"],
  materials: ["固定材料合计", "Installed materials"],
} as const;

export function FleetUnitWeighing({ plan, records, disabled, onSave }: Props) {
  const language = useLanguage();
  const [filter, setFilter] = useState("");
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState("");
  const report = useMemo(() => reconcileUnitWeights(plan, records), [plan, records]);
  const selected = report.targets.find(target => target.id === targetId);
  const visible = report.targets.filter(target => `${target.label} ${target.id}`.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 80);
  const fmt = (kg: number | null) => kg === null ? "—" : kg.toLocaleString(language, { maximumFractionDigits: 3 });
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || disabled) return;
    try {
      const data = new FormData(event.currentTarget);
      const kg = String(data.get("kg") ?? "").trim();
      const measuredAt = new Date(String(data.get("time") ?? ""));
      if (!kg || !Number.isFinite(measuredAt.getTime())) throw Error(tr("请录入有效读数及实称时间。", "Enter a valid reading and measurement time."));
      if (selected.readings.length && data.get("resolve") !== "on")
        throw Error(tr("请确认本次重称取代所见读数。", "Confirm that this reweigh supersedes the displayed readings."));
      const stored = onSave(appendUnitReading(plan, records ?? emptyUnitWeighing(plan), {
        targetId, kg: Number(kg), measuredAt: measuredAt.toISOString(),
        source: String(data.get("source") ?? ""), reference: String(data.get("reference") ?? ""),
      }));
      event.currentTarget.reset();
      setStatus(stored ? tr("逐件核重已登记。", "Unit weighing recorded.") :
        tr("记录留在本页，本机存储写入失败，请下载交接备份。", "Reading retained on this page. Local storage failed; download a handoff backup."));
    } catch (error) {
      const [zh, en] = (error instanceof Error ? error.message : String(error)).split(" / ");
      setStatus(tr(zh, en ?? zh));
    }
  }

  return <section aria-label={tr("逐件实际核重", "Actual weighing by unit")}>
    <h4>{tr("逐件实际核重", "Actual weighing by unit")}</h4>
    <p>{tr("整托毛重含托内箱和包装。散箱与独立底座分开核重。缺读数或并行冲突时只显示已核小计。", "Loaded-unit gross includes its cartons and packaging. Weigh loose cartons and separate bases independently. Missing or conflicting readings leave the total open.")}</p>
    <p>{tr("有效读数", "Accepted readings")} {report.measured} / {report.targets.length} · {tr("计划", "Planned")} {fmt(report.plannedKg)} kg · {tr("已核小计", "Measured subtotal")} {fmt(report.subtotalKg)} kg · {tr("完整实称", "Complete actual")} {fmt(report.actualKg)} kg</p>
    {!!report.conflicts && <p role="alert">{tr("并行读数待重称", "Concurrent readings need reweighing")} {report.conflicts}</p>}
    {!!report.overloadKg && <p role="alert">{tr("已核重量超过额定载重至少", "Measured subtotal exceeds payload rating by at least")} {fmt(report.overloadKg)} kg</p>}
    <label>{tr("搜索称重编号或名称", "Find a weighing ID or name")}<input value={filter} maxLength={120} onChange={event => setFilter(event.target.value)} /></label>
    <label>{tr("称重对象", "Weighing target")}<select value={targetId} onChange={event => { setTargetId(event.target.value); setStatus(""); }}>
      <option value="">{tr("请选择", "Select")}</option>
      {selected && !visible.includes(selected) && <option value={selected.id}>{selected.label} · {selected.id}</option>}
      {visible.map(target => <option key={target.id} value={target.id}>{target.kind === "materials" ? tr(...kinds.materials) : target.label} · {target.id}</option>)}
    </select></label>
    {selected && <form key={selected.id} onSubmit={save}>
      <p>{tr(kinds[selected.kind][0], kinds[selected.kind][1])} · {tr("计划重量", "Planned weight")} {fmt(selected.plannedKg)} kg</p>
      {!!selected.readings.length && <ul>{selected.readings.map(row => <li key={row.id}>{fmt(row.kg)} kg · {row.source} · {row.reference} · {row.measuredAt}</li>)}</ul>}
      <fieldset disabled={disabled} className="upgrade-rule-grid">
        <legend>{tr("人工登记实称", "Enter a manual scale reading")}</legend>
        <label>{tr("实称 kg", "Measured kg")}<input name="kg" type="number" min="0" max="10000000" step="any" required /></label>
        <label>{tr("实称时间", "Measurement time")}<input name="time" type="datetime-local" required /></label>
        <label>{tr("秤具或数据来源", "Scale or data source")}<input name="source" maxLength={300} required /></label>
        <label>{tr("磅单或复核凭证号", "Ticket or evidence reference")}<input name="reference" maxLength={300} required /></label>
        {!!selected.readings.length && <label><input name="resolve" type="checkbox" required />{tr("以本次重称取代所见读数，保留历史", "Supersede the displayed readings and keep their history")}</label>}
        <button className="button" type="submit">{tr("登记逐件核重", "Record unit weighing")}</button>
      </fieldset>
    </form>}
    <p role="status">{status}</p>
  </section>;
}
