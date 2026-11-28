import { describe, expect, it } from "vitest";
import { pack } from "./engine";
import { TRANSPORT_PRESETS } from "./transport-library";
import { buildCrewSlicePayload, isCrewPayload } from "./crew-payload";
import { bearingLoads } from "./bearing";
import type { ContainerSpec, OrientationCode, ProductInput } from "./types";

function makeProduct(
  id: string,
  l: number,
  w: number,
  h: number,
  weight: number,
  quantity: number,
  overrides: Partial<ProductInput> = {},
): ProductInput {
  return {
    id,
    sku: id.toUpperCase(),
    name: `Item ${id.toUpperCase()}`,
    length: l,
    width: w,
    height: h,
    weight,
    quantity,
    color: "#3b82f6",
    rotationPolicy: "upright",
    maxStackLayers: 0,
    stackable: true,
    bottomOnly: false,
    mustLoad: false,
    priority: 10,
    ...overrides,
  };
}

function xyOverlap(a: { x: number; y: number; dx: number; dy: number }, b: { x: number; y: number; dx: number; dy: number }): boolean {
  return (
    a.x < b.x + b.dx - 1e-4 &&
    a.x + a.dx > b.x + 1e-4 &&
    a.y < b.y + b.dy - 1e-4 &&
    a.y + a.dy > b.y + 1e-4
  );
}

