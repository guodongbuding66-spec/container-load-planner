import {auditAccess} from "./access";
import {restorePackingSnapshot} from "./engine";
import {parsePalletBuild} from "./loading-workflow";
import {palletSpecifications} from "./pallet-specifications";
import {packLoadingWorkflow} from "./pack-loading";
import {fleetPool,type FleetInventory} from "./fleet-inventory";
import {fleetCosts,parseFleetPricing,type FleetPricing,type FleetCosts} from "./fleet-costs";
import {assertFleetSettings,validateFleet} from "./fleet-validation";
import {packagingPriorityGroups} from "./packaging-choice";
import {normalizedSetCode,normalizedUnitsPerSet} from "./set-utils";
import type {ContainerSpec,PackingRequest,PackingResult,ProductInput} from "./types";
export type FleetOption={container:ContainerSpec;cost:number;available:number};
/** Original global allocation context for a committed, immutable container prefix. */
export type FleetFrozenContext={selection:"ordered"|"compact";looseQuantities?:Record<string,number>};
export type FleetLoad={plan:PackingResult;cost:number;frozen?:FleetFrozenContext};
export type FleetResult={loads:FleetLoad[];remaining:ProductInput[];/** Legacy field: freight subtotal only. Use costs.total for quoted freight + packaging. */totalCost:number;complete:boolean;reason:string;pricing?:FleetPricing;costs?:FleetCosts;inventory?:FleetInventory;candidateNotes?:string[]};
export function finishFleet(request:PackingRequest,loads:FleetLoad[],reason:string,pricing?:FleetPricing,notes:string[]=[]):FleetResult{
 const pool=fleetPool(request,loads),costs=fleetCosts(loads,pricing),complete=pool.products.every(p=>p.quantity===0);
 return {loads:[...loads],remaining:pool.products,totalCost:costs.freight,complete,reason:complete?"订单已全部分配":reason,...(pricing?{pricing}:{}),costs,inventory:pool.inventory,...(notes.length?{candidateNotes:[...new Set(notes)].slice(0,8)}:{})};
}
function deliveredVector(request:PackingRequest,loads:readonly FleetLoad[]){
 const counts=new Map<string,number>();for(const l of loads)for(const b of l.plan.placements)counts.set(b.productId,(counts.get(b.productId)??0)+1);
 return packagingPriorityGroups(request.products).map(g=>normalizedSetCode(g[0])?Math.min(...g.map(p=>Math.floor((counts.get(p.id)??0)/normalizedUnitsPerSet(p)))):counts.get(g[0].id)??0);
}
function compareDelivery(request:PackingRequest,a:readonly FleetLoad[],b:readonly FleetLoad[]){
 const av=deliveredVector(request,a),bv=deliveredVector(request,b);for(let i=0;i<av.length;i++)if(av[i]!==bv[i])return bv[i]-av[i];return 0;
}
/** Commit a complete feasible candidate, then debit shared physical units and loose quotas. */
export type FleetAllocationRestriction = {vehicleId?: string; unavailablePackaging?: string};

function packAvailableStock(request:PackingRequest, unavailable?:string):PackingResult {
 if(!unavailable)return packLoadingWorkflow(request);
 const build=parsePalletBuild(request.palletBuild);
 const restricted={
  ...build,
  primaryRule:unavailable==="primary"?{...build.primaryRule,maxPallets:0}:build.primaryRule,
  additionalSpecs:build.additionalSpecs?.map(spec=>spec.id===unavailable?{...spec,maxPallets:0}:spec),
 };
 const plan=packLoadingWorkflow({...request,palletBuild:restricted});
 if(!plan.palletization||!plan.validation.valid||!plan.metrics.loadedCount)return plan;
 // Restore against the full source inventory after solving with the shortage constraint.
 return restorePackingSnapshot(request,{...plan,palletBuild:build,palletization:{...plan.palletization,specifications:palletSpecifications(build)}});
}

