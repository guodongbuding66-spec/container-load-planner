"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {measuredRepackInputs,reviewMeasuredRepackCandidate} from "../lib/packing/unit-envelope-repack";
import {palletLoadEnvelope} from "../lib/packing/unit-envelope";
import {deliveryPlanSignature} from "../lib/packing/delivery-identity";
import type {EngineeringDocument} from "../lib/packing/engineering-checks";
import type {PackingResult,ProductInput} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

type Props={plan:PackingResult;document:EngineeringDocument;products:ProductInput[];disabled:boolean;onAdopt:(candidate:PackingResult)=>void;allowTurn?:boolean};
type Preview={source:PackingResult;document:EngineeringDocument;products:ProductInput[];disabled:boolean;allowTurn:boolean;running:boolean;plan:PackingResult|null;message:string};
function message(value:string){const [zh,en]=value.split(" / ");return tr(zh,en??zh);}
export function useMeasuredUnitRepack({plan,document,products,disabled,onAdopt,allowTurn=false}:Props){
 useLanguage();const worker=useRef<{instance:Worker;timer:ReturnType<typeof setTimeout>}|null>(null),[saved,setSaved]=useState<Preview|null>(null);
 const preview=saved?.source===plan&&saved.document===document&&saved.products===products&&saved.disabled===disabled&&saved.allowTurn===allowTurn?saved:null;
 if(saved&&!preview)setSaved(null);
 const stop=useCallback(()=>{if(worker.current){clearTimeout(worker.current.timer);worker.current.instance.terminate();worker.current=null;}},[]);
 useEffect(()=>()=>stop(),[plan,document,products,disabled,allowTurn,stop]);
 const initial=():Preview=>({source:plan,document,products,disabled,allowTurn,running:false,plan:null,message:""});
 const run=()=>{if(disabled)return;stop();try{
   measuredRepackInputs(plan,document,products);
   const w=new Worker(new URL("../lib/packing/unit-envelope-repack.worker.ts",import.meta.url),{type:"module"});
   worker.current={instance:w,timer:setTimeout(()=>{if(worker.current?.instance!==w)return;stop();setSaved({...initial(),message:"达到 15 秒搜索预算，原方案保留。 / The 15-second search budget was reached; the original plan is retained."});},15000)};
   setSaved({...initial(),running:true});
   w.onmessage=e=>{if(worker.current?.instance!==w)return;stop();try{if(e.data.plan)reviewMeasuredRepackCandidate(plan,document,products,e.data.plan,allowTurn);setSaved({...initial(),plan:e.data.plan??null,message:e.data.error??""});}catch(e){setSaved({...initial(),message:e instanceof Error?e.message:String(e)});}};
   w.onerror=()=>{if(worker.current?.instance!==w)return;stop();setSaved({...initial(),message:"重排未完成，原方案保留。 / Repacking did not finish; the original plan is retained."});};
   w.postMessage({plan,document,products,...(allowTurn?{allowTurn:true}:{})});
 }catch(e){stop();setSaved({...initial(),message:e instanceof Error?e.message:String(e)});}};
 const adopt=()=>{if(disabled||!preview?.plan)return;try{
   if(deliveryPlanSignature(plan)!==document.context.signature)throw Error("源方案已改变，当前预览失效 / The source plan changed; this preview is stale");
   reviewMeasuredRepackCandidate(plan,document,products,preview.plan,allowTurn);
   onAdopt(preview.plan);setSaved(initial());
 }catch(e){setSaved({...preview,message:e instanceof Error?e.message:String(e)});}};
 const candidate=preview?.plan??null;
 return {preview,candidate,run,adopt,status:message(preview?.message??""),cancel:()=>{stop();setSaved({...initial(),message:"已取消，原方案保留。 / Canceled; the original plan is retained."});}};
}
export function MeasuredUnitRepack(props:Props){
 useLanguage();const [allowTurn,setAllowTurn]=useState(false),{plan,disabled}=props,task=useMeasuredUnitRepack({...props,allowTurn}),{preview,candidate,run,adopt}=task;
 return <section className="panel pallet-repack" aria-label={tr("采用实测包络并重排","Adopt measured envelopes and repack")}>
  <h3>{tr("采用实测包络并重排","Adopt measured envelopes and repack")}</h3>
  <p>{tr("整托作为完整单元重排。实测包络与原外形取并集，保留底座、托内相对箱位、箱数、完整套装及重量。","Repack complete units using the union of measured and nominal envelopes. Retain the base, local carton positions, quantities, complete kits and mass.")}</p>
  <label><input type="checkbox" checked={allowTurn} disabled={disabled||preview?.running} onChange={e=>setAllowTurn(e.target.checked)}/>{tr("允许按箱规及包装布局水平转向 90°","Allow a 90° horizontal turn within cargo and packaging rules")}</label>
  <p className="helper-text">{tr("首阶段最多 60 托，全部底置且未锁定，不含散箱；每托需有实测来源与日期。未计入计划的附件增重会阻止采用。15 秒有界搜索可取消，失败保留原方案。","This stage supports up to 60 unlocked floor units without loose cargo. Every unit needs measured provenance and a date. Unaccounted attachment mass blocks adoption. The cancellable bounded search has a 15-second budget; failure retains the original plan.")}</p>
  <div className="upgrade-actions"><button className="button" type="button" disabled={disabled||preview?.running||!!plan.pallets?.some(p=>p.measuredEnvelope)} onClick={run}>{tr("预览实测整托重排","Preview measured-unit repacking")}</button>{preview?.running&&<button className="button" type="button" onClick={task.cancel}>{tr("取消重排","Cancel repacking")}</button>}</div>
  <p role="status" aria-live="polite">{preview?.running?tr("正在按实测包络搜索，原方案保持不变…","Searching measured envelopes; the original plan is unchanged…"):preview?.message?task.status:candidate?tr("候选已通过完整布局校验，尚未采用；装卸路径、承重资料与现场条件仍需复核。","The candidate passed full layout validation and is not yet adopted. Review access, bearing evidence and field conditions separately."):""}</p>
  {candidate&&<><p>{tr("整托／箱数／总重保持","Units / cartons / gross mass retained")}: {candidate.pallets!.length} / {candidate.placements.length} / {candidate.metrics.grossWeight} kg</p>
   <div className="coordinate-wrap"><table className="coordinate-table"><thead><tr><th>{tr("整托","Unit")}</th><th>{tr("原底座 XYZ mm","Original base XYZ mm")}</th><th>{tr("候选底座 XYZ mm","Candidate base XYZ mm")}</th><th>{tr("实测保守包络 mm","Measured conservative envelope mm")}</th></tr></thead><tbody>{candidate.pallets!.map(p=>{const old=plan.pallets!.find(q=>q.id===p.id)!,e=palletLoadEnvelope(p,candidate.placements.filter(b=>b.palletIds?.includes(p.id)));return <tr key={p.id}><th>{p.id}</th><td>{old.x} / {old.y} / {old.z}</td><td>{p.x} / {p.y} / {p.z}</td><td>{e.dx} × {e.dy} × {e.dz}</td></tr>;})}</tbody></table></div>
   <button className="button" type="button" disabled={disabled} onClick={adopt}>{tr("采用实测重排并登记新版本","Adopt measured layout and issue revision")}</button>
   <p className="helper-text">{tr("采用前请保留当前工作区备份。采用时检查已装记录并另存新交付版本，旧工程记录仍属于旧版。整单重新计算使用原标称输入；采用后修改托内货物或再次旋转整托，需恢复原备份并重新测量。","Keep the current workspace backup. Adoption checks loaded records and saves a new delivery revision; old engineering records stay with the old revision. Whole-order recalculation uses nominal inputs. Changing contents or turning the unit again after adoption requires the original backup and new measurements.")}</p>
  </>}
  {plan.pallets?.some(p=>p.measuredEnvelope)&&<p>{tr("本方案已采用实测保守包络，尺寸、空隙和路径复核使用该占位；底座和内部可装空间没有扩大。","This plan uses adopted measured envelopes for occupied space, free-space and access review. Physical bases and usable interiors are unchanged.")}</p>}
 </section>;
}
