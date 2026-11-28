import type { PackingResult } from "./types";

export type VehicleAxleProfileId = "semi-trailer" | "rigid-truck" | "container-chassis";

export interface VehicleAxleProfile {
  id: VehicleAxleProfileId;
  labelZh: string;
  labelEn: string;
  /** Front axle / kingpin support coordinate as fraction of cargo length from nose (0 = nose, 1 = door). */
  frontSupportRatio: number;
  /** Rear axle bogie center coordinate as fraction of cargo length from nose. */
  rearSupportRatio: number;
  /** Reference statutory static cargo share limit on front support (kg). */
  frontRefLimitKg: number;
  /** Reference statutory static cargo share limit on rear bogie (kg). */
  rearRefLimitKg: number;
}

export const AXLE_PROFILES: Record<VehicleAxleProfileId, VehicleAxleProfile> = {
  "container-chassis": {
    id: "container-chassis",
    labelZh: "集装箱骨架半挂车（牵引销 + 后三联轴参考）",
    labelEn: "Container Chassis Semi-Trailer (Kingpin + Tri-Axle Ref)",
    frontSupportRatio: 0.12,
    rearSupportRatio: 0.84,
    frontRefLimitKg: 11500,
    rearRefLimitKg: 24000,
  },
  "semi-trailer": {
    id: "semi-trailer",
    labelZh: "标准半挂厢车（牵引销 + 后双联轴参考）",
    labelEn: "Standard Semi-Trailer (Kingpin + Tandem Bogie Ref)",
    frontSupportRatio: 0.14,
    rearSupportRatio: 0.82,
    frontRefLimitKg: 11500,
    rearRefLimitKg: 18000,
  },
  "rigid-truck": {
    id: "rigid-truck",
    labelZh: "单体厢式货车（前单轴 + 后驱动轴参考）",
    labelEn: "Rigid Box Truck (Front Steer + Rear Drive Axle Ref)",
    frontSupportRatio: 0.18,
    rearSupportRatio: 0.78,
    frontRefLimitKg: 7000,
    rearRefLimitKg: 11500,
  },
};

export interface AxleLoadEstimate {
  profile: VehicleAxleProfile;
  cargoWeightKg: number;
  cogXMm: number;
  cogYMm: number;
  frontSupportMm: number;
  rearSupportMm: number;
  frontCargoLoadKg: number;
  rearCargoLoadKg: number;
  frontSharePct: number;
  rearSharePct: number;
  frontUtilizationPct: number;
  rearUtilizationPct: number;
  lateralOffsetMm: number;
  lateralOffsetPct: number;
  leftSideKg: number;
  rightSideKg: number;
  status: "ok" | "warn" | "overload";
  warningsZh: string[];
  warningsEn: string[];
  disclaimerZh: string;
  disclaimerEn: string;
}

/**
 * Static beam-lever axle load distribution estimator based on real 3D cargo CoG.
 * Computes cargo-only static reaction forces at front support (a) and rear support (b):
 *   R_rear  = W * (cogX - a) / (b - a)
 *   R_front = W - R_rear
 */
