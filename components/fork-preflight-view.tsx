"use client";
import {forkBaseParts,FORK_ISSUE_TEXT,type ForkCheck} from "../lib/packing/fork-interface";
import type {FloorPalletConfig} from "../lib/packing/types";
import {tr,useLanguage} from "./language";
export function ForkPreflightResult({check}:{check:ForkCheck}){
 useLanguage();return <section className="fork-preflight-result" aria-label={tr("进叉预检结果","Fork preflight result")}>
 <p><strong>{check.state==="pass"?tr("所填叉具几何通过","Entered fork geometry passed"):check.state==="fail"?tr("所填叉具几何不通过","Entered fork geometry failed"):tr("叉具几何未核验","Fork geometry unverified")}</strong> · {check.evidence==="reviewed"?tr("当前资料已核对","Current evidence reviewed"):tr("资料或实测核对缺失","Evidence or measurement review missing")}</p>
 <p>{check.scope==="vehicle"?tr("按最终整托姿态检查直线进叉与完全抽出的包络；周围货物按当前完整方案静止处理，未求作业顺序。","Straight insertion and full withdrawal at the final unit pose; surrounding cargo is held fixed in the complete plan. Handling order is not solved."):check.scope==="inspection"?tr("仅核对本托局部几何；编组区坐标不代表实际作业场地。","Local unit geometry only; inspection coordinates are not a real worksite."):tr("仅核对底座局部几何，柜内周边须在逐托预检中另查。","Local base geometry only; check vehicle surroundings in the unit preflight.")}</p>
 {!!check.issues.length&&<ul>{check.issues.map((issue,i)=><li key={i}>{tr(...FORK_ISSUE_TEXT[issue.code])}{issue.ids.length?` · ${issue.ids.slice(0,8).join(" / ")}${issue.ids.length>8?` (+${issue.ids.length-8})`:""}`:""}</li>)}</ul>}
 <p className="feature-note">{tr("设备能力、叉车本体、起升／转弯、承托受力、动态载荷和现场试装未核验。几何通过不能用于作业放行。","Equipment capacity, truck body, lifting / turning, support forces, dynamic loads and field trials remain unverified. A geometric pass does not authorize operations.")}</p>
 </section>;
}
export function ForkGeometryView({config,check}:{config:FloorPalletConfig;check:ForkCheck}){
 useLanguage();let parts;try{parts=forkBaseParts(config);}catch{return <p>{tr("先修正底座尺寸再显示通道。","Correct the base dimensions to view channels.")}</p>;}
 const boxes=[{x:0,y:0,dx:config.length,dy:config.width},...check.sweeps],minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.dx)),maxY=Math.max(...boxes.map(b=>b.y+b.dy)),pad=Math.max(maxX-minX,maxY-minY)*.04,color=check.state==="fail"?"#bc5037":"#267d9b";
 const alongX=(config.forkInterface?.direction??"x-min").startsWith("x"),span=alongX?config.width:config.length;
 return <div className="fork-geometry-views"><svg viewBox={`${minX-pad} ${minY-pad} ${maxX-minX+2*pad} ${maxY-minY+2*pad}`} role="img" aria-label={tr("双叉与完全抽出包络俯视图","Twin forks and full-withdrawal envelope top view")}>
 <rect width={config.length} height={config.width} fill="#eef4f4" stroke="#839b9d"/>{parts.map((b,i)=><rect key={i} x={b.x} y={b.y} width={b.dx} height={b.dy} fill="#b29169" fillOpacity={.22} stroke="#9b825d" strokeWidth={1}><title>{`base/${i+1}`} · {b.x}/{b.y}/{b.z} · {b.dx}×{b.dy}×{b.dz}</title></rect>)}
 {check.sweeps.map((b,i)=><rect key={`s${i}`} x={b.x} y={b.y} width={b.dx} height={b.dy} fill={color} fillOpacity={.08} stroke={color} strokeWidth={3} strokeDasharray="12 8"/>)}{check.forks.map((b,i)=><rect key={`f${i}`} x={b.x} y={b.y} width={b.dx} height={b.dy} fill={color} fillOpacity={.55}/>)}
 </svg><svg viewBox={`-5 -5 ${span+10} ${config.height+10}`} role="img" aria-label={tr("进叉通道全深度横截面投影","Full-depth fork-channel cross-section projection")}>
 <rect width={span} height={config.height} fill="#f0f5f5"/>{parts.map((b,i)=><rect key={i} x={alongX?b.y:b.x} y={config.height-b.z-b.dz} width={alongX?b.dy:b.dx} height={b.dz} fill="#b29169" fillOpacity={.25} stroke="#9b825d"/>)}
 {check.forks.map((b,i)=><rect key={i} x={alongX?b.y:b.x} y={config.height-b.z-b.dz} width={alongX?b.dy:b.dx} height={b.dz} fill={color} fillOpacity={.7}/>)}
 </svg></div>;
}
