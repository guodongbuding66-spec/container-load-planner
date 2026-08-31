import type { ProductInput } from "./types";

const CBM_DIVISOR = 1_000_000_000;

export function exactCartonVolumeCbm(
  carton: Pick<ProductInput, "length" | "width" | "height">,
) {
  const length = Math.max(0, Number.isFinite(carton.length) ? carton.length : 0);
  const width = Math.max(0, Number.isFinite(carton.width) ? carton.width : 0);
  const height = Math.max(0, Number.isFinite(carton.height) ? carton.height : 0);
  return (length * width * height) / CBM_DIVISOR;
}

/**
 * Quotations conventionally show carton CBM to two decimal places. Keep this
 * separate from the exact geometric volume used by the physical solver.
 */
export function roundedCartonVolumeCbm(
  carton: Pick<ProductInput, "length" | "width" | "height">,
) {
  return Math.round((exactCartonVolumeCbm(carton) + Number.EPSILON) * 100) / 100;
}
