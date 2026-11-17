"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {PalletConsolidationResult} from "../lib/packing/pallet-consolidation";
import type {PalletRefillResult} from "../lib/packing/pallet-refill";
import type {PalletRepackResult} from "../lib/packing/pallet-repack";
import type {PackingResult,ProductInput} from "../lib/packing/types";
import {tr,trText} from "./language";

type SearchResult={repack:PalletRepackResult;refill:PalletRefillResult;consolidate:PalletConsolidationResult};
type TaskState<Result>={source:PackingResult;products:ProductInput[];id:string;selection:string;blocked:boolean;running:boolean;result:Result|null;message:string};
const messages:Record<keyof SearchResult,Record<"cancel"|"timeout"|"error",[string,string]>>={
  repack:{
    cancel:["已取消重排，原箱位保留。","Repacking canceled; original positions retained."],
    timeout:["达到 10 秒搜索预算，原箱位保留。可减少本托箱数后重试。","The 10-second search budget was reached. Original positions are retained; retry with fewer cartons on this pallet."],
    error:["重排搜索未完成，原箱位保留。","Repacking did not finish; original positions retained."],
  },
  refill:{
    cancel:["已取消自动补货预览。","Refill preview canceled."],
    timeout:["本次补货搜索达到 10 秒。请重试或手动添加。","The refill search reached 10 seconds. Retry or add cargo manually."],
    error:["自动补货搜索未完成。","The refill search did not finish."],
  },
  consolidate:{
    cancel:["已取消联合重排试算。","Consolidation search canceled."],
    timeout:["试排达到 10 秒，请缩小所选范围后重试。","The trial reached 10 seconds. Select fewer pallets and try again."],
    error:["联合重排试算未完成。","The consolidation search did not finish."],
  },
};

export function palletSearchMessage(value:string){
  const parts=value.split(" / ");
  return parts.length===2&&/[\u3400-\u9fff]/u.test(parts[0])?tr(parts[0],parts[1]):trText(value);
}

/** Results are scoped to the exact draft and input objects; changing either cancels the worker. */
export function usePalletSearch<Operation extends keyof SearchResult>(operation:Operation,source:PackingResult,products:ProductInput[],id:string,blocked:boolean,onPendingChange?:(pending:boolean)=>void,selectedPalletIds?:string[]){
  type State=TaskState<SearchResult[Operation]>;
  const worker=useRef<{instance:Worker;timer:ReturnType<typeof setTimeout>}|null>(null);
  const [stored,setStored]=useState<State|null>(null);
  const selection=JSON.stringify(selectedPalletIds??[]);
  const state=stored?.source===source&&stored.products===products&&stored.id===id&&stored.selection===selection&&stored.blocked===blocked?stored:null;
  if(stored&&!state)setStored(null);
  const stop=useCallback(()=>{
    if(!worker.current)return;
    clearTimeout(worker.current.timer);
    worker.current.instance.terminate();
    worker.current=null;
  },[]);
  useEffect(()=>()=>stop(),[source,products,id,selection,blocked,stop]);
  const running=state?.running??false;
  useEffect(()=>{onPendingChange?.(running);return()=>onPendingChange?.(false);},[running,onPendingChange]);
  const initial=():State=>({source,products,id,selection,blocked,running:false,result:null,message:""});
  const cancel=()=>{stop();setStored({...initial(),message:tr(...messages[operation].cancel)});};
  const clear=()=>{stop();setStored(initial());};
  const run=()=>{
    if(blocked)return;
    stop();setStored({...initial(),running:true});
    try{
      const instance=new Worker(new URL("../lib/packing/pallet-repack.worker.ts",import.meta.url),{type:"module"});
      const finish=(update:Partial<State>)=>{
        if(worker.current?.instance!==instance)return;
        stop();setStored({...initial(),...update});
      };
      const timer=setTimeout(()=>finish({message:tr(...messages[operation].timeout)}),10000);
      worker.current={instance,timer};
      instance.onmessage=e=>finish(e.data.ok?{result:e.data.result}:{message:e.data.error});
      instance.onerror=()=>finish({message:tr(...messages[operation].error)});
      instance.postMessage({plan:source,products,id,...(operation!=="repack"?{operation}:{}),...(operation==="consolidate"?{palletIds:selectedPalletIds}:{})});
    }catch(error){stop();setStored({...initial(),message:error instanceof Error?error.message:String(error)});}
  };
  return {running,result:state?.result??null,message:state?.message??"",run,cancel,clear};
}
