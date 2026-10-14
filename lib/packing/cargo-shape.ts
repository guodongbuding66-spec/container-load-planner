import type { CargoShape, ProductInput } from "./types";
import { parseSolidModel, buildSolidModel } from "./solid-model";
export const LEGACY_SHAPES: readonly CargoShape[] = ["box", "cylinder", "wedge", "trapezoid", "frustum", "l-profile", "u-profile", "t-profile", "step", "irregular"];
export const ADVANCED_SHAPES: readonly CargoShape[] = ["polygon", "tube", "reel", "bend", "ellipsoid", "capsule", "custom-prism", "compound", "mesh"];
export const CARGO_SHAPES: readonly CargoShape[] = [...LEGACY_SHAPES,...ADVANCED_SHAPES];
export type ShapeFields = Pick<ProductInput, "cargoType" | "cargoShape" | "shapeAxis" | "shapeTopRatio" | "shapeWallRatio" | "shapeWallHeightRatio" | "shapeStepLengthRatio" | "shapeStepHeightRatio" | "solidModel" | "protectionGap">;
export const SHAPE_LABELS: Record<CargoShape, [string, string]> = {
  box: ["长方体", "Cuboid"], cylinder: ["圆筒／椭圆筒", "Cylinder / oval"],
  wedge: ["三角柱／楔形", "Triangular / wedge"], trapezoid: ["梯形箱", "Trapezoid"],
  frustum: ["圆锥／圆台", "Cone / frustum"], "l-profile": ["L 型件", "L profile"],
  "u-profile": ["U 型件", "U profile"], "t-profile": ["T 型件", "T profile"],
  step: ["阶梯组合件", "Stepped body"],
  irregular: ["其他异型件", "Other irregular"],
  polygon:["六角／八角柱","Polygonal prism"], tube:["空心管","Hollow tube"], reel:["卷盘","Cable reel"], bend:["弧形／弯管","Arc / bent tube"], ellipsoid:["球／椭球","Sphere / ellipsoid"], capsule:["胶囊形","Capsule"], "custom-prism":["自定义截面","Custom section"], compound:["组合模型","Compound model"], mesh:["导入模型","Imported model"],
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
  if (v.shapeTopRatio !== undefined && (typeof v.shapeTopRatio !== "number" || !Number.isFinite(v.shapeTopRatio) || v.shapeTopRatio < (v.cargoShape === "frustum" ? 0 : .000001) || v.shapeTopRatio > 1)) throw new Error(v.cargoShape === "frustum" ? "圆台顶径比例须为 0%–100%" : "梯形顶边比例须大于 0 且不超过 100%");
  for (const key of ["shapeWallRatio", "shapeWallHeightRatio"] as const) {
    const n = v[key];
    if (n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || n < .000001 || n >= (key === "shapeWallRatio" && v.cargoShape === "u-profile" ? .5 : 1))) throw new Error("型件壁厚无效，须保留有效截面空间");
  }
  for (const key of ["shapeStepLengthRatio", "shapeStepHeightRatio"] as const) {
    const n = v[key];
    if (n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || n < .000001 || n > .999999)) throw new Error("阶梯长度与高度须在总尺寸内");
  }
  if (v.cargoType === "pallet" && v.cargoShape !== undefined && v.cargoShape !== "box") throw new Error("托盘货物外包络须为长方体");
  const solidModel=parseSolidModel(v.solidModel);
  if(ADVANCED_SHAPES.includes(v.cargoShape as CargoShape)&&!solidModel)throw new Error("该外形需填写实体模型参数。");
  if(v.protectionGap!==undefined&&(typeof v.protectionGap!=="number"||!Number.isFinite(v.protectionGap)||v.protectionGap<0||v.protectionGap>100000))throw new Error("货物保护间隙须为 0–100000 mm。");
  return {
    ...(solidModel?{solidModel}:{}),...(v.protectionGap===undefined?{}:{protectionGap:v.protectionGap as number}),
    ...(v.cargoShape === undefined ? {} : { cargoShape: v.cargoShape as CargoShape }),
    ...(v.shapeAxis === undefined ? {} : { shapeAxis: v.shapeAxis as "L" | "W" | "H" }),
    ...(v.shapeTopRatio === undefined ? {} : { shapeTopRatio: v.shapeTopRatio as number }),
    ...(v.shapeWallRatio === undefined ? {} : { shapeWallRatio: v.shapeWallRatio as number }),
    ...(v.shapeWallHeightRatio === undefined ? {} : { shapeWallHeightRatio: v.shapeWallHeightRatio as number }),
    ...(v.shapeStepLengthRatio === undefined ? {} : { shapeStepLengthRatio: v.shapeStepLengthRatio as number }),
    ...(v.shapeStepHeightRatio === undefined ? {} : { shapeStepHeightRatio: v.shapeStepHeightRatio as number }),
  };
}
/** Curves and slopes do not acquire a load-bearing top from their bounding box. */
export function withShapeSupport(p: ProductInput): ProductInput {
  return shapeCanSupport(p) ? p : { ...p, stackable: false };
}
export function isRectilinearShape(p: ShapeFields) { return ["l-profile", "u-profile", "t-profile", "step"].includes(cargoShapeOf(p)); }
export function shapeCanSupport(p: ShapeFields) { try{return p.solidModel?!!p.solidModel.loadFaces.length&&(buildSolidModel(p.solidModel).flatFaces.length+buildSolidModel(p.solidModel).caps.length>0):cargoShapeOf(p) === "box" || isRectilinearShape(p);}catch{return false;} }
export function shapeDetails(p: ProductInput) {
  return { ...parseShapeFields(p as unknown as Record<string, unknown>), cargoType: p.cargoType, palletBaseHeight: p.palletBaseHeight };
}
