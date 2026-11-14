"use client";
import {useEffect,useState} from "react";
import type {UnitStacking} from "../lib/packing/unit-stacking";
import {NumericInput} from "./numeric-input";
import {tr} from "./language";

export function UnitStackingSettings({value,onChange,disabled=false,onValidityChange}:{value?:UnitStacking;onChange:(value:UnitStacking)=>void;disabled?:boolean;onValidityChange?:(valid:boolean)=>void}) {
 const rule=value??{enabled:false,maxLayers:0};
 const [layersValid,setLayersValid]=useState(true),[loadValid,setLoadValid]=useState(true);
 useEffect(()=>{onValidityChange?.(!rule.enabled||layersValid&&(rule.maxTopLoadKg===undefined||loadValid));},[onValidityChange,rule.enabled,rule.maxTopLoadKg,layersValid,loadValid]);
 return <fieldset className="pallet-build-grid" disabled={disabled}><legend>{tr("整托上下堆叠","Pallet-on-pallet stacking")}</legend>
  <label><input type="checkbox" checked={rule.enabled} onChange={e=>{setLayersValid(true);setLoadValid(true);onChange({...rule,enabled:e.target.checked});}}/>{tr("允许整托上下堆叠","Allow loaded pallets to stack")}</label>
  {rule.enabled&&<><label>{tr("整托最多叠几层","Maximum pallet tiers")}<NumericInput ariaLabel={tr("整托最多叠几层","Maximum pallet tiers")} value={rule.maxLayers} min={0} max={99} integer onValueChange={maxLayers=>onChange({...rule,maxLayers})} onValidityChange={setLayersValid}/><small>{tr("0 = 按柜高自动；每层包含自己的托盘底座和货物。","0 = automatic by vehicle height; every tier includes its own base and cargo.")}</small></label>
   <label><input type="checkbox" checked={rule.maxTopLoadKg!==undefined} onChange={e=>{setLoadValid(true);onChange({...rule,maxTopLoadKg:e.target.checked?0:undefined});}}/>{tr("填写整托上压上限","Set cumulative top-load limit")}</label>
   {rule.maxTopLoadKg!==undefined&&<label>{tr("整托累计上压上限 kg","Cumulative pallet top load kg")}<NumericInput ariaLabel={tr("整托累计上压上限","Cumulative pallet top load")} value={rule.maxTopLoadKg} min={0} max={100000} onValueChange={maxTopLoadKg=>onChange({...rule,maxTopLoadKg})} onValidityChange={setLoadValid}/></label>}
   <small>{tr("按可堆叠包装预排；已录入承重仍限制叠放，未录入的结构承重标记为待核对。","Plan stackable units; entered ratings still constrain stacks, and missing structural ratings remain unverified.")}</small>
  </>}
 </fieldset>;
}
