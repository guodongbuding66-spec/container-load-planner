import type { PackingResult } from "./types";

export interface CrewSlicePayload {
  v: 1;
  c: string; // container name
  L: number;
  W: number;
  H: number;
  tot: number;
  wt: number;
  vol: number;
  compacted?: boolean;
  slices: Array<{
    idx: number;
    xFrom: number;
    xTo: number;
    items: Array<{ sku: string; qty: number; dx: number; dy: number; dz: number; col: string }>;
  }>;
}

export function buildCrewSlicePayload(plan: PackingResult): CrewSlicePayload {
  const sorted = [...plan.placements].sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
  const slices: CrewSlicePayload["slices"] = [];
  const bandMm = 1200;

  for (const box of sorted) {
    const band = Math.floor(box.x / bandMm);
    let slice = slices.find((s) => s.idx === band + 1);
    if (!slice) {
      slice = { idx: band + 1, xFrom: band * bandMm, xTo: (band + 1) * bandMm, items: [] };
      slices.push(slice);
    }
    const existing = slice.items.find(
      (it) => it.sku === box.sku && it.dx === Math.round(box.dx) && it.dy === Math.round(box.dy) && it.dz === Math.round(box.dz),
    );
    if (existing) existing.qty += 1;
    else slice.items.push({ sku: box.sku, qty: 1, dx: Math.round(box.dx), dy: Math.round(box.dy), dz: Math.round(box.dz), col: box.color });
  }

  return {
    v: 1,
    c: plan.container.name,
    L: Math.round(plan.container.length),
    W: Math.round(plan.container.width),
    H: Math.round(plan.container.height),
    tot: plan.metrics.loadedCount,
    wt: Math.round(plan.metrics.grossWeight),
    vol: Number((plan.metrics.loadedVolume / 1e9).toFixed(2)),
    slices,
  };
}

export function encodeCrewPayload(payload: CrewSlicePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


export const QR_SAFE_URL_LIMIT = 2100;

/** Validate the full manifest, not just its top-level version. */
export function isCrewPayload(value: unknown): value is CrewSlicePayload {
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const positive = (v: unknown): v is number => finite(v) && v > 0;
  const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v);
  if (!record(value) || value.v !== 1 || typeof value.c !== "string" || !value.c || !positive(value.L) || !positive(value.W) || !positive(value.H) || !integer(value.tot) || !finite(value.wt) || !finite(value.vol) || !Array.isArray(value.slices) || value.compacted === true) return false;
  let total = 0;
  const indices = new Set<number>();
  for (const s of value.slices) {
    if (!record(s) || !integer(s.idx) || s.idx < 1 || indices.has(s.idx) || !finite(s.xFrom) || !positive(s.xTo) || s.xTo <= s.xFrom || !Array.isArray(s.items)) return false;
    indices.add(s.idx);
    for (const i of s.items) {
      if (!record(i) || typeof i.sku !== "string" || !i.sku.trim() || !integer(i.qty) || i.qty < 1 || !positive(i.dx) || !positive(i.dy) || !positive(i.dz) || typeof i.col !== "string" || !/^#[0-9a-f]{6}$/i.test(i.col)) return false;
      total += i.qty;
    }
  }
  return total === value.tot;
}

export function decodeCrewPayload(rawToken: string): CrewSlicePayload | null {
  try {
    const rawB64 = rawToken.replace(/-/g, "+").replace(/_/g, "/");
    const b64 = rawB64 + "=".repeat((4 - (rawB64.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isCrewPayload(parsed) ? parsed : null;
  } catch { return null; }
}

export function decodeCrewHash(hash: string): CrewSlicePayload | null {
  const match = hash.match(/plan=([A-Za-z0-9_-]+)/);
  return match ? decodeCrewPayload(match[1]) : null;
}

/** QR fallback is lossless: never truncate SKU, quantities or loading rows. */
export function compactCrewPayloadForQr(payload: CrewSlicePayload, originLength = 40, maxUrlLen = QR_SAFE_URL_LIMIT): { payload: CrewSlicePayload; token: string; compacted: boolean; fitsQr: boolean } {
  const token = encodeCrewPayload(payload);
  return { payload, token, compacted: false, fitsQr: originLength + 12 + token.length <= maxUrlLen };
}

export function crewDraftKey(hash: string, shortId: string): string {
  if (hash) return "cargofit-crew-draft:hash:" + hash;
  if (shortId) return "cargofit-crew-draft:kv:" + shortId;
  return "cargofit-crew-draft:default";
}
