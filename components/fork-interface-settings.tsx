"use client";
import {useEffect} from "react";
import {DEFAULT_PACKAGING,baseMeasurements,type BaseMeasurements} from "../lib/packing/packaging";
import {emptyForkInterface,FORK_NUMBERS,type ForkInterface,type ForkCheck} from "../lib/packing/fork-interface";
import type {FloorPalletConfig} from "../lib/packing/types";
import {NumericInput} from "./numeric-input";
import {tr,useLanguage} from "./language";
const MEASURES=["deckThickness","bottomThickness","bearerThickness","deckBoardWidth","supportLength","supportWidth"] as const;
const MEASURE_TEXT:Record<typeof MEASURES[number],[string,string]>={deckThickness:["实测面板厚","Measured deck thickness"],bottomThickness:["实测底板厚","Measured bottom board thickness"],bearerThickness:["实测横担厚","Measured bearer thickness"],deckBoardWidth:["实测单根面板宽","Measured deck board width"],supportLength:["实测支承块长","Measured support length"],supportWidth:["实测支承块宽","Measured support width"]};
export function ForkInterfaceSettings({value,onChange,onValidityChange,resetToken=0}:{value:FloorPalletConfig;onChange:(v:FloorPalletConfig)=>void;onValidityChange:(key:string,valid:boolean)=>void;resetToken?:number;invalid?:boolean}){
 useLanguage();const spec=value.packaging??{...DEFAULT_PACKAGING,opacity:1},p=value.forkInterface??emptyForkInterface(value),m=spec.measurements;
 useEffect(()=>()=>{[...MEASURES,...FORK_NUMBERS,"staticKg","dynamicKg","rackKg"].forEach(k=>onValidityChange(`pallet-build:fork-${k}`,true));},[onValidityChange]);
 const patch=(next:Partial<ForkInterface>)=>onChange({...value,forkInterface:{...p,...next}});
 const measure=(next:Partial<BaseMeasurements>)=>onChange({...value,packaging:{...spec,measurements:{...m??baseMeasurements(value.length,value.width,value.height,spec),...next}}});
 const fields=MEASURES.filter(key=>spec.base!=="corner-feet"||!["bottomThickness","bearerThickness","deckBoardWidth"].includes(key)).filter(key=>spec.base!=="stringer"||key!=="bearerThickness");
 return <details className="fork-interface-settings"><summary>{tr("底座实测与托盘载荷资料","Measured base and pallet load data")}</summary>
 <p className="helper-text">{tr("规则等距结构；实测尺寸与包装模型共用。保留托盘静载、动载与货架载荷资料，不模拟具体设备装卸。","Regular evenly spaced structure uses the same measured dimensions as the packaging model. Keep separate pallet static, dynamic and rack ratings; no equipment-handling simulation.")}</p>
 <label className="packaging-check"><input type="checkbox" aria-label={tr("使用实测底座尺寸","Use measured base dimensions")} checked={!!m} disabled={spec.base==="solid"} onChange={e=>{MEASURES.forEach(k=>onValidityChange(`pallet-build:fork-${k}`,true));onChange({...value,packaging:{...spec,measurements:e.target.checked?baseMeasurements(value.length,value.width,value.height,spec):undefined}});}}/>{tr("使用实测底座尺寸","Use measured base dimensions")}</label>
 {m?<><div className="pallet-build-grid">{fields.map(k=><label key={k}>{tr(...MEASURE_TEXT[k])} mm<NumericInput resetToken={resetToken} ariaLabel={tr(...MEASURE_TEXT[k])} value={m[k]} min={1} max={100000} onValueChange={n=>measure({[k]:n})} onValidityChange={v=>onValidityChange(`pallet-build:fork-${k}`,v)}/></label>)}</div><div className="pallet-build-grid"><label>{tr("底座实测来源","Base measurement source")}<input aria-label={tr("底座实测来源","Base measurement source")} value={m.source} maxLength={500} onChange={e=>measure({source:e.target.value})}/></label><label>{tr("底座结构版本","Base geometry revision")}<input aria-label={tr("底座结构版本","Base geometry revision")} value={m.revision} maxLength={120} onChange={e=>measure({revision:e.target.value})}/></label></div></>:<p>{tr("当前为通用比例示意，可填写实测部件尺寸。","The current base uses generic proportions; measured component dimensions may be entered.")}</p>}
 <fieldset><legend>{tr("三类载荷资料（0 = 未填写）","Separate load ratings (0 = missing)")}</legend><div className="pallet-build-grid">{([["staticKg","静载额定 kg","Static payload rating kg"],["dynamicKg","动载额定 kg","Dynamic payload rating kg"],["rackKg","货架载荷额定 kg","Rack payload rating kg"]] as const).map(([k,zh,en])=><label key={k}>{tr(zh,en)}<NumericInput resetToken={resetToken} ariaLabel={tr(zh,en)} value={p.ratings[k]} max={100000} onValueChange={n=>patch({ratings:{...p.ratings,[k]:n}})} onValidityChange={v=>onValidityChange(`pallet-build:fork-${k}`,v)}/></label>)}</div><label>{tr("载荷资料来源与条件","Rating source and conditions")}<input aria-label={tr("载荷资料来源与条件","Rating source and conditions")} value={p.ratings.source} maxLength={500} onChange={e=>patch({ratings:{...p.ratings,source:e.target.value}})}/></label></fieldset>
 <p className="helper-text">{tr("三类载荷按各自适用条件记录，不自动替代当前求解承重上限。来源不全时保持未核验。","Record each rating under its stated conditions. Ratings do not automatically replace the packing payload limit; missing sources remain unverified.")}</p>
 </details>;
}
export type {ForkCheck};
