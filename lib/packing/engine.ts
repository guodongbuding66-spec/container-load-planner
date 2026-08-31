import type {
  ContainerSpec,
  PackingRequest,
  PackingResult,
  PackingStrategy,
  PlacedBox,
  ProductInput,
  ProductSummary,
  ReverseCountResult,
  SetLoadSummary,
  StrategyComparison,
  ValidationReport,
} from "./types";
import {
  collectSetGroups,
  normalizedSetCode as setCode,
  normalizedUnitsPerSet as unitsPerSet,
  selectProductsForMode,
} from "./set-utils";
import { estimateQuoteLoading } from "./quote-estimator";
import { roundedCartonVolumeCbm } from "./volume";

export const ENGINE_VERSION = "0.11.2";

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
export const DEFAULT_PRACTICAL_TARGET = 0.845;
export const PRACTICAL_TARGET_BY_CONTAINER: Readonly<Record<string, number>> = {
  "20gp": 0.805,
  "40gp": 0.845,
  "40hq": 0.88,
};
const PRACTICAL_SUPPORT_RATIO = 0.995;

export function recommendedPracticalTarget(container: Pick<ContainerSpec, "id">) {
  return PRACTICAL_TARGET_BY_CONTAINER[container.id.toLowerCase()] ?? DEFAULT_PRACTICAL_TARGET;
}

function packingStrategy(request: PackingRequest): PackingStrategy {
  return request.strategy === "practical" ? "practical" : "maximum";
}

function practicalTarget(request: PackingRequest) {
  return request.practicalTargetUtilization ?? recommendedPracticalTarget(request.container);
}

function assertValidRequest(request: PackingRequest) {
  if (request.strategy !== undefined && request.strategy !== "practical" && request.strategy !== "maximum") {
    throw new Error("装柜策略必须是现场易执行或极限利用率。");
  }
  if (
    request.practicalTargetUtilization !== undefined &&
    (!Number.isFinite(request.practicalTargetUtilization) || request.practicalTargetUtilization < 0.5 || request.practicalTargetUtilization > 0.95)
  ) {
    throw new Error("现场经验装载率必须在 50%–95% 之间。");
  }
  if (
    request.singleCartonLimit !== undefined &&
    (!Number.isFinite(request.singleCartonLimit) || request.singleCartonLimit <= 0)
  ) {
    throw new Error("单品计划箱数上限必须是大于 0 的有限数值。");
  }
  const containerValues = [
    request.container.length,
    request.container.width,
    request.container.height,
    request.container.doorWidth,
    request.container.doorHeight,
    request.container.maxWeight,
  ];
  if (!containerValues.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("柜型尺寸、门洞和载重必须是大于 0 的有限数字。");
  }
  if (!Number.isFinite(request.clearance) || request.clearance < 0) {
    throw new Error("安全间隙必须是大于或等于 0 的有限数字。");
  }
  if (
    request.clearance * 2 >= request.container.length ||
    request.clearance * 2 >= request.container.width ||
    request.clearance >= request.container.height ||
    request.clearance * 2 >= request.container.doorWidth ||
    request.clearance >= request.container.doorHeight
  ) {
    throw new Error("安全间隙过大，已占满柜内空间或门洞。");
  }
  if (!Array.isArray(request.products) || request.products.length === 0) {
    throw new Error("请至少添加一个产品。");
  }

  const productIds = new Set<string>();
  for (const product of request.products) {
    if (!product.id || productIds.has(product.id)) throw new Error("产品 ID 不能为空或重复。");
    productIds.add(product.id);
    if (!product.sku?.trim()) throw new Error("产品 SKU 不能为空。");
    if (![product.length, product.width, product.height].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`${product.sku} 的外箱尺寸必须是大于 0 的有限数字。`);
    }
    if (!Number.isFinite(product.weight) || product.weight < 0) throw new Error(`${product.sku} 的重量不能为负数。`);
    if (!Number.isInteger(product.quantity) || product.quantity < 0) throw new Error(`${product.sku} 的数量必须是非负整数。`);
    if (!Number.isInteger(product.priority) || product.priority < 0 || product.priority > 100) throw new Error(`${product.sku} 的优先级必须是 0–100 的整数。`);
    if (!Number.isInteger(product.maxStackLayers) || product.maxStackLayers < 0 || product.maxStackLayers > 99) throw new Error(`${product.sku} 的层数上限必须是 0–99 的整数。`);
    if (setCode(product) && (!Number.isInteger(product.unitsPerSet) || (product.unitsPerSet ?? 0) < 1 || (product.unitsPerSet ?? 0) > 99)) {
      throw new Error(`${product.sku} 的套内数量必须是 1–99 的整数。`);
    }
  }
}

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
  const displayAsSets = Boolean(singleSetCode && sourceTotal > 0);
  const cartonsPerSet = displayAsSets ? sourceTotal : 1;
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
    displayUnit: displayAsSets ? "set" : "carton",
    cartonsPerSet,
    volumeLimitedDisplay: Math.floor(volumeLimitedTotal / cartonsPerSet),
    weightLimitedDisplay: weightLimitedTotal === null ? null : Math.floor(weightLimitedTotal / cartonsPerSet),
    recommendedDisplay: Math.floor(recommendedTotal / cartonsPerSet),
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

/**
 * A field plan may turn a carton 90 degrees on the floor, but never tips it
 * onto a side. `any` remains meaningful for the theoretical solver while the
 * worker solver deliberately keeps the factory-designated carton height.
 */
function getPracticalOrientations(product: ProductInput): Orientation[] {
  const l = positive(product.length);
  const w = positive(product.width);
  const h = positive(product.height);
  const raw = rotationPolicy(product) === "fixed"
    ? [{ dx: l, dy: w, dz: h, label: "LWH" }]
    : [
        { dx: l, dy: w, dz: h, label: "LWH" },
        { dx: w, dy: l, dz: h, label: "WLH" },
      ];
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
  return { ratio: Math.min(1, supportedArea / (candidate.dx * candidate.dy)), layer };
}

function preferredPracticalOrientation(product: ProductInput, container: EffectiveContainer) {
  let best: { orientation: Orientation; count: number } | undefined;
  for (const orientation of getPracticalOrientations(product)) {
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
    const count = nx * ny * nz;
    if (!best || count > best.count) best = { orientation, count };
  }
  return best?.orientation;
}

function orientationsForStrategy(product: ProductInput, container: EffectiveContainer, strategy: PackingStrategy) {
  if (strategy === "maximum") return getOrientations(product).filter((orientation) => canPassDoor(orientation, container));
  return getPracticalOrientations(product).filter((orientation) => canPassDoor(orientation, container));
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

type ZoneSlabOption = {
  orientation: Orientation;
  length: number;
  across: number;
  layers: number;
  capacity: number;
};

type ZoneSlabPlan = {
  option: ZoneSlabOption;
  quantity: number;
};

function zoneSlabOptions(
  product: ProductInput,
  container: EffectiveContainer,
  strategy: PackingStrategy,
) {
  const orientations = strategy === "practical" ? getPracticalOrientations(product) : getOrientations(product);
  return orientations.flatMap((orientation): ZoneSlabOption[] => {
    if (!canPassDoor(orientation, container)) return [];
    const across = Math.floor(container.width / orientation.dy);
    const physicalLayers = Math.floor(container.height / orientation.dz);
    const configuredLayers = maxStackLayers(product);
    const layers = product.bottomOnly || product.stackable === false
      ? Math.min(1, physicalLayers)
      : configuredLayers > 0
        ? Math.min(physicalLayers, configuredLayers)
        : physicalLayers;
    const capacity = across * layers;
    return capacity > 0 && orientation.dx <= container.length + EPS
      ? [{ orientation, length: orientation.dx, across, layers, capacity }]
      : [];
  });
}

/**
 * Unbounded dynamic programming over longitudinal slabs. Unlike the practical
 * fixed-grid solver, the theoretical solver may change orientation between
 * slabs and choose the shortest combination that carries the requested count.
 */
function minimumSlabPlan(
  product: ProductInput,
  container: EffectiveContainer,
  quantity: number,
  strategy: PackingStrategy,
): ZoneSlabPlan[] | null {
  if (quantity <= 0) return [];
  const options = zoneSlabOptions(product, container, strategy);
  if (!options.length) return null;

  const distance = new Float64Array(quantity + 1);
  distance.fill(Number.POSITIVE_INFINITY);
  distance[0] = 0;
  const previousQuantity = new Int32Array(quantity + 1);
  const previousOption = new Int16Array(quantity + 1);
  previousQuantity.fill(-1);
  previousOption.fill(-1);

  for (let loaded = 0; loaded < quantity; loaded += 1) {
    if (!Number.isFinite(distance[loaded])) continue;
    for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      const option = options[optionIndex];
      const next = Math.min(quantity, loaded + option.capacity);
      const candidateLength = distance[loaded] + option.length;
      const currentOption = previousOption[next] >= 0 ? options[previousOption[next]] : undefined;
      const winsTie = Math.abs(candidateLength - distance[next]) <= EPS && (
        !currentOption ||
        option.capacity > currentOption.capacity ||
        (option.capacity === currentOption.capacity && option.orientation.label < currentOption.orientation.label)
      );
      if (candidateLength < distance[next] - EPS || winsTie) {
        distance[next] = candidateLength;
        previousQuantity[next] = loaded;
        previousOption[next] = optionIndex;
      }
    }
  }
  if (!Number.isFinite(distance[quantity])) return null;

  const reversed: ZoneSlabOption[] = [];
  let cursor = quantity;
  while (cursor > 0) {
    const optionIndex = previousOption[cursor];
    const previous = previousQuantity[cursor];
    if (optionIndex < 0 || previous < 0 || previous >= cursor) return null;
    reversed.push(options[optionIndex]);
    cursor = previous;
  }
  reversed.reverse();

  let remaining = quantity;
  return reversed.map((option) => {
    const placed = Math.min(option.capacity, remaining);
    remaining -= placed;
    return { option, quantity: placed };
  });
}

