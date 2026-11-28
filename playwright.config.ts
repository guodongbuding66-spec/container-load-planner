import { defineConfig, devices } from "@playwright/test";

/**
 * CargoFit Real-Browser Playwright E2E & Regression Configuration.
 * Covers desktop (1440x900, 1280x720), mobile (390x844), dark mode,
 * language switch, role workbenches, 3D scene fallback/interaction, and bug regressions.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "docs/qa/playwright-report", open: "never" }],
  ],
  use: {
    baseURL: process.env.CARGOFIT_E2E_URL || "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "firefox-desktop-1440",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "firefox-desktop-720p",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 720 } },
    },
    {
      name: "firefox-mobile-390",
      use: { ...devices["Desktop Firefox"], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
});
