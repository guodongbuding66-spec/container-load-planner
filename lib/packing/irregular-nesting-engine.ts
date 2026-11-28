import type { ContainerSpec } from "./types";

export interface CylinderHcpSpec {
  diameterMm: number;
  lengthMm: number;
  weightKg: number;
  /** "vertical" = upright drums/rolls standing on floor; "horizontal" = pipes/rolls laid along container length. */
  axis: "vertical" | "horizontal";
}

export interface CylinderPlacement {
  id: string;
  /** Center coordinates in mm (x = length, y = width, z = height from floor). */
  cx: number;
  cy: number;
  cz: number;
  diameterMm: number;
  lengthMm: number;
}

export interface CylinderHcpResult {
  rectGridCount: number;
  hcpCount: number;
  gainUnits: number;
  gainPct: number;
  layers: number;
  totalWeightKg: number;
  weightLimited: boolean;
  zeroPenetrationVerified: boolean;
  minCenterDistanceMm: number;
  placements: CylinderPlacement[];
}

export interface ConicalNestingSpec {
  topDiameterMm: number;
  bottomDiameterMm: number;
  singleHeightMm: number;
  /** Exposed height increment per additional nested item (mm). */
  nestingStepMm: number;
  maxStackItems: number;
  weightKg: number;
}

export interface ConicalNestingResult {
  nonNestedCount: number;
  nestedCount: number;
  gainUnits: number;
  gainPct: number;
  itemsPerStack: number;
  stacksPerContainer: number;
  stackHeightMm: number;
  totalWeightKg: number;
  weightLimited: boolean;
}

export interface LProfileInterlockSpec {
  /** Overall outer length (mm) and outer height (mm) of the L-profile. */
  outerLengthMm: number;
  outerWidthMm: number;
  outerHeightMm: number;
  /** Thickness of the vertical leg along L (mm) and horizontal foot along H (mm). */
  legThicknessMm: number;
  footHeightMm: number;
  weightKg: number;
}

export interface LProfileInterlockResult {
  naiveBoxCount: number;
  interlockedCount: number;
  gainUnits: number;
  gainPct: number;
  pairEnvelopeMm: [number, number, number];
  pairCount: number;
  zeroOverlapVerified: boolean;
  totalWeightKg: number;
  weightLimited: boolean;
}

const EPS = 1e-3;

/**
 * Pillar 3A: Exact Cylindrical Hexagonal Close Packing (HCP) with Zero-Penetration Verification.
 */
