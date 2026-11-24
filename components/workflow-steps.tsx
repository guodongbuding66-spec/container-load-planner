"use client";

import type {LoadingWorkflow} from "../lib/packing/types";
import { Check } from "lucide-react";
import { tr, useLanguage } from "./language";

export type WorkflowStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const steps = [
  [1, "选柜型", "Container"],
  [2, "选包装", "Packaging"],
  [3, "录入货物", "Cargo"],
  [4, "布置预览", "Layout"],
  [5, "装载规则", "Rules"],
  [6, "核对计算", "Review"],
  [7, "查看方案", "Results"],
] as const;

export function WorkflowSteps({current,onSelect,workflow="palletized"}:{
  workflow?:LoadingWorkflow;current:WorkflowStep; onSelect:(step:WorkflowStep)=>void;
}) {
  useLanguage();
  return <nav className="wizard-steps" aria-label={tr("装柜计算步骤","Loading workflow")}>
    {steps.map(([id,label,en])=><button type="button" key={id} aria-current={current===id?"step":undefined}
      className={current===id?"current":id<current?"complete":""} disabled={id>current}
      onClick={()=>onSelect(id)}>
      <span className="wizard-step-number" aria-hidden="true">{id<current?<Check size={15}/>:id}</span>
      <strong>{id===2&&(workflow==="direct"||workflow==="single-capacity")?tr("底托选项","Floor options"):id===4&&(workflow==="direct"||workflow==="single-capacity")?tr("散箱布置","Loose layout"):id===1&&workflow==="pallet-only"?tr("装载方式","Workflow"):tr(label,en)}</strong>
    </button>)}
  </nav>;
}
