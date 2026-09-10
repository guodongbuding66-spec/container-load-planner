import { executionAudit } from "./execution";
import { bearingErrors, hasBearingRules, bearingStatus, contactArea } from "./bearing";
import type {
  ContainerSpec,
  PackingMode,
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

export const ENGINE_VERSION = "0.16.1";

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

export function validateContainerInput(container: ContainerSpec, clearance: number): string | null {
  const containerValues = [
    container.length,
    container.width,
    container.height,
    container.doorWidth,
    container.doorHeight,
    container.maxWeight,
  ];
  if (!containerValues.every((value) => Number.isFinite(value) && value > 0)) {
    return "柜型尺寸、门洞和载重必须是大于 0 的有限数字。";
  }
  if (container.doorWidth > container.width + EPS || container.doorHeight > container.height + EPS) {
    return "柜门尺寸不能大于柜内宽度或高度。";
  }
  if (!Number.isFinite(clearance) || clearance < 0) {
    return "安全间隙必须是大于或等于 0 的有限数字。";
  }
  if (
    clearance * 2 >= container.length ||
    clearance * 2 >= container.width ||
    clearance >= container.height ||
    clearance * 2 >= container.doorWidth ||
    clearance >= container.doorHeight
  ) {
    return "安全间隙过大，已占满柜内空间或门洞。";
  }
  return null;
}

function assertValidRequest(request: PackingRequest) {
  if (request.mode !== "single" && request.mode !== "mixed") {
    throw new Error("计算模式必须是单品最大装柜或多 SKU 拼柜。");
  }
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
    (!Number.isInteger(request.singleCartonLimit) || request.singleCartonLimit <= 0)
  ) {
    throw new Error("单品计划箱数上限必须是大于 0 的整数。");
  }
  const containerError = validateContainerInput(request.container, request.clearance);
  if (containerError) throw new Error(containerError);
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
    if (product.maxTopLoadKg !== undefined && (!Number.isFinite(product.maxTopLoadKg) || product.maxTopLoadKg < 0)) throw new Error(`${product.sku} 的上方承重必须为非负有限数字。`);
    if (product.allowedAboveSkus !== undefined && (!Array.isArray(product.allowedAboveSkus) || product.allowedAboveSkus.some(s => typeof s !== "string" || !s.trim()))) throw new Error("叠放白名单格式无效。");
    if (product.topLoadByVerticalAxis && Object.entries(product.topLoadByVerticalAxis).some(([k,v]) => !["length","width","height"].includes(k) || !Number.isFinite(v) || v < 0)) throw new Error("方向承重必须为非负有限数字。");
    if (!Number.isFinite(product.weight) || product.weight < 0) throw new Error(`${product.sku} 的重量不能为负数。`);
    if (!Number.isInteger(product.quantity) || product.quantity < 0 || product.quantity > 1_000_000) throw new Error(`${product.sku} 的数量必须是非负整数且不超过 1,000,000。`);
    if (!Number.isInteger(product.priority) || product.priority < 0 || product.priority > 100) throw new Error(`${product.sku} 的优先级必须是 0–100 的整数。`);
    if (!Number.isInteger(product.maxStackLayers) || product.maxStackLayers < 0 || product.maxStackLayers > 99) throw new Error(`${product.sku} 的层数上限必须是 0–99 的整数。`);
    if (!["fixed", "upright", "any"].includes(product.rotationPolicy)) throw new Error(`${product.sku} 的方向规则无效。`);
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

function supportLevelKey(value: number) {
  return Math.round(value / EPS);
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
  const supporters = topLevels.get(supportLevelKey(candidate.z)) ?? [];
  let supportedArea = 0;
  let layer = 1;
  for (const box of supporters) {
    const ix = Math.max(0, Math.min(candidate.x + candidate.dx, box.x + box.dx) - Math.max(candidate.x, box.x));
    const iy = Math.max(0, Math.min(candidate.y + candidate.dy, box.y + box.dy) - Math.max(candidate.y, box.y));
    const overlap = ix * iy;
    if (overlap > EPS) {
      // A carton touching a forbidden support still loads it, even if other
      // cartons supply enough area to pass the partial-support threshold.
      if (products.get(box.productId)?.stackable === false) return { ratio: 0, layer: Math.max(layer, (box.layer || 1) + 1) };
      supportedArea += overlap;
      layer = Math.max(layer, (box.layer || 1) + 1);
    }
  }
  return { ratio: Math.min(1, supportedArea / (candidate.dx * candidate.dy)), layer };
}

function appendMapArray<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
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
  const ordered = orderForLoading(placements);
  return validatePacking(ordered, request.container, request.clearance, products, strategy, request.mode).valid ? ordered : null;
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
function orderForLoading(placements: PlacedBox[]) {
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
  const ordered = orderForLoading(placements);
  return validatePacking(ordered, request.container, request.clearance, products, "practical", request.mode).valid ? ordered : null;
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
  const expectedCartons = products.reduce((sum, product) => sum + targetSets * unitsPerSet(product), 0);
  const finalize = (remainderPlacements: PlacedBox[]) => {
    const candidate = [...placements, ...remainderPlacements];
    if (candidate.length !== expectedCartons) return null;
    assignSetTrace(candidate, products);
    const ordered = orderForLoading(candidate);
    return validatePacking(ordered, request.container, request.clearance, products, "practical", request.mode).valid
      ? ordered
      : null;
  };
  if (!remainderItems.length) return finalize([]);

  const supportLength = orderedPatterns.some((pattern) => pattern.fullLayers > 0)
    ? orderedPatterns.filter((pattern) => pattern.fullLayers > 0).at(-1)!.coverageLength
    : container.length;
  const supportWidth = orderedPatterns.some((pattern) => pattern.fullLayers > 0)
    ? orderedPatterns.filter((pattern) => pattern.fullLayers > 0).at(-1)!.coverageWidth
    : container.width;

  // First try the most compact option: mix every remainder on one level.
  const combinedRemainder: PlacedBox[] = [];
  let combinedFits = true;
  let points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  for (const pattern of remainderItems) {
    if (z + pattern.orientation.dz > container.height + EPS ||
      (maxStackLayers(pattern.product) > 0 && layer > maxStackLayers(pattern.product))) {
      combinedFits = false;
      break;
    }
    const point = [...points]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .find((candidate) => {
        if (candidate.x + pattern.orientation.dx > supportLength + EPS || candidate.y + pattern.orientation.dy > supportWidth + EPS) return false;
        const candidateBox = makePlacement(pattern.product, -1, { ...candidate, z }, pattern.orientation, layer);
        return combinedRemainder.every((box) => !overlaps(candidateBox, box));
      });
    if (!point) {
      combinedFits = false;
      break;
    }
    const placed = makePlacement(
      pattern.product,
      placements.length + combinedRemainder.length,
      { ...point, z },
      pattern.orientation,
      layer,
    );
    combinedRemainder.push(placed);
    points = [
      ...points.filter((candidate) => !(candidate.x >= placed.x - EPS && candidate.x < placed.x + placed.dx - EPS && candidate.y >= placed.y - EPS && candidate.y < placed.y + placed.dy - EPS)),
      { x: placed.x + placed.dx, y: placed.y },
      { x: placed.x, y: placed.y + placed.dy },
    ].filter((candidate) => candidate.x < supportLength - EPS && candidate.y < supportWidth - EPS);
  }
  if (combinedFits) {
    const combined = finalize(combinedRemainder);
    if (combined) return combined;
  }

  // A shared tail layer can fail even when there is spare height. Keep each
  // SKU remainder in a dense, rectangular level, largest footprint first.
  // The normal practical validator still rejects any incomplete support,
  // overlap, boundary, layer-limit or door violation.
  const separateRemainder: PlacedBox[] = [];
  let separateZ = z;
  let separateLayer = layer;
  const remainderPatterns = orderedPatterns
    .filter((pattern) => pattern.remainder > 0)
    .sort((a, b) =>
      b.remainder * b.orientation.dx * b.orientation.dy - a.remainder * a.orientation.dx * a.orientation.dy ||
      b.coverageLength * b.coverageWidth - a.coverageLength * a.coverageWidth,
    );
  for (const pattern of remainderPatterns) {
    if (separateZ + pattern.orientation.dz > container.height + EPS) return null;
    if (maxStackLayers(pattern.product) > 0 && separateLayer > maxStackLayers(pattern.product)) return null;
    for (let index = 0; index < pattern.remainder; index += 1) {
      separateRemainder.push(makePlacement(
        pattern.product,
        placements.length + separateRemainder.length,
        {
          x: (index % pattern.nx) * pattern.orientation.dx,
          y: Math.floor(index / pattern.nx) * pattern.orientation.dy,
          z: separateZ,
        },
        pattern.orientation,
        separateLayer,
      ));
    }
    separateZ += pattern.orientation.dz;
    separateLayer += 1;
  }
  return finalize(separateRemainder);
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
    if (theoreticalCandidate && theoreticalSets === requestedSets) {
      return {
        placements: theoreticalCandidate,
        warnings: [
          `纵向分区动态规划已达到体积、载重与可视化共同限定的严格上限 ${requestedSets.toLocaleString()} 个完整套；已跳过不会增加数量的其余极限候选。`,
        ],
      };
    }
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
        `高密度参考算法独立比较纵向分区动态规划、多起点自由空间搜索，并以现场合法解作为搜索下界；采用“${selected.method}”的 ${selected.sets.toLocaleString()} 个完整套。该结果不是全局最优证明。`,
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
  if (layeredCandidate && layeredCandidateSets === requestedSets) {
    const warnings = [
      `${practicalCandidateMethod}方案已达到当前计划上限 ${requestedSets.toLocaleString()} 个完整套；已跳过不会增加数量的理论引导与自由空间候选。`,
    ];
    if (requestedSets === visibleBound) {
      warnings.push(`可视化已达到 ${MAX_VISIBLE_PLACEMENTS.toLocaleString()} 箱上限；实际最大套数可能更高。`);
    }
    return { placements: layeredCandidate, warnings };
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
  const ordered = orderForLoading(placements);
  return validatePacking(ordered, request.container, request.clearance, [product], "practical", request.mode).valid ? ordered : null;
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
  const pureOrientationPlacements = strategy === "practical" ? orderForLoading(placements) : placements;
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
    warnings.push("高密度参考算法已独立比较单方向三维网格与多方向纵向分区动态规划，不受现场经验装载率限制；该启发式结果不是全局最优证明。");
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

function packMixedWithStrategy(request: PackingRequest, container: EffectiveContainer, sort: SortStrategy, anchors: PlacedBox[] = []) {
  const already = new Map<string, number>();
  anchors.forEach(b => already.set(b.productId, (already.get(b.productId) ?? 0) + 1));
  const batches = buildItemBatches({...request, products:request.products.map(p=>({...p,quantity:Math.max(0,p.quantity-(already.get(p.id)??0))}))}, sort);
  const usedSetNumbers = new Map<string, Set<number>>();
  for (const box of anchors) if (box.setCode && box.setNumber) {
    const used = usedSetNumbers.get(box.setCode) ?? new Set<number>();
    used.add(box.setNumber);
    usedSetNumbers.set(box.setCode, used);
  }
  const nextSetNumbers = new Map<string, number>();
  for (const batch of batches) if (batch.setCode) {
    const used = usedSetNumbers.get(batch.setCode);
    let next = nextSetNumbers.get(batch.setCode) ?? 1;
    while (used?.has(next)) next++;
    batch.setNumber = next;
    nextSetNumbers.set(batch.setCode, next + 1);
  }
  const placements: PlacedBox[] = anchors.map(b=>({...b}));
  let spatial = new SpatialIndex(container);
  let topLevels = new Map<number, PlacedBox[]>();
  const productMap = new Map(request.products.map((product) => [product.id, product]));
  let points: Point[] = [{ x: 0, y: 0, z: 0 }];
  let totalWeight = placements.reduce((n,b)=>n+b.weight,0);
  let totalVolume = placements.reduce((n,b)=>n+b.dx*b.dy*b.dz,0);
  let placementIndex = anchors.length ? 1 + Math.max(0,...placements.map(b=>Number(b.id.split("-").at(-1))||0)) : 0;
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
      const topKey = supportLevelKey(top);
      appendMapArray(topLevels, topKey, box);
    });
  };

  rebuildIndexes();
  if (anchors.length) points.push(...anchors.flatMap(b=>[
    {x:b.x+b.dx,y:b.y,z:b.z},{x:b.x,y:b.y+b.dy,z:b.z},{x:b.x,y:b.y,z:b.z+b.dz},
    {x:0,y:b.y,z:b.z+b.dz},{x:b.x,y:0,z:b.z+b.dz},{x:b.x+b.dx,y:0,z:0}
  ]));
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
        if (request.products.some(hasBearingRules) && bearingErrors([...placements, candidate], request.products).length) continue;
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
    const topKey = supportLevelKey(top);
    appendMapArray(topLevels, topKey, placed);

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
  const activeStrategies = request.searchPass !== undefined ? [strategies[Math.abs(request.searchPass) % strategies.length]] : requested > 4000 ? strategies.slice(0, 2) : strategies;
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
  mode: PackingMode = "mixed",
): ValidationReport {
  const containerError = validateContainerInput(container, clearance);
  if (containerError) return { valid: false, errors: [containerError] };
  if (!Array.isArray(placements)) return { valid: false, errors: ["箱体坐标必须是数组。"] };
  if (mode !== "single" && mode !== "mixed") return { valid: false, errors: ["计算模式无效。"] };
  const effective = effectiveContainer(container, clearance);
  const errors: string[] = [];
  const spatial = new SpatialIndex(effective);
  const topLevels = new Map<number, PlacedBox[]>();
  const productMap = new Map(products.map((product) => [product.id, product]));
  if (productMap.size !== products.length) errors.push("产品资料存在重复 ID，无法独立核对箱体归属。");
  const placementIds = new Set<string>();
  const orientationsByProduct = new Map<string, Set<string>>();
  let totalWeight = 0;
  for (let index = 0; index < placements.length; index += 1) {
    const box = placements[index];
    const product = productMap.get(box.productId);
    const numericValues = [box.x, box.y, box.z, box.dx, box.dy, box.dz, box.weight, box.layer];
    if (!numericValues.every(Number.isFinite) || box.dx <= 0 || box.dy <= 0 || box.dz <= 0 || box.weight < 0 || !Number.isInteger(box.layer) || box.layer < 1) {
      errors.push(`${box.sku || `箱体 ${index + 1}`} 存在无效的坐标、尺寸、层级或重量。`);
      continue;
    }
    if (!box.id?.trim()) errors.push(`${box.sku || `箱体 ${index + 1}`} 缺少箱体追踪 ID。`);
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
      // Never expand an invalid imported box into potentially millions of
      // spatial cells. A boundary failure already invalidates this snapshot.
      return { valid: false, errors };
    }
    for (const otherIndex of spatial.query(box)) {
      if (overlaps(box, placements[otherIndex])) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 与箱体 ${otherIndex + 1} 重叠。`);
        break;
      }
    }
    if (product) {
      if (box.sku !== product.sku) errors.push(`${box.sku || `箱体 ${index + 1}`} 的 SKU 与产品资料 ${product.sku} 不一致。`);
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
    if (box.layer !== support.layer) {
      errors.push(`${box.sku} 的箱体 ${index + 1} 标注为第 ${box.layer} 层，按支撑关系应为第 ${support.layer} 层。`);
    }
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
    const topKey = supportLevelKey(top);
    appendMapArray(topLevels, topKey, box);
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
    if (mode === "mixed") {
      for (const product of products) {
        const loaded = loadedByProduct.get(product.id) ?? 0;
        if (loaded > product.quantity) {
          errors.push(`${product.sku} 已装 ${loaded.toLocaleString()} 箱，超过订单需求 ${product.quantity.toLocaleString()} 箱。`);
        }
      }
    }
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
        appendMapArray(bySetNumber, setNumber, box);
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
  errors.push(...bearingErrors(placements, products));
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
    const topKey = supportLevelKey(top);
    appendMapArray(topLevels, topKey, box);
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
  const bearingEnabled = normalized.products.some(hasBearingRules);
  const cartonsPerUnit = normalized.products.reduce((sum,p)=>sum+(setCode(p)?unitsPerSet(p):1),0);
  const unitVolume = normalized.products.reduce((sum,p)=>sum+p.length*p.width*p.height*(setCode(p)?unitsPerSet(p):1),0);
  const bearingUnitLimit = Math.min(Math.floor(4000/cartonsPerUnit), Math.floor(effectiveVolume/unitVolume), Math.floor((normalized.singleCartonLimit ?? 4000)/cartonsPerUnit));
  const bearingRequest: PackingRequest = normalized.mode === "single" && bearingEnabled ? { ...normalized, mode: "mixed", products: normalized.products.map(p => ({ ...p, quantity: bearingUnitLimit*(setCode(p)?unitsPerSet(p):1) })) } : normalized;
  const output = bearingEnabled ? packMixed(bearingRequest, effective) : normalized.mode === "single"
    ? packSingle(normalized, effective, fieldPracticalSetLimit)
    : packMixed(normalized, effective);
  // Solvers may discover the final geometry layer-by-layer. Playback, exports
  // and field instructions must instead follow a physically executable route:
  // finish the container nose first, load every direct support before the box
  // above it, and then advance toward the doors.
  const orderedPlacements = orderForLoading(output.placements);
  const validation = validatePacking(
    orderedPlacements,
    normalized.container,
    normalized.clearance,
    normalized.products,
    normalized.strategy,
    normalized.mode,
  );
  const theoreticalCount =
    "theoreticalCount" in output && typeof output.theoreticalCount === "number" ? output.theoreticalCount : undefined;
  const summaries = buildSummaries(normalized, orderedPlacements, theoreticalCount);
  const setSummaries = buildSetSummaries(normalized, summaries);
  const loadedVolume = summaries.reduce((sum, item) => sum + item.loadedVolume, 0);
  const grossWeight = summaries.reduce((sum, item) => sum + item.loadedWeight, 0);
  const requestedCount = summaries.reduce((sum, item) => sum + item.requested, 0);
  const loadedCount = summaries.reduce((sum, item) => sum + item.loaded, 0);
  const centerOfGravity = calculateCenterOfGravity(orderedPlacements, effective);
  const executionComplexity = calculateExecutionComplexity(orderedPlacements, normalized.products);
  const physicalLoadedSets = normalized.mode === "single"
    ? setSummaries[0]?.loadedSets ?? loadedCount
    : 0;
  const quoteEstimate = estimateQuoteLoading(normalized, effectiveVolume, physicalLoadedSets);
  const warnings = [...output.warnings];
  const bearingCheck = bearingStatus(orderedPlacements, normalized.products);
  if (!bearingCheck.verified) warnings.push(`承重未核验：${bearingCheck.unknownIds.length} 个受压箱体尚未填写该朝向的承重参数；几何通过不代表承重已确认。`);
  if (bearingEnabled) warnings.push("已启用逐箱上方累计承重约束，按接触面积分配静态竖向载荷；结果可能比无承重约束的排列更保守。");
  if (normalized.mode === "single" && normalized.singleCartonLimit !== undefined) {
    const plannedQuantity = setSummaries.length
      ? Math.floor(normalized.singleCartonLimit / setSummaries[0].cartonsPerSet)
      : normalized.singleCartonLimit;
    const executableQuantity = setSummaries.length ? setSummaries[0].loadedSets : loadedCount;
    warnings.unshift(
      executableQuantity < plannedQuantity
        ? `体积/载重算术上限为 ${plannedQuantity.toLocaleString()} ${setSummaries.length ? "套" : "箱"}，当前坐标独立校验可执行 ${executableQuantity.toLocaleString()} ${setSummaries.length ? "套" : "箱"}；统一建议采用可执行值。`
        : `本次按利用率目标生成现场计划，并以 ${plannedQuantity.toLocaleString()} ${setSummaries.length ? "套" : "箱"}为上限；这不是当前柜型的物理最大值。`,
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
  warnings.unshift("执行顺序已按柜内到箱门重排：同一纵深区域先下后上，任何上层箱均晚于其直接承托箱装入。");
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
    id: `plan-${Date.now()}-${normalized.strategy}`,
    mode: normalized.mode,
    strategy: normalized.strategy!,
    practicalTargetUtilization: normalized.practicalTargetUtilization!,
    singleCartonLimit: normalized.singleCartonLimit,
    engineVersion: ENGINE_VERSION,
    container: normalized.container,
    clearance: normalized.clearance,
    placements: orderedPlacements,
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
    const executableQuantity = practicalSnapshot.displayQuantity;
    guidance.push({
      level: "adopted",
      title: executableQuantity < plannedQuantity ? "算术计划已收敛到可执行坐标" : "现场方案已按利用率计划量封顶",
      detail: executableQuantity < plannedQuantity
        ? `体积/载重倒推为 ${plannedQuantity.toLocaleString()} ${displayUnit === "set" ? "套" : "箱"}，现场算法独立校验可执行 ${executableQuantity.toLocaleString()} ${displayUnit === "set" ? "套" : "箱"}；页面统一采用后者，极限算法仍独立计算。`
        : `本次计划与坐标均为 ${executableQuantity.toLocaleString()} ${displayUnit === "set" ? "套" : "箱"}；极限算法仍独立计算未受计划目标限制的容量上限。`,
    });
  }
  guidance.push(practical.mode === "single"
    ? {
        level: "adopted",
      title: "已用高密度搜索反向指导现场方案",
      detail: "现场求解器会复用高密度分区动态规划，但只吸收保持原包装高度、最多两种水平朝向、99.5% 以上承托且能形成连续作业区的摆法。",
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
      title: `高密度方案多装 ${gainQuantity.toLocaleString()} ${displayUnit === "set" ? "套" : "箱"}`,
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
          ? "当前差距首先来自主动设置的体积/载重计划上限，不是算法自相矛盾；需要冲量时切换“高密度参考”，页面会立即改用已缓存的高密度数量、三视图、坐标与导出方案。"
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
export function combineStrategyResults(
  practical: PackingResult,
  maximum: PackingResult,
  selectedStrategy: PackingStrategy = "practical",
): PackingResult {
  let maximumCapacity = maximum;
  if (strategyDisplayQuantity(maximumCapacity) < strategyDisplayQuantity(practical)) {
    const attemptedMaximum = maximumCapacity;
    maximumCapacity = {
      ...practical,
      id: `plan-${Date.now()}-maximum-lower-bound`,
      strategy: "maximum",
      singleCartonLimit: undefined,
      practicalTargetUtilization: attemptedMaximum.practicalTargetUtilization,
      metrics: {
        ...practical.metrics,
        solveTimeMs: attemptedMaximum.metrics.solveTimeMs,
      },
      createdAt: attemptedMaximum.createdAt,
      warnings: [
        ...practical.warnings.filter((warning) =>
          !warning.startsWith("现场易执行策略：") &&
          !warning.startsWith("本次按利用率目标生成计划方案") &&
          !warning.startsWith("现场模式已按相同包装的历史实装记录封顶"),
        ),
        "高密度搜索未超过现场合法解，已将现场方案作为搜索下界；不会把较差的启发式结果伪装成理论上限。",
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
  const selected = selectedStrategy === "practical" ? practicalPlan : maximumPlan;
  return { ...selected, strategyPlans };
}

export function packWithComparison(request: PackingRequest): PackingResult {
  const practical = pack({ ...request, strategy: "practical" });
  const maximumCapacity = pack({
    ...request,
    strategy: "maximum",
    // A single-product planning target limits the field instruction only. The
    // theoretical branch remains uncapped so the comparison preserves the
    // actual capacity ceiling instead of repeating the same planning number.
    singleCartonLimit: request.mode === "single" ? undefined : request.singleCartonLimit,
  });
  return combineStrategyResults(practical, maximumCapacity, packingStrategy(request));
}

/** Revalidate a manual edit and rebuild every geometry-dependent metric. */
export function revisePackingResult(original: PackingResult, placements: PlacedBox[], products: ProductInput[]): PackingResult {
  if (placements.length !== original.placements.length || new Set(placements.map(b => b.id)).size !== placements.length) throw new Error("手动调整不能增删箱体或重复追踪 ID。");
  const before = new Map(original.placements.map(b => [b.id, b]));
  for (const b of placements) {
    const old = before.get(b.id);
    if (!old || old.productId !== b.productId || old.weight !== b.weight || old.setCode !== b.setCode || old.setNumber !== b.setNumber || old.setItemNumber !== b.setItemNumber) throw new Error("箱体身份和成套关系不能改变。");
    if (old.locked && ["x", "y", "z", "dx", "dy", "dz"].some(k => old[k as keyof PlacedBox] !== b[k as keyof PlacedBox])) throw new Error("请先解除箱位锁定。");
  }
  const productMap = new Map(products.map(p => [p.id, p]));
  const levels = new Map<number, PlacedBox[]>();
  const relayered = [...placements].sort((a,b) => a.z-b.z).map(b => {
    const box = { ...b, layer: supportDetails(b, levels, productMap).layer };
    appendMapArray(levels, supportLevelKey(box.z+box.dz), box);
    return box;
  });
  const ordered = orderForLoading(relayered);
  const validation = validatePacking(ordered, original.container, original.clearance, products, original.strategy, original.mode);
  if (!validation.valid) throw new Error(validation.errors.slice(0,3).join("\n"));
  const effective = effectiveContainer(original.container, original.clearance);
  return { ...original, id: `manual-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, placements: ordered,
    strategyPlans: undefined, strategyComparison: undefined, quoteEstimate: undefined, validation,
    warnings: ["手动调整已重新校验；继续优化会保留锁定箱位及其支撑；重新计算整个订单将创建新方案。"],
    metrics: { ...original.metrics, centerOfGravity: calculateCenterOfGravity(ordered,effective), executionComplexity: calculateExecutionComplexity(ordered,products) }, createdAt: new Date().toISOString() };
}

