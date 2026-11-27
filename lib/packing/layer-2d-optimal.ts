export interface Layer2DRect {
  x: number;
  y: number;
  dx: number;
  dy: number;
  rotated: boolean;
}

const EPS = 1e-6;

function gridFill(
  ox: number,
  oy: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
  rotated: boolean,
): Layer2DRect[] {
  const nx = Math.floor((w + EPS) / dx);
  const ny = Math.floor((h + EPS) / dy);
  if (nx <= 0 || ny <= 0) return [];
  const out: Layer2DRect[] = [];
  for (let ix = 0; ix < nx; ix += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      out.push({ x: ox + ix * dx, y: oy + iy * dy, dx, dy, rotated });
    }
  }
  return out;
}

function bestGrid(ox: number, oy: number, w: number, h: number, a: number, b: number): Layer2DRect[] {
  if (w + EPS < Math.min(a, b) || h + EPS < Math.min(a, b)) return [];
  const g1 = gridFill(ox, oy, w, h, a, b, false);
  const g2 = a === b ? [] : gridFill(ox, oy, w, h, b, a, true);
  return g2.length > g1.length ? g2 : g1;
}

/**
 * Exact bounded 2D orthogonal packing with 90° rotation for small-to-medium layers.
 * Uses canonical lowest-leftmost placement and area-based upper bound pruning.
 */
function exactBranchAndBound2D(
  L: number,
  W: number,
  a: number,
  b: number,
  initialBest: Layer2DRect[],
  targetCap: number,
  maxNodes = 8000,
): Layer2DRect[] {
  const area = a * b;
  const maxPossible = Math.min(targetCap, Math.floor((L * W + EPS) / area));
  if (initialBest.length >= maxPossible) return initialBest;

  let best = initialBest;
  let nodes = 0;
  const placed: Layer2DRect[] = [];
  const dims: Array<[number, number, boolean]> = a === b ? [[a, b, false]] : [[a, b, false], [b, a, true]];

  const overlapsAny = (x: number, y: number, dx: number, dy: number): boolean => {
    for (let i = 0; i < placed.length; i += 1) {
      const p = placed[i];
      if (x < p.x + p.dx - EPS && x + dx > p.x + EPS && y < p.y + p.dy - EPS && y + dy > p.y + EPS) {
        return true;
      }
    }
    return false;
  };

  // Generate candidate corner points (bottom-left skyline)
  const dfs = (remArea: number) => {
    if (placed.length > best.length) {
      best = placed.map((r) => ({ ...r }));
      if (best.length >= maxPossible) return;
    }
    if (nodes >= maxNodes) return;
    if (placed.length + Math.floor((remArea + EPS) / area) <= best.length) return;
    nodes += 1;

    // Collect canonical free anchor points
    const xs = new Set<number>([0]);
    const ys = new Set<number>([0]);
    for (let i = 0; i < placed.length; i += 1) {
      const p = placed[i];
      if (p.x + p.dx <= L - Math.min(a, b) + EPS) xs.add(p.x + p.dx);
      if (p.y + p.dy <= W - Math.min(a, b) + EPS) ys.add(p.y + p.dy);
    }
    const sortedX = [...xs].sort((u, v) => u - v);
    const sortedY = [...ys].sort((u, v) => u - v);

    // Find lowest-leftmost feasible anchor
    let anchorX = -1;
    let anchorY = -1;
    const validOrientations: Array<[number, number, boolean]> = [];

    outer: for (let xi = 0; xi < sortedX.length; xi += 1) {
      const x = sortedX[xi];
      for (let yi = 0; yi < sortedY.length; yi += 1) {
        const y = sortedY[yi];
        let fitsAny = false;
        for (const [dx, dy, rot] of dims) {
          if (x + dx <= L + EPS && y + dy <= W + EPS && !overlapsAny(x, y, dx, dy)) {
            if (!fitsAny) {
              anchorX = x;
              anchorY = y;
              fitsAny = true;
            }
            validOrientations.push([dx, dy, rot]);
          }
        }
        if (fitsAny) break outer;
      }
    }

    if (anchorX < 0) return;

    for (const [dx, dy, rot] of validOrientations) {
      placed.push({ x: anchorX, y: anchorY, dx, dy, rotated: rot });
      dfs(remArea - area);
      placed.pop();
      if (best.length >= maxPossible || nodes >= maxNodes) return;
    }

    // Also try skipping this anchor if another orientation/shift at a slightly later anchor could yield a pinwheel
    if (placed.length + 1 < maxPossible && nodes < maxNodes) {
      // Try next distinct feasible anchor along same row/column
      let altTried = 0;
      for (let xi = 0; xi < sortedX.length && altTried < 2; xi += 1) {
        const x = sortedX[xi];
        for (let yi = 0; yi < sortedY.length && altTried < 2; yi += 1) {
          const y = sortedY[yi];
          if (x === anchorX && y === anchorY) continue;
          if (x < anchorX - EPS) continue;
          for (const [dx, dy, rot] of dims) {
            if (x + dx <= L + EPS && y + dy <= W + EPS && !overlapsAny(x, y, dx, dy)) {
              placed.push({ x, y, dx, dy, rotated: rot });
              dfs(remArea - area);
              placed.pop();
              altTried += 1;
              if (best.length >= maxPossible || nodes >= maxNodes) return;
            }
          }
        }
      }
    }
  };

  dfs(L * W);
  return best;
}

