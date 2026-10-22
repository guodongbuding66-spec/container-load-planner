"use client";
import {useEffect,useRef,useState} from "react";
import {MEASUREMENT_BYTES,MEASUREMENT_KEY,mergeMeasurements,parseMeasurements,serializeMeasurements,type SavedMeasurement} from "../lib/packing/saved-measurements";

export function useSavedMeasurements(){
  const [items,setItems]=useState<SavedMeasurement[]>([]),[ready,setReady]=useState(false),[mode,setMode]=useState<"saved"|"session"|"corrupt"|"conflict">("saved"),[message,setMessage]=useState<""|"saved"|"invalid"|"session"|"conflict">(""),[raw,setRaw]=useState(""),[importing,setImporting]=useState(false),[removed,setRemoved]=useState<SavedMeasurement|null>(null);
  const current=useRef<SavedMeasurement[]>([]),expected=useRef<string|null>(null),blocked=useRef(false),lifecycle=useRef({mounted:false,sequence:0});
  useEffect(()=>{const instance=lifecycle.current;instance.mounted=true;let active=true;queueMicrotask(()=>{if(!active)return;try{const value=localStorage.getItem(MEASUREMENT_KEY);expected.current=value;if(value){try{current.current=parseMeasurements(value);setItems(current.current);}catch{blocked.current=true;setMode("corrupt");setRaw(value);}}}catch{setMode("session");}setReady(true);});return()=>{active=false;instance.mounted=false;instance.sequence++;};},[]);
  const commit=(next:SavedMeasurement[])=>{
    if(!lifecycle.current.mounted)return false;
    try{
      const serialized=serializeMeasurements(next),normalized=parseMeasurements(serialized);
      if(!blocked.current){
        let latest:string|null;try{latest=localStorage.getItem(MEASUREMENT_KEY);}catch{latest=expected.current;}
        if(latest!==expected.current){setMode("conflict");setMessage("conflict");return false;}
      }
      current.current=normalized;setItems(normalized);
      if(blocked.current){setMessage("session");return true;}
      try{localStorage.setItem(MEASUREMENT_KEY,serialized);expected.current=serialized;setMode("saved");setMessage("saved");}catch{setMode("session");setMessage("session");}return true;
    }catch{setMessage("invalid");return false;}
  };
  const add=(item:SavedMeasurement)=>{try{return commit(mergeMeasurements(current.current,[item]));}catch{setMessage("invalid");return false;}};
  return {items,ready,mode,message,raw,importing,removed,reject:()=>setMessage("invalid"),
    add,
    patch:(id:string,patch:Pick<Partial<SavedMeasurement>,"name"|"visible">)=>commit(current.current.map(m=>m.id===id?{...m,...patch}:m)),
    remove:(id:string)=>{const item=current.current.find(m=>m.id===id);if(item&&commit(current.current.filter(m=>m.id!==id)))setRemoved(item);},
    undo:()=>{if(removed&&add(removed))setRemoved(null);},
    importFile:async(file:File)=>{const sequence=++lifecycle.current.sequence;setImporting(true);try{if(file.size>MEASUREMENT_BYTES)throw Error();const value=await file.text();if(!lifecycle.current.mounted||sequence!==lifecycle.current.sequence)return;commit(mergeMeasurements(current.current,parseMeasurements(value)));}catch{if(lifecycle.current.mounted&&sequence===lifecycle.current.sequence)setMessage("invalid");}finally{if(lifecycle.current.mounted&&sequence===lifecycle.current.sequence)setImporting(false);}},
  };
}
export type SavedMeasurements=ReturnType<typeof useSavedMeasurements>;
