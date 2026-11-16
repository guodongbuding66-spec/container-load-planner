"use client";
import {useEffect,useState} from "react";
import type {UnitStacking} from "../lib/packing/unit-stacking";
import {NumericInput} from "./numeric-input";
import {tr} from "./language";

export function UnitStackingSettings({value,onChange,disabled=false,onValidityChange}:{value?:UnitStacking;onChange:(value:UnitStacking)=>void;disabled?:boolean;onValidityChange?:(valid:boolean)=>void}) {
 const rule=value??{enabled:false,maxLayers:0};
 const [layersValid,setLayersValid]=useState(true),[loadValid,setLoadValid]=useState(true);
 useEffect(()=>{onValidityChange?.(!rule.enabled||layersValid&&(rule.maxTopLoadKg===undefined||loadValid));},[onValidityChange,rule.enabled,rule.maxTopLoadKg,layersValid,loadValid]);
 return <fieldset className="unit-stacking-grid" disabled={disabled}><legend>{tr("整托上下堆叠","Pallet-on-pallet stacking")}</legend>
  <label className="unit-stacking-check"><input type="checkbox" checked={rule.enabled} onChange={e=>{setLayersValid(true);setLoadValid(true);onChange({...rule,enabled:e.target.checked});}}/>{tr("允许整托上下堆叠","Allow loaded pallets to stack")}</label>
  {rule.enabled&&<>
    <div className="unit-stacking-fields">
      <label>{tr("整托最多叠几层","Maximum pallet tiers")}
        <NumericInput ariaLabel={tr("整托最多叠几层","Maximum pallet tiers")} value={rule.maxLayers} min={0} max={99} integer onValueChange={maxLayers=>onChange({...rule,maxLayers})} onValidityChange={setLayersValid}/>
        <small>{tr("0 = 按可用高度自动","0 = automatic by available height")}</small>
      </label>
      <div className="unit-stacking-load">
        <label className="unit-stacking-check"><input type="checkbox" checked={rule.maxTopLoadKg!==undefined} onChange={e=>{setLoadValid(true);onChange({...rule,maxTopLoadKg:e.target.checked?0:undefined});}}/>{tr("填写整托上压上限","Set cumulative top-load limit")}</label>
        {rule.maxTopLoadKg!==undefined&&<div className="pallet-build-number"><NumericInput ariaLabel={tr("整托累计上压上限","Cumulative pallet top load")} value={rule.maxTopLoadKg} min={0} max={100000} onValueChange={maxTopLoadKg=>onChange({...rule,maxTopLoadKg})} onValidityChange={setLoadValid}/><span>kg</span></div>}
      </div>
    </div>
    <small className="unit-stacking-note">{tr("每层包含底座和货物；缺少结构承重资料时标记为待核对。","Each tier includes the base and cargo. Missing structural ratings are marked unverified.")}</small>
  </>}
 </fieldset>;
}
