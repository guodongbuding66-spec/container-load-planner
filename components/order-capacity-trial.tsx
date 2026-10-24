"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {prepareOrderCapacityTrial,reviewOrderCapacityTrial,replenishedOrder,type OrderCapacityTrial} from "../lib/packing/order-capacity";
import {palletSpecifications} from "../lib/packing/pallet-specifications";
import {packagingInterior} from "../lib/packing/packaging";
import type {PackingRequest,PackingResult,ProductInput} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

type Props={request:PackingRequest;plan?:PackingResult|null;measuredEnvelope?:boolean;volume:number;weight:number;disabled:boolean;canApply:boolean;onApply:(products:ProductInput[])=>void};
export function useOrderCapacityTrial({request,volume,weight,disabled:inputDisabled,canApply,onApply,plan,measuredEnvelope}:Props){
 const disabled=inputDisabled||!!measuredEnvelope||!!plan?.pallets?.some(p=>p.measuredEnvelope);
 const key=JSON.stringify([request,volume,weight]),identity=useMemo(()=>({key,disabled,canApply}),[key,disabled,canApply]),worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),latest=useRef(identity),blocked=useRef(disabled);
 const [state,setState]=useState<{identity:typeof identity;kind:"running"|"done"|"cancelled"|"timeout"|"error";trial?:OrderCapacityTrial;plan?:PackingResult;error?:string}|null>(null);
 const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
 useLayoutEffect(()=>{latest.current=identity;blocked.current=disabled;return()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);};},[identity,disabled]);
 const current=state?.identity===identity?state:null;
 const run=()=>{
  stop();if(disabled)return;
  try{
   const trial=prepareOrderCapacityTrial(request,volume,weight),w=new Worker(new URL("../lib/packing/order-capacity.worker.ts",import.meta.url),{type:"module"});worker.current=w;setState({identity,kind:"running",trial});
   const active=()=>worker.current===w&&latest.current===identity&&!blocked.current;
   timer.current=setTimeout(()=>{if(!active())return;stop();setState({identity,kind:"timeout"});},30000);
   w.onmessage=e=>{if(!active())return;stop();try{if(e.data.error)throw Error(e.data.error);const plan=reviewOrderCapacityTrial(trial,e.data.plan);setState({identity,kind:"done",trial,plan});}catch(error){setState({identity,kind:"error",error:error instanceof Error?error.message:String(error)});}};
   w.onerror=()=>{if(!active())return;stop();setState({identity,kind:"error"});};w.postMessage(trial);
  }catch(error){setState({identity,kind:"error",error:error instanceof Error?error.message:String(error)});}
 };
 const cancel=()=>{stop();setState({identity,kind:"cancelled"});};
 const adopt=()=>{if(disabled||!canApply||!current?.plan||worker.current)return;onApply(replenishedOrder(request.products,current.plan));};
 return {current,run,cancel,adopt,running:current?.kind==="running"};
}

