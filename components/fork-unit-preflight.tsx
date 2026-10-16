"use client";
import {useState} from "react";
import {forkConfigForPallet,forkReport,inspectForkInterface,inspectPlanFork,FORK_DIRECTION_TEXT,FORK_NUMBERS,FORK_NUMBER_TEXT} from "../lib/packing/fork-interface";
import type {PackingResult} from "../lib/packing/types";
import {FeatureDialog} from "./feature-dialog";
import {ForkGeometryView,ForkPreflightResult} from "./fork-preflight-view";
import {tr,useLanguage} from "./language";
export function ForkUnitPreflight({plan,id,disabled=false,onClose}:{plan:PackingResult;id:string;disabled?:boolean;onClose:()=>void}){
 useLanguage();const [error,setError]=useState("");const pallet=plan.pallets?.find(p=>p.id===id),config=pallet&&forkConfigForPallet(plan,pallet);
 if(!pallet||!config)return null;const check=inspectPlanFork(plan,id),p=config.forkInterface;
 const download=()=>{try{const report=forkReport(plan,id),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download=`fork-preflight-${id.replace(/[^a-zA-Z0-9_-]/g,"_")}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:String(e));}};
 return <FeatureDialog title={`${tr("逐托进叉预检","Unit fork preflight")} · ${id}`} subtitle={tr("独立预检不会移动货物，也不改变方案复核或放行状态。","This independent preflight does not move cargo or alter plan review or handling authorization.")} wide onClose={onClose} footer={<><button type="button" className="button" onClick={onClose}>{tr("关闭","Close")}</button><button type="button" className="button primary" disabled={disabled||!plan.validation.valid} onClick={download}>{tr("导出进叉预检 JSON","Export fork preflight JSON")}</button></>}>
 <p>{config.name} · {pallet.orientation} · XYZ {pallet.x}/{pallet.y}/{pallet.z} mm</p><ForkPreflightResult check={check}/>
 <p>{tr("下图为本托原始局部底座；周边阻挡在上方列表和下方装柜坐标中报告。","The drawing uses the unit's original local base; surroundings are reported above and in the plan coordinates below.")}</p><ForkGeometryView config={config} check={inspectForkInterface(config)}/>
 {p?<><p>{tr(...FORK_DIRECTION_TEXT[p.direction])}</p><dl className="fork-parameter-list">{FORK_NUMBERS.map(k=><div key={k}><dt>{tr(...FORK_NUMBER_TEXT[k])}</dt><dd>{p[k]} mm</dd></div>)}</dl><p>{tr("资料来源／版本","Source / revision")}: {p.source||"—"} / {p.revision||"—"}</p><p>{tr("静载／动载／货架载荷 kg（0 为未知）","Static / dynamic / rack payload kg (0 means unknown)")}: {p.ratings.staticKg} / {p.ratings.dynamicKg} / {p.ratings.rackKg} · {p.ratings.source||"—"}</p></>:<p>{tr("该规格没有叉具资料；请返回打托配置填写。","This specification has no fork data; enter it in pallet-building settings.")}</p>}
 {!!check.sweeps.length&&<div className="upgrade-table-wrap"><table><caption>{tr("完全抽叉扫掠包络（方案坐标 mm）","Full-withdrawal sweep (plan coordinates in mm)")}</caption><thead><tr><th>#</th><th>X / Y / Z</th><th>L / W / H</th></tr></thead><tbody>{check.sweeps.map((b,i)=><tr key={i}><td>{i+1}</td><td>{[b.x,b.y,b.z].map(n=>n.toFixed(1)).join(" / ")}</td><td>{[b.dx,b.dy,b.dz].map(n=>n.toFixed(1)).join(" / ")}</td></tr>)}</tbody></table></div>}{error&&<p role="alert">{error}</p>}
 </FeatureDialog>;
}