export function estimateAxleLoad(
  result: PackingResult,
  profileId: VehicleAxleProfileId = "container-chassis",
): AxleLoadEstimate {
  const profile = AXLE_PROFILES[profileId];
  const L = Math.max(1, result.container.length);
  const W = Math.max(1, result.container.width);
  const boxes = result.placements;

  const disclaimerZh =
    "本测算仅基于货物 3D 重心与标准参考轴距计算静力学货载分配（不含牵引车头、车厢自重及动态制动惯性），道路合规请以车辆行驶证核定轴重与地磅实称为准。";
  const disclaimerEn =
    "Static cargo-only lever estimate using 3D CoG and reference wheelbase (excludes tractor/tare weight and braking dynamics). Verify legal compliance with vehicle registration and weighbridge.";

  const frontSupportMm = Math.round(L * profile.frontSupportRatio);
  const rearSupportMm = Math.round(L * profile.rearSupportRatio);
  const span = Math.max(1, rearSupportMm - frontSupportMm);

  if (!boxes.length) {
    return {
      profile,
      cargoWeightKg: 0,
      cogXMm: Math.round(L / 2),
      cogYMm: Math.round(W / 2),
      frontSupportMm,
      rearSupportMm,
      frontCargoLoadKg: 0,
      rearCargoLoadKg: 0,
      frontSharePct: 50,
      rearSharePct: 50,
      frontUtilizationPct: 0,
      rearUtilizationPct: 0,
      lateralOffsetMm: 0,
      lateralOffsetPct: 0,
      leftSideKg: 0,
      rightSideKg: 0,
      status: "ok",
      warningsZh: [],
      warningsEn: [],
      disclaimerZh,
      disclaimerEn,
    };
  }

  let totalWeight = 0;
  let momentX = 0;
  let momentY = 0;
  let leftSideKg = 0;
  let rightSideKg = 0;

  for (const b of boxes) {
    const cx = b.x + b.dx / 2;
    const cy = b.y + b.dy / 2;
    totalWeight += b.weight;
    momentX += b.weight * cx;
    momentY += b.weight * cy;
    if (cy < W / 2) leftSideKg += b.weight;
    else rightSideKg += b.weight;
  }

  const cogXMm = totalWeight > 0 ? momentX / totalWeight : L / 2;
  const cogYMm = totalWeight > 0 ? momentY / totalWeight : W / 2;

  const rawRearShare = (cogXMm - frontSupportMm) / span;
  const rearShare = Math.min(1.2, Math.max(-0.2, rawRearShare));
  const frontShare = 1 - rearShare;

  const rearCargoLoadKg = Number((totalWeight * rearShare).toFixed(1));
  const frontCargoLoadKg = Number((totalWeight * frontShare).toFixed(1));
  const frontSharePct = Number((frontShare * 100).toFixed(1));
  const rearSharePct = Number((rearShare * 100).toFixed(1));
  const frontUtilizationPct = Number(((Math.max(0, frontCargoLoadKg) / profile.frontRefLimitKg) * 100).toFixed(1));
  const rearUtilizationPct = Number(((Math.max(0, rearCargoLoadKg) / profile.rearRefLimitKg) * 100).toFixed(1));

  const lateralOffsetMm = Number((cogYMm - W / 2).toFixed(1));
  const lateralOffsetPct = Number(((Math.abs(lateralOffsetMm) / (W / 2)) * 100).toFixed(1));

  const warningsZh: string[] = [];
  const warningsEn: string[] = [];
  let status: "ok" | "warn" | "overload" = "ok";

  if (frontUtilizationPct > 100) {
    status = "overload";
    warningsZh.push(`前轴／牵引销货载估算达 ${frontCargoLoadKg} kg，超过参考限值 ${profile.frontRefLimitKg} kg（${frontUtilizationPct}%）。`);
    warningsEn.push(`Front/kingpin cargo load (${frontCargoLoadKg} kg) exceeds reference limit (${profile.frontRefLimitKg} kg).`);
  } else if (frontUtilizationPct >= 85) {
    status = "warn";
    warningsZh.push(`前轴／牵引销货载偏高（${frontUtilizationPct}%），请结合车头自重复核。`);
    warningsEn.push(`Front/kingpin cargo load is high (${frontUtilizationPct}%); verify with tractor tare.`);
  }

  if (rearUtilizationPct > 100) {
    status = "overload";
    warningsZh.push(`后轴组货载估算达 ${rearCargoLoadKg} kg，超过参考限值 ${profile.rearRefLimitKg} kg（${rearUtilizationPct}%）。`);
    warningsEn.push(`Rear bogie cargo load (${rearCargoLoadKg} kg) exceeds reference limit (${profile.rearRefLimitKg} kg).`);
  } else if (rearUtilizationPct >= 85 && status === "ok") {
    status = "warn";
    warningsZh.push(`后轴组货载接近参考上限（${rearUtilizationPct}%）。`);
    warningsEn.push(`Rear bogie cargo load approaches reference limit (${rearUtilizationPct}%).`);
  }

  if (lateralOffsetPct > 12) {
    if (status === "ok") status = "warn";
    warningsZh.push(`左右横向重心偏移 ${Math.abs(lateralOffsetMm)} mm（${lateralOffsetPct}%），存在侧倾偏载风险。`);
    warningsEn.push(`Lateral CoG offset is ${Math.abs(lateralOffsetMm)} mm (${lateralOffsetPct}%), risking side imbalance.`);
  }

  return {
    profile,
    cargoWeightKg: Number(totalWeight.toFixed(1)),
    cogXMm: Math.round(cogXMm),
    cogYMm: Math.round(cogYMm),
    frontSupportMm,
    rearSupportMm,
    frontCargoLoadKg,
    rearCargoLoadKg,
    frontSharePct,
    rearSharePct,
    frontUtilizationPct,
    rearUtilizationPct,
    lateralOffsetMm,
    lateralOffsetPct,
    leftSideKg: Number(leftSideKg.toFixed(1)),
    rightSideKg: Number(rightSideKg.toFixed(1)),
    status,
    warningsZh,
    warningsEn,
    disclaimerZh,
    disclaimerEn,
  };
}