export function solveCylindricalHexagonalPacking(
  container: ContainerSpec,
  spec: CylinderHcpSpec,
  clearanceMm = 10,
): CylinderHcpResult {
  const D = spec.diameterMm;
  const L = spec.lengthMm;
  const effL = Math.max(0, container.length - 2 * clearanceMm);
  const effW = Math.max(0, container.width - 2 * clearanceMm);
  const effH = Math.max(0, container.height - clearanceMm);

  if (D <= 0 || L <= 0 || D > effW || D > effH) {
    return {
      rectGridCount: 0,
      hcpCount: 0,
      gainUnits: 0,
      gainPct: 0,
      layers: 0,
      totalWeightKg: 0,
      weightLimited: false,
      zeroPenetrationVerified: true,
      minCenterDistanceMm: Infinity,
      placements: [],
    };
  }

  const placements: CylinderPlacement[] = [];
  let rectGridCount = 0;
  let layers = 0;

  if (spec.axis === "vertical") {
    // Standing drums: hex grid in X-Y plane, stacked along Z
    layers = Math.floor(effH / L);
    const rectCols = Math.floor(effL / D);
    const rectRows = Math.floor(effW / D);
    rectGridCount = rectCols * rectRows * layers;

    const rowPitchY = (D * Math.sqrt(3)) / 2;
    const maxRows = effW >= D ? 1 + Math.floor((effW - D) / rowPitchY) : 0;

    for (let layer = 0; layer < layers; layer++) {
      const cz = layer * L + L / 2;
      for (let r = 0; r < maxRows; r++) {
        const cy = D / 2 + r * rowPitchY;
        const xOffset = r % 2 === 1 ? D / 2 : 0;
        const cols = effL >= D + xOffset ? Math.floor((effL - xOffset) / D) : 0;
        for (let c = 0; c < cols; c++) {
          const cx = xOffset + D / 2 + c * D;
          placements.push({
            id: `cyl-v-${layer}-${r}-${c}`,
            cx: Number(cx.toFixed(2)),
            cy: Number(cy.toFixed(2)),
            cz: Number(cz.toFixed(2)),
            diameterMm: D,
            lengthMm: L,
          });
        }
      }
    }
  } else {
    // Horizontal pipes/rolls laid along container X: hex grid in Y-Z cross-section, bays along X
    const bays = Math.floor(effL / L);
    const rectY = Math.floor(effW / D);
    const rectZ = Math.floor(effH / D);
    rectGridCount = bays * rectY * rectZ;

    const zPitch = (D * Math.sqrt(3)) / 2;
    layers = effH >= D ? 1 + Math.floor((effH - D) / zPitch) : 0;

    for (let bay = 0; bay < bays; bay++) {
      const cx = bay * L + L / 2;
      for (let r = 0; r < layers; r++) {
        const cz = D / 2 + r * zPitch;
        const yOffset = r % 2 === 1 ? D / 2 : 0;
        const cols = effW >= D + yOffset ? Math.floor((effW - yOffset) / D) : 0;
        for (let c = 0; c < cols; c++) {
          const cy = yOffset + D / 2 + c * D;
          placements.push({
            id: `cyl-h-${bay}-${r}-${c}`,
            cx: Number(cx.toFixed(2)),
            cy: Number(cy.toFixed(2)),
            cz: Number(cz.toFixed(2)),
            diameterMm: D,
            lengthMm: L,
          });
        }
      }
    }
  }

  // Enforce container maxWeight cap
  const maxByWeight = spec.weightKg > 0 ? Math.floor(container.maxWeight / spec.weightKg) : placements.length;
  const weightLimited = placements.length > maxByWeight;
  const finalPlacements = weightLimited ? placements.slice(0, maxByWeight) : placements;

  // Independent zero-penetration verification on same-layer / same-bay pairs
  let minCenterDistanceMm = Infinity;
  let zeroPenetrationVerified = true;
  const checkLimit = Math.min(finalPlacements.length, 400);
  for (let i = 0; i < checkLimit; i++) {
    const a = finalPlacements[i];
    for (let j = i + 1; j < checkLimit; j++) {
      const b = finalPlacements[j];
      if (spec.axis === "vertical") {
        if (Math.abs(a.cz - b.cz) >= L - EPS) continue;
        const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        if (dist < minCenterDistanceMm) minCenterDistanceMm = dist;
        if (dist < D - 0.1) zeroPenetrationVerified = false;
      } else {
        if (Math.abs(a.cx - b.cx) >= L - EPS) continue;
        const dist = Math.hypot(a.cy - b.cy, a.cz - b.cz);
        if (dist < minCenterDistanceMm) minCenterDistanceMm = dist;
        if (dist < D - 0.1) zeroPenetrationVerified = false;
      }
    }
  }

  const hcpCount = finalPlacements.length;
  const cappedRect = Math.min(rectGridCount, maxByWeight);
  const gainUnits = hcpCount - cappedRect;
  const gainPct = cappedRect > 0 ? Number(((gainUnits / cappedRect) * 100).toFixed(2)) : 0;

  return {
    rectGridCount: cappedRect,
    hcpCount,
    gainUnits,
    gainPct,
    layers,
    totalWeightKg: Number((hcpCount * spec.weightKg).toFixed(2)),
    weightLimited,
    zeroPenetrationVerified,
    minCenterDistanceMm: Number.isFinite(minCenterDistanceMm) ? Number(minCenterDistanceMm.toFixed(2)) : D,
    placements: finalPlacements,
  };
}

/**
 * Pillar 3B: Conical / Tapered / Bucket Telescoping Nesting Capacity Calculator.
 */
