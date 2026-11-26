import type { PackingResult, ProductInput } from "./types";

export interface LandedCostInput {
  currency: string;
  oceanFreight: number;
  truckingFee: number;
  customsAndPortFee: number; // THC + DOC + VGM + Customs
  insuranceFee: number;
  dutyRatePercent: number; // applied to unit FOB value if provided
  allocationBasis: "cbm" | "wm";
}

export interface LandedCostSkuRow {
  sku: string;
  cartons: number;
  cbm: number;
  weightKg: number;
  sharePct: number;
  allocatedLogistics: number;
  logisticsPerCarton: number;
  estimatedDutyPerCarton: number;
  landedUnitCost: number | null;
}

export interface LandedCostReport {
  currency: string;
  totalLogisticsCost: number;
  costPerCbm: number;
  totalCbm: number;
  totalWeightKg: number;
  rows: LandedCostSkuRow[];
}

export function computeLandedCostBreakdown(
  plan: PackingResult,
  products: readonly ProductInput[],
  input: LandedCostInput,
  fobBySku: Record<string, number> = {},
): LandedCostReport {
  const totalLogisticsCost =
    Math.max(0, input.oceanFreight) +
    Math.max(0, input.truckingFee) +
    Math.max(0, input.customsAndPortFee) +
    Math.max(0, input.insuranceFee);

  const bySku = new Map<string, { sku: string; cartons: number; cbm: number; weightKg: number }>();
  for (const box of plan.placements) {
    const cur = bySku.get(box.sku) ?? { sku: box.sku, cartons: 0, cbm: 0, weightKg: 0 };
    cur.cartons += 1;
    cur.cbm += (box.dx * box.dy * box.dz) / 1e9;
    cur.weightKg += box.weight;
    bySku.set(box.sku, cur);
  }

  // Fallback if products exist without placements
  if (bySku.size === 0) {
    for (const p of products) {
      if (p.quantity <= 0) continue;
      bySku.set(p.sku, {
        sku: p.sku,
        cartons: p.quantity,
        cbm: (p.length * p.width * p.height * p.quantity) / 1e9,
        weightKg: p.weight * p.quantity,
      });
    }
  }

  const items = Array.from(bySku.values());
  const totalCbm = items.reduce((s, r) => s + r.cbm, 0);
  const totalWeightKg = items.reduce((s, r) => s + r.weightKg, 0);
  const metricFor = (r: { cbm: number; weightKg: number }) =>
    input.allocationBasis === "wm" ? Math.max(r.cbm, r.weightKg / 1000) : r.cbm;
  const totalBasis = Math.max(1e-6, items.reduce((s, r) => s + metricFor(r), 0));
  const dutyRate = Math.max(0, input.dutyRatePercent) / 100;

  const rows: LandedCostSkuRow[] = items.map((r) => {
    const basis = metricFor(r);
    const share = basis / totalBasis;
    const allocatedLogistics = totalLogisticsCost * share;
    const logisticsPerCarton = r.cartons > 0 ? allocatedLogistics / r.cartons : 0;
    const fob = fobBySku[r.sku];
    const hasFob = typeof fob === "number" && fob > 0;
    const estimatedDutyPerCarton = hasFob ? (fob + logisticsPerCarton) * dutyRate : 0;
    const landedUnitCost = hasFob ? Math.round((fob + logisticsPerCarton + estimatedDutyPerCarton) * 100) / 100 : null;

    return {
      sku: r.sku,
      cartons: r.cartons,
      cbm: Math.round(r.cbm * 1000) / 1000,
      weightKg: Math.round(r.weightKg * 10) / 10,
      sharePct: Math.round(share * 1000) / 10,
      allocatedLogistics: Math.round(allocatedLogistics * 100) / 100,
      logisticsPerCarton: Math.round(logisticsPerCarton * 100) / 100,
      estimatedDutyPerCarton: Math.round(estimatedDutyPerCarton * 100) / 100,
      landedUnitCost,
    };
  });

  return {
    currency: input.currency || "USD",
    totalLogisticsCost: Math.round(totalLogisticsCost * 100) / 100,
    costPerCbm: totalCbm > 0 ? Math.round((totalLogisticsCost / totalCbm) * 100) / 100 : 0,
    totalCbm: Math.round(totalCbm * 100) / 100,
    totalWeightKg: Math.round(totalWeightKg * 10) / 10,
    rows,
  };
}
