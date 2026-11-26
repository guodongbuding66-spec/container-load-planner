import { describe, expect, it } from "vitest";
import { buildZipArchive } from "./mini-zip";
import { rebalanceProductsForCoG } from "./vgm-cog";
import { SAMPLE_PRODUCTS } from "./presets";

describe("v1.3 ZIP photo bundler & Auto-Rebalance CoG", () => {
  it("builds a valid PKZIP archive header and EOCD signature", () => {
    const zip = buildZipArchive([
      { name: "01-empty.txt", data: new TextEncoder().encode("empty-container-ok") },
      { name: "receipt.txt", data: new TextEncoder().encode("219 cartons loaded") },
    ]);
    // PK\x03\x04 local header signature
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    // EOCD signature PK\x05\x06 at tail - 22
    expect(zip[zip.length - 22]).toBe(0x50);
    expect(zip[zip.length - 21]).toBe(0x4b);
    expect(zip[zip.length - 20]).toBe(0x05);
    expect(zip[zip.length - 19]).toBe(0x06);
  });

  it("reorders product priorities to interleave heavy and light SKUs for balanced CoG", () => {
    const heavy = { ...SAMPLE_PRODUCTS[0], id: "h", sku: "HEAVY", weight: 50, quantity: 20 };
    const mid = { ...SAMPLE_PRODUCTS[1], id: "m", sku: "MID", weight: 20, quantity: 20 };
    const light = { ...SAMPLE_PRODUCTS[2], id: "l", sku: "LIGHT", weight: 5, quantity: 20 };
    const rebalanced = rebalanceProductsForCoG([heavy, mid, light], "front-heavy");
    expect(rebalanced.length).toBe(3);
    // When front-heavy, lighter SKU gets higher priority (loaded deeper at front) so heavy shifts toward center/rear
    expect(rebalanced[0].sku).toBe("LIGHT");
  });
});