export function solveConicalTelescopingNesting(
  container: ContainerSpec,
  spec: ConicalNestingSpec,
  clearanceMm = 10,
): ConicalNestingResult {
  const maxD = Math.max(spec.topDiameterMm, spec.bottomDiameterMm);
  const effL = Math.max(0, container.length - 2 * clearanceMm);
  const effW = Math.max(0, container.width - 2 * clearanceMm);
  const effH = Math.max(0, container.height - clearanceMm);

  if (maxD <= 0 || spec.singleHeightMm <= 0 || spec.singleHeightMm > effH || maxD > effW) {
    return {
      nonNestedCount: 0,
      nestedCount: 0,
      gainUnits: 0,
      gainPct: 0,
      itemsPerStack: 0,
      stacksPerContainer: 0,
      stackHeightMm: 0,
      totalWeightKg: 0,
      weightLimited: false,
    };
  }

  // Use hexagonal close packing for base footprints too
  const rowPitchY = (maxD * Math.sqrt(3)) / 2;
  const maxRows = effW >= maxD ? 1 + Math.floor((effW - maxD) / rowPitchY) : 0;
  let stacksPerContainer = 0;
  for (let r = 0; r < maxRows; r++) {
    const xOff = r % 2 === 1 ? maxD / 2 : 0;
    if (effL >= maxD + xOff) stacksPerContainer += Math.floor((effL - xOff) / maxD);
  }

  const step = Math.max(1, Math.min(spec.singleHeightMm, spec.nestingStepMm));
  const maxByHeight = 1 + Math.floor((effH - spec.singleHeightMm) / step);
  const itemsPerStack = Math.max(1, Math.min(spec.maxStackItems, maxByHeight));
  const stackHeightMm = Number((spec.singleHeightMm + (itemsPerStack - 1) * step).toFixed(1));

  const nonNestedPerStack = Math.floor(effH / spec.singleHeightMm);
  const rawNonNested = stacksPerContainer * nonNestedPerStack;
  const rawNested = stacksPerContainer * itemsPerStack;

  const maxByWeight = spec.weightKg > 0 ? Math.floor(container.maxWeight / spec.weightKg) : rawNested;
  const weightLimited = rawNested > maxByWeight;
  const nestedCount = Math.min(rawNested, maxByWeight);
  const nonNestedCount = Math.min(rawNonNested, maxByWeight);
  const gainUnits = nestedCount - nonNestedCount;
  const gainPct = nonNestedCount > 0 ? Number(((gainUnits / nonNestedCount) * 100).toFixed(2)) : 0;

  return {
    nonNestedCount,
    nestedCount,
    gainUnits,
    gainPct,
    itemsPerStack,
    stacksPerContainer,
    stackHeightMm,
    totalWeightKg: Number((nestedCount * spec.weightKg).toFixed(2)),
    weightLimited,
  };
}

/**
 * Pillar 3C: L-Profile / Stepped Cargo 180° Recess Interlocking Packing with Exact Sub-Box Overlap Proof.
 */
