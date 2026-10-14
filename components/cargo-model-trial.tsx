"use client";
import {useEffect,useRef,useState} from 'react';
import type {ContainerSpec,ProductInput,PackingResult,WorkerResponse} from '../lib/packing/types';
import {tr,trText,useLanguage} from './language';

export function CargoModelTrial({product,container,clearance,disabled}:{product:ProductInput;container?:ContainerSpec;clearance:number;disabled:boolean}){
  useLanguage();const worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [run,setRun]=useState<ProductInput|null>(null),[outcome,setOutcome]=useState<{product:ProductInput;plan?:PackingResult;error?:string}|null>(null);
  const cancel=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
  useEffect(()=>()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;},[product,container,clearance]);
  const test=()=>{if(!container||disabled)return;cancel();setRun(product);setOutcome(null);
    try{const instance=new Worker(new URL('../lib/packing/packing.worker.ts',import.meta.url),{type:'module'});worker.current=instance;const requestId=String(Date.now());
      const finish=(plan?:PackingResult,error?:string)=>{if(worker.current!==instance)return;setOutcome({product,plan,error});setRun(null);cancel();};
      instance.onmessage=(event:MessageEvent<WorkerResponse>)=>{if(event.data.requestId!==requestId||worker.current!==instance)return;if(event.data.type==='error')finish(undefined,event.data.message);else if(event.data.type==='result')finish(event.data.payload);};
      instance.onerror=()=>finish(undefined,tr('试装线程执行失败，请重试。','Trial worker failed; retry.'));
      timer.current=setTimeout(()=>finish(undefined,tr('单件试装达到 20 秒时限；请简化模型后重试。','Single-item trial reached its 20-second limit; simplify the model and retry.')),20000);
      instance.postMessage({type:'pack-strategy',requestId,strategy:'maximum',payload:{mode:'mixed',strategy:'maximum',container,clearance,products:[{...product,quantity:1,setCode:undefined,unitsPerSet:1}]}});
    }catch(error){cancel();setRun(null);setOutcome({product,error:error instanceof Error?error.message:String(error)});}
  };
  const running=run===product,result=outcome?.product===product?outcome:undefined;
  return <section className="model-trial" aria-label={tr('建模试装校验','Model loading trial')}><button type="button" className="button small" disabled={disabled||!container||running} onClick={test}>{running?tr('正在试装…','Testing load…'):tr('校验单件装载','Validate one-item load')}</button>{running&&<button type="button" className="button small" onClick={()=>{cancel();setRun(null);}}>{tr('停止','Stop')}</button>}<small>{tr('按当前柜型检查单件的边界、门洞、碰撞、承托与载重。完整装载数量在保存后计算。','Checks one item against the current vehicle: boundaries, door, collisions, support and payload. Compute full capacity after saving.')}</small>{result&&<p role="status">{result.error?trText(result.error):result.plan?.validation.valid&&result.plan.metrics.loadedCount===1?tr('单件已通过装载校验。','One-item loading validation passed.'):tr('当前条件未找到通过校验的单件位置，请核对上方尺寸和承托限制。','No validated one-item position was found; review dimension and support constraints above.')}</p>}</section>;
}