function slabPlanLength(plan: ZoneSlabPlan[] | null) {
  return plan ? plan.reduce((sum, slab) => sum + slab.option.length, 0) : Number.POSITIVE_INFINITY;
}

function maximumMultiplierBySlabDp(
  products: ProductInput[],
  container: EffectiveContainer,
  upperBound: number,
  strategy: PackingStrategy,
) {
  let low = 0;
  let high = Math.max(0, Math.floor(upperBound));
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    const requiredLength = products.reduce((sum, product) => {
      const plan = minimumSlabPlan(product, container, candidate * unitsPerSet(product), strategy);
      return sum + slabPlanLength(plan);
    }, 0);
    if (requiredLength <= container.length + EPS) low = candidate;
    else high = candidate - 1;
  }
  return low;
}

function buildSlabZonedPlan(
  request: PackingRequest,
  container: EffectiveContainer,
  products: ProductInput[],
  multiplier: number,
  strategy: PackingStrategy,
) {
  if (multiplier <= 0) return null;
  const zones = products.map((product) => ({
    product,
    plan: minimumSlabPlan(product, container, multiplier * unitsPerSet(product), strategy),
  }));
  if (zones.some((zone) => !zone.plan)) return null;
  zones.sort((a, b) => slabPlanLength(b.plan) - slabPlanLength(a.plan) || a.product.sku.localeCompare(b.product.sku));
  if (zones.reduce((sum, zone) => sum + slabPlanLength(zone.plan), 0) > container.length + EPS) return null;

  const placements: PlacedBox[] = [];
  let xOffset = 0;
  for (const zone of zones) {
    for (const slab of zone.plan!) {
      let remaining = slab.quantity;
      for (let layer = 0; layer < slab.option.layers && remaining > 0; layer += 1) {
        for (let across = 0; across < slab.option.across && remaining > 0; across += 1) {
          placements.push(makePlacement(
            zone.product,
            placements.length,
            {
              x: xOffset,
              y: across * slab.option.orientation.dy,
              z: layer * slab.option.orientation.dz,
            },
            slab.option.orientation,
            layer + 1,
          ));
          remaining -= 1;
        }
      }
      if (remaining > 0) return null;
      xOffset += slab.option.length;
    }
  }

  if (products.some((product) => setCode(product))) assignSetTrace(placements, products);
  const ordered = orderForPracticalLoading(placements);
  return validatePacking(ordered, request.container, request.clearance, products, strategy).valid ? ordered : null;
}

type LayerPattern = {
  product: ProductInput;
  orientation: Orientation;
  nx: number;
  ny: number;
  capacity: number;
  coverageLength: number;
  coverageWidth: number;
  fullLayers: number;
  remainder: number;
};

function overlapArea2d(a: PlacedBox, b: PlacedBox) {
  const ix = Math.max(0, Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y));
  return ix * iy;
}

/**
 * Turns a geometrically layered plan into an executable order. A box is made
 * available only after every supporting carton directly below it has been
 * loaded; among available boxes, the nose-most one is chosen first.
 */
function orderForPracticalLoading(placements: PlacedBox[]) {
  const dependents = placements.map(() => [] as number[]);
  const remainingDependencies = placements.map(() => 0);
  const supportingLevels = new Map<number, number[]>();

  placements.forEach((box, index) => {
    const topKey = Math.round((box.z + box.dz) / EPS);
    const level = supportingLevels.get(topKey);
    if (level) level.push(index);
    else supportingLevels.set(topKey, [index]);
  });

  for (let upperIndex = 0; upperIndex < placements.length; upperIndex += 1) {
    const upper = placements[upperIndex];
    if (upper.z <= EPS) continue;
    const lowerCandidates = supportingLevels.get(Math.round(upper.z / EPS)) ?? [];
    for (const lowerIndex of lowerCandidates) {
      const lower = placements[lowerIndex];
      if (overlapArea2d(upper, lower) <= EPS) continue;
      dependents[lowerIndex].push(upperIndex);
      remainingDependencies[upperIndex] += 1;
    }
  }

  const ordered: PlacedBox[] = [];
  const compare = (a: number, b: number) =>
    placements[a].x - placements[b].x ||
    placements[a].z - placements[b].z ||
    placements[a].y - placements[b].y;

  // Keep executable boxes in a small binary heap. Re-sorting and shifting the
  // whole queue for every carton made large production orders quadratic.
  const ready: number[] = [];
  const pushReady = (index: number) => {
    ready.push(index);
    let child = ready.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (compare(ready[parent], ready[child]) <= 0) break;
      [ready[parent], ready[child]] = [ready[child], ready[parent]];
      child = parent;
    }
  };
  const popReady = () => {
    const first = ready[0];
    const last = ready.pop()!;
    if (ready.length) {
      ready[0] = last;
      let parent = 0;
      while (true) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < ready.length && compare(ready[left], ready[smallest]) < 0) smallest = left;
        if (right < ready.length && compare(ready[right], ready[smallest]) < 0) smallest = right;
        if (smallest === parent) break;
        [ready[parent], ready[smallest]] = [ready[smallest], ready[parent]];
        parent = smallest;
      }
    }
    return first;
  };

  placements.forEach((_, index) => {
    if (remainingDependencies[index] === 0) pushReady(index);
  });

  while (ready.length) {
    const index = popReady();
    ordered.push(placements[index]);
    for (const dependent of dependents[index]) {
      remainingDependencies[dependent] -= 1;
      if (remainingDependencies[dependent] === 0) pushReady(dependent);
    }
  }
  return ordered.length === placements.length ? ordered : placements;
}

function assignSetTrace(placements: PlacedBox[], products: ProductInput[]) {
  const code = setCode(products[0]);
  if (!code) return;
  let itemOffset = 0;
  for (const product of products) {
    const units = unitsPerSet(product);
    const productPlacements = placements.filter((box) => box.productId === product.id);
    productPlacements.forEach((box, index) => {
      box.setCode = code;
      box.setNumber = Math.floor(index / units) + 1;
      box.setItemNumber = itemOffset + (index % units) + 1;
    });
    itemOffset += units;
  }
}

/**
 * Worker-friendly multi-carton layout: every SKU gets one contiguous
 * longitudinal zone and one fixed orientation. Cartons are filled floor-up in
 * that zone, so the loading crew never needs to alternate SKUs inside a row or
 * rely on another carton type for support.
 */
