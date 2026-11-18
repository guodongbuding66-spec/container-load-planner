"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pencil, Rows3, RotateCcw } from "lucide-react";
import { palletSpecifications } from "../lib/packing/pallet-specifications";
import { capturePreparedPalletLayout, type PreparedPalletLayout } from "../lib/packing/prepared-pallet-layout";
import { palletPreviewInput, withPalletPreviewAppearance } from "../lib/packing/pallet-preview";
import type { PalletLayerTemplate } from "../lib/packing/pallet-layer";
import type { PackingRequest, PackingResult, PalletBuildOptions } from "../lib/packing/types";
import { FeatureDialog } from "./feature-dialog";
import { PalletManifest } from "./pallet-manifest";
import { PalletUnitPreviewScene, PalletUnitViewer } from "./pallet-unit-viewer";
import { PalletOrderConsolidationButton } from "./pallet-order-consolidation";
import { tr, trText, useLanguage } from "./language";

type Props = {
  request: PackingRequest; value: PalletBuildOptions; specId: string; disabled: boolean; active?: boolean;
  appearance?: ReactNode; empty?: ReactNode;
  preparedLayout?: PreparedPalletLayout; onPreparedLayoutChange?: (layout: PreparedPalletLayout | undefined) => void;
  layerTemplates?: PalletLayerTemplate[]; onLayerTemplatesChange?: (templates: PalletLayerTemplate[]) => void;
  onReadyChange?: (ready:boolean) => void;
};

type Preview = { key: string; attempt: number; plan?: PackingResult; error?: string };

