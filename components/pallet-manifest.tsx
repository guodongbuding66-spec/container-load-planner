"use client";
import {tr, useLanguage} from "./language";
import type { PackingResult } from "../lib/packing/types";
import { palletCargoCeiling } from "../lib/packing/floor-pallets";
export function PalletManifest({result}:{result:PackingResult}) {
  useLanguage();
  if(!result.pallets?.length)return null;
  const config=result.palletization?.config??result.floorPallets;
  const ceiling=config?palletCargoCeiling(result.container,result.clearance,config):0;
  const loadedTops = new Map<string, number>();
  for (const box of result.placements) {
    for (const id of box.palletIds ?? []) loadedTops.set(id, Math.max(loadedTops.get(id) ?? 0, box.z + box.dz));
  }
  return <article className="panel pallet-manifest"><div className="panel-head"><div><span className="section-kicker">PALLET PLACEMENT</span><h2>{tr(result.palletization?"整托入柜与货物基准":"托盘铺设与货物基准",result.palletization?"Loaded pallets and cargo coordinates":"Floor pallets and cargo coordinates")}</h2><p>{result.palletization?tr("先按每托关联清单完成打托，再按托盘坐标将完整托盘装入柜内。XYZ 从柜内净空原点起算，货物 Z 已含底座高度。","Build each associated pallet load first, then place complete pallets at the listed coordinates. XYZ uses the clear-space origin; cargo Z includes deck height."):tr("先按托盘记录铺设底座，再按货物坐标装货。X 沿柜长、Y 沿柜宽、Z 从柜底起算，均为 mm。")}</p></div><span className="pill">{result.pallets.length}{tr(" 个托盘")}</span></div><div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>{tr("托盘编号")}</th><th>{tr("规格")}</th><th>X / Y / Z</th><th>{tr("长 × 宽 × 高")}</th><th>{tr("自重")}</th><th>{tr("额定承重")}</th><th>{tr("货物起始 Z")}</th><th>{tr("已装货物最高 Z")}</th><th>{tr("允许最高 Z")}</th></tr></thead><tbody>{result.pallets.map(p=><tr key={p.id}><td>{p.id}</td><td>{tr(p.name)}</td><td>{p.x} / {p.y} / {p.z}</td><td>{p.dx} × {p.dy} × {p.dz}</td><td>{p.weight} kg</td><td>{p.maxLoad} kg</td><td>{p.z+p.dz}</td><td>{loadedTops.get(p.id) ?? tr("未装货")}</td><td>{ceiling || "—"}</td></tr>)}</tbody></table></div><p className="table-note">{tr("已装货物最高 Z 按完整方案的实际箱位计算，播放和隐藏货物不改变此值。X/Y 原点为扣除安全间隙后的净空起点；货物 Z 已包含托盘高度，现场执行时无需再次加高。CSV、JSON、PDF 与三维视图使用同一份坐标。")}</p></article>;
}
