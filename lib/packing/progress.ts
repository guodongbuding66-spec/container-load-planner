import type { PackingResult, PlacedBox } from "./types";

export type PackingProgressSummary = {
  isSetMode: boolean;
  visibleCartons: number;
  totalCartons: number;
  completedSets: number;
  totalSets: number;
  currentPlacement?: PlacedBox;
  currentSetNumber?: number;
  currentSetItemNumber?: number;
  currentSetCartons?: number;
};

function setKey(box: PlacedBox) {
  return box.setCode && box.setNumber !== undefined
    ? `${box.setCode}\u0000${box.setNumber}`
    : null;
}

/**
 * Converts the box-by-box animation cursor into an honest set-level summary.
 * A set is counted as completed only after every carton belonging to that set
 * is visible. The underlying cursor remains carton-based so the loading order
 * and support dependencies are never falsified.
 */
export function summarizePackingProgress(result: PackingResult, visibleCount: number): PackingProgressSummary {
  const totalCartons = result.placements.length;
  const visibleCartons = Math.min(totalCartons, Math.max(0, Math.floor(visibleCount)));
  const currentPlacement = visibleCartons > 0 ? result.placements[visibleCartons - 1] : undefined;
  const isSetMode = result.mode === "single" && result.setSummaries.length > 0;

  if (!isSetMode) {
    return {
      isSetMode: false,
      visibleCartons,
      totalCartons,
      completedSets: 0,
      totalSets: 0,
      currentPlacement,
    };
  }

  const expectedBySet = new Map<string, number>();
  const visibleBySet = new Map<string, number>();
  for (const box of result.placements) {
    const key = setKey(box);
    if (key) expectedBySet.set(key, (expectedBySet.get(key) ?? 0) + 1);
  }
  for (const box of result.placements.slice(0, visibleCartons)) {
    const key = setKey(box);
    if (key) visibleBySet.set(key, (visibleBySet.get(key) ?? 0) + 1);
  }

  const fallbackCartonsPerSet = result.setSummaries[0]?.cartonsPerSet ?? 1;
  const tracedTotalSets = expectedBySet.size;
  const totalSets = tracedTotalSets || result.setSummaries[0]?.loadedSets || Math.floor(totalCartons / fallbackCartonsPerSet);
  const completedSets = tracedTotalSets
    ? [...expectedBySet].filter(([key, expected]) => (visibleBySet.get(key) ?? 0) >= expected).length
    : Math.min(totalSets, Math.floor(visibleCartons / fallbackCartonsPerSet));
  const currentSetSummary = currentPlacement?.setCode
    ? result.setSummaries.find((item) => item.setCode === currentPlacement.setCode)
    : result.setSummaries[0];

  return {
    isSetMode: true,
    visibleCartons,
    totalCartons,
    completedSets,
    totalSets,
    currentPlacement,
    currentSetNumber: currentPlacement?.setNumber,
    currentSetItemNumber: currentPlacement?.setItemNumber,
    currentSetCartons: currentSetSummary?.cartonsPerSet ?? fallbackCartonsPerSet,
  };
}