describe("All 37 Containers, Trucks, Trailers & Pallets/ULDs (Full Catalog Sweep)", () => {
  const containers = TRANSPORT_PRESETS.filter((p) => p.category === "container");
  const trucks = TRANSPORT_PRESETS.filter((p) => p.category === "truck");
  const pallets = TRANSPORT_PRESETS.filter((p) => p.category === "pallet");

  it("covers all 12 container presets (20GP/40GP/40HQ/45HQ/Reefers/OT/FR/Air LD3) in single & mixed, practical & maximum", () => {
    expect(containers.length).toBeGreaterThanOrEqual(12);

    for (const preset of containers) {
      const boxL = Math.min(500, Math.floor(preset.length / 3));
      const boxW = Math.min(400, Math.floor(preset.width / 3));
      const boxH = Math.min(350, Math.floor(preset.height / 3));
      const p1 = makeProduct("c1", boxL, boxW, boxH, 12, 80);
      const p2 = makeProduct("c2", Math.max(150, Math.floor(boxL * 0.8)), Math.max(150, Math.floor(boxW * 0.8)), Math.max(150, Math.floor(boxH * 0.8)), 8, 60);

      for (const strategy of ["practical", "maximum"] as const) {
        const single = pack({ mode: "single", strategy, container: preset, clearance: 0, products: [p1] });
        expect(single.validation.valid, `${preset.id} single/${strategy}`).toBe(true);
        expect(single.placements.length, `${preset.id} single/${strategy} count`).toBeGreaterThan(0);
        expect(single.metrics.grossWeight).toBeLessThanOrEqual(preset.maxWeight + 1e-3);

        const mixed = pack({ mode: "mixed", strategy, container: preset, clearance: 0, products: [p1, p2] });
        expect(mixed.validation.valid, `${preset.id} mixed/${strategy}`).toBe(true);
        expect(mixed.placements.length, `${preset.id} mixed/${strategy} count`).toBeGreaterThan(0);
        expect(mixed.metrics.grossWeight).toBeLessThanOrEqual(preset.maxWeight + 1e-3);

        for (const b of mixed.placements) {
          expect(b.x).toBeGreaterThanOrEqual(-1e-3);
          expect(b.y).toBeGreaterThanOrEqual(-1e-3);
          expect(b.z).toBeGreaterThanOrEqual(-1e-3);
          expect(b.x + b.dx).toBeLessThanOrEqual(preset.length + 1e-3);
          expect(b.y + b.dy).toBeLessThanOrEqual(preset.width + 1e-3);
          expect(b.z + b.dz).toBeLessThanOrEqual(preset.height + 1e-3);
        }

        const crew = buildCrewSlicePayload(mixed);
        expect(isCrewPayload(crew), `${preset.id} crew payload valid`).toBe(true);
      }
    }
  }, 60_000);

  it("covers all 11 truck & trailer presets (Van, 3m–17.5m, US 53' Dry Van, EU 13.6m Mega) with weight limits & CoG", () => {
    expect(trucks.length).toBeGreaterThanOrEqual(11);

    for (const truck of trucks) {
      const p1 = makeProduct("t1", 600, 400, 400, 18, 90);
      const p2 = makeProduct("t2", 450, 350, 300, 10, 80);

      for (const strategy of ["practical", "maximum"] as const) {
        const single = pack({ mode: "single", strategy, container: truck, clearance: 0, products: [p1] });
        expect(single.validation.valid, `${truck.id} single/${strategy}`).toBe(true);
        expect(single.placements.length, `${truck.id} single/${strategy} count`).toBeGreaterThan(0);
        expect(single.metrics.grossWeight).toBeLessThanOrEqual(truck.maxWeight + 1e-3);

        const mixed = pack({ mode: "mixed", strategy, container: truck, clearance: 0, products: [p1, p2] });
        expect(mixed.validation.valid, `${truck.id} mixed/${strategy}`).toBe(true);
        expect(mixed.placements.length, `${truck.id} mixed/${strategy} count`).toBeGreaterThan(0);
        expect(mixed.metrics.grossWeight).toBeLessThanOrEqual(truck.maxWeight + 1e-3);

        // Center of Gravity must be finite and inside vehicle envelope
        expect(Number.isFinite(mixed.metrics.centerOfGravity.x)).toBe(true);
        expect(mixed.metrics.centerOfGravity.x).toBeGreaterThanOrEqual(0);
        expect(mixed.metrics.centerOfGravity.x).toBeLessThanOrEqual(truck.length + 1e-3);

        // Crew payload must validate even for 17.5m flatbed & 16m US 53' Dry Van
        const crew = buildCrewSlicePayload(mixed);
        expect(isCrewPayload(crew), `${truck.id} crew payload valid`).toBe(true);
      }
    }
  }, 30_000);

  it("covers all 14 standard pallet & air cargo ULD pallet presets", () => {
    expect(pallets.length).toBeGreaterThanOrEqual(14);

    for (const pallet of pallets) {
      const p1 = makeProduct("pl1", 300, 200, 200, 5, 40);
      const p2 = makeProduct("pl2", 250, 200, 200, 4, 30);

      const res = pack({ mode: "mixed", strategy: "maximum", container: pallet, clearance: 0, products: [p1, p2] });
      expect(res.validation.valid, `${pallet.id} mixed/maximum`).toBe(true);
      expect(res.placements.length, `${pallet.id} count`).toBeGreaterThan(0);
      expect(res.metrics.grossWeight).toBeLessThanOrEqual(pallet.maxWeight + 1e-3);
    }
  });

  it("enforces strict payload weight cap on light trucks (1,000 kg Van & 1,500 kg 3m Truck)", () => {
    const van = trucks.find((t) => t.id === "truck-van")!;
    const heavyItem = makeProduct("steel", 400, 300, 300, 120, 50); // 50 * 120 = 6000 kg >> 1000 kg limit
    const res = pack({ mode: "single", strategy: "maximum", container: van, clearance: 0, products: [heavyItem] });
    expect(res.validation.valid).toBe(true);
    expect(res.placements.length).toBe(8); // floor(1000 / 120) = 8
    expect(res.metrics.grossWeight).toBeLessThanOrEqual(1000);
  });
});

