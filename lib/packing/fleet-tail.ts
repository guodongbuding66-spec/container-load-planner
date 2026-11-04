import {parseFleetBackup,serializeFleetBackup,type FleetBackup} from "./fleet-file";
import {fleetCanonical} from "./fleet-validation";
import {parsePalletBuild} from "./loading-workflow";
import {normalizedSetCode,normalizedUnitsPerSet} from "./set-utils";
import {looseReservationErrors} from "./loose-cargo";
import {toCsvCell} from "./csv";
import {ENGINE_VERSION} from "./engine";
import type {FleetResult} from "./fleet";
import type {PackingRequest,ProductInput} from "./types";

export type FleetSnapshot=Omit<FleetBackup,"format"|"version">;
export type FleetTailGroup={id:string;name:string;products:ProductInput[];cartonsPerUnit:number;availableUnits:number};
export type FleetTailSelection={groupId:string;limit:number};
export type FleetTailAllocation={id:string;name:string;units:number;cartons:number};
export type FleetTailRow={id:string;label:string;requested:number;before:number;loaded:number;unloaded:number;reserved:number;loose:number;palletized:number};
export type FleetTailCandidate={units:number;addedCartons:number;allocations?:FleetTailAllocation[];containers:number;loaded:number;remaining:number;packaging:number;loose:number;configuredTotal:number|null;retainsRows:boolean;improves:boolean;rows:FleetTailRow[]};
export type PreparedFleetTail={source:FleetSnapshot;group:FleetTailGroup;groups?:{group:FleetTailGroup;limit:number}[];trials:{units:number;allocations?:FleetTailAllocation[];value:Omit<FleetSnapshot,"result">}[]};
export type FleetTailReport={format:"cargo-fit-fleet-tail-preview";version:1|2;engineVersion:string;status:"preview-not-applied";source:FleetSnapshot;group:{id:string;name:string};groups?:{id:string;name:string;limit:number;cartonsPerUnit:number}[];candidates:FleetTailCandidate[];bestIndex:number|null;best?:FleetSnapshot};
export const FLEET_TAIL_GRID_LIMIT=64;
export const FLEET_TAIL_CARTON_LIMIT=64;

/** Decisions use stable source rows; complete kits share one global reservation. */
export function fleetTailGroups(request:PackingRequest):FleetTailGroup[]{
 if(request.workflow!=="palletized"||request.mode!=="mixed")return [];
 const build=parsePalletBuild(request.palletBuild),groups=new Map<string,ProductInput[]>(),skuCounts=new Map<string,number>();
 for(const p of request.products){const code=normalizedSetCode(p),id=code?`kit:${code}`:`row:${p.id}`;groups.set(id,[...groups.get(id)??[],p]);skuCounts.set(p.sku,(skuCounts.get(p.sku)??0)+1);}
 return [...groups].flatMap(([id,products])=>{
  if(products.some(p=>p.cargoType&&!["carton","loose"].includes(p.cargoType)))return [];
  const cartonsPerUnit=products.reduce((n,p)=>n+(normalizedSetCode(p)?normalizedUnitsPerSet(p):1),0),availableUnits=Math.min(Math.floor(64/cartonsPerUnit),...products.map(p=>Math.floor((p.quantity-(build.looseQuantities?.[p.id]??0))/(normalizedSetCode(p)?normalizedUnitsPerSet(p):1))));
  const p=products[0],name=normalizedSetCode(p)||((skuCounts.get(p.sku)??0)>1?`${p.sku} [${p.id}]`:p.sku);
  return availableUnits>0?[{id,name,products,cartonsPerUnit,availableUnits}]:[];
 });
}

function checkedSnapshot(value:FleetSnapshot,expected?:PackingRequest){
 const checked=parseFleetBackup(serializeFleetBackup(value),expected);
 if(checked.result.loads.some(l=>l.plan.workflow!=="palletized"||l.plan.strategy!==(checked.request.strategy??"practical")||l.plan.deliveryIdentity||l.plan.placements.some(b=>b.locked)||l.plan.pallets?.some(p=>p.locked||p.measuredEnvelope)))throw Error("已交付、锁定或实测方案不能重新打托 / Issued, locked or measured schedules cannot be rebuilt");
 return checked;
}

