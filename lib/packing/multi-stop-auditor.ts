import type { PackingResult } from "./types";
type Placement = PackingResult["placements"][number];

export type BlockReason = "door-path" | "top-stack";

export interface StopBlockingConflict {
  blockedPlacementId: string;
  blockedSku: string;
  blockedStop: number;
  blockerPlacementId: string;
  blockerSku: string;
  blockerStop: number;
  reason: BlockReason;
  overlapMm2: number;
}

export interface StopSummaryRow {
  stop: number;
  loadOrderRank: number; // 1 = loaded first (deepest / last unloaded)
  boxCount: number;
  weightKg: number;
  volumeM3: number;
  xMinMm: number;
  xMaxMm: number;
  blockedBoxCount: number;
  directUnloadablePct: number;
  remainingWeightAfterUnloadKg: number;
  remainingCogXPct: number | null; // % of container length from nose (0% nose, 100% door)
}

export interface MultiStopAuditReport {
  totalStops: number;
  totalBoxes: number;
  conflictCount: number;
  blockedBoxCount: number;
  directUnloadablePct: number;
  lifoCompliant: boolean;
  stops: StopSummaryRow[];
  conflicts: StopBlockingConflict[];
}

const EPS = 1.0; // 1 mm geometric tolerance

function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function getStopForPlacement(p: Placement, stopByProductId: Readonly<Record<string, number>>): number {
  const raw = stopByProductId[p.productId] ?? stopByProductId[p.sku] ?? 1;
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

/**
 * Real 3D physical LIFO multi-stop unloading auditor.
 * Assumes container door is at L+ (maximum X).
 * Stop 1 unloads first (closest to door); higher stop numbers unload later (deeper toward nose).
 */
export function auditMultiStopLifo(
  result: PackingResult,
  stopByProductId: Readonly<Record<string, number>>,
): MultiStopAuditReport {
  const boxes = result.placements;
  if (!boxes.length) {
    return {
      totalStops: 0,
      totalBoxes: 0,
      conflictCount: 0,
      blockedBoxCount: 0,
      directUnloadablePct: 100,
      lifoCompliant: true,
      stops: [],
      conflicts: [],
    };
  }

  const annotated = boxes.map((box) => ({
    box,
    stop: getStopForPlacement(box, stopByProductId),
  }));

  const uniqueStops = [...new Set(annotated.map((a) => a.stop))].sort((a, b) => a - b);
  const conflicts: StopBlockingConflict[] = [];
  const blockedIds = new Set<string>();

  for (let i = 0; i < annotated.length; i++) {
    const target = annotated[i];
    const a = target.box;
    for (let j = 0; j < annotated.length; j++) {
      if (i === j) continue;
      const other = annotated[j];
      // Only a later-unloading box (higher stop number) can illegally block an earlier-unloading box
      if (other.stop <= target.stop) continue;
      const b = other.box;

      // 1. Top-stack blocking: B rests above A and overlaps in X-Y footprint
      const xyOverlap =
        overlap1D(a.x, a.x + a.dx, b.x, b.x + b.dx) *
        overlap1D(a.y, a.y + a.dy, b.y, b.y + b.dy);
      if (xyOverlap > EPS && b.z >= a.z + a.dz - EPS) {
        conflicts.push({
          blockedPlacementId: a.id,
          blockedSku: a.sku,
          blockedStop: target.stop,
          blockerPlacementId: b.id,
          blockerSku: b.sku,
          blockerStop: other.stop,
          reason: "top-stack",
          overlapMm2: Math.round(xyOverlap),
        });
        blockedIds.add(a.id);
        continue;
      }

      // 2. Door-path blocking: B is closer to L+ door than A and overlaps A in Y-Z cross-section
      const yzOverlap =
        overlap1D(a.y, a.y + a.dy, b.y, b.y + b.dy) *
        overlap1D(a.z, a.z + a.dz, b.z, b.z + b.dz);
      if (yzOverlap > EPS && b.x >= a.x + a.dx - EPS) {
        conflicts.push({
          blockedPlacementId: a.id,
          blockedSku: a.sku,
          blockedStop: target.stop,
          blockerPlacementId: b.id,
          blockerSku: b.sku,
          blockerStop: other.stop,
          reason: "door-path",
          overlapMm2: Math.round(yzOverlap),
        });
        blockedIds.add(a.id);
      }
    }
  }

  const containerLen = Math.max(1, result.container.length);
  const stops: StopSummaryRow[] = uniqueStops.map((stop, idx) => {
    const items = annotated.filter((a) => a.stop === stop);
    const weightKg = items.reduce((s, a) => s + a.box.weight, 0);
    const volumeM3 = items.reduce((s, a) => s + (a.box.dx * a.box.dy * a.box.dz) / 1e9, 0);
    const xMinMm = Math.min(...items.map((a) => a.box.x));
    const xMaxMm = Math.max(...items.map((a) => a.box.x + a.box.dx));
    const stopBlocked = items.filter((a) => blockedIds.has(a.box.id)).length;
    const directUnloadablePct = items.length
      ? Number((((items.length - stopBlocked) / items.length) * 100).toFixed(1))
      : 100;

    // Remaining cargo after unloading stops <= current stop
    const remaining = annotated.filter((a) => a.stop > stop);
    const remainingWeight = remaining.reduce((s, a) => s + a.box.weight, 0);
    let remainingCogXPct: number | null = null;
    if (remainingWeight > 0) {
      const momentX = remaining.reduce((s, a) => s + a.box.weight * (a.box.x + a.box.dx / 2), 0);
      remainingCogXPct = Number((((momentX / remainingWeight) / containerLen) * 100).toFixed(1));
    }

    return {
      stop,
      loadOrderRank: uniqueStops.length - idx,
      boxCount: items.length,
      weightKg: Number(weightKg.toFixed(2)),
      volumeM3: Number(volumeM3.toFixed(3)),
      xMinMm: Math.round(xMinMm),
      xMaxMm: Math.round(xMaxMm),
      blockedBoxCount: stopBlocked,
      directUnloadablePct,
      remainingWeightAfterUnloadKg: Number(remainingWeight.toFixed(2)),
      remainingCogXPct,
    };
  });

  const directUnloadablePct = Number(
    (((boxes.length - blockedIds.size) / boxes.length) * 100).toFixed(1),
  );

  return {
    totalStops: uniqueStops.length,
    totalBoxes: boxes.length,
    conflictCount: conflicts.length,
    blockedBoxCount: blockedIds.size,
    directUnloadablePct,
    lifoCompliant: conflicts.length === 0,
    stops,
    conflicts: conflicts.slice(0, 120),
  };
}

export function multiStopReportToCsv(report: MultiStopAuditReport): string {
  const headers = [
    "Stop",
    "LoadOrderRank",
    "BoxCount",
    "WeightKg",
    "VolumeM3",
    "XRangeMm",
    "BlockedBoxes",
    "DirectUnloadablePct",
    "RemainingWeightKg",
    "RemainingCogXPct",
  ];
  const lines = [headers.join(",")];
  for (const s of report.stops) {
    lines.push(
      [
        `Stop ${s.stop}`,
        s.loadOrderRank,
        s.boxCount,
        s.weightKg.toFixed(2),
        s.volumeM3.toFixed(3),
        `${s.xMinMm}-${s.xMaxMm}`,
        s.blockedBoxCount,
        `${s.directUnloadablePct}%`,
        s.remainingWeightAfterUnloadKg.toFixed(2),
        s.remainingCogXPct === null ? "Empty" : `${s.remainingCogXPct}%`,
      ].join(","),
    );
  }
  return lines.join("\n");
}


/* ==================== Direction 15: Post-Unload Remaining Cargo Support Audit ==================== */
export interface PostUnloadSupportRisk {
  unloadedStop: number;
  affectedPlacementId: string;
  affectedSku: string;
  affectedStop: number;
  removedSupportAreaPct: number;
  messageZh: string;
  messageEn: string;
}

/**
 * Checks whether unloading Stop k removes vertical support under any remaining Stop > k carton,
 * which would cause mid-route collapse or forced re-handling.
 */
export function auditPostUnloadSupportStability(result: PackingResult): PostUnloadSupportRisk[] {
  const boxes = result.placements;
  const risks: PostUnloadSupportRisk[] = [];
  const getStop = (productId: string) => {
    const s = result.delivery?.[productId]?.stop;
    return typeof s === "number" && Number.isFinite(s) && s > 0 ? Math.round(s) : 1;
  };

  const uniqueStops = Array.from(new Set(boxes.map((b) => getStop(b.productId)))).sort((a, b) => a - b);
  if (uniqueStops.length <= 1) return risks;

  for (const upper of boxes) {
    if (upper.z <= 5) continue; // floor-resting
    const upperStop = getStop(upper.productId);
    const upperArea = Math.max(1, upper.dx * upper.dy);

    let lostSupportArea = 0;
    let earliestUnloadedStop = Infinity;

    for (const lower of boxes) {
      if (lower.id === upper.id) continue;
      const lowerStop = getStop(lower.productId);
      if (lowerStop >= upperStop) continue; // only care if lower is unloaded BEFORE upper
      if (Math.abs(lower.z + lower.dz - upper.z) > 8) continue;

      const ox = Math.min(upper.x + upper.dx, lower.x + lower.dx) - Math.max(upper.x, lower.x);
      const oy = Math.min(upper.y + upper.dy, lower.y + lower.dy) - Math.max(upper.y, lower.y);
      if (ox > 1 && oy > 1) {
        lostSupportArea += ox * oy;
        if (lowerStop < earliestUnloadedStop) earliestUnloadedStop = lowerStop;
      }
    }

    if (lostSupportArea > 0) {
      const pct = Number(Math.min(100, (lostSupportArea / upperArea) * 100).toFixed(1));
      risks.push({
        unloadedStop: earliestUnloadedStop,
        affectedPlacementId: upper.id,
        affectedSku: upper.sku,
        affectedStop: upperStop,
        removedSupportAreaPct: pct,
        messageZh: `卸完第 ${earliestUnloadedStop} 站后，第 ${upperStop} 站货物「${upper.sku}」将失去 ${pct}% 底部承托面积，存在途中塌垛风险。`,
        messageEn: `After unloading Stop ${earliestUnloadedStop}, Stop ${upperStop} cargo "${upper.sku}" loses ${pct}% base support.`,
      });
    }
  }

  return risks.slice(0, 80);
}
