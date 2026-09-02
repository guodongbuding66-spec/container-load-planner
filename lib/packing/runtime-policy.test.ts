import { describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_POLICY, runtimePolicyFromSignals } from "./runtime-policy";

describe("runtimePolicyFromSignals", () => {
  it("keeps capable desktop devices on parallel solvers", () => {
    expect(runtimePolicyFromSignals({
      viewportWidth: 1440,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      coarsePointer: false,
    })).toEqual(DEFAULT_RUNTIME_POLICY);
  });

  it("runs the practical solver first on a phone", () => {
    const policy = runtimePolicyFromSignals({
      viewportWidth: 390,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      coarsePointer: true,
    });

    expect(policy.schedule).toBe("practical-first");
    expect(policy.maximumStartDelayMs).toBeGreaterThan(0);
    expect(policy.calculationTimeoutMs).toBeLessThan(DEFAULT_RUNTIME_POLICY.calculationTimeoutMs);
    expect(policy.reducedRendering).toBe(true);
    expect(policy.reason).toBe("small-screen");
  });

  it("protects low-core and low-memory devices even on a wider viewport", () => {
    expect(runtimePolicyFromSignals({ viewportWidth: 1100, hardwareConcurrency: 4 }).schedule).toBe("practical-first");
    expect(runtimePolicyFromSignals({ viewportWidth: 1100, hardwareConcurrency: 8, deviceMemoryGb: 4 }).schedule).toBe("practical-first");
  });

  it("honors browser data saver", () => {
    const policy = runtimePolicyFromSignals({ viewportWidth: 1440, hardwareConcurrency: 12, deviceMemoryGb: 16, saveData: true });
    expect(policy.schedule).toBe("practical-first");
    expect(policy.reason).toBe("data-saver");
  });
});
