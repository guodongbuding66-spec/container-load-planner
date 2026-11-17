"use client";

import {useMemo,type ReactNode} from "react";
import {RecordPageControls,useRecordPage} from "./record-page";
import {tr,tt,useLanguage} from "./language";
import type {PackingResult} from "../lib/packing/types";

const number=(value:number)=>value.toLocaleString("en-US",{maximumFractionDigits:1});

export function PlacementManifest({result,actions,printing=false}:{result:PackingResult;actions:ReactNode;printing?:boolean}) {
  useLanguage();
  const records=useMemo(()=>result.placements.map((box,index)=>{
    const row=index+1,batch=result.cargoDetails?.[box.productId]?.orderLine?.batch??"";
    return {box,row,batch,search:[`#${row}`,box.sku,box.productId,box.id,box.setCode,box.setNumber,...(box.palletIds??[]),batch].join(" ")};
  }),[result]);
  const kitSizes=useMemo(()=>new Map(result.setSummaries.map(set=>[set.setCode,set.cartonsPerSet])),[result.setSummaries]);
  const page=useRecordPage(records,15);
  const rows=printing?records.slice(0,80):page.rows;
  return <article id="coordinates" className="panel coordinate-panel record-panel" tabIndex={-1} aria-labelledby="coordinates-heading">
    <div className="panel-head"><div><h2 id="coordinates-heading">{tr("三维坐标与装载清单")}</h2><p>{number(records.length)} {tr("条箱位 · 导出包含完整方案","carton positions · exports include the full plan")}</p></div>{actions}</div>
    <details className="record-disclosure" open={printing||undefined}>
      <summary>{tr("查看箱位明细","View carton positions")}</summary>
      <RecordPageControls page={page} label={tr("搜索箱位","Search carton positions")} placeholder={tr("序号、SKU、托号、套装或批次","Row, SKU, pallet, kit or batch")}/>
      {printing&&records.length>80&&<p className="helper-text">{tr("打印前 80 条箱位，完整清单见坐标 CSV。","The first 80 positions are printed. See the CSV for the full list.")}</p>}
      {rows.length>0&&<div className="coordinate-wrap record-table" role="region" aria-label={tr("箱位坐标表","Carton coordinates table")} tabIndex={0}>
        <table className="coordinate-table">
          <thead><tr><th>#</th><th>SKU</th><th>{tr("整托","Pallet")}</th><th>{tr("套装 / 套号")}</th><th>X</th><th>Y</th><th>Z</th><th>{tr("摆放尺寸（长×宽×高）")}</th><th>{tr("方向")}</th><th>{tr("层级")}</th><th>{tr("重量")}</th><th>{tr("订单行 ID","Order-line ID")}</th><th>{tr("批次","Batch")}</th></tr></thead>
          <tbody>{rows.map(({box,row,batch})=><tr key={box.id}><td>{row}</td><td><i style={{background:box.color}}/>{box.sku}</td><td>{box.palletIds?.join(", ")||"—"}</td><td>{box.setCode?tt`${box.setCode} · 第 ${box.setNumber} 套 · ${box.setItemNumber}/${kitSizes.get(box.setCode)??""}`:tr("散箱")}</td><td>{number(box.x)}</td><td>{number(box.y)}</td><td>{number(box.z)}</td><td>{number(box.dx)} × {number(box.dy)} × {number(box.dz)} mm</td><td>{box.orientation}</td><td>{tt`第 ${box.layer} 层`}</td><td>{box.weight} kg</td><td style={{overflowWrap:"anywhere"}}>{box.productId}</td><td>{batch}</td></tr>)}</tbody>
        </table>
      </div>}
    </details>
  </article>;
}
