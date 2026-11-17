"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { palletSpecifications, specificationForPallet } from "../lib/packing/pallet-specifications";
import {capturePreparedPalletLayout,palletPreparationRequest,type PreparedPalletLayout} from "../lib/packing/prepared-pallet-layout";
import type {PalletLayerTemplate} from "../lib/packing/pallet-layer";
import { palletEnvelopeTop } from "../lib/packing/deck-support";
import { palletLocalBox } from "../lib/packing/pallet-edit";
import type { PackingRequest, PackingResult, PalletBuildOptions } from "../lib/packing/types";
import { FeatureDialog } from "./feature-dialog";
import { PalletLoadViews } from "./pallet-load-views";
import { PalletManifest } from "./pallet-manifest";
import {PalletUnitPreviewScene,PalletUnitViewer} from "./pallet-unit-viewer";
import {PalletOrderConsolidationButton} from "./pallet-order-consolidation";
import { tr, trText, useLanguage } from "./language";

type Props = {request:PackingRequest;value:PalletBuildOptions;specId:string;disabled:boolean;
  preparedLayout?:PreparedPalletLayout;onPreparedLayoutChange?:(layout:PreparedPalletLayout|undefined)=>void;
  layerTemplates?:PalletLayerTemplate[];onLayerTemplatesChange?:(templates:PalletLayerTemplate[])=>void};

