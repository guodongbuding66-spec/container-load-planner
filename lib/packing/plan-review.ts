import {accessoryInstallationPlan} from "./container-accessories";
import {inspectLongSupport,SUPPORT_ISSUES} from "./long-support";
import { auditAccess } from "./access";
import { bearingErrors, bearingStatus } from "./bearing";
import { auditPackingResult, type ResultAudit } from "./result-audit";
import type { PackingResult, ProductInput } from "./types";

export type ReviewState = "pass" | "fail" | "unverified" | "not-applicable";
export type ReviewCheck = {
  id: "data" | "geometry" | "bearing" | "path" | "securing";
  state: ReviewState;
  scope: [string, string];
  model: string;
  items: string[];
};
export const REVIEW_TITLES: Record<ReviewCheck["id"], [string, string]> = {
  data: ["数据一致性", "Data consistency"], geometry: ["几何与放置约束", "Geometry and placement rules"],
  bearing: ["承重资料与静态上压", "Bearing data and static top load"], path: ["装卸路径", "Loading and unloading access"],
  securing: ["运输固定", "Transport securing"],
};
export const REVIEW_STATES: Record<ReviewState, [string, string]> = {
  pass: ["通过", "Passed"], fail: ["不通过", "Failed"], unverified: ["未核验", "Unverified"],
  "not-applicable": ["不适用", "Not applicable"],
};
export type PlanReview = { checks: ReviewCheck[]; state: ReviewState; passed: number; failed: number; unverified: number };

