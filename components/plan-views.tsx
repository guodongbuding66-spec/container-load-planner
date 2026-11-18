"use client";

import { Box, PanelsTopLeft, ScanLine } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { tr, useLanguage } from "./language";
import { OrthographicViews } from "./orthographic-views";
import { useWebGLSupport } from "./use-webgl-support";

type Props = ComponentProps<typeof OrthographicViews> & {
  scene: ReactNode;
  actions?: ReactNode;
  viewRevision?: number;
};

export function PlanViews({ scene, actions, viewRevision = 0, onViewSelect, ...projections }: Props) {
  useLanguage();
  const webglSupported = useWebGLSupport();
  const topViewOnly = webglSupported === false;
  const [diagramRevision, setDiagramRevision] = useState<number | null>(null);
  const diagram = diagramRevision===viewRevision;
  return <div className="plan-views">
    <div className="plan-view-bar">
      <div className="plan-view-switch" role="group" aria-label={tr("查看方式","View mode")}>
        <button type="button" aria-pressed={!diagram} onClick={() => setDiagramRevision(null)}>
          {topViewOnly ? <><ScanLine size={16}/>{tr("交互俯视图","Interactive top view")}</> : <><Box size={16}/>{tr("三维模型","3D model")}</>}
        </button>
        <button type="button" aria-pressed={diagram} onClick={() => setDiagramRevision(viewRevision)}><PanelsTopLeft size={16}/>{tr("三视图","Orthographic views")}</button>
      </div>
      {actions}
    </div>
    <div className="plan-view-model" hidden={diagram}>{scene}</div>
    {(diagram || projections.renderPrintSvg) && <section className="viewer-projections plan-view-diagrams" hidden={!diagram}
      aria-label={webglSupported ? tr("三视图相机控制") : tr("三视图","Orthographic views")}>
      <OrthographicViews {...projections} onViewSelect={webglSupported ? onViewSelect : undefined}/>
    </section>}
  </div>;
}
