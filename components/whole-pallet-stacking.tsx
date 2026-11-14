"use client";
import {useState} from "react";
import {palletSpecifications} from "../lib/packing/pallet-specifications";
import {enableWholePalletStacking} from "../lib/packing/unit-stacking";
import type {PackingRequest,PackingResult,PalletBuildOptions} from "../lib/packing/types";
import {tr} from "./language";

export function WholePalletStacking({request,plan,disabled,onApply}:{request:PackingRequest;plan?:PackingResult|null;disabled:boolean;onApply?:(b:PalletBuildOptions)=>void}){
 const [automatic,setAutomatic]=useState(true),build=request.palletBuild;
 if(request.workflow!=="palletized"||!build||!plan?.pallets?.length)return null;
 const heights=[...new Set(plan.pallets.map(p=>Number(p.z.toFixed(2))))].sort((a,b)=>a-b);
 const specs=palletSpecifications(build).filter(s=>s.maxPallets>0&&!s.config.unitStacking?.enabled&&s.config.crateBearing?.policy!=="prohibited"&&s.config.crateBearing?.policy!=="rated"&&!s.config.packaging?.deckSupports?.length);
 const incomplete=plan.summaries.some(s=>s.unloaded>0);
 return <section className="pallet-height-action" aria-label={tr("整托堆叠检查","Whole-pallet stacking check")}>
  <h3>{tr("整托上下堆叠","Pallet-on-pallet stacking")}</h3>
  <p>{tr(`当前 ${plan.pallets.length} 托，其中 ${plan.pallets.filter(p=>p.z>0).length} 托在上层；底座高度位置 ${heights.join(" / ")} mm。`,`Currently ${plan.pallets.length} pallets, ${plan.pallets.filter(p=>p.z>0).length} above the floor; base elevations ${heights.join(" / ")} mm.`)}</p>
  {incomplete&&specs.length>0&&onApply&&<><p>{tr("托内纸箱层数与整托叠放是两项设置。开启下列整托叠放后，保留现有打托尺寸，继续利用柜内上方空间。","Carton layers and pallet tiers are separate. Enable unit stacking below to retain existing packaging dimensions and use space above the floor.")}</p>
   <label><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/>{tr("按订单准备托盘（本规格和总生成上限改为 200 托）","Prepare pallets for this order (set this specification and total generation limits to 200)")}</label>
   <p>{tr(`当前总生成上限 ${build.maxPallets} 托；已录入上压继续生效，未录入的结构承重仍待核对。`,`Current total limit: ${build.maxPallets} pallets. Entered top-load limits remain active; missing structural ratings remain unverified.`)}</p>
   {specs.map(s=><button key={s.id} className="button primary" type="button" disabled={disabled} onClick={()=>onApply(enableWholePalletStacking(build,s.id,automatic))}>{tr("允许整托叠放并重新计算","Enable pallet tiers and recalculate")} · {s.config.name}</button>)}
  </>}
 </section>;
}
