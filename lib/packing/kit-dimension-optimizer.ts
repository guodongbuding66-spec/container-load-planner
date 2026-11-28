import { packLoadingWorkflow } from "./pack-loading";
import { normalizedSetCode, normalizedUnitsPerSet } from "./set-utils";
import type { ContainerSpec, ProductInput } from "./types";

export interface KitDimensionCandidate {
  id: string;
  targetSku: string;
  axis: "length" | "width" | "height";
  deltaMm: number;
  originalDims: [number, number, number];
  proposedDims: [number, number, number];
  baselineUnits: number; // complete sets (for kit) or cartons (for single SKU)
  optimizedUnits: number;
  unitGain: number;
  volumeUtilPct: number;
  valid: boolean;
}

export interface KitDimensionOptimizationReport {
  groupLabel: string;
  isKit: boolean;
  baselineUnits: number;
  baselineVolumeUtilPct: number;
  bestCandidate: KitDimensionCandidate | null;
  candidates: KitDimensionCandidate[];
  evaluatedCount: number;
}

/**
 * Real deterministic Kit / SKU Joint Reverse Dimension Optimizer (Direction 03).
 * Evaluates actual container capacity using packLoadingWorkflow (zero volume-ratio guessing).
 */
export function optimizeKitCartonDimensions(
  products: readonly ProductInput[],
  container: ContainerSpec,
  clearance: number,
  options: {
    setCode?: string;
    productId?: string;
    deltasMm?: readonly number[];
    maxCandidates?: number;
  } = {},
): KitDimensionOptimizationReport {
  const deltas = options.deltasMm ?? [-20, -10, -5, 5, 10];
  const maxCandidates = options.maxCandidates ?? 18;

  let group: ProductInput[] = [];
  let isKit = false;
  let groupLabel = "";

  if (options.setCode?.trim()) {
    const code = options.setCode.trim();
    group = products.filter((p) => normalizedSetCode(p) === code);
    isKit = group.length > 0;
    groupLabel = `套装 ${code}`;
  } else if (options.productId) {
    const found = products.find((p) => p.id === options.productId);
    if (found) {
      const code = normalizedSetCode(found);
      if (code) {
        group = products.filter((p) => normalizedSetCode(p) === code);
        isKit = true;
        groupLabel = `套装 ${code}`;
      } else {
        group = [found];
        groupLabel = found.sku;
      }
    }
  } else if (products.length > 0) {
    const firstKit = products.find((p) => Boolean(normalizedSetCode(p)));
    if (firstKit) {
      const code = normalizedSetCode(firstKit)!;
      group = products.filter((p) => normalizedSetCode(p) === code);
      isKit = true;
      groupLabel = `套装 ${code}`;
    } else {
      group = [products[0]];
      groupLabel = products[0].sku;
    }
  }

  if (!group.length) {
    return {
      groupLabel: "",
      isKit: false,
      baselineUnits: 0,
      baselineVolumeUtilPct: 0,
      bestCandidate: null,
      candidates: [],
      evaluatedCount: 0,
    };
  }

  // Compute generous demand cap so solver finds true container capacity for this kit/SKU
  const unitVolMm3 = group.reduce(
    (s, p) => s + Math.max(1, p.length * p.width * p.height) * (isKit ? normalizedUnitsPerSet(p) : 1),
    0,
  );
  const unitWtKg = group.reduce(
    (s, p) => s + Math.max(0.01, p.weight) * (isKit ? normalizedUnitsPerSet(p) : 1),
    0,
  );
  const cVol = Math.max(1, container.length * container.width * container.height);
  const maxByVol = Math.ceil(cVol / Math.max(1, unitVolMm3)) + 2;
  const maxByWt = Math.ceil(container.maxWeight / Math.max(0.01, unitWtKg)) + 2;
  const trialUnits = Math.max(1, Math.min(250, Math.min(maxByVol, maxByWt)));

  const evaluate = (trialProducts: ProductInput[]) => {
    const sized = trialProducts.map((p) => ({
      ...p,
      quantity: trialUnits * (isKit ? normalizedUnitsPerSet(p) : 1),
    }));
    const res = packLoadingWorkflow({
      mode: "mixed",
      workflow: "direct",
      strategy: "maximum",
      clearance,
      practicalTargetUtilization: 0.95,
      container,
      products: sized,
    });
    const units = isKit
      ? res.setSummaries.reduce((s, row) => s + row.loadedSets, 0)
      : res.metrics.loadedCount;
    return {
      units,
      volPct: Number((res.metrics.volumeUtilization * 100).toFixed(1)),
      valid: res.validation.valid,
    };
  };

  const base = evaluate(group);
  const candidates: KitDimensionCandidate[] = [];
  let evaluatedCount = 1;

  // Prioritize the largest-volume member(s) in the kit to stay within fast interactive budget
  const sortedMembers = [...group].sort(
    (a, b) => b.length * b.width * b.height - a.length * a.width * a.height,
  );
  const targetMembers = sortedMembers.slice(0, 2);

  outer: for (const member of targetMembers) {
    for (const axis of ["length", "width", "height"] as const) {
      for (const delta of deltas) {
        if (evaluatedCount > maxCandidates) break outer;
        const proposedVal = member[axis] + delta;
        if (proposedVal < 40) continue;
        const nextGroup = group.map((p) =>
          p.id === member.id ? { ...p, [axis]: proposedVal } : p,
        );
        const ev = evaluate(nextGroup);
        evaluatedCount++;
        const updated = nextGroup.find((p) => p.id === member.id)!;
        candidates.push({
          id: `${member.id}-${axis}-${delta}`,
          targetSku: member.sku,
          axis,
          deltaMm: delta,
          originalDims: [member.length, member.width, member.height],
          proposedDims: [updated.length, updated.width, updated.height],
          baselineUnits: base.units,
          optimizedUnits: ev.units,
          unitGain: ev.units - base.units,
          volumeUtilPct: ev.volPct,
          valid: ev.valid,
        });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      Number(b.valid) - Number(a.valid) ||
      b.unitGain - a.unitGain ||
      b.volumeUtilPct - a.volumeUtilPct ||
      Math.abs(a.deltaMm) - Math.abs(b.deltaMm),
  );

  const bestCandidate = candidates.find((c) => c.valid && c.unitGain > 0) ?? null;

  return {
    groupLabel,
    isKit,
    baselineUnits: base.units,
    baselineVolumeUtilPct: base.volPct,
    bestCandidate,
    candidates: candidates.slice(0, 8),
    evaluatedCount,
  };
}
