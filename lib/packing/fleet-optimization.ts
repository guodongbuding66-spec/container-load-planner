import {ENGINE_VERSION} from "./engine";
import {allocateFleet,type FleetLoad,type FleetResult} from "./fleet";
import {parseFleetBackup,serializeFleetBackup} from "./fleet-file";
import {fleetCanonical,validateFleet} from "./fleet-validation";
import {fleetCosts,type DeliveryCharge} from "./fleet-costs";
import {fleetTailGroups,fleetTailRows,type FleetSnapshot,type FleetTailAllocation,type FleetTailRow} from "./fleet-tail";
import {fillFleetGaps} from "./fleet-gap-fill";
import {parsePalletBuild} from "./loading-workflow";
import {normalizedSetCode,normalizedUnitsPerSet} from "./set-utils";
import {toCsvCell} from "./csv";

export const FLEET_OPTIMIZATION_LIMIT=64;
export type FleetOptimizationSettings={mode:"reallocate"|"fill";keepPrefix:number;cartonBudget:number;comparePackaging:boolean;rework:{dismantle:number|null;rebuild:number|null;source:string}};
export type FleetOptimizationSpec={units:number[];selection:"ordered"|"compact"};
export type FleetOptimizationGroup={id:string;name:string;cartonsPerUnit:number;ceiling:number};
export type PreparedFleetOptimization={source:FleetSnapshot;settings:FleetOptimizationSettings;groups:FleetOptimizationGroup[];seeds:FleetOptimizationSpec[];exhaustive:boolean;domainSize:number|null};
export type FleetOptimizationCandidate={index:number;spec:FleetOptimizationSpec;allocations:FleetTailAllocation[];addedCartons:number;containers:number;loaded:number;remaining:number;packaging:number;loose:number;baseConfiguredTotal:number|null;dismantled:number;rebuilt:number;reworkTotal:number|null;configuredTotal:number|null;retainsRows:boolean;improves:boolean;rows:FleetTailRow[]};
export type FleetOptimizationReport={format:"cargo-fit-fleet-optimization";version:1;engineVersion:string;status:"preview-not-applied";complete:true;source:FleetSnapshot;settings:FleetOptimizationSettings;groups:FleetOptimizationGroup[];search:{kind:"complete-grid"|"adaptive";candidateDomain:number|null;budget:number;evaluated:number};candidates:FleetOptimizationCandidate[];bestIndex:number|null;best?:FleetSnapshot};

export function minimumFleetPrefix(source:FleetSnapshot,mode:"reallocate"|"fill"="reallocate"){let minimum=0;source.result.loads.forEach((l,i)=>{if(l.frozen!==undefined||l.plan.deliveryIdentity||mode==="reallocate"&&(l.plan.placements.some(b=>b.locked)||l.plan.pallets?.some(p=>p.locked||p.measuredEnvelope)))minimum=i+1;});return minimum;}
const currentSelection=(s:FleetSnapshot)=>s.request.palletBuild?.selection??"ordered";
const specKey=(s:FleetOptimizationSpec)=>JSON.stringify([s.units,s.selection]);
const extraCartons=(p:Pick<PreparedFleetOptimization,"groups">,s:FleetOptimizationSpec)=>s.units.reduce((n,u,i)=>n+u*p.groups[i].cartonsPerUnit,0);
function normalizedSource(source:FleetSnapshot):FleetSnapshot{
 const v=parseFleetBackup(serializeFleetBackup(source));return {request:v.request,options:v.options,limit:v.limit,objective:v.objective,pricing:v.pricing,result:v.result};
}
function frozenPrefix(p:Pick<PreparedFleetOptimization,"source"|"settings">):FleetLoad[]{
 const b=parsePalletBuild(p.source.request.palletBuild);
 return p.source.result.loads.slice(0,p.settings.keepPrefix).map(l=>({...structuredClone(l),frozen:structuredClone(l.frozen??{selection:b.selection??"ordered",...(b.looseQuantities?{looseQuantities:b.looseQuantities}:{})})}));
}

