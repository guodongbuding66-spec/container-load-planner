import type { ContainerSpec, FloorPalletConfig, PlacedBox, PlacedPallet, ProductInput } from "./types";

export const PALLET_PRODUCT_ID = "__floor-pallet__";
export function parseFloorPalletConfig(value: unknown): FloorPalletConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("底层托盘设置无效。");
  const v = value as Record<string, unknown>;
  for (const k of ["presetId", "name"]) if (typeof v[k] !== "string" || !(v[k] as string).trim() || (v[k] as string).length > 120) throw new Error("托盘名称无效。");
  for (const k of ["length", "width", "height", "maxLoad"]) if (typeof v[k] !== "number" || !Number.isFinite(v[k]) || Number(v[k]) <= 0 || Number(v[k]) > 100000) throw new Error("托盘尺寸及承重必须为有效正数。");
  if (["length","width","height"].some(k=>Number(v[k])<1)) throw new Error("托盘尺寸不能小于 1 mm。");
  for (const k of ["weight", "gap"]) if (typeof v[k] !== "number" || !Number.isFinite(v[k]) || Number(v[k]) < 0 || Number(v[k]) > 10000) throw new Error("托盘自重和间隙必须为有效非负数。");
  if (!Number.isInteger(v.count) || Number(v.count) < 0 || Number(v.count) > 200) throw new Error("底层托盘数量必须为 0–200 的整数。");
  if (!["auto", "long", "cross"].includes(String(v.layout)) || typeof v.allowFloorCargo !== "boolean") throw new Error("托盘布局规则无效。");
  return { presetId: v.presetId as string, name: v.name as string, length: v.length as number, width: v.width as number, height: v.height as number, weight: v.weight as number, maxLoad: v.maxLoad as number, count: v.count as number, gap: v.gap as number, layout: v.layout as FloorPalletConfig["layout"], allowFloorCargo: v.allowFloorCargo };
}

/** Rows can use either horizontal orientation; no pallet may overlap or overhang. */
export function arrangeFloorPallets(container: ContainerSpec, clearance: number, input: FloorPalletConfig): PlacedPallet[] {
  const p = parseFloorPalletConfig(input);
  const length = container.length - clearance * 2, width = container.width - clearance * 2;
  const doorWidth = (container.loadingAccess === "open" ? container.width : container.doorWidth) - clearance * 2;
  const height = Math.min(container.height, container.loadingAccess === "open" ? container.height : container.doorHeight) - clearance;
  if (container.category === "pallet") throw new Error("请先选择集装箱或货车，再加入柜内底层托盘。");
  if (p.height >= height) throw new Error("底层托盘高度已占满柜内或门洞净空。");
  const variants = ([{ dx: p.length, dy: p.width, orientation: "LWH" }, { dx: p.width, dy: p.length, orientation: "WLH" }] as const)
    .filter((v, i) => (p.layout === "auto" || (p.layout === "long" ? i === 0 : i === 1)) && v.dy <= doorWidth && v.dx <= length && v.dy <= width)
    .map(v => ({ ...v, columns: Math.floor((length + p.gap) / (v.dx + p.gap)) }));
  let best: typeof variants = [], bestCount = 0, bestWidth = Infinity;
  const a = variants[0], b = variants[1];
  if (a) for (let na = 0; na <= Math.min(200, Math.floor((width + p.gap) / (a.dy + p.gap))); na++) {
    const used = na * (a.dy + p.gap);
    const nb = b ? Math.max(0, Math.min(200 - na, Math.floor((width + p.gap - used) / (b.dy + p.gap)))) : 0;
    const count = na * a.columns + nb * (b?.columns ?? 0), occupied = used + nb * ((b?.dy ?? 0) + p.gap) - p.gap;
    if (count > bestCount || count === bestCount && occupied < bestWidth) { bestCount = count; bestWidth = occupied; best = [...Array(na).fill(a), ...Array(nb).fill(b)] as typeof variants; }
  }
  const limit = p.count || Math.min(200, bestCount);
  if (!bestCount || p.count > bestCount) throw new Error(`当前净空最多放置 ${bestCount} 个底层托盘，请调整尺寸、数量或方向。`);
  const pallets: PlacedPallet[] = [];
  let y = 0;
  for (const row of best) { for (let i = 0; i < Math.min(row.columns, limit); i++) pallets.push({ id: `floor-pallet-${pallets.length + 1}`, presetId: p.presetId, name: p.name, x: i * (row.dx + p.gap), y, z: 0, dx: row.dx, dy: row.dy, dz: p.height, weight: p.weight, maxLoad: p.maxLoad, orientation: row.orientation }); y += row.dy + p.gap; }
  return pallets.sort((a, b) => a.x - b.x || a.y - b.y).slice(0, limit).map((p,i)=>({...p,id:`floor-pallet-${i+1}`}));
}