export function OrderCapacityTrial(props:Props){
 const language=useLanguage(),{request,plan,canApply}=props,task=useOrderCapacityTrial(props),trial=task.current?.trial,candidate=task.current?.plan;
 const measured=props.measuredEnvelope||plan?.pallets?.some(p=>p.measuredEnvelope);
 const rawError=task.current?.error,errorParts=rawError?.split(" / "),errorText=errorParts?.length===2?errorParts[language==="en"?1:0]:rawError&&language==="en"&&/[\u3400-\u9fff]/u.test(rawError)?"Review dimensions, packaging stock, load ratings and complete-kit rules.":rawError;
 const ordered=request.products.reduce((n,p)=>n+p.quantity,0),loaded=plan?.metrics.loadedCount;
 const added=candidate?replenishedOrder(request.products,candidate).reduce((n,p)=>n+p.quantity,0)-ordered:0;
 const specifications=useMemo(()=>request.palletBuild?palletSpecifications(request.palletBuild):[],[request.palletBuild]);
 const status=task.current?.kind==="running"?tr("正在按原尺寸、包装库存和承重规则试装；原订单保持不变。","Testing the original geometry, packaging stock and load rules; the order is unchanged."):task.current?.kind==="timeout"?tr("30 秒试算结束，未完成结果已丢弃，原方案保留。","The 30-second budget expired. Incomplete results were discarded; the original plan is retained."):task.current?.kind==="cancelled"?tr("已停止试算，原方案保留。","Trial cancelled; the original plan is retained."):task.current?.kind==="error"?tr("试算未完成，原方案保留。","Trial failed; the original plan is retained."):"";
 return <section className="order-capacity-trial" aria-label={tr("订单数量与补货试算","Order quantity and replenishment trial")}>
  <div className="panel-head"><div><h3>{tr("本单装完 ≠ 整柜装满","Order fulfilled ≠ container full")}</h3><p>{tr("订单量","Ordered")}: {ordered.toLocaleString()} {tr("箱","cartons")}{loaded!==undefined&&<> · {tr("当前已装","Currently loaded")}: {loaded.toLocaleString()} {tr("箱","cartons")}</>}</p></div></div>
  <p className="helper-text">{tr("按当前 SKU 比例增加假设货量，重新打托并试装；不表示原位置可直接补入。结果是当前算法找到的可行方案，不是全局最大容量。","Increase hypothetical stock in the current SKU ratio, rebuild units and repack. This is not an in-place insertion check or proof of maximum capacity.")}</p>
  <details><summary>{tr("查看当前限高、层数与包装限制","Review height, stacking and packaging limits")}</summary>
   <ul>{request.products.map(p=><li key={p.id}>{p.sku} · {!p.stackable?tr("不允许承托上方货物","Cannot support cargo above"):tr("允许几何堆叠","Geometric stacking allowed")} · {p.bottomOnly?tr("仅允许底置","Bottom-only"):tr("不限制底置","Not bottom-only")} · {tr("箱体层数上限","Carton layer limit")} {p.maxStackLayers||tr("按净高及载荷","Height and load rules")} · {tr("通用额定上压","General top-load rating")} {p.maxTopLoadKg===undefined?tr("未填写，承重未核验","Not supplied; load rating unverified"):`${p.maxTopLoadKg} kg`}</li>)}
    {specifications.map(s=><li key={s.id}>{s.config.name} · {tr("托内货物限高","Cargo height limit")} {s.config.maxCargoHeight?`${s.config.maxCargoHeight} mm`:tr("按柜内及门洞净高","Vehicle / door clearance")} · {tr("额定载荷","Payload")} {s.config.maxLoad} kg · {tr("可用包装","Available units")} {s.maxPallets} · {packagingInterior(s.config).crate?tr("木箱按当前额定叠放资料校验","Crate stacking uses current rating evidence"):`${tr("整托最多","Loaded-unit limit")} ${s.stackLayers} ${tr("层","layers")}`}</li>)}
    {request.palletBuild&&<li>{tr("全部规格合计生成上限","Total prepared-unit limit")}: {request.palletBuild.maxPallets}</li>}
    {request.floorPallets&&<li>{request.floorPallets.name} · {tr("底座高","Base height")} {request.floorPallets.height} mm · {tr("货物限高","Cargo height limit")} {request.floorPallets.maxCargoHeight||tr("按柜高及门洞","Vehicle / door clearance")} · {tr("单托载荷","Payload per pallet")} {request.floorPallets.maxLoad} kg</li>}
   </ul><p className="helper-text">{tr("规则未放宽。尺寸、门洞、朝向、承托、累计载荷、保护间隙和包装库存仍参与校验；运输固定及缺失额定资料仍需另行复核。","Rules are unchanged. Geometry, door fit, orientation, support, cumulative loads, gaps and packaging stock remain checked. Securing and missing ratings still need separate review.")}</p>
  </details>
  {measured&&<p role="status">{tr("当前方案已采用实测整托包络；本项试算不支持该包络，已停用。请在方案副本中单独复核，不能退回标称尺寸计算。","This plan uses measured unit envelopes. This trial does not support those envelopes and is disabled. Review a plan copy separately; do not fall back to nominal dimensions.")}</p>}
  <div className="upgrade-actions"><button type="button" className="button primary" disabled={props.disabled||!!measured||task.running} onClick={task.run}>{tr("试算增加货量（不改订单）","Trial additional cargo (keep order)")}</button><button type="button" className="button" disabled={!task.running} onClick={task.cancel}>{tr("停止试算","Stop trial")}</button></div>
  <p role="status">{status}</p>{errorText&&<p role="alert">{errorText}</p>}
  {candidate&&trial&&<div className="capacity-trial-result"><p><strong>{tr("试算可装","Trial loaded")} {candidate.metrics.loadedCount.toLocaleString()} {tr("箱","cartons")}</strong> · {tr("试算货量","Trial stock")} {candidate.metrics.requestedCount.toLocaleString()} · {tr("毛重","Gross")} {candidate.metrics.grossWeight.toLocaleString()} kg · {tr("体积利用率","Volume use")} {(candidate.metrics.volumeUtilization*100).toFixed(1)}%</p>
   {loaded!==undefined&&<p>{tr("与当前已装数量相比","Compared with currently loaded")}: {candidate.metrics.loadedCount-loaded>=0?"+":""}{candidate.metrics.loadedCount-loaded} {tr("箱","cartons")}</p>}
   <p>{tr("算术目标","Arithmetic target")}: {trial.arithmeticCartons.toLocaleString()} {tr("箱；包装及摆放后的结果以上方校验数量为准。装卸顺序、运输固定和缺失承重资料仍需复核。","cartons; use the validated packing count above. Unloading order, securing and missing load ratings still need review.")}</p>
   {trial.budgetLimited&&<p>{tr("已触及 4000 箱试算预算；未证明剩余空间不可用。","The 4000-carton trial budget was reached; remaining space is not proven unusable.")}</p>}
   {candidate.palletization&&<p>{tr("已生成／已入柜整托","Prepared / loaded units")}: {candidate.palletization.preparedCount??candidate.pallets?.length} / {candidate.pallets?.length}{candidate.palletization.bounded?tr(" · 已触及包装或箱位搜索上限"," · Packaging or coordinate search limit reached"):""}</p>}
   <button type="button" className="button primary" disabled={props.disabled||!canApply||added<=0} onClick={task.adopt}>{tr("补充已验证货量并重新计算","Add validated stock and recalculate")} {added>0?`(+${added})`:""}</button>
   {added<=0&&<p>{tr("未验证到新增订单量；请检查上述限高、层数、承重、尺寸及包装数量。不能仅凭剩余 CBM 判断能否补货。","No additional order stock was validated. Review the limits above; remaining CBM alone does not establish feasibility.")}</p>}
   {!canApply&&<p>{tr("已有交付版本，仅供试算；请在方案副本中调整订单。","An issued delivery version is preview-only. Change the order in a plan copy.")}</p>}
  </div>}
  <small>{tr("最多 4000 箱，30 秒；关闭、停止或参数变化会丢弃未完成试算。","Up to 4000 cartons and 30 seconds. Unmounting, cancellation or changed inputs discard unfinished trials.")}</small>
 </section>;
}