/** Every selected group keeps its source identity; the whole-kit upper bound also respects fixed cargo. */
export function prepareFleetOptimization(source:FleetSnapshot,settings:FleetOptimizationSettings):PreparedFleetOptimization{
 const s=normalizedSource(source),n=s.request.products.reduce((a,p)=>a+p.quantity,0),v=structuredClone(settings);
 if(s.request.workflow!=="palletized"||s.request.mode!=="mixed"||n<1||n>4000||s.limit>20||!s.result.loads.length)throw Error("自动优化支持 1–4000 箱、1–20 柜的预打托整单 / Automatic optimization supports prebuilt orders of 1–4000 cartons and 1–20 containers");
 if(!v||!["reallocate","fill"].includes(v.mode)||typeof v.comparePackaging!=="boolean"||!Number.isSafeInteger(v.keepPrefix)||v.keepPrefix<minimumFleetPrefix(s,v.mode)||v.keepPrefix>s.result.loads.length||!Number.isSafeInteger(v.cartonBudget)||v.cartonBudget<1||v.cartonBudget>64||!v.rework||typeof v.rework.source!=="string"||v.rework.source.length>500)throw Error("请检查已装柜前缀、搜索预算和费用资料 / Check the committed prefix, search budget and quotes");
 for(const price of [v.rework.dismantle,v.rework.rebuild])if(price!==null&&(typeof price!=="number"||!Number.isFinite(price)||price<0||price>1e7))throw Error("拆托与重打单价无效 / Invalid dismantling or rebuilding quote");
 if(v.mode==="reallocate"&&[v.rework.dismantle,v.rework.rebuild].some(q=>q!==null)&&!v.rework.source.trim())throw Error("填写费用时须记录报价来源 / A quote source is required");
 if(v.mode==="reallocate"&&s.objective==="cost"&&[v.rework.dismantle,v.rework.rebuild].some(q=>q===null))throw Error("费用优先须明确拆托与重打报价，免费请填 0 / Cost priority requires dismantling and rebuilding quotes; explicitly quote zero for free");
 if(v.mode==="reallocate"&&(s.pricing?.charges?.length??0)>28)throw Error("附加报价最多 30 项，请为本轮拆托和重打保留两项 / Reserve two of the 30 charge slots for this optimization");
 const retained=s.result.loads.slice(0,v.keepPrefix),fixedPalletized=new Map<string,number>(),allLoaded=new Map<string,number>();
 for(const l of retained)for(const b of l.plan.placements)if(b.palletIds?.length)fixedPalletized.set(b.productId,(fixedPalletized.get(b.productId)??0)+1);
 for(const l of s.result.loads)for(const b of l.plan.placements)allLoaded.set(b.productId,(allLoaded.get(b.productId)??0)+1);
 const groups=fleetTailGroups(s.request).map(g=>({...g,availableUnits:Math.min(g.availableUnits,Math.floor(v.cartonBudget/g.cartonsPerUnit),...g.products.map(p=>Math.floor(Math.max(0,v.mode==="fill"?p.quantity-(allLoaded.get(p.id)??0):p.quantity-(fixedPalletized.get(p.id)??0)-(s.request.palletBuild?.looseQuantities?.[p.id]??0))/(normalizedSetCode(p)?normalizedUnitsPerSet(p):1))))})).filter(g=>g.availableUnits>0);
 if(groups.length>64)throw Error("本轮最多自动优化 64 个源行或完整套装 / This batch supports at most 64 order rows or whole kits");
 if(v.mode==="fill"&&(!groups.length||v.keepPrefix===s.result.loads.length))throw Error("现有未封存柜没有可补入的订单余货 / No remaining order cargo can be added to the open containers");
 const p:PreparedFleetOptimization={source:s,settings:v,groups:groups.map(g=>({id:g.id,name:g.name,cartonsPerUnit:g.cartonsPerUnit,ceiling:g.availableUnits})),seeds:[],exhaustive:false,domainSize:0};
 const choices:("ordered"|"compact")[]=[currentSelection(s)];if(v.mode==="reallocate"&&v.comparePackaging)choices.push(choices[0]==="ordered"?"compact":"ordered");
 let domain=choices.length;for(const g of groups){domain*=g.availableUnits+1;if(!Number.isSafeInteger(domain)){domain=Infinity;break;}}p.domainSize=Number.isFinite(domain)?Math.max(0,domain-1):null;
 const seen=new Set<string>(),add=(units:number[],selection:typeof choices[number])=>{const item={units,selection},key=specKey(item);if(!seen.has(key)&&extraCartons(p,item)<=v.cartonBudget&&(units.some(u=>u>0)||selection!==currentSelection(s))){seen.add(key);p.seeds.push(item);}};
 if(domain-1<=64){
  p.exhaustive=true;
  const visit=(i:number,units:number[])=>{if(i===groups.length){for(const c of choices)add(units,c);return;}for(let u=0;u<=groups[i].availableUnits;u++)visit(i+1,[...units,u]);};visit(0,[]);
 }else{
  const spread=(targets:number[])=>{const units=groups.map(()=>0);let left=v.cartonBudget,changed=true;while(changed){changed=false;for(let i=0;i<units.length;i++)if(units[i]<Math.min(targets[i],groups[i].availableUnits)&&groups[i].cartonsPerUnit<=left){units[i]++;left-=groups[i].cartonsPerUnit;changed=true;}}return units;};
  const tails=groups.map(g=>{
   const ids=new Set(g.products.map(q=>q.id)),sizes:number[]=[];
   for(const l of s.result.loads.slice(v.keepPrefix))for(const unit of l.plan.pallets??[]){const cargo=l.plan.placements.filter(b=>b.palletIds?.includes(unit.id));if(!cargo.length||cargo.some(b=>!ids.has(b.productId)))continue;const units=Math.min(...g.products.map(q=>cargo.filter(b=>b.productId===q.id).length/(normalizedSetCode(q)?normalizedUnitsPerSet(q):1)));if(Number.isSafeInteger(units)&&units>0)sizes.push(units);}
   return Math.min(g.availableUnits,sizes.length?Math.min(...sizes):1);
  });
  for(const units of [spread(tails),... [1,2,4,8,16,32,64].map(level=>spread(groups.map(()=>level)))])for(const c of choices)add(units,c);
  for(let i=0;i<groups.length;i++)for(const amount of [...new Set([tails[i],1,2,4,8,groups[i].availableUnits])])if(amount<=groups[i].availableUnits)for(const c of choices)add(groups.map((_,j)=>i===j?amount:0),c);
  for(const c of choices)add(groups.map(()=>0),c);
  p.seeds=p.seeds.slice(0,24);
 }
 if(!p.seeds.length)p.seeds=[{units:groups.map(()=>0),selection:currentSelection(s)}];
 if(p.exhaustive)p.domainSize=p.seeds.length;
 return p;
}

