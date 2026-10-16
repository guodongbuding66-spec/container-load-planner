import { buildDimensionComparison, deriveDimensionScenario, dimensionRequestFingerprint, type DimensionComparison } from "./dimension-scenarios";
import { parseWorkspaceBackup, MAX_WORKSPACE_BYTES } from "./workspace-file";
import { parseDelivery } from "./access";
import { parseAccessConfig } from "./maneuver";
import { restorePackingSnapshot } from "./engine";
import type { PackingRequest } from "./types";

/** Reports carry two source snapshots. Serialized metrics are never trusted on restore. */
export function parseDimensionComparisonReport(contents:string):DimensionComparison {
  if(new TextEncoder().encode(contents).length>MAX_WORKSPACE_BYTES)throw new Error("Comparison report exceeds 50 MB / 对比报告超过 50 MB");
  const raw=JSON.parse(contents);
  if(!raw||raw.format!=="cargo-fit-dimension-comparison"||raw.version!==1||!raw.sourceRequest||typeof raw.sourceRequest!=="object")throw new Error("Invalid dimension comparison report / 尺寸对比报告无效");
  const request=raw.sourceRequest as PackingRequest;
  const allowed=new Set(["workflow","palletBuild","delivery","accessConfig","floorPallets","loadingRules","searchPass","mode","strategy","practicalTargetUtilization","singleCartonLimit","container","clearance","products"]);
  if(Object.keys(request).some(key=>!allowed.has(key)))throw new Error("Unsupported scenario input / 不支持的尺寸方案输入");
  parseWorkspaceBackup(JSON.stringify({format:"cargo-fit-workspace",version:1,inputs:{...request,strategy:request.strategy??"practical",practicalTargetPercent:(request.practicalTargetUtilization??.88)*100,customContainers:[],targetVolumePercent:90,targetWeightPercent:90,lengthUnit:"mm",weightUnit:"kg"}}));
  parseDelivery(request.delivery,new Set(request.products.map(p=>p.id)));parseAccessConfig(request.accessConfig);
  if(request.singleCartonLimit!==undefined&&(!Number.isSafeInteger(request.singleCartonLimit)||request.singleCartonLimit<1)||request.searchPass!==undefined&&(!Number.isSafeInteger(request.searchPass)||request.searchPass<0||request.searchPass>100))throw new Error("Invalid scenario limit / 尺寸方案上限无效");
  if(raw.sourceFingerprint!==dimensionRequestFingerprint(request))throw new Error("Comparison source fingerprint mismatch / 对比来源指纹不一致");
  const nominal=deriveDimensionScenario(request,"nominal"),conservative=deriveDimensionScenario(request,"conservative");
  if(JSON.stringify(raw.nominal?.request)!==JSON.stringify(nominal.request)||JSON.stringify(raw.conservative?.request)!==JSON.stringify(conservative.request))throw new Error("Scenario request mismatch / 尺寸方案输入不一致");
  for(const [entry,scenario] of [[raw.nominal,nominal],[raw.conservative,conservative]] as const){
    if(JSON.stringify(entry.plan?.dimensionScenario)!==JSON.stringify(scenario.tag))throw new Error("Scenario identity mismatch / 尺寸方案标识不一致");
    if(entry.plan.mode!==request.mode||entry.plan.strategy!==(request.strategy??"practical"))throw new Error("Scenario solver mismatch / 尺寸方案算法不一致");
  }
  return buildDimensionComparison(request,restorePackingSnapshot(nominal.request,raw.nominal.plan),restorePackingSnapshot(conservative.request,raw.conservative.plan));
}