export function explainUnloaded(result: PackingResult, products: ProductInput[]) {
  const effective = effectiveContainer(result.container,result.clearance);
  return result.summaries.filter(s => s.unloaded > 0).map(s => {
    const p = products.find(p => p.id===s.productId);
    const reasons: string[] = [];
    if (!p) return { ...s, reasons: ["缺少箱规资料"] };
    const orientations = orientationsForStrategy(p,effective,result.strategy);
    if (!getOrientations(p).some(o=>canPassDoor(o,effective))) reasons.push("允许的方向均无法通过柜门（确定限制）");
    if (!orientations.some(o=>o.dx<=effective.length && o.dy<=effective.width && o.dz<=effective.height)) reasons.push("当前策略下的尺寸或方向超出柜内空间（确定限制）");
    if (p.weight > result.container.maxWeight-result.metrics.grossWeight) reasons.push("剩余载重不足以再加入一箱（确定限制）");
    if (p.length*p.width*p.height > result.metrics.effectiveVolume-result.metrics.loadedVolume) reasons.push("剩余总容积不足一箱（确定限制）");
    if (p.setCode) reasons.push("必须整套装入；任一组件不足或放不下会整套回退");
    if (!reasons.length) reasons.push("搜索未找到满足当前约束的摆放位置；不能据此证明绝对装不下");
    if (p.maxStackLayers>0) reasons.push(`配置了 ${p.maxStackLayers} 层上限`);
    if (p.maxTopLoadKg!==undefined) reasons.push(`配置了上方承重 ${p.maxTopLoadKg} kg`);
    return { ...s, reasons };
  });
}