export function palletSupportBoxes(pallets: PlacedPallet[]): PlacedBox[] {
  return pallets.map(p => ({ ...p, productId: PALLET_PRODUCT_ID, sku: p.id, color: "#b68d5d", layer: 1, supportOnly: true }));
}
export function palletSupportProducts(pallets: PlacedPallet[]): ProductInput[] {
  // One product per physical support keeps different dimensions, payloads and weights independently verifiable.
  return pallets.map(p => ({ id: p.id, sku: p.id, name: p.name, length: p.dx, width: p.dy, height: p.dz, weight: p.weight, quantity: 1, priority: 0, rotationPolicy: "fixed", stackable: true, maxStackLayers: 0, maxTopLoadKg: p.maxLoad, color: "#b68d5d" }));
}
export function palletAnchors(pallets: PlacedPallet[]): PlacedBox[] {
  return palletSupportBoxes(pallets).map(b => ({ ...b, productId: b.id }));
}

export function assignPalletReferences(boxes: PlacedBox[], pallets: PlacedPallet[]): PlacedBox[] {
  const levels = new Map<number, PlacedBox[]>(), refs = new Map<string, string[]>();
  const key = (z: number) => Math.round(z / .0001);
  for (const p of palletAnchors(pallets)) { refs.set(p.id, [p.id]); levels.set(key(p.z + p.dz), [...(levels.get(key(p.z + p.dz)) ?? []), p]); }
  const result = new Map<string, PlacedBox>();
  for (const box of [...boxes].sort((a, b) => a.z - b.z)) {
    const ids = new Set<string>();
    for (const below of levels.get(key(box.z)) ?? []) if (Math.min(box.x + box.dx, below.x + below.dx) > Math.max(box.x, below.x) + .0001 && Math.min(box.y + box.dy, below.y + below.dy) > Math.max(box.y, below.y) + .0001) for (const id of refs.get(below.id) ?? []) ids.add(id);
    refs.set(box.id, [...ids]); result.set(box.id, { ...box, palletIds: ids.size ? [...ids].sort() : undefined });
    levels.set(key(box.z + box.dz), [...(levels.get(key(box.z + box.dz)) ?? []), box]);
  }
  return boxes.map(b => result.get(b.id)!);
}

/** Generic four-way block pallet: 5 deck boards, 3 cross boards, 9 blocks, 3 runners. */
export function palletParts(length: number, width: number, height: number) {
  if (height < 50) return [{x:0,y:0,z:0,dx:length,dy:width,dz:height,kind:"board" as const}];
  const t = height * 22 / 144, blockHeight = height - t * 3, runnerWidth = width * .145;
  const parts: Array<{ x: number; y: number; z: number; dx: number; dy: number; dz: number; kind: "board" | "block" }> = [];
  const add = (x: number, y: number, z: number, dx: number, dy: number, dz: number, kind: "board" | "block" = "board") => parts.push({ x, y, z, dx, dy, dz, kind });
  for (let i = 0; i < 3; i++) { const y = i * (width - runnerWidth) / 2; add(0, y, 0, length, runnerWidth, t); }
  for (let i = 0; i < 3; i++) { const x = i * (length - length * .12) / 2; add(x, 0, height - 2 * t, length * .12, width, t); for (let j = 0; j < 3; j++) add(x, j * (width - runnerWidth) / 2, t, length * .12, runnerWidth, blockHeight, "block"); }
  const deckWidth = width * .17;
  for (let i = 0; i < 5; i++) add(0, i * (width - deckWidth) / 4, height - t, length, deckWidth, t);
  return parts;
}
