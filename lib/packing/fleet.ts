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
      const score=(c:typeof a)=> objective==="cost" ? c.cost/Math.max(1,c.plan.metrics.loadedVolume) : -c.plan.metrics.loadedCount;
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
