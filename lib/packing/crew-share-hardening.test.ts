import { describe, expect, it } from "vitest";
import {
  compactCrewPayloadForQr,
  crewDraftKey,
  decodeCrewPayload,
  encodeCrewPayload,
  QR_SAFE_URL_LIMIT,
  type CrewSlicePayload,
} from "./crew-payload";
import { onRequestGet, onRequestOptions, onRequestPost } from "../../functions/api/crew-share";

describe("Crew View QR compaction & Cloudflare KV short-link hardening", () => {
  it("preserves all 60 SKUs and falls back to a full URL when QR capacity is exceeded", () => {
    const mega: CrewSlicePayload = {
      v: 1,
      c: "40HQ High Cube Container",
      L: 12032,
      W: 2352,
      H: 2698,
      tot: 600,
      wt: 18500,
      vol: 64.2,
      slices: Array.from({ length: 10 }, (_, sIdx) => ({
        idx: sIdx + 1,
        xFrom: sIdx * 1200,
        xTo: (sIdx + 1) * 1200,
        items: Array.from({ length: 6 }, (_, iIdx) => ({
          sku: `MEGA-SKU-${sIdx + 1}-${iIdx + 1}-EXPORT`,
          qty: 10,
          dx: 500,
          dy: 400,
          dz: 350,
          col: "#0F766E",
        })),
      })),
    };

    const fullToken = encodeCrewPayload(mega);
    expect(fullToken.length).toBeGreaterThan(QR_SAFE_URL_LIMIT);

    const compacted = compactCrewPayloadForQr(mega, 42);
    expect(compacted.compacted).toBe(false);
    expect(compacted.fitsQr).toBe(false);
    expect(42 + 12 + compacted.token.length).toBeGreaterThan(QR_SAFE_URL_LIMIT);

    const decoded = decodeCrewPayload(compacted.token);
    expect(decoded).not.toBeNull();
    expect(decoded?.tot).toBe(600);
    expect(decoded?.wt).toBe(18500);
    expect(decoded).toEqual(mega);
  });

  it("rejects malformed tokens and isolates different plans", () => {
    expect(decodeCrewPayload(encodeCrewPayload({v:1,slices:[null]} as unknown as CrewSlicePayload))).toBeNull();
    expect(crewDraftKey("#plan="+"a".repeat(60)+"x", "")).not.toBe(crewDraftKey("#plan="+"a".repeat(60)+"y", ""));
  });

  it("handles Cloudflare KV short-link roundtrip, validation, and 501 static fallback", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
    };

    const optRes = await onRequestOptions();
    expect(optRes.status).toBe(204);

    // Unbound KV -> 501 fallback
    const unbound = await onRequestPost({
      request: new Request("https://example.com/api/crew-share", { method: "POST", body: "{}" }),
      env: {},
    });
    expect(unbound.status).toBe(501);

    // Invalid JSON -> 400
    const badJson = await onRequestPost({
      request: new Request("https://example.com/api/crew-share", { method: "POST", body: "not-json" }),
      env: { CREW_SHARE_KV: kv },
    });
    expect(badJson.status).toBe(400);

    // Valid payload roundtrip
    const validBody = JSON.stringify({ v: 1, c: "40HQ", L: 12032, W: 2352, H: 2698, tot: 10, wt: 100, vol: 2, slices: [{idx:1,xFrom:0,xTo:1200,items:[{sku:"SKU",qty:10,dx:500,dy:400,dz:350,col:"#0F766E"}]}] });
    const postRes = await onRequestPost({
      request: new Request("https://example.com/api/crew-share", { method: "POST", body: validBody }),
      env: { CREW_SHARE_KV: kv },
    });
    expect(postRes.status).toBe(201);
    const { id } = (await postRes.json()) as { id: string };
    expect(id).toMatch(/^[a-z0-9]{8}$/);

    const getRes = await onRequestGet({
      request: new Request(`https://example.com/api/crew-share?id=${id}`),
      env: { CREW_SHARE_KV: kv },
    });
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toBe(validBody);

    // Invalid ID -> 400; Missing ID -> 404
    const badId = await onRequestGet({
      request: new Request("https://example.com/api/crew-share?id=bad!"),
      env: { CREW_SHARE_KV: kv },
    });
    expect(badId.status).toBe(400);

    const missing = await onRequestGet({
      request: new Request("https://example.com/api/crew-share?id=zzzzzzzz"),
      env: { CREW_SHARE_KV: kv },
    });
    expect(missing.status).toBe(404);
  });
});