/** Bounded diagnostic probe on demand; absence of a witness is not an infeasibility proof. */
export function diagnoseUnloadedPosition(result:PackingResult,products:ProductInput[],productId:string){
  const p=products.find(p=>p.id===productId);if(!p)return {detail:"缺少箱规",candidate:null};
  const effective=effectiveContainer(result.container,result.clearance),orientations=orientationsForStrategy(p,effective,result.strategy);
  const spatial=new SpatialIndex(effective),tops=new Map<number,PlacedBox[]>(),rules=new Map(products.map(p=>[p.id,p]));
  result.placements.forEach((b,i)=>{spatial.add(b,i);appendMapArray(tops,supportLevelKey(b.z+b.dz),b);});
  const points:Point[]=[{x:0,y:0,z:0},...result.placements.flatMap(b=>[{x:b.x+b.dx,y:b.y,z:b.z},{x:b.x,y:b.y+b.dy,z:b.z},{x:b.x,y:b.y,z:b.z+b.dz}])];
  const unique=[...new Map(points.map(p=>[[p.x,p.y,p.z].join('/'),p])).values()];
  const stride=Math.max(1,Math.ceil(unique.length/240));let geometry=0,supportFailures=0,layerFailures=0;let first:PlacedBox|null=null;
  for(let i=0;i<unique.length;i+=stride)for(const o of orientations){
    const b=makePlacement(p,0,unique[i],o);
    if(b.x+b.dx>effective.length+EPS||b.y+b.dy>effective.width+EPS||b.z+b.dz>effective.height+EPS)continue;
    if([...spatial.query(b)].some(j=>overlaps(b,result.placements[j])))continue;
    geometry++;first??=b;
    const support=supportDetails(b,tops,rules);
    if(p.bottomOnly&&b.z>EPS||support.ratio<(result.strategy==="practical"?PRACTICAL_SUPPORT_RATIO:.68)){supportFailures++;continue;}
    if(p.maxStackLayers>0&&support.layer>p.maxStackLayers){layerFailures++;continue;}
    return {detail:"抽样找到满足几何及承托的候选区域；仍需校验整套配比、累计承重、载重与目标上限。可继续优化验证，不能直接加箱。",candidate:b};
  }
  return {detail:geometry?`抽样发现 ${geometry} 个无碰撞位置，其中 ${supportFailures} 个不满足承托／底置，${layerFailures} 个超过层数上限。`:(orientations.length?"抽样未找到可容纳当前方向箱体的连续空间，可能受空间碎片限制；有限抽样不证明绝对装不下。":"允许的箱体方向无法通过当前柜门。"),candidate:first};
}