export function PalletBuildPreview({request,value,specId,disabled,preparedLayout,onPreparedLayoutChange,layerTemplates,onLayerTemplatesChange}:Props) {
  useLanguage();
  const worker = useRef<Worker | null>(null);
  const [running,setRunning] = useState(false);
  const [preview,setPreview] = useState<{plan:PackingResult;layout?:PreparedPalletLayout}|null>(null);
  const [error,setError] = useState("");
  const [showManifest,setShowManifest] = useState(false);
  const [sampleId,setSampleId] = useState("");
  const [editingId,setEditingId]=useState("");
  const title = tr("整体打托预览","Complete pallet preview");
  const preparation=useMemo(()=>{
    try{return {request:palletPreparationRequest(request,value),error:""};}
    catch(error){return {request:null,error:error instanceof Error?error.message:String(error)};}
  },[request,value]);
  const inspection=preparation.request;
  const build=inspection?.palletBuild;
  const activeSpecifications = build?palletSpecifications(build).filter(s=>s.maxPallets>0):[];
  const issue = preparation.error ? trText(preparation.error)
    : !inspection?.products.some(p=>p.quantity>0) ? tr("没有待打托货物。","No cargo to palletize.")
    : !activeSpecifications.length ? tr("请为至少一种包装填写可用数量。","Enter stock for at least one packaging specification.")
    : !preparedLayout&&activeSpecifications.every(s=>!s.config.maxCargoHeight) ? tr("请检查启用规格的货物限高和柜门净高。","Check cargo height limits and door clearance for available specifications.")
    : "";
  const plan=preview?.layout===preparedLayout?preview?.plan:null;
  useEffect(()=>()=>worker.current?.terminate(),[]);
  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
  };
  const run = (layout=preparedLayout) => {
    if(!inspection||!build)return;
    stop();
    setPreview(null);
    setError("");
    try {
      const w = new Worker(new URL("../lib/packing/palletize.worker.ts",import.meta.url),{type:"module"});
      worker.current = w;
      setRunning(true);
      w.onmessage = e => {
        if(worker.current!==w) return;
        stop();
        if(e.data.ok) setPreview({plan:e.data.result.plan,layout});
        else setError(e.data.error);
      };
      w.onerror = () => {
        if(worker.current!==w) return;
        stop();
        setError(tr("打托预览失败，请重试。","Pallet preview failed. Please retry."));
      };
      w.postMessage({request:{...inspection,preparedPalletLayout:layout},config:build.config,mix:build.mix,limit:build.maxPallets,build});
    } catch (e) {
      stop();
      setError(e instanceof Error?e.message:String(e));
    }
  };
  const occupied=useMemo(()=>new Set(plan?.placements.flatMap(b=>b.palletIds??[])),[plan]);
  const units = plan?.pallets?.filter(p=>(p.specificationId??"primary")===specId&&occupied.has(p.id))??[];
  const sample = units.find(p=>p.id===sampleId)??units[0];
  const sampleCargo = sample&&plan ? plan.placements.filter(b=>b.palletIds?.includes(sample.id)) : [];
  const adopt=(next:PackingResult)=>{
    const layout=capturePreparedPalletLayout(next);
    onPreparedLayoutChange?.(layout);
    setEditingId("");
    run(layout);
  };
  return <section id="pallet-build-preview" className="pallet-build-preview" aria-label={title}>
    <h3>{title}</h3>
    {preparedLayout&&<p className="pallet-build-preview-totals" role="status">{tr("已采用人工托内布置","Manual pallet layout applied")} · {preparedLayout.units.length} {tr("托","units")}</p>}
    <div className="packaging-preview-actions">
      <button type="button" className={plan?"button":"button primary"} disabled={disabled||running||!!issue} onClick={()=>run()}>{preparedLayout?tr("查看已采用布置","Preview applied layout"):tr("生成整体打托预览","Preview complete pallet loads")}</button>
      {running&&<button type="button" className="button" onClick={stop}>{tr("停止","Stop")}</button>}
      {plan&&<button type="button" className="button" onClick={()=>setShowManifest(true)}>{tr("查看打托清单","View pallet manifest")}</button>}
      {plan&&inspection&&onPreparedLayoutChange&&<PalletOrderConsolidationButton plan={plan} products={inspection.products} disabled={disabled} preparation onAdopt={adopt}/>}
      {preparedLayout&&onPreparedLayoutChange&&<button type="button" className="button" onClick={()=>{stop();setPreview(null);setError("");onPreparedLayoutChange(undefined);}}>{tr("恢复自动打托","Return to automatic palletizing")}</button>}
    </div>
    <p className="pallet-build-preview-status" role={error?"alert":"status"}>{error?trText(error):running?tr("正在生成完整托盘…","Building complete pallet loads…"):issue}</p>
    {plan&&<>
      <p className="pallet-build-preview-totals">{plan.metrics.loadedCount} {tr("箱","cartons")} · {occupied.size} {tr("托","units")} · {plan.summaries.reduce((n,s)=>n+s.unloaded,0)} {tr("箱待打托","cartons remaining")}</p>
      {sample&&plan.palletization
        ? <>
          <div className="pallet-preview-selection"><label className="pallet-preview-sample">{tr("预览托盘","Preview pallet")}
            <select value={sample.id} onChange={e=>setSampleId(e.target.value)}>
              {units.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </label>
          {onPreparedLayoutChange&&<button className="button primary small" disabled={disabled} type="button" onClick={()=>setEditingId(sample.id)}>{tr("3D 托内编辑","Edit pallet in 3D")}</button>}</div>
          {!editingId&&!showManifest&&<PalletUnitPreviewScene key={sample.id} result={plan} id={sample.id}/>}
          <details className="pallet-preview-projections"><summary>{tr("底层俯视与堆码侧视","Floor view and stack elevation")}</summary>
            <PalletLoadViews config={specificationForPallet(plan.palletization,sample).config} placements={sampleCargo.map(b=>palletLocalBox(b,sample))} height={palletEnvelopeTop(sample,sampleCargo)-sample.z}/>
          </details>
        </>
        : <p className="helper-text">{tr("当前规格在本次预览中未生成托盘。","This specification produced no units in the preview.")}</p>}
    </>}
    {showManifest&&plan&&<FeatureDialog title={title} wide onClose={()=>setShowManifest(false)}>
      <PalletManifest result={plan} initiallyOpen/>
      {!plan.pallets?.length&&<p>{tr("当前配置未能生成完整托盘。请检查包装尺寸、货物限高、承重和库存。","No complete pallet loads were built. Check dimensions, height, payload and stock.")}</p>}
    </FeatureDialog>}
    {editingId&&plan&&inspection&&<PalletUnitViewer preparation result={plan} id={editingId} products={inspection.products} disabled={disabled}
      layerTemplates={layerTemplates} onLayerTemplatesChange={onLayerTemplatesChange} onAdopt={adopt} onClose={()=>setEditingId("")}/>}
  </section>;
}
