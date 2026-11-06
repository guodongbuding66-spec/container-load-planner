"use client";

import { useState, type FormEvent } from "react";
import { accessoryRegions } from "../lib/packing/container-accessories";
import {
  fieldReadinessReport, reviewMoistureBudget, reviewShippingMark, type MarkInput, type MoistureInput,
} from "../lib/packing/field-readiness";
import type { WallSide } from "../lib/packing/inspection";
import type { PackingResult } from "../lib/packing/types";
import { tr, useLanguage } from "./language";

const markStates = {
  clear: ["达到录入读标净距", "Meets entered label clearance"],
  obstructed: ["净距不足，需现场复核", "Insufficient clearance; review on site"],
  unsupported: ["外形或封闭包装需现场复核", "Geometry or closed packaging requires on-site review"],
  "does-not-fit": ["居中唛头超出所选实体面", "Centred mark does not fit the selected face"],
} as const;

export function FieldReadiness({ plan, disabled }: { plan: PackingResult; disabled: boolean }) {
  const language = useLanguage();
  const [filter, setFilter] = useState("");
  const [mark, setMark] = useState<{ input: MarkInput; review: ReturnType<typeof reviewShippingMark> }>();
  const [moisture, setMoisture] = useState<{ input: MoistureInput; review: ReturnType<typeof reviewMoistureBudget> }>();
  const [status, setStatus] = useState("");
  const boxes = new Map(plan.placements.map(box => [box.id, box]));
  const units = plan.deliveryIdentity!.units.filter(unit => unit.kind === "carton" &&
    `${unit.unitId} ${unit.localId} ${boxes.get(unit.localId)?.sku}`.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 80);
  const materials = accessoryRegions(plan.container).filter(region => region.kind === "obstacle" && region.accessory.type === "desiccant");
  const fmt = (n: number) => n.toLocaleString(language, { maximumFractionDigits: 3 });
  const showError = (error: unknown) => {
    const [zh, en] = (error instanceof Error ? error.message : String(error)).split(" / ");
    setStatus(tr(zh, en ?? zh));
  };
  function checkMark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    try {
      const form = new FormData(event.currentTarget);
      const input = { unitId: String(form.get("unit")), face: String(form.get("face")) as WallSide,
        widthMm: Number(form.get("width")), heightMm: Number(form.get("height")), accessMm: Number(form.get("access")) };
      setMark({ input, review: reviewShippingMark(plan, input) });
      setStatus("");
    } catch (error) { showError(error); }
  }
  function checkMoisture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    try {
      const form = new FormData(event.currentTarget);
      const input = { waterGrams: Number(form.get("water")), ratedGramsPerUnit: Number(form.get("rated")),
        safetyFactor: Number(form.get("factor")), source: String(form.get("source")), accessoryIds: form.getAll("ratedRegion").map(String) };
      setMoisture({ input, review: reviewMoistureBudget(plan, input) });
      setStatus("");
    } catch (error) { showError(error); }
  }
  function exportReview() {
    try {
      const result = fieldReadinessReport(plan, mark?.input, moisture?.input);
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "field-readiness.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) { showError(error); }
  }

  return <details className="upgrade-panel">
    <summary>{tr("唛头净距与防潮用量预核", "Shipping-mark clearance and moisture budget")}</summary>
    <div className="upgrade-body">
      <form onSubmit={checkMark} onChange={() => setMark(undefined)}>
        <fieldset className="upgrade-rule-grid" disabled={disabled}>
          <legend>{tr("按当前放置方向核对居中唛头", "Check a centred mark on the placed carton")}</legend>
          <label>{tr("搜索箱号或 SKU", "Find carton ID or SKU")}<input value={filter} maxLength={120} onChange={event => setFilter(event.target.value)} /></label>
          <label>{tr("唛头箱号", "Shipping mark carton")}<select name="unit" required>
            <option value="">{tr("请选择", "Select")}</option>
            {units.map(unit => <option key={unit.unitId} value={unit.unitId}>{boxes.get(unit.localId)?.sku} · {unit.localId}</option>)}
          </select></label>
          <label>{tr("当前姿态实体面", "Face in the placed orientation")}<select name="face" defaultValue="x+">
            {["x-", "x+", "y-", "y+", "z-", "z+"].map(face => <option key={face} value={face}>{face.toUpperCase()}</option>)}
          </select></label>
          <label>{tr("唛头宽 mm", "Mark width mm")}<input name="width" type="number" min="1" step="any" required /></label>
          <label>{tr("唛头高 mm", "Mark height mm")}<input name="height" type="number" min="1" step="any" required /></label>
          <label>{tr("所需读标净距 mm", "Required reading clearance mm")}<input name="access" type="number" min="1" step="any" required /></label>
          <button className="button" type="submit">{tr("核对唛头净距", "Check mark clearance")}</button>
        </fieldset>
      </form>
      {mark && <p role="status">{tr(markStates[mark.review.status][0], markStates[mark.review.status][1])} · {mark.review.cartonId}
        {mark.review.clearanceMm !== null && <> · {fmt(mark.review.clearanceMm)} mm · {mark.review.obstruction}</>}</p>}
      <p>{tr("按实际平面验证唛头能否放下。读标通道按相邻箱托和实体附件的外包络保守计算。", "Mark fit uses the actual planar surface. Nearby cargo, bases and physical fixtures use conservative envelopes for the reading corridor.")}</p>
      <form onSubmit={checkMoisture} onChange={() => setMoisture(undefined)}>
        <fieldset className="upgrade-rule-grid" disabled={disabled}>
          <legend>{tr("按录入湿负荷与额定吸湿量核对", "Compare declared water load and rated absorption")}</legend>
          <label>{tr("预估水分负荷 g", "Expected water load g")}<input name="water" type="number" min="0" step="any" required /></label>
          <label>{tr("同款每件额定吸湿量 g", "Rated absorption per matching unit g")}<input name="rated" type="number" min=".001" step="any" required /></label>
          <label>{tr("安全系数", "Safety factor")}<input name="factor" type="number" min="1" max="20" step="any" defaultValue="1" required /></label>
          <label>{tr("资料来源与试验工况", "Source and rated service conditions")}<input name="source" maxLength={300} required /></label>
          {materials.map(region => <label key={region.id}><input type="checkbox" name="ratedRegion" value={region.id} />{region.name} · {region.accessory.quantity} · {region.accessory.source}</label>)}
          <small>{tr("只勾选与录入额定量和工况一致的计划材料。", "Select only planned materials covered by the entered rating and conditions.")}</small>
          <button className="button" type="submit">{tr("核算防潮用量", "Calculate moisture-material quantity")}</button>
        </fieldset>
      </form>
      {moisture && <p role="status">{tr("所需", "Required")} {fmt(moisture.review.requiredUnits)} · {tr("计划", "Planned")} {fmt(moisture.review.plannedUnits)} · {tr("缺口", "Shortfall")} {fmt(moisture.review.shortage)}</p>}
      <p>{tr("按录入的同款材料额定吸湿量计算。材料实际安装、温湿度和凝露仍需现场确认。", "The budget uses the entered rating for matching material. Check actual installation, temperature, humidity and condensation on site.")}</p>
      <button className="button" disabled={!mark && !moisture} onClick={exportReview}>{tr("下载现场预核 JSON", "Download field preflight JSON")}</button>
      <p role="status">{status}</p>
    </div>
  </details>;
}