/** Treat saved coordinates as untrusted input; rebuild all totals with today's validator. */
export function restorePackingSnapshot(request: PackingRequest, snapshot: unknown): PackingResult {
  assertValidRequest(request);
  if (!snapshot || typeof snapshot !== "object") throw new Error("归档坐标格式无效。");
  const raw=snapshot as Record<string,unknown>;
  const limit=raw.singleCartonLimit??request.singleCartonLimit;
  if(limit!==undefined&&(!Number.isInteger(limit)||Number(limit)<1))throw new Error("归档计划上限无效。");
  if (raw.strategy!=="practical"&&raw.strategy!=="maximum") throw new Error("归档算法标识无效。");
  if (!Array.isArray(raw.placements)||raw.placements.length>MAX_VISIBLE_PLACEMENTS) throw new Error("归档箱体坐标数量无效。");
  const products=selectProductsForMode(request.products,request.mode);
  const byId=new Map(products.map(p=>[p.id,p]));
  const placements:PlacedBox[]=raw.placements.map((value:unknown)=>{
    if(!value||typeof value!=="object")throw new Error("归档箱体格式无效。");
    const b=value as Record<string,unknown>;
    for(const key of ["id","productId","sku","orientation"])if(typeof b[key]!=="string"||(b[key] as string).length>300)throw new Error("归档箱体标识无效。");
    for(const key of ["x","y","z","dx","dy","dz","weight","layer"])if(typeof b[key]!=="number"||!Number.isFinite(b[key]))throw new Error("归档箱体坐标或重量无效。");
    const p=byId.get(b.productId as string);if(!p)throw new Error("归档箱体引用了不存在的产品。");
    if(b.setCode!==undefined&&typeof b.setCode!=="string")throw new Error("归档套装编码无效。");
    if(b.locked!==undefined&&typeof b.locked!=="boolean")throw new Error("归档锁定标记无效。");
    return {id:b.id as string,productId:p.id,sku:b.sku as string,name:p.name,color:p.color,
      x:b.x as number,y:b.y as number,z:b.z as number,dx:b.dx as number,dy:b.dy as number,dz:b.dz as number,
      weight:b.weight as number,layer:b.layer as number,orientation:b.orientation as string,locked:b.locked as boolean|undefined,
      setCode:b.setCode as string|undefined,setNumber:b.setNumber as number|undefined,setItemNumber:b.setItemNumber as number|undefined};
  });
  const ordered=orderForLoading(placements);
  const validation=validatePacking(ordered,request.container,request.clearance,products,raw.strategy,request.mode);
  if(!validation.valid)throw new Error(`归档坐标未通过当前校验：${validation.errors.slice(0,3).join("；")}`);
  if(request.mode==="single"&&limit!==undefined&&ordered.length>Number(limit))throw new Error("归档箱数超过计划上限。");
  const normalized: PackingRequest={...request,products,strategy:raw.strategy,singleCartonLimit:limit as number|undefined};
  const summaries=buildSummaries(normalized,ordered);
  const setSummaries=buildSetSummaries(normalized,summaries);
  const effective=effectiveContainer(request.container,request.clearance);
  const loadedVolume=summaries.reduce((n,s)=>n+s.loadedVolume,0);
  const grossWeight=summaries.reduce((n,s)=>n+s.loadedWeight,0);
  const effectiveVolume=effective.length*effective.width*effective.height;
  return {id:`restored-${Date.now()}`,mode:request.mode,strategy:raw.strategy,practicalTargetUtilization:practicalTarget(normalized),engineVersion:ENGINE_VERSION,
    container:request.container,clearance:request.clearance,singleCartonLimit:normalized.singleCartonLimit,placements:ordered,summaries,setSummaries,validation,
    metrics:{loadedCount:ordered.length,requestedCount:summaries.reduce((n,s)=>n+s.requested,0),loadedVolume,grossWeight,effectiveVolume,
      volumeUtilization:loadedVolume/effectiveVolume,weightUtilization:grossWeight/request.container.maxWeight,
      centerOfGravity:calculateCenterOfGravity(ordered,effective),executionComplexity:calculateExecutionComplexity(ordered,products),solveTimeMs:0},
    warnings:["历史箱位已按当前箱规与引擎重新校验。自动重算已暂停，可继续手动调整或生成新方案。"],createdAt:new Date().toISOString()};
}

