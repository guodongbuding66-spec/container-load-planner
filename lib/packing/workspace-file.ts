import { parseShippingMark } from "./shipping-mark";
import {issueDeliveryIdentity} from "./delivery-identity";
import {parseOrderLine,assertOrderLineIds} from "./order-lines";
import {parsePalletLayerTemplates,type PalletLayerTemplate} from "./pallet-layer";
import {parseLongSupport} from "./long-support";
import {parseSiteExclusions} from "./site-exclusions";
import {parseVehicleEngineering} from "./vehicle-engineering";
import { parseDimensionAllowance } from "./dimension-allowance";
import { parseLoadingWorkflow, parsePalletBuild } from "./loading-workflow";
import { parseShapeFields, withShapeSupport } from "./cargo-shape";
import { parseFloorPalletConfig } from "./floor-pallets";
import { parseLoadingRules, parseOrientations, CARGO_TYPES } from "./loading-rules";
import type { ContainerSpec, PackingMode, PackingResult, PackingStrategy, ProductInput, LoadingRules, FloorPalletConfig } from "./types";
import { isLengthUnit, isWeightUnit, type LengthUnit, type WeightUnit } from "./units";
import { restorePackingSnapshot } from "./engine";
import { MAX_CSV_ROWS } from "./csv";

// Two 20,000-carton plans exceed the former 5 MB import cap.
// The independent per-plan limit is enforced by restorePackingSnapshot.
export const MAX_WORKSPACE_BYTES = 50 * 1024 * 1024;
export type WorkspaceInputs = {
  palletLayerTemplates?: PalletLayerTemplate[];
  workflow?: import("./types").LoadingWorkflow;
  palletBuild?: import("./types").PalletBuildOptions;
  floorPallets?: FloorPalletConfig;
  loadingRules?: LoadingRules;
  mode: PackingMode;
  strategy: PackingStrategy;
  practicalTargetPercent: number;
  container: ContainerSpec;
  clearance: number;
  products: ProductInput[];
  customContainers: ContainerSpec[];
  targetVolumePercent: number;
  targetWeightPercent: number;
  lengthUnit: LengthUnit;
  weightUnit: WeightUnit;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("备份内容不完整。");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) throw new Error("备份中的名称或标识格式不正确。");
  return value;
}
function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("备份中的数字超出有效范围。");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  const result = number(value, min, max);
  if (!Number.isInteger(result)) throw new Error("箱数、层数和比例必须为整数。");
  return result;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("备份中的装载规则格式不正确。");
  return value;
}
function container(value: unknown): ContainerSpec {
  const v = record(value);
  if (v.category !== undefined && !["container", "truck", "pallet", "other"].includes(v.category as string)) throw new Error("装载空间类别无效。");
  if (v.loadingAccess !== undefined && !["rear", "open"].includes(v.loadingAccess as string)) throw new Error("装载入口无效。");
  return { ...(v.engineering===undefined?{}:{engineering:parseVehicleEngineering(v.engineering,{length:number(v.length),width:number(v.width)})}), ...(v.exclusions===undefined?{}:{exclusions:parseSiteExclusions(v.exclusions,{length:number(v.length),width:number(v.width),height:number(v.height)})}), ...(v.category === undefined ? {} : { category: v.category as ContainerSpec["category"] }), ...(v.loadingAccess === undefined ? {} : { loadingAccess: v.loadingAccess as ContainerSpec["loadingAccess"] }), ...(v.baseHeight === undefined ? {} : { baseHeight: number(v.baseHeight) }), ...(v.specificationNote === undefined ? {} : { specificationNote: text(v.specificationNote, 1000) }), id: text(v.id, 120), name: text(v.name, 120), length: number(v.length),
    width: number(v.width), height: number(v.height), doorWidth: number(v.doorWidth),
    doorHeight: number(v.doorHeight), maxWeight: number(v.maxWeight) };
}
export function parseProductInput(value: unknown): ProductInput {
  const v = record(value);
  if (v.rotationPolicy !== "fixed" && v.rotationPolicy !== "upright" && v.rotationPolicy !== "any") throw new Error("箱型方向规则无效。");
  const color = text(v.color, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("箱型颜色无效。");
  if (v.cargoType !== undefined && !CARGO_TYPES.includes(v.cargoType as never)) throw new Error("货物类型无效。");
  const shippingMark = parseShippingMark(v.shippingMark);
  return withShapeSupport({ ...(shippingMark?{shippingMark}:{}), ...(v.orderLine===undefined?{}:{orderLine:parseOrderLine(v.orderLine)}), ...(v.dimensionAllowance===undefined?{}:{dimensionAllowance:parseDimensionAllowance(v.dimensionAllowance)}), ...parseShapeFields(v), ...(v.cargoType === undefined ? {} : { cargoType: v.cargoType as ProductInput["cargoType"] }), ...(v.allowedOrientations === undefined ? {} : { allowedOrientations: parseOrientations(v.allowedOrientations) }), ...(v.minimumSupportRatio === undefined ? {} : { minimumSupportRatio: number(v.minimumSupportRatio, Number.MIN_VALUE, 1) }), ...(v.palletBaseHeight === undefined ? {} : { palletBaseHeight: (() => { const base = number(v.palletBaseHeight); if (base >= number(v.height)) throw new Error("底座必须小于总高。"); return base; })() }), id: text(v.id, 120), sku: text(v.sku, 80), name: text(v.name, 200),
    length: number(v.length), width: number(v.width), height: number(v.height),
    weight: number(v.weight), quantity: integer(v.quantity, 0, 1_000_000),
    priority: integer(v.priority, 0, 100), rotationPolicy: v.rotationPolicy,
    stackable: bool(v.stackable), maxStackLayers: integer(v.maxStackLayers, 0, 99),
    mustLoad: v.mustLoad === undefined ? true : bool(v.mustLoad),
    bottomOnly: v.bottomOnly === undefined ? false : bool(v.bottomOnly),
    setCode: v.setCode === undefined ? "" : text(v.setCode, 80),
    unitsPerSet: v.unitsPerSet === undefined ? 1 : integer(v.unitsPerSet, 1, 99),
    ...(v.allowedAboveSkus === undefined ? {} : {allowedAboveSkus: (()=>{if(!Array.isArray(v.allowedAboveSkus)||v.allowedAboveSkus.length>1000)throw new Error("叠放规则无效");return v.allowedAboveSkus.map(s=>text(s,80));})()}),
    ...(v.topLoadByVerticalAxis === undefined ? {} : {topLoadByVerticalAxis: Object.fromEntries(Object.entries(record(v.topLoadByVerticalAxis)).map(([k,n])=>{if(!["length","width","height"].includes(k))throw new Error("承重方向无效");return [k,number(n)];}))}),
    ...(v.source === undefined ? {} : {source:(()=>{const source=record(v.source);if(source.system!=="aftos")throw new Error("来源无效");return {system:"aftos" as const,skuId:text(source.skuId,120),packageId:text(source.packageId,120),orderId:text(source.orderId,120)};})()}),
    ...(v.packaging === undefined ? {} : {packaging: (()=>{const p=record(v.packaging);return {revision:text(p.revision,100),effectiveDate:text(p.effectiveDate,10),notes:text(p.notes,2000)};})()}),
    ...(v.longSupport === undefined ? {} : { longSupport: parseLongSupport(v.longSupport) }),
    ...(v.maxTopLoadKg === undefined ? {} : { maxTopLoadKg: number(v.maxTopLoadKg) }), color });
}
export function parseWorkspaceBackup(contents: string): WorkspaceInputs {
  const file = record(JSON.parse(contents));
  if (file.format !== "cargo-fit-workspace" || file.version !== 1) {
    throw new Error("请选择“备份工作区”生成的文件；方案结果 JSON 和 CSV 不能用于恢复工作区。");
  }
  const v = record(file.inputs);
  if (v.mode !== "single" && v.mode !== "mixed") throw new Error("计算模式无效。");
  if (v.strategy !== "practical" && v.strategy !== "maximum") throw new Error("算法模式无效。");
  if (!isLengthUnit(v.lengthUnit) || !isWeightUnit(v.weightUnit)) throw new Error("录入单位无效。");
  if (!Array.isArray(v.products) || !v.products.length || v.products.length > MAX_CSV_ROWS) throw new Error("备份的箱型数量无效。");
  if (!Array.isArray(v.customContainers) || v.customContainers.length > 100) throw new Error("自定义柜型数量无效。");
  const products=v.products.map(parseProductInput);assertOrderLineIds(products);
  return { ...(v.palletLayerTemplates===undefined?{}:{palletLayerTemplates:parsePalletLayerTemplates(v.palletLayerTemplates)}), ...(v.workflow===undefined?{}:{workflow:parseLoadingWorkflow(v.workflow,v.mode)}), ...(v.palletBuild===undefined?{}:{palletBuild:parsePalletBuild(v.palletBuild)}), ...(v.floorPallets === undefined ? {} : {floorPallets:parseFloorPalletConfig(v.floorPallets)}), ...(v.loadingRules === undefined ? {} : { loadingRules: parseLoadingRules(v.loadingRules) }), mode: v.mode, strategy: v.strategy, practicalTargetPercent: number(v.practicalTargetPercent, 50, 95),
    container: container(v.container), clearance: number(v.clearance, 0, 50),
    products, customContainers: v.customContainers.map(container),
    targetVolumePercent: integer(v.targetVolumePercent, 1, 100), targetWeightPercent: integer(v.targetWeightPercent, 1, 100),
    lengthUnit: v.lengthUnit, weightUnit: v.weightUnit };
}
export function serializeWorkspaceBackup(inputs: WorkspaceInputs, engineVersion: string, plan?: PackingResult | null, plans?: PackingResult["strategyPlans"]): string {
  return JSON.stringify({ format: "cargo-fit-workspace", version: 1, engineVersion,
    createdAt: new Date().toISOString(), inputs,
    coordinatePlans: Object.fromEntries(Object.entries(plan?.validation.valid?(plans??plan.strategyPlans??{}):{}).filter(([,p])=>p?.validation.valid).map(([key,p])=>[key,{deliveryIdentity:p!.deliveryIdentity,workflow:p!.workflow,palletBuild:p!.palletBuild,strategy:p!.strategy,singleCartonLimit:p!.singleCartonLimit,placements:p!.placements,pallets:p!.pallets,palletization:p!.palletization,delivery:p!.delivery,accessConfig:p!.accessConfig,handlingTasks:p!.handlingTasks}])),
    ...(plan?.validation.valid ? { coordinatePlan: { deliveryIdentity:plan.deliveryIdentity,workflow:plan.workflow,palletBuild:plan.palletBuild,strategy: plan.strategy, singleCartonLimit: plan.singleCartonLimit, placements: plan.placements,pallets:plan.pallets,palletization:plan.palletization,delivery:plan.delivery,accessConfig:plan.accessConfig,handlingTasks:plan.handlingTasks } } : {}) }, null, 2);
}


export function restoreWorkspacePlans(contents: string, inputs: WorkspaceInputs) {
  const raw=record(JSON.parse(contents));
  const request={workflow:inputs.workflow,palletBuild:inputs.palletBuild,floorPallets:inputs.workflow==="pallet-only"||inputs.workflow==="palletized"?undefined:inputs.floorPallets,loadingRules:inputs.loadingRules,mode:inputs.mode,strategy:inputs.strategy,practicalTargetUtilization:inputs.practicalTargetPercent/100,container:inputs.container,clearance:inputs.clearance,products:inputs.products};
  const plans:NonNullable<PackingResult["strategyPlans"]>={};
  if(raw.coordinatePlans!==undefined)for(const [key,snapshot] of Object.entries(record(raw.coordinatePlans))){if(key!=="practical"&&key!=="maximum")throw new Error("归档算法无效");const p=restorePackingSnapshot(request,snapshot);if(p.strategy!==key)throw new Error("算法与坐标不一致");plans[key]=p;}
  const selected=raw.coordinatePlan===undefined?plans[inputs.strategy]??plans.practical??plans.maximum:restorePackingSnapshot(request,raw.coordinatePlan);
  return selected?{...selected,strategyPlans:Object.keys(plans).length?{...plans,[selected.strategy]:selected}:undefined}:null;
}

/** Restoring a version preserves its identity; explicitly copying creates a new plan lineage. */
export function forkWorkspaceBackup(contents:string):string {
 const inputs=parseWorkspaceBackup(contents),plan=restoreWorkspacePlans(contents,inputs);
 if(!plan)return contents;
 const plans=Object.fromEntries(Object.entries(plan.strategyPlans??{[plan.strategy]:plan}).map(([key,p])=>[key,p!.deliveryIdentity?issueDeliveryIdentity(p!,true):p!]));
 const selected=plans[plan.strategy]??(plan.deliveryIdentity?issueDeliveryIdentity(plan,true):plan);
 return serializeWorkspaceBackup(inputs,plan.engineVersion,selected,plans);
}