function buildPracticalZonedSet(
  request: PackingRequest,
  container: EffectiveContainer,
  products: ProductInput[],
  targetSets: number,
) {
  if (targetSets <= 0) return null;
  const zones: Array<{
    product: ProductInput;
    orientation: Orientation;
    nx: number;
    ny: number;
    nz: number;
    quantity: number;
    length: number;
  }> = [];

  for (const product of products) {
    const quantity = targetSets * unitsPerSet(product);
    let best: (typeof zones)[number] | undefined;
    for (const orientation of getPracticalOrientations(product)) {
      if (!canPassDoor(orientation, container)) continue;
      const ny = Math.floor(container.width / orientation.dy);
      const physicalLayers = Math.floor(container.height / orientation.dz);
      const configuredLayers = maxStackLayers(product);
      const nz = product.bottomOnly || product.stackable === false
        ? Math.min(1, physicalLayers)
        : configuredLayers > 0
          ? Math.min(physicalLayers, configuredLayers)
          : physicalLayers;
      const cartonsPerLengthStep = ny * nz;
      if (cartonsPerLengthStep <= 0) continue;
      const nx = Math.ceil(quantity / cartonsPerLengthStep);
      const length = nx * orientation.dx;
      if (length > container.length + EPS) continue;
      const candidate = { product, orientation, nx, ny, nz, quantity, length };
      if (
        !best ||
        candidate.length < best.length - EPS ||
        (Math.abs(candidate.length - best.length) <= EPS && candidate.nx < best.nx) ||
        (Math.abs(candidate.length - best.length) <= EPS && candidate.nx === best.nx && candidate.orientation.label < best.orientation.label)
      ) {
        best = candidate;
      }
    }
    if (!best) return null;
    zones.push(best);
  }

  // Put longer zones at the nose. This gives the crew a small number of large,
  // visually obvious blocks and leaves any unused length next to the doors.
  zones.sort((a, b) => b.length - a.length || a.product.sku.localeCompare(b.product.sku));
  if (zones.reduce((sum, zone) => sum + zone.length, 0) > container.length + EPS) return null;

  const placements: PlacedBox[] = [];
  let xOffset = 0;
  for (const zone of zones) {
    let remaining = zone.quantity;
    for (let z = 0; z < zone.nz && remaining > 0; z += 1) {
      for (let x = 0; x < zone.nx && remaining > 0; x += 1) {
        for (let y = 0; y < zone.ny && remaining > 0; y += 1) {
          placements.push(makePlacement(
            zone.product,
            placements.length,
            {
              x: xOffset + x * zone.orientation.dx,
              y: y * zone.orientation.dy,
              z: z * zone.orientation.dz,
            },
            zone.orientation,
            z + 1,
          ));
          remaining -= 1;
        }
      }
    }
    if (remaining > 0) return null;
    xOffset += zone.length;
  }

  const expectedCartons = products.reduce((sum, product) => sum + targetSets * unitsPerSet(product), 0);
  if (placements.length !== expectedCartons) return null;
  assignSetTrace(placements, products);
  const ordered = orderForPracticalLoading(placements);
  return validatePacking(ordered, request.container, request.clearance, products, "practical").valid ? ordered : null;
}

function buildPracticalLayeredSet(
  request: PackingRequest,
  container: EffectiveContainer,
  products: ProductInput[],
  targetSets: number,
) {
  if (targetSets <= 0 || products.some((product) => product.bottomOnly || product.stackable === false)) return null;
  const patterns: LayerPattern[] = [];
  for (const product of products) {
    const orientation = preferredPracticalOrientation(product, container);
    if (!orientation) return null;
    const nx = Math.floor(container.length / orientation.dx);
    const ny = Math.floor(container.width / orientation.dy);
    const capacity = nx * ny;
    if (capacity <= 0) return null;
    const quantity = targetSets * unitsPerSet(product);
    patterns.push({
      product,
      orientation,
      nx,
      ny,
      capacity,
      coverageLength: nx * orientation.dx,
      coverageWidth: ny * orientation.dy,
      fullLayers: Math.floor(quantity / capacity),
      remainder: quantity % capacity,
    });
  }

  // A wider continuous footprint goes below a narrower one, so each successive
  // full layer remains fully supported without dunnage or suspended corners.
  const orderedPatterns = [...patterns].sort(
    (a, b) => b.coverageLength * b.coverageWidth - a.coverageLength * a.coverageWidth || b.orientation.dz - a.orientation.dz,
  );
  const placements: PlacedBox[] = [];
  let z = 0;
  let layer = 1;

  for (const pattern of orderedPatterns) {
    for (let layerIndex = 0; layerIndex < pattern.fullLayers; layerIndex += 1) {
      if (z + pattern.orientation.dz > container.height + EPS) return null;
      if (maxStackLayers(pattern.product) > 0 && layer > maxStackLayers(pattern.product)) return null;
      for (let y = 0; y < pattern.ny; y += 1) {
        for (let x = 0; x < pattern.nx; x += 1) {
          placements.push(makePlacement(
            pattern.product,
            placements.length,
            { x: x * pattern.orientation.dx, y: y * pattern.orientation.dy, z },
            pattern.orientation,
            layer,
          ));
        }
      }
      z += pattern.orientation.dz;
      layer += 1;
    }
  }

  const remainderItems = orderedPatterns.flatMap((pattern) =>
    Array.from({ length: pattern.remainder }, () => pattern),
  ).sort((a, b) => b.orientation.dx * b.orientation.dy - a.orientation.dx * a.orientation.dy);
  if (remainderItems.length) {
    const supportLength = orderedPatterns.some((pattern) => pattern.fullLayers > 0)
      ? orderedPatterns.filter((pattern) => pattern.fullLayers > 0).at(-1)!.coverageLength
      : container.length;
    const supportWidth = orderedPatterns.some((pattern) => pattern.fullLayers > 0)
      ? orderedPatterns.filter((pattern) => pattern.fullLayers > 0).at(-1)!.coverageWidth
      : container.width;
    const layerPlacements: PlacedBox[] = [];
    let points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
    for (const pattern of remainderItems) {
      if (z + pattern.orientation.dz > container.height + EPS) return null;
      if (maxStackLayers(pattern.product) > 0 && layer > maxStackLayers(pattern.product)) return null;
      const point = [...points]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .find((candidate) => {
          if (candidate.x + pattern.orientation.dx > supportLength + EPS || candidate.y + pattern.orientation.dy > supportWidth + EPS) return false;
          const candidateBox = makePlacement(pattern.product, -1, { ...candidate, z }, pattern.orientation, layer);
          return layerPlacements.every((box) => !overlaps(candidateBox, box));
        });
      if (!point) return null;
      const placed = makePlacement(
        pattern.product,
        placements.length + layerPlacements.length,
        { ...point, z },
        pattern.orientation,
        layer,
      );
      layerPlacements.push(placed);
      points = [
        ...points.filter((candidate) => !(candidate.x >= placed.x - EPS && candidate.x < placed.x + placed.dx - EPS && candidate.y >= placed.y - EPS && candidate.y < placed.y + placed.dy - EPS)),
        { x: placed.x + placed.dx, y: placed.y },
        { x: placed.x, y: placed.y + placed.dy },
      ].filter((candidate) => candidate.x < supportLength - EPS && candidate.y < supportWidth - EPS);
    }
    placements.push(...layerPlacements);
  }

  const expectedCartons = products.reduce((sum, product) => sum + targetSets * unitsPerSet(product), 0);
  if (placements.length !== expectedCartons) return null;
  assignSetTrace(placements, products);
  const ordered = orderForPracticalLoading(placements);
  return validatePacking(ordered, request.container, request.clearance, products, "practical").valid ? ordered : null;
}

