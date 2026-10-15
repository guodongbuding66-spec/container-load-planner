import { cargoShapeProjections, type CargoProjectionView } from "./cargo-shape-geometry";
import { placedPackagingParts } from "./packaging";
import type { OrientationCode, PackingResult, PlacedBox, PlacedPallet } from "./types";

export function projectBox(box: PlacedBox, view: CargoProjectionView) {
  if (view === "top") return { x: box.x, y: box.y, width: box.dx, height: box.dy, depth: box.z };
  if (view === "side") return { x: box.x, y: box.z, width: box.dx, height: box.dz, depth: box.y };
  return { x: box.y, y: box.z, width: box.dy, height: box.dz, depth: box.x };
}

/** Millimetre coordinates with an upward vertical axis in side/door views. */
export function shapePolygons(box: PlacedBox, view: CargoProjectionView, details: PackingResult["cargoDetails"]) {
  const p = projectBox(box, view);
  return cargoShapeProjections(box.supportOnly ? {} : details?.[box.productId] ?? {}, box.orientation as OrientationCode, view, box.orientationSigns)
    .map(poly => poly.map(([x, y]) => [p.x + (x + .5) * p.width, p.y + (y + .5) * p.height] as [number, number]));
}

/** Visual packaging parts have zero mass here; accounting always uses the original pallet tare once. */
export function projectionBoxes(pallets: PlacedPallet[], cargo: PlacedBox[]): PlacedBox[] {
  return [...pallets.flatMap(p => placedPackagingParts(p).map((b, i): PlacedBox => ({ ...b,
    id: `${p.id}:part:${i}`, productId: p.id, sku: p.name, name: p.name, color: p.packaging?.color ?? "#b49b79",
    orientation: "LWH", weight: 0, layer: 1, supportOnly: true, palletIds: [p.id],
  }))), ...cargo];
}

export function planProjection(plan: PackingResult, view: CargoProjectionView) {
  const width = Math.max(1, view === "door" ? plan.container.width - plan.clearance * 2 : plan.container.length - plan.clearance * 2);
  const height = Math.max(1, view === "top" ? plan.container.width - plan.clearance * 2 : plan.container.height - plan.clearance);
  const shapes = projectionBoxes(plan.pallets ?? [], plan.placements)
    .map(box => ({ box, polygons: shapePolygons(box, view, plan.cargoDetails), depth: projectBox(box, view).depth }))
    .sort((a, b) => a.depth - b.depth);
  return { width, height, shapes };
}

export function projectionPath(polygons: [number, number][][], view: CargoProjectionView, height: number) {
  return polygons.map(poly => poly.map(([x, y], i) => `${i ? "L" : "M"}${x},${view === "top" ? y : height - y}`).join(" ") + "Z").join(" ");
}
