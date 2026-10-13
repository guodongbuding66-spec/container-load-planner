import type { CargoShape, ProductInput } from "./types";
export const CARGO_SHAPES: readonly CargoShape[] = ["box", "cylinder", "wedge", "trapezoid", "irregular"];
export type ShapeFields = Pick<ProductInput, "cargoType" | "cargoShape" | "shapeAxis" | "shapeTopRatio">;
export const SHAPE_LABELS: Record<CargoShape, [string, string]> = {
  box: ["长方体", "Cuboid"], cylinder: ["圆筒／椭圆筒", "Cylinder / oval"],
  wedge: ["三角柱／楔形", "Triangular / wedge"], trapezoid: ["梯形箱", "Trapezoid"],
  irregular: ["其他异型件", "Other irregular"],
};
export function cargoShapeOf(p: ShapeFields): CargoShape {
  return p.cargoShape ?? (["drum", "roll"].includes(p.cargoType ?? "") ? "cylinder" : "box");
}
export function cylinderAxisOf(p: ShapeFields): "L" | "W" | "H" {
  return p.shapeAxis ?? (p.cargoType === "roll" ? "L" : "H");
}
export function parseShapeFields(v: Record<string, unknown>): ShapeFields {
  if (v.cargoShape !== undefined && !CARGO_SHAPES.includes(v.cargoShape as CargoShape)) throw new Error("货物外形无效");
  if (v.shapeAxis !== undefined && !["L", "W", "H"].includes(v.shapeAxis as string)) throw new Error("圆筒轴向无效");
  if (v.shapeTopRatio !== undefined && (typeof v.shapeTopRatio !== "number" || !Number.isFinite(v.shapeTopRatio) || v.shapeTopRatio < .1 || v.shapeTopRatio > 1)) throw new Error("梯形顶边比例须为 10%–100%");
  if (v.cargoType === "pallet" && v.cargoShape !== undefined && v.cargoShape !== "box") throw new Error("托盘货物外包络须为长方体");
  return {
    ...(v.cargoShape === undefined ? {} : { cargoShape: v.cargoShape as CargoShape }),
    ...(v.shapeAxis === undefined ? {} : { shapeAxis: v.shapeAxis as "L" | "W" | "H" }),
    ...(v.shapeTopRatio === undefined ? {} : { shapeTopRatio: v.shapeTopRatio as number }),
  };
}
/** Curves and slopes do not acquire a load-bearing top from their bounding box. */
export function withShapeSupport(p: ProductInput): ProductInput {
  return cargoShapeOf(p) === "box" ? p : { ...p, stackable: false };
}
export function shapeDetails(p: ProductInput) {
  return { cargoType: p.cargoType, palletBaseHeight: p.palletBaseHeight, cargoShape: p.cargoShape, shapeAxis: p.shapeAxis, shapeTopRatio: p.shapeTopRatio };
}