/**
 * Solves 2D orthogonal packing of identical (a × b) items inside an (L × W) floor
 * with 90° rotation allowed, combining:
 * 1. Pure aligned grids
 * 2. Two-strip guillotine X/Y partitions
 * 3. Canonical 5-block Pinwheel partitions (Martello–Vigo / Birgin–Lobato–Morabito)
 * 4. Bounded exact branch-and-bound for small-to-medium instances
 */
export function solveOptimal2DLayer(
  L: number,
  W: number,
  a: number,
  b: number,
  targetCap = Infinity,
): Layer2DRect[] {
  if (L <= EPS || W <= EPS || a <= EPS || b <= EPS) return [];
  const areaBound = Math.min(targetCap, Math.floor((L * W + EPS) / (a * b)));
  if (areaBound <= 0) return [];

  let best = bestGrid(0, 0, L, W, a, b);
  if (best.length >= areaBound) return best.slice(0, targetCap);

  // 2. Two-strip guillotine splits along X
  const maxNxA = Math.floor((L + EPS) / a);
  for (let nx = 1; nx <= maxNxA; nx += 1) {
    const splitX = nx * a;
    const left = gridFill(0, 0, splitX, W, a, b, false);
    const right = bestGrid(splitX, 0, L - splitX, W, a, b);
    if (left.length + right.length > best.length) {
      best = [...left, ...right];
      if (best.length >= areaBound) return best.slice(0, targetCap);
    }
  }
  if (a !== b) {
    const maxNxB = Math.floor((L + EPS) / b);
    for (let nx = 1; nx <= maxNxB; nx += 1) {
      const splitX = nx * b;
      const left = gridFill(0, 0, splitX, W, b, a, true);
      const right = bestGrid(splitX, 0, L - splitX, W, a, b);
      if (left.length + right.length > best.length) {
        best = [...left, ...right];
        if (best.length >= areaBound) return best.slice(0, targetCap);
      }
    }
  }

  // 2b. Two-strip guillotine splits along Y
  const maxNyB = Math.floor((W + EPS) / b);
  for (let ny = 1; ny <= maxNyB; ny += 1) {
    const splitY = ny * b;
    const bot = gridFill(0, 0, L, splitY, a, b, false);
    const top = bestGrid(0, splitY, L, W - splitY, a, b);
    if (bot.length + top.length > best.length) {
      best = [...bot, ...top];
      if (best.length >= areaBound) return best.slice(0, targetCap);
    }
  }
  if (a !== b) {
    const maxNyA = Math.floor((W + EPS) / a);
    for (let ny = 1; ny <= maxNyA; ny += 1) {
      const splitY = ny * a;
      const bot = gridFill(0, 0, L, splitY, b, a, true);
      const top = bestGrid(0, splitY, L, W - splitY, a, b);
      if (bot.length + top.length > best.length) {
        best = [...bot, ...top];
        if (best.length >= areaBound) return best.slice(0, targetCap);
      }
    }
  }

  // 3. Canonical 5-block Pinwheel (4 corner blocks around a central block)
  if (a !== b) {
    const xCuts = new Set<number>();
    const yCuts = new Set<number>();
    for (let i = 0; i * a <= L + EPS; i += 1) {
      for (let j = 0; i * a + j * b <= L + EPS; j += 1) {
        const v = i * a + j * b;
        if (v > EPS && v < L - EPS) xCuts.add(Math.round(v * 1000) / 1000);
      }
    }
    for (let i = 0; i * a <= W + EPS; i += 1) {
      for (let j = 0; i * a + j * b <= W + EPS; j += 1) {
        const v = i * a + j * b;
        if (v > EPS && v < W - EPS) yCuts.add(Math.round(v * 1000) / 1000);
      }
    }
    const xs = [...xCuts].sort((u, v) => u - v).slice(0, 20);
    const ys = [...yCuts].sort((u, v) => u - v).slice(0, 20);

    for (const x1 of xs) {
      for (const x2 of xs) {
        for (const y1 of ys) {
          for (const y2 of ys) {
            if (x1 > x2 + EPS || y1 > y2 + EPS) continue;
            // Clockwise 5-block decomposition:
            // B1 (bottom-left): [0, x2] x [0, y1]
            // B2 (bottom-right): [x2, L] x [0, y2]
            // B3 (top-right): [x1, L] x [y2, W]
            // B4 (top-left): [0, x1] x [y1, W]
            // B5 (center): [x1, x2] x [y1, y2]
            const b1 = bestGrid(0, 0, x2, y1, a, b);
            const b2 = bestGrid(x2, 0, L - x2, y2, a, b);
            const b3 = bestGrid(x1, y2, L - x1, W - y2, a, b);
            const b4 = bestGrid(0, y1, x1, W - y1, a, b);
            const b5 = x2 > x1 + EPS && y2 > y1 + EPS ? bestGrid(x1, y1, x2 - x1, y2 - y1, a, b) : [];
            const total = b1.length + b2.length + b3.length + b4.length + b5.length;
            if (total > best.length) {
              best = [...b1, ...b2, ...b3, ...b4, ...b5];
              if (best.length >= areaBound) return best.slice(0, targetCap);
            }
          }
        }
      }
    }
  }

  // 4. Bounded exact branch-and-bound for small-to-medium instances
  if (areaBound <= 32 && best.length < areaBound) {
    best = exactBranchAndBound2D(L, W, a, b, best, areaBound, 15000);
  }

  return best.slice(0, targetCap);
}