/* ==================== Direction 14: Custom Wheelbase & Progressive Multi-Stop Dynamic Axle Audit ==================== */
export interface VehicleAxleCustomParams {
  /** Distance from cargo nose (x=0) to front support / kingpin (mm). */
  frontSupportMm?: number;
  /** Distance from cargo nose (x=0) to rear bogie center (mm). */
  rearSupportMm?: number;
  /** Empty vehicle/trailer tare load resting on front axle/kingpin (kg). */
  emptyFrontTareKg?: number;
  /** Empty vehicle/trailer tare load resting on rear bogie (kg). */
  emptyRearTareKg?: number;
  /** Statutory front axle / kingpin total limit (kg). */
  frontTotalLimitKg?: number;
  /** Statutory rear bogie total limit (kg). */
  rearTotalLimitKg?: number;
}

export interface ProgressiveUnloadingAxleStep {
  stepLabelZh: string;
  stepLabelEn: string;
  unloadedUpToStop: number; // 0 = initial full load, 1 = after Stop 1 unloaded, etc.
  remainingCartons: number;
  remainingCargoKg: number;
  cogXMm: number;
  frontTotalLoadKg: number;
  rearTotalLoadKg: number;
  frontUtilizationPct: number;
  rearUtilizationPct: number;
  status: "ok" | "warn" | "overload";
}

export interface ProgressiveUnloadingAxleReport {
  profile: VehicleAxleProfile;
  frontSupportMm: number;
  rearSupportMm: number;
  emptyFrontTareKg: number;
  emptyRearTareKg: number;
  steps: ProgressiveUnloadingAxleStep[];
  hasMidRouteOverload: boolean;
  worstStepIndex: number;
  disclaimerZh: string;
  disclaimerEn: string;
}

/**
 * Re-verifies vehicle axle loads after EVERY multi-stop unloading stage (Direction 14).
 * Catches mid-route kingpin/front-axle overload when tail cargo is unloaded first.
 */
