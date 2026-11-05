import { crateEvidence, planCrateUnits, reviewCrateStack, type CrateReviewUnit } from "./crate-bearing";
import { palletEnvelopeTop } from "./deck-support";
import {crateStructure} from "./crate-structure";
import {contactArea} from "./bearing";
import type { FloorPalletConfig, PackingResult, PlacedBox } from "./types";

const EPS = .0001;
export const isCrate = (c: FloorPalletConfig) => !!c.packaging && c.packaging.enclosure !== "none";
/** Explicit opt-in is independent of the older documentary preflight review. */
export function crateAutoEnabled(c: FloorPalletConfig, today?: string) {
  return c.crateBearing?.automaticStacking === true && !c.packaging?.deckSupports?.length && crateEvidence(c, today).state === "ready";
}
export function crateTopCapacity(c: FloorPalletConfig, grossKg: number) {
  if (!crateAutoEnabled(c) || c.crateBearing!.maxLayers < 2) return 0;
  return Math.max(0, Math.min(c.crateBearing!.maxTopLoadKg, ...Object.values(c.crateBearing!.columnCapacityKg).map(n => n - grossKg)));
}
const supports = (lower: PlacedBox, upper: PlacedBox) => lower.id !== upper.id && Math.abs(lower.z + lower.dz - upper.z) < EPS && upper.x >= lower.x - EPS && upper.y >= lower.y - EPS && upper.x + upper.dx <= lower.x + lower.dx + EPS && upper.y + upper.dy <= lower.y + lower.dy + EPS;
function bridgeSupportIds(upper:PlacedBox,placed:readonly PlacedBox[],resolve:(b:PlacedBox)=>CrateReviewUnit|undefined,today?:string){
 const valid=(unit:CrateReviewUnit|undefined):unit is CrateReviewUnit=>!!unit&&crateAutoEnabled(unit.config,today)&&unit.config.crateBearing?.bridgeStacking===true
  &&unit.config.crateBearing.maxLayers>=2&&unit.config.crateBearing.allowedOrientations.includes(unit.pallet.orientation)&&unit.cargoKg<=unit.config.maxLoad+EPS;
 const top=resolve(upper);if(upper.z<=EPS||!valid(top))return undefined;
 const bases=placed.filter(b=>b.id!==upper.id&&Math.abs(b.z+b.dz-upper.z)<EPS&&contactArea(b,upper)>EPS);
 if(bases.length<2||bases.length>4||bases.some(b=>b.z>EPS)||bases.reduce((n,b)=>n+contactArea(b,upper),0)<upper.dx*upper.dy-EPS)return undefined;
 if(placed.some(b=>b.id!==upper.id&&b.z>=upper.z-EPS&&(bases.some(base=>contactArea(b,base)>EPS)||contactArea(b,upper)>EPS)))return undefined;
 const gross=top.pallet.weight+top.cargoKg,paths=crateStructure(top.config,top.pallet).paths;
 if(Object.values(top.config.crateBearing!.columnCapacityKg).some(n=>n+EPS<gross))return undefined;
 const permitted=bases.flatMap(base=>{
  const unit=resolve(base);if(!valid(unit))return [];
  const rating=unit.config.crateBearing!,bound=unit.pallet.weight+unit.cargoKg+gross;
  if(rating.maxTopLoadKg+EPS<gross||Object.values(rating.columnCapacityKg).some(n=>n+EPS<bound))return [];
  return crateStructure(unit.config,unit.pallet).paths.flatMap(path=>path.continuous&&path.top&&path.topZ!==undefined?[{id:`${base.id}/${path.id}`,base:base.id,zone:path.top,z:path.topZ}]:[]);
 });
 const used=new Set<string>(),loadPaths=new Set<string>();
 for(const path of paths){
  const foot=path.bottom;if(!path.continuous||!foot)return undefined;
  const contacts=permitted.filter(({zone,z})=>Math.abs(z-path.bottomZ!)<EPS&&foot.x>=zone.x-EPS&&foot.y>=zone.y-EPS&&foot.x+foot.dx<=zone.x+zone.dx+EPS&&foot.y+foot.dy<=zone.y+zone.dy+EPS);
  if(contacts.length!==1||used.has(contacts[0].id))return undefined;
  used.add(contacts[0].id);loadPaths.add(contacts[0].base);
 }
 return loadPaths.size===bases.length?bases.map(b=>b.id):undefined;
}
export type CrateStackCell = { id: string; state: "passed" | "failed" | "unverified" | "prohibited" | "floor-only"; stacked: boolean; level: number; topLoadKg: number; throughLoadBoundKg: number; supporterId?: string; issues: string[] };
export const CRATE_STACK_STATE_TEXT: Record<CrateStackCell["state"], [string, string]> = {passed:["按录入静载通过","Passed entered static ratings"],failed:["叠放不通过","Stack failed"],unverified:["资料未核验，底置","Unverified evidence, floor-only"],prohibited:["禁止叠放，底置","Stacking prohibited, floor-only"],"floor-only":["资料已核对，本方案未叠放","Evidence reviewed, not stacked"]};