/** Reconstruct inputs from the validated source, never from a candidate's claimed request. */
export function fleetOptimizationTrial(p:PreparedFleetOptimization,spec:FleetOptimizationSpec){
 if(!spec||!Array.isArray(spec.units)||spec.units.length!==p.groups.length||spec.units.some((u,i)=>!Number.isSafeInteger(u)||u<0||u>p.groups[i].ceiling)||extraCartons(p,spec)>p.settings.cartonBudget||![currentSelection(p.source),...(p.settings.mode==="reallocate"&&p.settings.comparePackaging?["ordered","compact"]:[])].includes(spec.selection))throw Error("自动优化配额向量无效 / Invalid optimization vector");
 const request=structuredClone(p.source.request),build=parsePalletBuild(request.palletBuild),looseQuantities={...build.looseQuantities};
 const definitions=new Map(fleetTailGroups(request).map(g=>[g.id,g]));
 for(let i=0;i<p.groups.length;i++)if(spec.units[i])for(const product of definitions.get(p.groups[i].id)!.products)looseQuantities[product.id]=(looseQuantities[product.id]??0)+spec.units[i]*(normalizedSetCode(product)?normalizedUnitsPerSet(product):1);
 request.palletBuild=parsePalletBuild({...build,selection:spec.selection,looseQuantities});
 return {request,options:structuredClone(p.source.options),limit:p.source.limit,objective:p.source.objective,pricing:structuredClone(p.source.pricing)};
}
export function solveFleetOptimizationTrial(p:PreparedFleetOptimization,spec:FleetOptimizationSpec):FleetResult{
 const v=fleetOptimizationTrial(p,spec),prefix=frozenPrefix(p);
 const result=p.settings.mode==="fill"?fillFleetGaps(v.request,p.source.result,prefix,v.pricing):allocateFleet(v.request,v.options,v.limit,v.objective,undefined,v.pricing,prefix);
 const checked=validateFleet(v.request,result,v.options,v.limit);if(!checked.valid)throw Error(checked.errors.join("; "));return result;
}
function rework(p:PreparedFleetOptimization,value:FleetSnapshot){
 const dismantled=p.settings.mode==="fill"?0:p.source.result.loads.slice(p.settings.keepPrefix).reduce((n,l)=>n+(l.plan.pallets?.length??0),0),rebuilt=p.settings.mode==="fill"?0:value.result.loads.slice(p.settings.keepPrefix).reduce((n,l)=>n+(l.plan.pallets?.length??0),0);
 const costs=[{kind:"dismantle",count:dismantled,unit:p.settings.rework.dismantle},{kind:"rebuild",count:rebuilt,unit:p.settings.rework.rebuild}];
 const total=costs.some(c=>c.count&&c.unit===null)?null:costs.reduce((n,c)=>n+c.count*(c.unit??0),0);
 if(!dismantled&&!rebuilt)return {value,dismantled,rebuilt,total};
 const charges=[...value.pricing?.charges??[]];let number=1;while(charges.some(c=>c.id===`optimization-${number}-dismantle`||c.id===`optimization-${number}-rebuild`))number++;
 for(const c of costs)if(c.count){const charge:DeliveryCharge={id:`optimization-${number}-${c.kind}`,label:c.kind==="dismantle"?`Dismantling ${c.count} units`:`Rebuilding ${c.count} units`,category:"rework",basis:"order",amount:c.unit===null?null:c.unit*c.count,currency:value.pricing?.currency??"CNY",source:c.unit===null?"":`${p.settings.rework.source} | ${c.count} x ${c.unit}`};charges.push(charge);}
 const pricing={currency:value.pricing?.currency??"CNY",packaging:{...value.pricing?.packaging},...value.pricing,charges},result={...value.result,pricing,costs:fleetCosts(value.result.loads,pricing)};
 return {value:{...value,pricing,result},dismantled,rebuilt,total};
}
function compare(a:Pick<FleetOptimizationCandidate,"loaded"|"containers"|"configuredTotal">,b:Pick<FleetOptimizationCandidate,"loaded"|"containers"|"configuredTotal">,objective:"count"|"cost"){
 const quantity=a.loaded-b.loaded,cost=a.configuredTotal!==null&&b.configuredTotal!==null?b.configuredTotal-a.configuredTotal:0,containers=b.containers-a.containers;return quantity||(objective==="count"?containers||cost:cost||containers);
}
function baselineScore(p:PreparedFleetOptimization){return {loaded:p.source.result.loads.reduce((n,l)=>n+l.plan.placements.length,0),containers:p.source.result.loads.length,configuredTotal:p.source.result.costs?.total??null};}