function checkedTailSource(source:FleetSnapshot){
 if(source.request.workflow!=="palletized"||source.request.mode!=="mixed")throw Error("仅支持预打托整单 / Prebuilt-pallet orders only");
 const total=source.request.products.reduce((n,p)=>n+p.quantity,0);
 if(total<1||total>4000||source.limit>10)throw Error("试算限 1–4000 箱及最多 10 柜 / Trials support 1–4000 cartons and at most 10 containers");
 return checkedSnapshot(source);
}
function selectedGroup(groups:FleetTailGroup[],groupId:string,limit:number){
 const group=groups.find(g=>g.id===groupId);
 if(!group||!Number.isSafeInteger(limit)||limit<1||limit>group.availableUnits)throw Error("尾数超过订单或完整套装上限 / Tail exceeds demand or whole-kit limits");
 return group;
}
function makeTrial(source:FleetSnapshot,groups:{group:FleetTailGroup;units:number}[],joint=false):PreparedFleetTail["trials"][number]{
 const request=structuredClone(source.request),build=parsePalletBuild(request.palletBuild),looseQuantities={...build.looseQuantities};
 for(const {group,units} of groups)for(const p of group.products)looseQuantities[p.id]=(looseQuantities[p.id]??0)+units*(normalizedSetCode(p)?normalizedUnitsPerSet(p):1);
 const errors=looseReservationErrors(looseQuantities,request.products);if(errors.length)throw Error(errors.join("; "));
 request.palletBuild={...build,looseQuantities};
 return {units:groups.reduce((n,g)=>n+g.units,0),...(joint?{allocations:groups.map(({group,units})=>({id:group.id,name:group.name,units,cartons:units*group.cartonsPerUnit}))}:{}),value:{request,options:source.options,limit:source.limit,objective:source.objective,pricing:source.pricing}};
}
export function prepareFleetTail(source:FleetSnapshot,groupId:string,limit:number):PreparedFleetTail{
 const checked=checkedTailSource(source),group=selectedGroup(fleetTailGroups(checked.request),groupId,limit);
 const amounts=[...new Set([1,2,4,8,limit].filter(n=>n<=limit))].sort((a,b)=>a-b),trials=amounts.map(units=>makeTrial(checked,[{group,units}]));
 return {source:checked,group,trials};
}

/** Exhaust the selected bounded grid, including one-sided changes, without dropping kits. */
export function prepareJointFleetTail(source:FleetSnapshot,selections:readonly FleetTailSelection[]):PreparedFleetTail{
 if(selections.length<2||selections.length>4||new Set(selections.map(s=>s.groupId)).size!==selections.length)throw Error("请选择 2–4 个不同订单行或完整套装 / Select 2–4 distinct rows or whole kits");
 const checked=checkedTailSource(source),available=fleetTailGroups(checked.request),groups=selections.map(s=>({group:selectedGroup(available,s.groupId,s.limit),limit:s.limit}));
 const size=groups.reduce((n,g)=>n*(g.limit+1),1)-1;
 if(size>FLEET_TAIL_GRID_LIMIT)throw Error("联合组合超过 64 个，请降低各组上限 / Joint grid exceeds 64 candidates; reduce group ceilings");
 if(groups.reduce((n,g)=>n+g.limit*g.group.cartonsPerUnit,0)>FLEET_TAIL_CARTON_LIMIT)throw Error("联合新增散箱上限超过 64 箱 / Combined additional loose ceilings exceed 64 cartons");
 const vectors:number[][]=[];
 const visit=(index:number,units:number[])=>{if(index===groups.length){if(units.some(n=>n>0))vectors.push(units);return;}for(let n=0;n<=groups[index].limit;n++)visit(index+1,[...units,n]);};visit(0,[]);
 vectors.sort((a,b)=>a.reduce((n,v,i)=>n+(v-b[i])*groups[i].group.cartonsPerUnit,0)||a.reduce((d,v,i)=>d||v-b[i],0));
 return {source:checked,group:groups[0].group,groups,trials:vectors.map(units=>makeTrial(checked,groups.map((g,i)=>({group:g.group,units:units[i]})),true))};
}

