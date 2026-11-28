import type { PackingResult, ProductInput } from "./types";

export interface PackagingBomConfig {
  /** Level 1: Units per inner pack (default 1). */
  unitsPerInnerPack: number;
  /** Level 2: Inner packs per master carton (default 1). */
  innerPacksPerCarton: number;
  /** Level 2: Inner pack packaging material weight (kg) & unit cost (USD). */
  innerPackWeightKg: number;
  innerPackCostUsd: number;
  /** Level 3: Empty master carton tare weight (kg) & unit cost (USD). */
  masterCartonTareKg: number;
  masterCartonCostUsd: number;
  /** Level 4: Pallet/crate tare weight (kg), unit cost (USD), and reuse cycles (1 = single-use). */
  palletTareKg: number;
  palletUnitCostUsd: number;
  palletReuseCycles: number;
  /** Level 5: Container dunnage / lashing / desiccant material cost (USD) & weight (kg). */
  containerDunnageWeightKg: number;
  containerDunnageCostUsd: number;
  /** Level 6: Fleet container count multiplier (default 1). */
  fleetContainerCount: number;
  containerFreightUsd: number;
}

export const DEFAULT_PACKAGING_BOM_CONFIG: PackagingBomConfig = {
  unitsPerInnerPack: 1,
  innerPacksPerCarton: 1,
  innerPackWeightKg: 0.15,
  innerPackCostUsd: 0.45,
  masterCartonTareKg: 0.85,
  masterCartonCostUsd: 1.8,
  palletTareKg: 22,
  palletUnitCostUsd: 18,
  palletReuseCycles: 1,
  containerDunnageWeightKg: 15,
  containerDunnageCostUsd: 65,
  fleetContainerCount: 1,
  containerFreightUsd: 3500,
};

export interface PackagingBomLevelRow {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  code: string;
  nameZh: string;
  nameEn: string;
  quantity: number;
  unitLabelZh: string;
  unitLabelEn: string;
  materialTareKg: number;
  amortizedCostUsd: number;
}

export interface PackagingBomReport {
  levels: PackagingBomLevelRow[];
  loadedCartons: number;
  totalProductUnits: number;
  palletCount: number;
  netProductWeightKg: number;
  totalPackagingTareKg: number;
  grossShippedWeightKg: number;
  tareRatioPct: number;
  totalPackagingCostPerContainerUsd: number;
  packagingCostPerCartonUsd: number;
  packagingCostPerUnitUsd: number;
  fleetTotalPackagingCostUsd: number;
  fleetTotalLandedLogisticsUsd: number;
}