export function reviewFleetOptimization(p:PreparedFleetOptimization,spec:FleetOptimizationSpec,index:number,result:FleetResult){
 const trial=fleetOptimizationTrial(p,spec),checked=normalizedSource({...trial,result}),prefix=frozenPrefix(p);
 for(let i=0;i<prefix.length;i++)if(fleetCanonical(checked.result.loads[i])!==fleetCanonical(prefix[i]))throw Error("已装柜前缀发生变化 / Committed container prefix changed");
 if(checked.result.loads.slice(prefix.length).some(l=>l.frozen!==undefined))throw Error("候选增加了未经确认的已装柜 / Candidate added an unconfirmed committed container");
 if(p.settings.mode==="fill"){
  if(checked.result.loads.length!==p.source.result.loads.length)throw Error("空隙补货不得增减现有柜 / Gap filling cannot change existing containers");
  p.source.result.loads.forEach((l,i)=>{const after=checked.result.loads[i].plan;if(fleetCanonical(l.plan.pallets)!==fleetCanonical(after.pallets)||fleetCanonical(l.plan.container)!==fleetCanonical(after.container))throw Error("空隙补货移动了原整托 / Gap filling moved an existing unit");for(const box of l.plan.placements){const next=after.placements.find(b=>b.id===box.id);if(!next||fleetCanonical({...box,layer:undefined})!==fleetCanonical({...next,layer:undefined}))throw Error("空隙补货改变了原箱位或身份 / Gap filling changed an original carton or its identity");}});
 }
 const baseConfiguredTotal=checked.result.costs?.total??null,r=rework(p,checked),value=normalizedSource(r.value),rows=fleetTailRows(value.request,p.source.result,value.result),retainsRows=rows.every(row=>row.loaded>=row.before);
 const summary:FleetOptimizationCandidate={index,spec:structuredClone(spec),allocations:p.groups.map((g,i)=>({id:g.id,name:g.name,units:spec.units[i],cartons:spec.units[i]*g.cartonsPerUnit})),addedCartons:extraCartons(p,spec),containers:value.result.loads.length,loaded:rows.reduce((n,row)=>n+row.loaded,0),remaining:rows.reduce((n,row)=>n+row.unloaded,0),packaging:value.result.inventory?.totalUsed??0,loose:rows.reduce((n,row)=>n+row.loose,0),baseConfiguredTotal,dismantled:r.dismantled,rebuilt:r.rebuilt,reworkTotal:r.total,configuredTotal:value.result.costs?.total??null,retainsRows,improves:false,rows};
 summary.improves=retainsRows&&compare(summary,baselineScore(p),p.source.objective)>0;
 return {summary,value};
}

