"use client";
import { Check, Boxes, Container, Layers3 } from "lucide-react";
import { tr, useLanguage } from "./language";

const steps=[{id:1,label:"货物清单",en:"Cargo list",detail:"箱规、重量与数量",icon:Boxes},{id:2,label:"装载配置",en:"Load setup",detail:"柜型、托盘与规则",icon:Container},{id:3,label:"装箱方案",en:"Loading plan",detail:"三维、余量与坐标",icon:Layers3}] as const;
export function WorkflowSteps({current,resultAvailable,onSelect,palletOnly=false}:{current:1|2|3;resultAvailable:boolean;onSelect:(step:1|2|3)=>void;palletOnly?:boolean}) {
  useLanguage();
  return <nav className="wizard-steps" aria-label={tr("装柜计算步骤","Loading workflow")}>
    {steps.map(({id,label,en,detail,icon:Icon})=><button key={id} aria-current={current===id?"step":undefined} disabled={id===3&&!resultAvailable} className={`${current===id?"current":""} ${id<current?"complete":""}`} onClick={()=>onSelect(id)}>
      <span className="wizard-step-number">{id<current?<Check size={18}/>:id}</span><span className="wizard-step-copy"><strong>{tr(palletOnly && id===3?"打托方案":label,palletOnly && id===3?"Pallet plan":en)}</strong><small>{palletOnly&&id===2?tr("托盘、限高与打托规则","Pallet, height and build rules"):tr(detail)}</small></span><Icon size={20} aria-hidden="true"/>
    </button>)}
  </nav>;
}
