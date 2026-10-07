"use client";

import {tr, useLanguage} from "./language";
import { useId, useState, type ReactNode } from "react";
import { Archive, Boxes, Cloud, ShieldCheck, Truck, Search, Move, ClipboardCheck, FileText, ChevronDown } from "lucide-react";

const icons = {archive:Archive,catalog:Boxes,cloud:Cloud,bearing:ShieldCheck,fleet:Truck,diagnosis:Search,manual:Move,field:ClipboardCheck,report:FileText};

export function ToolSummary({kind,title,description}:{kind:keyof typeof icons;title:string;description:string}) {
  useLanguage();
  const Icon=icons[kind];
  return <summary aria-label={title}>
    <span className="tool-icon" aria-hidden="true"><Icon size={21}/></span>
    <span className="tool-summary-text"><strong>{title}</strong><small>{tr(description)}</small></span>
    <ChevronDown className="tool-chevron" size={18} aria-hidden="true"/>
  </summary>;
}

const groups=[{id:"projects",label:"项目与资料",description:"保存方案、管理包装版本与云端资料",icon:Archive},{id:"loading",label:"装载优化",description:"设置承重、调整箱位与比较多柜方案",icon:Truck},{id:"delivery",label:"交付与现场",description:"生成客户报告与仓库装载指导",icon:ClipboardCheck}] as const;

export function WorkflowTools({projects,loading,delivery}:{projects:ReactNode;loading:ReactNode;delivery:ReactNode}) {
  useLanguage();
  const [active,setActive]=useState<typeof groups[number]["id"]>("projects");
  const id=useId();
  const content={projects,loading,delivery};
  return <section className="planning-upgrades" aria-label={tr("方案管理与高级装载工具")}>
    <div className="workflow-heading"><div><span className="section-kicker">WORKFLOW</span><h2>{tr("方案工具")}</h2></div><p>{tr("从保存方案，到装柜交付。")}</p></div>
    <div className="workflow-switcher" role="group" aria-label={tr("方案工具分类")}>{groups.map(({id:key,label,description,icon:Icon})=><button type="button" key={key} aria-pressed={active===key} aria-controls={`${id}-${key}`} onClick={()=>setActive(key)}><Icon size={18} aria-hidden="true"/><span><strong>{tr(label)}</strong><small>{tr(description)}</small></span></button>)}</div>
    {groups.map(group=><div key={group.id} id={`${id}-${group.id}`} className="workflow-group" hidden={active!==group.id} role="region" aria-label={tr(group.label)}>
      {content[group.id]}
    </div>)}
  </section>;
}
