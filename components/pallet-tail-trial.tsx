"use client";
import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {tailCargoGroups,preparePalletTailTrials,prepareJointPalletTailTrials,betterTailCandidate,TAIL_JOINT_CANDIDATE_LIMIT,type TailSearchMode,type TailCandidate} from "../lib/packing/pallet-tail";
import {reviewOrderCapacityTrial} from "../lib/packing/order-capacity";
import {improvesPalletTrial} from "../lib/packing/pallet-capacity";
import {retainsLoadedRows} from "../lib/packing/set-utils";
import {TailCandidateReview} from "./tail-candidate-review";
import {buildTailTrialReport,type TailComparisonRow} from "../lib/packing/pallet-tail-report";
import {TailReportDownloads} from "./tail-report-downloads";
import type {PackingRequest,PackingResult,PalletBuildOptions} from "../lib/packing/types";
import {tr,useLanguage} from "./language";

type Row=TailComparisonRow;
type Props={request:PackingRequest;plan?:PackingResult|null;disabled:boolean;canApply:boolean;onApply?:(build:PalletBuildOptions)=>void};

export function usePalletTailTrial({request,plan,disabled:inputDisabled,canApply,onApply}:Props){
 const groups=useMemo(()=>{try{return tailCargoGroups(request,plan);}catch{return [];}},[request,plan]);
 const [choice,setChoice]=useState<{id:string;limit:string}|null>(null),group=groups.find(g=>g.id===choice?.id)??groups[0];
 const [searchMode,setSearchMode]=useState<TailSearchMode>("quick");
 const [secondChoice,setSecondChoice]=useState<{id:string;limit:string}|null>(null),secondGroups=groups.filter(g=>g.id!==group?.id),secondGroup=secondGroups.find(g=>g.id===secondChoice?.id)??secondGroups[0];
 const [thirdChoice,setThirdChoice]=useState<{id:string;limit:string}|null>(null),thirdGroups=secondGroups.filter(g=>g.id!==secondGroup?.id),thirdGroup=thirdGroups.find(g=>g.id===thirdChoice?.id)??thirdGroups[0];
 const joint=searchMode==="joint"||searchMode==="triple",defaultLimit=searchMode==="triple"?2:joint?3:8;
 const limitText=choice&&choice.id===group?.id?choice.limit:String(Math.min(defaultLimit,group?.availableUnits??0)),limit=Number(limitText);
 const secondLimitText=secondChoice&&secondChoice.id===secondGroup?.id?secondChoice.limit:String(Math.min(defaultLimit,secondGroup?.availableUnits??0)),secondLimit=Number(secondLimitText);
 const thirdLimitText=thirdChoice&&thirdChoice.id===thirdGroup?.id?thirdChoice.limit:String(Math.min(2,thirdGroup?.availableUnits??0)),thirdLimit=Number(thirdLimitText);
 const blocked=!!plan?.pallets?.some(p=>p.measuredEnvelope||p.locked),disabled=inputDisabled||blocked||!plan;
 const inputKey=JSON.stringify([request,group?.id,limitText,searchMode,joint?[secondGroup?.id,secondLimitText]:null,searchMode==="triple"?[thirdGroup?.id,thirdLimitText]:null]),identity=useMemo(()=>({inputKey,plan,disabled,canApply}),[inputKey,plan,disabled,canApply]),latest=useRef(identity);
 const worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [state,setState]=useState<{identity:typeof identity;status:"running"|"done"|"cancelled"|"timeout"|"error";rows:Row[];total:number;best?:TailCandidate;error?:string}|null>(null);
 const stop=()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
 useLayoutEffect(()=>{latest.current=identity;return()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);};},[identity]);
 const current=state?.identity===identity?state:null,running=current?.status==="running",best=current?.best;
 const jointGrid=joint?(limit+1)*(secondLimit+1)*(searchMode==="triple"?thirdLimit+1:1)-1:0,jointTooLarge=joint&&jointGrid>TAIL_JOINT_CANDIDATE_LIMIT;
 const validLimit=Number.isSafeInteger(limit)&&limit>=1&&!!group&&limit<=group.availableUnits&&(!joint||!!secondGroup&&Number.isSafeInteger(secondLimit)&&secondLimit>=1&&secondLimit<=secondGroup.availableUnits&&!jointTooLarge)&&(searchMode!=="triple"||!!thirdGroup&&Number.isSafeInteger(thirdLimit)&&thirdLimit>=1&&thirdLimit<=thirdGroup.availableUnits);
 const run=()=>{
  stop();if(disabled||!plan||!group||!validLimit)return;
  try{
   const trials=searchMode==="quick"||searchMode==="detailed"?preparePalletTailTrials(request,plan,group.id,limit,searchMode):prepareJointPalletTailTrials(request,plan,[{groupId:group.id,limit},{groupId:secondGroup!.id,limit:secondLimit},...(searchMode==="triple"?[{groupId:thirdGroup!.id,limit:thirdLimit}]:[])]),w=new Worker(new URL("../lib/packing/pallet-tail.worker.ts",import.meta.url),{type:"module"});
   worker.current=w;let index=0,selected:TailCandidate|undefined;const rows:Row[]=[];
   setState({identity,status:"running",rows:[],total:trials.length});
   const active=()=>worker.current===w&&latest.current===identity;
   timer.current=setTimeout(()=>{if(!active())return;stop();setState({identity,status:"timeout",rows:[...rows],total:trials.length});},30000);
   w.onmessage=e=>{
    if(!active())return;
    if(e.data.index!==index){stop();setState({identity,status:"error",rows:[],total:trials.length});return;}
    const trial=trials[index];let candidate:PackingResult|undefined,problem:string|undefined=e.data.error;
    try{if(!problem)candidate=reviewOrderCapacityTrial(trial,e.data.plan);}catch(error){problem=error instanceof Error?error.message:String(error);}
    const retained=!!candidate&&retainsLoadedRows(candidate.placements,plan.placements);
    rows.push({units:trial.tailReservationChange!.units,allocation:trial.tailReservationChange!.groups?.map(g=>`${g.name}: ${g.units}`).join(" + "),groups:trial.tailReservationChange!.groups??[{id:group.id,name:group.name,units:trial.tailReservationChange!.units}],loaded:candidate?.metrics.loadedCount??null,retained,problem});
    if(candidate&&betterTailCandidate({trial,plan:candidate},plan,selected))selected={trial,plan:candidate};
    index++;const finished=index===trials.length;if(finished)stop();
    setState({identity,status:finished?"done":"running",rows:[...rows],total:trials.length,...(finished?{best:selected}:{})});
   };
   w.onerror=()=>{if(!active())return;stop();setState({identity,status:"error",rows:[...rows],total:trials.length});};
   w.postMessage({trials});
  }catch(error){setState({identity,status:"error",rows:[],total:0,error:error instanceof Error?error.message:String(error)});}
 };
 const cancel=()=>{stop();setState({identity,status:"cancelled",rows:[],total:0});};
 const adopt=()=>{if(disabled||!canApply||running||!best||!plan||!improvesPalletTrial(best.plan,plan))return;onApply?.(structuredClone(best.trial.request.palletBuild!));};
 const getReport=()=>{if(disabled||latest.current!==identity||current?.status!=="done"||!plan||!group||!validLimit)return;const selected=[{...group,limit},...(joint&&secondGroup?[{...secondGroup,limit:secondLimit}]:[]),...(searchMode==="triple"&&thirdGroup?[{...thirdGroup,limit:thirdLimit}]:[])];return buildTailTrialReport({request,baseline:plan,mode:searchMode,groups:selected.map(g=>({id:g.id,name:g.name,limit:g.limit,cartonsPerUnit:g.cartonsPerUnit})),rows:current.rows,best,canApply});};
 return {groups,setChoice,group,limitText,searchMode,setSearchMode,secondGroups,secondGroup,secondLimitText,setSecondChoice,thirdGroups,thirdGroup,thirdLimitText,setThirdChoice,joint,jointGrid,jointTooLarge,disabled,validLimit,run,cancel,adopt,current,running,best,blocked,getReport};
}