/** Adapt existing validators on the complete snapshot; never infer field readiness from a valid geometry flag. */
export function reviewPlan(plan: PackingResult, products?: readonly ProductInput[], audit: ResultAudit = auditPackingResult(plan, products)): PlanReview {
  const checks: ReviewCheck[] = [], empty = !plan.placements.length;
  const add = (check: ReviewCheck) => checks.push(check);
  const data = audit.checks.filter(c => c.id !== "strength");
  add({ id: "data", state: data.some(c => c.state === "fail") ? "fail" : data.some(c => c.state === "unverified") ? "unverified" : "pass",
    scope: ["完整箱位、清单、尺寸、数量、体积与包装自重；查看筛选不改变结论。", "Complete placements, manifest, dimensions, counts, volume and packaging tare; view filters do not change this review."],
    model: "auditPackingResult", items: data.filter(c => c.state !== "pass").flatMap(c => c.items.length ? c.items : [c.id]) });
  add({ id: "geometry", state: !plan.validation.valid ? "fail" : empty || !audit.completeCoordinates ? "unverified" : "pass",
    scope: ["沿用方案的边界、碰撞、承托与载重校验；不代表实际尺寸或实机画面已验收。", "Uses the plan's bounds, collision, support and payload validation; actual dimensions and device rendering still need acceptance."],
    model: "plan.validation", items: plan.validation.errors });
  const strength = audit.checks.find(c => c.id === "strength");
  const errors = products ? bearingErrors(plan.placements, [...products]) : [];
  const unknown = products ? bearingStatus(plan.placements, [...products]).unknownIds : [];
  add({ id: "bearing", state: empty ? "not-applicable" : errors.length ? "fail" : !products || unknown.length || strength?.state !== "pass" ? "unverified" : "pass",
    scope: ["按输入额定值检查静态垂直上压；木箱框架、柜底局部压力和运输动态载荷尚未核验。", "Checks static vertical top load against entered ratings; crate frames, local floor pressure and dynamic transport loads remain unverified."],
    model: "bearingErrors + bearingStatus + strength", items: [...errors, ...unknown, ...(strength?.state !== "pass" ? strength?.items ?? [] : []), ...(plan.pallets ?? []).filter(p => p.packaging && p.packaging.enclosure !== "none").map(p => p.id)] });
  if (empty || plan.workflow === "pallet-only") {
    add({ id: "path", state: "not-applicable", scope: ["当前方案没有入柜装卸任务。", "This plan has no vehicle loading or unloading task."], model: "no-vehicle-task", items: [] });
  } else if (!audit.completeCoordinates) {
    add({ id: "path", state: "unverified", scope: ["缺少完整箱位，无法核验全部装卸路径。", "Incomplete coordinates prevent a complete access review."], model: "incomplete-coordinates", items: [] });
  } else if ((plan.palletization ? plan.pallets?.length ?? 0 : plan.placements.length) > 240) {
    add({ id: "path", state: "unverified", scope: ["装载单元超过摘要自动路径复核预算（240 件）；尚未核验完整装卸任务。", "Loading units exceed the automatic summary access-review budget (240); the complete handling task is unverified."], model: "review-budget", items: [] });
  } else {
    const access = auditAccess(plan), blocked = access.issues.filter(i => !["unassigned", "search"].includes(i.reason));
    add({ id: "path", state: blocked.length ? "fail" : !access.complete || access.issues.some(i => i.reason === "search") ? "unverified" : "pass",
      scope: access.model === "bounded-maneuver"
        ? ["有限搜索的货物包络通道；未找到路径不等于绝对不可装。具体装卸操作由现场安排。", "Bounded cargo-envelope access search; no route found does not prove impossibility. On-site teams arrange the actual loading operations."]
        : access.model === "open-access"
          ? ["检查开放装载面及卸货支撑顺序；具体装卸操作由现场安排。", "Checks open loading access and unloading support order; on-site teams arrange actual loading operations."]
          : ["检查货物最终位置直线通过后门及卸货支撑顺序；具体装卸操作由现场安排。", "Checks straight rear-door cargo travel at the final position and unloading support order; on-site teams arrange actual loading operations."],
      model: access.model, items: access.issues.map(i => `${i.phase}/${i.id}: ${i.reason}${i.obstacles.length ? " (" + i.obstacles.join(", ") + ")" : ""}`) });
  }
  add({ id: "securing", state: empty ? "not-applicable" : "unverified", scope: ["尚未建立绑扎、挡木、气袋和制动工况模型，需现场确认固定方案。", "Lashings, blocking, airbags and braking conditions are not modeled; confirm a securing plan on site."], model: "not-modeled", items: [] });
  if(plan.pallets?.some(p=>p.packaging&&p.packaging.enclosure!=="none")){
    const check=checks.find(c=>c.id==="bearing")!;
    check.scope=["箱体按录入额定值核对静态上压；木箱额定资料与独立叠放预检分开显示，主求解器仍将木箱底置。柜底局部压力与运输动态载荷未核验。","Carton static top load uses entered ratings. Crate rating evidence and independent stack preflight are separate; the main solver keeps crates floor-only. Local floor pressure and transport dynamics remain unverified."];
  }
  if(plan.dimensionScenario?.proxyProductIds.length){
    const bearing=checks.find(c=>c.id==="bearing")!;
    if(bearing.state!=="fail")bearing.state="unverified";
    bearing.items=[...bearing.items,...plan.dimensionScenario.proxyProductIds];
    bearing.scope=["公差包络仅用于保守占位；真实接触面、防滚和承托未核验。","Tolerance proxies only reserve conservative space; actual contact faces, anti-roll and support remain unverified."];
  }
  if(plan.container.exclusions?.length){
    const geometry=checks.find(c=>c.id==="geometry")!;geometry.scope=[geometry.scope[0]+" 柜内障碍及禁占区参与同一校验，不提供承托。",geometry.scope[1]+" Site exclusions participate in the same validation and provide no support."];
    if(plan.container.loadingAccess==="open"&&plan.workflow!=="pallet-only"){
      const path=checks.find(c=>c.id==="path")!;if(path.state!=="fail")path.state="unverified";path.scope=["开放装载面的区域绕行尚未核验；具体装卸操作由现场安排。","Routing around site regions during open loading remains unverified; on-site teams arrange actual loading operations."];
    }
  }
  if(plan.container.exclusions?.some(z=>z.accessory)){
    const securing=checks.find(c=>c.id==="securing")!;
    securing.scope=["已记录附件包络、计划重量与安装依赖；所有预留始终参与几何和路径检查。固定强度、安装可达、拆除动作和现场施工未核验。","Accessory envelopes, planned mass and installation dependencies are recorded. All reservations always constrain geometry and access. Securing strength, installation reach, removal and field work remain unverified."];
    try{securing.items=accessoryInstallationPlan(plan).map(row=>[row.region.id,...row.missingProductIds].join(" / "));}catch{securing.state="fail";securing.scope=["附件安装依赖无效，请重新计算。","Accessory installation dependencies are invalid; recalculate."];securing.items=[];}
  }
  const longSupport=inspectLongSupport(plan,products);
  if(longSupport.length){
    const bearing=checks.find(c=>c.id==="bearing")!;
    if(longSupport.some(r=>r.state==="fail"))bearing.state="fail";
    else if(bearing.state!=="fail")bearing.state="unverified";
    bearing.scope=[bearing.scope[0]+" 长条箱支承带、悬跨与悬挑另作独立几何预检，不自动重排或放行箱位；材料强度未核验。",bearing.scope[1]+" Long-carton bands, spans and overhangs have an independent geometry preflight; it neither repacks nor authorizes placements. Material strength is unverified."];
    bearing.model+=" + inspectLongSupport";
    bearing.items.push(...longSupport.filter(r=>r.state!=="pass").map(r=>`${r.id}: ${r.issues.map(i=>SUPPORT_ISSUES[i][1]).join("; ")}`));
  }
  const passed = checks.filter(c => c.state === "pass").length, failed = checks.filter(c => c.state === "fail").length, unverified = checks.filter(c => c.state === "unverified").length;
  return { checks, state: failed ? "fail" : unverified ? "unverified" : "pass", passed, failed, unverified };
}
