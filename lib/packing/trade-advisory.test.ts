import { describe, expect, it } from "vitest";
import { pack } from "./engine";
import {
  auditHazmatSegregation,
  buildClientSummaryEmail,
  compareFclVsLcl,
  inspectIppmCompliance,
} from "./trade-advisory";
import type { ContainerSpec, ProductInput } from "./types";

const hq40: ContainerSpec = {
  id: "40hq",
  name: "40HQ",
  length: 12032,
  width: 2350,
  height: 2700,
  doorWidth: 2340,
  doorHeight: 2597,
  maxWeight: 28600,
};

describe("trade-advisory", () => {
  it("recommends 20GP FCL over LCL when volume exceeds break-even point", () => {
    const res = compareFclVsLcl(20, 6000, {
      lclRatePerWm: 90,
      lclFixedFees: 450,
      fcl20gpAllIn: 1850,
      fcl40gpAllIn: 2600,
      fcl40hqAllIn: 2750,
    });
    expect(res.recommended).toBe("20GP");
    expect(res.savingsVsLcl).toBe(400);
    expect(res.breakEvenCbm20gp).toBeCloseTo(15.6, 1);
  });

  it("recommends LCL for small 5 CBM shipments", () => {
    const res = compareFclVsLcl(5, 1200, {
      lclRatePerWm: 80,
      lclFixedFees: 400,
      fcl20gpAllIn: 1900,
      fcl40gpAllIn: 2600,
      fcl40hqAllIn: 2750,
    });
    expect(res.recommended).toBe("LCL");
  });

  it("flags incompatible IMDG Class 3 + Class 5 and requires UN38.3 for Class 9 lithium", () => {
    const conflict = auditHazmatSegregation(["class3_flammable", "class5_oxidizer"]);
    expect(conflict.safe).toBe(false);
    expect(conflict.conflicts[0].severity).toBe("incompatible");

    const battery = auditHazmatSegregation(["class9_lithium"]);
    expect(battery.safe).toBe(true);
    expect(battery.requiredDocsEn.some((d) => d.includes("UN38.3"))).toBe(true);
  });

  it("checks IPPC ISPM-15 compliance and builds bilingual client summary email", () => {
    const prod: ProductInput = {
      id: "p1",
      sku: "CHAIR-01",
      name: "Chair",
      length: 600,
      width: 400,
      height: 400,
      weight: 12,
      quantity: 20,
      priority: 50,
      rotationPolicy: "upright",
      stackable: true,
      maxStackLayers: 0,
      color: "#0F766E",
    };
    const plan = pack({ mode: "mixed", strategy: "practical", container: hq40, clearance: 10, products: [prod] });
    const ippc = inspectIppmCompliance(plan, ["Los Angeles, USA"]);
    expect(ippc.strictDestination).toBe(true);

    const enMail = buildClientSummaryEmail(plan, [prod], { lang: "en", containerFreight: 2800 });
    expect(enMail).toContain("Subject: Container Loading Plan Summary");
    expect(enMail).toContain("20 cartons");
  });
});