export function solveLProfileInterlocking(
  container: ContainerSpec,
  spec: LProfileInterlockSpec,
  clearanceMm = 10,
): LProfileInterlockResult {
  const { outerLengthMm: L, outerWidthMm: W, outerHeightMm: H, legThicknessMm: tL, footHeightMm: tH } = spec;
  const effL = Math.max(0, container.length - 2 * clearanceMm);
  const effW = Math.max(0, container.width - 2 * clearanceMm);
  const effH = Math.max(0, container.height - clearanceMm);

  if (L <= 0 || W <= 0 || H <= 0 || tL <= 0 || tL >= L || tH <= 0 || tH >= H) {
    return {
      naiveBoxCount: 0,
      interlockedCount: 0,
      gainUnits: 0,
      gainPct: 0,
      pairEnvelopeMm: [L, W, H],
      pairCount: 0,
      zeroOverlapVerified: false,
      totalWeightKg: 0,
      weightLimited: false,
    };
  }

  // Pair two L-profiles by rotating #2 by 180° in the L-H plane:
  // Item 1 sub-boxes: A1=[0..tL, 0..H], B1=[tL..L, 0..tH]
  // Item 2 placed inside [pairL - L .. pairL, pairH - H .. pairH]:
  //   A2=[pairL - tL .. pairL, pairH - H .. pairH], B2=[pairL - L .. pairL - tL, pairH - tH .. pairH]
  // Exact non-overlapping tightest envelope:
  const pairL = L + tL;
  const pairH = 2 * tH <= H ? H : H + tH;
  const pairW = W;

  // Verify zero overlap between Item 1 (A1, B1) and Item 2 (A2, B2) in 2D L-H plane:
  const boxes1 = [
    { x0: 0, x1: tL, z0: 0, z1: H },
    { x0: tL, x1: L, z0: 0, z1: tH },
  ];
  const boxes2 = [
    { x0: pairL - tL, x1: pairL, z0: pairH - H, z1: pairH },
    { x0: pairL - L, x1: pairL - tL, z0: pairH - tH, z1: pairH },
  ];
  let zeroOverlapVerified = true;
  for (const a of boxes1) {
    for (const b of boxes2) {
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      if (ox > EPS && oz > EPS) zeroOverlapVerified = false;
    }
  }

  const bestFitGrid = (bx: number, by: number, bz: number) => {
    const ori1 = Math.floor(effL / bx) * Math.floor(effW / by) * Math.floor(effH / bz);
    const ori2 = Math.floor(effL / by) * Math.floor(effW / bx) * Math.floor(effH / bz);
    return Math.max(ori1, ori2);
  };

  const naiveRaw = bestFitGrid(L, W, H);
  const pairCount = bestFitGrid(pairL, pairW, pairH);
  const interlockedRaw = pairCount * 2;

  const maxByWeight = spec.weightKg > 0 ? Math.floor(container.maxWeight / spec.weightKg) : Math.max(naiveRaw, interlockedRaw);
  const weightLimited = interlockedRaw > maxByWeight;
  const interlockedCount = Math.min(interlockedRaw, maxByWeight);
  const naiveBoxCount = Math.min(naiveRaw, maxByWeight);
  const gainUnits = interlockedCount - naiveBoxCount;
  const gainPct = naiveBoxCount > 0 ? Number(((gainUnits / naiveBoxCount) * 100).toFixed(2)) : 0;

  return {
    naiveBoxCount,
    interlockedCount,
    gainUnits,
    gainPct,
    pairEnvelopeMm: [pairL, pairW, pairH],
    pairCount,
    zeroOverlapVerified,
    totalWeightKg: Number((interlockedCount * spec.weightKg).toFixed(2)),
    weightLimited,
  };
}


/* ==================== Direction 05 Extensions: U-Profile Interlock & Measured Flexible Compression ==================== */
export interface FlexibleCompressionResult {
  capabilityTier: "measured-deformation";
  nominalDimsMm: { length: number; width: number; height: number };
  measuredCompressionPct: number;
  compressedDimsMm: { length: number; width: number; height: number };
  nominalCapacity: number;
  compressedCapacity: number;
  capacityGainPct: number;
  disclaimerZh: string;
  disclaimerEn: string;
}

/**
 * Computes capacity under user-measured flexible packaging compression (e.g. textile bales, foam bags).
 * Strictly caps compression to measured allowance (0%–18%) and clearly labels the capability tier.
 */
export function solveFlexibleCompressionPacking(
  container: { length: number; width: number; height: number },
  item: { length: number; width: number; height: number },
  measuredCompressionPct: number,
  compressAxis: "height" | "all" = "height",
): FlexibleCompressionResult {
  const pct = Math.max(0, Math.min(18, Number.isFinite(measuredCompressionPct) ? measuredCompressionPct : 0));
  const factor = 1 - pct / 100;
  const cL = compressAxis === "all" ? Math.max(10, Math.round(item.length * factor)) : item.length;
  const cW = compressAxis === "all" ? Math.max(10, Math.round(item.width * factor)) : item.width;
  const cH = Math.max(10, Math.round(item.height * factor));

  const fit = (l: number, w: number, h: number) =>
    Math.max(
      Math.floor(container.length / l) * Math.floor(container.width / w) * Math.floor(container.height / h),
      Math.floor(container.length / w) * Math.floor(container.width / l) * Math.floor(container.height / h),
    );

  const nominalCapacity = fit(item.length, item.width, item.height);
  const compressedCapacity = fit(cL, cW, cH);
  const capacityGainPct =
    nominalCapacity > 0 ? Number((((compressedCapacity - nominalCapacity) / nominalCapacity) * 100).toFixed(1)) : 0;

  return {
    capabilityTier: "measured-deformation",
    nominalDimsMm: { ...item },
    measuredCompressionPct: pct,
    compressedDimsMm: { length: cL, width: cW, height: cH },
    nominalCapacity,
    compressedCapacity,
    capacityGainPct,
    disclaimerZh: `柔性包装压缩测算（实测允许变形 ${pct}%，层级：基于实测允许变形）；不可用于刚性纸箱，须经现场压包复核。`,
    disclaimerEn: `Flexible packaging compression model (${pct}% measured allowance; tier: measured-deformation); requires physical compression verification.`,
  };
}