export function estimateProgressiveUnloadingAxleLoads(
  result: PackingResult,
  profileId: VehicleAxleProfileId = "container-chassis",
  custom: VehicleAxleCustomParams = {},
): ProgressiveUnloadingAxleReport {
  const profile = AXLE_PROFILES[profileId] ?? AXLE_PROFILES["container-chassis"];
  const L = Math.max(1, result.container.length);
  const frontSupportMm = Math.round(custom.frontSupportMm ?? L * profile.frontSupportRatio);
  const rearSupportMm = Math.round(custom.rearSupportMm ?? L * profile.rearSupportRatio);
  const span = Math.max(1, rearSupportMm - frontSupportMm);
  const emptyFrontTareKg = Math.max(0, custom.emptyFrontTareKg ?? 0);
  const emptyRearTareKg = Math.max(0, custom.emptyRearTareKg ?? 0);
  const frontLimitKg = Math.max(100, custom.frontTotalLimitKg ?? profile.frontRefLimitKg);
  const rearLimitKg = Math.max(100, custom.rearTotalLimitKg ?? profile.rearRefLimitKg);

  const stopOf = (productId: string) => {
    const raw = result.delivery?.[productId]?.stop;
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 1;
  };
  const stopsPresent = Array.from(
    new Set(result.placements.map((p) => stopOf(p.productId))),
  ).sort((a, b) => a - b);

  const stages = [0, ...stopsPresent.slice(0, -1)];
  const steps: ProgressiveUnloadingAxleStep[] = [];

  for (const unloadedUpTo of stages) {
    const remaining = result.placements.filter((p) => stopOf(p.productId) > unloadedUpTo);
    const remainingCargoKg = remaining.reduce((sum, b) => sum + b.weight, 0);
    const momentX = remaining.reduce((sum, b) => sum + b.weight * (b.x + b.dx / 2), 0);
    const cogXMm = remainingCargoKg > 0 ? momentX / remainingCargoKg : L / 2;
    const rawRearShare = (cogXMm - frontSupportMm) / span;
    const rearShare = Math.min(1.2, Math.max(-0.2, rawRearShare));
    const frontShare = 1 - rearShare;

    const frontTotalLoadKg = Number((emptyFrontTareKg + remainingCargoKg * frontShare).toFixed(1));
    const rearTotalLoadKg = Number((emptyRearTareKg + remainingCargoKg * rearShare).toFixed(1));
    const frontUtilizationPct = Number(((Math.max(0, frontTotalLoadKg) / frontLimitKg) * 100).toFixed(1));
    const rearUtilizationPct = Number(((Math.max(0, rearTotalLoadKg) / rearLimitKg) * 100).toFixed(1));
    const maxUtil = Math.max(frontUtilizationPct, rearUtilizationPct);
    const status: ProgressiveUnloadingAxleStep["status"] =
      maxUtil > 100 ? "overload" : maxUtil >= 85 ? "warn" : "ok";

    steps.push({
      stepLabelZh: unloadedUpTo === 0 ? "满载出发（全车）" : `卸完第 ${unloadedUpTo} 站后（途中配重）`,
      stepLabelEn: unloadedUpTo === 0 ? "Initial Full Load" : `After Unloading Stop ${unloadedUpTo}`,
      unloadedUpToStop: unloadedUpTo,
      remainingCartons: remaining.length,
      remainingCargoKg: Number(remainingCargoKg.toFixed(1)),
      cogXMm: Math.round(cogXMm),
      frontTotalLoadKg,
      rearTotalLoadKg,
      frontUtilizationPct,
      rearUtilizationPct,
      status,
    });
  }

  let worstStepIndex = 0;
  let worstPeak = -1;
  steps.forEach((st, idx) => {
    const peak = Math.max(st.frontUtilizationPct, st.rearUtilizationPct);
    if (peak > worstPeak) {
      worstPeak = peak;
      worstStepIndex = idx;
    }
  });

  return {
    profile,
    frontSupportMm,
    rearSupportMm,
    emptyFrontTareKg,
    emptyRearTareKg,
    steps,
    hasMidRouteOverload: steps.some((s, i) => i > 0 && s.status === "overload"),
    worstStepIndex,
    disclaimerZh: "分段卸货动态轴荷模型支持自定义轴距与空车皮重分布；正式上路仍须依据具体牵引车/挂车铭牌、地磅实测及当地道路法规复核。",
    disclaimerEn: "Progressive unloading axle model supports custom wheelbase and tare distribution; formal road legality requires certified tractor/trailer specs and weighbridge check.",
  };
}

/* ==================== Direction 14 Complete Extension: 3-Axle Semi-Trailer (Steer / Drive / Trailer Group) ==================== */

export interface ThreeAxleCustomConfig {
  tractorWheelbaseMm?: number;
  fifthWheelAheadOfDriveMm?: number;
  kingpinFromNoseMm?: number;
  trailerAxleFromNoseMm?: number;
  tractorSteerTareKg?: number;
  tractorDriveTareKg?: number;
  trailerAxleTareKg?: number;
  steerLimitKg?: number;
  driveLimitKg?: number;
  trailerGroupLimitKg?: number;
}

export interface ThreeAxleLoadReport {
  cargoWeightKg: number;
  cogXMm: number;
  cogRatio: number;
  kingpinLoadKg: number;
  steerAxleKg: number;
  driveAxleKg: number;
  trailerGroupKg: number;
  steerLimitKg: number;
  driveLimitKg: number;
  trailerGroupLimitKg: number;
  steerUtilPct: number;
  driveUtilPct: number;
  trailerUtilPct: number;
  status: "ok" | "warn" | "overload";
  disclaimerZh: string;
  disclaimerEn: string;
}

