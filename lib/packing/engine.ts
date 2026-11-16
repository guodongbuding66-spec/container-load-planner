import {restoreDeliveryIdentity} from "./delivery-identity";
import {assertOrderLineIds,orderDelivery} from "./order-lines";
import {parseLooseQuantities} from "./loose-cargo";
import {palletDeckSupportGeometry,DECK_SUPPORT_PREFIX} from "./deck-support";
import {accessorySupportGeometry,assertAccessorySupportWorkflow,hasAccessorySupports,SUPPORT_WORKFLOW_ERROR} from "./accessory-support";
import {containerAccessoryWeight,accessoryMassBoxes,accessoryProductErrors} from "./container-accessories";
import {parseLongSupport,hasLongSupportLimits,inspectLongSupportPlacement,longSupportViolation} from "./long-support";
import {parseHandlingTasks} from "./handling-sequence";
import {parseSiteExclusions,siteExclusionBoxes,availablePackingVolume,SITE_EXCLUSION_PREFIX} from "./site-exclusions";
import { packagingReservedVolume, packagingMassCenter } from "./packaging";
import { parseLoadingWorkflow, parsePalletBuild } from "./loading-workflow";
import { palletSpecifications, mixedInspectionContainer, independentPalletVolume, specificationForPallet, parsePalletCartonLimit } from "./pallet-specifications";
import { parseShapeFields, shapeDetails, cargoShapeOf, isRectilinearShape, withShapeSupport } from "./cargo-shape";
import { cargoBodyParts, bodyBottomPatches, bodyContactArea, bodyTopLevels, bodyVolumeRatio, bodiesOverlap, surfaceArea, validOrientationSigns, orientationAxes, intersectSurface, surfacePolygon, bodyTopPatches } from "./cargo-body";
import { parsePalletization, validatePalletizedCargo, orderPalletizedCargo } from "./prebuilt-pallets";
import { modelRestError, modelMassCenter, modelStable } from "./model-body";
import { buildSolidModel } from "./solid-model";
import { envelopeMetrics } from "./solid-utilization";
import { parseAccessConfig } from "./maneuver";

import { arrangeFloorPallets, parseFloorPalletConfig, palletAnchors, palletSupportProducts, assignPalletReferences, palletCargoCeiling, supportingPalletIds } from "./floor-pallets";
import { parseLoadingRules, parseOrientations, CARGO_TYPES, requiredSupport, applyTypeSupport } from "./loading-rules";
import { executionAudit } from "./execution";
import { bearingErrors, hasBearingRules, bearingStatus, contactArea } from "./bearing";
import {parseVehicleEngineering,reviewVehicleEngineering} from "./vehicle-engineering";
import type {
  ContainerSpec,
  PackingMode,
  LoadingRules,
  OrientationCode,
  PackingRequest,
  PackingResult,
  PackingStrategy,
  PlacedBox,
  PlacedPallet,
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
  retainsLoadedRows,
  selectProductsForMode,
} from "./set-utils";
import { estimateQuoteLoading } from "./quote-estimator";
import { roundedCartonVolumeCbm } from "./volume";

export const ENGINE_VERSION = "0.82.1";

function fixedPlanSupportGeometry(container:ContainerSpec,clearance:number,pallets:PlacedPallet[]=[]){
 const a=accessorySupportGeometry(container,clearance),b=palletDeckSupportGeometry(pallets);
 return {boxes:[...a.boxes,...b.boxes],products:[...a.products,...b.products]};
}

type Orientation = {
  dx: number;
  dy: number;
  dz: number;
  label: string;
};

type Point = { x: number; y: number; z: number; envelope?: boolean };

type EffectiveContainer = {
  length: number;
  width: number;
  height: number;
  doorWidth: number;
  doorHeight: number;
};

const EPS = 0.0001;
export const MAX_VISIBLE_PLACEMENTS = 20000;
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
  if (request.palletBuildStage && request.container.category === "pallet") return 1;
  return request.practicalTargetUtilization ?? recommendedPracticalTarget(request.container);
}

export function validateContainerInput(container: ContainerSpec, clearance: number): string | null {
  if (container.category !== undefined && !["container", "truck", "pallet", "other"].includes(container.category)) return "装载空间类别无效。";
  if (container.loadingAccess !== undefined && !["rear", "open"].includes(container.loadingAccess)) return "装载入口无效。";
  if (container.baseHeight !== undefined && (!Number.isFinite(container.baseHeight) || container.baseHeight < 0)) return "底座高度必须为非负有限数字。";
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
  try{parseVehicleEngineering(container.engineering,container);parseSiteExclusions(container.exclusions,container);if(containerAccessoryWeight(container)>container.maxWeight+EPS)return "Accessory planned mass exceeds payload / 附件计划重量超过装载上限";if(container.exclusions?.length&&availablePackingVolume(container,clearance)<=EPS)return "柜内区域已占满有效装载空间 / Site regions occupy the entire usable space";}catch(e){return e instanceof Error?e.message:"Invalid container engineering";}
  return null;
}

export function assertValidRequest(request: PackingRequest) {
  assertAccessorySupportWorkflow(request);
  if (request.palletBuildStage !== undefined && (request.palletBuildStage !== true || request.container.category !== "pallet" || request.container.loadingAccess !== "open" || request.mode !== "mixed")) throw new Error("Invalid pallet-building stage");
  if (request.palletCartonLimit !== undefined) {
    if (!request.palletBuildStage) throw new Error("Cartons per pallet require the pallet-building stage");
    parsePalletCartonLimit(request.palletCartonLimit);
  }
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
  if(accessoryProductErrors(request.container,new Set(selectProductsForMode(request.products,request.mode).map(p=>p.id))).length)throw Error("Unknown accessory cargo reference / 附件关联了不存在的货物");
  if(request.products.some(p=>(p.id.startsWith(SITE_EXCLUSION_PREFIX)||p.id.startsWith(DECK_SUPPORT_PREFIX))))throw Error("Reserved site region identifier / 产品 ID 使用了柜内区域保留前缀");
  if (request.floorPallets !== undefined) { parseFloorPalletConfig(request.floorPallets); if (request.products.some(p => p.id.startsWith("floor-pallet-"))) throw new Error("产品 ID 与底层托盘标识冲突。"); }
  if (request.loadingRules !== undefined) parseLoadingRules(request.loadingRules);
  const containerError = validateContainerInput(request.container, request.clearance);
  if (containerError) throw new Error(containerError);
  if (!Array.isArray(request.products) || request.products.length === 0) {
    throw new Error("请至少添加一个产品。");
  }

  assertOrderLineIds(request.products);
  const productIds = new Set<string>();
  for (const product of request.products) {
    if (!product.id || productIds.has(product.id)) throw new Error("产品 ID 不能为空或重复。");
    productIds.add(product.id);
    if (!product.sku?.trim()) throw new Error("产品 SKU 不能为空。");
    if (![product.length, product.width, product.height].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`${product.sku} 的外箱尺寸必须是大于 0 的有限数字。`);
    }
    if (product.allowedOrientations !== undefined) parseOrientations(product.allowedOrientations);
    const shape=parseShapeFields(product as unknown as Record<string, unknown>);
    if(shape.solidModel&&shape.solidModel.parts.reduce((n,p)=>n+(p.weight??0),0)>product.weight+EPS)throw new Error("部件和支架重量之和不能超过货物毛重。");
    if (product.cargoType !== undefined && !CARGO_TYPES.includes(product.cargoType)) throw new Error("货物类型无效。");
    if (product.minimumSupportRatio !== undefined && (!Number.isFinite(product.minimumSupportRatio) || product.minimumSupportRatio <= 0 || product.minimumSupportRatio > 1)) throw new Error("承托比例必须大于 0 且不超过 100%。");
    if (product.longSupport !== undefined) parseLongSupport(product.longSupport);
    if (product.palletBaseHeight !== undefined && (!Number.isFinite(product.palletBaseHeight) || product.palletBaseHeight < 0 || product.palletBaseHeight >= product.height)) throw new Error("货物托盘底座必须小于外箱总高。");
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
    doorWidth: Math.max(1, (container.loadingAccess === "open" ? container.width : container.doorWidth) - gap * 2),
    doorHeight: Math.max(1, (container.loadingAccess === "open" ? container.height : container.doorHeight) - gap),
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
      : Math.max(0, Math.floor(product.quantity || 0)),
  );
  const sourceTotal = sourceQuantities.reduce((sum, quantity) => sum + quantity, 0);
  const targetVolume = Math.min(1, Math.max(0, targetVolumeUtilization));
  const targetWeight = Math.min(1, Math.max(0, targetWeightUtilization));
  // This bound is rendered while editing. Invalid regions have no known capacity;
  // strict validation still rejects the draft before any packing or adoption.
  let effectiveVolume = 0;
  try { effectiveVolume = availablePackingVolume(request.container,request.clearance); }
  catch { /* Keep the form editable and the arithmetic recommendation at zero. */ }
  let floorSupports:PlacedPallet[]=[];
  if(request.floorPallets){try{floorSupports=arrangeFloorPallets(request.container,request.clearance,request.floorPallets);}catch{/* Geometry validation reports invalid layouts when packing; this is only an arithmetic bound. */}}
  let accessoryWeight=0;try{accessoryWeight=containerAccessoryWeight(request.container);if(!Number.isFinite(accessoryWeight)){effectiveVolume=0;accessoryWeight=0;}}catch{effectiveVolume=0;}
  const floorVolume=floorSupports.reduce((n,p)=>n+packagingReservedVolume(p),0),floorWeight=floorSupports.reduce((n,p)=>n+p.weight,0);
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
  const volumeLimitedTotal = averageUnitVolume > 0 ? Math.max(0, Math.floor(Math.max(0,effectiveVolume * targetVolume-floorVolume) / averageUnitVolume)) : 0;
  const weightLimitedTotal = averageUnitWeight > EPS
    ? Math.max(0, Math.floor(Math.max(0,Math.max(0, request.container.maxWeight || 0) * targetWeight-floorWeight-accessoryWeight) / averageUnitWeight))
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

