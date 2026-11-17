"use client";

import { Box, PanelsTopLeft } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { tr, useLanguage } from "./language";
import { OrthographicViews } from "./orthographic-views";

type Props = ComponentProps<typeof OrthographicViews> & {
  scene: ReactNode;
  actions?: ReactNode;
  viewRevision?: number;
};

export function PlanViews({ scene, actions, viewRevision = 0, ...projections }: Props) {
  useLanguage();
  const [diagramRevision, setDiagramRevision] = useState<number | null>(null);
  const diagram = diagramRevision===viewRevision;
  return <div className="plan-views">
    <div className="plan-view-bar">
      <div className="plan-view-switch" role="group" aria-label={tr("查看方式","View mode")}>
        <button type="button" aria-pressed={!diagram} onClick={() => setDiagramRevision(null)}><Box size={16}/>{tr("三维模型","3D model")}</button>
        <button type="button" aria-pressed={diagram} onClick={() => setDiagramRevision(viewRevision)}><PanelsTopLeft size={16}/>{tr("三视图","Orthographic views")}</button>
      </div>
      {actions}
    </div>
    <div className="plan-view-model" hidden={diagram}>{scene}</div>
    {(diagram || projections.renderPrintSvg) && <section className="viewer-projections plan-view-diagrams" hidden={!diagram} aria-label={tr("三视图相机控制")}>
      <OrthographicViews {...projections}/>
    </section>}
  </div>;
}