/** Retain locked boxes, their support closure and complete kits; only rebuild the free remainder. */
export function improvePacking(original: PackingResult, products: ProductInput[], pass = 0): PackingResult {
  const request: PackingRequest = {mode:original.mode,strategy:original.strategy,container:original.container,clearance:original.clearance,practicalTargetUtilization:original.practicalTargetUtilization,products};
  const baseline=restorePackingSnapshot(request,{strategy:original.strategy,placements:original.placements});
  const fixed=new Set(original.placements.filter(b=>b.locked).map(b=>b.id));
  let changed=true;
  while(changed){changed=false;for(const b of original.placements){if(!fixed.has(b.id))continue;for(const a of original.placements){if(fixed.has(a.id))continue;const sameSet=Boolean(b.setCode&&a.setCode===b.setCode&&a.setNumber===b.setNumber);const support=Math.abs(a.z+a.dz-b.z)<EPS&&contactArea(a,b)>EPS;if(sameSet||support){fixed.add(a.id);changed=true;}}}}
  const effective=effectiveContainer(request.container,request.clearance);
  if(request.mode==="single"){
    const n=products.reduce((s,p)=>s+(setCode(p)?unitsPerSet(p):1),0),v=products.reduce((s,p)=>s+p.length*p.width*p.height*(setCode(p)?unitsPerSet(p):1),0);
    const units=Math.floor(Math.min(effective.length*effective.width*effective.height/v,MAX_VISIBLE_PLACEMENTS/n,(original.singleCartonLimit??MAX_VISIBLE_PLACEMENTS)/n));
    request.products=products.map(p=>({...p,quantity:units*(setCode(p)?unitsPerSet(p):1)}));
  }
  const variants:SortStrategy[]=[...strategies,(a,b)=>compareRequired(a,b)||b.weight-a.weight,(a,b)=>compareRequired(a,b)||a.height-b.height,(a,b)=>compareRequired(a,b)||a.length*a.width-b.length*b.width];
  const placements=packMixedWithStrategy(request,effective,variants[Math.abs(pass)%variants.length],original.placements.filter(b=>fixed.has(b.id)));
  let candidate:PackingResult;try{candidate=restorePackingSnapshot(request,{strategy:original.strategy,placements});}catch{return original;}
  const score=(p:PackingResult)=>weightedScore(p.placements,products);
  if(score(candidate)<score(baseline)||candidate.metrics.loadedCount<baseline.metrics.loadedCount)return original;
  if(score(candidate)===score(baseline)&&executionAudit(candidate).score>=executionAudit(baseline).score)return original;
  candidate.id=`optimized-${Date.now()}-${pass}`;candidate.singleCartonLimit=original.singleCartonLimit;
  candidate.warnings=[`已保留 ${fixed.size} 个固定／支撑／成套箱位，其余空间完成第 ${pass+1} 轮搜索。`,...candidate.warnings];
  return candidate;
}
