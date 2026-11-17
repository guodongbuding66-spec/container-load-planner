"use client";
import {Check, Boxes, Container, PackageOpen} from "lucide-react";
import {tr, useLanguage} from "./language";

export type WorkflowStep = 1 | 2 | 3 | 4;

const steps = [
  {id:1,label:"装载空间",en:"Load space",icon:Container},
  {id:2,label:"打托包装",en:"Packaging",icon:PackageOpen},
  {id:3,label:"货物与托内布置",en:"Cargo & layout",icon:Boxes},
] as const;

export function WorkflowSteps({current,onSelect}: {
  current:WorkflowStep;onSelect:(step:WorkflowStep)=>void;
}) {
  useLanguage();
  const activeStep=current===4?3:current;
  return <nav className="wizard-steps" aria-label={tr("装柜计算步骤","Loading workflow")}>
    {steps.map(({id,label,en,icon:Icon})=><button key={id} aria-current={activeStep===id?"step":undefined} className={`${activeStep===id?"current":""} ${id<activeStep?"complete":""}`} onClick={()=>onSelect(id)}>
      <span className="wizard-step-number" aria-hidden="true">{id<activeStep?<Check size={16}/>:id}</span>
      <span className="wizard-step-copy"><strong>{tr(label,en)}</strong></span>
      <Icon size={19} aria-hidden="true"/>
    </button>)}
  </nav>;
}