function pos(v: number, fallback: number): number {
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * 6-Level Multi-Tier Packaging BOM, Tare Ratio & Reusable Amortization Engine (Direction 04).
 * Levels: Product -> Inner Pack -> Master Carton -> Transport Unit (Pallet/Crate) -> Container -> Fleet.
 */
export function computePackagingBom(
  plan: PackingResult,
  _products: readonly ProductInput[],
  rawConfig: Partial<PackagingBomConfig> = {},
): PackagingBomReport {
  const cfg: PackagingBomConfig = { ...DEFAULT_PACKAGING_BOM_CONFIG, ...rawConfig };
  const unitsPerInner = Math.max(1, Math.round(pos(cfg.unitsPerInnerPack, 1)));
  const innerPerCarton = Math.max(1, Math.round(pos(cfg.innerPacksPerCarton, 1)));
  const reuseCycles = Math.max(1, Math.round(pos(cfg.palletReuseCycles, 1)));
  const fleetCount = Math.max(1, Math.round(pos(cfg.fleetContainerCount, 1)));

  const loadedCartons = plan.metrics.loadedCount;
  const totalInnerPacks = loadedCartons * innerPerCarton;
  const totalProductUnits = totalInnerPacks * unitsPerInner;
  const palletCount = plan.pallets?.length ?? 0;

  const innerTareKg = totalInnerPacks * pos(cfg.innerPackWeightKg, 0);
  const innerCostUsd = totalInnerPacks * pos(cfg.innerPackCostUsd, 0);

  const cartonTareKg = loadedCartons * pos(cfg.masterCartonTareKg, 0);
  const cartonCostUsd = loadedCartons * pos(cfg.masterCartonCostUsd, 0);

  const palletTareKg = palletCount * pos(cfg.palletTareKg, 0);
  const palletAmortizedCostUsd = (palletCount * pos(cfg.palletUnitCostUsd, 0)) / reuseCycles;

  const dunnageTareKg = loadedCartons > 0 ? pos(cfg.containerDunnageWeightKg, 0) : 0;
  const dunnageCostUsd = loadedCartons > 0 ? pos(cfg.containerDunnageCostUsd, 0) : 0;

  const totalPackagingTareKg = Number((innerTareKg + cartonTareKg + palletTareKg + dunnageTareKg).toFixed(2));
  const grossCargoWeightKg = plan.metrics.grossWeight;
  const netProductWeightKg = Number(Math.max(0, grossCargoWeightKg - innerTareKg - cartonTareKg).toFixed(2));
  const grossShippedWeightKg = Number((grossCargoWeightKg + palletTareKg + dunnageTareKg).toFixed(2));
  const tareRatioPct =
    grossShippedWeightKg > 0 ? Number(((totalPackagingTareKg / grossShippedWeightKg) * 100).toFixed(2)) : 0;

  const totalPackagingCostPerContainerUsd = Number(
    (innerCostUsd + cartonCostUsd + palletAmortizedCostUsd + dunnageCostUsd).toFixed(2),
  );
  const packagingCostPerCartonUsd =
    loadedCartons > 0 ? Number((totalPackagingCostPerContainerUsd / loadedCartons).toFixed(3)) : 0;
  const packagingCostPerUnitUsd =
    totalProductUnits > 0 ? Number((totalPackagingCostPerContainerUsd / totalProductUnits).toFixed(4)) : 0;

  const fleetTotalPackagingCostUsd = Number((totalPackagingCostPerContainerUsd * fleetCount).toFixed(2));
  const fleetTotalLandedLogisticsUsd = Number(
    (fleetTotalPackagingCostUsd + pos(cfg.containerFreightUsd, 0) * fleetCount).toFixed(2),
  );

  const levels: PackagingBomLevelRow[] = [
    {
      level: 1,
      code: "L1-PRODUCT",
      nameZh: "产品单件",
      nameEn: "Product Units",
      quantity: totalProductUnits,
      unitLabelZh: "件",
      unitLabelEn: "pcs",
      materialTareKg: 0,
      amortizedCostUsd: 0,
    },
    {
      level: 2,
      code: "L2-INNER",
      nameZh: "内包装（内盒/吸塑/袋）",
      nameEn: "Inner Pack",
      quantity: totalInnerPacks,
      unitLabelZh: "盒",
      unitLabelEn: "packs",
      materialTareKg: Number(innerTareKg.toFixed(2)),
      amortizedCostUsd: Number(innerCostUsd.toFixed(2)),
    },
    {
      level: 3,
      code: "L3-CARTON",
      nameZh: "外包装（瓦楞纸箱/木箱）",
      nameEn: "Master Carton",
      quantity: loadedCartons,
      unitLabelZh: "箱",
      unitLabelEn: "cartons",
      materialTareKg: Number(cartonTareKg.toFixed(2)),
      amortizedCostUsd: Number(cartonCostUsd.toFixed(2)),
    },
    {
      level: 4,
      code: "L4-PALLET",
      nameZh: reuseCycles > 1 ? `运输单元（循环托盘 ÷${reuseCycles}次）` : "运输单元（托盘/木架）",
      nameEn: reuseCycles > 1 ? `Transport Unit (Reusable ÷${reuseCycles})` : "Transport Unit (Pallet/Crate)",
      quantity: palletCount,
      unitLabelZh: "托",
      unitLabelEn: "pallets",
      materialTareKg: Number(palletTareKg.toFixed(2)),
      amortizedCostUsd: Number(palletAmortizedCostUsd.toFixed(2)),
    },
    {
      level: 5,
      code: "L5-CONTAINER",
      nameZh: "集装箱与加固耗材",
      nameEn: "Container & Dunnage",
      quantity: 1,
      unitLabelZh: "柜",
      unitLabelEn: "container",
      materialTareKg: Number(dunnageTareKg.toFixed(2)),
      amortizedCostUsd: Number(dunnageCostUsd.toFixed(2)),
    },
    {
      level: 6,
      code: "L6-FLEET",
      nameZh: "整单多柜汇总（含海运费）",
      nameEn: "Fleet Total (incl. Freight)",
      quantity: fleetCount,
      unitLabelZh: "柜",
      unitLabelEn: "containers",
      materialTareKg: Number((totalPackagingTareKg * fleetCount).toFixed(2)),
      amortizedCostUsd: fleetTotalLandedLogisticsUsd,
    },
  ];

  return {
    levels,
    loadedCartons,
    totalProductUnits,
    palletCount,
    netProductWeightKg,
    totalPackagingTareKg,
    grossShippedWeightKg,
    tareRatioPct,
    totalPackagingCostPerContainerUsd,
    packagingCostPerCartonUsd,
    packagingCostPerUnitUsd,
    fleetTotalPackagingCostUsd,
    fleetTotalLandedLogisticsUsd,
  };
}

export function packagingBomToCsv(report: PackagingBomReport): string {
  const header = "Level,Code,NameZh,NameEn,Quantity,Unit,MaterialTareKg,AmortizedCostUsd";
  const rows = report.levels.map(
    (r) =>
      `${r.level},${r.code},"${r.nameZh}","${r.nameEn}",${r.quantity},${r.unitLabelEn},${r.materialTareKg},${r.amortizedCostUsd}`,
  );
  return [header, ...rows].join("\n");
}
