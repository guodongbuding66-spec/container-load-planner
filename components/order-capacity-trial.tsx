"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {prepareOrderCapacityTrial,reviewOrderCapacityTrial,replenishedOrder,type OrderCapacityTrial} from "../lib/packing/order-capacity";
import {palletSpecifications} from "../lib/packing/pallet-specifications";
import {packagingInterior} from "../lib/packing/packaging";
import {inspectPalletHeights,preparePalletHeightTrial,withVehiclePalletHeights} from "../lib/packing/pallet-height";
import {canCompareExistingPackaging,preparePackagingComparisonTrial,improvesPalletTrial,inspectPalletCapacity} from "../lib/packing/pallet-capacity";
import {PalletCapacityDiagnostics} from "./pallet-capacity-diagnostics";
import {PalletTailTrial} from "./pallet-tail-trial";
import type {PackingRequest,PackingResult,ProductInput,PalletBuildOptions} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

type Props={request:PackingRequest;plan?:PackingResult|null;measuredEnvelope?:boolean;volume:number;weight:number;disabled:boolean;canApply:boolean;onApply:(products:ProductInput[])=>void;onApplyBuild?:(build:PalletBuildOptions)=>void;onDesignPallet?:(specId:string)=>void};
export function useOrderCapacityTrial({request,volume,weight,disabled:inputDisabled,canApply,onApply,onApplyBuild,plan,measuredEnvelope}:Props){
 const disabled=inputDisabled||!!measuredEnvelope||!!plan?.pallets?.some(p=>p.measuredEnvelope);
 const key=JSON.stringify([request,volume,weight]),identity=useMemo(()=>({key,disabled,canApply}),[key,disabled,canApply]),worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),latest=useRef(identity),blocked=useRef(disabled);
 const [state,setState]=useState<{identity:typeof identity;kind:"running"|"done"|"cancelled"|"timeout"|"error";trial?:OrderCapacityTrial;plan?:PackingResult;error?:string}|null>(null);
 const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
 useLayoutEffect(()=>{latest.current=identity;blocked.current=disabled;return()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);};},[identity,disabled]);
 const current=state?.identity===identity?state:null;
 const run=(kind:"stock"|"height"|"packaging"="stock")=>{
  stop();if(disabled)return;
  try{
   const trial=kind==="height"?preparePalletHeightTrial(request):kind==="packaging"?preparePackagingComparisonTrial(request):prepareOrderCapacityTrial(request,volume,weight),w=new Worker(new URL("../lib/packing/order-capacity.worker.ts",import.meta.url),{type:"module"});worker.current=w;setState({identity,kind:"running",trial});
   const active=()=>worker.current===w&&latest.current===identity&&!blocked.current;
   timer.current=setTimeout(()=>{if(!active())return;stop();setState({identity,kind:"timeout"});},30000);
   w.onmessage=e=>{if(!active())return;stop();try{if(e.data.error)throw Error(e.data.error);const plan=reviewOrderCapacityTrial(trial,e.data.plan);setState({identity,kind:"done",trial,plan});}catch(error){setState({identity,kind:"error",error:error instanceof Error?error.message:String(error)});}};
   w.onerror=()=>{if(!active())return;stop();setState({identity,kind:"error"});};w.postMessage(trial);
  }catch(error){setState({identity,kind:"error",error:error instanceof Error?error.message:String(error)});}
 };
 const cancel=()=>{stop();setState({identity,kind:"cancelled"});};
 const adopt=()=>{if(disabled||!canApply||!current?.plan||worker.current)return;if(current.trial?.heightChanges||current.trial?.packagingSelectionChange){if(!plan||!improvesPalletTrial(current.plan,plan))return;onApplyBuild?.(structuredClone(current.trial.request.palletBuild!));}else onApply(replenishedOrder(request.products,current.plan));};
 return {current,run,cancel,adopt,running:current?.kind==="running"};
}