describe("Special Placement & Loading Constraint Verification", () => {
  const truck42: ContainerSpec = TRANSPORT_PRESETS.find((t) => t.id === "truck-4.2")!;
  const c20gp: ContainerSpec = TRANSPORT_PRESETS.find((c) => c.id === "20gp")!;
  const c40ot: ContainerSpec = TRANSPORT_PRESETS.find((c) => c.id === "40ot")!;

  it("Rule 1–4: enforces rotationPolicy (fixed / upright / any) and explicit allowedOrientations whitelist", () => {
    // 1. fixed: only LWH
    const fixedProd = makeProduct("fix", 500, 300, 250, 8, 40, { rotationPolicy: "fixed" });
    const fixRes = pack({ mode: "single", strategy: "maximum", container: truck42, clearance: 0, products: [fixedProd] });
    expect(fixRes.validation.valid).toBe(true);
    expect(fixRes.placements.length).toBeGreaterThan(0);
    expect(fixRes.placements.every((b) => b.orientation === "LWH" && b.dx === 500 && b.dy === 300 && b.dz === 250)).toBe(true);

    // 2. upright: only LWH or WLH (dz === height)
    const upProd = makeProduct("up", 500, 300, 250, 8, 40, { rotationPolicy: "upright" });
    const upRes = pack({ mode: "single", strategy: "maximum", container: truck42, clearance: 0, products: [upProd] });
    expect(upRes.validation.valid).toBe(true);
    expect(upRes.placements.every((b) => (b.orientation === "LWH" || b.orientation === "WLH") && b.dz === 250)).toBe(true);

    // 3. any (6-way): tall cargo (height 2600 > 20gp height 2395) lays flat cleanly when rotationPolicy is 'any'
    const tallProd = makeProduct("tall", 400, 300, 2600, 20, 10, { rotationPolicy: "any" });
    const tallRes = pack({ mode: "single", strategy: "maximum", container: c20gp, clearance: 0, products: [tallProd] });
    expect(tallRes.validation.valid).toBe(true);
    expect(tallRes.placements.length).toBeGreaterThan(0);
    expect(tallRes.placements.every((b) => b.dz <= 400)).toBe(true);

    // 4. explicit allowedOrientations whitelist: force WLH only
    const whitelist: OrientationCode[] = ["WLH"];
    const wlProd = makeProduct("wl", 600, 300, 250, 8, 30, { rotationPolicy: "any", allowedOrientations: whitelist });
    const wlRes = pack({ mode: "single", strategy: "maximum", container: truck42, clearance: 0, products: [wlProd] });
    expect(wlRes.validation.valid).toBe(true);
    expect(wlRes.placements.length).toBeGreaterThan(0);
    expect(wlRes.placements.every((b) => b.orientation === "WLH" && b.dx === 300 && b.dy === 600 && b.dz === 250)).toBe(true);
  });

  it("Rule 5–7: enforces bottomOnly, stackable=false, and maxStackLayers across mixed truck loads", () => {
    const bottomProd = makeProduct("bot", 600, 400, 300, 20, 15, { bottomOnly: true, mustLoad: true, priority: 90 });
    const noStackProd = makeProduct("nostack", 500, 400, 300, 10, 12, { stackable: false, priority: 70 });
    const twoLayerProd = makeProduct("two-tier", 500, 400, 300, 8, 30, { maxStackLayers: 2, priority: 50 });
    const fillerProd = makeProduct("filler", 400, 300, 250, 5, 40, { priority: 20 });

    for (const strategy of ["practical", "maximum"] as const) {
      const res = pack({
        mode: "mixed",
        strategy,
        container: truck42,
        clearance: 0,
        products: [bottomProd, noStackProd, twoLayerProd, fillerProd],
      });
      expect(res.validation.valid, `mixed/${strategy}`).toBe(true);

      // bottomOnly: all z === 0
      const bots = res.placements.filter((b) => b.productId === "bot");
      expect(bots.length).toBe(15);
      expect(bots.every((b) => Math.abs(b.z) < 1e-4)).toBe(true);

      // stackable=false: no box placed above any nostack box
      const noStacks = res.placements.filter((b) => b.productId === "nostack");
      expect(noStacks.length).toBeGreaterThan(0);
      for (const ns of noStacks) {
        const above = res.placements.filter(
          (other) => other.id !== ns.id && other.z >= ns.z + ns.dz - 1e-4 && xyOverlap(other, ns),
        );
        expect(above.length).toBe(0);
      }

      // maxStackLayers=2: every two-tier box has layer <= 2
      const twoTiers = res.placements.filter((b) => b.productId === "two-tier");
      expect(twoTiers.length).toBeGreaterThan(0);
      expect(twoTiers.every((b) => b.layer <= 2)).toBe(true);
    }
  });

  it("Rule 8–9: enforces maxTopLoadKg, topLoadByVerticalAxis, and allowedAboveSkus whitelist", () => {
    const baseProd = makeProduct("base-wl", 600, 400, 400, 15, 16, {
      priority: 100,
      mustLoad: true,
      maxTopLoadKg: 10,
      allowedAboveSkus: ["LIGHT-OK"],
    });
    const allowedTop = makeProduct("light-ok", 600, 400, 300, 4, 24, { priority: 60 });
    const forbiddenTop = makeProduct("heavy-ban", 600, 400, 300, 9, 20, { priority: 80 });

    const res = pack({
      mode: "mixed",
      strategy: "maximum",
      container: truck42,
      clearance: 0,
      products: [baseProd, allowedTop, forbiddenTop],
    });
    expect(res.validation.valid).toBe(true);

    const loads = bearingLoads(res.placements, [baseProd, allowedTop, forbiddenTop]);
    for (const b of res.placements.filter((x) => x.productId === "base-wl")) {
      // Top load <= 10 kg
      expect(loads.get(b.id) ?? 0).toBeLessThanOrEqual(10 + 1e-4);
      // Direct upper boxes must ONLY be LIGHT-OK
      const directAbove = res.placements.filter(
        (other) => other.id !== b.id && Math.abs(other.z - (b.z + b.dz)) < 1e-3 && xyOverlap(other, b),
      );
      for (const u of directAbove) {
        expect(u.sku).toBe("LIGHT-OK");
      }
    }

    // Axis-specific bearing: height-upright supports 0 kg, length-upright supports 50 kg
    const axisProd = makeProduct("axis-box", 500, 400, 300, 10, 20, {
      rotationPolicy: "upright",
      topLoadByVerticalAxis: { height: 0 },
    });
    const axisRes = pack({ mode: "single", strategy: "maximum", container: truck42, clearance: 0, products: [axisProd] });
    expect(axisRes.validation.valid).toBe(true);
    expect(axisRes.placements.every((b) => Math.abs(b.z) < 1e-4)).toBe(true);
  });

  it("Rule 10–11: enforces mustLoad priority and indivisible multi-carton sets (setCode / unitsPerSet)", () => {
    const smallContainer: ContainerSpec = {
      id: "tight-box",
      name: "Tight Box",
      length: 1200,
      width: 800,
      height: 800,
      doorWidth: 800,
      doorHeight: 800,
      maxWeight: 5000,
    };
    const kitA = makeProduct("kit-a", 400, 400, 400, 10, 4, { setCode: "SET-X", unitsPerSet: 1, mustLoad: true, priority: 100 });
    const kitB = makeProduct("kit-b", 400, 400, 400, 8, 8, { setCode: "SET-X", unitsPerSet: 2, mustLoad: true, priority: 90 });
    const optionalC = makeProduct("opt-c", 400, 400, 400, 5, 20, { priority: 10 });

    const res = pack({
      mode: "mixed",
      strategy: "maximum",
      container: smallContainer,
      clearance: 0,
      products: [kitA, kitB, optionalC],
    });
    expect(res.validation.valid).toBe(true);
    const loadedA = res.placements.filter((b) => b.productId === "kit-a").length;
    const loadedB = res.placements.filter((b) => b.productId === "kit-b").length;
    // Exact 1:2 kit ratio preserved, never split
    expect(loadedA).toBeGreaterThan(0);
    expect(loadedB).toBe(loadedA * 2);
  });

  it("Rule 12: enforces protectionGap (50 mm horizontal buffer) without violating clearance", () => {
    const gapProd = makeProduct("glass", 500, 400, 400, 15, 20, { protectionGap: 50 });
    const res = pack({ mode: "single", strategy: "maximum", container: truck42, clearance: 0, products: [gapProd] });
    expect(res.validation.valid).toBe(true);
    expect(res.placements.length).toBeGreaterThan(0);

    // Check every same-layer pair has >= 50 mm X or Y separation
    for (let i = 0; i < res.placements.length; i += 1) {
      for (let j = i + 1; j < res.placements.length; j += 1) {
        const a = res.placements[i];
        const b = res.placements[j];
        const zOverlap = a.z < b.z + b.dz - 1e-3 && a.z + a.dz > b.z + 1e-3;
        if (!zOverlap) continue;
        const xGap = Math.max(b.x - (a.x + a.dx), a.x - (b.x + b.dx));
        const yGap = Math.max(b.y - (a.y + a.dy), a.y - (b.y + b.dy));
        expect(Math.max(xGap, yGap)).toBeGreaterThanOrEqual(50 - 1e-3);
      }
    }
  });

  it("Rule 13: enforces rearDoorClearanceMm, doorHeight restriction, OOG 40OT open-top height, and truck wheelhouse exclusions", () => {
    // 1. rearDoorClearanceMm = 300 mm
    const withRearClearance: ContainerSpec = { ...c20gp, rearDoorClearanceMm: 300 };
    const box = makeProduct("rc", 600, 400, 400, 10, 120);
    const rcRes = pack({ mode: "single", strategy: "maximum", container: withRearClearance, clearance: 0, products: [box] });
    expect(rcRes.validation.valid).toBe(true);
    expect(rcRes.placements.every((b) => b.x + b.dx <= c20gp.length - 300 + 1e-3)).toBe(true);

    // 2. Door height vs inner height: 2350mm tall upright-only cargo cannot pass 20gp 2292mm door, but fits 40OT 4000mm open-top
    const tallUpright = makeProduct("machinery", 1000, 800, 2350, 200, 4, { rotationPolicy: "upright", stackable: false });
    const blocked20gp = pack({ mode: "single", strategy: "maximum", container: c20gp, clearance: 0, products: [tallUpright] });
    expect(blocked20gp.placements.length).toBe(0);

    const allowed40ot = pack({ mode: "mixed", strategy: "maximum", container: c40ot, clearance: 0, products: [tallUpright] });
    expect(allowed40ot.validation.valid).toBe(true);
    expect(allowed40ot.placements.length).toBe(4);
    const cap40ot = pack({ mode: "single", strategy: "maximum", container: c40ot, clearance: 0, products: [tallUpright] });
    expect(cap40ot.validation.valid).toBe(true);
    expect(cap40ot.placements.length).toBeGreaterThanOrEqual(4);

    // 3. Truck wheelhouse exclusion zones inside 4.2m truck
    const truckWithWheelhouses: ContainerSpec = {
      ...truck42,
      exclusions: [
        { id: "wh-left", name: "Left Wheelhouse", kind: "obstacle", x: 1800, y: 0, z: 0, dx: 900, dy: 350, dz: 350 },
        { id: "wh-right", name: "Right Wheelhouse", kind: "obstacle", x: 1800, y: 1950, z: 0, dx: 900, dy: 350, dz: 350 },
      ],
    };
    const whRes = pack({
      mode: "mixed",
      strategy: "maximum",
      container: truckWithWheelhouses,
      clearance: 0,
      products: [makeProduct("c-a", 500, 400, 350, 10, 60), makeProduct("c-b", 400, 300, 300, 6, 60)],
    });
    expect(whRes.validation.valid).toBe(true);
    expect(whRes.placements.length).toBeGreaterThan(20);
    for (const ex of truckWithWheelhouses.exclusions!) {
      for (const b of whRes.placements) {
        const overlaps3d =
          b.x < ex.x + ex.dx - 1e-3 &&
          b.x + b.dx > ex.x + 1e-3 &&
          b.y < ex.y + ex.dy - 1e-3 &&
          b.y + b.dy > ex.y + 1e-3 &&
          b.z < ex.z + ex.dz - 1e-3 &&
          b.z + b.dz > ex.z + 1e-3;
        expect(overlaps3d).toBe(false);
      }
    }
  });

  it("Rule 14: honors explicit loadingRules (deep-first vs layers, large-first vs small-first) and nesting + bearing", () => {
    const big = makeProduct("big", 600, 400, 400, 12, 20);
    const small = makeProduct("small", 300, 200, 200, 3, 40);

    const deepRes = pack({
      mode: "mixed",
      strategy: "practical",
      container: truck42,
      clearance: 0,
      products: [big, small],
      loadingRules: { layout: "deep-first", search: "smart", cargoOrder: "large-first" },
    });
    expect(deepRes.validation.valid).toBe(true);
    expect(deepRes.placements.length).toBeGreaterThan(0);

    const layerSmallRes = pack({
      mode: "mixed",
      strategy: "maximum",
      container: truck42,
      clearance: 0,
      products: [big, small],
      loadingRules: { layout: "layers", search: "smart", cargoOrder: "small-first" },
    });
    expect(layerSmallRes.validation.valid).toBe(true);
    expect(layerSmallRes.placements.length).toBeGreaterThan(0);

    // Nesting buckets with bearing limit on a 6.8m truck
    const truck68 = TRANSPORT_PRESETS.find((t) => t.id === "truck-6.8")!;
    const bucket = makeProduct("bucket", 400, 400, 350, 2, 120, {
      nestingDeltaHeightMm: 80,
      maxTopLoadKg: 10, // max 5 nested above -> 6 per column
    });
    const nestRes = pack({ mode: "single", strategy: "maximum", container: truck68, clearance: 0, products: [bucket] });
    expect(nestRes.validation.valid).toBe(true);
    expect(nestRes.placements.some((b) => (b.nestedDepth ?? 0) > 0)).toBe(true);
    expect(nestRes.placements.every((b) => (b.nestedDepth ?? 0) <= 5)).toBe(true);
  });
});