export function fleetTailRows(request:PackingRequest,before:FleetResult,after:FleetResult):FleetTailRow[]{
 const counts=(result:FleetResult)=>{const m=new Map<string,{loose:number;palletized:number}>();for(const l of result.loads)for(const b of l.plan.placements){const row=m.get(b.productId)??{loose:0,palletized:0};if(b.palletIds?.length)row.palletized++;else row.loose++;m.set(b.productId,row);}return m;};
 const a=counts(before),b=counts(after),skus=new Map<string,number>();for(const p of request.products)skus.set(p.sku,(skus.get(p.sku)??0)+1);
 return request.products.map(p=>{const old=a.get(p.id),next=b.get(p.id),loose=next?.loose??0,palletized=next?.palletized??0,loaded=loose+palletized;return {id:p.id,label:(skus.get(p.sku)??0)>1?`${p.sku} [${p.id}]`:p.sku,requested:p.quantity,before:(old?.loose??0)+(old?.palletized??0),loaded,unloaded:p.quantity-loaded,reserved:request.palletBuild?.looseQuantities?.[p.id]??0,loose,palletized};});
}

function loaded(result:FleetResult){return result.loads.reduce((n,l)=>n+l.plan.metrics.loadedCount,0);}
/** Cargo is the first objective; economic ties require two complete configured quotes. */
function compare(a:FleetResult,b:FleetResult,objective:"count"|"cost"){
 const delta=loaded(a)-loaded(b);if(delta)return delta;
 const costs=a.costs?.complete&&b.costs?.complete?b.costs.total!-a.costs.total!:0,containers=b.loads.length-a.loads.length;
 return objective==="count"?containers||costs:costs||containers;
}

export function reviewFleetTailCandidate(prepared:PreparedFleetTail,index:number,result:FleetResult){
 const trial=prepared.trials[index];if(!trial)throw Error("候选索引无效 / Invalid candidate index");
 const value=checkedSnapshot({...trial.value,result},trial.value.request),rows=fleetTailRows(value.request,prepared.source.result,value.result),retainsRows=rows.every(r=>r.loaded>=r.before);
 const summary:FleetTailCandidate={units:trial.units,addedCartons:trial.allocations?.reduce((n,a)=>n+a.cartons,0)??trial.units*prepared.group.cartonsPerUnit,...(trial.allocations?{allocations:structuredClone(trial.allocations)}:{}),containers:result.loads.length,loaded:loaded(result),remaining:result.remaining.reduce((n,p)=>n+p.quantity,0),packaging:result.inventory?.totalUsed??0,loose:rows.reduce((n,r)=>n+r.loose,0),configuredTotal:result.costs?.complete?result.costs.total:null,retainsRows,improves:retainsRows&&compare(result,prepared.source.result,prepared.source.objective)>0,rows};
 return {summary,value};
}