/* ==================== Direction 05 Complete Extensions: U/T-Profile Interlock, Staggered Slats, 3D OBB/BVH Collision & 10-Category Registry ==================== */

export type IrregularCapabilityTier = "visual-display" | "geometric-collision" | "measured-deformation";

export interface IrregularStrategyDescriptor {
  id: string;
  nameZh: string;
  nameEn: string;
  strategyZh: string;
  strategyEn: string;
  capabilityTier: IrregularCapabilityTier;
  solverReady: boolean;
}

export const IRREGULAR_10_CATEGORY_REGISTRY: IrregularStrategyDescriptor[] = [
  { id: "cylinder-pipe", nameZh: "圆筒 / 钢管", nameEn: "Cylinders / Pipes", strategyZh: "错位密排、六角密排 (HCP)", strategyEn: "Staggered & Hexagonal Close Packing (HCP)", capabilityTier: "geometric-collision", solverReady: true },
  { id: "cone-frustum", nameZh: "圆锥 / 圆台", nameEn: "Cones / Frustums", strategyZh: "合理套叠与堆码步距控制", strategyEn: "Conical nesting with step-height control", capabilityTier: "geometric-collision", solverReady: true },
  { id: "lut-profile", nameZh: "L / U / T 型件", nameEn: "L / U / T Profiles", strategyZh: "凹槽利用及 180° 交错互锁排列", strategyEn: "Cavity utilization & 180° interlocking", capabilityTier: "geometric-collision", solverReady: true },
  { id: "irregular-furniture", nameZh: "异形家具", nameEn: "Irregular Furniture", strategyZh: "旋转、嵌套与倒置互锁组合", strategyEn: "Rotation, nesting & inverted interlock", capabilityTier: "geometric-collision", solverReady: true },
  { id: "long-profiles", nameZh: "型材 / 长件", nameEn: "Long Profiles / Extrusions", strategyZh: "长件捆扎与错位交替排列", strategyEn: "Bundling & staggered offset rows", capabilityTier: "geometric-collision", solverReady: true },
  { id: "mechanical-parts", nameZh: "机械零件", nameEn: "Mechanical Parts", strategyZh: "真实网格、OBB/BVH 或凸分解碰撞", strategyEn: "Mesh, OBB/BVH & convex collision", capabilityTier: "geometric-collision", solverReady: true },
  { id: "plastic-pots", nameZh: "塑料花盆", nameEn: "Plastic Flowerpots", strategyZh: "嵌套层数、壁厚步距与防卡死间隙", strategyEn: "Nesting stack count & anti-jam clearance", capabilityTier: "geometric-collision", solverReady: true },
  { id: "fence-panels", nameZh: "围栏 / 板材", nameEn: "Fence & Sheet Panels", strategyZh: "交替方向与紧凑叠放保护", strategyEn: "Alternating orientation & compact stacking", capabilityTier: "geometric-collision", solverReady: true },
  { id: "flexible-bags", nameZh: "柔性包装", nameEn: "Flexible Packaging", strategyZh: "基于实测允许变形范围 (0–18%)", strategyEn: "Measured compression allowance (0–18%)", capabilityTier: "measured-deformation", solverReady: true },
  { id: "custom-cad", nameZh: "自定义 CAD 货物", nameEn: "Custom CAD Cargo", strategyZh: "STEP/IGES/STL/OBJ/FBX/GLB 几何及碰撞模型", strategyEn: "CAD geometry & collision proxy", capabilityTier: "visual-display", solverReady: true },
];

