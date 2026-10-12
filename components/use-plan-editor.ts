"use client";
import { useMemo, useState } from "react";
import { editPlan, expandSelection, type Delta, type EditGroup } from "../lib/packing/plan-edit";
import { revisePackingResult } from "../lib/packing/engine";
import type { PackingResult, ProductInput } from "../lib/packing/types";
import { tr } from "./language";
type State={source:PackingResult|null;plan:PackingResult|null;undo:PackingResult[];redo:PackingResult[];ids:string[];enabled:boolean;rectangle:boolean;group:EditGroup;grid:number;tolerance:number;message:string};
const initial=(source:PackingResult|null):State=>({source,plan:source,undo:[],redo:[],ids:[],enabled:false,rectangle:false,group:"selection",grid:10,tolerance:30,message:""});
export function usePlanEditor(source:PackingResult|null,products:ProductInput[],disabled:boolean,onAdopt:(plan:PackingResult)=>void){
  const [stored,setStored]=useState<State>(()=>initial(source));
  const state=stored.source===source?stored:initial(source);
  const update=(patch:Partial<State>)=>setStored(s=>({...((s.source===source)?s:initial(source)),...patch}));
  const selected=useMemo(()=>state.plan?expandSelection(state.plan,state.ids,state.group):[],[state.plan,state.ids,state.group]);
  const commit=(next:PackingResult)=>update({plan:next,undo:[...state.undo.slice(-19),state.plan!],redo:[],message:tr("调整通过校验；采用后同步指标与导出。","Edit validated. Apply to update totals and exports.")});
  const attempt=(action:()=>PackingResult)=>{if(disabled)return false;try{commit(action());return true;}catch(e){update({message:e instanceof Error?e.message:String(e)});return false;}};
  return {...state,selected,disabled,changed:state.plan!==source,update,
    select:(id:string,add=false)=>update({ids:add?(state.ids.includes(id)?state.ids.filter(x=>x!==id):[...state.ids,id]):[id]}),
    selectMany:(ids:string[],add=false)=>update({ids:add?[...new Set([...state.ids,...ids])]:ids}),
    move:(delta:Delta,rotate=false)=>state.plan&&attempt(()=>editPlan(state.plan!,products,state.ids,state.group,delta,state.grid,state.tolerance,rotate)),
    lock:()=>state.plan&&attempt(()=>revisePackingResult(state.plan!,state.plan!.placements.map(b=>selected.some(s=>s.id===b.id)?{...b,locked:!selected.every(s=>s.locked)}:b),products)),
    undoEdit:()=>{if(state.undo.length)update({plan:state.undo.at(-1)!,undo:state.undo.slice(0,-1),redo:[...state.redo,state.plan!],message:""});},
    redoEdit:()=>{if(state.redo.length)update({plan:state.redo.at(-1)!,redo:state.redo.slice(0,-1),undo:[...state.undo,state.plan!],message:""});},
    apply:()=>{if(state.plan&&!disabled&&state.plan.validation.valid)onAdopt(state.plan);},
    discard:()=>setStored(initial(source))};
}
export type PlanEditor=ReturnType<typeof usePlanEditor>;
