"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { isolatePalletPlan } from "../lib/packing/pallet-inspection";
import type { PackingResult } from "../lib/packing/types";
import type { CameraView, CameraProjection } from "../lib/packing/camera-fit";
import { FeatureDialog } from "./feature-dialog";
import { tr, useLanguage } from "./language";
const Scene=dynamic(()=>import("./container-scene").then(m=>m.ContainerScene),{ssr:false});
export function PalletUnitViewer({result,id,onClose}:{result:PackingResult;id:string;onClose:()=>void}) {
  useLanguage();
  const plan=useMemo(()=>isolatePalletPlan(result,id),[result,id]);
  const [view,setView]=useState<CameraView>("perspective"),[projection,setProjection]=useState<CameraProjection>("perspective");
  const visible=useMemo(()=>new Set(plan.summaries.map(s=>s.productId)),[plan]);
  return <FeatureDialog wide title={tr("整托独立查看","Inspect complete pallet load")} subtitle={id} onClose={onClose}>
    <div className="pallet-unit-summary"><strong>{plan.placements.length} {tr("箱","cartons")} · {plan.metrics.grossWeight.toFixed(1)} kg</strong><span>{plan.container.length} × {plan.container.width} × {plan.container.height} mm</span></div>
    <Scene result={plan} visibleProducts={visible} visibleCount={plan.placements.length} cameraView={view} projectionMode={projection} onCameraViewChange={setView} onProjectionModeChange={setProjection}/>
    <div className="pallet-unit-contents">{plan.summaries.map(s=><span key={s.productId}><i style={{background:s.color}}/>{s.sku} × {s.loaded} · {s.loadedWeight.toFixed(1)} kg</span>)}</div>
    <p className="helper-text">{tr("当前只显示这一托的包装和货物，坐标已移到独立查看原点；原装柜方案保持不变。","Only this unit and its contents are shown, rebased to a local inspection origin. The vehicle plan is unchanged.")}</p>
  </FeatureDialog>;
}