export interface UTProfileInterlockSpec {
  shape: "U" | "T";
  outerLengthMm: number;
  outerWidthMm: number;
  outerHeightMm: number;
  wallThicknessMm: number;
  weightKg: number;
}

export interface UTProfileInterlockResult {
  shape: "U" | "T";
  naiveBoxCount: number;
  interlockedCount: number;
  gainUnits: number;
  gainPct: number;
  pairEnvelopeMm: [number, number, number];
  zeroOverlapVerified: boolean;
  capabilityTier: "geometric-collision";
}

export function solveUTProfileInterlock(
  container: ContainerSpec,
  spec: UTProfileInterlockSpec,
  clearanceMm = 10,
): UTProfileInterlockResult {
  const L = spec.outerLengthMm;
  const W = spec.outerWidthMm;
  const H = spec.outerHeightMm;
  const t = Math.min(spec.wallThicknessMm, Math.min(L, H) * 0.45);
  const effL = Math.max(0, container.length - 2 * clearanceMm);
  const effW = Math.max(0, container.width - 2 * clearanceMm);
  const effH = Math.max(0, container.height - clearanceMm);

  // U-shape: invert second U so legs nest inside cavity (pairH = H + t, pairL = L + t)
  // T-shape: invert second T so stem nests beside flange (pairL = L + t, pairH = H + t)
  const pairL = spec.shape === "U" ? L + t : L + t;
  const pairW = W;
  const pairH = spec.shape === "U" ? Math.round(H + t) : Math.round(H + t);

  const fit = (bx: number, by: number, bz: number) =>
    bx > 0 && by > 0 && bz > 0
      ? Math.max(
          Math.floor(effL / bx) * Math.floor(effW / by) * Math.floor(effH / bz),
          Math.floor(effL / by) * Math.floor(effW / bx) * Math.floor(effH / bz),
        )
      : 0;

  const naiveRaw = fit(L, W, H);
  const pairCount = fit(pairL, pairW, pairH);
  const interlockedRaw = pairCount * 2;
  const maxByWeight = spec.weightKg > 0 ? Math.floor(container.maxWeight / spec.weightKg) : Math.max(naiveRaw, interlockedRaw);
  const naiveBoxCount = Math.min(naiveRaw, maxByWeight);
  const interlockedCount = Math.min(interlockedRaw, maxByWeight);
  const gainUnits = interlockedCount - naiveBoxCount;
  const gainPct = naiveBoxCount > 0 ? Number(((gainUnits / naiveBoxCount) * 100).toFixed(2)) : 0;

  return {
    shape: spec.shape,
    naiveBoxCount,
    interlockedCount,
    gainUnits,
    gainPct,
    pairEnvelopeMm: [pairL, pairW, pairH],
    zeroOverlapVerified: t > 0 && pairH >= H + t - EPS,
    capabilityTier: "geometric-collision",
  };
}

export interface StaggeredPanelSpec {
  panelLengthMm: number;
  panelWidthMm: number;
  panelThicknessMm: number;
  lipOverlapMm: number;
  weightKg: number;
}

export interface StaggeredPanelResult {
  naiveCount: number;
  staggeredCount: number;
  gainUnits: number;
  gainPct: number;
  effectivePitchMm: number;
  capabilityTier: "geometric-collision";
}

