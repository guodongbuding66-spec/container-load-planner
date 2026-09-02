export type SolverSchedule = "parallel" | "practical-first";

export type RuntimeSignals = {
  viewportWidth: number;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  saveData?: boolean;
  coarsePointer?: boolean;
};

export type RuntimePolicy = {
  schedule: SolverSchedule;
  calculationTimeoutMs: number;
  maximumStartDelayMs: number;
  reducedRendering: boolean;
  reason: "desktop" | "small-screen" | "limited-cpu" | "limited-memory" | "data-saver" | "touch-device";
};

export const DEFAULT_RUNTIME_POLICY: RuntimePolicy = {
  schedule: "parallel",
  calculationTimeoutMs: 60_000,
  maximumStartDelayMs: 0,
  reducedRendering: false,
  reason: "desktop",
};

export function runtimePolicyFromSignals(signals: RuntimeSignals): RuntimePolicy {
  const smallScreen = signals.viewportWidth > 0 && signals.viewportWidth <= 680;
  const limitedCpu = Boolean(signals.hardwareConcurrency && signals.hardwareConcurrency <= 4);
  const limitedMemory = Boolean(signals.deviceMemoryGb && signals.deviceMemoryGb <= 4);
  const touchDevice = Boolean(signals.coarsePointer && signals.viewportWidth > 0 && signals.viewportWidth <= 980);
  const constrained = smallScreen || limitedCpu || limitedMemory || Boolean(signals.saveData) || touchDevice;

  if (!constrained) return DEFAULT_RUNTIME_POLICY;

  const reason: RuntimePolicy["reason"] = signals.saveData
    ? "data-saver"
    : smallScreen
      ? "small-screen"
      : limitedCpu
        ? "limited-cpu"
        : limitedMemory
          ? "limited-memory"
          : "touch-device";

  return {
    schedule: "practical-first",
    calculationTimeoutMs: 35_000,
    maximumStartDelayMs: 900,
    reducedRendering: true,
    reason,
  };
}

export function detectRuntimePolicy(): RuntimePolicy {
  if (typeof window === "undefined" || typeof navigator === "undefined") return DEFAULT_RUNTIME_POLICY;
  const browserNavigator = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return runtimePolicyFromSignals({
    viewportWidth: window.innerWidth,
    hardwareConcurrency: browserNavigator.hardwareConcurrency,
    deviceMemoryGb: browserNavigator.deviceMemory,
    saveData: browserNavigator.connection?.saveData,
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
}