/** Deterministic scheduling can also replay a completed report without retaining every fleet's geometry. */
function optimizationSchedule(p:PreparedFleetOptimization){
 const queue=p.seeds.map(s=>structuredClone(s)),seen=new Set(queue.map(specKey)),expanded=new Set<string>(),candidates:FleetOptimizationCandidate[]=[];
 let pending:FleetOptimizationSpec|undefined,done=false,bestIndex:number|null=null;
 const enqueue=(spec:FleetOptimizationSpec)=>{if(seen.has(specKey(spec)))return;try{fleetOptimizationTrial(p,spec);seen.add(specKey(spec));queue.push(spec);}catch{/* Outside this bounded domain. */}};
 const next=()=>{
  if(pending)throw Error("上个候选尚未复核 / The previous candidate is not reviewed");
  if(done)return null;
  if(!queue.length&&!p.exhaustive&&candidates.length<64){const anchor=bestIndex===null?{units:p.groups.map(()=>0),selection:currentSelection(p.source)}:candidates[bestIndex].spec,key=specKey(anchor);if(!expanded.has(key)){expanded.add(key);for(let i=0;i<p.groups.length;i++)for(const step of [1,-1,2,-2,4,-4]){const units=[...anchor.units];units[i]+=step;enqueue({units,selection:anchor.selection});}if(p.settings.comparePackaging&&p.settings.mode==="reallocate")enqueue({units:[...anchor.units],selection:anchor.selection==="ordered"?"compact":"ordered"});}}
  if(!queue.length||candidates.length===64){done=true;return null;}pending=queue.shift()!;return {index:candidates.length,spec:structuredClone(pending)};
 };
 return {next,total:p.exhaustive?p.seeds.length:64,get pending(){return pending;},get done(){return done;},get candidates(){return candidates;},get bestIndex(){return bestIndex;},record(summary:FleetOptimizationCandidate){
  if(done||!pending||summary.index!==candidates.length||specKey(summary.spec)!==specKey(pending))throw Error("自动优化候选顺序无效 / Invalid optimization sequence");
  candidates.push(summary);pending=undefined;
  if(summary.improves&&(bestIndex===null||compare(summary,candidates[bestIndex],p.source.objective)>0||compare(summary,candidates[bestIndex],p.source.objective)===0&&summary.addedCartons<candidates[bestIndex].addedCartons))bestIndex=summary.index;
 }};
}

