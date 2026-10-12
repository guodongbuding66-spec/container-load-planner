"use client";
import { useSyncExternalStore } from "react";
import { DEFAULT_VIEW_PREFERENCES, parseViewPreferences, type ViewPreferences } from "../lib/packing/view-preferences";
export const VIEW_PREFERENCES_KEY="cargo-fit-view-v1";
const listeners=new Set<()=>void>();
const server={preferences:DEFAULT_VIEW_PREFERENCES,saveFailed:false};
let current=server,initialized=false;
const notify=()=>listeners.forEach(fn=>fn());
function initialize(){
  if(initialized||typeof window==="undefined")return;initialized=true;
  try{current={preferences:parseViewPreferences(JSON.parse(localStorage.getItem(VIEW_PREFERENCES_KEY)??"null")),saveFailed:false};}catch{current=server;}
  window.addEventListener("storage",e=>{if(e.key!==VIEW_PREFERENCES_KEY&&e.key!==null)return;try{current={preferences:parseViewPreferences(JSON.parse(e.newValue??"null")),saveFailed:false};}catch{current=server;}notify();});
}
const subscribe=(fn:()=>void)=>{listeners.add(fn);initialize();return()=>{listeners.delete(fn);};};
export function updateViewPreferences(patch:Partial<ViewPreferences>){
  initialize();const preferences=parseViewPreferences({...current.preferences,...patch});let saveFailed=false;
  if(typeof window!=="undefined")try{localStorage.setItem(VIEW_PREFERENCES_KEY,JSON.stringify(preferences));}catch{saveFailed=true;}
  current={preferences,saveFailed};notify();
}
export const resetViewPreferences=()=>updateViewPreferences(DEFAULT_VIEW_PREFERENCES);
export const useViewPreferences=()=>useSyncExternalStore(subscribe,()=>current,()=>server);
