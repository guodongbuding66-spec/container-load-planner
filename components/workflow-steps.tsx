"use client";

import { Check } from "lucide-react";
import { tr, useLanguage } from "./language";

export type WorkflowStep = 1 | 2 | 3 | 4;

const steps = [
  [1, "选柜型", "Container"],
  [2, "选包装", "Packaging"],
  [3, "货物与布置", "Cargo & layout"],
  [4, "查看方案", "Results"],
] as const;

export function WorkflowSteps({current,canOpenPlan,onSelect}:{
  current:WorkflowStep; canOpenPlan:boolean; onSelect:(step:WorkflowStep)=>void;
}) {
  useLanguage();
  return <nav className="wizard-steps" aria-label={tr("装柜计算步骤","Loading workflow")}>
    {steps.map(([id,label,en])=><button type="button" key={id} aria-current={current===id?"step":undefined}
      className={current===id?"current":id<current?"complete":""} disabled={id===4&&!canOpenPlan}
      onClick={()=>onSelect(id)}>
      <span className="wizard-step-number" aria-hidden="true">{id<current?<Check size={15}/>:id}</span>
      <strong>{tr(label,en)}</strong>
    </button>)}
  </nav>;
}