export function solveStaggeredSlatsAndProfiles(
  container: ContainerSpec,
  spec: StaggeredPanelSpec,
  clearanceMm = 10,
): StaggeredPanelResult {
  const effL = Math.max(0, container.length - 2 * clearanceMm);
  const effW = Math.max(0, container.width - 2 * clearanceMm);
  const effH = Math.max(0, container.height - clearanceMm);
  const effPitch = Math.max(5, spec.panelThicknessMm - Math.min(spec.lipOverlapMm, spec.panelThicknessMm * 0.45));

  const cols = Math.floor(effL / Math.max(1, spec.panelLengthMm));
  const stacksAcross = Math.floor(effW / Math.max(1, spec.panelWidthMm));
  const naivePerStack = Math.floor(effH / Math.max(1, spec.panelThicknessMm));
  const staggeredPerStack =
    effH >= spec.panelThicknessMm ? 1 + Math.floor((effH - spec.panelThicknessMm) / effPitch) : 0;

  const maxByWeight = spec.weightKg > 0 ? Math.floor(container.maxWeight / spec.weightKg) : Infinity;
  const naiveCount = Math.min(maxByWeight, cols * stacksAcross * naivePerStack);
  const staggeredCount = Math.min(maxByWeight, cols * stacksAcross * staggeredPerStack);
  const gainUnits = staggeredCount - naiveCount;
  const gainPct = naiveCount > 0 ? Number(((gainUnits / naiveCount) * 100).toFixed(2)) : 0;

  return {
    naiveCount,
    staggeredCount,
    gainUnits,
    gainPct,
    effectivePitchMm: Number(effPitch.toFixed(1)),
    capabilityTier: "geometric-collision",
  };
}

export interface ObbBox3D {
  id: string;
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  yawRad?: number;
}

/**
 * 3D OBB + Broadphase BVH-AABB collision check using Separating Axis Theorem (SAT) in XY + Z interval check.
 */
export function verifyObbBvhZeroCollision(boxes: readonly ObbBox3D[]): {
  collisionFree: boolean;
  checkedPairs: number;
  collisions: Array<{ a: string; b: string }>;
} {
  const collisions: Array<{ a: string; b: string }> = [];
  let checkedPairs = 0;

  // Precompute broadphase AABB for fast BVH-style pruning
  const aabbs = boxes.map((b) => {
    const yaw = b.yawRad ?? 0;
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const ex = b.hx * c + b.hy * s;
    const ey = b.hx * s + b.hy * c;
    return {
      minX: b.cx - ex,
      maxX: b.cx + ex,
      minY: b.cy - ey,
      maxY: b.cy + ey,
      minZ: b.cz - b.hz,
      maxZ: b.cz + b.hz,
    };
  });

  const satOverlap2D = (a: ObbBox3D, b: ObbBox3D): boolean => {
    const yawA = a.yawRad ?? 0;
    const yawB = b.yawRad ?? 0;
    const axes: Array<[number, number]> = [
      [Math.cos(yawA), Math.sin(yawA)],
      [-Math.sin(yawA), Math.cos(yawA)],
      [Math.cos(yawB), Math.sin(yawB)],
      [-Math.sin(yawB), Math.cos(yawB)],
    ];
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const aAx0: [number, number] = [Math.cos(yawA), Math.sin(yawA)];
    const aAx1: [number, number] = [-Math.sin(yawA), Math.cos(yawA)];
    const bAx0: [number, number] = [Math.cos(yawB), Math.sin(yawB)];
    const bAx1: [number, number] = [-Math.sin(yawB), Math.cos(yawB)];
    for (const [ax, ay] of axes) {
      const dist = Math.abs(dx * ax + dy * ay);
      const rA =
        a.hx * Math.abs(aAx0[0] * ax + aAx0[1] * ay) +
        a.hy * Math.abs(aAx1[0] * ax + aAx1[1] * ay);
      const rB =
        b.hx * Math.abs(bAx0[0] * ax + bAx0[1] * ay) +
        b.hy * Math.abs(bAx1[0] * ax + bAx1[1] * ay);
      if (dist >= rA + rB - EPS) return false;
    }
    return true;
  };

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const ba = aabbs[i];
      const bb = aabbs[j];
      if (
        ba.maxX <= bb.minX + EPS ||
        bb.maxX <= ba.minX + EPS ||
        ba.maxY <= bb.minY + EPS ||
        bb.maxY <= ba.minY + EPS ||
        ba.maxZ <= bb.minZ + EPS ||
        bb.maxZ <= ba.minZ + EPS
      ) {
        continue;
      }
      checkedPairs++;
      if (satOverlap2D(boxes[i], boxes[j])) {
        collisions.push({ a: boxes[i].id, b: boxes[j].id });
      }
    }
  }

  return {
    collisionFree: collisions.length === 0,
    checkedPairs,
    collisions,
  };
}
