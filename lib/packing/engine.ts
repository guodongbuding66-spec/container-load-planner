import type {
  ContainerSpec,
  PackingRequest,
  PackingResult,
  PlacedBox,
  ProductInput,
  ProductSummary,
  ReverseCountResult,
  SetLoadSummary,
  ValidationReport,
} from "./types";
import {
  collectSetGroups,
  normalizedSetCode as setCode,
  normalizedUnitsPerSet as unitsPerSet,
  selectProductsForMode,
} from "./set-utils";

export const ENGINE_VERSION = "0.6.1";

type Orientation = {
  dx: number;
  dy: number;
  dz: number;
  label: string;
};

type Point = { x: number; y: number; z: number };

type EffectiveContainer = {
  length: number;
  width: number;
  height: number;
  doorWidth: number;
  doorHeight: number;
};

const EPS = 0.0001;
const MAX_VISIBLE_PLACEMENTS = 20000;

function positive(value: number, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function rotationPolicy(product: ProductInput) {
  if (["fixed", "upright", "any"].includes(product.rotationPolicy)) return product.rotationPolicy;
  return product.allowRotate === false ? "fixed" : "any";
}

function maxStackLayers(product: ProductInput) {
  const value = Math.floor(product.maxStackLayers || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function mustLoad(product: ProductInput) {
  return product.mustLoad !== false;
}

function compareRequired(a: ProductInput, b: ProductInput) {
  return Number(mustLoad(b)) - Number(mustLoad(a));
}

function effectiveContainer(container: ContainerSpec, clearance: number): EffectiveContainer {
  const gap = Math.max(0, clearance);
  return {
    length: Math.max(1, container.length - gap * 2),
    width: Math.max(1, container.width - gap * 2),
    height: Math.max(1, container.height - gap),
    doorWidth: Math.max(1, container.doorWidth - gap * 2),
    doorHeight: Math.max(1, container.doorHeight - gap),
  };
}

function distributeTotal(total: number, weights: number[]) {
  const safeTotal = Math.max(0, Math.floor(total));
  const weightTotal = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (safeTotal === 0 || weightTotal <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => (safeTotal * Math.max(0, weight)) / weightTotal);
  const distributed = raw.map(Math.floor);
  let remaining = safeTotal - distributed.reduce((sum, quantity) => sum + quantity, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < order.length && remaining > 0; index += 1) {
    distributed[order[index].index] += 1;
    remaining -= 1;
  }
  return distributed;
}

export function calculateReverseCounts(
  request: PackingRequest,
  targetVolumeUtilization: number,
  targetWeightUtilization: number,
): ReverseCountResult {
  const activeProducts = selectProductsForMode(request.products, request.mode);
  const singleSetCode = request.mode === "single" && activeProducts[0] ? setCode(activeProducts[0]) : "";
  const sourceQuantities = activeProducts.map((product) =>
    request.mode === "single"
      ? singleSetCode ? unitsPerSet(product) : 1
      : Math.max(1, Math.floor(product.quantity || 0)),
  );
  const sourceTotal = sourceQuantities.reduce((sum, quantity) => sum + quantity, 0);
  const targetVolume = Math.min(1, Math.max(0, targetVolumeUtilization));
  const targetWeight = Math.min(1, Math.max(0, targetWeightUtilization));
  const effective = effectiveContainer(request.container, request.clearance);
  const effectiveVolume = effective.length * effective.width * effective.height;
  const mixVolume = activeProducts.reduce(
    (sum, product, index) => sum + Math.max(0, product.length || 0) * Math.max(0, product.width || 0) * Math.max(0, product.height || 0) * sourceQuantities[index],
    0,
  );
  const mixWeight = activeProducts.reduce(
    (sum, product, index) => sum + Math.max(0, product.weight || 0) * sourceQuantities[index],
    0,
  );
  const averageUnitVolume = sourceTotal > 0 ? mixVolume / sourceTotal : 0;
  const averageUnitWeight = sourceTotal > 0 ? mixWeight / sourceTotal : 0;
  const volumeLimitedTotal = averageUnitVolume > 0 ? Math.max(0, Math.floor((effectiveVolume * targetVolume) / averageUnitVolume)) : 0;
  const weightLimitedTotal = averageUnitWeight > EPS
    ? Math.max(0, Math.floor((Math.max(0, request.container.maxWeight || 0) * targetWeight) / averageUnitWeight))
    : null;
  const unconstrainedRecommendedTotal = weightLimitedTotal === null
    ? volumeLimitedTotal
    : Math.min(volumeLimitedTotal, weightLimitedTotal);
  const suggested = distributeTotal(unconstrainedRecommendedTotal, sourceQuantities);
  for (const group of collectSetGroups(activeProducts).values()) {
    const indexes = group.map((product) => activeProducts.findIndex((item) => item.id === product.id));
    const completeSets = Math.min(
      ...group.map((product, groupIndex) => Math.floor((suggested[indexes[groupIndex]] ?? 0) / unitsPerSet(product))),
    );
    group.forEach((product, groupIndex) => {
      suggested[indexes[groupIndex]] = Math.max(0, completeSets) * unitsPerSet(product);
    });
  }
  const recommendedTotal = suggested.reduce((sum, quantity) => sum + quantity, 0);
  const limitingFactor = weightLimitedTotal === null || volumeLimitedTotal < weightLimitedTotal
    ? "volume"
    : weightLimitedTotal < volumeLimitedTotal
      ? "weight"
      : "equal";

  return {
    targetVolumeUtilization: targetVolume,
    targetWeightUtilization: targetWeight,
    effectiveVolume,
    averageUnitVolume,
    averageUnitWeight,
    volumeLimitedTotal,
    weightLimitedTotal,
    recommendedTotal,
    limitingFactor,
    quantities: activeProducts.map((product, index) => ({
      productId: product.id,
      sku: product.sku,
      sourceQuantity: sourceQuantities[index],
      suggestedQuantity: suggested[index],
    })),
  };
}

function getOrientations(product: ProductInput): Orientation[] {
  const l = positive(product.length);
  const w = positive(product.width);
  const h = positive(product.height);
  const policy = rotationPolicy(product);
  const raw: Orientation[] =
    policy === "any"
      ? [
        { dx: l, dy: w, dz: h, label: "LWH" },
        { dx: l, dy: h, dz: w, label: "LHW" },
        { dx: w, dy: l, dz: h, label: "WLH" },
        { dx: w, dy: h, dz: l, label: "WHL" },
        { dx: h, dy: l, dz: w, label: "HLW" },
        { dx: h, dy: w, dz: l, label: "HWL" },
      ]
      : policy === "upright"
        ? [
            { dx: l, dy: w, dz: h, label: "LWH" },
            { dx: w, dy: l, dz: h, label: "WLH" },
          ]
        : [{ dx: l, dy: w, dz: h, label: "LWH" }];

  const seen = new Set<string>();
  return raw.filter((item) => {
    const key = `${item.dx}:${item.dy}:${item.dz}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canPassDoor(orientation: Orientation, container: EffectiveContainer) {
  return orientation.dy <= container.doorWidth + EPS && orientation.dz <= container.doorHeight + EPS;
}

function overlaps(a: Pick<PlacedBox, "x" | "y" | "z" | "dx" | "dy" | "dz">, b: Pick<PlacedBox, "x" | "y" | "z" | "dx" | "dy" | "dz">) {
  return !(
    a.x + a.dx <= b.x + EPS ||
    b.x + b.dx <= a.x + EPS ||
    a.y + a.dy <= b.y + EPS ||
    b.y + b.dy <= a.y + EPS ||
    a.z + a.dz <= b.z + EPS ||
    b.z + b.dz <= a.z + EPS
  );
}

function isInside(point: Point, box: PlacedBox) {
  return (
    point.x >= box.x - EPS &&
    point.x < box.x + box.dx - EPS &&
    point.y >= box.y - EPS &&
    point.y < box.y + box.dy - EPS &&
    point.z >= box.z - EPS &&
    point.z < box.z + box.dz - EPS
  );
}

class SpatialIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly cellSize: number;

  constructor(container: EffectiveContainer) {
    this.cellSize = Math.max(160, Math.min(container.width, container.height, container.length) / 9);
  }

  private keys(box: Pick<PlacedBox, "x" | "y" | "z" | "dx" | "dy" | "dz">) {
    const x0 = Math.floor(box.x / this.cellSize);
    const y0 = Math.floor(box.y / this.cellSize);
    const z0 = Math.floor(box.z / this.cellSize);
    const x1 = Math.floor(Math.max(box.x, box.x + box.dx - EPS) / this.cellSize);
    const y1 = Math.floor(Math.max(box.y, box.y + box.dy - EPS) / this.cellSize);
    const z1 = Math.floor(Math.max(box.z, box.z + box.dz - EPS) / this.cellSize);
    const result: string[] = [];
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let z = z0; z <= z1; z += 1) result.push(`${x}|${y}|${z}`);
      }
    }
    return result;
  }

  add(box: PlacedBox, index: number) {
    for (const key of this.keys(box)) {
      const list = this.cells.get(key) ?? [];
      list.push(index);
      this.cells.set(key, list);
    }
  }

  query(box: Pick<PlacedBox, "x" | "y" | "z" | "dx" | "dy" | "dz">) {
    const result = new Set<number>();
    for (const key of this.keys(box)) {
      for (const index of this.cells.get(key) ?? []) result.add(index);
    }
    return result;
  }
}

function supportDetails(
  candidate: Pick<PlacedBox, "x" | "y" | "z" | "dx" | "dy" | "dz">,
  topLevels: Map<number, PlacedBox[]>,
  products: Map<string, ProductInput>,
) {
  if (candidate.z <= EPS) return { ratio: 1, layer: 1 };
  const supporters = (topLevels.get(candidate.z) ?? []).filter((box) => products.get(box.productId)?.stackable !== false);
  let supportedArea = 0;
  let layer = 1;
  for (const box of supporters) {
    const ix = Math.max(0, Math.min(candidate.x + candidate.dx, box.x + box.dx) - Math.max(candidate.x, box.x));
    const iy = Math.max(0, Math.min(candidate.y + candidate.dy, box.y + box.dy) - Math.max(candidate.y, box.y));
    const overlap = ix * iy;
    if (overlap > EPS) {
      supportedArea += overlap;
      layer = Math.max(layer, (box.layer || 1) + 1);
    }
  }
  return { ratio: supportedArea / (candidate.dx * candidate.dy), layer };
}

function makePlacement(product: ProductInput, index: number, point: Point, orientation: Orientation, layer = 1): PlacedBox {
  return {
    id: `${product.id}-${index}`,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    color: product.color,
    x: point.x,
    y: point.y,
    z: point.z,
    dx: orientation.dx,
    dy: orientation.dy,
    dz: orientation.dz,
    weight: product.weight,
    orientation: orientation.label,
    layer,
  };
}

function packSingleSet(request: PackingRequest, container: EffectiveContainer, products: ProductInput[]) {
  const cartonsPerSet = products.reduce((sum, product) => sum + unitsPerSet(product), 0);
  const setVolume = products.reduce(
    (sum, product) => sum + product.length * product.width * product.height * unitsPerSet(product),
    0,
  );
  const setWeight = products.reduce((sum, product) => sum + product.weight * unitsPerSet(product), 0);
  const containerVolume = container.length * container.width * container.height;
  const volumeBound = setVolume > 0 ? Math.floor(containerVolume / setVolume) : 0;
  const weightBound = setWeight > EPS ? Math.floor(request.container.maxWeight / setWeight) : volumeBound;
  const visibleBound = cartonsPerSet > 0 ? Math.floor(MAX_VISIBLE_PLACEMENTS / cartonsPerSet) : 0;
  const requestedSets = Math.max(0, Math.min(volumeBound, weightBound, visibleBound));

  if (requestedSets <= 0) {
    return { placements: [] as PlacedBox[], warnings: ["当前柜型无法装入一套完整的多箱产品。"] };
  }

  const candidateRequest: PackingRequest = {
    ...request,
    mode: "mixed",
    products: products.map((product) => ({
      ...product,
      quantity: requestedSets * unitsPerSet(product),
    })),
  };
  const output = packMixed(candidateRequest, container);
  const warnings = [...output.warnings];
  const loadedSets = Math.min(
    ...products.map((product) =>
      Math.floor(output.placements.filter((box) => box.productId === product.id).length / unitsPerSet(product)),
    ),
  );
  if (requestedSets === visibleBound && loadedSets === visibleBound) {
    warnings.push(`可视化已达到 ${MAX_VISIBLE_PLACEMENTS.toLocaleString()} 箱上限；实际最大套数可能更高。`);
  }
  return { placements: output.placements, warnings };
}

function packSingle(request: PackingRequest, container: EffectiveContainer) {
  const product = request.products[0];
  if (!product) return { placements: [] as PlacedBox[], warnings: ["请至少添加一个产品。"] };

  const productSet = setCode(product)
    ? request.products.filter((item) => setCode(item) === setCode(product))
    : [];
  if (productSet.length) return packSingleSet(request, container, productSet);

  let best:
    | { orientation: Orientation; nx: number; ny: number; nz: number; count: number }
    | undefined;
  for (const orientation of getOrientations(product)) {
    if (!canPassDoor(orientation, container)) continue;
    const nx = Math.floor(container.length / orientation.dx);
    const ny = Math.floor(container.width / orientation.dy);
    const physicalLayers = Math.floor(container.height / orientation.dz);
    const configuredLayers = maxStackLayers(product);
    const nz = product.bottomOnly || product.stackable === false
      ? Math.min(1, physicalLayers)
      : configuredLayers > 0
        ? Math.min(physicalLayers, configuredLayers)
        : physicalLayers;
    const geometric = nx * ny * nz;
    const weightBound = product.weight > 0 ? Math.floor(request.container.maxWeight / product.weight) : geometric;
    const count = Math.min(geometric, weightBound);
    if (!best || count > best.count) best = { orientation, nx, ny, nz, count };
  }

  if (!best || best.count <= 0) {
    return { placements: [] as PlacedBox[], warnings: [`${product.sku} 无允许方向可以通过门洞并装入柜内。`] };
  }

  const placements: PlacedBox[] = [];
  const actualCount = Math.min(best.count, MAX_VISIBLE_PLACEMENTS);
  let index = 0;
  for (let z = 0; z < best.nz && index < actualCount; z += 1) {
    for (let y = 0; y < best.ny && index < actualCount; y += 1) {
      for (let x = 0; x < best.nx && index < actualCount; x += 1) {
        placements.push(
          makePlacement(
            product,
            index,
            { x: x * best.orientation.dx, y: y * best.orientation.dy, z: z * best.orientation.dz },
            best.orientation,
            z + 1,
          ),
        );
        index += 1;
      }
    }
  }

  const warnings: string[] = [];
  if (best.count > MAX_VISIBLE_PLACEMENTS) {
    warnings.push(`理论规则排布为 ${best.count.toLocaleString()} 件；当前可视化最多生成 ${MAX_VISIBLE_PLACEMENTS.toLocaleString()} 个箱体。`);
  }
  return { placements, warnings, theoreticalCount: best.count };
}

type SortStrategy = (a: ProductInput, b: ProductInput) => number;

const strategies: SortStrategy[] = [
  (a, b) => compareRequired(a, b) || b.priority - a.priority || b.length * b.width * b.height - a.length * a.width * a.height,
  (a, b) => compareRequired(a, b) || b.priority - a.priority || b.length * b.width - a.length * a.width,
  (a, b) => compareRequired(a, b) || b.priority - a.priority || Math.max(b.length, b.width, b.height) - Math.max(a.length, a.width, a.height),
];

type ItemBatch = {
  items: ProductInput[];
  setCode?: string;
  setNumber?: number;
};

function buildItemBatches(request: PackingRequest, sort: SortStrategy) {
  const batches: ItemBatch[] = [];
  const groupedIds = new Set<string>();
  let itemCount = 0;

  for (const [code, products] of collectSetGroups(request.products)) {
    const sortedProducts = [...products].sort(sort);
    sortedProducts.forEach((product) => groupedIds.add(product.id));
    const requestedSets = Math.min(
      ...sortedProducts.map((product) => Math.floor(Math.max(0, product.quantity) / unitsPerSet(product))),
    );
    const bundle = sortedProducts.flatMap((product) =>
      Array.from({ length: unitsPerSet(product) }, () => product),
    );
    for (let index = 0; index < requestedSets && itemCount + bundle.length <= MAX_VISIBLE_PLACEMENTS; index += 1) {
      batches.push({ items: [...bundle], setCode: code, setNumber: index + 1 });
      itemCount += bundle.length;
    }
  }

  for (const product of [...request.products].sort(sort)) {
    if (groupedIds.has(product.id)) continue;
    const quantity = Math.min(MAX_VISIBLE_PLACEMENTS - itemCount, Math.max(0, Math.floor(product.quantity)));
    for (let index = 0; index < quantity; index += 1) batches.push({ items: [product] });
    itemCount += quantity;
    if (itemCount >= MAX_VISIBLE_PLACEMENTS) break;
  }

  return batches.sort((a, b) => sort(a.items[0], b.items[0]));
}

function packMixedWithStrategy(request: PackingRequest, container: EffectiveContainer, sort: SortStrategy) {
  const batches = buildItemBatches(request, sort);
  const placements: PlacedBox[] = [];
  let spatial = new SpatialIndex(container);
  let topLevels = new Map<number, PlacedBox[]>();
  const productMap = new Map(request.products.map((product) => [product.id, product]));
  let points: Point[] = [{ x: 0, y: 0, z: 0 }];
  let totalWeight = 0;
  let placementIndex = 0;
  const blockedSetCodes = new Set<string>();

  const rebuildIndexes = () => {
    spatial = new SpatialIndex(container);
    topLevels = new Map<number, PlacedBox[]>();
    placements.forEach((box, index) => {
      spatial.add(box, index);
      const top = box.z + box.dz;
      topLevels.set(top, [...(topLevels.get(top) ?? []), box]);
    });
  };

  const placeProduct = (product: ProductInput) => {
    if (totalWeight + product.weight > request.container.maxWeight + EPS) return false;
    const orientations = getOrientations(product).filter((orientation) => canPassDoor(orientation, container));
    if (orientations.length === 0) return false;

    let best: { point: Point; orientation: Orientation; layer: number; score: number } | undefined;
    const candidatePoints = points.slice(0, 1500);
    for (const point of candidatePoints) {
      for (const orientation of orientations) {
        const candidate = makePlacement(product, placementIndex, point, orientation);
        if (
          candidate.x + candidate.dx > container.length + EPS ||
          candidate.y + candidate.dy > container.width + EPS ||
          candidate.z + candidate.dz > container.height + EPS ||
          (product.bottomOnly === true && candidate.z > EPS)
        ) {
          continue;
        }
        let collides = false;
        for (const index of spatial.query(candidate)) {
          if (overlaps(candidate, placements[index])) {
            collides = true;
            break;
          }
        }
        if (collides) continue;
        const support = supportDetails(candidate, topLevels, productMap);
        const layerLimit = maxStackLayers(product);
        if (support.ratio < 0.68 || (layerLimit > 0 && support.layer > layerLimit)) continue;
        const topPenalty = candidate.z * 1_000_000_000;
        const sidePenalty = candidate.y * 1_000_000 + candidate.x * 100;
        const compactness = candidate.x + candidate.dx + candidate.y + candidate.dy + candidate.z + candidate.dz;
        const score = topPenalty + sidePenalty + compactness;
        if (!best || score < best.score) best = { point, orientation, layer: support.layer, score };
      }
    }

    if (!best) return false;
    const placed = makePlacement(product, placementIndex, best.point, best.orientation, best.layer);
    placements.push(placed);
    spatial.add(placed, placements.length - 1);
    totalWeight += product.weight;
    placementIndex += 1;
    const top = placed.z + placed.dz;
    topLevels.set(top, [...(topLevels.get(top) ?? []), placed]);

    const additions: Point[] = [
      { x: placed.x + placed.dx, y: placed.y, z: placed.z },
      { x: placed.x, y: placed.y + placed.dy, z: placed.z },
      { x: placed.x, y: placed.y, z: placed.z + placed.dz },
    ];
    const next = [...points.filter((point) => !isInside(point, placed)), ...additions].filter(
      (point) => point.x < container.length - EPS && point.y < container.width - EPS && point.z < container.height - EPS,
    );
    const seen = new Set<string>();
    points = next
      .filter((point) => {
        const key = `${point.x.toFixed(3)}|${point.y.toFixed(3)}|${point.z.toFixed(3)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
      .slice(0, 1800);
    return true;
  };

  for (const batch of batches) {
    if (batch.setCode && blockedSetCodes.has(batch.setCode)) continue;
    if (!batch.setCode) {
      placeProduct(batch.items[0]);
      continue;
    }

    const placementCountBefore = placements.length;
    const pointsBefore = [...points];
    const totalWeightBefore = totalWeight;
    const placementIndexBefore = placementIndex;
    const complete = batch.items.every((product) => placeProduct(product));
    if (complete) {
      placements.slice(placementCountBefore).forEach((box, itemIndex) => {
        box.setCode = batch.setCode;
        box.setNumber = batch.setNumber;
        box.setItemNumber = itemIndex + 1;
      });
      continue;
    }

    placements.splice(placementCountBefore);
    points = pointsBefore;
    totalWeight = totalWeightBefore;
    placementIndex = placementIndexBefore;
    rebuildIndexes();
    blockedSetCodes.add(batch.setCode);
  }
  return placements;
}

function weightedScore(placements: PlacedBox[], products: ProductInput[]) {
  const priority = new Map(products.map((product) => [product.id, product.priority]));
  const required = new Map(products.map((product) => [product.id, mustLoad(product)]));
  const loadedByProduct = new Map<string, number>();
  for (const box of placements) loadedByProduct.set(box.productId, (loadedByProduct.get(box.productId) ?? 0) + 1);
  const completeSetBonus = [...collectSetGroups(products).values()].reduce((sum, group) => {
    const loadedSets = Math.min(
      ...group.map((product) => Math.floor((loadedByProduct.get(product.id) ?? 0) / unitsPerSet(product))),
    );
    return sum + Math.max(0, loadedSets) * 5000;
  }, 0);
  return completeSetBonus + placements.reduce(
    (sum, box) => sum + 1 + (priority.get(box.productId) ?? 0) / 100 + (required.get(box.productId) ? 1000 : 0),
    0,
  );
}

function packMixed(request: PackingRequest, container: EffectiveContainer) {
  const requested = request.products.reduce((sum, item) => sum + Math.max(0, Math.floor(item.quantity)), 0);
  const activeStrategies = requested > 400 ? strategies.slice(0, 1) : strategies;
  let best: PlacedBox[] = [];
  let bestScore = -1;
  for (const strategy of activeStrategies) {
    const placements = packMixedWithStrategy(request, container, strategy);
    const score = weightedScore(placements, request.products);
    if (score > bestScore) {
      best = placements;
      bestScore = score;
    }
  }
  const warnings = requested > MAX_VISIBLE_PLACEMENTS
    ? [`订单共 ${requested.toLocaleString()} 件；为保证浏览器稳定，当前单次方案最多生成 ${MAX_VISIBLE_PLACEMENTS.toLocaleString()} 个真实箱体坐标。`]
    : [];
  return { placements: best, warnings };
}

function calculateCenterOfGravity(placements: PlacedBox[], container: EffectiveContainer) {
  let totalMass = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightedZ = 0;
  for (const box of placements) {
    const mass = box.weight > 0 ? box.weight : (box.dx * box.dy * box.dz) / 1_000_000_000;
    totalMass += mass;
    weightedX += (box.x + box.dx / 2) * mass;
    weightedY += (box.y + box.dy / 2) * mass;
    weightedZ += (box.z + box.dz / 2) * mass;
  }
  const x = totalMass > 0 ? weightedX / totalMass : 0;
  const y = totalMass > 0 ? weightedY / totalMass : 0;
  const z = totalMass > 0 ? weightedZ / totalMass : 0;
  const longitudinalRatio = container.length > 0 ? x / container.length : 0;
  const lateralRatio = container.width > 0 ? y / container.width : 0;
  const heightRatio = container.height > 0 ? z / container.height : 0;
  return {
    x,
    y,
    z,
    longitudinalRatio,
    lateralRatio,
    heightRatio,
    balanced: totalMass > 0 && longitudinalRatio >= 0.4 && longitudinalRatio <= 0.6 && lateralRatio >= 0.4 && lateralRatio <= 0.6,
  };
}

export function validatePacking(
  placements: PlacedBox[],
  container: ContainerSpec,
  clearance: number,
  products: ProductInput[] = [],
): ValidationReport {
  const effective = effectiveContainer(container, clearance);
  const errors: string[] = [];
  const spatial = new SpatialIndex(effective);
  const topLevels = new Map<number, PlacedBox[]>();
  const productMap = new Map(products.map((product) => [product.id, product]));
  let totalWeight = 0;
  for (let index = 0; index < placements.length; index += 1) {
    const box = placements[index];
    const product = productMap.get(box.productId);
    if (
      box.x < -EPS ||
      box.y < -EPS ||
      box.z < -EPS ||
      box.x + box.dx > effective.length + EPS ||
      box.y + box.dy > effective.width + EPS ||
      box.z + box.dz > effective.height + EPS
    ) {
      errors.push(`${box.sku} 的箱体 ${index + 1} 超出有效柜内边界。`);
    }
    for (const otherIndex of spatial.query(box)) {
      if (overlaps(box, placements[otherIndex])) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 与箱体 ${otherIndex + 1} 重叠。`);
        break;
      }
    }
    if (product) {
      const allowedOrientation = getOrientations(product).some(
        (orientation) =>
          Math.abs(orientation.dx - box.dx) <= EPS &&
          Math.abs(orientation.dy - box.dy) <= EPS &&
          Math.abs(orientation.dz - box.dz) <= EPS,
      );
      if (!allowedOrientation) errors.push(`${box.sku} 的箱体 ${index + 1} 使用了未允许的摆放方向。`);
      if (product.bottomOnly === true && box.z > EPS) errors.push(`${box.sku} 的箱体 ${index + 1} 未按“必须底置”规则放在柜底。`);
      if (!canPassDoor({ dx: box.dx, dy: box.dy, dz: box.dz, label: box.orientation }, effective)) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 无法按当前方向通过门洞。`);
      }
    }
    const support = supportDetails(box, topLevels, productMap);
    if (box.z > EPS && support.ratio < 0.68) errors.push(`${box.sku} 的箱体 ${index + 1} 底面支撑不足 68%。`);
    const layerLimit = product ? maxStackLayers(product) : 0;
    if (layerLimit > 0 && support.layer > layerLimit) {
      errors.push(`${box.sku} 的箱体 ${index + 1} 超过允许的第 ${layerLimit} 层。`);
    }
    spatial.add(box, index);
    const top = box.z + box.dz;
    topLevels.set(top, [...(topLevels.get(top) ?? []), box]);
    totalWeight += box.weight;
    if (errors.length >= 20) break;
  }
  if (totalWeight > container.maxWeight + EPS) errors.push("已装总重超过集装箱最大载重。 ");
  if (products.length) {
    const loadedByProduct = new Map<string, number>();
    for (const box of placements) loadedByProduct.set(box.productId, (loadedByProduct.get(box.productId) ?? 0) + 1);
    for (const [code, group] of collectSetGroups(products)) {
      const setCounts = group.map((product) => (loadedByProduct.get(product.id) ?? 0) / unitsPerSet(product));
      const first = setCounts[0] ?? 0;
      if (setCounts.some((count) => !Number.isInteger(count) || Math.abs(count - first) > EPS)) {
        errors.push(`套装 ${code} 的组成箱数量不完整，不能按完整套数交付。`);
      }
      const setPlacements = placements.filter((box) => box.setCode === code);
      if (setPlacements.length) {
        const cartonsPerSet = group.reduce((sum, product) => sum + unitsPerSet(product), 0);
        const bySetNumber = new Map<number, PlacedBox[]>();
        for (const box of setPlacements) {
          if (!box.setNumber || !box.setItemNumber) {
            errors.push(`套装 ${code} 存在缺少套号或套内序号的箱体。`);
            continue;
          }
          bySetNumber.set(box.setNumber, [...(bySetNumber.get(box.setNumber) ?? []), box]);
        }
        for (const [number, boxes] of bySetNumber) {
          const itemNumbers = boxes.map((box) => box.setItemNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
          const expected = Array.from({ length: cartonsPerSet }, (_, index) => index + 1);
          if (boxes.length !== cartonsPerSet || itemNumbers.some((item, index) => item !== expected[index])) {
            errors.push(`套装 ${code} 第 ${number} 套的套内追踪序号不完整。`);
          }
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function buildSummaries(request: PackingRequest, placements: PlacedBox[], theoreticalCount?: number): ProductSummary[] {
  const loadedByProduct = new Map<string, number>();
  for (const box of placements) loadedByProduct.set(box.productId, (loadedByProduct.get(box.productId) ?? 0) + 1);
  return request.products.map((product, index) => {
    const loaded = index === 0 && request.mode === "single" && theoreticalCount ? theoreticalCount : loadedByProduct.get(product.id) ?? 0;
    const requested = request.mode === "single" ? loaded : Math.max(0, Math.floor(product.quantity));
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      color: product.color,
      requested,
      loaded,
      unloaded: Math.max(0, requested - loaded),
      loadedWeight: loaded * product.weight,
      loadedVolume: loaded * product.length * product.width * product.height,
    };
  });
}

function buildSetSummaries(request: PackingRequest, summaries: ProductSummary[]): SetLoadSummary[] {
  const summaryByProduct = new Map(summaries.map((summary) => [summary.productId, summary]));
  return [...collectSetGroups(request.products)].map(([code, group]) => {
    const items = group.map((product) => {
      const summary = summaryByProduct.get(product.id);
      return {
        productId: product.id,
        sku: product.sku,
        unitsPerSet: unitsPerSet(product),
        requestedQuantity: summary?.requested ?? 0,
        loadedQuantity: summary?.loaded ?? 0,
      };
    });
    const requestedSetCounts = items.map((item) => Math.floor(item.requestedQuantity / item.unitsPerSet));
    const loadedSetCounts = items.map((item) => Math.floor(item.loadedQuantity / item.unitsPerSet));
    const requestedSets = Math.max(0, Math.min(...requestedSetCounts));
    const loadedSets = Math.max(0, Math.min(...loadedSetCounts));
    return {
      setCode: code,
      componentCount: items.length,
      cartonsPerSet: items.reduce((sum, item) => sum + item.unitsPerSet, 0),
      requestedCartons: items.reduce((sum, item) => sum + item.requestedQuantity, 0),
      loadedCartons: items.reduce((sum, item) => sum + item.loadedQuantity, 0),
      requestedSets,
      loadedSets,
      unloadedSets: Math.max(0, requestedSets - loadedSets),
      requestQuantitiesAligned: requestedSetCounts.every((count) => count === requestedSetCounts[0]) &&
        items.every((item) => item.requestedQuantity % item.unitsPerSet === 0),
      items,
    };
  });
}

export function pack(request: PackingRequest): PackingResult {
  const started = performance.now();
  const normalizedProducts = request.products.map((product) => ({
    ...product,
    length: positive(product.length),
    width: positive(product.width),
    height: positive(product.height),
    weight: positive(product.weight, 0),
    quantity: Math.max(0, Math.floor(product.quantity || 0)),
    priority: Number.isFinite(product.priority) ? product.priority : 0,
    rotationPolicy: rotationPolicy(product),
    stackable: product.stackable !== false,
    maxStackLayers: maxStackLayers(product),
    mustLoad: mustLoad(product),
    bottomOnly: product.bottomOnly === true,
    setCode: setCode(product),
    unitsPerSet: unitsPerSet(product),
    declaredVolumeCbm: Math.max(0, product.declaredVolumeCbm || 0),
  }));
  const normalized: PackingRequest = {
    ...request,
    clearance: Math.max(0, request.clearance || 0),
    container: {
      ...request.container,
      length: positive(request.container.length),
      width: positive(request.container.width),
      height: positive(request.container.height),
      doorWidth: positive(request.container.doorWidth),
      doorHeight: positive(request.container.doorHeight),
      maxWeight: positive(request.container.maxWeight),
    },
    products: selectProductsForMode(normalizedProducts, request.mode),
  };
  const effective = effectiveContainer(normalized.container, normalized.clearance);
  const output = normalized.mode === "single" ? packSingle(normalized, effective) : packMixed(normalized, effective);
  const validation = validatePacking(output.placements, normalized.container, normalized.clearance, normalized.products);
  const theoreticalCount =
    "theoreticalCount" in output && typeof output.theoreticalCount === "number" ? output.theoreticalCount : undefined;
  const summaries = buildSummaries(normalized, output.placements, theoreticalCount);
  const setSummaries = buildSetSummaries(normalized, summaries);
  const loadedVolume = summaries.reduce((sum, item) => sum + item.loadedVolume, 0);
  const grossWeight = summaries.reduce((sum, item) => sum + item.loadedWeight, 0);
  const effectiveVolume = effective.length * effective.width * effective.height;
  const requestedCount = summaries.reduce((sum, item) => sum + item.requested, 0);
  const loadedCount = summaries.reduce((sum, item) => sum + item.loaded, 0);
  const centerOfGravity = calculateCenterOfGravity(output.placements, effective);
  const warnings = [...output.warnings];

  for (const product of normalized.products) {
    if (!getOrientations(product).some((orientation) => canPassDoor(orientation, effective))) {
      warnings.push(`${product.sku} 没有可通过门洞的允许方向。`);
    }
  }
  if (normalized.mode === "mixed" && loadedCount < requestedCount) {
    warnings.push(`订单仍有 ${(requestedCount - loadedCount).toLocaleString()} 件未装入，请查看 SKU 明细。`);
  }
  for (const summary of summaries) {
    const product = normalized.products.find((item) => item.id === summary.productId);
    if (product && mustLoad(product) && summary.unloaded > 0) {
      warnings.push(`必装货物 ${summary.sku} 仍有 ${summary.unloaded.toLocaleString()} 件未装入。`);
    }
  }
  for (const setSummary of setSummaries) {
    if (!setSummary.requestQuantitiesAligned) {
      warnings.push(`套装 ${setSummary.setCode} 的需求数量比例不一致，已按可组成的 ${setSummary.requestedSets.toLocaleString()} 套执行，零散箱不拆套装入。`);
    }
    if (setSummary.unloadedSets > 0) {
      warnings.push(`套装 ${setSummary.setCode} 已装 ${setSummary.loadedSets.toLocaleString()} / ${setSummary.requestedSets.toLocaleString()} 套，未装 ${setSummary.unloadedSets.toLocaleString()} 套。`);
    }
  }
  for (const product of normalized.products) {
    if (!product.declaredVolumeCbm) continue;
    const calculated = (product.length * product.width * product.height) / 1_000_000_000;
    const difference = Math.abs(product.declaredVolumeCbm - calculated) / Math.max(calculated, EPS);
    if (difference > 0.07) {
      warnings.push(`${product.sku} 标称 ${product.declaredVolumeCbm.toFixed(3)} CBM，与尺寸换算 ${calculated.toFixed(3)} CBM 相差 ${(difference * 100).toFixed(1)}%，几何装载仍以外箱尺寸为准。`);
    }
  }
  if (loadedCount > 0 && !centerOfGravity.balanced) {
    warnings.push(
      `当前重心位于柜长 ${(centerOfGravity.longitudinalRatio * 100).toFixed(1)}%、柜宽 ${(centerOfGravity.lateralRatio * 100).toFixed(1)}%，建议结合现场装载顺序复核配重。`,
    );
  }

  return {
    id: `plan-${Date.now()}`,
    mode: normalized.mode,
    engineVersion: ENGINE_VERSION,
    container: normalized.container,
    clearance: normalized.clearance,
    placements: output.placements,
    summaries,
    setSummaries,
    metrics: {
      loadedCount,
      requestedCount,
      grossWeight,
      loadedVolume,
      effectiveVolume,
      volumeUtilization: effectiveVolume > 0 ? loadedVolume / effectiveVolume : 0,
      weightUtilization: normalized.container.maxWeight > 0 ? grossWeight / normalized.container.maxWeight : 0,
      centerOfGravity,
      solveTimeMs: performance.now() - started,
    },
    validation,
    warnings,
    createdAt: new Date().toISOString(),
  };
}