/** Whole-plan check. Only one complete crate per tier and one crate below are supported. */
export function inspectCrateStacks(units: readonly CrateReviewUnit[], envelopes: readonly PlacedBox[], today?: string) {
  const unitMap = new Map(units.map(u => [u.pallet.id, u]));
  const parents = new Map(envelopes.map(e => [e.id, e.z > EPS ? envelopes.filter(p => supports(p, e)) : []]));
  const children = new Map(envelopes.map(e => [e.id, envelopes.filter(p => parents.get(p.id)?.some(v => v.id === e.id))]));
  const cells = new Map<string, CrateStackCell>();
  const errors: string[] = [], seen = new Set<string>();
  const bridgeParents=new Map<string,string[]>();
  for(const e of envelopes){
    const bases=bridgeSupportIds(e,envelopes,b=>unitMap.get(b.id),today);if(!bases)continue;
    bridgeParents.set(e.id,bases);
    const upper=unitMap.get(e.id)!,top=upper.pallet.weight+upper.cargoKg;
    for(const id of [e.id,...bases]){
      const own=unitMap.get(id)!,above=id===e.id?0:top;
      cells.set(id,{id,state:"passed",stacked:true,level:id===e.id?2:1,topLoadKg:above,throughLoadBoundKg:own.pallet.weight+own.cargoKg+above,...(id===e.id?{supporterId:bases.join(" + ")}:{}),issues:[]});
      seen.add(id);
    }
  }
  for (const initial of units) {
    if (seen.has(initial.pallet.id)) continue;
    const ids: string[] = [], pending = [initial.pallet.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id) || !unitMap.has(id)) continue;
      seen.add(id); ids.push(id);
      for (const v of [...parents.get(id) ?? [], ...children.get(id) ?? []]) if (unitMap.has(v.id)) pending.push(v.id);
    }
    const column = ids.map(id => unitMap.get(id)!).sort((a, b) => a.pallet.z - b.pallet.z);
    const stacked = column.length > 1 || column.some(u => u.pallet.z > EPS || children.get(u.pallet.id)?.length);
    let issues: string[] = [];
    if (stacked) {
      if (column.some(u => !crateAutoEnabled(u.config, today))) issues.push("木箱未启用自动叠放或额定资料无效 / Crate automatic stacking is disabled or its evidence is invalid");
      if (column.length > 20 || column[0].pallet.z > EPS || column.some(u => (parents.get(u.pallet.id)?.length ?? 0) !== (u.pallet.z > EPS ? 1 : 0) || (children.get(u.pallet.id)?.length ?? 0) > 1 || [...parents.get(u.pallet.id) ?? [], ...children.get(u.pallet.id) ?? []].some(p => !unitMap.has(p.id)))) issues.push("木箱仅允许柜底起始、逐层单箱的完整传力列 / Crates require a floor-rooted column with one complete crate per tier");
    }
    const report = stacked && !issues.length ? reviewCrateStack(column, today) : undefined;
    if (report && report.state !== "passed") issues = report.issues.map(i => `${i.unitId}: crate-${i.code}${i.corner ? `/${i.corner}` : ""}`);
    errors.push(...issues);
    column.forEach((u, index) => {
      const evidence = crateEvidence(u.config, today), row = report?.units.find(r => r.id === u.pallet.id);
      cells.set(u.pallet.id, { id: u.pallet.id, stacked, state: issues.length ? "failed" : stacked ? "passed" : evidence.state === "ready" ? "floor-only" : evidence.state, level: index + 1, topLoadKg: row?.topLoadKg ?? 0, throughLoadBoundKg: row?.throughLoadBoundKg ?? u.pallet.weight + u.cargoKg, supporterId: parents.get(u.pallet.id)?.[0]?.id, issues });
    });
  }
  return { cells: [...cells.values()], errors: [...new Set(errors)],bridgeParents };
}

/** Search gate for a newly added rigid unit; existing positions were already checked. */
export function crateCandidateAllowed(candidate: PlacedBox, placed: readonly PlacedBox[], resolve: (box: PlacedBox) => CrateReviewUnit | undefined) {
  if (candidate.z <= EPS) return true;
  const direct = placed.filter(p => supports(p, candidate));
  if(resolve(candidate)&&direct.length!==1&&bridgeSupportIds(candidate,placed,resolve))return true;
  if (!resolve(candidate) && !direct.some(p => resolve(p))) return true;
  const column: CrateReviewUnit[] = [];
  let current = candidate;
  for (let depth = 0; depth < 20; depth++) {
    const unit = resolve(current);
    if (!unit || !crateAutoEnabled(unit.config)) return false;
    column.unshift(unit);
    if (current.z <= EPS) return reviewCrateStack(column).state === "passed";
    const lower = placed.filter(p => supports(p, current));
    if (lower.length !== 1) return false;
    if(placed.some(b=>b.id!==current.id&&Math.abs(b.z-current.z)<EPS&&contactArea(b,lower[0])>EPS))return false;
    current = lower[0];
  }
  return false;
}

export function planCrateStackReview(plan: PackingResult) {
  const envelopes: PlacedBox[] = (plan.pallets ?? []).map(p => ({ ...p, dz: palletEnvelopeTop(p, plan.placements.filter(b => b.palletIds?.includes(p.id))) - p.z, productId: p.id, sku: p.id, color: "#997947", layer: 1 }));
  return inspectCrateStacks(planCrateUnits(plan), envelopes);
}
