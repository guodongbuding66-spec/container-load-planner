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
        ? ["有限搜索的货物包络转向／抬升；未找到路径不等于绝对不可装。叉车、货叉和人员空间未核验。", "Bounded cargo-envelope turning/lifting search; no route found does not prove impossibility. Forklifts, forks and personnel space are unverified."]
        : access.model === "open-access"
          ? ["开放装载面及卸货支撑顺序；吊具与搬运设备未核验。", "Open loading access and unloading support order; lifting gear and handling equipment are unverified."]
          : ["最终位置直线通过后门及卸货支撑顺序；转向、抬升、叉车和货叉空间未核验。", "Straight rear-door travel at the final position and unloading support order; turning, lifting, forklifts and forks are unverified."],
      model: access.model, items: access.issues.map(i => `${i.phase}/${i.id}: ${i.reason}${i.obstacles.length ? " (" + i.obstacles.join(", ") + ")" : ""}`) });
  }
  add({ id: "securing", state: empty ? "not-applicable" : "unverified", scope: ["尚未建立绑扎、挡木、气袋和制动工况模型，需现场确认固定方案。", "Lashings, blocking, airbags and braking conditions are not modeled; confirm a securing plan on site."], model: "not-modeled", items: [] });
  const passed = checks.filter(c => c.state === "pass").length, failed = checks.filter(c => c.state === "fail").length, unverified = checks.filter(c => c.state === "unverified").length;
  return { checks, state: failed ? "fail" : unverified ? "unverified" : "pass", passed, failed, unverified };
}
