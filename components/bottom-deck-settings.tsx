"use client";
import {DEFAULT_PACKAGING,withBottomDeck} from "../lib/packing/packaging";
import type {FloorPalletConfig} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

export function BottomDeckSettings({value,onChange,disabled=false}:{value:FloorPalletConfig;onChange:(next:FloorPalletConfig)=>void;disabled?:boolean}){
 useLanguage();const spec=value.packaging??DEFAULT_PACKAGING;
 if(!["block","stringer"].includes(spec.base))return null;
 return <div className="bottom-deck-settings">
  <label className="pallet-preset-label">{tr("托盘底板结构","Pallet bottom construction")}<select aria-label={tr("托盘底板结构","Pallet bottom construction")} value={spec.bottomDeck??"runners"} disabled={disabled} onChange={e=>onChange(withBottomDeck(value,e.target.value as "runners"|"grid"|"none"))}>
   <option value="runners">{tr("底部纵板（原结构）","Bottom runner boards (original construction)")}</option>
   <option value="grid">{tr("网格底板（田字形）","Grid boards")}</option>
   <option value="none">{tr("无底板（单面型）","No bottom boards (single-deck)")}</option>
  </select></label>
  <p className="helper-text">{tr("无底板时支承块或纵梁直接落地，外尺寸和预留占位不变。请重新填写实际自重和载荷资料；不自动减重，不代表可翻面承重或能上货架。","Without bottom boards, blocks or stringers reach the floor. Exterior dimensions and reserved space stay unchanged. Recheck actual tare and rating data; mass is not reduced automatically. This does not establish reversibility or rack suitability.")}</p>
 </div>;
}