export function OrderCapacityTrial(props:Props){
 const language=useLanguage(),{request,plan,canApply}=props,task=useOrderCapacityTrial(props),trial=task.current?.trial,candidate=task.current?.plan;
 const measured=props.measuredEnvelope||plan?.pallets?.some(p=>p.measuredEnvelope);
 const rawError=task.current?.error,errorParts=rawError?.split(" / "),errorText=errorParts?.length===2?errorParts[language==="en"?1:0]:rawError&&language==="en"&&/[\u3400-\u9fff]/u.test(rawError)?"Review dimensions, packaging stock, load ratings and complete-kit rules.":rawError;
 const ordered=request.products.reduce((n,p)=>n+p.quantity,0),loaded=plan?.metrics.loadedCount;
 const added=candidate?replenishedOrder(request.products,candidate).reduce((n,p)=>n+p.quantity,0)-ordered:0;
 const specifications=useMemo(()=>request.palletBuild?palletSpecifications(request.palletBuild):[],[request.palletBuild]);
 const heights=useMemo(()=>inspectPalletHeights(request),[request]);
 const heightTrial=!!trial?.heightChanges,packagingTrial=!!trial?.packagingSelectionChange,buildTrial=heightTrial||packagingTrial,unmet=loaded!==undefined&&loaded<ordered;
 const buildImproves=!!candidate&&!!plan&&improvesPalletTrial(candidate,plan),candidateUnits=packagingTrial&&candidate?inspectPalletCapacity(candidate):null;
 const oneLayer=unmet&&!!plan?.placements.length&&plan.placements.every(b=>b.layer===1);
 const lowCeilings=oneLayer?heights.filter(s=>s.stock>0&&s.current+.0001<s.available&&s.products.some(p=>
   p.heightLayers===1&&p.minHeight!==null&&2*p.minHeight<=s.available+.0001&&p.configuredLayers!==1)):[];
 const openCeilings=lowCeilings.filter(s=>s.canRaise).map(s=>s.id);
 const status=task.current?.kind==="running"?(packagingTrial?tr("正在使用已登记的包装尺寸、库存和承重比选；订单和原方案保持不变。","Comparing registered packaging dimensions, stock and load ratings; the order and original plan are unchanged."):heightTrial?tr("正在提高开放式托盘限高并试装原订单；原方案保持不变。","Testing higher open-pallet ceilings with the original order; the original plan is unchanged."):tr("正在按原尺寸、包装库存和承重规则试装；原订单保持不变。","Testing the original geometry, packaging stock and load rules; the order is unchanged.")):task.current?.kind==="timeout"?tr("30 秒试算结束，未完成结果已丢弃，原方案保留。","The 30-second budget expired. Incomplete results were discarded; the original plan is retained."):task.current?.kind==="cancelled"?tr("已停止试算，原方案保留。","Trial cancelled; the original plan is retained."):task.current?.kind==="error"?tr("试算未完成，原方案保留。","Trial failed; the original plan is retained."):"";
 return <section className="order-capacity-trial" aria-label={tr("订单数量与补货试算","Order quantity and replenishment trial")}>
  <div className="panel-head"><div><h3>{loaded===undefined?tr("订单数量与装载试算","Order quantity and loading trials"):unmet?(request.workflow==="palletized"?tr("订单尚未装完：检查打托与堆叠限制","Order incomplete: review packaging and stacking limits"):tr("订单尚未装完：检查装载限制","Order incomplete: review loading limits")):tr("本单装完 ≠ 整柜装满","Order fulfilled ≠ container full")}</h3><p>{tr("订单量","Ordered")}: {ordered.toLocaleString()} {tr("箱","cartons")}{loaded!==undefined&&<> · {tr("当前已装","Currently loaded")}: {loaded.toLocaleString()} {tr("箱","cartons")}</>}</p></div></div>
  {lowCeilings.length>0&&<div className="pallet-height-action">
    {lowCeilings.map(s=><p key={s.id}><strong>{s.name} · {s.crate?tr("木箱内部净高","Crate interior height"):tr("托内货物限高","Pallet cargo height limit")} {Number(s.current.toFixed(1))} mm</strong> · {tr("当前高度只能放一层纸箱。","This height allows only one carton layer.")}</p>)}
    <div className="upgrade-actions">
      {props.onDesignPallet&&<button type="button" className="button primary" onClick={()=>props.onDesignPallet!(lowCeilings[0].id)}>{tr("按每托箱数重新打托","Resize packaging by cartons per pallet")}</button>}
      {openCeilings.length>0&&props.onApplyBuild&&request.palletBuild&&<button type="button" className="button"
        disabled={props.disabled||!!measured||!canApply||task.running} onClick={()=>props.onApplyBuild!(withVehiclePalletHeights(request.palletBuild!,openCeilings))}>{tr("按柜门净高重新计算","Recalculate using door clearance")}</button>}
    </div>
  </div>}
  <PalletCapacityDiagnostics plan={plan}/>
  <PalletTailTrial request={request} plan={plan} disabled={props.disabled||!!measured||task.running} canApply={canApply} onApply={props.onApplyBuild}/>
  {canCompareExistingPackaging(request)&&<div className="existing-packaging-trial"><button type="button" className="button" disabled={props.disabled||!!measured||task.running} onClick={()=>task.run("packaging")}>{tr("保持本单数量，按现有包装比选","Compare existing packaging for this order")}</button><p className="helper-text">{tr("比较已登记的适用规格，同货量优先较小包装；不新增规格，不增加库存，不提高限高或承重。逐托启发式搜索不保证全局最优。","Compare registered eligible specifications, preferring smaller packaging at equal cargo load. No specifications, stock, height limits or ratings are added. The per-unit heuristic is not globally optimal.")}</p></div>}
  {heights.length>0&&<details open={oneLayer} className="pallet-height-diagnostic" aria-label={tr("托内高度诊断","Pallet cargo height diagnosis")}><summary>{tr("托内限高与纸箱层数","Cargo ceilings and carton layers")}</summary>
   {oneLayer&&<p role="status"><strong>{tr("当前只生成了第一层，且仍有订单未装。","Only the first cargo layer was generated and order demand remains.")}</strong> {tr("整托堆叠 1 层只限制托盘之间叠放；托内纸箱仍可按以下规则加层。","A loaded-unit stack limit of 1 controls pallet-on-pallet stacking; cartons within a pallet use the rules below.")}</p>}
   <ul>{heights.map(s=><li key={s.id}><strong>{s.name}</strong> · {tr("当前托内净高","Current cargo ceiling")} {s.current.toFixed(1)} mm · {tr("柜门允许净高","Available cargo ceiling")} {s.available.toFixed(1)} mm
    <ul>{s.products.map(p=><li key={p.productId}>{p.sku} · {p.minHeight===null?tr("允许朝向无法放入此托盘底面","No allowed orientation fits this pallet footprint"):<>{tr("仅按高度最多","Height-only upper bound")} {p.heightLayers} {tr("层","layers")}</>}{p.configuredLayers!==null&&<> · {tr("箱体规则最多","Carton-rule limit")} {p.configuredLayers} {tr("层","layers")}</>}{p.payloadCartons!==null&&<> · {tr("单托载荷最多","Payload-only upper bound")} {p.payloadCartons} {tr("箱（未扣新增支承件）","cartons (before added support mass)")}</>}</li>)}</ul>
   </li>)}</ul>
   <p className="helper-text">{tr("这些是分别计算的上界，不代表可以同时达到；实际箱位还受朝向、承托、累计上压、套装及库存约束。","These are separate upper bounds, not a jointly achievable pack; orientation, support, cumulative top loads, kits and stock still apply.")}</p>
   {heights.some(s=>s.canRaise)&&<><button type="button" className="button" disabled={props.disabled||!!measured||task.running} onClick={()=>task.run("height")}>{tr("保持本单数量，按柜门净高试算打托","Trial this order using available cargo height")}</button><p className="helper-text">{tr("仅预览提高开放式托盘的货物限高，不改木箱内高、箱数、承重、箱体层数或朝向；采用后才更新限高并重新计算双算法。","Preview higher cargo ceilings for open pallets only. Crate interiors, order quantities, ratings, carton layers and orientations are retained. Apply explicitly to change ceilings and recalculate both solvers.")}</p></>}
  </details>}
  <p className="helper-text">{tr("按当前 SKU 比例增加假设货量，重新打托并试装；不表示原位置可直接补入。结果是当前算法找到的可行方案，不是全局最大容量。","Increase hypothetical stock in the current SKU ratio, rebuild units and repack. This is not an in-place insertion check or proof of maximum capacity.")}</p>
  <details><summary>{tr("查看当前限高、层数与包装限制","Review height, stacking and packaging limits")}</summary>
   <ul>{request.products.map(p=><li key={p.id}>{p.sku} · {!p.stackable?tr("不允许承托上方货物","Cannot support cargo above"):tr("允许几何堆叠","Geometric stacking allowed")} · {p.bottomOnly?tr("仅允许底置","Bottom-only"):tr("不限制底置","Not bottom-only")} · {tr("箱体层数上限","Carton layer limit")} {p.maxStackLayers||tr("按净高及载荷","Height and load rules")} · {tr("通用额定上压","General top-load rating")} {p.maxTopLoadKg===undefined?tr("未填写，承重未核验","Not supplied; load rating unverified"):`${p.maxTopLoadKg} kg`}</li>)}
    {specifications.map(s=><li key={s.id}>{s.config.name} · {tr("托内货物限高","Cargo height limit")} {s.config.maxCargoHeight?`${s.config.maxCargoHeight} mm`:tr("按柜内及门洞净高","Vehicle / door clearance")} · {tr("额定载荷","Payload")} {s.config.maxLoad} kg · {tr("可用包装","Available units")} {s.maxPallets} · {packagingInterior(s.config).crate?tr("木箱按当前额定叠放资料校验","Crate stacking uses current rating evidence"):`${tr("整托最多","Loaded-unit limit")} ${s.stackLayers} ${tr("层","layers")}`}</li>)}
    {request.palletBuild&&<li>{tr("全部规格合计生成上限","Total prepared-unit limit")}: {request.palletBuild.maxPallets}</li>}
    {request.floorPallets&&<li>{request.floorPallets.name} · {tr("底座高","Base height")} {request.floorPallets.height} mm · {tr("货物限高","Cargo height limit")} {request.floorPallets.maxCargoHeight||tr("按柜高及门洞","Vehicle / door clearance")} · {tr("单托载荷","Payload per pallet")} {request.floorPallets.maxLoad} kg</li>}
   </ul><p className="helper-text">{tr("规则未放宽。尺寸、门洞、朝向、承托、累计载荷、保护间隙和包装库存仍参与校验；运输固定及缺失额定资料仍需另行复核。","Rules are unchanged. Geometry, door fit, orientation, support, cumulative loads, gaps and packaging stock remain checked. Securing and missing ratings still need separate review.")}</p>
  </details>
  {measured&&<p role="status">{tr("当前方案已采用实测整托包络；本项试算不支持该包络，已停用。请在方案副本中单独复核，不能退回标称尺寸计算。","This plan uses measured unit envelopes. This trial does not support those envelopes and is disabled. Review a plan copy separately; do not fall back to nominal dimensions.")}</p>}
  <div className="upgrade-actions"><button type="button" className="button primary" disabled={props.disabled||!!measured||task.running} onClick={()=>task.run()}>{tr("试算增加货量（不改订单）","Trial additional cargo (keep order)")}</button><button type="button" className="button" disabled={!task.running} onClick={task.cancel}>{tr("停止试算","Stop trial")}</button></div>
  <p role="status">{status}</p>{errorText&&<p role="alert">{errorText}</p>}
  {candidate&&trial&&<div className="capacity-trial-result"><p><strong>{tr("试算可装","Trial loaded")} {candidate.metrics.loadedCount.toLocaleString()} {tr("箱","cartons")}</strong> · {tr("试算货量","Trial stock")} {candidate.metrics.requestedCount.toLocaleString()} · {tr("毛重","Gross")} {candidate.metrics.grossWeight.toLocaleString()} kg · {tr("体积利用率","Volume use")} {(candidate.metrics.volumeUtilization*100).toFixed(1)}%</p>
   {loaded!==undefined&&<p>{tr("与当前已装数量相比","Compared with currently loaded")}: {candidate.metrics.loadedCount-loaded>=0?"+":""}{candidate.metrics.loadedCount-loaded} {tr("箱","cartons")}</p>}
   {buildTrial?<><p>{tr("本次订单箱数保持","Original order retained")}: {ordered.toLocaleString()}</p>{heightTrial&&<ul>{trial.heightChanges!.map(s=><li key={s.id}>{s.name} · {tr("托内货物限高","Cargo height ceiling")}: {s.from.toFixed(1)} → {s.to.toFixed(1)} mm</li>)}</ul>}{packagingTrial&&<><p>{tr("包装选择：按列表顺序 → 同货量优先小包装；尺寸、限高、库存、上压和托内规则保持。","Packaging selection: list order → compact at equal load; dimensions, height ceilings, stock, top loads and cargo rules are retained.")}</p><ul>{candidateUnits?.groups.map(g=><li key={g.id}>{g.name} · {g.units} {tr("托／箱体单元","units")} · {g.cartons} {tr("箱","cartons")}</li>)}</ul></>}</>:<p>{tr("算术目标","Arithmetic target")}: {trial.arithmeticCartons.toLocaleString()} {tr("箱；包装及摆放后的结果以上方校验数量为准。装卸顺序、运输固定和缺失承重资料仍需复核。","cartons; use the validated packing count above. Unloading order, securing and missing load ratings still need review.")}</p>}
   {trial.budgetLimited&&<p>{tr("已触及 4000 箱试算预算；未证明剩余空间不可用。","The 4000-carton trial budget was reached; remaining space is not proven unusable.")}</p>}
   {candidate.palletization&&<p>{tr("已生成／已入柜整托","Prepared / loaded units")}: {candidate.palletization.preparedCount??candidate.pallets?.length} / {candidate.pallets?.length}{candidate.palletization.bounded?tr(" · 已触及包装或箱位搜索上限"," · Packaging or coordinate search limit reached"):""}</p>}
   <button type="button" className="button primary" disabled={props.disabled||!canApply||(buildTrial?(!props.onApplyBuild||!buildImproves):added<=0)} onClick={task.adopt}>{packagingTrial?tr("采用包装比选并重新计算","Apply packaging selection and recalculate"):heightTrial?tr("采用此限高，保持订单并重新计算","Apply cargo ceilings and recalculate this order"):tr("补充已验证货量并重新计算","Add validated stock and recalculate")} {!buildTrial&&added>0?`(+${added})`:""}</button>
   {(buildTrial?!buildImproves:added<=0)&&<p>{buildTrial?tr("候选未在保留各已装订单行数量的前提下增加总装箱数，不能一键采用。请检查限高、朝向、承托、载荷和包装库存；不会自动放宽这些规则。","The candidate did not increase total cartons while retaining every loaded order-row quantity, so it cannot be applied. Review height, orientation, support, payload and packaging stock; these rules are not relaxed automatically."):tr("未验证到新增订单量；请检查上述限高、层数、承重、尺寸及包装数量。不能仅凭剩余 CBM 判断能否补货。","No additional order stock was validated. Review the limits above; remaining CBM alone does not establish feasibility.")}</p>}
   {!canApply&&<p>{tr("已有交付版本，仅供试算；请在方案副本中调整订单。","An issued delivery version is preview-only. Change the order in a plan copy.")}</p>}
  </div>}
  <small>{tr("最多 4000 箱，30 秒；关闭、停止或参数变化会丢弃未完成试算。","Up to 4000 cartons and 30 seconds. Unmounting, cancellation or changed inputs discard unfinished trials.")}</small>
 </section>;
}
