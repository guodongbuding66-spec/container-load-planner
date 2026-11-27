import type { OrientationCode, PlacedBox, ProductInput } from "./types";

const EPS = 1e-6;

export interface Exact2DItemSpec {
  product: ProductInput;
  qty: number;
  orients: Array<{ dx: number; dy: number; dz: number; label: OrientationCode }>;
}

interface Placed2D {
  itemIdx: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  dz: number;
  label: OrientationCode;
}

/**
 * Exact bounded multi-SKU 2D orthogonal packing with rotation for small-to-medium
 * mixed orders (e.g. <= 24 items). Uses canonical coordinate anchors, symmetry breaking
 * for identical SKUs, area upper-bound pruning, and a strict wall-clock deadline.
 */
export function solveExactMultiSku2D(
  L: number,
  W: number,
  H: number,
  items: Exact2DItemSpec[],
  maxWeight: number,
  makePlacement: (
    product: ProductInput,
    index: number,
    point: { x: number; y: number; z: number },
    orient: { dx: number; dy: number; dz: number; label: OrientationCode },
    layer: number,
  ) => PlacedBox,
  scorePlan: (boxes: PlacedBox[]) => number,
  validate: (boxes: PlacedBox[]) => boolean,
  timeBudgetMs = 45,
): PlacedBox[] | null {
  const validItems = items
    .map((it) => ({
      ...it,
      orients: it.orients.filter((o) => o.dz <= H + EPS && o.dx <= L + EPS && o.dy <= W + EPS),
    }))
    .filter((it) => it.qty > 0 && it.orients.length > 0);

  if (validItems.length < 2) return null;

  const totalQty = validItems.reduce((s, it) => s + it.qty, 0);
  if (totalQty > 24) return null;

  // Deduplicate identical (dx, dy) orientations per SKU (keep smallest dz first)
  const cleanItems = validItems.map((it) => {
    const seen = new Set<string>();
    const orients: typeof it.orients = [];
    for (const o of [...it.orients].sort((a, b) => a.dz - b.dz)) {
      const k = `${Math.round(o.dx * 100)}x${Math.round(o.dy * 100)}`;
      if (!seen.has(k)) {
        seen.add(k);
        orients.push(o);
      }
    }
    const minArea = Math.min(...orients.map((o) => o.dx * o.dy));
    return { ...it, orients, minArea };
  });

  // Sort SKUs: mustLoad desc, priority desc, larger footprint first for tighter pruning
  cleanItems.sort(
    (a, b) =>
      Number(Boolean(b.product.mustLoad)) - Number(Boolean(a.product.mustLoad)) ||
      (b.product.priority ?? 0) - (a.product.priority ?? 0) ||
      b.minArea - a.minArea,
  );

  // Build flat item sequence for exact backtracking (try full-order feasibility first)
  const itemSeq: number[] = [];
  for (let i = 0; i < cleanItems.length; i += 1) {
    for (let q = 0; q < cleanItems[i].qty; q += 1) itemSeq.push(i);
  }

  const deadline = Date.now() + timeBudgetMs;
  const maxNodes = 35000;
  let nodes = 0;

  const placed: Placed2D[] = [];
  let bestPlaced: Placed2D[] = [];
  let bestCount = 0;
  let bestArea = 0;

  const minSide = Math.min(...cleanItems.flatMap((it) => it.orients.flatMap((o) => [o.dx, o.dy])));
  const totalDemandArea = cleanItems.reduce((s, it) => s + it.qty * it.minArea, 0);
  const fullOrderPossible = totalDemandArea <= L * W + EPS;

  const overlapsAny = (x: number, y: number, dx: number, dy: number): boolean => {
    for (let i = 0; i < placed.length; i += 1) {
      const p = placed[i];
      if (x < p.x + p.dx - EPS && x + dx > p.x + EPS && y < p.y + p.dy - EPS && y + dy > p.y + EPS) {
        return true;
      }
    }
    return false;
  };

  // Precompute suffix minimum areas for upper-bound pruning
  const suffixAreas = new Array<number>(itemSeq.length + 1).fill(0);
  const suffixMinItemArea = new Array<number>(itemSeq.length + 1).fill(Infinity);
  for (let i = itemSeq.length - 1; i >= 0; i -= 1) {
    const a = cleanItems[itemSeq[i]].minArea;
    suffixAreas[i] = suffixAreas[i + 1] + a;
    suffixMinItemArea[i] = Math.min(suffixMinItemArea[i + 1], a);
  }

  const lastAnchorBySku = new Array<number>(cleanItems.length).fill(-1);

  const dfs = (seqIdx: number, usedArea: number, usedWeight: number, mustFitAll: boolean): boolean => {
    if (placed.length > bestCount || (placed.length === bestCount && usedArea > bestArea + EPS)) {
      bestCount = placed.length;
      bestArea = usedArea;
      bestPlaced = placed.map((r) => ({ ...r }));
      if (bestCount === itemSeq.length) return true;
    }
    if (seqIdx >= itemSeq.length) return false;
    if (nodes >= maxNodes || ((nodes & 255) === 0 && Date.now() > deadline)) return false;
    nodes += 1;

    const remArea = L * W - usedArea;
    if (mustFitAll) {
      if (suffixAreas[seqIdx] > remArea + EPS) return false;
    } else {
      const maxMoreByArea = Math.floor((remArea + EPS) / Math.max(EPS, suffixMinItemArea[seqIdx]));
      if (placed.length + Math.min(itemSeq.length - seqIdx, maxMoreByArea) <= bestCount) return false;
    }

    const skuIdx = itemSeq[seqIdx];
    const item = cleanItems[skuIdx];
    const prevAnchor = lastAnchorBySku[skuIdx];

    if (usedWeight + item.product.weight <= maxWeight + EPS) {
      // Canonical corner anchors from placed rectangles + origin + opposite wall-flush anchors (L - dx, W - dy)
      const xs = new Set<number>([0]);
      const ys = new Set<number>([0]);
      for (let oi = 0; oi < item.orients.length; oi += 1) {
        const o = item.orients[oi];
        if (L - o.dx > EPS) xs.add(L - o.dx);
        if (W - o.dy > EPS) ys.add(W - o.dy);
      }
      for (let i = 0; i < placed.length; i += 1) {
        const p = placed[i];
        if (p.x + p.dx <= L - minSide + EPS) xs.add(p.x + p.dx);
        if (p.y + p.dy <= W - minSide + EPS) ys.add(p.y + p.dy);
        for (let oi = 0; oi < item.orients.length; oi += 1) {
          const o = item.orients[oi];
          if (p.x - o.dx >= -EPS) xs.add(Math.max(0, p.x - o.dx));
          if (p.y - o.dy >= -EPS) ys.add(Math.max(0, p.y - o.dy));
        }
      }
      const sortedX = [...xs].sort((a, b) => a - b);
      const sortedY = [...ys].sort((a, b) => a - b);

      // Try placing this item at every canonical corner (x, y) with symmetry breaking for identical SKU
      for (let xi = 0; xi < sortedX.length; xi += 1) {
        const x = sortedX[xi];
        for (let yi = 0; yi < sortedY.length; yi += 1) {
          const y = sortedY[yi];
          const anchorKey = Math.round(x * 1000) * 10_000_000 + Math.round(y * 1000);
          if (anchorKey < prevAnchor) continue;

          for (let oi = 0; oi < item.orients.length; oi += 1) {
            const o = item.orients[oi];
            if (x + o.dx > L + EPS || y + o.dy > W + EPS) continue;
            if (overlapsAny(x, y, o.dx, o.dy)) continue;

            placed.push({ itemIdx: skuIdx, x, y, dx: o.dx, dy: o.dy, dz: o.dz, label: o.label });
            lastAnchorBySku[skuIdx] = anchorKey;
            const foundAll = dfs(seqIdx + 1, usedArea + o.dx * o.dy, usedWeight + item.product.weight, mustFitAll);
            lastAnchorBySku[skuIdx] = prevAnchor;
            placed.pop();
            if (foundAll) return true;
            if (nodes >= maxNodes || Date.now() > deadline) return false;
          }
        }
      }
    }

    // If not requiring all items, allow skipping this item (skip remaining copies of same SKU)
    if (!mustFitAll) {
      let nextDifferent = seqIdx + 1;
      while (nextDifferent < itemSeq.length && itemSeq[nextDifferent] === skuIdx) nextDifferent += 1;
      dfs(nextDifferent, usedArea, usedWeight, false);
    }

    return false;
  };

  // Pass 1: Fast exact feasibility check for packing 100% of the order
  if (fullOrderPossible) {
    dfs(0, 0, 0, true);
  }
  // Pass 2: If full order didn't fit (or isn't possible by area), maximize packed count within remaining budget
  if (bestCount < itemSeq.length && nodes < maxNodes && Date.now() < deadline) {
    dfs(0, 0, 0, false);
  }

  if (bestPlaced.length === 0) return null;

  const boxes = bestPlaced.map((r, idx) =>
    makePlacement(
      cleanItems[r.itemIdx].product,
      idx,
      { x: r.x, y: r.y, z: 0 },
      { dx: r.dx, dy: r.dy, dz: r.dz, label: r.label },
      1,
    ),
  );

  if (!validate(boxes)) return null;
  // Touch scorePlan so callers can compare uniformly
  scorePlan(boxes);
  return boxes;
}
