"use client";
import type { CenterOfGravityReport } from "../lib/packing/vgm-cog";
import {tr,useLanguage} from "./language";

export function CenterOfGravityMap({report}:{report:CenterOfGravityReport}) {
 useLanguage();
 return <figure className="cog-diagram" style={{margin:"12px 0",maxWidth:720}}>
  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text-secondary)"}}><span>{tr("柜头 0%","Nose 0%")}</span><span>{tr("柜门 100%","Door 100%")}</span></div>
  <svg viewBox="0 24 600 92" role="img" aria-label={tr("重心俯视图，建议长向与横向均为40%至60%","Center of gravity: recommended 40–60% along both axes")} style={{display:"block",width:"100%",height:"auto",background:"var(--bg-subtle)",border:"1px solid var(--border-card)",borderRadius:6}}>

   <rect x="30" y="28" width="540" height="84" fill="none" stroke="var(--border-card)"/>
   <rect data-cog-zone="40-60" x="246" y="61.6" width="108" height="16.8" fill="var(--teal-soft)" stroke="var(--brand-primary)" strokeDasharray="4 3"/>
   <line x1="300" x2="300" y1="28" y2="112" stroke="var(--border-card)" strokeDasharray="3 3"/>
   <line x1="30" x2="570" y1="70" y2="70" stroke="var(--border-card)" strokeDasharray="3 3"/>
   <circle data-cog-marker="true" cx={30+report.cogXPct*5.4} cy={28+report.cogYPct*.84} r="6" stroke="white" strokeWidth="2" fill={report.status==="balanced"?"#0F766E":"#D97706"}/>

  </svg>
  <figcaption style={{display:"grid",gap:4,marginTop:6,fontSize:12,lineHeight:1.5,color:"var(--text-secondary)"}}><strong>X {report.cogXPct}% · Y {report.cogYPct}% · Z {report.cogZPct}%</strong><span>{tr("绿色窗口：长向、横向40–60%；按可用内尺计算","Green window: 40–60% on each axis, using usable dimensions")}</span></figcaption>
 </figure>;
}
