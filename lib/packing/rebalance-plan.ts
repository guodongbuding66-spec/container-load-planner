import { revisePackingResult } from "./engine";
import { usableCargoLength } from "./site-exclusions";
import { reviewPlan } from "./plan-review";
import type { PackingResult, ProductInput } from "./types";

export type RebalanceOutcome = { plan: PackingResult; changed: boolean; before: number; after: number; reason: "improved" | "centered" | "constrained" };
const deviation = (p: PackingResult) => Math.hypot(p.metrics.centerOfGravity.longitudinalRatio - .5,p.metrics.centerOfGravity.lateralRatio - .5) * 100;

/** Move complete cargo assemblies, preserving carton identities, supports and pallet contents. */
export function rebalancePackingPlan(original: PackingResult, products: readonly ProductInput[]): RebalanceOutcome {
  const before = deviation(original);
  const unchanged = (reason: "centered" | "constrained"): RebalanceOutcome => ({plan:original,changed:false,before,after:before,reason});
  if (!original.placements.length || before < .1) return unchanged("centered");
  const bodies = [...original.placements,...(original.pallets ?? [])];
  const length=usableCargoLength(original.container,original.clearance),width=original.container.width-2*original.clearance;
  const minX=Math.min(...bodies.map(b=>b.x)),maxX=Math.max(...bodies.map(b=>b.x+b.dx));
  const minY=Math.min(...bodies.map(b=>b.y)),maxY=Math.max(...bodies.map(b=>b.y+b.dy));
  const cg=original.metrics.centerOfGravity;
  const dx=Math.max(-minX,Math.min(length-maxX,length/2-cg.x));
  const dy=Math.max(-minY,Math.min(width-maxY,width/2-cg.y));
  const failedBefore=new Set(reviewPlan(original,products).checks.filter(c=>c.state==="fail").map(c=>c.id));
  let best=original,score=before;
  for(const [x,y] of [[dx,dy],[dx,0],[0,dy],[dx*.5,dy*.5]]) {
    if(Math.abs(x)+Math.abs(y)<.01) continue;
    try {
      const next=revisePackingResult(original,original.placements.map(b=>({...b,x:b.x+x,y:b.y+y})),[...products],(original.pallets??[]).map(p=>({...p,x:p.x+x,y:p.y+y})));
      if(reviewPlan(next,products).checks.some(c=>c.state==="fail"&&!failedBefore.has(c.id))) continue;
      const candidate=deviation(next);
      if(candidate<score-.01){best=next;score=candidate;}
    } catch { /* Locks, obstacles, fixed floor pallets and access remain enforced. */ }
  }
  return best===original ? unchanged("constrained") : {plan:best,changed:true,before,after:score,reason:"improved"};
}
