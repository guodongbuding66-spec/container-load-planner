import { arrangeFloorPallets } from "./floor-pallets";
import { pack } from "./engine";
import type { ContainerSpec, PackingRequest, PackingResult, ProductInput } from "./types";

export type FleetOption = { container: ContainerSpec; cost: number; available: number };
export type FleetLoad = { plan: PackingResult; cost: number };
export type FleetResult = { loads: FleetLoad[]; remaining: ProductInput[]; totalCost: number; complete: boolean; reason: string };

/** Sequential feasible allocation comparing enabled container types at each step; not a global optimum. */
export function allocateFleet(request: PackingRequest, options: FleetOption[], maxContainers: number, objective: "count" | "cost", onProgress?: (result: FleetResult) => void): FleetResult {
  if (request.mode !== "mixed") throw new Error("多柜分配需要明确的拼柜订单数量。");
  if (!options.length || !Number.isInteger(maxContainers) || maxContainers < 1 || maxContainers > 50) throw new Error("请选择柜型，柜数上限为 1–50。");
  if (options.some(o=>!Number.isFinite(o.cost)||o.cost<0||!Number.isInteger(o.available)||o.available<1||o.available>50)) throw new Error("费用必须为非负数字，可用柜数为 1–50 的整数。");
  if (objective === "cost" && options.some(o=>o.cost<=0)) throw new Error("费用优先需要为每个候选柜型填写大于 0 的费用。");
  let remaining = request.products.map(p=>({...p}));
  const counts = options.map(()=>0);
  const loads: FleetLoad[] = [];
  let reason = "已达到柜数上限";
  for (let i=0;i<maxContainers;i++) {
    if (remaining.every(p=>p.quantity===0)) { reason="订单已全部分配"; break; }
    const candidates = options.flatMap((o,index)=> {
      if (counts[index]>=o.available) return [];
      if(request.floorPallets){try{arrangeFloorPallets(o.container,request.clearance,request.floorPallets);}catch{return [];}}
      const plan=pack({...request,products:remaining,container:o.container});
      plan.id = `fleet-${i+1}-${index}-${plan.id}`;
      return plan.validation.valid && plan.metrics.loadedCount>0 ? [{plan,cost:o.cost,index}] : [];
    });
    if (!candidates.length) { reason="剩余货物无法在当前可用柜型中生成完整可行方案；请查看门洞、箱规与套装比例"; break; }
    candidates.sort((a,b)=> {
      const aComplete=a.plan.metrics.loadedCount===remaining.reduce((n,p)=>n+p.quantity,0);
      const bComplete=b.plan.metrics.loadedCount===remaining.reduce((n,p)=>n+p.quantity,0);
      if(aComplete&&bComplete) return a.cost-b.cost;
      if(objective==="count"&&aComplete!==bComplete) return aComplete?-1:1;
      const score=(c:typeof a)=> objective==="cost" ? c.cost/Math.max(1,c.plan.summaries.reduce((n,s)=>n+s.loadedVolume,0)) : -c.plan.metrics.loadedCount;
      return score(a)-score(b)||a.cost-b.cost;
    });
    const selected=candidates[0]; counts[selected.index]++;
    loads.push({plan:selected.plan,cost:selected.cost});
    const loaded=new Map(selected.plan.summaries.map(s=>[s.productId,s.loaded]));
    remaining=remaining.map(p=>({...p,quantity:p.quantity-(loaded.get(p.id)??0)}));
    onProgress?.({loads:[...loads],remaining,totalCost:loads.reduce((n,l)=>n+l.cost,0),complete:remaining.every(p=>p.quantity===0),reason:"正在分配后续柜"});
  }
  const complete=remaining.every(p=>p.quantity===0);
  return {loads,remaining,totalCost:loads.reduce((n,l)=>n+l.cost,0),complete,reason:complete?"订单已全部分配":reason};
}

/** Repack the final one/two containers, keeping the prefix and full delivered order intact. */
export function optimizeFleetTail(request:PackingRequest, baseline:FleetResult, options:FleetOption[], objective:"count"|"cost"):FleetResult {
  if(!baseline.loads.length)return baseline;
  let best=baseline;
  for(const tailLength of [1,2]){
    if(best.loads.length<tailLength)continue;
    const prefix=best.loads.slice(0,-tailLength),tail=best.loads.slice(-tailLength);
    const quantities=new Map(best.remaining.map(p=>[p.id,p.quantity]));
    for(const load of tail)for(const summary of load.plan.summaries)quantities.set(summary.productId,(quantities.get(summary.productId)??0)+summary.loaded);
    const products=request.products.map(p=>({...p,quantity:quantities.get(p.id)??0}));
    for(const option of options){
      if(prefix.filter(l=>l.plan.container.id===option.container.id).length>=option.available)continue;
      if(request.floorPallets){try{arrangeFloorPallets(option.container,request.clearance,request.floorPallets);}catch{continue;}}
      const plan=pack({...request,products,container:option.container});
      if(!plan.validation.valid||!plan.metrics.loadedCount)continue;
      const loaded=new Map(plan.summaries.map(s=>[s.productId,s.loaded]));
      const previous=new Map<string,number>();tail.forEach(l=>l.plan.summaries.forEach(s=>previous.set(s.productId,(previous.get(s.productId)??0)+s.loaded)));
      if(products.some(p=>(loaded.get(p.id)??0)<(previous.get(p.id)??0)))continue;
      const loads=[...prefix,{plan,cost:option.cost}],totalCost=loads.reduce((n,l)=>n+l.cost,0);
      const remaining=products.map(p=>({...p,quantity:p.quantity-(loaded.get(p.id)??0)}));
      const complete=remaining.every(p=>p.quantity===0);
      const better=Number(complete)>Number(best.complete)||(complete===best.complete&&(objective==="cost"?totalCost<best.totalCost:loads.length<best.loads.length||loads.length===best.loads.length&&totalCost<best.totalCost));
      if(better)best={loads,remaining,totalCost,complete,reason:complete?"订单已全部分配，尾柜已复核优化":"尾柜已复核，仍有余货"};
    }
  }
  return best;
}

