"use client";
import { useMemo, useState } from "react";
import { editPlan, expandSelection, type Delta, type EditGroup } from "../lib/packing/plan-edit";
import { revisePackingResult } from "../lib/packing/engine";
import { editPalletContents, type PalletEdit } from "../lib/packing/pallet-edit";
import type { PackingResult, ProductInput } from "../lib/packing/types";
import { tr } from "./language";
type State={source:PackingResult|null;plan:PackingResult|null;undo:PackingResult[];redo:PackingResult[];ids:string[];enabled:boolean;rectangle:boolean;group:EditGroup;grid:number;tolerance:number;message:string};
const initial=(source:PackingResult|null,enabled:boolean):State=>({source,plan:source,undo:[],redo:[],ids:[],enabled,rectangle:false,group:"selection",grid:10,tolerance:30,message:""});
export function usePlanEditor(source:PackingResult|null,products:ProductInput[],disabled:boolean,onAdopt:(plan:PackingResult)=>void,initiallyEnabled=false){
  const [stored,setStored]=useState<State>(()=>initial(source,initiallyEnabled));
  const state=stored.source===source?stored:initial(source,initiallyEnabled);
  const update=(patch:Partial<State>)=>setStored(s=>({...((s.source===source)?s:initial(source,initiallyEnabled)),...patch}));
  const selected=useMemo(()=>state.plan?expandSelection(state.plan,state.ids,state.group):[],[state.plan,state.ids,state.group]);
  const commit=(next:PackingResult)=>update({plan:next,undo:[...state.undo.slice(-19),state.plan!],redo:[],message:tr("调整通过校验；采用后同步指标与导出。","Edit validated. Apply to update totals and exports.")});
  const attempt=(action:()=>PackingResult)=>{if(disabled)return false;try{commit(action());return true;}catch(e){update({message:e instanceof Error?e.message:String(e)});return false;}};
  // Historical passing flags do not authorize a replay after current rules change.
  const revalidate=(plan:PackingResult)=>{
    const checked=revisePackingResult(plan,plan.placements,products);
    return plan.engineVersion===checked.engineVersion&&JSON.stringify(plan.cargoDetails)===JSON.stringify(checked.cargoDetails)?plan:checked;
  };
  const replay=(redo:boolean)=>{
    if(disabled)return;
    const target=(redo?state.redo:state.undo).at(-1);if(!target)return;
    try{const plan=revalidate(target);update(redo?{plan,redo:state.redo.slice(0,-1),undo:[...state.undo,state.plan!],message:""}:{plan,undo:state.undo.slice(0,-1),redo:[...state.redo,state.plan!],message:""});}
    catch(e){update({message:e instanceof Error?e.message:String(e)});}
  };
  return {...state,selected,disabled,changed:state.plan!==source,update,
    select:(id:string,add=false)=>update({ids:add?(state.ids.includes(id)?state.ids.filter(x=>x!==id):[...state.ids,id]):[id]}),
    selectMany:(ids:string[],add=false)=>update({ids:add?[...new Set([...state.ids,...ids])]:ids}),
    move:(delta:Delta,rotate=false)=>state.plan&&attempt(()=>editPlan(state.plan!,products,state.ids,state.group,delta,state.grid,state.tolerance,rotate)),
    palletEdit:(id:string,action:PalletEdit)=>state.plan&&attempt(()=>editPalletContents(state.plan!,products,id,action)),
    lock:()=>state.plan&&attempt(()=>revisePackingResult(state.plan!,state.plan!.placements.map(b=>selected.some(s=>s.id===b.id)?{...b,locked:!selected.every(s=>s.locked)}:b),products)),
    undoEdit:()=>replay(false),
    redoEdit:()=>replay(true),
    apply:()=>{if(state.plan&&!disabled){try{onAdopt(revalidate(state.plan));}catch(e){update({message:e instanceof Error?e.message:String(e)});}}},
    discard:()=>setStored(initial(source,initiallyEnabled))};
}
export type PlanEditor=ReturnType<typeof usePlanEditor>;
