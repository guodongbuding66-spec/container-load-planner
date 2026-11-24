import {inspectPalletCapacity} from "./pallet-capacity";
import type {PackingResult} from "./types";
export type CapacityRow=NonNullable<ReturnType<typeof inspectPalletCapacity>>["rows"][number];
/** Presentation grouping is conservative; original rows remain the export source. */
export function palletDiagnosticGroups(plan:PackingResult,rows:CapacityRow[]){
 const byPallet=new Map((plan.pallets??[]).map(p=>[p.id,p]));
 const patterns=new Map<string,string[]>();
 for(const b of plan.placements){if(b.palletIds?.length!==1)continue;const id=b.palletIds[0],p=byPallet.get(id);if(!p)continue;
  const list=patterns.get(id)??[];list.push(JSON.stringify([b.productId,b.sku,b.x-p.x,b.y-p.y,b.z-p.z,b.dx,b.dy,b.dz,b.weight]));patterns.set(id,list);
 }
 const groups=new Map<string,CapacityRow[]>();
 for(const r of rows){const p=byPallet.get(r.id),{id:_,...diagnostics}=r;void _;
  const key=JSON.stringify([diagnostics,p?.packaging,p?.measuredEnvelope,(patterns.get(r.id)??[]).sort()]);
  const list=groups.get(key)??[];list.push(r);groups.set(key,list);
 }return [...groups.values()];
}
