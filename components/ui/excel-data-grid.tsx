"use client";
import {useState,type ReactNode} from "react";
import {gridTsv,gridWorkbook,type GridValue} from "../../lib/packing/data-grid-export";
import {RecordPageControls,useRecordPage} from "../record-page";
import {tr,useLanguage} from "../language";
export type GridColumn<T>={id:string;header:string;numeric?:boolean;value:(row:T)=>GridValue;render?:(row:T)=>ReactNode};
export function ExcelDataGrid<T extends {id:string;search:string}>({rows,columns,label,exportRows=rows}:{rows:T[];columns:GridColumn<T>[];label:string;exportRows?:T[]}){
 useLanguage();const page=useRecordPage(rows),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const headers=columns.map(c=>c.header),values=()=>exportRows.map(row=>columns.map(c=>c.value(row)));
 const copy=async()=>{try{await navigator.clipboard.writeText(gridTsv(headers,values()));setMessage(tr("已复制全部原始明细","All original rows copied"));}catch{setMessage(tr("复制失败，请使用 Excel 导出","Copy unavailable; export Excel instead"));}};
 const exportExcel=async()=>{setBusy(true);try{const bytes=await gridWorkbook(headers,values()),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})),link=document.createElement("a");link.href=url;link.download="CargoFit-pallet-details.xlsx";link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage(tr("已导出全部原始明细","All original rows exported"));}catch{setMessage(tr("导出失败，请重试","Export failed; please retry"));}finally{setBusy(false);}};
 return <div className="excel-data-grid"><div className="data-grid-actions"><button type="button" className="button small" onClick={copy}>{tr("复制全部明细","Copy all rows")}</button><button type="button" className="button small" disabled={busy} onClick={exportExcel}>{busy?tr("正在导出…","Exporting…"):tr("导出 Excel","Export Excel")}</button><span role="status">{message}</span></div>
 <RecordPageControls page={page} label={label} placeholder={tr("托号或包装规格","Unit ID or packaging")}/>
 <div className="excel-data-grid-scroll" role="region" aria-label={label} tabIndex={0}><table><thead><tr>{columns.map(c=><th scope="col" key={c.id} className={c.numeric?"numeric":undefined}>{c.header}</th>)}</tr></thead><tbody>{page.rows.map(row=><tr key={row.id}>{columns.map(c=><td key={c.id} className={c.numeric?"numeric":undefined}>{c.render?c.render(row):c.value(row)??"—"}</td>)}</tr>)}</tbody></table>{!page.count&&<p>{tr("没有匹配记录，请调整搜索内容。","No records match. Change the search.")}</p>}</div></div>;
}