export interface Orient3DInput {
  dx: number;
  dy: number;
  dz: number;
  label: string;
}

export interface Placed3DBlock {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  label: string;
}

/**
 * Recursive 3D guillotine + mixed-height Z-layer solver for single-SKU 6-orientation
 * packing in maximum mode. Combines:
 *   1. Optimal 2D layer stacked along Z (including mixed-height Z-slabs H = h1 + h2 + ...),
 *   2. X-axis and Y-axis full-height guillotine splits (guaranteed 100% floor support),
 *   3. Memoized recursion within a strict wall-clock budget.
 */
export function solveOptimal3DMixedOrientation(
  L: number,
  W: number,
  H: number,
  orientations: readonly Orient3DInput[],
  maxLayers: number,
  targetCap: number,
  timeBudgetMs = 35,
): Placed3DBlock[] {
  if (orientations.length === 0 || targetCap <= 0 || L <= EPS || W <= EPS || H <= EPS) return [];

  const minBoxVol = Math.min(...orientations.map((o) => o.dx * o.dy * o.dz));
  if (minBoxVol <= EPS) return [];

  // Group orientations by vertical dz
  const byDz = new Map<number, Orient3DInput[]>();
  for (const o of orientations) {
    if (o.dx > L + EPS || o.dy > W + EPS || o.dz > H + EPS) continue;
    const key = Math.round(o.dz * 1000) / 1000;
    const list = byDz.get(key) ?? [];
    list.push(o);
    byDz.set(key, list);
  }
  if (byDz.size === 0) return [];

  const distinctDz = [...byDz.keys()].sort((a, b) => a - b);
  const distinctX = [...new Set(orientations.map((o) => Math.round(o.dx * 1000) / 1000))].sort((a, b) => a - b);
  const distinctY = [...new Set(orientations.map((o) => Math.round(o.dy * 1000) / 1000))].sort((a, b) => a - b);

  const deadline = Date.now() + timeBudgetMs;
  const memo = new Map<string, Placed3DBlock[]>();

  // Helper: best single-slab 2D packing of (sL, sW) using orientations of vertical height `dz`
  const slab2DCache = new Map<string, Placed3DBlock[]>();
  const bestSlab2D = (sL: number, sW: number, dz: number): Placed3DBlock[] => {
    const key = `${Math.round(sL * 100)}|${Math.round(sW * 100)}|${Math.round(dz * 100)}`;
    const hit = slab2DCache.get(key);
    if (hit) return hit;

    const group = byDz.get(dz) ?? [];
    let best: Placed3DBlock[] = [];
    const primary = group[0];
    if (primary) {
      const twin = group.find((o) => Math.abs(o.dx - primary.dy) <= EPS && Math.abs(o.dy - primary.dx) <= EPS);
      if (twin && Math.abs(primary.dx - primary.dy) > EPS) {
        const rects = solveOptimal2DLayer(sL, sW, primary.dx, primary.dy, targetCap);
        best = rects.map((r) => ({
          x: r.x,
          y: r.y,
          z: 0,
          dx: r.dx,
          dy: r.dy,
          dz,
          label: r.rotated ? twin.label : primary.label,
        }));
      } else {
        for (const o of group) {
          const nx = Math.floor((sL + EPS) / o.dx);
          const ny = Math.floor((sW + EPS) / o.dy);
          if (nx * ny > best.length) {
            const arr: Placed3DBlock[] = [];
            for (let ix = 0; ix < nx; ix += 1) {
              for (let iy = 0; iy < ny; iy += 1) {
                arr.push({ x: ix * o.dx, y: iy * o.dy, z: 0, dx: o.dx, dy: o.dy, dz, label: o.label });
              }
            }
            best = arr;
          }
        }
      }
    }
    slab2DCache.set(key, best);
    return best;
  };

  // Helper: Z-axis knapsack DP combining different vertical heights dz over (sL, sW, sH)
  // Only stacks a slab above another when the lower slab covers 100% of the upper slab's footprint
  const bestMixedZ = (sL: number, sW: number, sH: number): Placed3DBlock[] => {
    // Try uniform dz first
    let best: Placed3DBlock[] = [];
    const slabsByDz = distinctDz
      .filter((dz) => dz <= sH + EPS)
      .map((dz) => {
        const rects = bestSlab2D(sL, sW, dz);
        const area = rects.reduce((s, r) => s + r.dx * r.dy, 0);
        const fullCover = Math.abs(area - sL * sW) <= 1e-2;
        return { dz, rects, fullCover };
      })
      .filter((s) => s.rects.length > 0);

    for (const s of slabsByDz) {
      const nz = Math.min(maxLayers, Math.floor((sH + EPS) / s.dz));
      if (nz * s.rects.length > best.length) {
        const arr: Placed3DBlock[] = [];
        for (let iz = 0; iz < nz; iz += 1) {
          for (const r of s.rects) arr.push({ ...r, z: iz * s.dz });
        }
        best = arr;
      }
    }

    // Try 2-height Z combinations: n1 layers of a full-coverage slab (bottom) + n2 layers of any slab (top)
    if (slabsByDz.length >= 2) {
      for (const bot of slabsByDz) {
        if (!bot.fullCover) continue; // bottom must provide 100% continuous floor for arbitrary upper orientation
        const maxBot = Math.min(maxLayers, Math.floor((sH + EPS) / bot.dz));
        for (let nb = 1; nb <= maxBot; nb += 1) {
          const remH = sH - nb * bot.dz;
          const remLayers = maxLayers - nb;
          if (remH <= EPS || remLayers <= 0) continue;
          for (const top of slabsByDz) {
            if (Math.abs(top.dz - bot.dz) <= EPS) continue;
            const nt = Math.min(remLayers, Math.floor((remH + EPS) / top.dz));
            if (nt <= 0) continue;
            const total = nb * bot.rects.length + nt * top.rects.length;
            if (total > best.length) {
              const arr: Placed3DBlock[] = [];
              for (let iz = 0; iz < nb; iz += 1) {
                for (const r of bot.rects) arr.push({ ...r, z: iz * bot.dz });
              }
              const zOff = nb * bot.dz;
              for (let iz = 0; iz < nt; iz += 1) {
                for (const r of top.rects) arr.push({ ...r, z: zOff + iz * top.dz });
              }
              best = arr;
            }
          }
        }
      }
    }

    return best;
  };

  const generateCuts = (span: number, dims: number[]): number[] => {
    const cuts = new Set<number>();
    const minD = dims[0];
    for (const d of dims) {
      for (let k = 1; k * d <= span - minD + EPS && k <= 6; k += 1) {
        cuts.add(Math.round(k * d * 1000) / 1000);
      }
    }
    return [...cuts].sort((a, b) => a - b).slice(0, 12);
  };

  const solve = (sL: number, sW: number, sH: number, depth: number): Placed3DBlock[] => {
    const key = `${Math.round(sL * 100)}|${Math.round(sW * 100)}|${Math.round(sH * 100)}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const volBound = Math.min(targetCap, Math.floor((sL * sW * sH + EPS) / minBoxVol));
    let best = bestMixedZ(sL, sW, sH);
    if (best.length >= volBound || depth <= 0 || Date.now() > deadline) {
      memo.set(key, best);
      return best;
    }

    // Try X-axis guillotine splits
    const xCuts = generateCuts(sL, distinctX);
    for (const cut of xCuts) {
      if (Date.now() > deadline) break;
      const left = solve(cut, sW, sH, depth - 1);
      const right = solve(sL - cut, sW, sH, depth - 1);
      if (left.length + right.length > best.length) {
        best = [...left, ...right.map((r) => ({ ...r, x: r.x + cut }))];
        if (best.length >= volBound) break;
      }
    }

    // Try Y-axis guillotine splits
    if (best.length < volBound && Date.now() <= deadline) {
      const yCuts = generateCuts(sW, distinctY);
      for (const cut of yCuts) {
        if (Date.now() > deadline) break;
        const front = solve(sL, cut, sH, depth - 1);
        const back = solve(sL, sW - cut, sH, depth - 1);
        if (front.length + back.length > best.length) {
          best = [...front, ...back.map((r) => ({ ...r, y: r.y + cut }))];
          if (best.length >= volBound) break;
        }
      }
    }

    memo.set(key, best);
    return best;
  };

  const result = solve(L, W, H, 3);
  return result.slice(0, targetCap);
}
