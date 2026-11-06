"use client";

import { useEffect, useState } from "react";
import { parseNumericDraft } from "../lib/packing/numeric-draft";
import { packagingInterior } from "../lib/packing/packaging";
import { packagingGroupKey } from "../lib/packing/packaging-choice";
import { canSuggestPalletSize, palletRecipeGroups, type PalletRecipeInput, type PalletRecipePreview } from "../lib/packing/pallet-recipe";
import { MAX_CARTONS_PER_PALLET } from "../lib/packing/pallet-specifications";
import type { PackingRequest, PalletBuildSpecification } from "../lib/packing/types";
import { tr, trText, useLanguage } from "./language";

type Props = {
  request: PackingRequest;
  spec: PalletBuildSpecification;
  disabled: boolean;
  onApply: (patch: Partial<PalletBuildSpecification>) => void;
  onPendingChange?: (pending: boolean) => void;
};

function RecipeViews({preview}: {preview:PalletRecipePreview}) {
  const {config, placements, height} = preview;
  const {inset, lid} = packagingInterior(config);
  const base = "#c8ad82";
  const stroke = {stroke:"var(--panel, #fff)", strokeWidth:1, vectorEffect:"non-scaling-stroke" as const};
  const ground = Math.min(...placements.map(b => b.z));
  return <div className="pallet-recipe-views">
    <figure>
      <svg viewBox={`0 0 ${config.length} ${config.width}`} role="img" aria-label={tr("底层俯视","Bottom-layer plan")}>
        <rect width={config.length} height={config.width} fill={base}/>
        {placements.filter(b => Math.abs(b.z-ground) < .0001).map(b =>
          <rect key={b.id} x={b.x} y={b.y} width={b.dx} height={b.dy} fill={b.color} {...stroke}/>)}
      </svg>
      <figcaption>{tr("底层俯视","Bottom-layer plan")}</figcaption>
    </figure>
    <figure>
      <svg viewBox={`0 0 ${config.length} ${height}`} role="img" aria-label={tr("堆码侧视","Stack elevation")}>
        <rect y={height-config.height} width={config.length} height={config.height} fill={base}/>
        {inset > 0 && <><rect width={inset} height={height-config.height} fill={base}/><rect x={config.length-inset} width={inset} height={height-config.height} fill={base}/></>}
        {lid > 0 && <rect width={config.length} height={lid} fill={base}/>}
        {[...placements].sort((a,b) => b.y-a.y).map(b =>
          <rect key={b.id} x={b.x} y={height-config.height-b.z-b.dz} width={b.dx} height={b.dz} fill={b.color} {...stroke}/>)}
      </svg>
      <figcaption>{tr("堆码侧视","Stack elevation")}</figcaption>
    </figure>
  </div>;
}

