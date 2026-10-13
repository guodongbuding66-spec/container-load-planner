"use client";
import type { HeatMode, LoadAnalysis, LoadStatus } from "../lib/packing/load-analysis";
import type { PlacedBox } from "../lib/packing/types";
import { tr, useLanguage } from "./language";
export function SceneLoadPanel({report,mode,onMode,selected}:{report:LoadAnalysis|null;mode:HeatMode;onMode:(mode:HeatMode)=>void;selected:PlacedBox|null}){
  useLanguage();const statuses:Record<LoadStatus,string>={verified:tr("已核验","Verified"),unknown:tr("缺少承重数据","Missing load rating"),overload:tr("超过承重","Overloaded"),"no-load":tr("无上压，承重参数未填写","No top load; rating unspecified")};
  const current=report?.[selected?.supportOnly?"pallets":"boxes"].find(b=>b.id===selected?.id);
  return <details open className="scene-analysis-panel"><summary>{tr("承重与配重可视化","Load and balance visualization")}</summary><div className="scene-inspector-section"><label>{tr("热力图","Heatmap")}<select aria-label={tr("承重热力图","Load heatmap")} value={mode} onChange={e=>onMode(e.target.value as HeatMode)}>{[["off","关闭","Off"],["top","箱体累计上压","Cumulative carton top load"],["pallet","托盘负荷","Pallet payload"],["zone","柜长分区重量","Weight by length zone"]].map(([v,zh,en])=><option key={v} value={v}>{tr(zh,en)}</option>)}</select></label>
    {report&&<><div className="scene-load-legend">{mode==="zone"?<><span><i style={{background:"#2b8d83"}}/>{tr("相对较轻","Lighter zone")}</span><span><i style={{background:"#d7ae38"}}/>{tr("中等重量","Medium weight")}</span><span><i style={{background:"#d58425"}}/>{tr("相对较重","Heavier zone")}</span></>:<><span><i style={{background:"#2b8d83"}}/>≤50%</span><span><i style={{background:"#d7ae38"}}/>&gt;50–75%</span><span><i style={{background:"#d58425"}}/>&gt;75–100%</span><span><i style={{background:"#c23832"}}/>&gt;100%</span><span><i style={{background:"#7d8393"}}/>{tr("未核验","Unknown")}</span></>}</div>
      <p>{tr("缺少承重数据的受压箱体","Loaded cartons missing ratings")}: {report.unknown}</p>
      {current&&<output className="scene-measure-result"><strong>{current.load.toFixed(2)} kg</strong><span>{statuses[current.status]}</span><span>{tr("允许承重","Load rating")}: {current.limit===undefined?tr("未填写","Unspecified"):`${current.limit} kg`}</span></output>}
      {mode==="pallet"&&report.pallets.map(p=><p key={p.id}>{p.id.replace("floor-pallet-","P")} · {p.load.toFixed(1)} / {p.limit} kg · {statuses[p.status]}</p>)}
      {mode==="zone"&&report.zones.map((z,i)=><p key={z.id}>{tr("分区","Zone")} {i+1} · {z.weight.toFixed(2)} kg</p>)}
      <p>{tr(mode==="zone"?"分区重量按箱体跨区体积分配，包含托盘自重；颜色为相对重量，不是车辆轴荷。":"静态竖向载荷按接触面积向下累计；未填写承重参数不会显示为已核验。",mode==="zone"?"Zone weight is apportioned by the box volume crossing each zone, including pallet tare. Colors compare weights; they are not axle loads.":"Static vertical load accumulates by contact area. Missing ratings are never marked verified.")}</p>
    </>}
  </div></details>;
}