export function PalletTailTrial(props:Props){
 const {request,plan,canApply,onApply}=props,language=useLanguage();
 const {groups,setChoice,group,limitText,searchMode,setSearchMode,secondGroups,secondGroup,secondLimitText,setSecondChoice,thirdGroups,thirdGroup,thirdLimitText,setThirdChoice,joint,jointGrid,jointTooLarge,disabled,validLimit,run,cancel,adopt,current,running,best,blocked,getReport}=usePalletTailTrial(props);
 const parts=current?.error?.split(" / "),errorText=parts?.length===2?parts[language==="en"?1:0]:current?.error;
 const problemText=(problem:string)=>{const parts=problem.split(" / ");return parts.length===2?parts[language==="en"?1:0]:language==="en"&&/[\u3400-\u9fff]/u.test(problem)?"Review geometry, support, load ratings and complete-kit rules.":problem;};
 if(request.workflow!=="palletized")return null;
 return <details className="pallet-tail-trial"><summary>{tr("尾数散箱与整托混装试算","Trial loose tails alongside loaded pallets")}</summary>
  <p className="helper-text">{tr("从本单未装数量中预留尾数，完整套装一起划分；其余货物重新打托并装柜。原箱位不锁定，已有散箱预留只增不减。","Reserve tails from this order's unmet demand, keeping complete kits together; rebuild and repack the remaining cargo. Positions may change. Existing loose reservations are never reduced.")}</p>
  <label className="tail-search-scope">{tr("尾数搜索范围","Tail search scope")}<select aria-label={tr("尾数搜索范围","Tail search scope")} value={searchMode} disabled={disabled||running} onChange={e=>setSearchMode(e.target.value as TailSearchMode)}><option value="quick">{tr("快速候选","Quick candidates")}</option><option value="detailed">{tr("逐量细查","Every quantity")}</option><option value="joint" disabled={groups.length<2}>{tr("两组联合","Two groups together")}</option><option value="triple" disabled={groups.length<3}>{tr("三组联合","Three groups together")}</option></select></label>
  {group?<div className="tail-trial-fields"><label>{tr("订单行／套装","Order row / kit")}<select value={group.id} disabled={disabled||running} onChange={e=>{const g=groups.find(g=>g.id===e.target.value)!;setChoice({id:g.id,limit:String(Math.min(joint?searchMode==="triple"?2:3:8,g.availableUnits))});}}>{groups.map(g=><option value={g.id} key={g.id}>{g.name} · {g.cartonsPerUnit} {tr("箱／份","cartons / unit")}</option>)}</select></label>
   <label>{tr("最多新增散装份数","Maximum additional loose units")}<input type="number" min={1} max={group.availableUnits} step={1} value={limitText} disabled={disabled||running} onChange={e=>setChoice({id:group.id,limit:e.target.value})}/></label>
   <p className="helper-text">{tr("本行最多","This group allows up to")} {group.availableUnits} {searchMode==="quick"?tr("份；每次候选最多新增 64 箱。分别检查 1、2、4、8 份和所填上限，最多 5 个候选，不穷举所有数量。","units; each candidate adds at most 64 loose cartons. Test 1, 2, 4, 8 and the entered ceiling, at most 5 candidates; this does not enumerate every quantity."):tr("份；逐一检查上限内的整数份数。每个候选最多新增 64 箱；相同已装箱数时保留更少散箱预留的候选。","units; check integer quantities within the ceiling. Each candidate adds at most 64 loose cartons; equal loaded totals prefer fewer reserved loose cartons.")}</p>
   {joint&&secondGroup&&<><label>{tr("第二组订单行／套装","Second order row / kit")}<select value={secondGroup.id} disabled={disabled||running} onChange={e=>{const g=secondGroups.find(g=>g.id===e.target.value)!;setSecondChoice({id:g.id,limit:String(Math.min(searchMode==="triple"?2:3,g.availableUnits))});}}>{secondGroups.map(g=><option value={g.id} key={g.id}>{g.name} · {g.cartonsPerUnit} {tr("箱／份","cartons / unit")}</option>)}</select></label><label>{tr("第二组最多新增散装份数","Second maximum additional loose units")}<input type="number" min={1} max={secondGroup.availableUnits} step={1} value={secondLimitText} disabled={disabled||running} onChange={e=>setSecondChoice({id:secondGroup.id,limit:e.target.value})}/></label></>}
   {searchMode==="triple"&&thirdGroup&&<><label>{tr("第三组订单行／套装","Third order row / kit")}<select value={thirdGroup.id} disabled={disabled||running} onChange={e=>{const g=thirdGroups.find(g=>g.id===e.target.value)!;setThirdChoice({id:g.id,limit:String(Math.min(2,g.availableUnits))});}}>{thirdGroups.map(g=><option value={g.id} key={g.id}>{g.name} · {g.cartonsPerUnit} {tr("箱／份","cartons / unit")}</option>)}</select></label><label>{tr("第三组最多新增散装份数","Third maximum additional loose units")}<input type="number" min={1} max={thirdGroup.availableUnits} step={1} value={thirdLimitText} disabled={disabled||running} onChange={e=>setThirdChoice({id:thirdGroup.id,limit:e.target.value})}/></label></>}
   {joint&&<p className="helper-text">{tr("各组从 0 到上限联合检查，排除全部为 0 及合计新增超过 64 箱的组合。上限网格最多 64 个非零组合，超过时须降低上限，不截断候选列表。","Check each group from 0 through its ceiling, excluding all zero and allocations adding more than 64 cartons. The ceiling grid allows at most 64 nonzero allocations; reduce ceilings rather than truncating the list.")} {Number.isSafeInteger(jointGrid)&&jointGrid>0&&<strong>{tr("当前上限网格","Current ceiling grid")}: {jointGrid}</strong>}</p>}
   {!validLimit&&<p role="alert">{jointTooLarge?tr("联合候选超过 64 个，请降低各组上限。","The joint grid exceeds 64 candidates; reduce the ceilings."):joint?tr("请输入各组允许范围内的整数；联合试算需要不同的组。","Enter integers within each group's range; joint trials require distinct groups."):tr("请输入本行允许范围内的整数。","Enter an integer within this group's allowed range.")}</p>}
  </div>:<p>{tr("需要已计算且仍有未装纸箱的整托方案；套装必须有完整余量。","A calculated palletized plan with unmet carton demand is required; kits need complete remaining units.")}</p>}
  {blocked&&<p role="status">{tr("已有实测包络或锁定整托，已停用重新打托试算。","Measured envelopes or locked units disable this rebuilding trial.")}</p>}
  <div className="upgrade-actions"><button type="button" className="button" disabled={disabled||!group||!validLimit||running} onClick={run}>{tr("保持本单数量，比较尾数混装","Compare loose tails for this order")}</button><button type="button" className="button" disabled={!running} onClick={cancel}>{tr("停止尾数试算","Stop tail trial")}</button></div>
  {current&&<p role="status">{current.status==="running"?`${tr("正在校验候选","Checking candidates")} ${current.rows.length} / ${current.total}`:current.status==="done"?tr("尾数试算完成，原方案保持。","Tail comparison complete; the original plan is retained."):current.status==="timeout"?tr("30 秒预算已结束，未完成批次不允许采用。","The 30-second budget expired; the incomplete batch cannot be applied."):current.status==="cancelled"?tr("已停止，原方案保持。","Stopped; the original plan is retained."):tr("试算未完成，原方案保持。","Trial failed; the original plan is retained.")}</p>}
  {errorText&&<p role="alert">{errorText}</p>}
  {best&&<div className="capacity-trial-result"><p><strong>{tr("尾数候选可装","Tail candidate loads")} {best.plan.metrics.loadedCount} {tr("箱","cartons")}</strong> · {tr("原订单","Original order")} {best.plan.metrics.requestedCount} · {tr("整托","Loaded units")} {best.plan.pallets?.length??0} · {tr("毛重","Gross")} {best.plan.metrics.grossWeight} kg</p>
   {plan&&<TailCandidateReview request={request} baseline={plan} candidate={best.plan}/>}
   <button type="button" className="button primary" disabled={disabled||!canApply||!onApply||running} onClick={adopt}>{tr("采用尾数预留并重新计算","Apply tail reservations and recalculate")}</button>
  </div>}
  {!!current?.rows.length&&<div className="pallet-capacity-table tail-candidate-table" tabIndex={0} role="region" aria-label={tr("尾数候选比较结果","Tail candidate comparison results")}><table><thead><tr><th>{tr("新增散装份数／组合","Extra loose units / allocation")}</th><th>{tr("整单已装箱数","Total cartons loaded")}</th><th>{tr("已装订单行","Loaded order rows")}</th><th>{tr("复核说明","Review")}</th></tr></thead><tbody>{current.rows.map(r=><tr key={r.allocation??r.units}><td>{r.allocation??r.units}</td><td>{r.loaded??tr("未通过复核","Not validated")}</td><td>{r.retained?tr("数量不减","Retained"):tr("不可采用","Unavailable")}</td><td>{r.problem?problemText(r.problem):r.loaded!==null&&!r.retained?tr("会减少至少一个已装订单行","Would reduce at least one loaded order row"):r.loaded!==null&&r.loaded<=(plan?.metrics.loadedCount??0)?tr("未增加总箱数","No total-carton increase"):tr("通过模型校验","Model validation passed")}</td></tr>)}</tbody></table></div>}
  {current?.status==="done"&&!best&&<p>{tr("本批次未找到总箱数增加且各已装订单行不减量的合法候选；不代表其他数量无解。","No validated candidate in this batch increased the total while retaining every loaded order row; other quantities may still work.")}</p>}
  {current?.status==="done"&&<TailReportDownloads enabled={!disabled} hasCandidate={!!best} getReport={getReport}/>}
  {!canApply&&<p>{tr("已有交付版本，仅可预览；请在方案副本中修改。","Issued delivery versions are preview-only; change a plan copy.")}</p>}
  <small>{tr("不增加订单、包装库存、限高或承重；散箱与整托不互相承托、不占托内空隙。只比较所选的最多三组订单行／套装，30 秒，订单最多 4000 箱；不代表原位补货、最优解或运输固定核验。","Order demand, packaging stock, height ceilings and ratings remain intact. Loose cartons cannot cross-support pallets or use their internal voids. Compare up to three selected rows / kits, up to 4000 ordered cartons and 30 seconds; this is not in-place insertion, an optimality proof or securing verification.")}</small>
 </details>;
}