/** Seed broadly, then refine the best independently reviewed vector, one acknowledged solve at a time. */
export function createFleetOptimizationSearch(p:PreparedFleetOptimization){
 const schedule=optimizationSchedule(p);let best:FleetSnapshot|undefined;
 return {next:schedule.next,total:schedule.total,accept(index:number,result:FleetResult){
  if(!schedule.pending||index!==schedule.candidates.length)throw Error("自动优化候选顺序无效 / Invalid optimization sequence");
  const reviewed=reviewFleetOptimization(p,schedule.pending,index,result);schedule.record(reviewed.summary);if(schedule.bestIndex===index)best=reviewed.value;return schedule.candidates.length;
 },finish():FleetOptimizationReport{
  if(!schedule.done||schedule.pending||!schedule.candidates.length)throw Error("整批优化尚未完成 / Optimization batch is incomplete");
  return {format:"cargo-fit-fleet-optimization",version:1,engineVersion:ENGINE_VERSION,status:"preview-not-applied",complete:true,source:structuredClone(p.source),settings:structuredClone(p.settings),groups:structuredClone(p.groups),search:{kind:p.exhaustive?"complete-grid":"adaptive",candidateDomain:p.domainSize,budget:64,evaluated:schedule.candidates.length},candidates:structuredClone(schedule.candidates),bestIndex:schedule.bestIndex,...(best?{best:structuredClone(best)}:{})};
 }};
}

function reviewTranscript(p:PreparedFleetOptimization,report:FleetOptimizationReport){
 const schedule=optimizationSchedule(p),baseline=fleetTailRows(p.source.request,p.source.result,p.source.result),prefixUnits=p.source.result.loads.slice(0,p.settings.keepPrefix).reduce((n,l)=>n+(l.plan.pallets?.length??0),0);
 const sameMoney=(a:number|null,b:number|null)=>a===null||b===null?a===b:Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-6,Math.max(Math.abs(a),Math.abs(b))*Number.EPSILON*8);
 if(report.search.kind!==(p.exhaustive?"complete-grid":"adaptive")||report.search.candidateDomain!==p.domainSize||report.search.budget!==64)throw Error("优化搜索范围不一致 / Optimization search scope differs");
 for(const c of report.candidates){
  const job=schedule.next();if(!job||job.index!==c.index||specKey(job.spec)!==specKey(c.spec))throw Error("优化候选记录缺失或顺序不一致 / Optimization transcript is missing or out of order");
  const trial=fleetOptimizationTrial(p,c.spec),expected=p.groups.map((g,i)=>({id:g.id,name:g.name,units:c.spec.units[i],cartons:c.spec.units[i]*g.cartonsPerUnit}));
  if(fleetCanonical(expected)!==fleetCanonical(c.allocations)||c.addedCartons!==extraCartons(p,c.spec)||c.rows.length!==baseline.length)throw Error("候选配额记录不一致 / Candidate allocation ledger differs");
  for(let i=0;i<baseline.length;i++){const r=c.rows[i],old=baseline[i];if(r.id!==old.id||r.label!==old.label||r.requested!==old.requested||r.before!==old.before||[r.loaded,r.loose,r.palletized,r.unloaded].some(n=>!Number.isSafeInteger(n)||n<0)||r.loaded!==r.loose+r.palletized||r.unloaded!==r.requested-r.loaded||r.reserved!==(trial.request.palletBuild!.looseQuantities?.[r.id]??0)||r.loose>r.reserved||r.palletized>r.requested-r.reserved)throw Error("候选源行记录不一致 / Candidate source-row ledger differs");}
  const retains=c.rows.every(r=>r.loaded>=r.before),dismantled=p.settings.mode==="fill"?0:p.source.result.loads.slice(p.settings.keepPrefix).reduce((n,l)=>n+(l.plan.pallets?.length??0),0),rebuilt=p.settings.mode==="fill"?0:c.packaging-prefixUnits,work=dismantled&&p.settings.rework.dismantle===null||rebuilt&&p.settings.rework.rebuild===null?null:dismantled*(p.settings.rework.dismantle??0)+rebuilt*(p.settings.rework.rebuild??0);
  if(!Number.isSafeInteger(c.containers)||c.containers<p.settings.keepPrefix||c.containers>p.source.limit||!Number.isSafeInteger(c.packaging)||c.packaging<prefixUnits||c.packaging>p.source.request.palletBuild!.maxPallets||c.loaded!==c.rows.reduce((n,r)=>n+r.loaded,0)||c.remaining!==c.rows.reduce((n,r)=>n+r.unloaded,0)||c.loose!==c.rows.reduce((n,r)=>n+r.loose,0)||c.dismantled!==dismantled||c.rebuilt!==rebuilt||!sameMoney(c.reworkTotal,work)||!sameMoney(c.configuredTotal,c.baseConfiguredTotal===null||work===null?null:c.baseConfiguredTotal+work)||c.retainsRows!==retains||c.improves!==(retains&&compare(c,baselineScore(p),p.source.objective)>0))throw Error("候选费用或完成记录不一致 / Candidate cost or completion ledger differs");
  schedule.record(c);
 }
 if(schedule.next()!==null||schedule.bestIndex!==report.bestIndex)throw Error("整批优化尚未完成或选中候选不一致 / Optimization batch is incomplete or its selected candidate differs");
}

