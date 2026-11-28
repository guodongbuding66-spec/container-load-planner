import type { PackingResult } from "./types";

export type FluteGradeId = "c-single" | "bc-double" | "ab-double" | "aaa-triple";
export type EnvironmentProfileId = "dry-short" | "ocean-30d" | "ocean-60d-humid";

export interface FluteGradeSpec {
  id: FluteGradeId;
  labelZh: string;
  labelEn: string;
  /** Default reference Edge Crush Test strength (kN/m). */
  defaultEctKnM: number;
  /** Nominal board caliper thickness h (mm). */
  caliperMm: number;
}

export interface EnvironmentProfile {
  id: EnvironmentProfileId;
  labelZh: string;
  labelEn: string;
  /** Combined knockdown retention factor (humidity * storage duration * pallet overhang/alignment). */
  retentionFactor: number;
  safetyFactor: number;
}

export const FLUTE_GRADES: Record<FluteGradeId, FluteGradeSpec> = {
  "c-single": {
    id: "c-single",
    labelZh: "单瓦楞 C 楞（常规轻载纸箱）",
    labelEn: "Single-Wall C-Flute (Standard)",
    defaultEctKnM: 5.6,
    caliperMm: 4.0,
  },
  "bc-double": {
    id: "bc-double",
    labelZh: "双瓦楞 BC 楞（外贸海运标准箱）",
    labelEn: "Double-Wall BC-Flute (Export Standard)",
    defaultEctKnM: 8.4,
    caliperMm: 6.8,
  },
  "ab-double": {
    id: "ab-double",
    labelZh: "加强双瓦楞 AB 楞（中重载工业箱）",
    labelEn: "Heavy Double-Wall AB-Flute (Industrial)",
    defaultEctKnM: 10.5,
    caliperMm: 7.5,
  },
  "aaa-triple": {
    id: "aaa-triple",
    labelZh: "重型三瓦楞 AAA 楞（机电/重货替代木箱）",
    labelEn: "Triple-Wall AAA-Flute (Heavy Duty)",
    defaultEctKnM: 17.5,
    caliperMm: 13.5,
  },
};

export const ENVIRONMENT_PROFILES: Record<EnvironmentProfileId, EnvironmentProfile> = {
  "dry-short": {
    id: "dry-short",
    labelZh: "干燥短途陆运（RH ≤ 50%，≤ 10 天）",
    labelEn: "Dry Short-Haul (RH ≤50%, ≤10d)",
    retentionFactor: 0.55,
    safetyFactor: 1.82,
  },
  "ocean-30d": {
    id: "ocean-30d",
    labelZh: "标准海运 30 天（RH 65–75%）",
    labelEn: "Standard Ocean 30d (RH 65–75%)",
    retentionFactor: 0.35,
    safetyFactor: 2.86,
  },
  "ocean-60d-humid": {
    id: "ocean-60d-humid",
    labelZh: "高湿长途海运 60 天+（RH 80–85%）",
    labelEn: "Humid Long Ocean 60d+ (RH 80–85%)",
    retentionFactor: 0.25,
    safetyFactor: 4.0,
  },
};

export interface SkuBctAuditRow {
  productId: string;
  sku: string;
  boxCount: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  unitWeightKg: number;
  perimeterMm: number;
  theoreticalLabBctKgf: number;
  safeAllowableTopLoadKg: number;
  actualMaxTopLoadKg: number;
  loadRatioPct: number;
  status: "safe" | "warn" | "crush-risk";
}

export interface BctAuditReport {
  flute: FluteGradeSpec;
  environment: EnvironmentProfile;
  ectUsedKnM: number;
  totalSkus: number;
  crushRiskSkus: number;
  warnSkus: number;
  rows: SkuBctAuditRow[];
  disclaimerZh: string;
  disclaimerEn: string;
}

const G_ACCEL = 9.80665;
const EPS = 1.0;

function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Simplified McKee Box Compression Test (BCT) formula:
 *   BCT (N) = 5.87 * ECT (kN/m) * sqrt(h (mm) * Z (mm))
 *   where Z = 2 * (L + W) is carton perimeter in mm, h is caliper in mm.
 */
export function computeMcKeeLabBctKgf(ectKnM: number, caliperMm: number, lengthMm: number, widthMm: number): number {
  if (ectKnM <= 0 || caliperMm <= 0 || lengthMm <= 0 || widthMm <= 0) return 0;
  const perimeterMm = 2 * (lengthMm + widthMm);
  const bctNewtons = 5.87 * ectKnM * Math.sqrt(caliperMm * perimeterMm);
  return Number((bctNewtons / G_ACCEL).toFixed(1));
}

/**
 * Computes actual cumulative vertical top-load (kg) resting above each placed box
 * by propagating downward from top layer to bottom layer proportional to X-Y contact overlap area.
 */
