import { accessoryRegions } from "./container-accessories";
import { deliveryIdentityState } from "./delivery-identity";
import { boxBounds, measureWall, type WallSide } from "./inspection";
import { clipPolygon, polygonArea, triangulatePolygon, type V2 } from "./solid-math";
import { siteExclusionBoxes, SITE_EXCLUSION_PREFIX } from "./site-exclusions";
import { regularSurface, regularSurfaceSpec } from "./surface-inspection";
import type { PackingResult } from "./types";

export type MarkInput = { unitId: string; face: WallSide; widthMm: number; heightMm: number; accessMm: number };
export type MoistureInput = { waterGrams: number; ratedGramsPerUnit: number; safetyFactor: number; source: string; accessoryIds: string[] };
const SIDES = ["x-", "x+", "y-", "y+", "z-", "z+"] as const;
const EPS = 1e-6;
const fail = () => new Error("现场核对参数或版本无效 / Invalid field review inputs or revision");
const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

function context(plan: PackingResult) {
  if (!plan.validation.valid || deliveryIdentityState(plan) !== "current") throw fail();
  const { planId, revisionId, signature } = plan.deliveryIdentity!;
  return { planId, revisionId, signature };
}

export function reviewShippingMark(plan: PackingResult, input: MarkInput) {
  context(plan);
  if (!input || !SIDES.includes(input.face) || ![input.widthMm, input.heightMm, input.accessMm].every(n => inRange(n, 1, 100_000))) throw fail();
  const unit = plan.deliveryIdentity!.units.find(row => row.kind === "carton" && row.unitId === input.unitId);
  const box = unit && plan.placements.find(row => row.id === unit.localId);
  if (!box) throw fail();
  const profile = regularSurfaceSpec(box, plan.cargoDetails?.[box.productId]);
  if (!profile || plan.pallets?.some(pallet => pallet.enclosureHeight && box.palletIds?.includes(pallet.id))) {
    return { status: "unsupported" as const, cartonId: box.id, clearanceMm: null, obstruction: null };
  }
  const axis = "xyz".indexOf(input.face[0]);
  const direction = input.face[1] === "+" ? 1 : -1;
  const across = [0, 1, 2].filter(index => index !== axis);
  const [low, high] = boxBounds(box);
  const plane = direction > 0 ? high[axis] : low[axis];
  const surface = regularSurface(box, profile);
  const label = surface.faces.flatMap((face, index) => {
    if (!face.every(point => Math.abs(point[axis] - plane) < EPS)) return [];
    const polygon = face.map(point => [point[across[0]], point[across[1]]] as V2);
    const center = surface.references[index];
    const u = center[across[0]] - input.widthMm / 2, v = center[across[1]] - input.heightMm / 2;
    const w = u + input.widthMm, h = v + input.heightMm;
    const rectangle: V2[] = [[u, v], [w, v], [w, h], [u, h]];
    const area = triangulatePolygon(polygon).reduce((sum, triangle) =>
      sum + polygonArea(clipPolygon(rectangle, triangle.map(i => polygon[i]))), 0);
    return area + EPS >= input.widthMm * input.heightMm ? [{ u, v, w, h }] : [];
  })[0];
  if (!label) return { status: "does-not-fit" as const, cartonId: box.id, clearanceMm: null, obstruction: null };

  const obstacles = new Set(plan.container.exclusions?.filter(region => region.kind === "obstacle").map(region => SITE_EXCLUSION_PREFIX + region.id));
  const nearby = [
    ...plan.placements.filter(other => other.id !== box.id), ...plan.pallets ?? [],
    ...siteExclusionBoxes(plan.container, plan.clearance).filter(region => obstacles.has(region.id)),
  ];
  let clearanceMm = measureWall(box, plan, input.face).distance;
  let obstruction = "vehicle-boundary";
  for (const body of nearby) {
    const [lo, hi] = boxBounds(body);
    if (lo[across[0]] >= label.w - EPS || hi[across[0]] <= label.u + EPS ||
      lo[across[1]] >= label.h - EPS || hi[across[1]] <= label.v + EPS) continue;
    const far = direction > 0 ? hi[axis] - plane : plane - lo[axis];
    if (far <= EPS) continue;
    const gap = Math.max(0, direction > 0 ? lo[axis] - plane : plane - hi[axis]);
    if (gap < clearanceMm) { clearanceMm = gap; obstruction = body.id; }
  }
  return { status: clearanceMm + EPS >= input.accessMm ? "clear" as const : "obstructed" as const, cartonId: box.id, clearanceMm, obstruction };
}

/** A declared water budget divided by rated absorption under the stated service conditions. */
export function reviewMoistureBudget(plan: PackingResult, input: MoistureInput) {
  context(plan);
  if (!input || !inRange(input.waterGrams, 0, 1e9) || !inRange(input.ratedGramsPerUnit, .001, 1e7) ||
    !inRange(input.safetyFactor, 1, 20) || typeof input.source !== "string" || !input.source.trim() || input.source.length > 300) throw fail();
  const eligible = accessoryRegions(plan.container).filter(region => region.kind === "obstacle" && region.accessory.type === "desiccant");
  if (!Array.isArray(input.accessoryIds) || input.accessoryIds.length > eligible.length ||
    new Set(input.accessoryIds).size !== input.accessoryIds.length ||
    input.accessoryIds.some(id => !eligible.some(region => region.id === id))) throw fail();
  const units = eligible.filter(region => input.accessoryIds.includes(region.id));
  const plannedUnits = units.reduce((sum, region) => sum + region.accessory.quantity, 0);
  const requiredGrams = input.waterGrams * input.safetyFactor;
  const requiredUnits = Math.ceil(requiredGrams / input.ratedGramsPerUnit);
  return { requiredGrams, requiredUnits, plannedUnits, shortage: Math.max(0, requiredUnits - plannedUnits), accessoryIds: units.map(region => region.id) };
}

export function fieldReadinessReport(plan: PackingResult, mark?: MarkInput, moisture?: MoistureInput) {
  if (!mark && !moisture) throw fail();
  return {
    format: "cargo-fit-field-readiness", version: 1, context: context(plan),
    ...(mark ? { mark: { input: mark, result: reviewShippingMark(plan, mark) } } : {}),
    ...(moisture ? { moisture: { input: moisture, result: reviewMoistureBudget(plan, moisture) } } : {}),
  };
}