export function PalletRecipe({request, spec, disabled, onApply, onPendingChange}: Props) {
  useLanguage();
  const [draft, setDraft] = useState(String(spec.cartonLimit ?? ""));
  const [selected, setSelected] = useState("");
  const [method, setMethod] = useState<PalletRecipeInput["mode"]>(spec.cartonLimit ? "current" : "suggest");
  const [response, setResponse] = useState<{key:string; preview?:PalletRecipePreview; error?:string}>();
  const groups = palletRecipeGroups(request.products, spec.productIds, request.palletBuild?.looseQuantities);
  const group = groups.find(items => packagingGroupKey(items[0]) === selected) ?? groups[0];
  const groupKey = group ? packagingGroupKey(group[0]) : "";
  const canSuggest = canSuggestPalletSize(spec.config);
  const mode = canSuggest ? method : "current";
  const parsed = parseNumericDraft(draft, {integer:true, min:1, max:MAX_CARTONS_PER_PALLET});
  const cartons = parsed.state === "valid" ? parsed.value : undefined;
  const pending = cartons !== spec.cartonLimit || draft.trim() !== "" && mode === "suggest" || parsed.state === "invalid";
  const key = !disabled && groupKey && cartons !== undefined
    ? JSON.stringify({request, spec, groupKey, cartons, mode} satisfies PalletRecipeInput)
    : "";
  const current = response?.key === key ? response : undefined;

  useEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [onPendingChange, pending]);

  useEffect(() => {
    if (!key) return;
    let active = true;
    let worker: Worker | undefined;
    let timeout: number | undefined;
    const finish = (result: {preview?:PalletRecipePreview; error?:string}) => {
      if (!active) return;
      active = false;
      worker?.terminate();
      worker = undefined;
      window.clearTimeout(timeout);
      setResponse({key, ...result});
    };
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL("../lib/packing/palletize.worker.ts", import.meta.url), {type:"module"});
        worker.onmessage = e => e.data.ok ? finish({preview:e.data.result}) : finish({error:e.data.error});
        worker.onerror = () => finish({error:"打托预览未完成 / Pallet preview could not finish"});
        timeout = window.setTimeout(() => finish({error:"打托预览超时，请减少每托箱数 / Preview timed out. Try fewer cartons per pallet"}), 12000);
        worker.postMessage({recipe:JSON.parse(key)});
      } catch {
        finish({error:"无法启动打托预览 / Could not start pallet preview"});
      }
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      worker?.terminate();
    };
  }, [key]);

  const preview = current?.preview;
  const errors = parsed.state === "invalid"
    ? tr("请输入 1–1000 的整数。","Enter a whole number from 1 to 1000.")
    : current?.error ? current.error.includes(" / ") ? tr(...current.error.split(" / ", 2) as [string, string]) : trText(current.error) : "";
  const usePreview = () => {
    if (cartons === undefined || !preview) return;
    const config = mode === "suggest"
      ? {...preview.config, presetId:"carton-sized", name:`${group[0].sku.slice(0, 80)} ${packagingInterior(preview.config).crate ? tr("定制木箱","sized crate") : tr("定制托盘","sized pallet")}`}
      : spec.config;
    onApply({config, cartonLimit:cartons});
    setMethod("current");
  };
  const cancel = () => {
    setDraft(String(spec.cartonLimit ?? ""));
    setMethod(spec.cartonLimit ? "current" : "suggest");
  };

  return <section id="pallet-recipe" className="pallet-recipe" aria-label={tr("按箱数自动打托","Pallet sizing by carton count")}>
    <h3>{tr("按箱数自动打托","Pallet sizing by carton count")}</h3>
    <p>{canSuggest
      ? tr("填写几箱一托，自动预览推荐尺寸。采用后可调整托盘长宽、底座高和货物限高。","Enter cartons per pallet to preview suggested dimensions. Apply them to fine-tune deck size, deck height and the cargo height limit.")
      : tr("此包装已有固定结构或实测尺寸，可按当前尺寸预览并设置每托箱数。","Preview this fixed or measured packaging and set cartons per pallet using its current dimensions.")}</p>
    <div className="pallet-build-grid">
      {groups.length > 1 && <label>{tr("预览货物","Preview cargo")}<select value={groupKey} onChange={e=>setSelected(e.target.value)}>
        {groups.map(items => <option key={packagingGroupKey(items[0])} value={packagingGroupKey(items[0])}>{items[0].setCode || items[0].sku}</option>)}
      </select></label>}
      <label>{tr("每托箱数","Cartons per pallet")}<input id="pallet-recipe-count" inputMode="numeric" value={draft} maxLength={8}
        aria-invalid={parsed.state === "invalid"} placeholder={tr("例如 20","e.g. 20")} disabled={!group}
        onChange={e=>{setDraft(e.target.value);setMethod(e.target.value.trim() ? "suggest" : "current");}}/></label>
    </div>
    {!group && <p>{tr("请先添加符合本规格的货物或完整套装。","Add eligible cargo or a complete kit for this specification.")}</p>}
    {group && <small>{group.map(p => `${p.sku} · ${p.length} × ${p.width} × ${p.height} mm`).join(" / ")}</small>}
    <div role={errors ? "alert" : "status"} className="pallet-recipe-status">
      {errors || (key && !current ? tr("正在生成打托预览…","Generating pallet preview…") : "")}
    </div>
    {preview && <div aria-label={tr("打托预览","Pallet preview")}>
      <div className="pallet-recipe-metrics">
        <div><small>{tr("整托外尺寸","Loaded dimensions")}</small><strong>{[preview.config.length,preview.config.width,preview.height].map(n=>Number(n.toFixed(2))).join(" × ")} mm</strong></div>
        <div><small>{tr("箱数与堆码","Cartons and layers")}</small><strong>{preview.placements.length} {tr("箱","cartons")} · {preview.layerCount} {tr("层","layers")}</strong></div>
        <div><small>{tr("整托毛重","Gross pallet weight")}</small><strong>{Number(preview.grossWeight.toFixed(2))} kg</strong></div>
      </div>
      <RecipeViews preview={preview}/>
      <p>{preview.placements.length < preview.sampleCartons
        ? tr(`当前尺寸可打 ${preview.placements.length} 箱，目标 ${cartons} 箱。调整尺寸或限高可刷新预览。`, `Current dimensions fit ${preview.placements.length} of the target ${cartons} cartons. Edit dimensions or height to refresh.`)
        : tr(`本单所选货物有 ${preview.orderCartons} 箱待打托，尾托按实际余量生成。`, `This order has ${preview.orderCartons} cartons of the selected cargo to palletize. Tail units use the remaining quantity.`)}</p>
      {mode === "suggest" && <small>{tr("底座高、自重和承重采用当前填写值，请按实际托盘核对。","Deck height, tare and payload use the current inputs. Verify them against the actual pallet.")}</small>}
    </div>}
    <div className="packaging-preview-actions">
      {pending && <>{parsed.state === "empty" && spec.cartonLimit
        ? <button type="button" className="button small" onClick={()=>{setMethod("suggest");onApply({cartonLimit:undefined});}}>{tr("取消每托箱数限制","Remove the carton limit")}</button>
        : <button type="button" className="button primary small" disabled={disabled||!preview} onClick={usePreview}>{mode === "suggest" ? tr("采用建议尺寸","Apply suggested dimensions") : tr("采用每托箱数","Apply cartons per pallet")}</button>}
        {canSuggest && cartons !== undefined && <button type="button" className="button small" onClick={()=>setMethod(mode === "suggest" ? "current" : "suggest")}>
          {mode === "suggest" ? tr("按当前尺寸预览","Preview current dimensions") : tr("自动建议尺寸","Suggest dimensions")}
        </button>}
        <button type="button" className="button small" onClick={cancel}>{tr("取消本次调整","Cancel adjustment")}</button></>}
      {!pending && spec.cartonLimit && <>
        {canSuggest && <button type="button" className="button small" onClick={()=>{setDraft(String(spec.cartonLimit));setMethod("suggest");}}>{tr("重新建议尺寸","Suggest dimensions again")}</button>}
        <button type="button" className="button small" onClick={()=>{setDraft("");setMethod("suggest");onApply({cartonLimit:undefined});}}>{tr("取消每托箱数限制","Remove the carton limit")}</button>
      </>}
    </div>
  </section>;
}
