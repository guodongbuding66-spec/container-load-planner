import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Geometry and 20,000-placement tests share a CPU budget in CI.
    // Bound concurrency so renderer checks do not time out under contention.
    maxWorkers: 2,
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx"],
  },
});
