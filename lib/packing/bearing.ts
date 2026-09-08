import type { PlacedBox, ProductInput } from "./types";

export function contactArea(a: PlacedBox, b: PlacedBox) {
  return Math.max(0, Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y));
}

/** Static vertical load distributed by contact area, including every upper tier. */
export function bearingLoads(boxes: PlacedBox[]) {
  const loads = new Map<string, number>();
  const sorted = [...boxes].sort((a, b) => b.z - a.z);
  const byTop = new Map<number, PlacedBox[]>();
  for (const b of boxes) {
    const key = Math.round((b.z + b.dz) / 0.0001);
    byTop.set(key, [...(byTop.get(key) ?? []), b]);
  }
  for (const b of sorted) {
    const below = (byTop.get(Math.round(b.z / 0.0001)) ?? []).filter(x => x.id !== b.id);
    const areas = below.map(x => contactArea(b, x));
    const totalArea = areas.reduce((a, c) => a + c, 0);
    if (!totalArea) continue;
    const mass = b.weight + (loads.get(b.id) ?? 0);
    below.forEach((x, i) => loads.set(x.id, (loads.get(x.id) ?? 0) + mass * areas[i] / totalArea));
  }
  return loads;
}

export function bearingErrors(boxes: PlacedBox[], products: ProductInput[]) {
  if (!products.some(p => p.maxTopLoadKg !== undefined)) return [];
  const loads = bearingLoads(boxes);
  const rules = new Map(products.map(p => [p.id, p]));
  return boxes.flatMap(b => {
    const limit = rules.get(b.productId)?.maxTopLoadKg;
    const actual = loads.get(b.id) ?? 0;
    return limit !== undefined && actual > limit + 0.00001
      ? [`${b.sku} 箱体 ${b.id} 上方累计 ${actual.toFixed(2)} kg，超过允许承重 ${limit} kg。`] : [];
  });
}
