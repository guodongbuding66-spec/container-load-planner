import type { ContainerSpec, PackingMode, PackingStrategy, ProductInput } from "./types";
import { isLengthUnit, isWeightUnit, type LengthUnit, type WeightUnit } from "./units";
import { MAX_CSV_ROWS } from "./csv";

export const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024;
export type WorkspaceInputs = {
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
  return { id: text(v.id, 120), name: text(v.name, 120), length: number(v.length),
    width: number(v.width), height: number(v.height), doorWidth: number(v.doorWidth),
    doorHeight: number(v.doorHeight), maxWeight: number(v.maxWeight) };
}
function product(value: unknown): ProductInput {
  const v = record(value);
  if (v.rotationPolicy !== "fixed" && v.rotationPolicy !== "upright" && v.rotationPolicy !== "any") throw new Error("箱型方向规则无效。");
  const color = text(v.color, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("箱型颜色无效。");
  return { id: text(v.id, 120), sku: text(v.sku, 80), name: text(v.name, 200),
    length: number(v.length), width: number(v.width), height: number(v.height),
    weight: number(v.weight), quantity: integer(v.quantity, 0, 1_000_000),
    priority: integer(v.priority, 0, 100), rotationPolicy: v.rotationPolicy,
    stackable: bool(v.stackable), maxStackLayers: integer(v.maxStackLayers, 0, 99),
    mustLoad: v.mustLoad === undefined ? true : bool(v.mustLoad),
    bottomOnly: v.bottomOnly === undefined ? false : bool(v.bottomOnly),
    setCode: v.setCode === undefined ? "" : text(v.setCode, 80),
    unitsPerSet: v.unitsPerSet === undefined ? 1 : integer(v.unitsPerSet, 1, 99), color };
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
  return { mode: v.mode, strategy: v.strategy, practicalTargetPercent: number(v.practicalTargetPercent, 50, 95),
    container: container(v.container), clearance: number(v.clearance, 0, 50),
    products: v.products.map(product), customContainers: v.customContainers.map(container),
    targetVolumePercent: integer(v.targetVolumePercent, 1, 100), targetWeightPercent: integer(v.targetWeightPercent, 1, 100),
    lengthUnit: v.lengthUnit, weightUnit: v.weightUnit };
}
export function serializeWorkspaceBackup(inputs: WorkspaceInputs, engineVersion: string): string {
  return JSON.stringify({ format: "cargo-fit-workspace", version: 1, engineVersion,
    createdAt: new Date().toISOString(), inputs }, null, 2);
}
