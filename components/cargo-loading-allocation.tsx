"use client";

import {useEffect,useMemo,useState} from "react";
import {cargoAllocationGroups,looseReservationErrors,withCargoAllocation,type LooseQuantities} from "../lib/packing/loose-cargo";
import type {ProductInput} from "../lib/packing/types";
import {NumericInput} from "./numeric-input";
import {tr,trText,useLanguage} from "./language";

type Props={
  products:readonly ProductInput[];
  value?:LooseQuantities;
  onChange:(value:LooseQuantities|undefined)=>void;
  onValidityChange:(key:string,valid:boolean)=>void;
  resetToken?:number;
};

export function CargoLoadingAllocation({products,value,onChange,onValidityChange,resetToken}:Props) {
  useLanguage();
  const [custom,setCustom]=useState<string[]>([]);
  const groups=useMemo(()=>cargoAllocationGroups(products),[products]);
  const errors=looseReservationErrors(value,products);
  const valid=errors.length===0;
  const loose=Object.values(value??{}).reduce((sum,n)=>sum+n,0);
  const total=products.reduce((sum,p)=>sum+p.quantity,0);
  useEffect(()=>{
    onValidityChange("cargo-allocation",valid);
    return ()=>onValidityChange("cargo-allocation",true);
  },[valid,onValidityChange]);
  useEffect(()=>()=>{for(const group of groups)onValidityChange(`cargo-allocation:${group.key}`,true);},[groups,onValidityChange]);

  const clear=()=>{
    for(const group of groups)onValidityChange(`cargo-allocation:${group.key}`,true);
    setCustom([]);
    onChange(undefined);
  };
  return <section className="panel cargo-loading-allocation" aria-label={tr("打托与散箱分配","Pallet and loose allocation")}>
    <div className="allocation-heading">
      <div><h3>{tr("哪些货物需要打托？","Which cargo needs pallets?")}</h3>
        <p>{tr("逐项选择打托或直接散装。同一产品也可以拆分数量；套装按整套联动分配。","Choose palletized or loose loading for each item, or split the quantity. Kit components are allocated together.")}</p></div>
      <span className="allocation-total">{tr("待打托","To palletize")} <b>{Math.max(0,total-loose)}</b> · {tr("直接散装","Loose")} <b>{loose}</b> {tr("箱","cartons")}</span>
    </div>
    <div className="allocation-table-wrap">
      <table>
        <thead><tr><th scope="col">{tr("产品 / 套装","Product / kit")}</th><th scope="col">{tr("订单箱数","Ordered cartons")}</th><th scope="col">{tr("装载方式","Loading method")}</th><th scope="col">{tr("散装数量","Loose quantity")}</th><th scope="col">{tr("待打托箱数","Cartons to palletize")}</th></tr></thead>
        <tbody>{groups.map(group=>{
          const first=group.members[0];
          const reserved=value?.[first.id]??0;
          const units=group.kit?first.unitsPerSet??1:1;
          const selected=custom.includes(group.key)?"split":reserved===0?"pallet":reserved===group.maximum*units?"loose":"split";
          const count=reserved/units;
          const reservedCartons=group.members.reduce((sum,p)=>sum+(value?.[p.id]??0),0);
          return <tr key={group.key}>
            <th scope="row"><strong>{group.label}</strong>{group.kit&&<small>{group.members.map(p=>`${p.sku} × ${p.unitsPerSet??1}`).join(" · ")}</small>}</th>
            <td data-label={tr("订单箱数","Ordered cartons")}>{group.orderCartons}</td>
            <td data-label={tr("装载方式","Loading method")}>
              <select aria-label={`${group.label} ${tr("装载方式","loading method")}`} value={selected} onChange={e=>{
                const method=e.target.value;
                onValidityChange(`cargo-allocation:${group.key}`,true);
                setCustom(keys=>method==="split"?[...new Set([...keys,group.key])]:keys.filter(k=>k!==group.key));
                if(method!=="split")onChange(withCargoAllocation(value,group.members,method==="loose"?group.maximum:0));
              }}>
                <option value="pallet">{tr("全部打托","All palletized")}</option>
                <option value="loose">{group.kit?tr("完整套装散装","All whole kits loose"):tr("全部散装","All loose")}</option>
                <option value="split">{tr("分别指定数量","Split quantity")}</option>
              </select>
            </td>
            <td data-label={tr("散装数量","Loose quantity")}>
              {selected==="split"?<div className="allocation-number"><NumericInput key={`${group.key}-${resetToken}`} showError integer
                ariaLabel={`${group.label} ${group.kit?tr("散装套数","loose kits"):tr("散装箱数","loose cartons")}`}
                value={Number.isFinite(count)?count:0} min={0} max={group.maximum} onValueChange={n=>onChange(withCargoAllocation(value,group.members,n))}
                onValidityChange={v=>onValidityChange(`cargo-allocation:${group.key}`,v)}/><span>{group.kit?tr("套","kits"):tr("箱","cartons")}</span></div>:
                <span>{group.kit?`${count} ${tr("套","kits")} · `:""}{reservedCartons} {tr("箱","cartons")}</span>}
              {group.kit&&group.orderCartons%group.cartonsPerUnit!==0&&<small>{tr("余下组成箱保留在待打托数量中。","Remaining components stay in the pallet allocation.")}</small>}
            </td>
            <td data-label={tr("待打托箱数","Cartons to palletize")}>{Math.max(0,group.orderCartons-reservedCartons)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {(loose>0||!valid)&&<div className="allocation-footer"><p>{tr("打托货物先生成整托，散箱使用柜内剩余空间。两种货物共用柜内容积与净载重。","Palletized cargo forms complete units. Loose cartons use the remaining container space. Both share the vehicle volume and payload.")}</p><button type="button" className="button small" onClick={clear}>{tr("恢复全部打托","Palletize everything")}</button></div>}
    {errors.map((error,i)=><p key={i} role="alert">{trText(error)}</p>)}
  </section>;
}
