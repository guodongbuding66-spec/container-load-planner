import { sectionBox, type BoundsBox, type Section } from "./inspection";
import { visiblePlanPallets } from "./prebuilt-pallets";
import { palletLoadEnvelope } from "./unit-envelope";
import type { PackingResult, PlacedBox, PlacedPallet } from "./types";

function enclose(boxes: readonly BoundsBox[]): BoundsBox | undefined {
  if (!boxes.length) return;
  let x = Infinity, y = Infinity, z = Infinity;
  let right = -Infinity, back = -Infinity, top = -Infinity;
  for (const box of boxes) {
    x = Math.min(x, box.x);
    y = Math.min(y, box.y);
    z = Math.min(z, box.z);
    right = Math.max(right, box.x + box.dx);
    back = Math.max(back, box.y + box.dy);
    top = Math.max(top, box.z + box.dz);
  }
  return {
    x, y, z,
    dx: right - x,
    dy: back - y,
    dz: top - z,
  };
}

export function completePalletBounds(plan: PackingResult, pallet: PlacedPallet): BoundsBox {
  const cargo = plan.placements.filter(box => box.palletIds?.includes(pallet.id));
  return enclose([palletLoadEnvelope(pallet, cargo), ...cargo])!;
}

export function inspectionPallets(plan: PackingResult, count: number, section: Section, cartons: readonly PlacedBox[]) {
  const pallets = visiblePlanPallets(plan, count);
  if (section.isolation === "all") return pallets;
  if (section.isolation === "pallet") return pallets.filter(pallet => pallet.id === section.target);
  if (section.isolation !== "layer") return [];
  const supports = new Set(cartons.flatMap(box => box.palletIds ?? []));
  return pallets.filter(pallet => supports.has(pallet.id));
}

export function selectedBounds(plan: PackingResult, selected: PlacedBox | null) {
  if (!selected?.supportOnly) return selected ?? undefined;
  const pallet = plan.pallets?.find(item => item.id === selected.id);
  return pallet ? completePalletBounds(plan, pallet) : undefined;
}

export function isolatedBounds(plan: PackingResult, section: Section, cartons: readonly PlacedBox[], pallets: readonly PlacedPallet[]) {
  if (section.isolation === "all") return undefined;
  if (section.isolation === "pallet" && pallets[0]) {
    return sectionBox(completePalletBounds(plan, pallets[0]), plan, section) ?? undefined;
  }
  return enclose(cartons);
}