export type FleetComparison={label:string;result:FleetResult;allocatedSets:number;costPerSet:number|null};
export function fleetEconomics(result:FleetResult){
  const allocations=new Map<string,{code:string;sets:number;volume:number;cost:number}>();
  for(const l of result.loads){
    const grouped=new Set<string>();
    for(const s of l.plan.setSummaries){const volume=s.items.reduce((n,i)=>n+(l.plan.summaries.find(p=>p.productId===i.productId)?.loadedVolume??0),0);s.items.forEach(i=>grouped.add(i.productId));const old=allocations.get(s.setCode)??{code:s.setCode,sets:0,volume:0,cost:0};old.sets+=s.loadedSets;old.volume+=volume;old.cost+=l.cost*volume/Math.max(1,l.plan.summaries.reduce((n,s)=>n+s.loadedVolume,0));allocations.set(s.setCode,old);}
    for(const s of l.plan.summaries)if(!grouped.has(s.productId)&&s.loaded){const key=`SKU:${s.sku}`,old=allocations.get(key)??{code:key,sets:0,volume:0,cost:0};old.sets+=s.loaded;old.volume+=s.loadedVolume;old.cost+=l.cost*s.loadedVolume/Math.max(1,l.plan.summaries.reduce((n,s)=>n+s.loadedVolume,0));allocations.set(key,old);}
  }
  return [...allocations.values()].map(a=>({...a,costPerSet:a.sets?a.cost/a.sets:null}));
}
/** Compare full feasible schedules; include uniform, mixed and pairwise container options. */
export function compareFleets(request:PackingRequest, options:FleetOption[],limit:number,objective:"count"|"cost",onProgress?:(results:FleetComparison[])=>void){
  const groups:{label:string;options:FleetOption[]}[]=[{label:"混合柜型",options},...options.map(o=>({label:`全部 ${o.container.name}`,options:[o]}))];
  if(options.length>2)for(let i=0;i<Math.min(options.length,4);i++)for(let j=i+1;j<Math.min(options.length,4);j++)groups.push({label:`${options[i].container.name} + ${options[j].container.name}`,options:[options[i],options[j]]});
  const out:FleetComparison[]=[];
  for(const group of groups){const result=optimizeFleetTail(request,allocateFleet(request,group.options,limit,objective),group.options,objective);const economics=fleetEconomics(result);const allocatedSets=economics.reduce((n,a)=>n+a.sets,0);out.push({label:group.label,result,allocatedSets,costPerSet:result.loads.every(l=>l.cost>0)&&allocatedSets?result.totalCost/allocatedSets:null});onProgress?.([...out]);}
  return out.sort((a,b)=>Number(b.result.complete)-Number(a.result.complete)||(a.result.complete?(objective==="cost"?a.result.totalCost-b.result.totalCost:a.result.loads.length-b.result.loads.length):a.result.remaining.reduce((n,p)=>n+p.quantity,0)-b.result.remaining.reduce((n,p)=>n+p.quantity,0))||a.result.totalCost-b.result.totalCost);
}
export function proposeOrderTopUp(request:PackingRequest, baseline:FleetResult, options:FleetOption[],percent:number){
  if(!Number.isFinite(percent)||percent<0||percent>20)throw new Error("数量增加范围为 0–20%");
  if(!baseline.complete)throw new Error("请先完成原订单分配，再建议增加数量");
  const products=request.products.map(p=>{const unit=p.setCode?(p.unitsPerSet??1):1;return {...p,quantity:p.quantity+Math.floor(p.quantity*percent/100/unit)*unit};});
  // Only reuse already selected container stock, with exactly its original total cost ceiling.
  const selected=options.flatMap(o=>{const count=baseline.loads.filter(l=>l.plan.container.id===o.container.id).length;return count?[{...o,available:count}]:[];});
  const candidate=allocateFleet({...request,products},selected,baseline.loads.length,"count");
  const delivered=new Map<string,number>();candidate.loads.forEach(l=>l.plan.summaries.forEach(s=>delivered.set(s.productId,(delivered.get(s.productId)??0)+s.loaded)));
  if(request.products.some(p=>(delivered.get(p.id)??0)<p.quantity)||candidate.totalCost>baseline.totalCost)return null;
  const additions=request.products.map(p=>({sku:p.sku,quantity:(delivered.get(p.id)??0)-p.quantity}));
  return additions.some(a=>a.quantity>0)?{result:candidate,additions}:null;
}