export function PalletBuildPreview({request,value,specId,disabled,active=true,appearance,empty,preparedLayout,onPreparedLayoutChange,layerTemplates,onLayerTemplatesChange,onReadyChange}:Props) {
  useLanguage();
  const [preview,setPreview] = useState<Preview>();
  const [lastPlan,setLastPlan] = useState<PackingResult>();
  const [attempt,setAttempt] = useState(0);
  const [showManifest,setShowManifest] = useState(false);
  const [sampleId,setSampleId] = useState("");
  const [editingId,setEditingId] = useState("");
  const title = tr("实时打托预览","Live pallet preview");

  const {input,issue} = useMemo(() => {
    try {
      const input = palletPreviewInput(request,value,preparedLayout);
      const activeSpecs = palletSpecifications(value).some(s => s.maxPallets > 0);
      const hasCargo = request.products.some(p => p.quantity > (value.looseQuantities?.[p.id] ?? 0));
      return {input: activeSpecs && hasCargo ? input : "",
        issue: !hasCargo ? "cargo" : !activeSpecs ? "stock" : ""};
    } catch (error) {
      return {input:"", issue:error instanceof Error ? error.message : String(error)};
    }
  }, [request,value,preparedLayout]);

  const matches = preview?.key === input && preview.attempt === attempt;
  useEffect(() => {
    if (!input || disabled || !active || matches) return;
    let cancelled = false;
    let worker: Worker | undefined;
    const timer = window.setTimeout(() => {
      const publish = (next: Pick<Preview,"plan" | "error">) => {
        if (cancelled) return;
        worker?.terminate();
        worker = undefined;
        setPreview({key:input,attempt,...next});
        if (next.plan) setLastPlan(next.plan);
      };
      try {
        const inspection = JSON.parse(input) as PackingRequest;
        const build = inspection.palletBuild!;
        worker = new Worker(new URL("../lib/packing/palletize.worker.ts",import.meta.url),{type:"module"});
        worker.onmessage = e => e.data.ok ? publish({plan:e.data.result.plan}) : publish({error:e.data.error});
        worker.onerror = () => publish({error:"worker"});
        worker.postMessage({request:inspection,config:build.config,mix:build.mix,limit:build.maxPallets,build});
      } catch (error) {
        publish({error:error instanceof Error ? error.message : String(error)});
      }
    }, 260);
    return () => { cancelled = true; window.clearTimeout(timer); worker?.terminate(); };
  },[input,attempt,disabled,active,matches]);
  const current = matches ? preview.plan : undefined;
  const source = current ?? lastPlan;
  const plan = useMemo(() => source && withPalletPreviewAppearance(source,value), [source,value]);
  // The same immutable placement snapshot feeds inspection, projections and all edit actions.
  const fresh = !!current && !disabled;
  const ready = fresh&&current.validation.valid || !disabled&&issue==="cargo"&&request.workflow==="palletized"&&request.products.some(p=>p.quantity>0);
  useEffect(()=>{onReadyChange?.(ready);return ()=>onReadyChange?.(false);},[ready,onReadyChange]);
  const loadedUnits = useMemo(() => new Set(plan?.placements.flatMap(b => b.palletIds ?? [])),[plan]);
  const units = plan?.pallets?.filter(p => (p.specificationId ?? "primary") === specId && loadedUnits.has(p.id)) ?? [];
  const sample = units.find(p => p.id === sampleId) ?? units[0];
  const sampleCartons=new Map<string,number>();
  if(sample&&plan)for(const carton of plan.placements){
    if(carton.palletIds?.[0]===sample.id)sampleCartons.set(carton.sku,(sampleCartons.get(carton.sku)??0)+1);
  }
  const stagedProducts = useMemo(() => input ? (JSON.parse(input) as PackingRequest).products : [], [input]);
  const error = matches ? preview.error : "";
  const status = disabled ? tr("完成当前输入后自动更新预览。","Complete the current input to refresh the preview.")
    : issue === "cargo" ? tr("在货物清单中添加待打托的箱子。","Add cartons for palletizing in the cargo list.")
    : issue === "stock" ? tr("至少一种包装需要有库存。","Enter stock for at least one packaging specification.")
    : issue ? trText(issue)
    : error === "worker" ? tr("预览生成失败，请重试。","Preview failed. Please retry.")
    : error ? trText(error)
    : !matches ? tr("正在试排托内货物…","Arranging cartons…")
    : !sample && current ? tr("此包装规格在当前订单中没有生成整托。","This specification produced no pallets for the order.") : "";

  const adopt = (next: PackingResult) => {
    onPreparedLayoutChange?.(capturePreparedPalletLayout(next));
    setEditingId("");
  };

  return <section id="pallet-build-preview" className="pallet-build-preview live-pallet-preview" aria-label={title}>
    <header className="live-preview-heading">
      <h3>{title}</h3>
      {preparedLayout && <span>{tr("已采用人工布置","Manual layout applied")}</span>}
    </header>
    {plan && <dl className="live-preview-metrics">
      <div><dt>{tr("已打托","Palletized")}</dt><dd>{plan.metrics.loadedCount.toLocaleString()} <small>{tr("箱","cartons")}</small></dd></div>
      <div><dt>{tr("整托数量","Pallets")}</dt><dd>{loadedUnits.size}</dd></div>
      <div><dt>{tr("待打托","Remaining")}</dt><dd>{plan.summaries.reduce((n,s) => n+s.unloaded,0).toLocaleString()} <small>{tr("箱","cartons")}</small></dd></div>
    </dl>}
    {status && <p className="pallet-build-preview-status" role={error?"alert":"status"}>{status}{plan&&!fresh&&` · ${tr("当前画面为上次布局","Showing the last layout")}`}</p>}
    {error && !disabled && <button type="button" className="button small" onClick={()=>setAttempt(v=>v+1)}><RotateCcw size={14}/>{tr("重试预览","Retry preview")}</button>}
    {sample && plan ? <>
      <div className="pallet-preview-selection">
        <label className="pallet-preview-sample">{tr("预览托盘","Preview pallet")}
          <select value={sample.id} onChange={e=>setSampleId(e.target.value)}>
            {units.map((p,i)=><option key={p.id} value={p.id}>{tr("第","Pallet")} {i+1} {tr("托","")} · {p.name}</option>)}
          </select>
        </label>
        {onPreparedLayoutChange && <button className="button small" disabled={!fresh} type="button" onClick={()=>setEditingId(sample.id)}><Pencil size={14}/>{tr("编辑托内摆放","Edit pallet layout")}</button>}
      </div>
      {sampleCartons.size>0&&<ul className="pallet-preview-contents" aria-label={tr("当前托内箱型","Cartons on selected pallet")}>
        {[...sampleCartons].map(([sku,count])=><li key={sku}>{sku} <b>× {count}</b></li>)}
      </ul>}
      {active && !editingId && !showManifest && <PalletUnitPreviewScene result={plan} id={sample.id} actions={appearance} products={stagedProducts}/>}
      <div className="packaging-preview-actions">
        <button type="button" className="button ghost small" disabled={!fresh} onClick={()=>setShowManifest(true)}><Rows3 size={14}/>{tr("查看打托清单","View pallet manifest")}</button>
        {onPreparedLayoutChange && (!plan.palletization?.oneKitPerPallet||plan.placements.some(box=>!box.setCode)) && <PalletOrderConsolidationButton plan={plan} products={stagedProducts} disabled={!fresh} preparation onAdopt={adopt}/>}
      </div>
    </> : active ? <>{appearance}{empty}</> : null}
    {preparedLayout && onPreparedLayoutChange && <button type="button" className="button ghost small" onClick={()=>onPreparedLayoutChange(undefined)}>{tr("恢复自动打托","Return to automatic palletizing")}</button>}
    {showManifest && plan && <FeatureDialog title={tr("打托清单","Pallet manifest")} wide onClose={()=>setShowManifest(false)}>
      <PalletManifest result={plan} initiallyOpen/>
    </FeatureDialog>}
    {editingId && plan && fresh && <PalletUnitViewer preparation result={plan} id={editingId} products={stagedProducts}
      layerTemplates={layerTemplates} onLayerTemplatesChange={onLayerTemplatesChange} onAdopt={adopt} onClose={()=>setEditingId("")}/>}
  </section>;
}
