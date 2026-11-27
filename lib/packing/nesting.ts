import { cargoShapeOf } from "./cargo-shape";
import type { PlacedBox, ProductInput } from "./types";

const EPS = 0.0001;

/** Keep direct calculation and workspace import on the same numeric contract.
 * Zero or nominal height means ordinary (non-nested) stacking.
 */
export function parseNestingDeltaHeight(value: unknown, height: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > height) {
    throw new Error("垂直嵌套增量 ΔH 必须为 0 至单件高度之间的有限数字 / Vertical nesting ΔH must be a finite number between zero and the item height");
  }
  return value;
}


export function nestedDeltaHeight(product: ProductInput | undefined): number {
  if (!product || !product.stackable || product.solidModel || cargoShapeOf(product) !== "box") return 0;
  const d = product.nestingDeltaHeightMm;
  if (d === undefined || !Number.isFinite(d) || d <= EPS || d >= product.height - EPS) return 0;
  return d;
}

export function isPermittedNestedPair(
  a: Pick<PlacedBox, "productId" | "x" | "y" | "z" | "dx" | "dy" | "dz">,
  b: Pick<PlacedBox, "productId" | "x" | "y" | "z" | "dx" | "dy" | "dz">,
  prodA: ProductInput | undefined,
  prodB: ProductInput | undefined,
): boolean {
  if (!prodA || !prodB || a.productId !== b.productId) return false;
  const deltaH = nestedDeltaHeight(prodA);
  if (deltaH <= 0) return false;
  const nomH = prodA.height;
  if (Math.abs(a.dz - nomH) > EPS || Math.abs(b.dz - nomH) > EPS) return false;
  if (
    Math.abs(a.x - b.x) > EPS ||
    Math.abs(a.y - b.y) > EPS ||
    Math.abs(a.dx - b.dx) > EPS ||
    Math.abs(a.dy - b.dy) > EPS
  ) return false;
  const sep = Math.abs(a.z - b.z);
  if (sep < deltaH - EPS) return false;
  const steps = sep / deltaH;
  return Math.abs(steps - Math.round(steps)) <= 1e-3;
}

export function findDirectNestedParent(
  candidate: Pick<PlacedBox, "productId" | "x" | "y" | "z" | "dx" | "dy" | "dz">,
  existing: PlacedBox[],
  product: ProductInput | undefined,
): PlacedBox | undefined {
  const deltaH = nestedDeltaHeight(product);
  if (deltaH <= 0 || candidate.z <= EPS) return undefined;
  const expectedZ = candidate.z - deltaH;
  for (let i = existing.length - 1; i >= 0; i -= 1) {
    const b = existing[i];
    if (Math.abs(b.z - expectedZ) <= EPS && isPermittedNestedPair(candidate, b, product, product)) {
      return b;
    }
  }
  return undefined;
}
