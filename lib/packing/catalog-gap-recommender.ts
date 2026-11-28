import { analyzeEmptySpaces, type EmptySpace } from "./free-space";
import type { PackingResult, ProductInput } from "./types";

export interface GapFillCandidateSpec {
  id: string;
  sku: string;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  rotationPolicy?: "fixed" | "upright" | "any";
  /** Optional unit commercial value in USD for value-density ranking. */
  unitValueUsd?: number;
}

export interface GapFillZoneFit {
  zoneId: string;
  zoneOriginMm: [number, number, number];
  zoneSizeMm: [number, number, number];
  fitCount: number;
  orientationMm: [number, number, number];
}

export interface GapFillRecommendation {
  skuId: string;
  sku: string;
  name: string;
  maxAdditionalUnits: number;
  limitingFactor: "geometry" | "weight";
  addedWeightKg: number;
  addedVolumeM3: number;
  utilizationGainPct: number;
  estimatedAddedValueUsd: number;
  zoneFits: GapFillZoneFit[];
}

export interface CatalogGapFillReport {
  usableZones: EmptySpace[];
  remainingPayloadKg: number;
  remainingVolumeM3: number;
  recommendations: GapFillRecommendation[];
}

function getCandidateOrientations(spec: GapFillCandidateSpec): Array<[number, number, number]> {
  const { length: l, width: w, height: h, rotationPolicy } = spec;
  if (rotationPolicy === "fixed") return [[l, w, h]];
  if (rotationPolicy === "upright") {
    return l === w ? [[l, w, h]] : [[l, w, h], [w, l, h]];
  }
  const unique = new Map<string, [number, number, number]>();
  const perms: Array<[number, number, number]> = [
    [l, w, h],
    [w, l, h],
    [l, h, w],
    [h, l, w],
    [w, h, l],
    [h, w, l],
  ];
  for (const p of perms) unique.set(p.join("x"), p);
  return [...unique.values()];
}

function bestGridFitInSpace(
  space: EmptySpace,
  orientations: ReadonlyArray<[number, number, number]>,
): { count: number; orientation: [number, number, number] } {
  let bestCount = 0;
  let bestOri: [number, number, number] = orientations[0] ?? [0, 0, 0];
  for (const [dx, dy, dz] of orientations) {
    if (dx <= 0 || dy <= 0 || dz <= 0) continue;
    const nx = Math.floor(space.dx / dx);
    const ny = Math.floor(space.dy / dy);
    const nz = Math.floor(space.dz / dz);
    const count = nx * ny * nz;
    if (count > bestCount) {
      bestCount = count;
      bestOri = [dx, dy, dz];
    }
  }
  return { count: bestCount, orientation: bestOri };
}

/**
 * 3D Residual Void & SKU Catalog Gap-Fill Recommender (Direction 10).
 * Uses exact 3D disjoint residual free-space cuboids (`analyzeEmptySpaces`) + remaining payload weight.
 * Never estimates filler capacity from residual total CBM ratio.
 */
export function recommendCatalogGapFill(
  plan: PackingResult,
  catalog: ReadonlyArray<GapFillCandidateSpec | ProductInput>,
  maxResults = 8,
): CatalogGapFillReport {
  const emptyAnalysis = analyzeEmptySpaces(plan, 200);
  const usableZones = emptyAnalysis.spaces.filter(
    (s) => s.dx >= 100 && s.dy >= 100 && s.dz >= 100,
  );
  const remainingPayloadKg = Math.max(
    0,
    Number((plan.container.maxWeight - plan.metrics.grossWeight).toFixed(2)),
  );
  const containerVolM3 =
    (plan.container.length * plan.container.width * plan.container.height) / 1e9;
  const remainingVolumeM3 = Number(
    Math.max(0, emptyAnalysis.coveredVolume / 1e9).toFixed(3),
  );

  const recommendations: GapFillRecommendation[] = [];

  for (const item of catalog) {
    if (
      !Number.isFinite(item.length) ||
      !Number.isFinite(item.width) ||
      !Number.isFinite(item.height) ||
      item.length <= 0 ||
      item.width <= 0 ||
      item.height <= 0
    ) {
      continue;
    }
    const spec: GapFillCandidateSpec = {
      id: item.id,
      sku: item.sku,
      name: item.name,
      length: item.length,
      width: item.width,
      height: item.height,
      weight: Math.max(0.01, item.weight),
      rotationPolicy: item.rotationPolicy ?? "any",
      unitValueUsd: "unitValueUsd" in item ? item.unitValueUsd : undefined,
    };
    const orientations = getCandidateOrientations(spec);
    let geometricTotal = 0;
    const zoneFits: GapFillZoneFit[] = [];

    for (const space of usableZones) {
      const fit = bestGridFitInSpace(space, orientations);
      if (fit.count > 0) {
        geometricTotal += fit.count;
        zoneFits.push({
          zoneId: space.id,
          zoneOriginMm: [Math.round(space.x), Math.round(space.y), Math.round(space.z)],
          zoneSizeMm: [Math.round(space.dx), Math.round(space.dy), Math.round(space.dz)],
          fitCount: fit.count,
          orientationMm: fit.orientation,
        });
      }
    }

    if (geometricTotal <= 0) continue;

    const weightMax = Math.floor(remainingPayloadKg / spec.weight);
    const maxAdditionalUnits = Math.min(geometricTotal, weightMax);
    if (maxAdditionalUnits <= 0) continue;

    const limitingFactor: "geometry" | "weight" =
      weightMax < geometricTotal ? "weight" : "geometry";
    const unitVolM3 = (spec.length * spec.width * spec.height) / 1e9;
    const addedVolumeM3 = Number((maxAdditionalUnits * unitVolM3).toFixed(3));
    const addedWeightKg = Number((maxAdditionalUnits * spec.weight).toFixed(2));
    const utilizationGainPct =
      containerVolM3 > 0 ? Number(((addedVolumeM3 / containerVolM3) * 100).toFixed(2)) : 0;
    const estimatedAddedValueUsd = Number(
      (maxAdditionalUnits * (spec.unitValueUsd ?? 0)).toFixed(2),
    );

    recommendations.push({
      skuId: spec.id,
      sku: spec.sku,
      name: spec.name,
      maxAdditionalUnits,
      limitingFactor,
      addedWeightKg,
      addedVolumeM3,
      utilizationGainPct,
      estimatedAddedValueUsd,
      zoneFits,
    });
  }

  recommendations.sort(
    (a, b) =>
      b.utilizationGainPct - a.utilizationGainPct ||
      b.maxAdditionalUnits - a.maxAdditionalUnits,
  );

  return {
    usableZones,
    remainingPayloadKg,
    remainingVolumeM3,
    recommendations: recommendations.slice(0, Math.max(1, maxResults)),
  };
}