export function computeActualTopLoadsByPlacement(result: PackingResult): Map<string, number> {
  const boxes = result.placements;
  const topLoad = new Map<string, number>();
  for (const b of boxes) topLoad.set(b.id, 0);

  // Process from highest Z downward so upper loads cascade accurately to lower cartons
  const sorted = [...boxes].sort((a, b) => b.z - a.z);
  for (const upper of sorted) {
    const totalDownwardWeight = upper.weight + (topLoad.get(upper.id) ?? 0);
    const supports: Array<{ id: string; area: number }> = [];
    let totalSupportArea = 0;

    for (const lower of boxes) {
      if (lower.id === upper.id) continue;
      // Lower box's top face must touch upper box's bottom face within tolerance
      if (Math.abs(lower.z + lower.dz - upper.z) > EPS) continue;
      const ox = overlap1D(upper.x, upper.x + upper.dx, lower.x, lower.x + lower.dx);
      const oy = overlap1D(upper.y, upper.y + upper.dy, lower.y, lower.y + lower.dy);
      const area = ox * oy;
      if (area > EPS) {
        supports.push({ id: lower.id, area });
        totalSupportArea += area;
      }
    }

    if (totalSupportArea > 0) {
      for (const sup of supports) {
        const share = totalDownwardWeight * (sup.area / totalSupportArea);
        topLoad.set(sup.id, (topLoad.get(sup.id) ?? 0) + share);
      }
    }
  }
  return topLoad;
}

export function auditCartonBct(
  result: PackingResult,
  fluteId: FluteGradeId = "bc-double",
  envId: EnvironmentProfileId = "ocean-30d",
  customEctKnM?: number,
): BctAuditReport {
  const flute = FLUTE_GRADES[fluteId];
  const environment = ENVIRONMENT_PROFILES[envId];
  const ectUsedKnM = customEctKnM && customEctKnM > 0 ? customEctKnM : flute.defaultEctKnM;

  const topLoads = computeActualTopLoadsByPlacement(result);

  const bySku = new Map<
    string,
    {
      productId: string;
      sku: string;
      boxCount: number;
      lengthMm: number;
      widthMm: number;
      heightMm: number;
      unitWeightKg: number;
      maxTopLoadKg: number;
    }
  >();

  for (const b of result.placements) {
    const tl = topLoads.get(b.id) ?? 0;
    const cur = bySku.get(b.productId);
    if (!cur) {
      bySku.set(b.productId, {
        productId: b.productId,
        sku: b.sku,
        boxCount: 1,
        lengthMm: Math.round(b.dx),
        widthMm: Math.round(b.dy),
        heightMm: Math.round(b.dz),
        unitWeightKg: b.weight,
        maxTopLoadKg: tl,
      });
    } else {
      cur.boxCount += 1;
      if (tl > cur.maxTopLoadKg) cur.maxTopLoadKg = tl;
    }
  }

  const rows: SkuBctAuditRow[] = [...bySku.values()].map((item) => {
    const labBct = computeMcKeeLabBctKgf(ectUsedKnM, flute.caliperMm, item.lengthMm, item.widthMm);
    const safeTop = Number((labBct * environment.retentionFactor).toFixed(1));
    const actualMax = Number(item.maxTopLoadKg.toFixed(1));
    const ratio = safeTop > 0 ? Number(((actualMax / safeTop) * 100).toFixed(1)) : 0;
    const status: SkuBctAuditRow["status"] = ratio > 100 ? "crush-risk" : ratio >= 75 ? "warn" : "safe";
    return {
      productId: item.productId,
      sku: item.sku,
      boxCount: item.boxCount,
      lengthMm: item.lengthMm,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
      unitWeightKg: item.unitWeightKg,
      perimeterMm: 2 * (item.lengthMm + item.widthMm),
      theoreticalLabBctKgf: labBct,
      safeAllowableTopLoadKg: safeTop,
      actualMaxTopLoadKg: actualMax,
      loadRatioPct: ratio,
      status,
    };
  });

  rows.sort((a, b) => b.loadRatioPct - a.loadRatioPct);

  return {
    flute,
    environment,
    ectUsedKnM,
    totalSkus: rows.length,
    crushRiskSkus: rows.filter((r) => r.status === "crush-risk").length,
    warnSkus: rows.filter((r) => r.status === "warn").length,
    rows,
    disclaimerZh:
      "本测算采用简式 McKee 理论公式（5.87 × ECT × √(h×Z)）叠加储运环境折减估算安全堆码上限，未替代纸箱厂实测空箱抗压仪（BCT）数据与内装物支撑贡献。",
    disclaimerEn:
      "Uses simplified McKee formula (5.87 × ECT × √(h×Z)) with environmental knockdown factors for reference only. Does not replace certified lab BCT testing or internal product support.",
  };
}