export function allocateFleet(request:PackingRequest,options:FleetOption[],maxContainers:number,objective:"count"|"cost",onProgress?:(r:FleetResult)=>void,prices?:FleetPricing,prefix:readonly FleetLoad[]=[],restriction:FleetAllocationRestriction={}):FleetResult{
 const pricing=parseFleetPricing(prices,request);assertFleetSettings(request,options,maxContainers,objective,pricing);
 const counts=new Map<string,number>(),loads:FleetLoad[]=[...prefix],notes:string[]=[];let reason="已达到柜数上限";
 if(prefix.length){const check=validateFleet(request,finishFleet(request,loads,reason,pricing),options,maxContainers);if(!check.valid)throw Error(check.errors.join("; "));for(const l of prefix)counts.set(l.plan.container.id,(counts.get(l.plan.container.id)??0)+1);}
 for(let i=prefix.length;i<maxContainers;i++){
  const pool=fleetPool(request,loads);if(pool.products.every(p=>p.quantity===0))break;
  const candidates:FleetLoad[]=[];
  for(const o of options){if(restriction.vehicleId&&o.container.id!==restriction.vehicleId||(counts.get(o.container.id)??0)>=o.available)continue;
   try{const plan=packAvailableStock({...pool.request,container:o.container},restriction.unavailablePackaging);plan.id=`fleet-${i+1}-${o.container.id}-${plan.id}`;if(plan.validation.valid&&plan.metrics.loadedCount>0)candidates.push({plan,cost:o.cost});}
   catch(e){notes.push(`${o.container.name}: ${(e instanceof Error?e.message:String(e)).slice(0,1000)}`);}
  }
  if(!candidates.length){reason="剩余货物未找到完整可行方案，请核对包装库存、柜型、尺寸和套装 / No complete feasible load found; check shared stock, vehicle, dimensions and kits";break;}
  candidates.sort((a,b)=>{
   const delivery=compareDelivery({...request,products:pool.products},[a],[b]);if(delivery)return delivery;
   const score=(c:FleetLoad)=>{const total=fleetCosts([c],pricing).knownSubtotal;return objective==="cost"?total/Math.max(1,c.plan.summaries.reduce((n,s)=>n+s.loadedVolume,0)):-c.plan.metrics.loadedCount;};
   const ac=fleetCosts([a],pricing),bc=fleetCosts([b],pricing);return score(a)-score(b)||(ac.complete&&bc.complete?ac.total!-bc.total!:0);
  });
  const selected=candidates[0];loads.push(selected);counts.set(selected.plan.container.id,(counts.get(selected.plan.container.id)??0)+1);
  onProgress?.(finishFleet(request,loads,"正在分配后续柜",pricing,notes));
 }
 const result=finishFleet(request,loads,reason,pricing,notes),validation=validateFleet(request,result,options,maxContainers);if(!validation.valid)throw Error(validation.errors.join("; "));return result;
}
/** Replace only a tail; prefix cargo, packaging and reserved loose quotas stay committed. */
export function optimizeFleetTail(request:PackingRequest,baseline:FleetResult,options:FleetOption[],objective:"count"|"cost",prices?:FleetPricing):FleetResult{
 if(!baseline.loads.length)return baseline;const pricing=parseFleetPricing(prices??baseline.pricing,request);let best=baseline;
 for(const size of [1,2]){if(best.loads.length<size)continue;const prefix=best.loads.slice(0,-size),tail=best.loads.slice(-size);if(tail.some(l=>l.frozen))continue;const pool=fleetPool(request,prefix);
  for(const o of options){if(prefix.filter(l=>l.plan.container.id===o.container.id).length>=o.available)continue;
   try{const plan=packLoadingWorkflow({...pool.request,container:o.container});if(!plan.validation.valid||!plan.metrics.loadedCount)continue;
    const previous=deliveredVector(request,tail),next=deliveredVector(request,[{plan,cost:o.cost}]);if(next.some((n,i)=>n<previous[i]))continue;
    // Per-SKU conservation also covers unmatched kit remainders.
    const previousCounts=new Map<string,number>();for(const l of tail)for(const b of l.plan.placements)previousCounts.set(b.productId,(previousCounts.get(b.productId)??0)+1);
    if(plan.summaries.some(s=>s.loaded<(previousCounts.get(s.productId)??0)))continue;
    const candidate=finishFleet(request,[...prefix,{plan,cost:o.cost}],"尾柜已复核，仍有余货",pricing);
    const known=candidate.costs?.total,oldCost=best.costs?.total??(request.workflow==="palletized"?null:best.totalCost);
    const better=Number(candidate.complete)>Number(best.complete)||(candidate.complete===best.complete&&(objective==="cost"?known!==null&&known!==undefined&&oldCost!==null&&known<oldCost:candidate.loads.length<best.loads.length||candidate.loads.length===best.loads.length&&known!==null&&known!==undefined&&oldCost!==null&&known<oldCost));
    if(better&&validateFleet(request,candidate,options).valid)best=candidate;
   }catch{continue;}
  }
 }return best;
}
export type FleetReview={pathIssues:number;unassigned:number;balanceWarnings:number;leftoverCount:number;constraints:string[];costKnown:boolean;pathUnverified:number};
export type FleetComparison={label:string;result:FleetResult;allocatedSets:number;costPerSet:number|null;review:FleetReview};
export function reviewFleet(result:FleetResult):FleetReview{
 let pathIssues=0,unassigned=0,balanceWarnings=0,pathUnverified=0;const constraints=new Set<string>();
 for(const l of result.loads){const items=l.plan.palletization?(l.plan.pallets?.length??0)+l.plan.placements.filter(b=>!b.palletIds?.length).length:l.plan.placements.length;if(items>240){pathUnverified++;constraints.add("access-budget");balanceWarnings+=Number(!l.plan.metrics.centerOfGravity.balanced);continue;}const audit=auditAccess(l.plan,l.plan.delivery,{maneuver:false,maxLift:0,clearance:0,turn:false,budget:100});pathIssues+=audit.issues.filter(i=>i.reason!=="unassigned").length;unassigned+=audit.issues.filter(i=>i.reason==="unassigned").length;balanceWarnings+=Number(!l.plan.metrics.centerOfGravity.balanced);if(l.plan.metrics.weightUtilization>.98)constraints.add("payload");if(l.plan.metrics.volumeUtilization>.95)constraints.add("space");if(l.plan.metrics.executionComplexity.partialSupportCount)constraints.add("support");if(audit.issues.some(i=>i.reason==="door"))constraints.add("door");if(audit.issues.some(i=>i.reason==="blocked"||i.reason==="support"))constraints.add("sequence");}
 const leftoverCount=result.remaining.reduce((n,p)=>n+p.quantity,0);if(leftoverCount)constraints.add("stock / dimensions / orientation / kit / support");if(unassigned)constraints.add("unassigned stops");return {pathIssues,unassigned,balanceWarnings,leftoverCount,pathUnverified,constraints:[...constraints],costKnown:result.costs?.complete??result.loads.every(l=>l.cost>0)};
}
/** Freight is shared by cargo volume; packaging is shared only among its own contents. */
export function fleetEconomics(result:FleetResult){
 const allocations=new Map<string,{code:string;sets:number;volume:number;cost:number;known:boolean}>();
 for(const l of result.loads){const groups=new Map<string,string>(),volumes=new Map<string,number>(),totalVolume=l.plan.summaries.reduce((n,s)=>n+s.loadedVolume,0);
  for(const set of l.plan.setSummaries)for(const item of set.items)groups.set(item.productId,set.setCode);
  for(const s of l.plan.summaries){const key=groups.get(s.productId)??`SKU:${s.sku}`,old=allocations.get(key)??{code:key,sets:0,volume:0,cost:0,known:true};if(!groups.has(s.productId))old.sets+=s.loaded;old.volume+=s.loadedVolume;old.cost+=l.cost*s.loadedVolume/Math.max(Number.EPSILON,totalVolume);old.known&&=l.cost>0;allocations.set(key,old);volumes.set(s.productId,s.loaded?s.loadedVolume/s.loaded:0);}
  for(const set of l.plan.setSummaries)allocations.get(set.setCode)!.sets+=set.loadedSets;
  for(const p of l.plan.pallets??[]){const cargo=l.plan.placements.filter(b=>b.palletIds?.includes(p.id)),volume=cargo.reduce((n,b)=>n+(volumes.get(b.productId)??0),0),price=result.pricing?.packaging[p.specificationId??(l.plan.palletization?"primary":"floor")];
   if(!cargo.length)for(const s of l.plan.summaries.filter(s=>s.loaded>0)){const a=allocations.get(groups.get(s.productId)??`SKU:${s.sku}`)!;if(price==null)a.known=false;else a.cost+=price*s.loadedVolume/Math.max(Number.EPSILON,totalVolume);}
   for(const b of cargo){const key=groups.get(b.productId)??`SKU:${b.sku}`,a=allocations.get(key)!;if(price==null)a.known=false;else a.cost+=price*(volumes.get(b.productId)??0)/Math.max(Number.EPSILON,volume);}
  }
 }
 const extra=result.costs?.knownAdditionalSubtotal??0,totalVolume=[...allocations.values()].reduce((n,a)=>n+a.volume,0);
 for(const a of allocations.values()){a.cost+=extra*a.volume/Math.max(Number.EPSILON,totalVolume);if(result.costs?.lines?.some(l=>l.subtotal===null))a.known=false;}
 return [...allocations.values()].map(a=>({...a,costPerSet:a.known&&a.sets?a.cost/a.sets:null}));
}
export function compareFleets(request:PackingRequest,options:FleetOption[],limit:number,objective:"count"|"cost",onProgress?:(results:FleetComparison[])=>void,pricing?:FleetPricing){
 assertFleetSettings(request,options,limit,objective,pricing);
 const groups=[{label:"混合柜型",options},...options.map(o=>({label:`全部 ${o.container.name}`,options:[o]}))];
 if(options.length>2)for(let i=0;i<Math.min(options.length,4);i++)for(let j=i+1;j<Math.min(options.length,4);j++)groups.push({label:`${options[i].container.name} + ${options[j].container.name}`,options:[options[i],options[j]]});
 const out:FleetComparison[]=[];
 for(const group of groups){const result=optimizeFleetTail(request,allocateFleet(request,group.options,limit,objective,undefined,pricing),group.options,objective,pricing),allocatedSets=fleetEconomics(result).reduce((n,a)=>n+a.sets,0);out.push({label:group.label,result,allocatedSets,review:reviewFleet(result),costPerSet:result.costs?.total!=null&&allocatedSets?result.costs.total/allocatedSets:null});onProgress?.([...out]);}
 return out.sort((a,b)=>Number(b.result.complete)-Number(a.result.complete)||(!a.result.complete?compareDelivery(request,a.result.loads,b.result.loads):0)||(objective==="count"?a.result.loads.length-b.result.loads.length:0)||((a.result.costs?.total??Infinity)-(b.result.costs?.total??Infinity)));
}
export function proposeOrderTopUp(request:PackingRequest,baseline:FleetResult,options:FleetOption[],percent:number,pricing?:FleetPricing){
 if(!Number.isFinite(percent)||percent<0||percent>20)throw Error("数量增加范围为 0–20%");if(!baseline.complete)throw Error("请先完成原订单分配，再建议增加数量");
 const prices=pricing??baseline.pricing,baseCost=baseline.costs?.total??(request.workflow==="palletized"?null:baseline.totalCost);if(baseCost===null)return null;
 const products=request.products.map(p=>{const n=normalizedUnitsPerSet(p);return {...p,quantity:p.quantity+Math.floor(p.quantity*percent/100/n)*n};});
 const selected=options.flatMap(o=>{const count=baseline.loads.filter(l=>l.plan.container.id===o.container.id).length;return count?[{...o,available:count}]:[];});
 const candidate=allocateFleet({...request,products},selected,baseline.loads.length,"count",undefined,prices),cost=candidate.costs?.total;if(cost==null||cost>baseCost)return null;
 const counts=new Map<string,number>();for(const l of candidate.loads)for(const b of l.plan.placements)counts.set(b.productId,(counts.get(b.productId)??0)+1);
 if(request.products.some(p=>(counts.get(p.id)??0)<p.quantity))return null;const additions=request.products.map(p=>({sku:p.sku,quantity:(counts.get(p.id)??0)-p.quantity}));return additions.some(a=>a.quantity>0)?{result:candidate,additions}:null;
}
