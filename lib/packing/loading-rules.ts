import type { CargoType, LoadingRules, OrientationCode, ProductInput, PackingStrategy } from "./types";

export const ORIENTATION_CODES: readonly OrientationCode[] = ["LWH", "LHW", "WLH", "WHL", "HLW", "HWL"];
export const CARGO_TYPES: readonly CargoType[] = ["carton", "pallet", "crate", "drum", "roll", "loose"];
export const DEFAULT_LOADING_RULES: LoadingRules = { layout: "auto", search: "smart", cargoOrder: "auto" };
export const CARGO_LABELS: Record<CargoType, string> = { carton: "纸箱", pallet: "托盘", crate: "木箱", drum: "圆桶", roll: "卷材", loose: "散件" };
export function parseLoadingRules(value: unknown): LoadingRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("装载规则格式无效。");
  const v = value as LoadingRules;
  if (!["auto", "deep-first", "layers"].includes(v.layout) || !["smart", "deep"].includes(v.search) || !["auto", "large-first", "small-first"].includes(v.cargoOrder)) throw new Error("装载规则选项无效。");
  return { layout: v.layout, search: v.search, cargoOrder: v.cargoOrder };
}
export function parseOrientations(value: unknown): OrientationCode[] {
  if (!Array.isArray(value) || !value.length || value.length > 6 || value.some(v => !ORIENTATION_CODES.includes(v)) || new Set(value).size !== value.length) throw new Error("请选择至少一种且不重复的合法摆放方向。");
  return [...value];
}
export function requiredSupport(product: ProductInput | undefined, strategy: PackingStrategy) {
  return product?.minimumSupportRatio ?? (strategy === "practical" ? 0.995 : 0.68);
}
