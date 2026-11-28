"use client";
import type { CenterOfGravityReport } from "../lib/packing/vgm-cog";
import {tr,useLanguage} from "./language";

export function CenterOfGravityMap({report}:{report:CenterOfGravityReport}) {
 useLanguage();
 return <figure className="cog-diagram" style={{margin:"12px 0",maxWidth:720}}>
  <svg viewBox="0 0 600 160" role="img" aria-label={tr("重心俯视图，建议长向与横向均为40%至60%","Center of gravity: recommended 40–60% along both axes")} style={{display:"block",width:"100%",height:"auto",background:"var(--bg-subtle)",border:"1px solid var(--border-card)",borderRadius:6}}>
   <text x="30" y="18" fontSize="11" fill="var(--text-secondary)">{tr("柜头 0%","Nose 0%")}</text><text x="480" y="18" fontSize="11" fill="var(--text-secondary)">{tr("柜门 100%","Door 100%")}</text>
   <rect x="30" y="28" width="540" height="84" fill="none" stroke="var(--border-card)"/>
   <rect data-cog-zone="40-60" x="246" y="61.6" width="108" height="16.8" fill="var(--teal-soft)" stroke="var(--brand-primary)" strokeDasharray="4 3"/>
   <line x1="300" x2="300" y1="28" y2="112" stroke="var(--border-card)" strokeDasharray="3 3"/>
   <line x1="30" x2="570" y1="70" y2="70" stroke="var(--border-card)" strokeDasharray="3 3"/>
   <circle data-cog-marker="true" cx={30+report.cogXPct*5.4} cy={28+report.cogYPct*.84} r="6" stroke="white" strokeWidth="2" fill={report.status==="balanced"?"#0F766E":"#D97706"}/>
   <text x="30" y="132" fontSize="11" fill="var(--text-secondary)">X {report.cogXPct}% · Y {report.cogYPct}% · Z {report.cogZPct}%</text>
   <text x="30" y="150" fontSize="10" fill="var(--text-muted)">{tr("绿色窗口：长向、横向40–60%；按可用内尺计算","Green window: 40–60% on each axis, using usable dimensions")}</text>
  </svg>
 </figure>;
}