function reportGroups(prepared:PreparedFleetTail){return prepared.groups?.map(g=>({id:g.group.id,name:g.group.name,limit:g.limit,cartonsPerUnit:g.group.cartonsPerUnit}));}
/** Keep summaries for the grid and geometry only for its current best schedule. */
export function createFleetTailReview(prepared:PreparedFleetTail){
 const candidates:FleetTailCandidate[]=[];let best:FleetSnapshot|undefined,bestIndex:number|null=null;
 return {
  accept(index:number,result:FleetResult){
   if(index!==candidates.length||index>=prepared.trials.length)throw Error("候选顺序无效 / Invalid candidate order");
   const checked=reviewFleetTailCandidate(prepared,index,result);candidates.push(checked.summary);
   if(checked.summary.improves&&(!best||compare(checked.value.result,best.result,prepared.source.objective)>0)){best=checked.value;bestIndex=index;}
   return candidates.length;
  },
  finish():FleetTailReport{
   if(candidates.length!==prepared.trials.length)throw Error("试算尚未完整完成 / Trial batch is incomplete");
   return {format:"cargo-fit-fleet-tail-preview",version:prepared.groups?2:1,engineVersion:ENGINE_VERSION,status:"preview-not-applied",source:prepared.source,group:{id:prepared.group.id,name:prepared.group.name},...(prepared.groups?{groups:reportGroups(prepared)}:{}),candidates:structuredClone(candidates),bestIndex,...(best?{best}:{})};
  }
 };
}
export function finishFleetTail(prepared:PreparedFleetTail,results:readonly FleetResult[]):FleetTailReport{
 if(results.length!==prepared.trials.length)throw Error("试算尚未完整完成 / Trial batch is incomplete");
 const review=createFleetTailReview(prepared);results.forEach((result,i)=>review.accept(i,result));return review.finish();
}

/** Apply only the independently reviewed source-bound allocation, never an arbitrary backup. */
export function adoptFleetTail(prepared:PreparedFleetTail,report:FleetTailReport):FleetSnapshot{
 if(report.status!=="preview-not-applied"||report.bestIndex===null||!report.best||fleetCanonical(report.source)!==fleetCanonical(prepared.source)||report.version!==(prepared.groups?2:1)||fleetCanonical(report.groups)!==fleetCanonical(reportGroups(prepared))||fleetCanonical(report.group)!==fleetCanonical({id:prepared.group.id,name:prepared.group.name})||report.candidates.length!==prepared.trials.length)throw Error("试算已失效 / Stale trial");
 const trial=prepared.trials[report.bestIndex];
 if(!trial||fleetCanonical({...report.best,result:undefined,format:undefined,version:undefined})!==fleetCanonical(trial.value))throw Error("候选输入不一致 / Candidate inputs differ");
 const checked=reviewFleetTailCandidate(prepared,report.bestIndex,report.best.result);if(!checked.summary.improves)throw Error("候选未保留逐行数量或没有改善 / No retained-row improvement");
 if(fleetCanonical(checked.summary)!==fleetCanonical(report.candidates[report.bestIndex]))throw Error("候选分配或源行对照不一致 / Candidate allocation or row ledger differs");
 return checked.value;
}

export function buildFleetTailCsv(report:FleetTailReport,en=false){
 const rows:(string|number|boolean|null)[][]=[en?["Candidate","Additional units","Containers","Loaded cartons","Remaining cartons","Packaging used","Loose cartons","Configured total","Retains every row","Improves","Source row ID","SKU / row","Requested","Baseline loaded","Candidate loaded","Unloaded","Global loose quota","Actual loose","Palletized","Status"]:["候选","新增单位","柜数","已装箱","余货箱","已用包装","实际散箱","配置费用合计","逐行不减量","改善","源订单行ID","SKU／行","原订单箱数","原已装箱数","候选已装箱数","未装箱数","全单散箱配额","实际散装箱数","托内箱数","状态"]];
 if(report.groups){rows[0][1]=en?"Additional units (sum across groups)":"新增单位合计";rows[0].push(en?"Additional cartons":"新增散箱合计",...report.groups.map(g=>`${en?"Added units":"新增单位"}: ${g.name} [${g.id}]`));}
 report.candidates.forEach((c,i)=>c.rows.forEach(r=>rows.push([i+1,c.units,c.containers,c.loaded,c.remaining,c.packaging,c.loose,c.configuredTotal,c.retainsRows,c.improves,r.id,r.label,r.requested,r.before,r.loaded,r.unloaded,r.reserved,r.loose,r.palletized,report.status,...(report.groups?[c.addedCartons,...report.groups.map(g=>c.allocations?.find(a=>a.id===g.id)?.units??0)]:[])])));
 return rows.map(row=>row.map(cell=>toCsvCell(typeof cell==="boolean"?String(cell):cell)).join(",")).join("\r\n");
}
