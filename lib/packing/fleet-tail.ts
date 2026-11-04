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
export type FleetTailRow={id:string;label:string;requested:number;before:number;loaded:number;unloaded:number;reserved:number;loose:number;palletized:number};
export type FleetTailCandidate={units:number;addedCartons:number;containers:number;loaded:number;remaining:number;packaging:number;loose:number;configuredTotal:number|null;retainsRows:boolean;improves:boolean;rows:FleetTailRow[]};
export type PreparedFleetTail={source:FleetSnapshot;group:FleetTailGroup;trials:{units:number;value:Omit<FleetSnapshot,"result">}[]};
export type FleetTailReport={format:"cargo-fit-fleet-tail-preview";version:1;engineVersion:string;status:"preview-not-applied";source:FleetSnapshot;group:{id:string;name:string};candidates:FleetTailCandidate[];bestIndex:number|null;best?:FleetSnapshot};

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

export function prepareFleetTail(source:FleetSnapshot,groupId:string,limit:number):PreparedFleetTail{
 if(source.request.workflow!=="palletized"||source.request.mode!=="mixed")throw Error("仅支持预打托整单 / Prebuilt-pallet orders only");
 const total=source.request.products.reduce((n,p)=>n+p.quantity,0);
 if(total<1||total>4000||source.limit>10)throw Error("试算限 1–4000 箱及最多 10 柜 / Trials support 1–4000 cartons and at most 10 containers");
 const checked=checkedSnapshot(source),group=fleetTailGroups(checked.request).find(g=>g.id===groupId);
 if(!group||!Number.isSafeInteger(limit)||limit<1||limit>group.availableUnits)throw Error("尾数超过订单或完整套装上限 / Tail exceeds demand or whole-kit limits");
 const amounts=[...new Set([1,2,4,8,limit].filter(n=>n<=limit))].sort((a,b)=>a-b),trials=amounts.map(units=>{
  const request=structuredClone(checked.request),build=parsePalletBuild(request.palletBuild),looseQuantities={...build.looseQuantities};
  for(const p of group.products)looseQuantities[p.id]=(looseQuantities[p.id]??0)+units*(normalizedSetCode(p)?normalizedUnitsPerSet(p):1);
  const errors=looseReservationErrors(looseQuantities,request.products);if(errors.length)throw Error(errors.join("; "));
  request.palletBuild={...build,looseQuantities};
  return {units,value:{request,options:checked.options,limit:checked.limit,objective:checked.objective,pricing:checked.pricing}};
 });
 return {source:checked,group,trials};
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
 const summary:FleetTailCandidate={units:trial.units,addedCartons:trial.units*prepared.group.cartonsPerUnit,containers:result.loads.length,loaded:loaded(result),remaining:result.remaining.reduce((n,p)=>n+p.quantity,0),packaging:result.inventory?.totalUsed??0,loose:rows.reduce((n,r)=>n+r.loose,0),configuredTotal:result.costs?.complete?result.costs.total:null,retainsRows,improves:retainsRows&&compare(result,prepared.source.result,prepared.source.objective)>0,rows};
 return {summary,value};
}

export function finishFleetTail(prepared:PreparedFleetTail,results:readonly FleetResult[]):FleetTailReport{
 if(results.length!==prepared.trials.length)throw Error("试算尚未完整完成 / Trial batch is incomplete");
 const checked=results.map((result,index)=>reviewFleetTailCandidate(prepared,index,result));let bestIndex:number|null=null;
 checked.forEach((c,i)=>{if(c.summary.improves&&(bestIndex===null||compare(c.value.result,checked[bestIndex].value.result,prepared.source.objective)>0))bestIndex=i;});
 return {format:"cargo-fit-fleet-tail-preview",version:1,engineVersion:ENGINE_VERSION,status:"preview-not-applied",source:prepared.source,group:{id:prepared.group.id,name:prepared.group.name},candidates:checked.map(c=>c.summary),bestIndex,...(bestIndex===null?{}:{best:checked[bestIndex].value})};
}

/** Apply only the independently reviewed source-bound allocation, never an arbitrary backup. */
export function adoptFleetTail(prepared:PreparedFleetTail,report:FleetTailReport):FleetSnapshot{
 if(report.status!=="preview-not-applied"||report.bestIndex===null||!report.best||fleetCanonical(report.source)!==fleetCanonical(prepared.source))throw Error("试算已失效 / Stale trial");
 const trial=prepared.trials[report.bestIndex];
 if(!trial||fleetCanonical({...report.best,result:undefined,format:undefined,version:undefined})!==fleetCanonical(trial.value))throw Error("候选输入不一致 / Candidate inputs differ");
 const checked=reviewFleetTailCandidate(prepared,report.bestIndex,report.best.result);if(!checked.summary.improves)throw Error("候选未保留逐行数量或没有改善 / No retained-row improvement");
 return checked.value;
}

export function buildFleetTailCsv(report:FleetTailReport,en=false){
 const rows:(string|number|boolean|null)[][]=[en?["Candidate","Additional units","Containers","Loaded cartons","Remaining cartons","Packaging used","Loose cartons","Configured total","Retains every row","Improves","Source row ID","SKU / row","Requested","Baseline loaded","Candidate loaded","Unloaded","Global loose quota","Actual loose","Palletized","Status"]:["候选","新增单位","柜数","已装箱","余货箱","已用包装","实际散箱","配置费用合计","逐行不减量","改善","源订单行ID","SKU／行","原订单箱数","原已装箱数","候选已装箱数","未装箱数","全单散箱配额","实际散装箱数","托内箱数","状态"]];
 report.candidates.forEach((c,i)=>c.rows.forEach(r=>rows.push([i+1,c.units,c.containers,c.loaded,c.remaining,c.packaging,c.loose,c.configuredTotal,c.retainsRows,c.improves,r.id,r.label,r.requested,r.before,r.loaded,r.unloaded,r.reserved,r.loose,r.palletized,report.status])));
 return rows.map(row=>row.map(cell=>toCsvCell(typeof cell==="boolean"?String(cell):cell)).join(",")).join("\r\n");
}