function packSingleSet(
  request: PackingRequest,
  container: EffectiveContainer,
  products: ProductInput[],
  fieldPracticalSetLimit?: number,
) {
  const cartonsPerSet = products.reduce((sum, product) => sum + unitsPerSet(product), 0);
  const setVolume = products.reduce(
    (sum, product) => sum + product.length * product.width * product.height * unitsPerSet(product),
    0,
  );
  const setWeight = products.reduce((sum, product) => sum + product.weight * unitsPerSet(product), 0);
  const containerVolume = container.length * container.width * container.height;
  const targetVolume = packingStrategy(request) === "practical" ? containerVolume * practicalTarget(request) : containerVolume;
  const volumeBound = setVolume > 0 ? Math.max(1, Math.floor(targetVolume / setVolume)) : 0;
  const weightBound = setWeight > EPS ? Math.floor(request.container.maxWeight / setWeight) : volumeBound;
  const visibleBound = cartonsPerSet > 0 ? Math.floor(MAX_VISIBLE_PLACEMENTS / cartonsPerSet) : 0;
  const historicalBound = fieldPracticalSetLimit === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, Math.floor(fieldPracticalSetLimit));
  const planningSetBound = request.singleCartonLimit === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, Math.floor(request.singleCartonLimit / cartonsPerSet));
  const fieldCalibratedVolumeBound = fieldPracticalSetLimit === undefined
    ? volumeBound
    : Math.max(volumeBound, historicalBound);
  const requestedSets = Math.max(0, Math.min(
    fieldCalibratedVolumeBound,
    weightBound,
    visibleBound,
    historicalBound,
    planningSetBound,
  ));

  if (requestedSets <= 0) {
    return { placements: [] as PlacedBox[], warnings: ["当前柜型无法装入一套完整的多箱产品。"] };
  }

  if (packingStrategy(request) === "maximum") {
    const theoreticalSets = maximumMultiplierBySlabDp(products, container, requestedSets, "maximum");
    const theoreticalCandidate = buildSlabZonedPlan(request, container, products, theoreticalSets, "maximum");
    let practicalSeed: PlacedBox[] | null = null;
    let practicalSeedSets = 0;
    for (let candidate = requestedSets; candidate >= Math.max(1, requestedSets - 500); candidate -= 1) {
      const zoned = buildPracticalZonedSet(request, container, products, candidate);
      const layered = zoned ? null : buildPracticalLayeredSet(request, container, products, candidate);
      practicalSeed = zoned ?? layered;
      if (practicalSeed) {
        practicalSeedSets = candidate;
        break;
      }
    }
    const candidateRequest: PackingRequest = {
      ...request,
      mode: "mixed",
      strategy: "maximum",
      products: products.map((product) => ({
        ...product,
        quantity: requestedSets * unitsPerSet(product),
      })),
    };
    const freeSpace = packMixed(candidateRequest, container);
    const freeSpaceSets = Math.min(
      ...products.map((product) =>
        Math.floor(freeSpace.placements.filter((box) => box.productId === product.id).length / unitsPerSet(product)),
      ),
    );
    const maximumCandidates = [
      theoreticalCandidate ? { placements: theoreticalCandidate, sets: theoreticalSets, method: "纵向分区动态规划" } : null,
      practicalSeed ? { placements: practicalSeed, sets: practicalSeedSets, method: "现场合法解下界" } : null,
      { placements: freeSpace.placements, sets: freeSpaceSets, method: "多起点自由空间搜索" },
    ].filter((candidate): candidate is { placements: PlacedBox[]; sets: number; method: string } => Boolean(candidate));
    maximumCandidates.sort((a, b) => b.sets - a.sets || a.method.localeCompare(b.method));
    const selected = maximumCandidates[0];
    return {
      placements: selected.placements,
      warnings: [
        ...freeSpace.warnings,
        `极限理论算法独立比较纵向分区动态规划、多起点自由空间搜索，并以现场合法解作为搜索下界；采用“${selected.method}”的 ${selected.sets.toLocaleString()} 个完整套。`,
      ],
    };
  }

  let layeredCandidate: PlacedBox[] | null = null;
  let layeredCandidateSets = 0;
  let practicalCandidateMethod = "整层模块";
  {
    const minimumCandidate = Math.max(1, requestedSets - 500);
    for (let candidate = requestedSets; candidate >= minimumCandidate; candidate -= 1) {
      const zoned = buildPracticalZonedSet(request, container, products, candidate);
      const layered = zoned ? null : buildPracticalLayeredSet(request, container, products, candidate);
      const workerFriendly = zoned ?? layered;
      if (workerFriendly) {
        layeredCandidate = workerFriendly;
        layeredCandidateSets = candidate;
        practicalCandidateMethod = zoned ? "SKU 分区直码" : "整层模块";
        break;
      }
    }
  }
  const guidedSets = maximumMultiplierBySlabDp(products, container, requestedSets, "practical");
  const guidedCandidate = buildSlabZonedPlan(request, container, products, guidedSets, "practical");
  const candidateRequest: PackingRequest = {
    ...request,
    mode: "mixed",
    products: products.map((product) => ({
      ...product,
      quantity: requestedSets * unitsPerSet(product),
    })),
  };
  const output = packMixed(candidateRequest, container);
  const freeSpaceSets = Math.min(
    ...products.map((product) =>
      Math.floor(output.placements.filter((box) => box.productId === product.id).length / unitsPerSet(product)),
    ),
  );
  const practicalCandidates = [
    layeredCandidate ? { placements: layeredCandidate, sets: layeredCandidateSets, method: practicalCandidateMethod, guided: false } : null,
    guidedCandidate ? { placements: guidedCandidate, sets: guidedSets, method: "理论引导水平分区", guided: true } : null,
    { placements: output.placements, sets: freeSpaceSets, method: "现场自由空间", guided: false },
  ].filter((candidate): candidate is { placements: PlacedBox[]; sets: number; method: string; guided: boolean } => Boolean(candidate));
  practicalCandidates.sort((a, b) => b.sets - a.sets || Number(a.guided) - Number(b.guided) || a.method.localeCompare(b.method));
  const selected = practicalCandidates[0];
  if (selected && selected.placements !== output.placements) {
    return {
      placements: selected.placements,
      warnings: [
        ...output.warnings,
        selected.guided
          ? `已吸收极限算法中可安全落地的水平分区：采用 ${selected.sets.toLocaleString()} 个完整套，仅保留同高度 90° 转向、连续作业区和完整承托。`
          : `${selected.method}方案不低于其他现场候选，采用 ${selected.sets.toLocaleString()} 个完整套；保持连续作业区和完整承托。`,
      ],
    };
  }
  const warnings = [...output.warnings];
  const loadedSets = freeSpaceSets;
  if (requestedSets === visibleBound && loadedSets === visibleBound) {
    warnings.push(`可视化已达到 ${MAX_VISIBLE_PLACEMENTS.toLocaleString()} 箱上限；实际最大套数可能更高。`);
  }
  return { placements: output.placements, warnings };
}

function buildPracticalSingleSideStrip(
  request: PackingRequest,
  container: EffectiveContainer,
  product: ProductInput,
  maximumCount: number,
) {
  if (maximumCount <= 0 || rotationPolicy(product) === "fixed") return null;
  const orientations = getPracticalOrientations(product).filter((orientation) => canPassDoor(orientation, container));
  let best: { positions: Array<{ x: number; y: number; orientation: Orientation }>; layers: number; count: number } | undefined;

  for (const primary of orientations) {
    const nx = Math.floor(container.length / primary.dx);
    const ny = Math.floor(container.width / primary.dy);
    if (nx <= 0 || ny <= 0) continue;
    const primaryPositions = Array.from({ length: nx * ny }, (_, index) => ({
      x: (index % nx) * primary.dx,
      y: Math.floor(index / nx) * primary.dy,
      orientation: primary,
    }));

    for (const secondary of orientations) {
      // A second horizontal direction is easy to execute; tipping cartons to a
      // different height is intentionally excluded from the practical plan.
      if (secondary.dz !== primary.dz) continue;
      const strips: Array<Array<{ x: number; y: number; orientation: Orientation }>> = [];

      const rightStart = nx * primary.dx;
      const rightNx = Math.floor((container.length - rightStart) / secondary.dx);
      const rightNy = Math.floor(container.width / secondary.dy);
      strips.push(Array.from({ length: Math.max(0, rightNx * rightNy) }, (_, index) => ({
        x: rightStart + (index % Math.max(1, rightNx)) * secondary.dx,
        y: Math.floor(index / Math.max(1, rightNx)) * secondary.dy,
        orientation: secondary,
      })));

      const topStart = ny * primary.dy;
      const topNx = Math.floor(container.length / secondary.dx);
      const topNy = Math.floor((container.width - topStart) / secondary.dy);
      strips.push(Array.from({ length: Math.max(0, topNx * topNy) }, (_, index) => ({
        x: (index % Math.max(1, topNx)) * secondary.dx,
        y: topStart + Math.floor(index / Math.max(1, topNx)) * secondary.dy,
        orientation: secondary,
      })));

      for (const strip of strips) {
        const positions = [...primaryPositions, ...strip];
        const physicalLayers = Math.floor(container.height / primary.dz);
        const configuredLayers = maxStackLayers(product);
        const layers = product.bottomOnly || product.stackable === false
          ? Math.min(1, physicalLayers)
          : configuredLayers > 0
            ? Math.min(physicalLayers, configuredLayers)
            : physicalLayers;
        const count = Math.min(maximumCount, positions.length * layers);
        if (!best || count > best.count || (count === best.count && positions.length < best.positions.length)) {
          best = { positions, layers, count };
        }
      }
    }
  }

  if (!best || best.count <= 0) return null;
  const placements: PlacedBox[] = [];
  for (let layer = 0; layer < best.layers && placements.length < best.count; layer += 1) {
    for (const position of best.positions) {
      if (placements.length >= best.count) break;
      placements.push(makePlacement(
        product,
        placements.length,
        { x: position.x, y: position.y, z: layer * position.orientation.dz },
        position.orientation,
        layer + 1,
      ));
    }
  }
  const ordered = orderForPracticalLoading(placements);
  return validatePacking(ordered, request.container, request.clearance, [product], "practical").valid ? ordered : null;
}