export function adoptFleetOptimization(p:PreparedFleetOptimization,report:FleetOptimizationReport):FleetSnapshot{
 if(report.format!=="cargo-fit-fleet-optimization"||report.version!==1||report.engineVersion!==ENGINE_VERSION||report.status!=="preview-not-applied"||report.complete!==true||fleetCanonical(report.source)!==fleetCanonical(p.source)||fleetCanonical(report.settings)!==fleetCanonical(p.settings)||fleetCanonical(report.groups)!==fleetCanonical(p.groups)||report.bestIndex===null||!report.best||report.search.evaluated!==report.candidates.length||report.candidates.length<1||report.candidates.length>64)throw Error("自动优化结果已失效 / Stale optimization report");
 reviewTranscript(p,report);
 const c=report.candidates[report.bestIndex];if(!c||c.index!==report.bestIndex)throw Error("选中候选无效 / Invalid selected candidate");
 // Derived rework charges are recomputed from the source quotes and actual unit counts.
 const trial=fleetOptimizationTrial(p,c.spec),base={...report.best,result:{...report.best.result,pricing:trial.pricing,costs:fleetCosts(report.best.result.loads,trial.pricing)},pricing:trial.pricing};
 if(fleetCanonical({...base,result:undefined})!==fleetCanonical({...trial,result:undefined}))throw Error("候选输入与本轮设置不一致 / Candidate inputs differ from this batch");
 const reviewed=reviewFleetOptimization(p,c.spec,c.index,base.result);
 if(!reviewed.summary.improves||fleetCanonical(reviewed.summary)!==fleetCanonical(c)||fleetCanonical(reviewed.value)!==fleetCanonical(report.best))throw Error("候选未通过数量、费用或前缀复核 / Candidate failed quantity, cost or prefix review");
 return reviewed.value;
}

export function buildFleetOptimizationCsv(report:FleetOptimizationReport,en=false){
 const rows:(string|number|boolean|null)[][]=[en?["Candidate","Mode","Packaging selection","Committed containers","Added cartons","Containers","Loaded","Remaining","Packaging","Loose","Configured before rework","Dismantled","Rebuilt","Rework total","Configured total","Retains every row","Improves","Source row ID","Source row","Requested","Before","After","Global loose quota","Actual loose","Palletized","Status"]:["候选","操作","包装选择","保留柜数","新增散箱","柜数","已装箱","余货箱","包装数","散箱数","拆托重打前费用","拆托数","重打数","拆托重打费用","配置费用合计","逐行不减量","改善","源行ID","源行","需求","原已装","候选已装","全单配额","实际散箱","托内箱数","状态"]];
 rows[0].push(...report.groups.map(g=>`${en?"Added units":"新增单位"}: ${g.name} [${g.id}]`));
 for(const c of report.candidates)for(const r of c.rows)rows.push([c.index+1,report.settings.mode,c.spec.selection,report.settings.keepPrefix,c.addedCartons,c.containers,c.loaded,c.remaining,c.packaging,c.loose,c.baseConfiguredTotal,c.dismantled,c.rebuilt,c.reworkTotal,c.configuredTotal,c.retainsRows,c.improves,r.id,r.label,r.requested,r.before,r.loaded,r.reserved,r.loose,r.palletized,report.status,...c.spec.units]);
 return rows.map(row=>row.map(cell=>toCsvCell(typeof cell==="boolean"?String(cell):cell)).join(",")).join("\r\n");
}
