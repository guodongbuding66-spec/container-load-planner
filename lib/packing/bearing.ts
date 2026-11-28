import type { PlacedBox, ProductInput } from "./types";
import { bodyContactArea, bodyTopLevels } from "./cargo-body";
import { findDirectNestedParent } from "./nesting";

export function contactArea(a: PlacedBox, b: PlacedBox) {
  return Math.max(0, Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y));
}

/** Area sharing for ordinary cargo. Rated long spans bound each support by the whole through load. */
export function bearingLoads(boxes: PlacedBox[], products: ProductInput[] = []) {
  const loads = new Map<string, number>();
  const rules = new Map(products.map(p=>[p.id,p]));
  const sorted = [...boxes].sort((a, b) => b.z - a.z);
  const byTop = new Map<number, PlacedBox[]>();
  for (const b of boxes) {
    for(const z of bodyTopLevels(b,rules.get(b.productId))){
      const key = Math.round(z / 0.0001);
      const list=byTop.get(key);if(list)list.push(b);else byTop.set(key,[b]);
    }
  }
  for (const b of sorted) {
    const nestedParent = findDirectNestedParent(b, boxes, rules.get(b.productId));
    if (nestedParent) {
      loads.set(nestedParent.id, (loads.get(nestedParent.id) ?? 0) + b.weight + (loads.get(b.id) ?? 0));
      continue;
    }
    const below = (byTop.get(Math.round(b.z / 0.0001)) ?? []).filter(x => x.id !== b.id && x.x + x.dx > b.x + 1e-4 && b.x + b.dx > x.x + 1e-4 && x.y + x.dy > b.y + 1e-4 && b.y + b.dy > x.y + 1e-4);
    const areas = below.map(x => bodyContactArea(b,x,rules.get(b.productId),rules.get(x.productId)));
    const totalArea = areas.reduce((a, c) => a + c, 0);
    if (!totalArea) continue;
    const mass = b.weight + (loads.get(b.id) ?? 0);
    const span=rules.get(b.productId)?.longSupport;
    const bound=!!span?.source&&!!span.revision&&span.maxSpanMm!==undefined&&span.maxOverhangMm!==undefined;
    below.forEach((x, i) => {
      if(areas[i]>0)loads.set(x.id,(loads.get(x.id)??0)+(bound?mass:mass*areas[i]/totalArea));
    });
  }
  return loads;
}

export function hasBearingRules(p: ProductInput) {
  return p.maxTopLoadKg !== undefined || p.allowedAboveSkus !== undefined || Object.keys(p.topLoadByVerticalAxis ?? {}).length > 0;
}
export function bearingLimit(b: PlacedBox, p: ProductInput|undefined) {
  if(!p)return undefined;
  // Equal dimensions can identify multiple original axes: take the most restrictive applicable limit.
  const values = (["length", "width", "height"] as const)
    .filter(axis => Math.abs(p[axis] - b.dz) < 0.0001)
    .map(axis => p.topLoadByVerticalAxis?.[axis]).filter((n): n is number => n !== undefined);
  if (p.maxTopLoadKg !== undefined) values.push(p.maxTopLoadKg);
  return values.length ? Math.min(...values) : undefined;
}
export function bearingStatus(boxes: PlacedBox[], products: ProductInput[]) {
  const loads = bearingLoads(boxes,products);
  const unknown = boxes.filter(b => (loads.get(b.id) ?? 0) > 0 && bearingLimit(b, products.find(p => p.id === b.productId)!) === undefined);
  return { unknownIds: unknown.map(b => b.id), verified: unknown.length === 0 };
}
export function bearingErrors(boxes: PlacedBox[], products: ProductInput[]) {
  if (!products.some(hasBearingRules)) return [];
  const loads = bearingLoads(boxes,products);
  const rules = new Map(products.map(p => [p.id, p]));
  const errors: string[] = [];
  for (const b of boxes) {
    const p = rules.get(b.productId); if (!p) continue;
    const limit = bearingLimit(b, p), actual = loads.get(b.id) ?? 0;
    if (limit !== undefined && actual > limit + 0.00001) errors.push(`${b.sku} 箱体 ${b.id} 上方累计 ${actual.toFixed(2)} kg，超过允许承重 ${limit} kg。`);
    if (p.allowedAboveSkus !== undefined) for (const upper of boxes) {
      if (upper.id!==b.id && (findDirectNestedParent(upper,boxes,rules.get(upper.productId))?.id===b.id || bodyContactArea(upper,b,rules.get(upper.productId),p) > 0) && !p.allowedAboveSkus.includes(upper.sku)) errors.push(`${b.sku} 不允许 ${upper.sku} 直接叠放于上方。`);
    }
  }
  return errors;
}
