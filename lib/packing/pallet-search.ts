import {restorePackingSnapshot} from "./engine";
import {auditPackingResult} from "./result-audit";
import {parsePalletBuild} from "./loading-workflow";
import {retainsLoadedRows} from "./set-utils";
import type {PackingRequest,PackingResult} from "./types";

/** Descriptive evidence from this run. Restoring/editing coordinates discards it. */
export type PalletSearchSummary={maximumCount:number;practicalCount:number|null;selected:"maximum"|"practical-lower-bound";comparison:"not-needed"|"kept-maximum"|"adopted-lower-bound"|"rejected"|"unavailable"};

/** Admit a whole candidate only after revalidation against the SAME request.
 * Every source row must be retained: more small optional cartons cannot replace
 * required cargo, priority rows or members of an existing complete kit.
 */
export function reviewPalletLowerBound(request:PackingRequest,baseline:PackingResult,candidate:PackingResult):PackingResult|null {
  if(request.strategy!=="maximum"||!["palletized","pallet-only"].includes(request.workflow??"")||candidate.workflow!==request.workflow||!candidate.palletization)throw Error("Invalid pallet search candidate scope / 整托候选范围无效");
  const expected=parsePalletBuild(request.palletBuild),actual=parsePalletBuild(candidate.palletBuild),p=candidate.palletization;
  if(JSON.stringify(expected)!==JSON.stringify(actual)||JSON.stringify(expected.config)!==JSON.stringify(p.config)||expected.mix!==p.mix||(p.stackLayers??1)!==expected.stackLayers||(p.maxTopLoadKg??0)!==expected.maxTopLoadKg||!Number.isInteger(p.preparedCount)||p.preparedCount!<0||p.preparedCount!>expected.maxPallets)throw Error("Pallet candidate changed packaging or stock / 整托候选修改了包装或库存");
  const restored=restorePackingSnapshot(request,{...candidate,strategy:"maximum",singleCartonLimit:undefined,deliveryIdentity:undefined});
  const audit=auditPackingResult(restored,request.products);
  if(audit.hasErrors||!audit.completeCoordinates)throw Error("Pallet candidate failed independent audit / 整托候选未通过独立复核");
  if(restored.placements.length<=baseline.placements.length||!retainsLoadedRows(restored.placements,baseline.placements))return null;
  return {...restored,warnings:[...candidate.warnings]};
}
