"use client";
import { useEffect, useRef, useState } from "react";
import type { PackingRequest, PackingResult, PalletBuildOptions } from "../lib/packing/types";
import { palletSpecifications } from "../lib/packing/pallet-specifications";
import { palletCargoCeiling } from "../lib/packing/floor-pallets";
import { packagingInterior } from "../lib/packing/packaging";
import { PalletManifest } from "./pallet-manifest";
import { tr, trText, useLanguage } from "./language";
export function PalletBuildPreview({request,value,disabled}:{request:PackingRequest;value:PalletBuildOptions;disabled:boolean}) {
  useLanguage();const worker=useRef<Worker|null>(null),[running,setRunning]=useState(false),[plan,setPlan]=useState<PackingResult|null>(null),[error,setError]=useState("");
  const previewConfig = (config: PalletBuildOptions["config"]) => request.workflow==="palletized"&&!packagingInterior(config).crate
    ? {...config,maxCargoHeight:Math.max(0,palletCargoCeiling(request.container,request.clearance,config)-config.height)}
    : config;
  const build = {...value,looseQuantities:undefined,config:previewConfig(value.config),
    ...(value.additionalSpecs ? {additionalSpecs:value.additionalSpecs.map(s=>({...s,config:previewConfig(s.config)}))} : {})};
  useEffect(()=>()=>worker.current?.terminate(),[]);
  const stop=()=>{worker.current?.terminate();worker.current=null;setRunning(false);};
  const run=()=>{stop();setPlan(null);setError("");try{const w=new Worker(new URL("../lib/packing/palletize.worker.ts",import.meta.url),{type:"module"});worker.current=w;setRunning(true);
    w.onmessage=e=>{if(worker.current!==w)return;stop();if(e.data.ok)setPlan(e.data.result.plan);else setError(e.data.error);};
    w.onerror=()=>{stop();setError(tr("打托预览失败，请重试。","Pallet preview failed. Please retry."));};
    w.postMessage({request:{...request,products:request.products.map(p=>({...p,quantity:p.quantity-(value.looseQuantities?.[p.id]??0)})),container:{...request.container,exclusions:undefined},workflow:"pallet-only",floorPallets:undefined},config:build.config,mix:build.mix,limit:build.maxPallets,build});
  }catch(e){stop();setError(e instanceof Error?e.message:String(e));}};
  const activeSpecifications=palletSpecifications(build).filter(s=>s.maxPallets>0);
  return <section className="pallet-build-preview"><div className="packaging-preview-actions"><button type="button" className="button" disabled={disabled||running||!request.products.some(p=>p.quantity>(value.looseQuantities?.[p.id]??0))||!activeSpecifications.length||activeSpecifications.some(s=>!s.config.maxCargoHeight)} onClick={run}>{tr("生成整体打托预览","Preview complete pallet loads")}</button>{running&&<button className="button" onClick={stop}>{tr("停止","Stop")}</button>}<small>{tr("扣除指定散装预留后，预览其余货物的完整托盘；确认后继续计算装柜。","Preview the palletized portion after deducting explicit loose reservations, then continue to vehicle loading.")}</small></div><p role={error?"alert":"status"}>{error?trText(error):running?tr("正在生成完整托盘…","Building complete pallet loads…"):""}</p>{plan&&<><p>{plan.metrics.loadedCount} {tr("箱","cartons")} · {plan.pallets?.length} {tr("托","units")} · {plan.summaries.reduce((n,s)=>n+s.unloaded,0)} {tr("箱待打托","cartons remaining")}</p><PalletManifest result={plan}/></>}</section>;
}
