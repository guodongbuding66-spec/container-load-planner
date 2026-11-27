import { nestedDeltaHeight } from "./nesting";
import { bearingLimit } from "./bearing";
import type {
  PackingRequest,
  PackingStrategy,
  PlacedBox,
  ProductInput,
} from "./types";

interface EffectiveContainer {
  length: number;
  width: number;
  height: number;
}

interface Orientation {
  dx: number;
  dy: number;
  dz: number;
  label: string;
}

const EPS = 1e-6;

interface FreeSpace {
  x: number;
  y: number;
  z: number;
  L: number;
  W: number;
  H: number;
  layerBase: number;
  maxSupportWeightKg: number;
  allowedSkus?: string[];
}

interface BlockCandidate {
  product: ProductInput;
  orientation: Orientation;
  nx: number;
  ny: number;
  nz: number;
  count: number;
  usesNesting: boolean;
  deltaH: number;
  bL: number;
  bW: number;
  bH: number;
  score: number;
}

export interface MultiSkuBlockContext {
  request: PackingRequest;
  container: EffectiveContainer;
  strategy: PackingStrategy;
  maxVisible: number;
  orientationsOf: (product: ProductInput) => Orientation[];
  maxStackLayersOf: (product: ProductInput) => number;
  makePlacement: (
    product: ProductInput,
    index: number,
    point: { x: number; y: number; z: number },
    orientation: Orientation,
    layer: number,
  ) => PlacedBox;
  validate: (boxes: PlacedBox[]) => boolean;
  scorePlan: (boxes: PlacedBox[]) => number;
  timeBudgetMs?: number;
}

function isSimpleBoxProduct(p: ProductInput): boolean {
  if (p.cargoShape && p.cargoShape !== "box") return false;
  if (p.protectionGap && p.protectionGap > EPS) return false;
  if (p.setCode && p.setCode.trim().length > 0) return false;
  return true;
}

function maxTopLoadForOrientation(p: ProductInput, orient: Orientation): number {
  if (p.bottomOnly || p.stackable === false) return 0;
  const dummy = { dz: orient.dz } as PlacedBox;
  const limit = bearingLimit(dummy, p);
  return limit !== undefined && Number.isFinite(limit) ? Math.max(0, limit) : Number.POSITIVE_INFINITY;
}

function allowedLayersInSpace(
  product: ProductInput,
  orient: Orientation,
  spaceH: number,
  layerBase: number,
  maxStackLayersOf: (p: ProductInput) => number,
): { nz: number; usesNesting: boolean; deltaH: number } {
  const deltaH = nestedDeltaHeight(product);
  const usesNesting = deltaH > EPS && Math.abs(orient.dz - product.height) <= EPS;
  const physicalLayers = usesNesting
    ? spaceH >= orient.dz - EPS
      ? 1 + Math.floor((spaceH - orient.dz + EPS) / deltaH)
      : 0
    : Math.floor((spaceH + EPS) / orient.dz);
  if (physicalLayers <= 0) return { nz: 0, usesNesting, deltaH };

  let nz = physicalLayers;
  if (product.bottomOnly || product.stackable === false) {
    nz = layerBase === 0 ? Math.min(1, nz) : 0;
  } else if (product.allowedAboveSkus !== undefined && !product.allowedAboveSkus.includes(product.sku)) {
    nz = Math.min(1, nz);
  } else {
    const cap = maxStackLayersOf(product);
    if (cap > 0) {
      const remLayers = Math.max(0, cap - layerBase);
      nz = Math.min(nz, remLayers);
    }
  }

  // Respect per-column bearing limit (maxTopLoadKg)
  const topLoad = maxTopLoadForOrientation(product, orient);
  if (Number.isFinite(topLoad) && product.weight > EPS && nz > 1) {
    const maxAbove = Math.floor((topLoad + EPS) / product.weight);
    nz = Math.min(nz, 1 + maxAbove);
  }

  return { nz, usesNesting, deltaH };
}

