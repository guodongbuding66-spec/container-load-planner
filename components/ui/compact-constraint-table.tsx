"use client";
import type {ComponentProps,ReactNode} from "react";
import {StatusBadge} from "./status-badge";
import {tr,useLanguage} from "../language";
export type ConstraintRow={id:string;sku:string;layers:ReactNode;payload:ReactNode;topLoad:ReactNode;state:ComponentProps<typeof StatusBadge>["tone"];status:string};
export function CompactConstraintTable({rows,payloadHeader}:{rows:ConstraintRow[];payloadHeader?:string}){
 useLanguage();return <div className="upgrade-table-wrap"><table className="compact-constraint-table"><thead><tr><th scope="col">SKU</th><th scope="col">{tr("可放层数","Layer bound")}</th><th scope="col">{payloadHeader??tr("单托载荷上限","Pallet load limit")}</th><th scope="col">{tr("上压资料","Top-load evidence")}</th><th scope="col">{tr("状态","Status")}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><th scope="row">{r.sku}</th><td>{r.layers}</td><td>{r.payload}</td><td>{r.topLoad}</td><td><StatusBadge tone={r.state}>{r.status}</StatusBadge></td></tr>)}</tbody></table></div>;
}
