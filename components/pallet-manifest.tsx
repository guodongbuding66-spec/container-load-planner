"use client";
import { useState } from "react";
import { PalletUnitViewer } from "./pallet-unit-viewer";
import { tr, useLanguage } from "./language";
import type { PackingResult } from "../lib/packing/types";
import { palletCargoCeiling } from "../lib/packing/floor-pallets";
export function PalletManifest({ result }: { result: PackingResult }) {
  useLanguage();
  const [inspect,setInspect]=useState<string|null>(null);
  if (!result.pallets?.length) return null;
  const config = result.palletization?.config ?? result.floorPallets;
  const ceiling = config ? palletCargoCeiling(result.container, result.clearance, config) : 0;
  const only = result.workflow === "pallet-only", prepared = result.palletization?.preparedCount ?? result.pallets.length;
  const rows = result.pallets.map(p => {
    const cargo = result.placements.filter(b => b.palletIds?.includes(p.id));
    const top = Math.max(p.z + p.dz, ...cargo.map(b => b.z + b.dz));
    const contents = new Map<string, number>(); for (const b of cargo) contents.set(b.sku, (contents.get(b.sku) ?? 0) + 1);
    return { p, cargo, top, height: Math.max(top,p.z+(p.enclosureHeight??p.dz)) - p.z, gross: p.weight + cargo.reduce((n,b)=>n+b.weight,0), contents: [...contents].map(([sku,n])=>`${sku} × ${n}`).join(" · ") };
  });
  return <article className="panel pallet-manifest">
    <div className="panel-head"><div><span className="section-kicker">PALLET PLACEMENT</span><h2>{only ? tr("打托清单与托内货物", "Pallet manifest and contents") : tr(result.palletization ? "整托入柜与货物基准" : "托盘铺设与货物基准", result.palletization ? "Loaded pallets and cargo coordinates" : "Floor pallets and cargo coordinates")}</h2>
      <p>{only ? tr("各托盘独立打托；XYZ 为三维编组查看坐标，不是装柜指令。", "Build each pallet independently. XYZ coordinates are for inspection, not vehicle loading.") : result.palletization ? tr("先按关联清单完成打托，再按完整托盘坐标装柜；上层底座与托内货物同步定位。", "Build the listed pallet contents first, then load complete pallets. Elevated decks and their cargo share the same placement.") : tr("先铺底座再装货；货物 Z 已包含底座高度。", "Place decks first; cargo Z already includes deck height.")}</p></div><span className="pill">{result.pallets.length}{tr(" 个托盘")}</span></div>
    {!!result.palletization && <p className="helper-text">{only ? tr("已生成 / 当前清单", "Prepared / in this manifest") : tr("已生成 / 当前方案 / 未入柜", "Prepared / in this plan / not loaded")}: {prepared} / {result.pallets.length}{!only && ` / ${prepared-result.pallets.length}`}{result.palletization.bounded ? tr(" · 达到搜索上限，剩余订单仍保留", " · Search limit reached; unmet quantities are retained") : ""}</p>}
    <div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>{tr("托盘编号")}</th><th>{tr("托内货物", "Pallet contents")}</th><th>{tr("箱数", "Cartons")}</th><th>{tr("整托总高", "Loaded height")} mm</th><th>{tr("整托总重", "Gross weight")} kg</th><th>X / Y / Z</th><th>{tr("长 × 宽 × 高")}</th><th>{tr("自重")}</th><th>{tr("额定承重")}</th><th>{tr("货物起始 Z")}</th><th>{tr("已装货物最高 Z")}</th><th>{tr("允许最高 Z")}</th></tr></thead><tbody>{rows.map(({p,cargo,top,height,gross,contents})=><tr key={p.id}><td><button className="pallet-inspect-button" type="button" aria-label={`${tr("查看整托","Inspect unit")} ${p.id}`} onClick={()=>setInspect(p.id)}>{p.id}<small>{tr("独立查看","Inspect unit")}</small></button></td><td>{contents}</td><td>{cargo.length}</td><td>{height.toFixed(1)}</td><td>{gross.toFixed(1)}</td><td>{p.x} / {p.y} / {p.z}</td><td>{p.dx} × {p.dy} × {p.dz}</td><td>{p.weight} kg</td><td>{p.maxLoad} kg</td><td>{p.z+p.dz}</td><td>{cargo.length?top:tr("未装货")}</td><td>{ceiling ? Math.min(result.container.height-result.clearance,p.z+ceiling) : "—"}</td></tr>)}</tbody></table></div>
    {inspect&&result.pallets.some(p=>p.id===inspect)&&<PalletUnitViewer result={result} id={inspect} onClose={()=>setInspect(null)}/>}
    <p className="table-note">{tr("数量、高度、重量和关联清单按完整方案统计，播放和剖切不改变此值；货物 Z 已包含底座高度，无需再次加高。", "Counts, heights, weights and contents use the complete plan; playback and sectioning do not alter them. Cargo Z includes deck height; do not add it again.")}</p>
  </article>;
}
