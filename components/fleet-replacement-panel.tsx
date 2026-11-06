"use client";

import { useEffect, useRef, useState } from "react";
import type { FleetAllocationRestriction, FleetResult } from "../lib/packing/fleet";
import { retainedFleetPrefix, validateFieldReplacement } from "../lib/packing/fleet-field";
import type { FleetSnapshot } from "../lib/packing/fleet-tail";
import { tr, useLanguage } from "./language";

type Props = { value: FleetSnapshot; disabled: boolean; onApply: (result: FleetSnapshot) => void };
type Preview = { source: FleetSnapshot; restriction: FleetAllocationRestriction; result: FleetResult; canAdopt: boolean };
function message(error: unknown) {
  const [zh, en] = (error instanceof Error ? error.message : String(error)).split(" / ");
  return tr(zh, en ?? zh);
}

export function FleetReplacementPanel({ value, disabled, onApply }: Props) {
  useLanguage();
  const [vehicleId, setVehicleId] = useState("");
  const [packaging, setPackaging] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const job = useRef<{ worker: Worker; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => () => {
    if (job.current) {
      job.current.worker.terminate();
      clearTimeout(job.current.timer);
      job.current = null;
    }
  }, []);
  const prefix = retainedFleetPrefix(value.result);
  const remaining = value.result.remaining.reduce((sum, row) => sum + row.quantity, 0);
  const current = preview?.source === value && preview.restriction.vehicleId === (vehicleId || undefined) &&
    preview.restriction.unavailablePackaging === (packaging || undefined) ? preview : undefined;
  const canStart = !disabled && !running && (prefix < value.result.loads.length || remaining > 0) && !!(vehicleId || packaging);

  function finish() {
    if (!job.current) return;
    job.current.worker.terminate();
    clearTimeout(job.current.timer);
    job.current = null;
    setRunning(false);
  }
  function run() {
    if (!canStart || job.current) return;
    setPreview(undefined);
    setStatus("");
    const restriction = { vehicleId: vehicleId || undefined, unavailablePackaging: packaging || undefined };
    try {
      const worker = new Worker(new URL("../lib/packing/fleet-field.worker.ts", import.meta.url), { type: "module" });
      setRunning(true);
      const timer = setTimeout(() => {
        finish();
        setStatus(tr("替代试算超时，已保留当前方案。", "Replacement preview timed out. The current plan was retained."));
      }, 90_000);
      job.current = { worker, timer };
      worker.onmessage = ({ data }: MessageEvent<{ result?: FleetResult; error?: string }>) => {
        if (job.current?.worker !== worker) return;
        finish();
        try {
          if (!data.result) throw Error(data.error ?? "Replacement preview failed");
          const { canAdopt } = validateFieldReplacement(value, restriction, data.result);
          setPreview({ source: value, restriction, result: data.result, canAdopt });
        } catch (error) { setStatus(message(error)); }
      };
      worker.onerror = () => {
        if (job.current?.worker !== worker) return;
        finish();
        setStatus(tr("替代试算失败，当前方案已保留。", "Replacement preview failed. The current plan was retained."));
      };
      worker.postMessage({ value, restriction });
    } catch (error) {
      finish();
      setStatus(message(error));
    }
  }
  function apply() {
    if (disabled || !current?.canAdopt) return;
    try {
      if (!validateFieldReplacement(value, current.restriction, current.result).canAdopt) return;
      onApply({ ...value, result: current.result });
      setPreview(undefined);
      setStatus(tr("已采用余货替代方案，保留柜及其现场记录未变。", "Replacement adopted. Retained vehicles and their field records are intact."));
    } catch (error) { setStatus(message(error)); }
  }

  return <details className="upgrade-panel">
    <summary>{tr("换柜与缺货包装替代", "Vehicle and packaging replacement")}</summary>
    <div className="upgrade-body">
      <p>{tr("试算保留前缀内已登记、锁定或实测的柜。仅对后续余货限制柜型或排除缺货包装，采用后保留原报价和库存主数据。", "The preview retains the prefix containing issued, locked or measured vehicles. Vehicle restrictions and packaging shortages apply to the new remainder only. Adoption preserves the source quotes and stock data.")}</p>
      <p>{tr("保留柜数", "Retained vehicles")} {prefix} / {value.result.loads.length}</p>
      <fieldset disabled={disabled || running} className="upgrade-rule-grid">
        <legend>{tr("本次替代试算", "Replacement preview settings")}</legend>
        <label>{tr("后续仅用柜型", "Vehicle type for remainder")}
          <select value={vehicleId} onChange={event => { setVehicleId(event.target.value); setPreview(undefined); }}>
            <option value="">{tr("沿用可用柜型", "Use all verified types")}</option>
            {value.options.map(option => <option key={option.container.id} value={option.container.id}>{tr(option.container.name)}</option>)}
          </select>
        </label>
        {value.result.inventory && <label>{tr("后续缺货包装", "Unavailable packaging for remainder")}
          <select value={packaging} onChange={event => { setPackaging(event.target.value); setPreview(undefined); }}>
            <option value="">{tr("无额外缺货", "No additional shortage")}</option>
            {value.result.inventory.packages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
      </fieldset>
      <div className="upgrade-actions">
        <button className="button" disabled={!canStart} onClick={run}>{tr("预览余货替代", "Preview remainder replacement")}</button>
        {running && <button className="button" onClick={finish}>{tr("取消试算", "Cancel preview")}</button>}
        {current && <button className="button primary" disabled={disabled || !current.canAdopt} onClick={apply}>{tr("采用余货替代方案", "Adopt remainder replacement")}</button>}
      </div>
      <p role="status">{running ? tr("正在试算余货…", "Planning the remainder…") : status}</p>
      {current && <div>
        <p>{tr("柜数", "Vehicles")} {value.result.loads.length} → {current.result.loads.length} · {tr("未分配箱数", "Unallocated cartons")} {remaining} → {current.result.remaining.reduce((sum, row) => sum + row.quantity, 0)}</p>
        <p>{tr("配置费用", "Configured total")} {value.result.costs?.total ?? "—"} → {current.result.costs?.total ?? "—"} {value.pricing?.currency}</p>
        {current.result.remaining.some(row => row.quantity > (value.result.remaining.find(old => old.id === row.id)?.quantity ?? 0)) &&
          <p role="alert">{tr("至少一条订单行减量，不能采用。", "At least one order row loses cartons. Adoption is blocked.")}</p>}
      </div>}
    </div>
  </details>;
}