function packSingle(request: PackingRequest, container: EffectiveContainer, fieldPracticalSetLimit?: number) {
  const product = request.products[0];
  if (!product) return { placements: [] as PlacedBox[], warnings: ["请至少添加一个产品。"] };

  const productSet = setCode(product)
    ? request.products.filter((item) => setCode(item) === setCode(product))
    : [];
  if (productSet.length) return packSingleSet(request, container, productSet, fieldPracticalSetLimit);

  let best:
    | { orientation: Orientation; nx: number; ny: number; nz: number; count: number }
    | undefined;
  const strategy = packingStrategy(request);
  const containerVolume = container.length * container.width * container.height;
  const productVolume = product.length * product.width * product.height;
  const targetPracticalBound = strategy === "practical" && productVolume > 0
    ? Math.max(1, Math.floor((containerVolume * practicalTarget(request)) / productVolume))
    : Number.MAX_SAFE_INTEGER;
  const historicalBound = strategy === "practical" && fieldPracticalSetLimit !== undefined
    ? Math.max(0, Math.floor(fieldPracticalSetLimit))
    : Number.MAX_SAFE_INTEGER;
  const planningBound = request.singleCartonLimit === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, Math.floor(request.singleCartonLimit));
  const practicalBound = strategy === "practical" && fieldPracticalSetLimit !== undefined
    ? Math.max(targetPracticalBound, historicalBound)
    : targetPracticalBound;
  const weightBoundForProduct = product.weight > 0
    ? Math.floor(request.container.maxWeight / product.weight)
    : Number.MAX_SAFE_INTEGER;
  const physicalVolumeBound = productVolume > 0
    ? Math.floor(containerVolume / productVolume)
    : 0;
  const slabUpperBound = Math.min(
    strategy === "practical" ? practicalBound : physicalVolumeBound,
    historicalBound,
    planningBound,
    weightBoundForProduct,
    MAX_VISIBLE_PLACEMENTS,
  );
  const slabCount = maximumMultiplierBySlabDp([product], container, slabUpperBound, strategy);
  const slabCandidate = buildSlabZonedPlan(request, container, [product], slabCount, strategy);
  const workerSimpleMixedOrientation = strategy === "practical"
    ? buildPracticalSingleSideStrip(
        request,
        container,
        product,
        Math.min(practicalBound, historicalBound, planningBound, weightBoundForProduct, MAX_VISIBLE_PLACEMENTS),
      )
    : null;
  for (const orientation of orientationsForStrategy(product, container, strategy)) {
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
    const count = Math.min(geometric, weightBound, practicalBound, historicalBound, planningBound);
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
  const pureOrientationPlacements = strategy === "practical" ? orderForPracticalLoading(placements) : placements;
  const candidates = [
    { placements: pureOrientationPlacements, method: strategy === "practical" ? "单方向整齐网格" : "单方向三维网格", guided: false },
    workerSimpleMixedOrientation
      ? { placements: workerSimpleMixedOrientation, method: "主网格 + 连续侧条", guided: false }
      : null,
    slabCandidate
      ? { placements: slabCandidate, method: strategy === "practical" ? "理论引导水平分区" : "极限分区动态规划", guided: strategy === "practical" }
      : null,
  ].filter((candidate): candidate is { placements: PlacedBox[]; method: string; guided: boolean } => Boolean(candidate));
  candidates.sort((a, b) => b.placements.length - a.placements.length || Number(a.guided) - Number(b.guided) || a.method.localeCompare(b.method));
  const selected = candidates[0];
  if (selected.method === "主网格 + 连续侧条") {
    warnings.push("采用主网格 + 连续侧条补位：箱体只做水平 90° 转向、不侧翻，现场按两个清晰区域直码。");
  } else if (selected.guided && selected.placements.length > pureOrientationPlacements.length) {
    warnings.push("已吸收极限分区搜索中可安全执行的部分：只采用同高度水平转向、完整承托和连续纵向分区。");
  } else if (strategy === "maximum") {
    warnings.push("极限理论算法已独立比较单方向三维网格与多方向纵向分区动态规划，不受现场经验装载率限制。");
  }
  return {
    placements: selected.placements,
    warnings,
    theoreticalCount: Math.max(best.count, workerSimpleMixedOrientation?.length ?? 0, slabCount),
  };
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
  let totalVolume = 0;
  let placementIndex = 0;
  const blockedSetCodes = new Set<string>();
  const strategy = packingStrategy(request);
  const supportThreshold = strategy === "practical" ? PRACTICAL_SUPPORT_RATIO : 0.68;
  const volumeLimit = container.length * container.width * container.height * practicalTarget(request);

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
    const orientations = orientationsForStrategy(product, container, strategy);
    if (orientations.length === 0) return false;

    let best: { point: Point; orientation: Orientation; layer: number; score: number } | undefined;
    const candidateBudget = strategy === "maximum" ? 2600 : 1200;
    const retainedPointBudget = strategy === "maximum" ? 3200 : 1600;
    const candidatePoints = [...points]
      .sort(strategy === "practical"
        ? (a, b) => a.x - b.x || a.z - b.z || a.y - b.y
        : (a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
      .slice(0, candidateBudget);
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
        if (support.ratio < supportThreshold || (layerLimit > 0 && support.layer > layerLimit)) continue;
        const topPenalty = strategy === "practical"
          ? candidate.x * 1_000_000_000
          : candidate.z * 1_000_000_000;
        const sidePenalty = strategy === "practical"
          ? candidate.z * 1_000_000 + candidate.y * 100
          : candidate.y * 1_000_000 + candidate.x * 100;
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
    totalVolume += product.length * product.width * product.height;
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
      .sort(strategy === "practical"
        ? (a, b) => a.x - b.x || a.z - b.z || a.y - b.y
        : (a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
      .slice(0, retainedPointBudget);
    return true;
  };

  for (const batch of batches) {
    if (batch.setCode && blockedSetCodes.has(batch.setCode)) continue;
    const batchVolume = batch.items.reduce((sum, product) => sum + product.length * product.width * product.height, 0);
    if (strategy === "practical" && totalVolume > EPS && totalVolume + batchVolume > volumeLimit + EPS) {
      if (batch.setCode) blockedSetCodes.add(batch.setCode);
      continue;
    }
    if (!batch.setCode) {
      placeProduct(batch.items[0]);
      continue;
    }

    const placementCountBefore = placements.length;
    const pointsBefore = [...points];
    const totalWeightBefore = totalWeight;
    const totalVolumeBefore = totalVolume;
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
    totalVolume = totalVolumeBefore;
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
  // Both solvers may learn from the same multi-start ordering ideas, but every
  // candidate is rebuilt under that solver's own orientation/support rules.
  // This lets theory guide field search without copying an unsafe theoretical
  // placement into the practical output.
  const activeStrategies = requested > 4000 ? strategies.slice(0, 2) : strategies;
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
  strategy: PackingStrategy = "maximum",
): ValidationReport {
  const effective = effectiveContainer(container, clearance);
  const errors: string[] = [];
  const spatial = new SpatialIndex(effective);
  const topLevels = new Map<number, PlacedBox[]>();
  const productMap = new Map(products.map((product) => [product.id, product]));
  const placementIds = new Set<string>();
  const orientationsByProduct = new Map<string, Set<string>>();
  let totalWeight = 0;
  for (let index = 0; index < placements.length; index += 1) {
    const box = placements[index];
    const product = productMap.get(box.productId);
    const numericValues = [box.x, box.y, box.z, box.dx, box.dy, box.dz, box.weight, box.layer];
    if (!numericValues.every(Number.isFinite) || box.dx <= 0 || box.dy <= 0 || box.dz <= 0 || box.weight < 0) {
      errors.push(`${box.sku || `箱体 ${index + 1}`} 存在无效的坐标、尺寸、层级或重量。`);
      continue;
    }
    if (placementIds.has(box.id)) errors.push(`${box.sku} 的箱体追踪 ID “${box.id}”重复。`);
    placementIds.add(box.id);
    if (products.length && !product) errors.push(`${box.sku} 的箱体 ${index + 1} 引用了未知产品。`);
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
      if (Math.abs(box.weight - product.weight) > EPS) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 重量与产品资料不一致。`);
      }
      const allowedOrientation = getOrientations(product).some(
        (orientation) =>
          Math.abs(orientation.dx - box.dx) <= EPS &&
          Math.abs(orientation.dy - box.dy) <= EPS &&
          Math.abs(orientation.dz - box.dz) <= EPS,
      );
      if (!allowedOrientation) errors.push(`${box.sku} 的箱体 ${index + 1} 使用了未允许的摆放方向。`);
      if (strategy === "practical" && Math.abs(box.dz - positive(product.height)) > EPS) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 在现场易执行方案中发生侧翻；现场模式只允许保持原包装高度。`);
      }
      if (product.bottomOnly === true && box.z > EPS) errors.push(`${box.sku} 的箱体 ${index + 1} 未按“必须底置”规则放在柜底。`);
      if (!canPassDoor({ dx: box.dx, dy: box.dy, dz: box.dz, label: box.orientation }, effective)) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 无法按当前方向通过门洞。`);
      }
      const orientations = orientationsByProduct.get(box.productId) ?? new Set<string>();
      orientations.add(`${box.dx}:${box.dy}:${box.dz}`);
      orientationsByProduct.set(box.productId, orientations);
    }
    const support = supportDetails(box, topLevels, productMap);
    const supportThreshold = strategy === "practical" ? PRACTICAL_SUPPORT_RATIO : 0.68;
    if (box.z > EPS && support.ratio < supportThreshold) {
      errors.push(`${box.sku} 的箱体 ${index + 1} 底面支撑不足 ${(supportThreshold * 100).toFixed(1)}%。`);
    }
    const layerLimit = product ? maxStackLayers(product) : 0;
    if (layerLimit > 0 && support.layer > layerLimit) {
      errors.push(`${box.sku} 的箱体 ${index + 1} 超过允许的第 ${layerLimit} 层。`);
    }
    spatial.add(box, index);
    const top = box.z + box.dz;
    topLevels.set(top, [...(topLevels.get(top) ?? []), box]);
    totalWeight += product?.weight ?? box.weight;
    if (errors.length >= 20) break;
  }
  if (strategy === "practical") {
    for (const [productId, orientations] of orientationsByProduct) {
      const product = productMap.get(productId);
      const heights = new Set([...orientations].map((orientation) => orientation.split(":")[2]));
      if (orientations.size > 2 || heights.size > 1 || (orientations.size > 1 && rotationPolicy(product!) === "fixed")) {
        const sku = productMap.get(productId)?.sku ?? productId;
        errors.push(`${sku} 在现场易执行方案中使用了 ${orientations.size} 种复杂方向；最多允许两种同高度的水平 90° 方向，不允许侧翻补缝。`);
      }
    }
  }
  if (totalWeight > container.maxWeight + EPS) errors.push("已装总重超过集装箱最大载重。 ");
  if (products.length) {
    const loadedByProduct = new Map<string, number>();
    for (const box of placements) loadedByProduct.set(box.productId, (loadedByProduct.get(box.productId) ?? 0) + 1);
    const expectedSetByProduct = new Map<string, string>();
    for (const [code, group] of collectSetGroups(products)) {
      for (const product of group) expectedSetByProduct.set(product.id, code);
    }
    for (const box of placements) {
      if (errors.length >= 50) break;
      const expectedCode = expectedSetByProduct.get(box.productId);
      const hasTrace = Boolean(box.setCode) || box.setNumber !== undefined || box.setItemNumber !== undefined;
      if (expectedCode) {
        if (
          box.setCode !== expectedCode ||
          !Number.isInteger(box.setNumber) ||
          (box.setNumber ?? 0) <= 0 ||
          !Number.isInteger(box.setItemNumber) ||
          (box.setItemNumber ?? 0) <= 0
        ) {
          errors.push(`套装 ${expectedCode} 存在缺少或不匹配的套装编码、套号或套内序号。`);
        }
      } else if (hasTrace) {
        errors.push(`${box.sku} 不是套装成员，却携带了套装追踪信息。`);
      }
    }
    for (const [code, group] of collectSetGroups(products)) {
      if (errors.length >= 50) break;
      const setCounts = group.map((product) => (loadedByProduct.get(product.id) ?? 0) / unitsPerSet(product));
      const first = setCounts[0] ?? 0;
      if (setCounts.some((count) => !Number.isInteger(count) || Math.abs(count - first) > EPS)) {
        errors.push(`套装 ${code} 的组成箱数量不完整，不能按完整套数交付。`);
      }
      const groupIds = new Set(group.map((product) => product.id));
      const setPlacements = placements.filter((box) => groupIds.has(box.productId));
      if (!setPlacements.length) continue;

      const cartonsPerSet = group.reduce((sum, product) => sum + unitsPerSet(product), 0);
      const bySetNumber = new Map<number, PlacedBox[]>();
      for (const box of setPlacements) {
        if (box.setCode !== code || !Number.isInteger(box.setNumber) || !Number.isInteger(box.setItemNumber)) continue;
        const setNumber = box.setNumber as number;
        bySetNumber.set(setNumber, [...(bySetNumber.get(setNumber) ?? []), box]);
      }
      const expectedSetCount = Number.isInteger(first) ? Math.max(0, first) : 0;
      const actualNumbers = [...bySetNumber.keys()].sort((a, b) => a - b);
      const expectedNumbers = Array.from({ length: expectedSetCount }, (_, index) => index + 1);
      if (actualNumbers.length !== expectedNumbers.length || actualNumbers.some((number, index) => number !== expectedNumbers[index])) {
        errors.push(`套装 ${code} 的套号不连续，必须从 1 连续编号到 ${expectedSetCount}。`);
      }
      for (const [number, boxes] of bySetNumber) {
        if (errors.length >= 50) break;
        const itemNumbers = boxes.map((box) => box.setItemNumber as number).sort((a, b) => a - b);
        const expectedItems = Array.from({ length: cartonsPerSet }, (_, index) => index + 1);
        if (boxes.length !== cartonsPerSet || itemNumbers.some((item, index) => item !== expectedItems[index])) {
          errors.push(`套装 ${code} 第 ${number} 套的套内追踪序号不完整。`);
        }
        for (const product of group) {
          const actual = boxes.filter((box) => box.productId === product.id).length;
          const expected = unitsPerSet(product);
          if (actual !== expected) {
            errors.push(`套装 ${code} 第 ${number} 套中 ${product.sku} 应有 ${expected} 箱，实际为 ${actual} 箱。`);
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

function calculateExecutionComplexity(
  placements: PlacedBox[],
  products: ProductInput[],
): PackingResult["metrics"]["executionComplexity"] {
  const orientationsByProduct = new Map<string, Set<string>>();
  const productMap = new Map(products.map((product) => [product.id, product]));
  const topLevels = new Map<number, PlacedBox[]>();
  let partialSupportCount = 0;
  let tippedCartonCount = 0;

  for (const box of placements) {
    const orientations = orientationsByProduct.get(box.productId) ?? new Set<string>();
    orientations.add(`${box.dx}:${box.dy}:${box.dz}`);
    orientationsByProduct.set(box.productId, orientations);
    const product = productMap.get(box.productId);
    if (product && Math.abs(box.dz - positive(product.height)) > EPS) tippedCartonCount += 1;
    if (box.z > EPS && supportDetails(box, topLevels, productMap).ratio < PRACTICAL_SUPPORT_RATIO) {
      partialSupportCount += 1;
    }
    const top = box.z + box.dz;
    topLevels.set(top, [...(topLevels.get(top) ?? []), box]);
  }

  return {
    orientationVariants: [...orientationsByProduct.values()].reduce((sum, orientations) => sum + orientations.size, 0),
    maxOrientationsPerSku: Math.max(0, ...[...orientationsByProduct.values()].map((orientations) => orientations.size)),
    partialSupportCount,
    tippedCartonCount,
  };
}

export function pack(request: PackingRequest): PackingResult {
  const started = performance.now();
  assertValidRequest(request);
  const normalizedProducts = request.products.map((product) => ({
    ...product,
    length: positive(product.length),
    width: positive(product.width),
    height: positive(product.height),
    weight: positive(product.weight, 0),
    quantity: Math.max(0, Math.floor(product.quantity || 0)),
    priority: Math.min(100, Math.max(0, product.priority)),
    rotationPolicy: rotationPolicy(product),
    stackable: product.stackable !== false,
    maxStackLayers: maxStackLayers(product),
    mustLoad: mustLoad(product),
    bottomOnly: product.bottomOnly === true,
    setCode: setCode(product),
    unitsPerSet: unitsPerSet(product),
    declaredVolumeCbm: roundedCartonVolumeCbm(product),
  }));
  const normalized: PackingRequest = {
    ...request,
    strategy: packingStrategy(request),
    practicalTargetUtilization: practicalTarget(request),
    singleCartonLimit: request.mode === "single" && request.singleCartonLimit !== undefined
      ? Math.max(1, Math.floor(request.singleCartonLimit))
      : undefined,
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
  const effectiveVolume = effective.length * effective.width * effective.height;
  const preliminaryQuoteEstimate = estimateQuoteLoading(normalized, effectiveVolume, 0);
  const defaultPracticalTarget = recommendedPracticalTarget(normalized.container);
  const challengesHistoricalBaseline = normalized.practicalTargetUtilization! >= defaultPracticalTarget + 0.01 - EPS;
  const fieldPracticalSetLimit = normalized.strategy === "practical" &&
    !challengesHistoricalBaseline &&
    preliminaryQuoteEstimate?.source === "historical-exact" &&
    preliminaryQuoteEstimate.physicallyPossibleByBounds
    ? preliminaryQuoteEstimate.predictedSets
    : undefined;
  const output = normalized.mode === "single"
    ? packSingle(normalized, effective, fieldPracticalSetLimit)
    : packMixed(normalized, effective);
  const validation = validatePacking(
    output.placements,
    normalized.container,
    normalized.clearance,
    normalized.products,
    normalized.strategy,
  );
  const theoreticalCount =
    "theoreticalCount" in output && typeof output.theoreticalCount === "number" ? output.theoreticalCount : undefined;
  const summaries = buildSummaries(normalized, output.placements, theoreticalCount);
  const setSummaries = buildSetSummaries(normalized, summaries);
  const loadedVolume = summaries.reduce((sum, item) => sum + item.loadedVolume, 0);
  const grossWeight = summaries.reduce((sum, item) => sum + item.loadedWeight, 0);
  const requestedCount = summaries.reduce((sum, item) => sum + item.requested, 0);
  const loadedCount = summaries.reduce((sum, item) => sum + item.loaded, 0);
  const centerOfGravity = calculateCenterOfGravity(output.placements, effective);
  const executionComplexity = calculateExecutionComplexity(output.placements, normalized.products);
  const physicalLoadedSets = normalized.mode === "single"
    ? setSummaries[0]?.loadedSets ?? loadedCount
    : 0;
  const quoteEstimate = estimateQuoteLoading(normalized, effectiveVolume, physicalLoadedSets);
  const warnings = [...output.warnings];
  if (normalized.mode === "single" && normalized.singleCartonLimit !== undefined) {
    const plannedQuantity = setSummaries.length
      ? Math.floor(normalized.singleCartonLimit / setSummaries[0].cartonsPerSet)
      : normalized.singleCartonLimit;
    warnings.unshift(
      `本次按利用率目标生成计划方案，主动封顶为 ${plannedQuantity.toLocaleString()} ${setSummaries.length ? "套" : "箱"}；这不是当前柜型的物理最大值。`,
    );
  }
  if (fieldPracticalSetLimit !== undefined && physicalLoadedSets >= fieldPracticalSetLimit) {
    warnings.push(`现场模式已按相同包装的历史实装记录封顶为 ${fieldPracticalSetLimit.toLocaleString()} 套；如需挑战理论搜索发现的安全增量，可将现场经验装载率主动调高到 ${(defaultPracticalTarget * 100 + 1).toFixed(1)}% 或以上后重新计算。`);
  }

  const normalizedProductMap = new Map(normalized.products.map((product) => [product.id, product]));
  for (const product of normalized.products) {
    if (!getOrientations(product).some((orientation) => canPassDoor(orientation, effective))) {
      warnings.push(`${product.sku} 没有可通过门洞的允许方向。`);
    }
  }
  if (normalized.mode === "mixed" && loadedCount < requestedCount) {
    warnings.push(`订单仍有 ${(requestedCount - loadedCount).toLocaleString()} 件未装入，请查看 SKU 明细。`);
  }
  for (const summary of summaries) {
    const product = normalizedProductMap.get(summary.productId);
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
  if (loadedCount > 0 && !centerOfGravity.balanced) {
    warnings.push(
      `当前重心位于柜长 ${(centerOfGravity.longitudinalRatio * 100).toFixed(1)}%、柜宽 ${(centerOfGravity.lateralRatio * 100).toFixed(1)}%，建议结合现场装载顺序复核配重。`,
    );
  }
  if (normalized.strategy === "practical") {
    warnings.unshift(
      `现场易执行策略：每个 SKU 最多使用两种同高度平面方向、不侧翻补缝，底面至少 ${(PRACTICAL_SUPPORT_RATIO * 100).toFixed(1)}% 受托，按柜头到柜门的分区顺序码放，并将经验装载率控制在 ${(normalized.practicalTargetUtilization! * 100).toFixed(1)}% 以内。`,
    );
  }
  if (quoteEstimate) {
    warnings.push(...quoteEstimate.dataQualityWarnings.map((warning) => `历史数据质量提示：${warning}`));
    if (quoteEstimate.source === "calibrated-volume") {
      warnings.push(
        `报价预测按 ${quoteEstimate.calibratedCargoVolumeCbm.toFixed(2)} CBM 柜型基线计算；历史回测平均误差 ${quoteEstimate.backtestMeanErrorPct.toFixed(1)}%、90% 误差不超过 ${quoteEstimate.backtestP90ErrorPct.toFixed(1)}%、最大 ${quoteEstimate.backtestMaxErrorPct.toFixed(1)}%。仍须以三维物理方案确认可执行数量。`,
      );
    }
    if (!quoteEstimate.physicallyPossibleByBounds) {
      warnings.push(
        `报价经验值 ${quoteEstimate.predictedSets.toLocaleString()} 套需要约 ${quoteEstimate.predictedCargoVolumeCbm.toFixed(2)} CBM / ${quoteEstimate.predictedGrossWeightKg.toLocaleString()} kg，已超过当前柜型物理边界；仅展示历史报价口径，不生成重叠箱体。`,
      );
    } else if (quoteEstimate.gapSets !== 0) {
      warnings.push(
        `报价预测 ${quoteEstimate.predictedSets.toLocaleString()} 套，当前三维可执行方案 ${quoteEstimate.physicalLoadedSets.toLocaleString()} 套，相差 ${Math.abs(quoteEstimate.gapSets).toLocaleString()} 套。`,
      );
    }
  }

  return {
    id: `plan-${Date.now()}`,
    mode: normalized.mode,
    strategy: normalized.strategy!,
    practicalTargetUtilization: normalized.practicalTargetUtilization!,
    singleCartonLimit: normalized.singleCartonLimit,
    engineVersion: ENGINE_VERSION,
    container: normalized.container,
    clearance: normalized.clearance,
    placements: output.placements,
    summaries,
    setSummaries,
    quoteEstimate,
    metrics: {
      loadedCount,
      requestedCount,
      grossWeight,
      loadedVolume,
      effectiveVolume,
      volumeUtilization: effectiveVolume > 0 ? loadedVolume / effectiveVolume : 0,
      weightUtilization: normalized.container.maxWeight > 0 ? grossWeight / normalized.container.maxWeight : 0,
      centerOfGravity,
      executionComplexity,
      solveTimeMs: performance.now() - started,
    },
    validation,
    warnings,
    createdAt: new Date().toISOString(),
  };
}

function strategyDisplayQuantity(result: PackingResult) {
  return result.mode === "single" && result.setSummaries.length
    ? result.setSummaries[0].loadedSets
    : result.metrics.loadedCount;
}

function comparisonSnapshot(result: PackingResult): StrategyComparison["practical"] {
  return {
    loadedCount: result.metrics.loadedCount,
    loadedSets: result.mode === "single" && result.setSummaries.length ? result.setSummaries[0].loadedSets : null,
    displayQuantity: strategyDisplayQuantity(result),
    volumeUtilization: result.metrics.volumeUtilization,
    weightUtilization: result.metrics.weightUtilization,
    solveTimeMs: result.metrics.solveTimeMs,
    executionComplexity: result.metrics.executionComplexity,
  };
}

function buildStrategyComparison(practical: PackingResult, maximum: PackingResult): StrategyComparison {
  const displayUnit = practical.mode === "single" && practical.setSummaries.length ? "set" : "carton";
  const practicalSnapshot = comparisonSnapshot(practical);
  const maximumSnapshot = comparisonSnapshot(maximum);
  const gainQuantity = Math.max(0, maximumSnapshot.displayQuantity - practicalSnapshot.displayQuantity);
  const gainRatio = practicalSnapshot.displayQuantity > 0 ? gainQuantity / practicalSnapshot.displayQuantity : 0;
  const guidance: StrategyComparison["guidance"] = [];
  if (practical.mode === "single" && practical.singleCartonLimit !== undefined) {
    const plannedQuantity = displayUnit === "set" && practical.setSummaries.length
      ? Math.floor(practical.singleCartonLimit / practical.setSummaries[0].cartonsPerSet)
      : practical.singleCartonLimit;
    guidance.push({
      level: "adopted",
      title: "现场方案已按利用率计划量封顶",
      detail: `本次主动限制为 ${plannedQuantity.toLocaleString()} ${displayUnit === "set" ? "套" : "箱"}；极限算法仍独立计算未受计划目标限制的容量上限，两个数字用途不同。`,
    });
  }
  guidance.push(practical.mode === "single"
    ? {
        level: "adopted",
        title: "已用理论搜索反向指导现场方案",
        detail: "现场求解器会复用极限分区动态规划，但只吸收保持原包装高度、最多两种水平朝向、99.5% 以上承托且能形成连续作业区的摆法。",
      }
    : {
        level: "adopted",
        title: "已用理论多起点顺序扩展现场搜索",
        detail: "现场求解器会采用理论搜索发现的多种 SKU 排序线索，但每个候选都会按不侧翻、最多两种水平朝向和 99.5% 承托重新摆放与校验，不直接复制理论坐标。",
      });

  if (gainQuantity === 0) {
    guidance.push({
      level: "matched",
      title: "现场方案已达到当前极限搜索结果",
      detail: "数量相同不是共用算法：两套求解器分别运行后收敛到同一数量，增加侧翻或碎片补位也没有带来有效增量。",
    });
  } else {
    guidance.push({
      level: "review",
      title: `理论方案多装 ${gainQuantity.toLocaleString()} ${displayUnit === "set" ? "套" : "箱"}`,
      detail: `潜在增益 ${(gainRatio * 100).toFixed(1)}%；请结合下面的复杂度来源决定哪些分区值得现场试装。`,
    });
    if (maximumSnapshot.executionComplexity.tippedCartonCount > 0) {
      guidance.push({
        level: "blocked",
        title: "侧翻增益未自动下放",
        detail: `极限结果有 ${maximumSnapshot.executionComplexity.tippedCartonCount.toLocaleString()} 箱改变原包装高度，需先确认包装受力、标签朝向和叉装条件。`,
      });
    }
    if (maximumSnapshot.executionComplexity.partialSupportCount > 0) {
      guidance.push({
        level: "blocked",
        title: "局部承托增益未自动下放",
        detail: `极限结果有 ${maximumSnapshot.executionComplexity.partialSupportCount.toLocaleString()} 箱未达到现场 99.5% 完整承托标准，必须增加垫板或重新试装。`,
      });
    }
    if (maximumSnapshot.executionComplexity.maxOrientationsPerSku > 2) {
      guidance.push({
        level: "review",
        title: "方向切换需要主管复核",
        detail: `单个 SKU 最多出现 ${maximumSnapshot.executionComplexity.maxOrientationsPerSku} 种方向；现场方案仍限制为最多两种同高度水平方向。`,
      });
    }
    if (
      maximumSnapshot.executionComplexity.tippedCartonCount === 0 &&
      maximumSnapshot.executionComplexity.partialSupportCount === 0 &&
      maximumSnapshot.executionComplexity.maxOrientationsPerSku <= 2
    ) {
      const defaultTarget = recommendedPracticalTarget(practical.container);
      const historicalBaselineActive = practical.quoteEstimate?.source === "historical-exact" &&
        practical.quoteEstimate.physicallyPossibleByBounds &&
        practical.practicalTargetUtilization <= defaultTarget + EPS;
      guidance.push({
        level: "review",
        title: practical.singleCartonLimit !== undefined
          ? "计划量之外保留为安全余量"
          : historicalBaselineActive ? "可解除旧基准后进行现场试装" : "可作为下一轮现场试装目标",
        detail: practical.singleCartonLimit !== undefined
          ? "当前差距首先来自主动设置的体积/载重计划上限，不是算法自相矛盾；需要冲量时请改用“计算所选策略上限”另生成方案。"
          : historicalBaselineActive
          ? `当前按历史实装 ${practical.quoteEstimate!.predictedSets.toLocaleString()} ${displayUnit === "set" ? "套" : "箱"}封顶；将现场经验装载率从 ${(defaultTarget * 100).toFixed(1)}% 主动调高到 ${(defaultTarget * 100 + 1).toFixed(1)}% 或以上后，系统会解除旧基准硬封顶，并继续只输出不侧翻、完整承托的现场候选。`
          : "剩余差距没有侧翻、局部承托或多方向风险；建议每次提高 1–2 个百分点试装，并在确认门口操作空间后记录新的实装数量。",
      });
    }
  }

  return {
    displayUnit,
    practical: practicalSnapshot,
    maximum: maximumSnapshot,
    gainQuantity,
    gainRatio,
    sameQuantity: gainQuantity === 0,
    practicalUsesTheoreticalGuide: true,
    guidance,
  };
}

/**
 * UI/Worker entry point: both independent solvers run for the same immutable
 * input. The theoretical solver treats the practical result as a valid lower
 * bound, so a heuristic search can never report a worse "maximum" result.
 */
export function packWithComparison(request: PackingRequest): PackingResult {
  const practical = pack({ ...request, strategy: "practical" });
  let maximumCapacity = pack({
    ...request,
    strategy: "maximum",
    // A single-product planning target limits the field instruction only. The
    // theoretical branch remains uncapped so the comparison preserves the
    // actual capacity ceiling instead of repeating the same planning number.
    singleCartonLimit: request.mode === "single" ? undefined : request.singleCartonLimit,
  });
  if (strategyDisplayQuantity(maximumCapacity) < strategyDisplayQuantity(practical)) {
    maximumCapacity = {
      ...practical,
      id: `plan-${Date.now()}-maximum-lower-bound`,
      strategy: "maximum",
      warnings: [
        ...practical.warnings,
        "极限搜索未超过现场合法解，已将现场方案作为理论搜索下界；不会把较差的启发式结果伪装成理论上限。",
      ],
    };
  }
  const comparison = buildStrategyComparison(practical, maximumCapacity);
  const practicalPlan = { ...practical, strategyComparison: comparison };
  const maximumPlan = { ...maximumCapacity, strategyComparison: comparison };
  const strategyPlans: NonNullable<PackingResult["strategyPlans"]> = {
    practical: practicalPlan,
    maximum: maximumPlan,
  };
  const selected = packingStrategy(request) === "practical" ? practicalPlan : maximumPlan;
  return { ...selected, strategyPlans };
}
