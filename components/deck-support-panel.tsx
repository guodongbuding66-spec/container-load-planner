"use client";
import {buildDeckSupportCsv} from "../lib/packing/csv";
import {useMemo} from "react";
import {inspectDeckSupports} from "../lib/packing/deck-support";
import {ACCESSORY_SUPPORT_STATES} from "../lib/packing/accessory-support";
import type {PackingResult,ProductInput} from "../lib/packing/types";
import {tr,useLanguage} from "./language";
export function DeckSupportPanel({result,products,disabled=false}:{result:PackingResult;products?:readonly ProductInput[];disabled?:boolean}){
 const language=useLanguage();const rows=useMemo(()=>inspectDeckSupports(result,products),[result,products]);if(!rows.length)return null;
 const download=()=>{const url=URL.createObjectURL(new Blob(["\ufeff",buildDeckSupportCsv(result,products,language==="en")],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="deck-supports.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <section className="deck-support-report"><h3>{tr("托内支承件与累计静载","Deck supports and cumulative static load")}</h3><p>{tr("自重已计入整托包装重量，支承件高度已计入货物坐标及整托外形。累计上压按接触面积传递；符合输入静载不证明抗弯、刚度或运输动态强度。","Support tare is included in complete packaging mass; support height is included in cargo coordinates and the unit envelope. Upper load is shared by contact area; meeting entered static limits does not certify bending, stiffness or transport dynamics.")}</p>
 <button type="button" className="button small" disabled={disabled||!result.validation.valid} onClick={download}>{tr("导出托内支承清单 CSV","Export deck support CSV")}</button>
 <div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>{tr("托盘／支承件","Pallet / support")}</th><th>{tr("新增自重 kg","Added tare kg")}</th><th>{tr("上方累计 kg","Cumulative upper kg")}</th><th>{tr("输入上限 kg","Entered limit kg")}</th><th>{tr("状态","State")}</th><th>{tr("来源／版本","Source / revision")}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.palletId} / {r.name}</td><td>{r.weightKg}</td><td>{r.loadKg?.toFixed(2)??"—"}</td><td>{r.limitKg??tr("未填写","Not entered")}</td><td>{tr(...ACCESSORY_SUPPORT_STATES[r.state])}</td><td>{r.source||tr("来源未填写","Source unspecified")} / {r.revision||"—"}</td></tr>)}</tbody></table></div></section>;
}