export function getOrientations(product: ProductInput, deduplicate = true): Orientation[] {
  if (product.allowedOrientations) {
    const dimensions: Record<string, number> = { L: product.length, W: product.width, H: product.height };
    const seen = new Set<string>();
    return product.allowedOrientations.map(code => ({ dx: dimensions[code[0]], dy: dimensions[code[1]], dz: dimensions[code[2]], label: code })).filter(v => { const key = `${v.dx}:${v.dy}:${v.dz}`; if (deduplicate && cargoShapeOf(product)==="box" && !hasLongSupportLimits(product) && seen.has(key)) return false; seen.add(key); return true; });
  }
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
    if (cargoShapeOf(product)==="box" && !hasLongSupportLimits(product) && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A field plan may turn a carton 90 degrees on the floor, but never tips it
 * onto a side. `any` remains meaningful for the theoretical solver while the
 * worker solver deliberately keeps the factory-designated carton height.
 */
export function getPracticalOrientations(product: ProductInput): Orientation[] {
  if (product.allowedOrientations) return getOrientations(product);
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
    if (cargoShapeOf(product)==="box" && !hasLongSupportLimits(product) && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canPassDoor(orientation: Orientation, container: EffectiveContainer) {
  return orientation.dy <= container.doorWidth + EPS && orientation.dz <= container.doorHeight + EPS;
}

/** Necessary first-item checks only; passing does not prove that an order can be packed. */
export function inspectCargoFit(product: ProductInput, container: ContainerSpec, clearance = 0, strategy: PackingStrategy = "maximum") {
  const effective = effectiveContainer(container, clearance);
  const allowed = strategy === "practical" ? getPracticalOrientations(product) : getOrientations(product);
  const inside = allowed.filter(o => o.dx <= effective.length + EPS && o.dy <= effective.width + EPS && o.dz <= effective.height + EPS);
  const through = allowed.filter(o => canPassDoor(o, effective));
  const fitting = inside.filter(o => canPassDoor(o, effective));
  const reasons: string[] = [];
  if (!inside.length) reasons.push("当前允许朝向的外接尺寸均超出柜内净空，请核对尺寸单位或更换装载空间。");
  if (!through.length) reasons.push("当前允许朝向均无法通过门洞，请核对尺寸单位、朝向或门洞尺寸。");
  if (inside.length && through.length && !fitting.length) reasons.push("没有同一个允许朝向同时满足柜内净空和门洞尺寸。");
  if (fitting.length && product.solidModel) {
    const boxes = fitting.map(o => makePlacement(product, 0, {x:0,y:0,z:0}, o));
    const rest = boxes.filter(b => !modelRestError(b, product));
    if (!rest.length) reasons.push("适配柜体的朝向均缺少有效平底、允许受托面或防滚固定；请添加真实底座／支架并确认防滚，或调整允许受托面和朝向。");
    else if (!rest.some(b => supportDetails(b, new Map(), new Map([[product.id, product]])).ratio + EPS >= requiredSupport(product, strategy))) reasons.push("适配柜体的底面无法稳定支撑货物重心，请调整部件位置、配重或支架。");
  }
  if(hasLongSupportLimits(product)&&fitting.length&&fitting.every(o=>supportDetails(makePlacement(product,0,{x:0,y:0,z:0},o),new Map(),new Map([[product.id,product]])).longSupportError))reasons.push("当前适配的允许朝向均不能使指定原始底面 H− 朝下 / No fitting allowed orientation keeps the specified H− bottom face down");
  if (product.weight > container.maxWeight + EPS) reasons.push("单件毛重超过装载空间最大载重，请核对重量单位或更换装载空间。");
  return { effective, reasons };
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

function isInside(point: Point, box: Pick<PlacedBox,"x"|"y"|"z"|"dx"|"dy"|"dz">) {
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

  private readonly margin:number;
  private readonly bounds:EffectiveContainer;
  constructor(container: EffectiveContainer,margin=0) {
    this.margin=margin;this.bounds=container;
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
    const margin=this.margin,x=Math.max(0,box.x-margin),y=Math.max(0,box.y-margin),z=Math.max(0,box.z-margin);
    const expanded={x,y,z,dx:Math.min(this.bounds.length,box.x+box.dx+margin)-x,dy:Math.min(this.bounds.width,box.y+box.dy+margin)-y,dz:Math.min(this.bounds.height,box.z+box.dz+margin)-z};
    for (const key of this.keys(expanded)) {
      for (const index of this.cells.get(key) ?? []) result.add(index);
    }
    return result;
  }
}

function supportAreaDetails(
  candidate: PlacedBox,
  topLevels: Map<number, PlacedBox[]>,
  products: Map<string, ProductInput>,
) {
  const own=products.get(candidate.productId),ownPatches=bodyBottomPatches(candidate,products.get(candidate.productId)),coveredBottom=new Set<number>();
  if(modelRestError(candidate,own??{}))return {ratio:0,layer:1};
  if (candidate.z <= EPS) return { ratio: modelStable(candidate,own??{},bodyBottomPatches(candidate,own).map(s=>({...s,polygon:s.polygon??[[s.x,s.y],[s.x+s.dx,s.y],[s.x+s.dx,s.y+s.dy],[s.x,s.y+s.dy]]})))?1:0, layer: 1 };
  const supporters = topLevels.get(supportLevelKey(candidate.z)) ?? [];
  let supportedArea = 0;
  const contacts:import("./model-body").PolygonSurface[]=[];
  let layer = 1;
  for (const box of supporters) {
    const overlap = bodyContactArea(candidate,box,products.get(candidate.productId),products.get(box.productId));
    if (overlap > EPS) {
      // A carton touching a forbidden support still loads it, even if other
      // cartons supply enough area to pass the partial-support threshold.
      if (products.get(box.productId)?.stackable === false) return { ratio: 0, layer: Math.max(layer, (box.supportOnly ? 0 : box.layer || 1) + 1) };
      supportedArea += overlap;
      if(own?.solidModel)ownPatches.forEach((u,i)=>{for(const l of bodyTopPatches(box,products.get(box.productId),candidate.z)){const c=intersectSurface(u,l);if(c.coversOwn)coveredBottom.add(i);if(surfaceArea(c)>EPS)contacts.push({...c,polygon:surfacePolygon(c)});}});
      layer = Math.max(layer, (box.supportOnly ? 0 : box.layer || 1) + 1);
    }
  }
  const bottomArea=ownPatches.reduce((n,s)=>n+surfaceArea(s),0);
  return { ratio: bottomArea>EPS&&modelStable(candidate,own??{},contacts)?(ownPatches.every((_,i)=>coveredBottom.has(i))?1:Math.min(1, supportedArea / bottomArea)):0, layer };
}

/** Preserve the existing support-area/weight rules and add sourced geometric limits. */
function supportDetails(candidate:PlacedBox,topLevels:Map<number,PlacedBox[]>,products:Map<string,ProductInput>) {
  const area=supportAreaDetails(candidate,topLevels,products),own=products.get(candidate.productId);
  if(!hasLongSupportLimits(own))return {...area,longSupportError:undefined};
  const below=topLevels.get(supportLevelKey(candidate.z))??[];
  const pallets=below.filter(b=>b.supportOnly&&"presetId" in b) as unknown as PlacedPallet[];
  const row=inspectLongSupportPlacement(candidate,own,products,below.filter(b=>!b.supportOnly||b.supportEvidence),pallets);
  return {...area,longSupportError:longSupportViolation(row)};
}

function modelCandidatePoints(b:PlacedBox,p:ProductInput):Point[]{
  if(!p.solidModel)return [];
  const built=buildSolidModel(p.solidModel),gap=p.protectionGap??0,points:Point[]=[],axis=orientationAxes(b.orientation as OrientationCode,b.orientationSigns);
  for(const cell of built.display.slice(0,80))for(const v of cell.vertices.slice(0,48)){
    const world=axis.map(a=>a.negative?1-v[a.original]:v[a.original]);
    points.push({x:b.x+world[0]*b.dx+gap,y:b.y+world[1]*b.dy+gap,z:b.z});
  }
  const root=p.solidModel.parts[0];
  if(["cylinder","tube","polygon"].includes(root.kind)&&b.orientation[2]===root.axis){
    const extra=gap+2*built.error;
    points.push({x:b.x+b.dx*.5,y:b.y+b.dy*Math.sqrt(3)/2+extra,z:b.z},{x:b.x+b.dx*Math.sqrt(3)/2+extra,y:b.y+b.dy*.5,z:b.z});
  }
  return points.filter(p=>p.x>=0&&p.y>=0);
}

function indexSupport(levels:Map<number,PlacedBox[]>,box:PlacedBox,products:Map<string,ProductInput>) {
  for(const key of new Set(bodyTopLevels(box,products.get(box.productId)).map(supportLevelKey))) appendMapArray(levels,key,box);
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


/**
 * Turns a geometrically layered plan into an executable order. A box is made
 * available only after every supporting carton directly below it has been
 * loaded; among available boxes, the nose-most one is chosen first.
 */
function orderForLoading(placements: PlacedBox[], products: ProductInput[] = []) {
  const shapeRules=new Map(products.map(p=>[p.id,p]));
  const dependents = placements.map(() => [] as number[]);
  const remainingDependencies = placements.map(() => 0);
  const supportingLevels = new Map<number, number[]>();

  placements.forEach((box, index) => {
    for(const z of bodyTopLevels(box,shapeRules.get(box.productId))){
      const topKey = Math.round(z / EPS);
      const level = supportingLevels.get(topKey);
      if (level) level.push(index);
      else supportingLevels.set(topKey, [index]);
    }
  });

  for (let upperIndex = 0; upperIndex < placements.length; upperIndex += 1) {
    const upper = placements[upperIndex];
    if (upper.z <= EPS) continue;
    const lowerCandidates = supportingLevels.get(Math.round(upper.z / EPS)) ?? [];
    for (const lowerIndex of lowerCandidates) {
      const lower = placements[lowerIndex];
      if (bodyContactArea(upper,lower,shapeRules.get(upper.productId),shapeRules.get(lower.productId)) <= EPS) continue;
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

/** A certified envelope grid is a starting solution, never a proof that cavities are exhausted. */
function solidGridSeed(request:PackingRequest,container:EffectiveContainer,fieldLimit?:number){
  const product=request.products[0],strategy=packingStrategy(request),gap=product.protectionGap??0;
  const allowed=orientationsForStrategy(product,container,strategy).filter(o=>!modelRestError(makePlacement(product,0,{x:0,y:0,z:0},o),product));
  let best:PlacedBox[]=[];
  const accepts=(boxes:PlacedBox[])=>boxes.length>best.length&&validatePacking(boxes,request.container,request.clearance,request.products,strategy,request.mode).valid;
  if(!gap&&allowed.length){
    const proposal=packSingle({...request,products:[{...product,allowedOrientations:allowed.map(o=>o.label as OrientationCode)}]},container,fieldLimit);
    if(!('theoreticalCount' in proposal&&typeof proposal.theoreticalCount==='number'&&proposal.theoreticalCount>proposal.placements.length)&&accepts(proposal.placements))best=proposal.placements;
  }
  const volume=product.length*product.width*product.height;
  const limit=Math.min(MAX_VISIBLE_PLACEMENTS,4000,request.singleCartonLimit??Infinity,product.weight>0?Math.floor(request.container.maxWeight/product.weight):Infinity,fieldLimit??Infinity,strategy==='practical'?Math.max(1,Math.floor(container.length*container.width*container.height*practicalTarget(request)/volume)):Infinity);
  for(const o of allowed){
    const nx=Math.floor((container.length+gap)/(o.dx+gap)),ny=Math.floor((container.width+gap)/(o.dy+gap));
    const nz=Math.min(Math.floor(container.height/o.dz),product.bottomOnly||product.stackable===false?1:maxStackLayers(product)||Infinity);
    if(nx*ny*nz<=best.length)continue;
    const boxes:PlacedBox[]=[];
    for(let z=0;z<nz&&boxes.length<limit;z++)for(let y=0;y<ny&&boxes.length<limit;y++)for(let x=0;x<nx&&boxes.length<limit;x++)boxes.push(makePlacement(product,boxes.length,{x:x*(o.dx+gap),y:y*(o.dy+gap),z:z*o.dz},o,z+1));
    if(accepts(boxes))best=boxes;
    else {const floor=boxes.filter(b=>b.z===0);if(accepts(floor))best=floor;}
  }
  return best.length?{placements:best,warnings:[] as string[]}:undefined;
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

type RigidCandidateCheck = (candidate: PlacedBox, placed: readonly PlacedBox[]) => boolean;
function packMixedWithStrategy(request: PackingRequest, container: EffectiveContainer, sort: SortStrategy, anchors: PlacedBox[] = [], candidateCheck?: RigidCandidateCheck) {
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
  let spatial = new SpatialIndex(container,Math.max(0,...request.products.map(p=>p.protectionGap??0)));
  let topLevels = new Map<number, PlacedBox[]>();
  const fixed=accessorySupportGeometry(request.container,request.clearance);
  const buildSupports=request.palletBuildStage?[...fixed.boxes,...anchors.filter(b=>b.supportOnly)]:[];
  const bearingProducts=[...request.products,...fixed.products];
  const productMap = new Map(bearingProducts.map((product) => [product.id, product]));
  const orientationCache = new Map<string, Orientation[]>();
  const exclusions=siteExclusionBoxes(request.container,request.clearance);
  let points: Point[] = [{ x: 0, y: 0, z: 0, envelope: true }];
  let totalWeight = placements.reduce((n,b)=>n+b.weight,0)+containerAccessoryWeight(request.container);
  let totalVolume = placements.reduce((n,b)=>n+b.dx*b.dy*b.dz*bodyVolumeRatio(productMap.get(b.productId)??{}),0);
  let placementIndex = anchors.length ? 1 + Math.max(0,...placements.map(b=>Number(b.id.split("-").at(-1))||0)) : 0;
  const blockedSetCodes = new Set<string>();
  const strategy = packingStrategy(request);
  const pointOrder = (request.loadingRules?.layout === "deep-first" || (request.loadingRules?.layout !== "layers" && strategy === "practical"))
    ? (a:Point,b:Point) => a.x-b.x || a.z-b.z || a.y-b.y
    : (a:Point,b:Point) => a.z-b.z || a.y-b.y || a.x-b.x;
  const pointKey = (p:Point) => `${p.x.toFixed(3)}|${p.y.toFixed(3)}|${p.z.toFixed(3)}`;
  const selectPoints = (list:Point[],budget:number) => {
    const sorted=[...list].sort(pointOrder),essential=sorted.filter(p=>p.envelope).slice(0,Math.floor(budget/2)),keys=new Set(essential.map(pointKey));
    return [...essential,...sorted.filter(p=>!keys.has(pointKey(p))).slice(0,budget-essential.length)].sort(pointOrder);
  };
  const volumeLimit = availablePackingVolume(request.container,request.clearance) * practicalTarget(request);

  const rebuildIndexes = () => {
    spatial = new SpatialIndex(container,Math.max(0,...request.products.map(p=>p.protectionGap??0)));
    topLevels = new Map<number, PlacedBox[]>();
    fixed.boxes.forEach(b=>indexSupport(topLevels,b,productMap));
    placements.forEach((box, index) => {
      spatial.add(box, index);
      indexSupport(topLevels,box,productMap);
    });
  };

  rebuildIndexes();
  if (anchors.length||exclusions.length) {
    for(const b of [...anchors,...exclusions]){
      const product=productMap.get(b.productId),gap=product?.protectionGap??0;
      const additions:Point[]=[
        {x:b.x+b.dx+gap,y:b.y,z:b.z,envelope:true},{x:b.x,y:b.y+b.dy+gap,z:b.z,envelope:true},{x:b.x,y:b.y,z:b.z+b.dz,envelope:true},
        {x:0,y:b.y,z:b.z+b.dz,envelope:true},{x:b.x,y:0,z:b.z+b.dz,envelope:true},{x:b.x+b.dx+gap,y:0,z:0,envelope:true},
        ...(product?modelCandidatePoints(b,product):[]),
      ];
      for(const point of additions)points.push(point);
      // Detailed curved models may contribute hundreds of points per anchor.
      // Stream into the bounded pool instead of creating a huge call-argument array.
      if(points.length>12800)points=selectPoints(points,strategy==='maximum'?3200:1600);
    }
    const unique=new Map(points.map(p=>[pointKey(p),p]));
    points=selectPoints([...unique.values()],strategy==='maximum'?3200:1600);
  }
  const placeProduct = (product: ProductInput) => {
    if (totalWeight + product.weight > request.container.maxWeight + EPS) return false;
    let orientations = orientationCache.get(product.id);
    if (!orientations) {
      orientations = orientationsForStrategy(product, container, strategy).filter(o => !modelRestError(makePlacement(product, 0, {x:0,y:0,z:0}, o), product));
      orientationCache.set(product.id, orientations);
    }
    if (orientations.length === 0) return false;

    let best: { point: Point; orientation: Orientation; layer: number; score: number; palletIds: string[] } | undefined;
    const depthMultiplier = request.loadingRules?.search === "deep" ? 2 : 1;
    const candidateBudget = (strategy === "maximum" ? 2600 : 1200) * depthMultiplier;
    const retainedPointBudget = (strategy === "maximum" ? 3200 : 1600) * depthMultiplier;
    const candidatePoints = selectPoints(points,candidateBudget);
    for (const point of candidatePoints) {
      for (const orientation of orientations) {
        const candidate = makePlacement(product, placementIndex, point, orientation);
        const palletFloor = request.floorPallets && Math.abs(candidate.z - request.floorPallets.height) < EPS || buildSupports.some(b=>Math.abs(b.z+b.dz-candidate.z)<EPS&&contactArea(candidate,b)>EPS);
        if (request.floorPallets && !request.floorPallets.allowFloorCargo && candidate.z <= EPS) continue;
        if (
          candidate.x + candidate.dx > container.length + EPS ||
          candidate.y + candidate.dy > container.width + EPS ||
          candidate.z + candidate.dz > container.height + EPS ||
          (product.bottomOnly === true && candidate.z > EPS && !palletFloor)
        ) {
          continue;
        }
        const topPenalty = (request.loadingRules?.layout === "deep-first" || (request.loadingRules?.layout !== "layers" && strategy === "practical"))
          ? candidate.x * 1_000_000_000
          : candidate.z * 1_000_000_000;
        const sidePenalty = (request.loadingRules?.layout === "deep-first" || (request.loadingRules?.layout !== "layers" && strategy === "practical"))
          ? candidate.z * 1_000_000 + candidate.y * 100
          : candidate.y * 1_000_000 + candidate.x * 100;
        const compactness = candidate.x + candidate.dx + candidate.y + candidate.dy + candidate.z + candidate.dz;
        const score = topPenalty + sidePenalty + compactness;
        if (best && score >= best.score) continue;
        let collides = false;
        for (const index of spatial.query(candidate)) {
          if (bodiesOverlap(candidate, placements[index],product,productMap.get(placements[index].productId))) {
            collides = true;
            break;
          }
        }
        if (collides||exclusions.some(b=>bodiesOverlap(candidate,b,product,undefined))) continue;
        const support = supportDetails(candidate, topLevels, productMap);
        const palletIds = supportingPalletIds(candidate, topLevels.get(supportLevelKey(candidate.z)) ?? []);
        if (request.floorPallets && palletIds.length && candidate.z + candidate.dz > palletCargoCeiling(request.container, request.clearance, request.floorPallets) + EPS) continue;
        const layerLimit = maxStackLayers(product);
        if (support.longSupportError || support.ratio + EPS < requiredSupport(product, strategy) || (layerLimit > 0 && support.layer > layerLimit)) continue;
        if (bearingProducts.some(hasBearingRules) && bearingErrors([...fixed.boxes,...placements, candidate], bearingProducts).length) continue;

        if (candidateCheck && !candidateCheck(candidate, placements)) continue;
        if (!best || score < best.score) best = { point, orientation, layer: support.layer, score, palletIds };
      }
    }

    if (!best) return false;
    const placed = { ...makePlacement(product, placementIndex, best.point, best.orientation, best.layer), palletIds: best.palletIds.length ? best.palletIds : undefined };
    placements.push(placed);
    spatial.add(placed, placements.length - 1);
    totalWeight += product.weight;
    totalVolume += product.length * product.width * product.height * bodyVolumeRatio(product);
    placementIndex += 1;
    indexSupport(topLevels,placed,productMap);

    const additions: Point[] = [
      ...cargoBodyParts(placed,product).flatMap(b=>[{x:b.x,y:b.y,z:b.z+b.dz},{x:b.x+b.dx+(product.protectionGap??0),y:b.y,z:b.z},{x:b.x,y:b.y+b.dy+(product.protectionGap??0),z:b.z}]),
      ...modelCandidatePoints(placed,product),
      { x: placed.x + placed.dx+(product.protectionGap??0), y: placed.y, z: placed.z, envelope: true },
      { x: placed.x, y: placed.y + placed.dy+(product.protectionGap??0), z: placed.z, envelope: true },
      { x: placed.x, y: placed.y, z: placed.z + placed.dz, envelope: true },
    ];
    const next = [...points.filter((point) => !cargoBodyParts(placed,product).some(b=>isInside(point,b))).map(point=>point.envelope&&isInside(point,placed)?{...point,envelope:false}:point), ...additions].filter(
      (point) => point.x < container.length - EPS && point.y < container.width - EPS && point.z < container.height - EPS,
    );
    const unique = new Map<string,Point>();
    for(const point of next){const key=pointKey(point),old=unique.get(key);if(!old||point.envelope&&!old.envelope)unique.set(key,point);}
    points = selectPoints([...unique.values()],retainedPointBudget);
    return true;
  };

  const failedProductRevision = new Map<string, number>();
  const cartonLimit = request.palletCartonLimit ?? Infinity;
  for (const batch of batches) {
    const slots = cartonLimit - (placements.length - anchors.length);
    if (slots <= 0) break;
    if (batch.items.length > slots) continue;
    if (batch.setCode && blockedSetCodes.has(batch.setCode)) continue;
    const batchVolume = batch.items.reduce((sum, product) => sum + product.length * product.width * product.height * bodyVolumeRatio(product), 0);
    if (strategy === "practical" && totalVolume > EPS && totalVolume + batchVolume > volumeLimit + EPS) {
      if (batch.setCode) blockedSetCodes.add(batch.setCode);
      continue;
    }
    if (!batch.setCode) {
      const product = batch.items[0];
      // Identical cargo cannot succeed while coordinates, supports and remaining payload are unchanged.
      // A later SKU may add support, so retry after any successful placement changes this revision.
      if (failedProductRevision.get(product.id) !== placements.length && !placeProduct(product)) failedProductRevision.set(product.id, placements.length);
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

function packMixed(request: PackingRequest, container: EffectiveContainer, anchors: PlacedBox[] = [], candidateCheck?: RigidCandidateCheck) {
  const requested = request.products.reduce((sum, item) => sum + Math.max(0, Math.floor(item.quantity)), 0);
  // Both solvers may learn from the same multi-start ordering ideas, but every
  // candidate is rebuilt under that solver's own orientation/support rules.
  // This lets theory guide field search without copying an unsafe theoretical
  // placement into the practical output.
  const volumeOrder: SortStrategy = (a, b) => compareRequired(a, b) || b.priority - a.priority || (request.loadingRules?.cargoOrder === "small-first" ? 1 : -1) * (a.length*a.width*a.height - b.length*b.width*b.height);
  const variants = request.loadingRules?.cargoOrder && request.loadingRules.cargoOrder !== "auto" ? [volumeOrder] : request.loadingRules?.search === "deep" ? [...strategies, (a: ProductInput,b: ProductInput) => compareRequired(a,b) || b.priority-a.priority || b.weight-a.weight, (a: ProductInput,b: ProductInput) => compareRequired(a,b) || b.priority-a.priority || a.height-b.height] : strategies;
  const activeStrategies = request.searchPass !== undefined ? [variants[Math.abs(request.searchPass) % variants.length]] : requested > 4000 && request.loadingRules?.search !== "deep" ? variants.slice(0, 2) : variants;
  let best: PlacedBox[] = [];
  let bestScore = -1;
  let bestEngineeringValid=false;
  const engineering=request.container.engineering?{
    container:request.container,clearance:request.clearance,
    pallets:request.floorPallets?arrangeFloorPallets(request.container,request.clearance,request.floorPallets):[],
    cargoDetails:Object.fromEntries(request.products.map(p=>[p.id,shapeDetails(p)])),
  }:undefined;
  const attemptedOrders=new Set<string>();
  for (const strategy of activeStrategies) {
    const order=[...request.products].sort(strategy).map(p=>p.id).join('\u0000');
    if(attemptedOrders.has(order))continue;
    attemptedOrders.add(order);
    const placements = packMixedWithStrategy(request, container, strategy, anchors, candidateCheck);
    const score = weightedScore(placements, request.products);
    const engineeringValid=!engineering||reviewVehicleEngineering({...engineering,placements:placements.filter(p=>!p.supportOnly)})!.state!=="fail";
    if (engineeringValid&&!bestEngineeringValid||engineeringValid===bestEngineeringValid&&score>bestScore) {
      best = placements;
      bestScore = score;
      bestEngineeringValid=engineeringValid;
    }
  }
  const warnings = requested > MAX_VISIBLE_PLACEMENTS
    ? [`订单共 ${requested.toLocaleString()} 件；为保证浏览器稳定，当前单次方案最多生成 ${MAX_VISIBLE_PLACEMENTS.toLocaleString()} 个真实箱体坐标。`]
    : [];
  return { placements: best, warnings };
}

function calculateCenterOfGravity(placements: PlacedBox[], container: EffectiveContainer, products:ProductInput[]=[]) {
  const rules=new Map(products.map(p=>[p.id,p]));
  let totalMass = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightedZ = 0;
  for (const box of placements) {
    const mass = box.weight > 0 ? box.weight : (box.dx * box.dy * box.dz) / 1_000_000_000;
    totalMass += mass;
    const center=box.supportOnly&&"packaging" in box ? packagingMassCenter(box as unknown as PlacedPallet) : modelMassCenter(box,rules.get(box.productId)??{});
    weightedX += center[0] * mass;weightedY += center[1] * mass;weightedZ += center[2] * mass;
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
  pallets: PlacedPallet[] = [],
  floorConfig?: PackingRequest["floorPallets"],
  palletization?: import("./prebuilt-pallets").Palletization,
): ValidationReport {
  if (!Array.isArray(placements) || !Array.isArray(pallets)) return {valid:false,errors:["货物和托盘坐标必须是数组。"]};
  for(const p of products){try{parseShapeFields(p as unknown as Record<string,unknown>);}catch(e){return {valid:false,errors:[e instanceof Error?e.message:"Invalid cargo shape"]};}}
  const cargo = placements;
  const deckConfigured=pallets.some(p=>p.packaging?.deckSupports!==undefined)||palletization?.config?.packaging?.deckSupports!==undefined||palletization?.specifications?.some(s=>s.config.packaging?.deckSupports!==undefined);
  if(palletization || deckConfigured){
    if(!palletization)return {valid:false,errors:["Deck supports require validated prebuilt specifications / 托内支承件需要有效的预打托规格"]};
    try{const issues=validatePalletizedCargo(cargo,pallets,container,clearance,palletization,products);if(issues.length)return {valid:false,errors:issues};}catch(e){return {valid:false,errors:[e instanceof Error?e.message:"Invalid deck supports"]};}
  }
  if(hasAccessorySupports(container)&&palletization)return {valid:false,errors:[SUPPORT_WORKFLOW_ERROR]};
  if(products.some(p=>(p.id.startsWith(SITE_EXCLUSION_PREFIX)||p.id.startsWith(DECK_SUPPORT_PREFIX))))return {valid:false,errors:["Reserved site region identifier / 产品 ID 使用了柜内区域保留前缀"]};
  if (cargo.some(b=>b?.supportOnly||b?.supportEvidence||typeof b?.id==="string"&&(b.id.startsWith(SITE_EXCLUSION_PREFIX)||b.id.startsWith(DECK_SUPPORT_PREFIX)))) return {valid:false,errors:["货物记录不能伪装为托盘支撑。"]};
  if (floorConfig) {try {parseFloorPalletConfig(floorConfig);}catch(e){return {valid:false,errors:[e instanceof Error?e.message:"托盘配置无效。"]};}}
  if (pallets.length) {
    if (pallets.length > 200 || new Set(pallets.map(p => p.id)).size !== pallets.length || pallets.some(p => !p || typeof p.id !== "string" || !p.id.trim() || (p.id.startsWith(SITE_EXCLUSION_PREFIX)||p.id.startsWith(DECK_SUPPORT_PREFIX)) || typeof p.name!=="string" || typeof p.presetId!=="string" || p.locked!==undefined&&typeof p.locked!=="boolean" || p.quarterTurns!==undefined&&(!Number.isInteger(p.quarterTurns)||p.quarterTurns<0||p.quarterTurns>3||p.quarterTurns%2!==(p.orientation==="WLH"?1:0)) || !["LWH","WLH"].includes(p.orientation) || (palletization ? p.z < 0 : p.z !== 0) || ![p.x,p.y,p.z,p.dx,p.dy,p.dz,p.weight,p.maxLoad].every(Number.isFinite) || p.dx <= 0 || p.dy <= 0 || p.dz <= 0 || p.weight < 0 || p.maxLoad <= 0 || cargo.some(b => b.id === p.id || b.productId === p.id))) return {valid:false,errors:["底层托盘坐标、承重或标识无效。"]};
    placements = orderForLoading([...palletAnchors(pallets), ...cargo],products);
    products = [...products, ...palletSupportProducts(pallets)];
  }
  if(!palletization&&pallets.some(p=>p.measuredEnvelope))return {valid:false,errors:["Measured unit envelopes require prebuilt pallets / 实测整托包络需要预打托方案"]};
  const supportIds = new Set(pallets.map(p => p.id));
  const containerError = validateContainerInput(container, clearance);
  if (containerError) return { valid: false, errors: [containerError] };
  if (!Array.isArray(placements)) return { valid: false, errors: ["箱体坐标必须是数组。"] };
  if (mode !== "single" && mode !== "mixed") return { valid: false, errors: ["计算模式无效。"] };
  const effective = effectiveContainer(container, clearance);
  const exclusions=siteExclusionBoxes(container,clearance);
  const fixed=fixedPlanSupportGeometry(container,clearance,pallets);
  products=[...products,...fixed.products];
  const obstacles=[...exclusions,...fixed.boxes.filter(b=>b.id.startsWith(DECK_SUPPORT_PREFIX))];
  const errors: string[] = [];
  const spatial = new SpatialIndex(effective,Math.max(0,...products.map(p=>p.protectionGap??0)));
  const topLevels = new Map<number, PlacedBox[]>();
  const productMap = new Map(products.map(p=>withShapeSupport({...p,...parseShapeFields(p as unknown as Record<string,unknown>)})).map((product) => [product.id, product]));
  fixed.boxes.forEach(b=>indexSupport(topLevels,b,productMap));
  if (productMap.size !== products.length) errors.push("产品资料存在重复 ID，无法独立核对箱体归属。");
  const placementIds = new Set<string>();
  const orientationsByProduct = new Map<string, Set<string>>();
  let totalWeight = containerAccessoryWeight(container);
  for (let index = 0; index < placements.length; index += 1) {
    const box = placements[index];
    const product = productMap.get(box.productId);
    const isPallet = supportIds.has(box.id);
    if(!validOrientationSigns(box.orientation,box.orientationSigns)||!["LWH","LHW","WLH","WHL","HLW","HWL"].includes(box.orientation)){errors.push("箱体旋转方向无效。");continue;}
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
    for(const zone of obstacles)if(bodiesOverlap(box,zone,product,undefined))errors.push(`${box.sku}: 柜内障碍或禁占区 / Site exclusion: ${zone.name}`);
    for (const otherIndex of spatial.query(box)) {
      if (bodiesOverlap(box, placements[otherIndex],product,productMap.get(placements[otherIndex].productId))) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 与箱体 ${otherIndex + 1} 重叠。`);
        break;
      }
    }
    if (!isPallet && floorConfig && !floorConfig.allowFloorCargo && box.z <= EPS) errors.push(`${box.sku} 必须装在底层托盘上。`);
    if (product) {
      if (box.sku !== product.sku) errors.push(`${box.sku || `箱体 ${index + 1}`} 的 SKU 与产品资料 ${product.sku} 不一致。`);
      if (Math.abs(box.weight - product.weight) > EPS) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 重量与产品资料不一致。`);
      }
      const allowedOrientation = getOrientations(product, false).some(
        (orientation) =>
          Math.abs(orientation.dx - box.dx) <= EPS &&
          Math.abs(orientation.dy - box.dy) <= EPS &&
          Math.abs(orientation.dz - box.dz) <= EPS && ((!product.allowedOrientations&&cargoShapeOf(product)==="box") || orientation.label === box.orientation),
      );
      if (!allowedOrientation) errors.push(`${box.sku} 的箱体 ${index + 1} 使用了未允许的摆放方向。`);
      if (strategy === "practical" && !product.allowedOrientations && Math.abs(box.dz - positive(product.height)) > EPS) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 在现场易执行方案中发生侧翻；现场模式只允许保持原包装高度。`);
      }
      if (product.bottomOnly === true && box.z > EPS && !(pallets.some(p=>Math.abs(box.z-p.z-p.dz)<EPS&&contactArea(box,palletAnchors([p])[0])>EPS)||fixed.boxes.some(b=>b.id.startsWith(DECK_SUPPORT_PREFIX)&&Math.abs(b.z+b.dz-box.z)<EPS&&contactArea(box,b)>EPS)||container.category==="pallet"&&fixed.boxes.some(b=>Math.abs(b.z+b.dz-box.z)<EPS&&contactArea(box,b)>EPS))) errors.push(`${box.sku} 的箱体 ${index + 1} 未按“必须底置”规则放在柜底。`);
      if (!canPassDoor({ dx: box.dx, dy: box.dy, dz: box.dz, label: box.orientation }, effective)) {
        errors.push(`${box.sku} 的箱体 ${index + 1} 无法按当前方向通过门洞。`);
      }
      const orientations = orientationsByProduct.get(box.productId) ?? new Set<string>();
      orientations.add(`${box.dx}:${box.dy}:${box.dz}`);
      orientationsByProduct.set(box.productId, orientations);
    }
    const support = supportDetails(box, topLevels, productMap);
    if (!isPallet && box.layer !== support.layer) {
      errors.push(`${box.sku} 的箱体 ${index + 1} 标注为第 ${box.layer} 层，按支撑关系应为第 ${support.layer} 层。`);
    }
    if (!isPallet && support.longSupportError) errors.push(support.longSupportError);
    const supportThreshold = requiredSupport(product, strategy);
    if(product?.solidModel&&box.z<=EPS&&support.ratio+EPS<supportThreshold)errors.push(`${box.sku} 的实体模型缺少稳定平底、有效承托面或防滚支架。`);
    // Crate decks use the independently checked four-path column, not cargo below the lid.
    const crateDeck = isPallet && palletization && pallets.some(p=>p.id===box.id&&p.packaging&&p.packaging.enclosure!=="none");
    if (box.z > EPS && support.ratio + EPS < supportThreshold && !crateDeck) {
      errors.push(`${box.sku} 的箱体 ${index + 1} 底面支撑不足 ${(supportThreshold * 100).toFixed(1)}%。`);
    }
    const layerLimit = product ? maxStackLayers(product) : 0;
    if (layerLimit > 0 && support.layer > layerLimit) {
      errors.push(`${box.sku} 的箱体 ${index + 1} 超过允许的第 ${layerLimit} 层。`);
    }
    spatial.add(box, index);
    const palletIds = isPallet ? [box.id] : supportingPalletIds(box, topLevels.get(supportLevelKey(box.z)) ?? []);
    if (!isPallet && floorConfig && palletIds.length && box.z + box.dz > palletCargoCeiling(container, clearance, floorConfig) + EPS) errors.push(`${box.sku} 超出托盘货物限高或整托门洞净高。`);
    indexSupport(topLevels,{...box,palletIds},productMap);
    totalWeight += product?.weight ?? box.weight;
    if (errors.length >= 20) break;
  }
  if (strategy === "practical") {
    for (const [productId, orientations] of orientationsByProduct) {
      const product = productMap.get(productId);
      const heights = new Set([...orientations].map((orientation) => orientation.split(":")[2]));
      if (!product?.allowedOrientations && (orientations.size > 2 || heights.size > 1 || (orientations.size > 1 && rotationPolicy(product!) === "fixed"))) {
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
      if (actualNumbers.length !== expectedNumbers.length || (!palletization?.editRevision && actualNumbers.some((number, index) => number !== expectedNumbers[index]))) {
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
  errors.push(...bearingErrors([...fixed.boxes,...placements], products));
  if(!errors.length&&container.engineering){
    const engineering=reviewVehicleEngineering({container,clearance,placements:cargo,pallets,palletization,cargoDetails:Object.fromEntries(products.map(p=>[p.id,shapeDetails(p)]))});
    errors.push(...engineering?.errors??[]);
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
      loadedVolume: loaded * product.length * product.width * product.height * bodyVolumeRatio(product),
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
  pallets: PlacedPallet[] = [],
  fixed:ReturnType<typeof fixedPlanSupportGeometry>={boxes:[],products:[]},
): PackingResult["metrics"]["executionComplexity"] {
  products=[...products,...fixed.products];
  const orientationsByProduct = new Map<string, Set<string>>();
  const productMap = new Map(products.map(p=>withShapeSupport({...p,...parseShapeFields(p as unknown as Record<string,unknown>)})).map((product) => [product.id, product]));
  const topLevels = new Map<number, PlacedBox[]>();
  for (const b of [...palletAnchors(pallets),...fixed.boxes]) indexSupport(topLevels,b,productMap);
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
    indexSupport(topLevels,box,productMap);
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
  const normalizedProducts = applyTypeSupport(request.products, request.loadingRules).map((product) => ({
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
  const effectiveVolume = availablePackingVolume(normalized.container,normalized.clearance);
  const pallets = normalized.floorPallets ? arrangeFloorPallets(normalized.container, normalized.clearance, normalized.floorPallets) : [];
  const supports = palletAnchors(pallets);
  const palletWeight = supports.reduce((n,b)=>n+b.weight,0);
  if (palletWeight > normalized.container.maxWeight + EPS) throw new Error("底层托盘自重已超过柜型最大载重。");
  const preliminaryQuoteEstimate = normalized.floorPallets||normalized.container.exclusions?.length||normalized.container.engineering ? undefined : estimateQuoteLoading(normalized, effectiveVolume, 0);
  const defaultPracticalTarget = recommendedPracticalTarget(normalized.container);
  const challengesHistoricalBaseline = normalized.practicalTargetUtilization! >= defaultPracticalTarget + 0.01 - EPS;
  const fieldPracticalSetLimit = normalized.strategy === "practical" &&
    !challengesHistoricalBaseline &&
    preliminaryQuoteEstimate?.source === "historical-exact" &&
    preliminaryQuoteEstimate.physicallyPossibleByBounds
    ? preliminaryQuoteEstimate.predictedSets
    : undefined;
  const bearingEnabled = !!normalized.container.engineering || normalized.products.some(p => p.solidModel || p.protectionGap || isRectilinearShape(p) || hasLongSupportLimits(p) || hasBearingRules(p) || p.minimumSupportRatio !== undefined) || (normalized.loadingRules?.layout !== undefined && normalized.loadingRules.layout !== "auto");
  const cartonsPerUnit = normalized.products.reduce((sum,p)=>sum+(setCode(p)?unitsPerSet(p):1),0);
  const unitVolume = normalized.products.reduce((sum,p)=>sum+p.length*p.width*p.height*bodyVolumeRatio(p)*(setCode(p)?unitsPerSet(p):1),0);
  const bearingUnitLimit = Math.min(Math.floor(4000/cartonsPerUnit), Math.floor(effectiveVolume/unitVolume), Math.floor((normalized.singleCartonLimit ?? 4000)/cartonsPerUnit));
  const bearingRequest: PackingRequest = normalized.mode === "single" && bearingEnabled ? { ...normalized, mode: "mixed", products: normalized.products.map(p => ({ ...p, quantity: bearingUnitLimit*(setCode(p)?unitsPerSet(p):1) })) } : normalized;
  const palletUnitVolume = normalized.products.reduce((n,p)=>n+p.length*p.width*p.height*bodyVolumeRatio(p)*(setCode(p)?unitsPerSet(p):1),0);
  const palletUnitWeight = normalized.products.reduce((n,p)=>n+p.weight*(setCode(p)?unitsPerSet(p):1),0);
  const palletUnitCount = normalized.products.reduce((n,p)=>n+(setCode(p)?unitsPerSet(p):1),0);
  const palletUnitLimit = Math.max(0, Math.floor(Math.min((effectiveVolume-pallets.reduce((n,p)=>n+packagingReservedVolume(p),0))/palletUnitVolume, (MAX_VISIBLE_PLACEMENTS-pallets.length)/palletUnitCount, (normalized.singleCartonLimit??MAX_VISIBLE_PLACEMENTS)/palletUnitCount, palletUnitWeight>0?(normalized.container.maxWeight-palletWeight-containerAccessoryWeight(normalized.container))/palletUnitWeight:Infinity)));
  const palletRequest: PackingRequest = {...normalized, products: [...normalized.products.map(p=>normalized.mode==="single"?{...p,quantity:palletUnitLimit*(setCode(p)?unitsPerSet(p):1)}:p), ...palletSupportProducts(pallets).map(p=>({...p,quantity:0}))]};
  let certifiedGrid:{placements:PlacedBox[];warnings:string[]}|undefined;
  if(!normalized.container.exclusions?.length&&!normalized.container.engineering&&!pallets.length&&normalized.mode==='single'&&normalized.products.length===1&&normalized.products[0].solidModel&&!setCode(normalized.products[0])){
    const seed=solidGridSeed(normalized,effective,fieldPracticalSetLimit),product=normalized.products[0];
    if(seed){
      const reachedLimit=product.weight>0&&seed.placements.length>=Math.floor(normalized.container.maxWeight/product.weight)||normalized.singleCartonLimit!==undefined&&seed.placements.length>=normalized.singleCartonLimit;
      certifiedGrid=normalized.strategy==='practical'||reachedLimit?seed:packMixed(bearingRequest,effective,seed.placements);
    }
  }
  const output = certifiedGrid ?? (pallets.length||normalized.container.exclusions?.length ? packMixed(palletRequest, effective, supports) : bearingEnabled ? packMixed(bearingRequest, effective) : normalized.mode === "single"
    ? packSingle(normalized, effective, fieldPracticalSetLimit)
    : packMixed(normalized, effective));
  // Solvers may discover the final geometry layer-by-layer. Playback, exports
  // and field instructions must instead follow a physically executable route:
  // finish the container nose first, load every direct support before the box
  // above it, and then advance toward the doors.
  const orderedPlacements = assignPalletReferences(orderForLoading(output.placements.filter(b=>!b.supportOnly),normalized.products), pallets, normalized.products);
  const validation = validatePacking(
    orderedPlacements,
    normalized.container,
    normalized.clearance,
    normalized.products,
    normalized.strategy,
    normalized.mode,
    pallets, normalized.floorPallets,
  );
  const theoreticalCount =
    "theoreticalCount" in output && typeof output.theoreticalCount === "number" ? output.theoreticalCount : undefined;
  const summaries = buildSummaries(normalized, orderedPlacements, theoreticalCount);
  const setSummaries = buildSetSummaries(normalized, summaries);
  const loadedVolume = summaries.reduce((sum, item) => sum + item.loadedVolume, 0) + pallets.reduce((n,p)=>n+packagingReservedVolume(p),0);
  const grossWeight = summaries.reduce((sum, item) => sum + item.loadedWeight, 0) + palletWeight + containerAccessoryWeight(normalized.container);
  const requestedCount = summaries.reduce((sum, item) => sum + item.requested, 0);
  const loadedCount = summaries.reduce((sum, item) => sum + item.loaded, 0);
  const centerOfGravity = calculateCenterOfGravity([...supports, ...orderedPlacements,...accessoryMassBoxes(normalized.container,normalized.clearance)], effective, normalized.products);
  const executionComplexity = calculateExecutionComplexity(orderedPlacements, normalized.products, pallets,fixedPlanSupportGeometry(normalized.container,normalized.clearance,pallets));
  const physicalLoadedSets = normalized.mode === "single"
    ? setSummaries[0]?.loadedSets ?? loadedCount
    : 0;
  const quoteEstimate = pallets.length||normalized.container.exclusions?.length||normalized.container.engineering ? undefined : estimateQuoteLoading(normalized, effectiveVolume, physicalLoadedSets);
  const warnings = [...output.warnings];
  if(hasAccessorySupports(normalized.container))warnings.unshift("已声明的落地实心支承件参与接触与输入静载上限校验；未知额定值、材料强度及动态载荷未核验 / Declared solid floor supports participate in contact and entered static load limits; missing ratings, material strength and dynamics remain unverified");
  if(normalized.container.exclusions?.length&&!hasAccessorySupports(normalized.container))warnings.unshift("柜内障碍与禁占区已用于当前包络求解和独立校验；区域不提供承托、不计作货物；附件计划重量单独计入 / Site regions constrain packing and validation; accessory planned mass is recorded separately, with no added cargo count or support");
  if (pallets.length) warnings.unshift(`底层托盘 ${pallets.length} 个，自重 ${palletWeight} kg；货物 Z 坐标已包含托盘高度 ${normalized.floorPallets!.height} mm，托盘单独记录，不计入货物箱数。`);
  const bearingCheck = bearingStatus(orderedPlacements, normalized.products);
  if (!bearingCheck.verified) warnings.push(`承重未核验：${bearingCheck.unknownIds.length} 个受压箱体尚未填写该朝向的承重参数；几何通过不代表承重已确认。`);
  if (normalized.products.some(p => (p.minimumSupportRatio ?? 1) < 0.995)) warnings.push("已按自定义承托比例计算；承重能力仍需按包装参数核验。");
  if (normalized.products.some(p => !p.solidModel&&["drum", "roll", "loose"].includes(p.cargoType ?? ""))) warnings.push("圆桶、卷材和散件按矩形外包络计算，不进行圆形交错嵌套。");
  if (normalized.products.some(p => !p.solidModel&&cargoShapeOf(p) !== "box")) warnings.push("规则型件按实际组成块校验碰撞、水平承托面和空隙；曲面与其他异型件仍按外包络占位。测量与重心仍按外包络估算。");
  if(normalized.products.some(p=>p.solidModel))warnings.push("实体模型使用相同的凸体分解校验碰撞、平面承托和空隙；曲面使用保守外逼近，弯管有明确误差范围。几何通过不代表材料强度已核验。");
  if (normalized.container.specificationNote) warnings.push(normalized.container.specificationNote);
  if (normalized.loadingRules || normalized.products.some(p => p.allowedOrientations)) warnings.push("已启用自定义布局、朝向或承托规则，独立校验使用相同约束。");
  if(normalized.products.some(p=>p.longSupport!==undefined))warnings.push("长条箱承托：来源、版本、上限与箱规齐全且接触面适用时，求解与箱位采用执行同一几何限制；缺资料仍未核验，材料强度未核验。 / Long-carton support: complete bound evidence uses the same geometric limits in solving and placement acceptance. Missing data and material strength remain unverified.");
  if (normalized.products.some(hasBearingRules)) warnings.push("已启用逐箱上方累计承重约束，按接触面积分配静态竖向载荷；结果可能比无承重约束的排列更保守。");
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
  if (normalized.strategy === "practical" && !normalized.products.some(p => p.allowedOrientations || p.minimumSupportRatio !== undefined)) {
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
    delivery:orderDelivery(normalized.products,request.delivery),accessConfig:parseAccessConfig(request.accessConfig),
    id: `plan-${Date.now()}-${normalized.strategy}`,
    mode: normalized.mode,
    strategy: normalized.strategy!,
    practicalTargetUtilization: normalized.practicalTargetUtilization!,
    singleCartonLimit: normalized.singleCartonLimit,
    floorPallets: normalized.floorPallets, pallets,
    loadingRules: normalized.loadingRules,
    cargoDetails: Object.fromEntries(normalized.products.map(p => [p.id, shapeDetails(p)])),
    engineVersion: ENGINE_VERSION,
    container: normalized.container,
    clearance: normalized.clearance,
    placements: orderedPlacements,
    summaries,
    setSummaries,
    quoteEstimate,
    metrics: {
      ...envelopeMetrics(orderedPlacements,normalized.products,effectiveVolume,pallets),
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

function buildStrategyComparison(practical: PackingResult, maximum: PackingResult, maximumUsesPracticalLowerBound = false): StrategyComparison {
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

  if (maximumSnapshot.displayQuantity < practicalSnapshot.displayQuantity) {
    guidance.push({
      level: "review",
      title: "货物组合不同，不能只按总箱数替换",
      detail: "现场候选未能保留高密度候选的每个订单行数量，已保留原方案；请逐 SKU 检查必装货物和套装完整性，当前有限搜索未证明全局最优。",
    });
  } else if (gainQuantity === 0 && maximumUsesPracticalLowerBound) {
    guidance.push({
      level: "adopted",
      title: "已采用合法现场候选作为搜索下界",
      detail: "高密度原始候选数量较少，已采用通过校验且每个订单行数量均不减少的现场方案。当前数量一致来自候选复用，不代表两套搜索自然收敛，也不证明全局最优。",
    });
  } else if (gainQuantity === 0) {
    guidance.push({
      level: "matched",
      title: "现场方案已达到当前极限搜索结果",
      detail: "当前两个有效方案数量相同；这不证明全局最优，仍需比较货物构成、承托与执行复杂度。",
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
      const planningCeilingReached=practical.singleCartonLimit!==undefined && practical.metrics.loadedCount>=practical.singleCartonLimit;
      guidance.push({
        level: "review",
        title: planningCeilingReached
          ? "计划量之外保留为安全余量"
          : historicalBaselineActive ? "可解除旧基准后进行现场试装" : "可作为下一轮现场试装目标",
        detail: planningCeilingReached
          ? "当前差距首先来自主动设置的体积/载重计划上限，不是算法自相矛盾；需要冲量时切换“高密度参考”，页面会立即改用已缓存的高密度数量、三视图、坐标与导出方案。"
          : practical.singleCartonLimit !== undefined
          ? "现场方案尚未达到计划上限；当前增量来自不同搜索与装载规则，不能解释为主动预留余量。可切换高密度方案检查坐标并复核现场可执行性。"
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
    sameQuantity: maximumSnapshot.displayQuantity === practicalSnapshot.displayQuantity,
    practicalUsesTheoreticalGuide: true,
    maximumUsesPracticalLowerBound,
    guidance,
  };
}

/**
 * UI/Worker entry point: both independent solvers run for the same immutable
 * input. A larger practical result can be reused as a lower bound only when it
 * retains every loaded order row. Different cargo mixes require human review.
 */
export function combineStrategyResults(
  practical: PackingResult,
  maximum: PackingResult,
  selectedStrategy: PackingStrategy = "practical",
): PackingResult {
  let maximumCapacity = maximum;
  let maximumUsesPracticalLowerBound = maximum.palletSearch?.selected === "practical-lower-bound";
  if (strategyDisplayQuantity(maximumCapacity) < strategyDisplayQuantity(practical) &&
      retainsLoadedRows(practical.placements, maximumCapacity.placements)) {
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
    maximumUsesPracticalLowerBound = true;
  }
  const comparison = buildStrategyComparison(practical, maximumCapacity, maximumUsesPracticalLowerBound);
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

/** Shared support-layer rebuild for movement and order-conserving pallet-content edits. */
export function rebuildPlacementLayers(placements:PlacedBox[],pallets:PlacedPallet[],products:ProductInput[],loadingRules?:LoadingRules,container?:ContainerSpec,clearance=0){
  const fixed=container?fixedPlanSupportGeometry(container,clearance,pallets):{boxes:[],products:[]};
  products=[...applyTypeSupport(products,loadingRules),...fixed.products];
  const productMap = new Map(products.map(p => [p.id, p]));
  const levels = new Map<number, PlacedBox[]>();
  for (const b of [...palletAnchors(pallets),...fixed.boxes]) indexSupport(levels,b,productMap);
  return [...placements].sort((a,b) => a.z-b.z).map(b => {
    const box = { ...b, layer: supportDetails(b, levels, productMap).layer };
    indexSupport(levels,box,productMap);
    return box;
  });

}

/** Revalidate a manual edit and rebuild every geometry-dependent metric. */
export function revisePackingResult(original: PackingResult, placements: PlacedBox[], products: ProductInput[], pallets:PlacedPallet[]=original.pallets??[]): PackingResult {
  if(original.metrics.loadedCount!==original.placements.length)throw new Error("A complete coordinate plan is required for editing.");
  if(pallets.length!==(original.pallets??[]).length||pallets.some(p=>{const old=original.pallets?.find(q=>q.id===p.id);return !old||p.weight!==old.weight||p.maxLoad!==old.maxLoad||p.presetId!==old.presetId||p.dz!==old.dz||p.specificationId!==old.specificationId;}))throw new Error("Pallet identity or specification cannot change during editing.");
  if(pallets.some(p=>JSON.stringify(p.measuredEnvelope)!==JSON.stringify(original.pallets?.find(q=>q.id===p.id)?.measuredEnvelope)))throw Error("编辑不能删除或改写实测占位，请恢复原备份并重新测量 / Editing cannot remove or rewrite measured space; restore the original backup and measure again");
  for(const old of original.pallets??[])if(old.locked){const next=pallets.find(p=>p.id===old.id);if(!next||["x","y","z","dx","dy","dz","orientation"].some(k=>old[k as keyof PlacedPallet]!==next[k as keyof PlacedPallet]))throw new Error("请先解除整托锁定 / Unlock the complete pallet first");}
  if(!original.palletization&&JSON.stringify(pallets)!==JSON.stringify(original.pallets??[]))throw new Error("Floor pallet layout is fixed; edit its configuration instead.");
  products = applyTypeSupport(products, original.loadingRules);
  if (placements.length !== original.placements.length || new Set(placements.map(b => b.id)).size !== placements.length) throw new Error("手动调整不能增删箱体或重复追踪 ID。");
  const before = new Map(original.placements.map(b => [b.id, b]));
  for (const b of placements) {
    const old = before.get(b.id);
    if (!old || old.productId !== b.productId || old.weight !== b.weight || old.setCode !== b.setCode || old.setNumber !== b.setNumber || old.setItemNumber !== b.setItemNumber) throw new Error("箱体身份和成套关系不能改变。");
    if ((old.locked || original.pallets?.some(p=>p.locked&&old.palletIds?.includes(p.id))) && (["x", "y", "z", "dx", "dy", "dz", "orientation"].some(k => old[k as keyof PlacedBox] !== b[k as keyof PlacedBox])||JSON.stringify(old.orientationSigns)!==JSON.stringify(b.orientationSigns))) throw new Error("请先解除箱位锁定。");
  }
  const relayered = rebuildPlacementLayers(placements,pallets,products,original.loadingRules,original.container,original.clearance);
  const referenced = assignPalletReferences(orderForLoading([...palletAnchors(pallets),...relayered],[...products,...palletSupportProducts(pallets)]).filter(b=>!b.supportOnly), pallets, products);
  const ordered = original.palletization ? orderPalletizedCargo(referenced,pallets) : referenced;
  const validation = validatePacking(ordered, original.container, original.clearance, products, original.strategy, original.mode, pallets, original.floorPallets, original.palletization);
  if (!validation.valid) throw new Error(validation.errors.slice(0,3).join("\n"));
  if(original.palletization){const errors=validatePalletizedCargo(ordered,pallets,original.container,original.clearance,original.palletization,products);if(errors.length)throw new Error(errors.slice(0,3).join("\n"));}
  const effective = effectiveContainer(original.container, original.clearance);
  return { ...original, id: `manual-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, placements: ordered,pallets,
    cargoDetails:Object.fromEntries(products.map(p=>[p.id,shapeDetails(p)])),
    strategyPlans: undefined, strategyComparison: undefined, quoteEstimate: undefined, validation,
    warnings: ["手动调整已重新校验；继续优化会保留锁定箱位及其支撑；重新计算整个订单将创建新方案。"],
    metrics: { ...original.metrics, centerOfGravity: calculateCenterOfGravity([...palletAnchors(pallets),...ordered,...accessoryMassBoxes(original.container,original.clearance)],effective,products), executionComplexity: calculateExecutionComplexity(ordered,products,pallets,fixedPlanSupportGeometry(original.container,original.clearance,pallets)) }, createdAt: new Date().toISOString() };
}

export function explainUnloaded(result: PackingResult, products: ProductInput[]) {
  products = applyTypeSupport(products, result.loadingRules);
  return result.summaries.filter(s => s.unloaded > 0 || (result.mode === "single" && s.loaded === 0)).map(s => {
    const p = products.find(p => p.id===s.productId);
    const reasons: string[] = [];
    if (!p) return { ...s, reasons: ["缺少箱规资料"] };
    reasons.push(...inspectCargoFit(p, result.container, result.clearance, result.strategy).reasons);
    if (p.weight > result.container.maxWeight-result.metrics.grossWeight) reasons.push("剩余载重不足以再加入一箱（确定限制）");
    if (p.length*p.width*p.height*bodyVolumeRatio(p) > result.metrics.effectiveVolume-result.metrics.loadedVolume) reasons.push("剩余总容积不足一箱（确定限制）");
    if (p.setCode) reasons.push("必须整套装入；任一组件不足或放不下会整套回退");
    if (!reasons.length) reasons.push("搜索未找到满足当前约束的摆放位置；不能据此证明绝对装不下");
    if(hasLongSupportLimits(p))reasons.push("已启用长条箱支承带、悬跨与悬挑限制；未找到合格位置不证明绝对装不下 / Long-carton bands, spans and overhangs constrain placement; search failure is not an infeasibility proof");
    if (p.maxStackLayers>0) reasons.push(`配置了 ${p.maxStackLayers} 层上限`);
    if (p.maxTopLoadKg!==undefined) reasons.push(`配置了上方承重 ${p.maxTopLoadKg} kg`);
    return { ...s, reasons };
  });
}

/** Bounded diagnostic probe on demand; absence of a witness is not an infeasibility proof. */
export function diagnoseUnloadedPosition(result:PackingResult,products:ProductInput[],productId:string){
  products = applyTypeSupport(products, result.loadingRules);
  const p=products.find(p=>p.id===productId);if(!p)return {detail:"缺少箱规",candidate:null};
  const effective=effectiveContainer(result.container,result.clearance),orientations=orientationsForStrategy(p,effective,result.strategy);
  const spatial=new SpatialIndex(effective,Math.max(0,...products.map(p=>p.protectionGap??0))),tops=new Map<number,PlacedBox[]>(),rules=new Map(products.map(p=>[p.id,p]));
  const fixed=fixedPlanSupportGeometry(result.container,result.clearance,result.pallets);
  fixed.products.forEach(p=>rules.set(p.id,p));fixed.boxes.forEach(b=>indexSupport(tops,b,rules));
  const obstacles=[...siteExclusionBoxes(result.container,result.clearance),...palletDeckSupportGeometry(result.pallets??[]).boxes];
  const allBoxes=[...palletAnchors(result.pallets??[]),...result.placements];
  allBoxes.forEach((b,i)=>{spatial.add(b,i);indexSupport(tops,b,rules);});
  const points:Point[]=[{x:0,y:0,z:0},...[...allBoxes,...obstacles].flatMap(b=>[{x:b.x+b.dx,y:b.y,z:b.z},{x:b.x,y:b.y+b.dy,z:b.z},{x:b.x,y:b.y,z:b.z+b.dz}])];
  const unique=[...new Map(points.map(p=>[[p.x,p.y,p.z].join('/'),p])).values()];
  const stride=Math.max(1,Math.ceil(unique.length/240));let geometry=0,supportFailures=0,layerFailures=0;let first:PlacedBox|null=null;
  for(let i=0;i<unique.length;i+=stride)for(const o of orientations){
    const b=makePlacement(p,0,unique[i],o);
    if(b.x+b.dx>effective.length+EPS||b.y+b.dy>effective.width+EPS||b.z+b.dz>effective.height+EPS)continue;
    if([...spatial.query(b)].some(j=>bodiesOverlap(b,allBoxes[j],p,rules.get(allBoxes[j].productId))))continue;
    if(obstacles.some(o=>overlaps(b,o)))continue;
    geometry++;first??=b;
    const support=supportDetails(b,tops,rules);
    const ids=supportingPalletIds(b,tops.get(supportLevelKey(b.z))??[]);
    if(result.floorPallets&&ids.length&&b.z+b.dz>palletCargoCeiling(result.container,result.clearance,result.floorPallets)+EPS){layerFailures++;continue;}
    if(result.floorPallets&&!result.floorPallets.allowFloorCargo&&b.z<=EPS||p.bottomOnly&&b.z>EPS&&!(result.floorPallets&&Math.abs(b.z-result.floorPallets.height)<EPS)||support.longSupportError||support.ratio+EPS<requiredSupport(p,result.strategy)){supportFailures++;continue;}
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
  const palletization=parsePalletization(raw.palletization);
  if(palletization&&request.floorPallets)throw new Error("Prebuilt and floor pallet modes cannot be combined");
  if(palletization&&!palletization.specifications&&request.palletBuild&&(palletization.config.crateBearing||request.palletBuild.config.crateBearing||palletization.config.unitStacking||request.palletBuild.config.unitStacking)){
    const expected=parsePalletBuild(request.palletBuild).config;
    if(JSON.stringify(expected)!==JSON.stringify(palletization.config))throw new Error("Crate geometry or rating evidence does not match workspace inputs");
  }
  if(palletization&&!palletization.specifications&&request.palletBuild&&(palletization.config.packaging?.deckSupports?.length||request.palletBuild.config.packaging?.deckSupports?.length)){
    const expected=parsePalletBuild(request.palletBuild).config;
    if(JSON.stringify(expected)!==JSON.stringify(palletization.config))throw Error("Deck support specification does not match workspace inputs / 托内支承件规格与当前工作区输入不一致");
  }
  if(palletization){for(const source of [request.palletBuild,raw.palletBuild])if(source!==undefined){const expected=parsePalletBuild(source);if((expected.selection??"ordered")!==(palletization.selection??"ordered"))throw new Error("Packaging selection mode does not match workspace inputs");if(JSON.stringify(parseLooseQuantities(expected.looseQuantities))!==JSON.stringify(palletization.looseQuantities))throw Error("Loose reservations do not match workspace inputs / 散装预留与当前输入不一致");}}
  if(palletization&&!Array.isArray(raw.pallets))throw new Error("Prebuilt pallet coordinates are missing");
  if(palletization&&((raw.pallets as unknown[]).length>200||(raw.pallets as unknown[]).some(p=>!p||typeof p!=="object")))throw new Error("Invalid prebuilt pallet coordinates");
  if(palletization?.specifications){
    const source=request.palletBuild??raw.palletBuild;
    if(source!==undefined){const expected=parsePalletBuild(source);if(JSON.stringify(palletSpecifications(expected))!==JSON.stringify(palletization.specifications)||(palletization.preparedCount??0)>expected.maxPallets)throw new Error("Packaging specifications do not match workspace inputs");}
    const ids=new Set(request.products.map(p=>p.id));
    if(palletization.specifications.some(s=>s.productIds?.some(id=>!ids.has(id))))throw new Error("Packaging rule refers to an unknown SKU");
  }else if(palletization&&request.palletBuild&&(request.palletBuild.primaryRule||request.palletBuild.additionalSpecs?.length))throw new Error("Multiple packaging definitions are missing");
  if (palletization?.only) {
    if (!(raw.pallets as unknown[]).length) throw new Error("Invalid pallet-only envelope");
    request = {...request, container:mixedInspectionContainer((raw.pallets as PlacedPallet[]).map(p=>specificationForPallet(palletization,p).config)), clearance:0};
  }
  const pallets=palletization?raw.pallets as PlacedPallet[]:request.floorPallets?arrangeFloorPallets(request.container,request.clearance,request.floorPallets):[];
  if (!palletization && pallets.length) {
    if (!Array.isArray(raw.pallets) || raw.pallets.length!==pallets.length || raw.pallets.some((p,i)=>!p||typeof p!=="object"||Object.entries(pallets[i]).some(([k,v])=>JSON.stringify((p as Record<string,unknown>)[k])!==JSON.stringify(v)))) throw new Error("归档托盘记录与底层托盘设置不一致。");
  } else if (!palletization && raw.pallets!==undefined && (!Array.isArray(raw.pallets)||raw.pallets.length)) throw new Error("归档含有未配置的底层托盘。");
  const products=selectProductsForMode(applyTypeSupport(request.products, request.loadingRules),request.mode);
  const byId=new Map(products.map(p=>[p.id,p]));
  if(accessoryProductErrors(request.container,new Set(byId.keys())).length)throw Error("Unknown accessory cargo reference / 附件关联了不存在的货物");
  const placements:PlacedBox[]=raw.placements.map((value:unknown)=>{
    if(!value||typeof value!=="object")throw new Error("归档箱体格式无效。");
    const b=value as Record<string,unknown>;
    for(const key of ["id","productId","sku","orientation"])if(typeof b[key]!=="string"||(b[key] as string).length>300)throw new Error("归档箱体标识无效。");
    for(const key of ["x","y","z","dx","dy","dz","weight","layer"])if(typeof b[key]!=="number"||!Number.isFinite(b[key]))throw new Error("归档箱体坐标或重量无效。");
    if(!validOrientationSigns(b.orientation as string,b.orientationSigns))throw new Error("箱体旋转方向无效。");
    const p=byId.get(b.productId as string);if(!p)throw new Error("归档箱体引用了不存在的产品。");
    if(b.setCode!==undefined&&typeof b.setCode!=="string")throw new Error("归档套装编码无效。");
    if(b.locked!==undefined&&typeof b.locked!=="boolean")throw new Error("归档锁定标记无效。");
    return {id:b.id as string,productId:p.id,sku:b.sku as string,name:p.name,color:p.color,
      x:b.x as number,y:b.y as number,z:b.z as number,dx:b.dx as number,dy:b.dy as number,dz:b.dz as number,
      weight:b.weight as number,layer:b.layer as number,orientation:b.orientation as string,orientationSigns:b.orientationSigns as PlacedBox["orientationSigns"],locked:b.locked as boolean|undefined,
      setCode:b.setCode as string|undefined,setNumber:b.setNumber as number|undefined,setItemNumber:b.setItemNumber as number|undefined};
  });
  const referenced=assignPalletReferences(orderForLoading([...palletAnchors(pallets),...placements],[...products,...palletSupportProducts(pallets)]).filter(b=>!b.supportOnly),pallets,products);
  const ordered=palletization?orderPalletizedCargo(referenced,pallets):referenced;
  const validation=validatePacking(ordered,request.container,request.clearance,products,raw.strategy,request.mode,pallets,request.floorPallets,palletization);
  if(!validation.valid)throw new Error(`归档坐标未通过当前校验：${validation.errors.slice(0,3).join("；")}`);
  if(palletization){const errors=validatePalletizedCargo(ordered,pallets,request.container,request.clearance,palletization,products);if(errors.length)throw new Error(errors.join("; "));}
  if(request.mode==="single"&&limit!==undefined&&ordered.length>Number(limit))throw new Error("归档箱数超过计划上限。");
  const normalized: PackingRequest={...request,products,strategy:raw.strategy,singleCartonLimit:limit as number|undefined};
  const summaries=buildSummaries(normalized,ordered);
  const setSummaries=buildSetSummaries(normalized,summaries);
  const effective=effectiveContainer(request.container,request.clearance);
  const loadedVolume=summaries.reduce((n,s)=>n+s.loadedVolume,0)+pallets.reduce((n,p)=>n+packagingReservedVolume(p),0);
  const grossWeight=summaries.reduce((n,s)=>n+s.loadedWeight,0)+pallets.reduce((n,p)=>n+p.weight,0)+containerAccessoryWeight(request.container);
  const effectiveVolume=palletization?.only ? independentPalletVolume(palletization,pallets) : availablePackingVolume(request.container,request.clearance);
  const workflow=raw.workflow===undefined ? palletization?.only ? "pallet-only" : palletization ? "palletized" : request.workflow : parseLoadingWorkflow(raw.workflow,request.mode);
  const palletBuild=raw.palletBuild===undefined ? request.palletBuild : parsePalletBuild(raw.palletBuild);
  const restored:PackingResult={handlingTasks:parseHandlingTasks(raw.handlingTasks),workflow,palletBuild,id:`restored-${Date.now()}`,mode:request.mode,strategy:raw.strategy,practicalTargetUtilization:practicalTarget(normalized),engineVersion:ENGINE_VERSION,
    accessConfig:parseAccessConfig(raw.accessConfig),palletization,delivery:orderDelivery(products,raw.delivery),floorPallets:request.floorPallets,pallets,container:request.container,clearance:request.clearance,singleCartonLimit:normalized.singleCartonLimit,placements:ordered,summaries,setSummaries,validation,
    metrics:{...envelopeMetrics(ordered,products,effectiveVolume,pallets),loadedCount:ordered.length,requestedCount:summaries.reduce((n,s)=>n+s.requested,0),loadedVolume,grossWeight,effectiveVolume,
      volumeUtilization:loadedVolume/effectiveVolume,weightUtilization:grossWeight/request.container.maxWeight,
      centerOfGravity:calculateCenterOfGravity([...palletAnchors(pallets),...ordered,...accessoryMassBoxes(request.container,request.clearance)],effective,products),executionComplexity:calculateExecutionComplexity(ordered,products,pallets,fixedPlanSupportGeometry(request.container,request.clearance,pallets)),solveTimeMs:0},
    loadingRules: request.loadingRules, cargoDetails: Object.fromEntries(products.map(p=>[p.id,shapeDetails(p)])),
    warnings:["历史箱位已按当前箱规与引擎重新校验。自动重算已暂停，可继续手动调整或生成新方案。"],createdAt:new Date().toISOString()};
  const deliveryIdentity=restoreDeliveryIdentity(restored,raw.deliveryIdentity);
  return deliveryIdentity?{...restored,deliveryIdentity}:restored;
}

/** Internal bounded pallet search. Every returned candidate still needs full-plan validation. */
export function searchPalletContents(request:PackingRequest,base:PlacedPallet,fixedCargo:PlacedBox[],pass:number):PlacedBox[]{
  assertValidRequest(request);
  if(!request.palletBuildStage||request.mode!=="mixed"||request.clearance!==0||!Number.isInteger(pass)||pass<0||pass>3)throw Error("Invalid local pallet search");
  const fixed=palletDeckSupportGeometry([base]);
  const products=[...applyTypeSupport(request.products,request.loadingRules),...palletSupportProducts([base]).map(p=>({...p,quantity:0})),...fixed.products];
  const preferred:SortStrategy=(a,b)=>compareRequired(a,b)||b.priority-a.priority||(request.loadingRules?.cargoOrder==="small-first"?1:-1)*(a.length*a.width*a.height-b.length*b.width*b.height);
  const variants:SortStrategy[]=[preferred,(a,b)=>compareRequired(a,b)||b.height-a.height,(a,b)=>compareRequired(a,b)||b.length*b.width-a.length*a.width,(a,b)=>compareRequired(a,b)||b.weight-a.weight];
  const sort=request.loadingRules?.cargoOrder&&request.loadingRules.cargoOrder!=="auto"?preferred:variants[pass];
  return packMixedWithStrategy({...request,products,practicalTargetUtilization:1},effectiveContainer(request.container,0),sort,[...palletAnchors([base]),...fixed.boxes,...fixedCargo]).filter(b=>!b.supportOnly);
}

/** Internal gap search. The caller validates its immutable source and the complete returned plan. */
export function searchFixedCargo(request:PackingRequest,fixed:PlacedBox[],pass:number,check:RigidCandidateCheck):PlacedBox[]{
  assertValidRequest(request);
  if(request.mode!=="mixed"||request.palletBuild||request.floorPallets||!Number.isInteger(pass)||pass<0||pass>3||fixed.length>MAX_VISIBLE_PLACEMENTS)throw Error("Invalid fixed-cargo search");
  const normalized={...request,products:applyTypeSupport(request.products,request.loadingRules)};
  const sorts:SortStrategy[]=[(a,b)=>compareRequired(a,b)||b.priority-a.priority||b.length*b.width*b.height-a.length*a.width*a.height,(a,b)=>compareRequired(a,b)||b.weight-a.weight,(a,b)=>compareRequired(a,b)||a.height-b.height,(a,b)=>compareRequired(a,b)||a.length*a.width-b.length*b.width];
  return packMixedWithStrategy(normalized,effectiveContainer(request.container,request.clearance),sorts[pass],fixed,check);
}

/** Retain locked boxes, their support closure and complete kits; only rebuild the free remainder. */
export function improvePacking(original: PackingResult, products: ProductInput[], pass = 0): PackingResult {
  if(original.palletization)throw new Error("Prebuilt pallet loads must be regenerated as complete units.");
  products = applyTypeSupport(products, original.loadingRules);
  const request: PackingRequest = {floorPallets:original.floorPallets,loadingRules:original.loadingRules,mode:original.mode,strategy:original.strategy,container:original.container,clearance:original.clearance,practicalTargetUtilization:original.practicalTargetUtilization,products};
  const baseline=restorePackingSnapshot(request,{strategy:original.strategy,placements:original.placements,pallets:original.pallets});
  const fixed=new Set(original.placements.filter(b=>b.locked).map(b=>b.id));
  let changed=true;
  while(changed){changed=false;for(const b of original.placements){if(!fixed.has(b.id))continue;for(const a of original.placements){if(fixed.has(a.id))continue;const sameSet=Boolean(b.setCode&&a.setCode===b.setCode&&a.setNumber===b.setNumber);const support=bodyContactArea(b,a,products.find(p=>p.id===b.productId),products.find(p=>p.id===a.productId))>EPS;if(sameSet||support){fixed.add(a.id);changed=true;}}}}
  const effective=effectiveContainer(request.container,request.clearance);
  if(request.mode==="single"){
    const n=products.reduce((s,p)=>s+(setCode(p)?unitsPerSet(p):1),0),v=products.reduce((s,p)=>s+p.length*p.width*p.height*bodyVolumeRatio(p)*(setCode(p)?unitsPerSet(p):1),0);
    const units=Math.floor(Math.min(effective.length*effective.width*effective.height/v,MAX_VISIBLE_PLACEMENTS/n,(original.singleCartonLimit??MAX_VISIBLE_PLACEMENTS)/n));
    request.products=products.map(p=>({...p,quantity:units*(setCode(p)?unitsPerSet(p):1)}));
  }
  const supportAnchors = palletAnchors(original.pallets??[]);
  request.products=[...request.products,...palletSupportProducts(original.pallets??[]).map(p=>({...p,quantity:0}))];
  const preferred:SortStrategy=(a,b)=>compareRequired(a,b)||b.priority-a.priority||(original.loadingRules?.cargoOrder==="small-first"?1:-1)*(a.length*a.width*a.height-b.length*b.width*b.height);
  const variants:SortStrategy[]=original.loadingRules?.cargoOrder && original.loadingRules.cargoOrder!=="auto" ? [preferred] : [...strategies,(a,b)=>compareRequired(a,b)||b.weight-a.weight,(a,b)=>compareRequired(a,b)||a.height-b.height,(a,b)=>compareRequired(a,b)||a.length*a.width-b.length*b.width];
  const placements=packMixedWithStrategy(request,effective,variants[Math.abs(pass)%variants.length],[...supportAnchors,...original.placements.filter(b=>fixed.has(b.id))]);
  let candidate:PackingResult;try{candidate=restorePackingSnapshot({...request,products:products},{strategy:original.strategy,placements:placements.filter(b=>!b.supportOnly),pallets:original.pallets,singleCartonLimit:original.singleCartonLimit});}catch{return original;}
  const score=(p:PackingResult)=>weightedScore(p.placements,products);
  if(score(candidate)<score(baseline)||candidate.metrics.loadedCount<baseline.metrics.loadedCount)return original;
  if(score(candidate)===score(baseline)&&executionAudit(candidate).score>=executionAudit(baseline).score)return original;
  candidate.id=`optimized-${Date.now()}-${pass}`;candidate.singleCartonLimit=original.singleCartonLimit;candidate.delivery=original.delivery;candidate.accessConfig=original.accessConfig;
  // This is a local revision. Retain the old registry as draft until explicit issue.
  candidate.deliveryIdentity=original.deliveryIdentity;
  candidate.warnings=[`已保留 ${fixed.size} 个固定／支撑／成套箱位，其余空间完成第 ${pass+1} 轮搜索。`,...candidate.warnings];
  return candidate;
}

/** Internal rigid-unit search: candidate gates run before acceptance, never after trimming. */
export function searchRigidUnits(request: PackingRequest, check: RigidCandidateCheck) {
  assertValidRequest(request);
  if(request.mode!=="mixed"||request.floorPallets||request.palletBuild)throw Error("Invalid rigid-unit search");
  const normalized={...request,products:applyTypeSupport(request.products,request.loadingRules)};
  const output=packMixed(normalized,effectiveContainer(request.container,request.clearance),[],check);
  const placements=orderForLoading(output.placements,normalized.products);
  return {placements,validation:validatePacking(placements,request.container,request.clearance,normalized.products,request.strategy,request.mode)};
}
