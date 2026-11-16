"use client";

import { useEffect, useRef, useState } from "react";
import { palletSpecifications, specificationForPallet } from "../lib/packing/pallet-specifications";
import { palletCargoCeiling } from "../lib/packing/floor-pallets";
import { packagingInterior } from "../lib/packing/packaging";
import { palletEnvelopeTop } from "../lib/packing/deck-support";
import { palletLocalBox } from "../lib/packing/pallet-edit";
import type { PackingRequest, PackingResult, PalletBuildOptions } from "../lib/packing/types";
import { FeatureDialog } from "./feature-dialog";
import { PalletLoadViews } from "./pallet-load-views";
import { PalletManifest } from "./pallet-manifest";
import { tr, trText, useLanguage } from "./language";

type Props = {request:PackingRequest;value:PalletBuildOptions;specId:string;disabled:boolean};

export function PalletBuildPreview({request,value,specId,disabled}:Props) {
  useLanguage();
  const worker = useRef<Worker | null>(null);
  const [running,setRunning] = useState(false);
  const [plan,setPlan] = useState<PackingResult | null>(null);
  const [error,setError] = useState("");
  const [showManifest,setShowManifest] = useState(false);
  const [sampleId,setSampleId] = useState("");
  const title = tr("整体打托预览","Complete pallet preview");
  const previewConfig = (config: PalletBuildOptions["config"]) => request.workflow==="palletized"&&!packagingInterior(config).crate
    ? {...config,maxCargoHeight:Math.max(0,palletCargoCeiling(request.container,request.clearance,config)-config.height)}
    : config;
  const build = {...value,looseQuantities:undefined,config:previewConfig(value.config),
    ...(value.additionalSpecs ? {additionalSpecs:value.additionalSpecs.map(s=>({...s,config:previewConfig(s.config)}))} : {})};
  const products = request.products.map(p=>({...p,quantity:p.quantity-(value.looseQuantities?.[p.id]??0)}));
  const activeSpecifications = palletSpecifications(build).filter(s=>s.maxPallets>0);
  const issue = !products.some(p=>p.quantity>0) ? tr("没有待打托货物。","No cargo to palletize.")
    : !activeSpecifications.length ? tr("请为至少一种包装填写可用数量。","Enter stock for at least one packaging specification.")
    : activeSpecifications.some(s=>!s.config.maxCargoHeight) ? tr("请检查启用规格的货物限高和柜门净高。","Check cargo height limits and door clearance for available specifications.")
    : "";
  useEffect(()=>()=>worker.current?.terminate(),[]);
  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
  };
  const run = () => {
    stop();
    setPlan(null);
    setError("");
    try {
      const w = new Worker(new URL("../lib/packing/palletize.worker.ts",import.meta.url),{type:"module"});
      worker.current = w;
      setRunning(true);
      w.onmessage = e => {
        if(worker.current!==w) return;
        stop();
        if(e.data.ok) setPlan(e.data.result.plan);
        else setError(e.data.error);
      };
      w.onerror = () => {
        if(worker.current!==w) return;
        stop();
        setError(tr("打托预览失败，请重试。","Pallet preview failed. Please retry."));
      };
      w.postMessage({request:{...request,products,container:{...request.container,exclusions:undefined},workflow:"pallet-only",floorPallets:undefined},config:build.config,mix:build.mix,limit:build.maxPallets,build});
    } catch (e) {
      stop();
      setError(e instanceof Error?e.message:String(e));
    }
  };
  const units = plan?.pallets?.filter(p=>(p.specificationId??"primary")===specId)??[];
  const sample = units.find(p=>p.id===sampleId)??units[0];
  const sampleCargo = sample&&plan ? plan.placements.filter(b=>b.palletIds?.includes(sample.id)) : [];
  return <section className="pallet-build-preview" aria-label={title}>
    <h3>{title}</h3>
    <p className="helper-text">{tr("按已采用的包装和预留散箱生成打托清单。","Preview the palletized cargo using saved packaging and loose reservations.")}</p>
    <div className="packaging-preview-actions">
      <button type="button" className="button" disabled={disabled||running||!!issue} onClick={run}>{tr("生成整体打托预览","Preview complete pallet loads")}</button>
      {running&&<button type="button" className="button" onClick={stop}>{tr("停止","Stop")}</button>}
      {plan&&<button type="button" className="button" onClick={()=>setShowManifest(true)}>{tr("查看打托清单","View pallet manifest")}</button>}
    </div>
    <p className="pallet-build-preview-status" role={error?"alert":"status"}>{error?trText(error):running?tr("正在生成完整托盘…","Building complete pallet loads…"):issue}</p>
    {plan&&<>
      <p className="pallet-build-preview-totals" role="status">{plan.metrics.loadedCount} {tr("箱","cartons")} · {plan.pallets?.length??0} {tr("托","units")} · {plan.summaries.reduce((n,s)=>n+s.unloaded,0)} {tr("箱待打托","cartons remaining")}</p>
      {sample&&plan.palletization
        ? <>
          <label className="pallet-preview-sample">{tr("当前规格实装预览","Load preview for this specification")}
            <select value={sample.id} onChange={e=>setSampleId(e.target.value)}>
              {units.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </label>
          <PalletLoadViews config={specificationForPallet(plan.palletization,sample).config} placements={sampleCargo.map(b=>palletLocalBox(b,sample))} height={palletEnvelopeTop(sample,sampleCargo)-sample.z}/>
        </>
        : <p className="helper-text">{tr("当前规格在本次预览中未生成托盘。","This specification produced no units in the preview.")}</p>}
    </>}
    {showManifest&&plan&&<FeatureDialog title={title} wide onClose={()=>setShowManifest(false)}>
      <PalletManifest result={plan}/>
      {!plan.pallets?.length&&<p>{tr("当前配置未能生成完整托盘。请检查包装尺寸、货物限高、承重和库存。","No complete pallet loads were built. Check dimensions, height, payload and stock.")}</p>}
    </FeatureDialog>}
  </section>;
}
