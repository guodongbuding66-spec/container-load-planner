"use client";

import { Box, DoorOpen, Eye, ImageDown, RotateCcw, Ruler, ScanLine, Tag } from "lucide-react";
import type { ReactNode } from "react";
import type { CameraPresetView, CameraProjection, CameraView } from "../lib/packing/camera-fit";
import { DimensionControls } from "./dimension-controls";
import { tr, useLanguage } from "./language";
import { TransportModelControls, useTransportAppearance } from "./transport-appearance";

const cameraPresets = [
  { id: "perspective", label: "等轴测", english: "Isometric", Icon: Box },
  { id: "top", label: "俯视", english: "Top", Icon: ScanLine },
  { id: "side", label: "侧视", english: "Side", Icon: Eye },
  { id: "door", label: "箱门", english: "Door", Icon: DoorOpen },
  { id: "bottom", label: "底视", english: "Bottom", Icon: ScanLine },
  { id: "rear", label: "后视", english: "Rear", Icon: DoorOpen },
  { id: "left", label: "左视", english: "Left", Icon: Eye },
] as const;

type Props = {
  cameraView: CameraView;
  projectionMode: CameraProjection;
  webglSupported: boolean | null;
  compact?: boolean;
  palletOnly: boolean;
  hasCargo: boolean;
  hasCollisionBody: boolean;
  fullscreenToggle: ReactNode;
  onViewChange: (view: CameraPresetView) => void;
  onProjectionChange: (projection: CameraProjection) => void;
  onReset: () => void;
  onSave: () => void;
};

export function SceneViewToolbar({
  cameraView, projectionMode, webglSupported, palletOnly, hasCargo, hasCollisionBody, compact=false,
  fullscreenToggle, onViewChange, onProjectionChange, onReset, onSave,
}: Props) {
  useLanguage();
  const appearance = useTransportAppearance();
  const topViewOnly = webglSupported === false;

  return <section className="scene-view-toolbar" aria-label={topViewOnly ? tr("俯视图工具栏","Top view controls") : tr("三维视图工具栏", "3D view controls")}>
    <div className="scene-toolbar-row" role="group" aria-label={tr("视角", "Camera")}>
      <span className="scene-toolbar-label" aria-hidden="true">{tr("视角", "Camera")}</span>
      <div className="scene-toolbar-content">
        {topViewOnly ? <span className="scene-toolbar-static-view"><ScanLine size={15}/>{tr("正交俯视","Orthographic top view")}</span> : <>
          {!compact&&<div className="scene-toolbar-segment" role="group" aria-label={tr("投影方式", "Projection")}>
            <button type="button" disabled={!webglSupported} aria-pressed={projectionMode === "perspective"} onClick={() => onProjectionChange("perspective")}>{tr("透视投影", "Perspective")}</button>
            <button type="button" disabled={!webglSupported} aria-pressed={projectionMode === "orthographic"} onClick={() => onProjectionChange("orthographic")}>{tr("正交投影", "Orthographic")}</button>
          </div>}
          <div className="scene-toolbar-buttons scene-toolbar-presets" role="group" aria-label={tr("预设方向", "Camera presets")}>
            {(compact?cameraPresets.slice(0,4):cameraPresets).map(({ id, label, english, Icon }) => (
              <button key={id} type="button" disabled={!webglSupported} aria-pressed={cameraView === id} onClick={() => onViewChange(id)}>
                <Icon size={15}/>{id === "door" && palletOnly ? tr("正视", "Front") : tr(label, english)}
              </button>
            ))}
          </div>
        </>}
        <div className="scene-toolbar-buttons scene-toolbar-actions">
          <button type="button" onClick={onReset}><RotateCcw size={15}/>{tr("重置视图", "Reset view")}</button>
          {!topViewOnly && <button type="button" disabled={!webglSupported} onClick={onSave}><ImageDown size={15}/>{tr("保存图片", "Save image")}</button>}
          {compact&&<button type="button" aria-pressed={appearance.dimensions} onClick={()=>appearance.setDimensions(!appearance.dimensions)}><Ruler size={15}/>{tr("尺寸","Dimensions")}</button>}
          {fullscreenToggle}
        </div>
      </div>
    </div>
    {!compact&&<><div className="scene-toolbar-row" role="group" aria-label={tr("显示", "Display")}>
      <span className="scene-toolbar-label" aria-hidden="true">{tr("显示", "Display")}</span>
      <div className="scene-toolbar-content">
        <div className="scene-toolbar-buttons">
          <button type="button" disabled={!hasCargo} aria-pressed={appearance.labels} title={tr("箱标随货物旋转和缩放", "Carton labels follow the cargo")} onClick={() => appearance.setLabels(!appearance.labels)}><Tag size={15}/>{tr("箱标", "Carton labels")}</button>
          <button type="button" disabled={!hasCargo} aria-pressed={appearance.skuSummaries} title={tr("在货物上方显示每个 SKU 的汇总标签", "Show one summary label above each SKU")} onClick={() => appearance.setSkuSummaries(!appearance.skuSummaries)}>{tr("SKU 汇总", "SKU summaries")}</button>
          {!topViewOnly && <button type="button" disabled={!webglSupported || !hasCollisionBody} aria-pressed={appearance.collisionProxy} onClick={() => appearance.updatePreferences({ collisionProxy: !appearance.collisionProxy })}>{tr("碰撞体", "Collision bodies")}</button>}
        </div>
        {!palletOnly && <TransportModelControls/>}
      </div>
    </div>
    <div className="scene-toolbar-row" role="group" aria-label={tr("标尺", "Annotations")}>
      <span className="scene-toolbar-label" aria-hidden="true">{tr("标尺", "Annotations")}</span>
      <div className="scene-toolbar-content"><DimensionControls/></div>
    </div></>}
  </section>;
}
