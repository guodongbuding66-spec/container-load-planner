import { palletParts } from "./floor-pallets";
import type { ContainerSpec } from "./types";
import type { SceneSize } from "./camera-fit";

export type TransportDisplayMode = "model" | "wireframe";
export type TransportPart = {
  name: string;
  shape: "box" | "wheel";
  role: "body" | "frame" | "floor" | "tire" | "glass" | "cab";
  // Coordinates use X=length, Y=height, Z=width, in mm; cargo floor is Y=0.
  position: SceneSize;
  size: SceneSize;
};
export const DEFAULT_TRANSPARENCY = 65;
export const TRANSPORT_COLORS = { body: "#739da6", frame: "#456c79", floor: "#b49b79", tire: "#39434b", glass: "#8ebdce", cab: "#d9e5e8" };
export function transportOpacity(transparency: number) {
  return 1 - Math.min(100, Math.max(0, Number.isFinite(transparency) ? transparency : DEFAULT_TRANSPARENCY)) / 100;
}

/** Generic exterior geometry. Every panel stays outside the entered cargo envelope. */
export function createTransportParts(space: ContainerSpec): TransportPart[] {
  const { length: l, width: w, height: h } = space;
  if (![l, w, h].every(n => Number.isFinite(n) && n > 0)) return [];
  const category = space.category ?? (space.id.startsWith("truck-") ? "truck" : space.id.startsWith("pallet-") ? "pallet" : "container");
  const parts: TransportPart[] = [];
  const box = (name: string, role: TransportPart["role"], position: SceneSize, size: SceneSize) => parts.push({ name, role, position, size, shape: "box" });
  if (category === "pallet") {
    const base = space.baseHeight ?? 144;
    if (base > 0) for (const p of palletParts(l, w, base)) box(`pallet-${p.kind}`, "floor", [p.x + p.dx / 2 - l / 2, p.z + p.dz / 2 - base, p.y + p.dy / 2 - w / 2], [p.dx, p.dz, p.dy]);
    return parts;
  }
  const t = Math.max(4, Math.min(45, Math.min(l, w, h) * .018));
  const open = space.loadingAccess === "open";
  const rack = category === "container" && /(?:20|40)fr$/i.test(space.id);
  const flatbed = category === "truck" && open;
  const wallHeight = open ? Math.min(h, w) : h;
  box("floor", "floor", [0, -t / 2, 0], [l + 2 * t, t, w + 2 * t]);
  if (!flatbed) {
    box("front-wall", "body", [-l / 2 - t / 2, wallHeight / 2, 0], [t, wallHeight, w]);
    if (!rack) for (const side of [-1, 1]) {
      box("side-wall", "body", [0, wallHeight / 2, side * (w / 2 + t / 2)], [l, wallHeight, t]);
      // Bounded repetition keeps the model inexpensive even for long trailers.
      const ribs = Math.min(32, Math.max(4, Math.ceil(l / 450)));
      for (let i = 0; i < ribs; i++) box("wall-rib", "body", [-l / 2 + (i + .5) * l / ribs, wallHeight / 2, side * (w / 2 + t * 1.15)], [t * .55, wallHeight * .93, t * .65]);
    }
    if (!open) box("roof", "body", [0, h + t / 2, 0], [l + 2 * t, t, w + 2 * t]);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      box("corner-post", "frame", [x * (l / 2 + t / 2), wallHeight / 2, z * (w / 2 + t / 2)], [t, wallHeight + t, t]);
      for (const y of [0, wallHeight]) box("corner-fitting", "frame", [x * (l / 2 + t * 1.2), y, z * (w / 2 + t * 1.2)], [t * 2.2, t * 2, t * 2.2]);
    }
    for (const z of [-1, 1]) for (const y of [0, wallHeight]) box("side-rail", "frame", [0, y, z * (w / 2 + t * .8)], [l, t * 1.4, t * .8]);
    if (rack) box("rear-frame", "body", [l / 2 + t / 2, wallHeight / 2, 0], [t, wallHeight, w]);
    else if (!open) {
      const dw = Math.min(w, Math.max(1, space.doorWidth)), dh = Math.min(h, Math.max(1, space.doorHeight));
      for (const side of [-1, 1]) {
        box("rear-door", "body", [l / 2 + t / 2, dh / 2, side * dw / 4], [t, dh, dw / 2 - Math.min(t / 4, dw / 10)]);
        for (const fraction of [.14, .37]) box("door-lock-rod", "frame", [l / 2 + t * 1.25, dh / 2, side * dw * fraction], [t * .35, dh * .88, t * .35]);
        box("door-handle", "frame", [l / 2 + t * 1.7, dh * .42, side * dw * .3], [t * .4, t * 1.2, Math.min(dw / 5, t * 4)]);
      }
      box("door-header", "frame", [l / 2 + t / 2, (h + dh) / 2, 0], [t, Math.max(t, h - dh), w]);
    }
  }
  if (category === "truck") {
    const radius = Math.min(w * .15, h * .19, l * .09), tireWidth = w * .13;
    const cabLength = Math.min(l * .23, w * .85), cabHeight = h * .78;
    box("cab", "cab", [-l / 2 - t * 2 - cabLength / 2, cabHeight / 2 - radius * .35, 0], [cabLength, cabHeight, w * .9]);
    box("windshield", "glass", [-l / 2 - t * 2 - cabLength - t / 2, cabHeight * .65, 0], [t, cabHeight * .28, w * .75]);
    for (const z of [-1, 1]) box("cab-window", "glass", [-l / 2 - t * 2 - cabLength * .52, cabHeight * .68, z * w * .455], [cabLength * .62, cabHeight * .3, t]);
    box("chassis", "frame", [-cabLength / 2, -t * 2, 0], [l + cabLength, t * 2, w * .68]);
    const axles = [-l / 2 - cabLength * .58, -l * .27, l * .3];
    if (l > 9000) axles.push(l * .3 - radius * 2.4);
    for (const x of axles) for (const z of [-1, 1]) parts.push({ name: "wheel", role: "tire", shape: "wheel", position: [x, -radius - t * 2, z * (w / 2 - tireWidth / 2)], size: [radius * 2, radius * 2, tireWidth] });
    box("rear-bumper", "frame", [l / 2 + t * 2, -radius, 0], [t * 2, t * 2, w * .8]);
  } else if (/(?:rf|rh)$/i.test(space.id)) {
    const depth = Math.min(w * .12, l * .04);
    box("refrigeration-unit", "cab", [-l / 2 - t - depth / 2, wallHeight * .55, 0], [depth, wallHeight * .62, w * .74]);
    for (let i = 0; i < 5; i++) box("reefer-grille", "frame", [-l / 2 - t - depth, wallHeight * (.4 + i * .06), 0], [t * .3, t * .4, w * .6]);
  }
  return parts;
}

/** Includes wheels/cab and the usable envelope, without changing packing dimensions. */
export function transportSceneBounds(space: ContainerSpec, scale: number, mode: TransportDisplayMode, baseY = space.baseHeight ?? 0) {
  const min: SceneSize = [-space.length / 2, 0, -space.width / 2];
  const max: SceneSize = [space.length / 2, space.height, space.width / 2];
  if (mode === "model") for (const p of createTransportParts(space)) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], p.position[i] - p.size[i] / 2);
    max[i] = Math.max(max[i], p.position[i] + p.size[i] / 2);
  }
  return { size: max.map((n, i) => (n - min[i]) * scale) as SceneSize, origin: [(min[0] + max[0]) / 2 * scale, (min[1] + baseY) * scale, (min[2] + max[2]) / 2 * scale] as SceneSize };
}