function runGuillotineBlockVariant(
  ctx: MultiSkuBlockContext,
  products: ProductInput[],
  orientMap: Map<string, Orientation[]>,
  mode: "deep-x" | "deep-y" | "layer-fit" | "wall-x",
  volumeCap: number,
  deadlineMs: number,
): PlacedBox[] {
  const { container, request, maxVisible, maxStackLayersOf, makePlacement } = ctx;
  const remaining = new Map<string, number>();
  for (const p of products) remaining.set(p.id, Math.max(0, Math.floor(p.quantity)));

  const spaces: FreeSpace[] = [
    {
      x: 0,
      y: 0,
      z: 0,
      L: container.length,
      W: container.width,
      H: container.height,
      layerBase: 0,
      maxSupportWeightKg: Number.POSITIVE_INFINITY,
    },
  ];

  const placements: PlacedBox[] = [];
  let totalWeight = 0;
  let totalVolume = 0;
  let idx = 0;
  const maxWeight = request.container.maxWeight;

  const sortSpaces = () => {
    if (mode === "layer-fit") {
      spaces.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
    } else if (mode === "deep-y") {
      spaces.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
    } else {
      spaces.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
    }
  };

  let iterations = 0;
  while (spaces.length > 0 && placements.length < maxVisible) {
    iterations += 1;
    if ((iterations & 31) === 0 && Date.now() > deadlineMs) break;

    sortSpaces();
    const space = spaces.shift()!;
    if (space.L < EPS || space.W < EPS || space.H < EPS) continue;

    let best: BlockCandidate | null = null;
    const spaceVol = space.L * space.W * space.H;

    for (const product of products) {
      const remQty = remaining.get(product.id) ?? 0;
      if (remQty <= 0) continue;
      if (product.bottomOnly && space.z > EPS) continue;
      if (space.allowedSkus !== undefined && !space.allowedSkus.includes(product.sku)) continue;
      if (product.weight > EPS && totalWeight + product.weight > maxWeight + EPS) continue;

      const orients = orientMap.get(product.id) ?? [];
      for (const orient of orients) {
        if (orient.dx > space.L + EPS || orient.dy > space.W + EPS || orient.dz > space.H + EPS) continue;

        const maxNx = Math.floor((space.L + EPS) / orient.dx);
        const maxNy = Math.floor((space.W + EPS) / orient.dy);
        const { nz: maxNz, usesNesting, deltaH } = allowedLayersInSpace(
          product,
          orient,
          space.H,
          space.layerBase,
          maxStackLayersOf,
        );
        if (maxNx <= 0 || maxNy <= 0 || maxNz <= 0) continue;

        // Weight & count caps
        const weightCap = product.weight > EPS
          ? Math.floor((maxWeight - totalWeight + EPS) / product.weight)
          : maxVisible;
        const supportCap = Number.isFinite(space.maxSupportWeightKg) && product.weight > EPS
          ? Math.floor((space.maxSupportWeightKg + EPS) / product.weight)
          : maxVisible;
        const boxVol = orient.dx * orient.dy * (usesNesting ? deltaH : orient.dz);
        const volCap = Number.isFinite(volumeCap) && boxVol > EPS
          ? Math.max(0, Math.floor((volumeCap - totalVolume + EPS) / boxVol))
          : maxVisible;

        const maxCount = Math.min(remQty, weightCap, supportCap, volCap, maxVisible - placements.length);
        if (maxCount <= 0) continue;

        // Choose block dimensions (nx, ny, nz) depending on variant
        let nx = maxNx;
        let ny = maxNy;
        let nz = maxNz;

        if (mode === "wall-x") {
          // Wall-building: prefer shallow X depth (1 or 2 columns deep) to fill full W x H cross-section cleanly
          nx = Math.min(maxNx, Math.max(1, Math.floor(maxCount / Math.max(1, maxNy * maxNz)) || 1));
          if (nx * maxNy * maxNz > maxCount) {
            nx = 1;
            if (maxNy * maxNz > maxCount) {
              ny = Math.min(maxNy, Math.max(1, Math.floor(maxCount / maxNz) || 1));
              nz = Math.min(maxNz, Math.max(1, Math.floor(maxCount / ny) || 1));
            }
          }
        } else if (nx * ny * nz > maxCount) {
          // Shrink along X first to preserve full W x H wall slices
          const perSlice = ny * nz;
          if (maxCount >= perSlice) {
            nx = Math.floor(maxCount / perSlice);
          } else {
            nx = 1;
            if (maxCount >= nz) {
              ny = Math.floor(maxCount / nz);
            } else {
              ny = 1;
              nz = maxCount;
            }
          }
        }

        const count = Math.min(maxCount, nx * ny * nz);
        if (count <= 0) continue;

        const bL = nx * orient.dx;
        const bW = ny * orient.dy;
        const bH = usesNesting ? orient.dz + (nz - 1) * deltaH : nz * orient.dz;
        const filledVol = bL * bW * bH;

        const yFill = bW / space.W;
        const zFill = bH / space.H;
        const xFill = bL / space.L;
        const mustBonus = product.mustLoad ? 1_000_000 : 0;
        const prioBonus = (product.priority ?? 0) * 1000;
        const exactFitBonus =
          (space.W - bW <= 20 ? 0.35 : 0) +
          (space.H - bH <= 20 ? 0.35 : 0) +
          (space.L - bL <= 20 ? 0.2 : 0);

        const densityScore = mode === "wall-x"
          ? yFill * zFill * 100 + exactFitBonus * 25 + (filledVol / Math.max(1, spaceVol)) * 10
          : (filledVol / Math.max(1, spaceVol)) * 100 + yFill * 15 + zFill * 15 + xFill * 5 + exactFitBonus * 20;

        const score = mustBonus + prioBonus + densityScore;
        if (!best || score > best.score) {
          best = { product, orientation: orient, nx, ny, nz, count, usesNesting, deltaH, bL, bW, bH, score };
        }
      }
    }

    if (!best) continue;

    // Emit placed boxes for the winning block
    let emitted = 0;
    for (let ix = 0; ix < best.nx && emitted < best.count; ix += 1) {
      for (let iz = 0; iz < best.nz && emitted < best.count; iz += 1) {
        const zPos = space.z + (best.usesNesting ? iz * best.deltaH : iz * best.orientation.dz);
        for (let iy = 0; iy < best.ny && emitted < best.count; iy += 1) {
          const box = makePlacement(
            best.product,
            idx,
            {
              x: space.x + ix * best.orientation.dx,
              y: space.y + iy * best.orientation.dy,
              z: zPos,
            },
            best.orientation,
            space.layerBase + iz + 1,
          );
          if (best.usesNesting && iz > 0) box.nestedDepth = iz;
          placements.push(box);
          idx += 1;
          emitted += 1;
        }
      }
    }

    remaining.set(best.product.id, (remaining.get(best.product.id) ?? 0) - emitted);
    totalWeight += emitted * best.product.weight;
    const effVol = best.usesNesting
      ? best.nx * best.ny * best.orientation.dx * best.orientation.dy * (best.orientation.dz + (best.nz - 1) * best.deltaH)
      : emitted * best.orientation.dx * best.orientation.dy * best.orientation.dz;
    totalVolume += effVol;

    // Generate disjoint residual guillotine spaces
    const remL = space.L - best.bL;
    const remW = space.W - best.bW;
    const remH = space.H - best.bH;

    // 1. Top space directly above the full-footprint block (only if full top layer was emitted & stackable)
    const fullTopLayer = emitted === best.nx * best.ny * best.nz;
    const blockTopLoad = maxTopLoadForOrientation(best.product, best.orientation);
    const colWeightAbove = Math.max(0, (best.nz - 1) * best.product.weight);
    const remainingColTopLoad = Number.isFinite(blockTopLoad)
      ? Math.max(0, blockTopLoad - colWeightAbove) * best.nx * best.ny
      : Number.POSITIVE_INFINITY;
    const nextSupportWeight = Math.min(
      Number.isFinite(space.maxSupportWeightKg)
        ? Math.max(0, space.maxSupportWeightKg - emitted * best.product.weight)
        : Number.POSITIVE_INFINITY,
      remainingColTopLoad,
    );

    if (
      fullTopLayer &&
      remH > EPS &&
      !best.product.bottomOnly &&
      best.product.stackable !== false &&
      nextSupportWeight > EPS
    ) {
      spaces.push({
        x: space.x,
        y: space.y,
        z: space.z + best.bH,
        L: best.bL,
        W: best.bW,
        H: remH,
        layerBase: space.layerBase + best.nz,
        maxSupportWeightKg: nextSupportWeight,
        allowedSkus: best.product.allowedAboveSkus,
      });
    }

    // 2. Side (Y) and Front (X) residual spaces — pick split maximizing larger contiguous subspace
    if (remL > EPS && remW > EPS) {
      // Split A (X-cut): Front gets full W, Side gets bL
      const splitAMax = Math.max(remL * space.W, best.bL * remW);
      // Split B (Y-cut): Side gets full L, Front gets bW
      const splitBMax = Math.max(space.L * remW, remL * best.bW);
      const preferXCut = mode === "wall-x" || mode === "deep-x" ? splitAMax >= splitBMax * 0.92 : splitAMax >= splitBMax;

      if (preferXCut) {
        spaces.push({
          x: space.x + best.bL,
          y: space.y,
          z: space.z,
          L: remL,
          W: space.W,
          H: space.H,
          layerBase: space.layerBase,
          maxSupportWeightKg: space.maxSupportWeightKg,
        });
        spaces.push({
          x: space.x,
          y: space.y + best.bW,
          z: space.z,
          L: best.bL,
          W: remW,
          H: space.H,
          layerBase: space.layerBase,
          maxSupportWeightKg: space.maxSupportWeightKg,
        });
      } else {
        spaces.push({
          x: space.x,
          y: space.y + best.bW,
          z: space.z,
          L: space.L,
          W: remW,
          H: space.H,
          layerBase: space.layerBase,
          maxSupportWeightKg: space.maxSupportWeightKg,
        });
        spaces.push({
          x: space.x + best.bL,
          y: space.y,
          z: space.z,
          L: remL,
          W: best.bW,
          H: space.H,
          layerBase: space.layerBase,
          maxSupportWeightKg: space.maxSupportWeightKg,
        });
      }
    } else if (remL > EPS) {
      spaces.push({
        x: space.x + best.bL,
        y: space.y,
        z: space.z,
        L: remL,
        W: space.W,
        H: space.H,
        layerBase: space.layerBase,
        maxSupportWeightKg: space.maxSupportWeightKg,
      });
    } else if (remW > EPS) {
      spaces.push({
        x: space.x,
        y: space.y + best.bW,
        z: space.z,
        L: best.bL,
        W: remW,
        H: space.H,
        layerBase: space.layerBase,
        maxSupportWeightKg: space.maxSupportWeightKg,
      });
    }
  }

  return placements;
}

