import type { ProductInput } from "./types";
import {parseProductInput} from "./workspace-file";

export interface SavedSkuItem {
  id: string;
  sku: string;
  name: string;
  length: number; // mm
  width: number;  // mm
  height: number; // mm
  weight: number; // kg
  defaultQty: number;
  hsCode?: string;
  clientTag?: string;
  updatedAt: string;
  /** Full loading rules; absent only in legacy dimension-only library entries. */
  product?: ProductInput;
}

const STORAGE_KEY = "cargofit-sku-library-v1";

export const SAMPLE_CLIENT_TEMPLATES: Record<string, SavedSkuItem[]> = {
  "US-Outdoor-Client": [
    { id: "tpl-1", sku: "PATIO-CHAIR-01", name: "Folding Patio Chair", length: 620, width: 420, height: 360, weight: 12.5, defaultQty: 60, hsCode: "9401.79", clientTag: "US-Outdoor-Client", updatedAt: "2026-01-01" },
    { id: "tpl-2", sku: "PATIO-TABLE-02", name: "Aluminum Camp Table", length: 1120, width: 620, height: 180, weight: 18.4, defaultQty: 35, hsCode: "9403.20", clientTag: "US-Outdoor-Client", updatedAt: "2026-01-01" },
  ],
  "EU-Appliance-Client": [
    { id: "tpl-3", sku: "AIRFRY-5L-EU", name: "5L Digital Air Fryer", length: 380, width: 380, height: 410, weight: 6.2, defaultQty: 120, hsCode: "8516.60", clientTag: "EU-Appliance-Client", updatedAt: "2026-01-01" },
    { id: "tpl-4", sku: "KETTLE-17L-EU", name: "1.7L Glass Kettle", length: 440, width: 320, height: 280, weight: 7.8, defaultQty: 100, hsCode: "8516.79", clientTag: "EU-Appliance-Client", updatedAt: "2026-01-01" },
  ],
};

export function loadSkuLibrary(): SavedSkuItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedSkuItem => {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.sku !== "string" || !item.sku.trim() || typeof item.name !== "string" || typeof item.updatedAt !== "string" ||
        ![item.length,item.width,item.height].every(n => typeof n === "number" && Number.isFinite(n) && n > 0) ||
        !Number.isFinite(item.weight) || item.weight < 0 || !Number.isInteger(item.defaultQty) || item.defaultQty < 0 ||
        item.clientTag !== undefined && typeof item.clientTag !== "string") return false;
      try { if (item.product) item.product = parseProductInput(item.product); return true; } catch { return false; }
    });
  } catch {
    return [];
  }
}

export function saveSkuLibrary(items: SavedSkuItem[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch { return false; }
}

export function mergeProductsIntoLibrary(
  existing: SavedSkuItem[],
  products: readonly ProductInput[],
  clientTag?: string,
): SavedSkuItem[] {
  const bySku = new Map(existing.map((i) => [i.sku.toLowerCase(), i]));
  const now = new Date().toISOString().slice(0, 10);
  for (const p of products) {
    if (!p.sku?.trim() || p.length <= 0 || p.width <= 0 || p.height <= 0) continue;
    const key = p.sku.trim().toLowerCase();
    const prev = bySku.get(key);
    bySku.set(key, {
      id: prev?.id ?? `lib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sku: p.sku.trim(),
      name: p.name?.trim() || prev?.name || p.sku.trim(),
      length: p.length,
      width: p.width,
      height: p.height,
      weight: p.weight,
      defaultQty: Math.max(1, p.quantity || prev?.defaultQty || 10),
      hsCode: prev?.hsCode,
      clientTag: clientTag?.trim() || prev?.clientTag,
      updatedAt: now,
      product: structuredClone(p),
    });
  }
  return Array.from(bySku.values());
}

const PALETTE = ["#0F766E", "#2563EB", "#D97706", "#7C3AED", "#DC2626", "#059669"];

export function savedSkuToProduct(item: SavedSkuItem, index: number): ProductInput {
  return {
    id: `sku-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 5)}`,
    sku: item.sku,
    name: item.name,
    length: item.length,
    width: item.width,
    height: item.height,
    weight: item.weight,
    quantity: Math.max(1, item.defaultQty),
    color: PALETTE[index % PALETTE.length],
    allowRotate: true,
    rotationPolicy: "upright",
    maxStackLayers: 0,
    stackable: true,
    priority: 1,
    cargoType: "carton",
    ...(item.product ? {...structuredClone(item.product), id:`sku-${Date.now()}-${index}-${Math.random().toString(36).slice(2,5)}`} : {}),
  };
}
