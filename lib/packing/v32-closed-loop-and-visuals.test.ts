import { describe, expect, it } from "vitest";
import { designEconomicalPallet } from "./smart-pallet-designer";
import { askCargoFitCopilot, classifyCopilotIntent, COPILOT_SUGGESTIONS } from "./copilot-assistant";
import { auditOrderInputs, autoFixOrderInputs } from "./order-data-auditor";
import { API_SCHEMA_VERSION, executeCargoFitApiV1, LEGACY_API_SCHEMA_VERSIONS } from "./api-contract";
import { ENGINE_VERSION, pack } from "./engine";
import { CONTAINER_PRESETS } from "./presets";
import type { ProductInput } from "./types";

const SAMPLE_PRODUCTS: ProductInput[] = [
  {
    id: "p1",
    sku: "KIT-A",
    name: "Main Panel",
    length: 580,
    width: 390,
    height: 360,
    weight: 16.5,
    quantity: 120,
    color: "#2563eb",
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 6,
    priority: 1,
  },
  {
    id: "p2",
    sku: "KIT-B",
    name: "Frame Box",
    length: 400,
    width: 300,
    height: 280,
    weight: 11.2,
    quantity: 80,
    color: "#10b981",
    rotationPolicy: "upright",
    stackable: true,
    maxStackLayers: 6,
    priority: 1,
  },
];

describe("CargoFit v3.2.0 Closed-Loop & Visual Authenticity Suite", () => {
  it("bumps version to 3.2.0 and preserves backward-compatible API schemas", () => {
    expect(ENGINE_VERSION).toBe("3.2.3");
    expect(API_SCHEMA_VERSION).toBe("cargo-fit-api-v3.2");
    expect(LEGACY_API_SCHEMA_VERSIONS).toContain("cargo-fit-api-v3.1");
    expect(LEGACY_API_SCHEMA_VERSIONS).toContain("cargo-fit-api-v1.8");

    const resp = executeCargoFitApiV1({
      schema: "cargo-fit-api-v3.1",
      requestId: "compat-check",
      computeMode: "fast",
      request: {
        mode: "mixed",
        workflow: "direct",
        strategy: "maximum",
        container: CONTAINER_PRESETS[2],
        products: SAMPLE_PRODUCTS,
        clearance: 10,
      },
    });
    expect(resp.ok).toBe(true);
    expect(resp.engineVersion).toBe("3.2.3");
  });

  it("generates authentic zero-overlap in-bounds 2D pallet layerLayout coordinates", () => {
    const report = designEconomicalPallet(SAMPLE_PRODUCTS[0], 2200, 0);
    expect(report.options.length).toBeGreaterThanOrEqual(4);
    for (const opt of report.options) {
      expect(opt.layerLayout.length).toBe(opt.cartonsPerLayer);
      for (let i = 0; i < opt.layerLayout.length; i++) {
        const a = opt.layerLayout[i];
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.dx).toBeLessThanOrEqual(opt.pallet.lengthMm + 0.5);
        expect(a.y + a.dy).toBeLessThanOrEqual(opt.pallet.widthMm + 0.5);
        for (let j = i + 1; j < opt.layerLayout.length; j++) {
          const b = opt.layerLayout[j];
          const overlapX = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
          expect(overlapX > 0.1 && overlapY > 0.1).toBe(false);
        }
      }
    }
  });

  it("supports deterministic reduce-pallets Copilot intent matching Reference Diagram #14", () => {
    expect(COPILOT_SUGGESTIONS.some((s) => s.intent === "reduce-pallets")).toBe(true);
    expect(classifyCopilotIntent("保持原订单数量，尽可能减少托盘。")).toBe("reduce-pallets");
    const plan = pack({
      mode: "mixed",
      workflow: "direct",
      strategy: "maximum",
      container: CONTAINER_PRESETS[2],
      products: SAMPLE_PRODUCTS,
      clearance: 10,
    });
    const ans = askCargoFitCopilot("保持原订单数量，尽可能减少托盘。", plan, SAMPLE_PRODUCTS);
    expect(ans.intent).toBe("reduce-pallets");
    expect(ans.metrics.some((m) => m.labelEn === "Optimal Pallets")).toBe(true);
    expect(ans.metrics.some((m) => m.value === "200")).toBe(true);
  });

  it("auto-fixes suspected cm unit mix-up and reversed L/W safely with explicit changelog", () => {
    const buggy: ProductInput[] = [
      { ...SAMPLE_PRODUCTS[0], length: 600, width: 400, height: 350 },
      { ...SAMPLE_PRODUCTS[1], length: 30, width: 45, height: 25 },
    ];
    const auditBefore = auditOrderInputs(buggy, CONTAINER_PRESETS[2], 10);
    expect(auditBefore.healthy).toBe(false);

    const fix = autoFixOrderInputs(buggy, [buggy[1].id]);
    expect(fix.fixCount).toBe(2);
    expect(fix.fixedProducts[1].length).toBe(450);
    expect(fix.fixedProducts[1].width).toBe(300);
    expect(fix.fixedProducts[1].height).toBe(250);
  });
});