/**
 * Full 3-axle-group semi-trailer static equilibrium solver (Steer Axle + Drive Axle + Trailer Tandem/Tridem).
 */
export function estimateThreeAxleTractorTrailerLoad(
  result: PackingResult,
  config: ThreeAxleCustomConfig = {},
  unloadedUpToStop = 0,
): ThreeAxleLoadReport {
  const L = Math.max(1000, result.container.length);
  const tractorWb = Math.max(2500, config.tractorWheelbaseMm ?? 3800);
  const fifthWheelAhead = Math.max(0, Math.min(tractorWb * 0.45, config.fifthWheelAheadOfDriveMm ?? 550));
  const kingpinX = Math.max(300, Math.min(L * 0.4, config.kingpinFromNoseMm ?? Math.round(L * 0.12)));
  const trailerAxleX = Math.max(kingpinX + 1000, Math.min(L * 0.96, config.trailerAxleFromNoseMm ?? Math.round(L * 0.82)));

  const steerTare = Math.max(0, config.tractorSteerTareKg ?? 4600);
  const driveTare = Math.max(0, config.tractorDriveTareKg ?? 3200);
  const trailerTare = Math.max(0, config.trailerAxleTareKg ?? 5200);

  const steerLimitKg = Math.max(1000, config.steerLimitKg ?? 7500);
  const driveLimitKg = Math.max(1000, config.driveLimitKg ?? 11500);
  const trailerGroupLimitKg = Math.max(1000, config.trailerGroupLimitKg ?? 21000);

  const stopOf = (productId: string) => {
    const raw = result.delivery?.[productId]?.stop;
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 1;
  };
  const boxes =
    unloadedUpToStop > 0
      ? result.placements.filter((b) => stopOf(b.productId) > unloadedUpToStop)
      : result.placements;

  const cargoWeightKg = Number(boxes.reduce((s, b) => s + Math.max(0, b.weight), 0).toFixed(1));
  const momentX = boxes.reduce((s, b) => s + Math.max(0, b.weight) * (b.x + b.dx / 2), 0);
  const cogXMm = cargoWeightKg > 0 ? Math.round(momentX / cargoWeightKg) : Math.round(L / 2);
  const cogRatio = Number(Math.max(0, Math.min(1, cogXMm / L)).toFixed(3));

  const trailerSpan = Math.max(1, trailerAxleX - kingpinX);
  const trailerShare = Math.min(1.15, Math.max(-0.15, (cogXMm - kingpinX) / trailerSpan));
  const kingpinShare = 1 - trailerShare;

  const kingpinLoadKg = Number((cargoWeightKg * kingpinShare).toFixed(1));
  const steerFromKingpin = kingpinLoadKg * (fifthWheelAhead / tractorWb);
  const driveFromKingpin = kingpinLoadKg - steerFromKingpin;

  const steerAxleKg = Number((steerTare + steerFromKingpin).toFixed(1));
  const driveAxleKg = Number((driveTare + driveFromKingpin).toFixed(1));
  const trailerGroupKg = Number((trailerTare + cargoWeightKg * trailerShare).toFixed(1));

  const steerUtilPct = Number(((Math.max(0, steerAxleKg) / steerLimitKg) * 100).toFixed(1));
  const driveUtilPct = Number(((Math.max(0, driveAxleKg) / driveLimitKg) * 100).toFixed(1));
  const trailerUtilPct = Number(((Math.max(0, trailerGroupKg) / trailerGroupLimitKg) * 100).toFixed(1));

  const peak = Math.max(steerUtilPct, driveUtilPct, trailerUtilPct);
  const status: ThreeAxleLoadReport["status"] = peak > 100 ? "overload" : peak >= 85 ? "warn" : "ok";

  return {
    cargoWeightKg,
    cogXMm,
    cogRatio,
    kingpinLoadKg,
    steerAxleKg,
    driveAxleKg,
    trailerGroupKg,
    steerLimitKg,
    driveLimitKg,
    trailerGroupLimitKg,
    steerUtilPct,
    driveUtilPct,
    trailerUtilPct,
    status,
    disclaimerZh: "正式计算需要真实车辆轴距、皮重、载荷分布与适用法规。",
    disclaimerEn: "Formal road calculation requires certified vehicle wheelbase, tare distribution, and local axle regulations.",
  };
}