/**
 * High-performance Multi-SKU 3D Homogeneous Block & Wall-Building solver.
 * Evaluates multiple complementary guillotine block & cross-section wall heuristics
 * within a strict time budget and returns the best independently-validated layout.
 */
export function solveMultiSkuBlockPacking(ctx: MultiSkuBlockContext): PlacedBox[] | null {
  const active = ctx.request.products.filter((p) => Math.max(0, Math.floor(p.quantity)) > 0);
  if (active.length < 2) return null;
  if (!active.every(isSimpleBoxProduct)) return null;

  const orientMap = new Map<string, Orientation[]>();
  for (const p of active) {
    const orients = ctx.orientationsOf(p);
    if (orients.length > 0) orientMap.set(p.id, orients);
  }
  if (orientMap.size === 0) return null;

  const budgetMs = ctx.timeBudgetMs ?? 120;
  const deadline = Date.now() + budgetMs;

  const volumeCap = ctx.strategy === "practical"
    ? ctx.container.length * ctx.container.width * ctx.container.height * 0.95
    : Number.POSITIVE_INFINITY;

  // Orderings: volume-desc, base-area-desc, height-desc, qty-desc
  const orderings: ProductInput[][] = [
    [...active].sort((a, b) => (b.mustLoad ? 1 : 0) - (a.mustLoad ? 1 : 0) || b.priority - a.priority || b.length * b.width * b.height - a.length * a.width * a.height),
    [...active].sort((a, b) => (b.mustLoad ? 1 : 0) - (a.mustLoad ? 1 : 0) || b.priority - a.priority || b.length * b.width - a.length * a.width),
    [...active].sort((a, b) => (b.mustLoad ? 1 : 0) - (a.mustLoad ? 1 : 0) || b.priority - a.priority || b.quantity * b.length * b.width * b.height - a.quantity * a.length * a.width * a.height),
  ];

  const modes: Array<"wall-x" | "deep-x" | "deep-y" | "layer-fit"> = ["wall-x", "deep-x", "layer-fit", "deep-y"];

  let bestBoxes: PlacedBox[] | null = null;
  let bestScore = -1;
  let bestVol = -1;

  for (const mode of modes) {
    for (const ordered of orderings) {
      if (Date.now() > deadline) break;
      const candidate = runGuillotineBlockVariant(ctx, ordered, orientMap, mode, volumeCap, deadline);
      if (candidate.length === 0) continue;

      const score = ctx.scorePlan(candidate);
      const vol = candidate.reduce((s, b) => s + b.dx * b.dy * b.dz, 0);
      if (score > bestScore || (score === bestScore && vol > bestVol)) {
        if (ctx.validate(candidate)) {
          bestBoxes = candidate;
          bestScore = score;
          bestVol = vol;
        }
      }
    }
  }

  return bestBoxes;
}
