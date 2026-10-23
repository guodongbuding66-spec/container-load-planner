"use client";
import { palletEnvelopeTop } from "../lib/packing/deck-support";
import { formatMeasure } from "../lib/packing/inspection";
import type { PackingResult, PlacedPallet } from "../lib/packing/types";
import { tr, useLanguage } from "./language";

export function PalletBaseDetails({ result, pallet, unit = "mm", precision = 1 }: {
  result: PackingResult; pallet: PlacedPallet; unit?: "mm" | "cm" | "m"; precision?: number;
}) {
  useLanguage();
  const cargo = result.placements.filter(b => b.palletIds?.includes(pallet.id));
  const fmt = (n: number) => formatMeasure(n, unit, precision);
  return <section className="pallet-base-details" aria-label={tr("本托底座与完整外形", "Unit base and complete exterior")}>
    <dl className="scene-properties">
      <dt>{tr("底座尺寸", "Base dimensions")}</dt><dd>{[pallet.dx, pallet.dy, pallet.dz].map(fmt).join(" × ")}</dd>
      <dt>{tr("整托外形", "Complete unit exterior")}</dt><dd>{[pallet.dx, pallet.dy, palletEnvelopeTop(pallet, cargo) - pallet.z].map(fmt).join(" × ")}</dd>
      <dt>{tr("底座 XYZ", "Base XYZ")}</dt><dd>{[pallet.x, pallet.y, pallet.z].map(fmt).join(" / ")}</dd>
      <dt>{tr("托面 Z", "Deck surface Z")}</dt><dd>{fmt(pallet.z + pallet.dz)}</dd>
      <dt>{tr("包装自重", "Packaging tare")}</dt><dd>{pallet.weight} kg</dd>
      <dt>{tr("整托总重", "Unit gross weight")}</dt><dd>{Number((pallet.weight + cargo.reduce((n, b) => n + b.weight, 0)).toFixed(4))} kg</dd>
      <dt>{tr("本托箱数", "Cartons on this unit")}</dt><dd>{cargo.length}</dd>
    </dl>
    <p className="helper-text">{tr("本托独立包含一个底座。上层整托也保留自己的底座；货物坐标已计入底座高度。", "This unit includes its own base. Elevated units also retain their bases; cargo coordinates already include base height.")}</p>
  </section>;
}
