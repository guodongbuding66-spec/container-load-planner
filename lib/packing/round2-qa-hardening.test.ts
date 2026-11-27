import { describe, expect, it } from "vitest";
import { allocateFleet, optimizeFleetTail, type FleetOption } from "./fleet";
import { pack, restorePackingSnapshot } from "./engine";
import { parseProductsCsv, toCsvCell } from "./csv";
import { assetPayload } from "../cloud/validation";
import type { ContainerSpec, PackingRequest, ProductInput } from "./types";

function makeBox(id: string, sku: string, l: number, w: number, h: number, weight: number, quantity: number, rotationPolicy: ProductInput["rotationPolicy"] = "fixed"): ProductInput {
  return {
    id,
    sku,
    name: sku,
    length: l,
    width: w,
    height: h,
    weight,
    quantity,
    color: "#236f7a",
    allowRotate: rotationPolicy !== "fixed",
    rotationPolicy,
    stackable: true,
    maxStackLayers: 10,
    priority: 1,
  };
}

function makeContainer(id: string, name: string, l: number, w: number, h: number, maxWeight = 28000): ContainerSpec {
  return {
    id,
    name,
    category: "container",
    length: l,
    width: w,
    height: h,
    doorWidth: w,
    doorHeight: h,
    maxWeight,
  };
}

describe("Round 2 QA Hardening (FLEET-001, ARCH-001/002, CSV-001/002, SEC-REVIEW-001, CLOUD-001)", () => {
  it("FLEET-001: allocateFleet and optimizeFleetTail choose 2 cheap small containers (cost 20) over 1 expensive big container (cost 100)", () => {
    const big = makeContainer("big-1", "Big 2000", 2000, 500, 500);
    const small = makeContainer("small-1", "Small 1000", 1000, 500, 500);
    const request: PackingRequest = {
      container: big,
      clearance: 0,
      mode: "mixed",
      strategy: "maximum",
      workflow: "direct",
      products: [makeBox("p1", "CUBE-500", 500, 500, 500, 10, 4, "fixed")],
    };
    const options: FleetOption[] = [
      { container: big, cost: 100, available: 1 },
      { container: small, cost: 10, available: 2 },
    ];

    const allocated = allocateFleet(request, options, 2, "cost");
    expect(allocated.complete).toBe(true);
    expect(allocated.loads).toHaveLength(2);
    expect(allocated.totalCost).toBe(20);
    expect(allocated.costs?.total).toBe(20);
    expect(allocated.loads.reduce((n, l) => n + l.plan.metrics.loadedCount, 0)).toBe(4);

    // Also verify optimizeFleetTail can split an existing 1-big-container baseline (cost 100) into 2 small containers (cost 20)
    const bigOnly = allocateFleet(request, [{ container: big, cost: 100, available: 1 }], 2, "cost");
    expect(bigOnly.totalCost).toBe(100);
    const optimized = optimizeFleetTail(request, bigOnly, options, "cost");
    expect(optimized.complete).toBe(true);
    expect(optimized.loads).toHaveLength(2);
    expect(optimized.totalCost).toBe(20);
  });

  it("ARCH-001: restorePackingSnapshot rejects forged workflow mismatched with pallet/direct structure", () => {
    const container = makeContainer("c-2000", "Box 2000", 2000, 1000, 1000);
    const request: PackingRequest = {
      container,
      clearance: 0,
      mode: "mixed",
      strategy: "maximum",
      workflow: "direct",
      products: [makeBox("p1", "SKU-1", 500, 500, 500, 10, 4, "fixed")],
    };
    const plan = pack(request);
    expect(plan.metrics.loadedCount).toBe(4);
    expect(plan.pallets?.length ?? 0).toBe(0);

    expect(() => restorePackingSnapshot(request, { ...plan, workflow: "pallet-only" })).toThrow();
    expect(() => restorePackingSnapshot(request, { ...plan, workflow: "palletized" })).toThrow();
    // Legitimate direct restore still succeeds
    const restored = restorePackingSnapshot(request, { ...plan, workflow: "direct" });
    expect(restored.validation.valid).toBe(true);
    expect(restored.workflow).toBe("direct");
  });

  it("ARCH-002: restorePackingSnapshot rejects tampered fixed orientation label (WLH) even when dx/dy/dz are unchanged", () => {
    const container = makeContainer("c-1000", "Box 1000", 1000, 1000, 1000);
    const request: PackingRequest = {
      container,
      clearance: 0,
      mode: "mixed",
      strategy: "maximum",
      workflow: "direct",
      products: [makeBox("p1", "FIXED-BOX", 500, 250, 125, 10, 1, "fixed")],
    };
    const plan = pack(request);
    expect(plan.metrics.loadedCount).toBe(1);
    const tampered = {
      ...plan,
      placements: plan.placements.map((b) => ({ ...b, orientation: "WLH" })),
    };
    expect(() => restorePackingSnapshot(request, tampered)).toThrow();
  });

  it("CSV-001 & CSV-002: rejects malformed unquoted quotes and extra non-empty columns atomically", () => {
    const malformedQuote = 'sku,name,length,width,height,weight,quantity\r\nA,AB"CD"EF,500,500,500,10,4';
    expect(() => parseProductsCsv(malformedQuote, ["#236f7a"])).toThrow(/引号/);

    const validEscapedQuote = 'sku,name,length,width,height,weight,quantity\r\nA,"AB""CD""EF",500,500,500,10,4';
    const parsedValid = parseProductsCsv(validEscapedQuote, ["#236f7a"]);
    expect(parsedValid[0]?.name).toBe('AB"CD"EF');

    const extraColumn = "sku,name,length,width,height,weight,quantity\r\nA,Box,500,500,500,10,4,UNEXPECTED";
    expect(() => parseProductsCsv(extraColumn, ["#236f7a"])).toThrow(/超过表头/);
  });

  it("SEC-REVIEW-001: toCsvCell neutralizes formula prefixes preceded by CR, LF, tab, or spaces", () => {
    expect(toCsvCell("=1+1")).toBe("'=1+1");
    expect(toCsvCell("\t=1+1")).toBe("'\t=1+1");
    expect(toCsvCell("\r=1+1")).toBe("\"'\\r=1+1\"".replace("\\r", "\r"));
    expect(toCsvCell("\n=1+1")).toBe("\"'\\n=1+1\"".replace("\\n", "\n"));
    expect(toCsvCell("\r\n+SUM(A1:A2)")).toBe("\"'\\r\\n+SUM(A1:A2)\"".replace("\\r\\n", "\r\n"));
  });

  it("CLOUD-001: assetPayload rejects magic-only / truncated PNG, JPEG, and WebP photos while accepting valid PNG", () => {
    const badPng = Buffer.from("89504e470d0a1a0a00", "hex").toString("base64");
    expect(() => assetPayload({ kind: "photo", mime: "image/png", name: "bad.png", payload: badPng })).toThrow();

    const badJpeg = Buffer.from("ffd8ffe00010", "hex").toString("base64");
    expect(() => assetPayload({ kind: "photo", mime: "image/jpeg", name: "bad.jpg", payload: badJpeg })).toThrow();

    const badWebp = Buffer.from("524946460c0000005745425056503820", "hex").toString("base64");
    expect(() => assetPayload({ kind: "photo", mime: "image/webp", name: "bad.webp", payload: badWebp })).toThrow();

    const valid1x1Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl73WQAAAAASUVORK5CYII=";
    const accepted = assetPayload({ kind: "photo", mime: "image/png", name: "ok.png", payload: valid1x1Png });
    expect(accepted.bytes.length).toBe(68);
  });
});
