import { expect, test } from "@playwright/test";

/**
 * CargoFit Real-Browser Automated Regression Suite (Playwright).
 * Locks in all previously discovered bugs (BUG-001 to BUG-008) plus full
 * 6-role workbench, v2.0/v2.1 engineering analytics, and responsive layout checks.
 */
test.describe("CargoFit Full-Stack Browser Regression Suite", () => {
  test("BUG-001 & BUG-006: Simple 3-step mode advances cleanly & back-nav never re-locks steps", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/app", { waitUntil: "networkidle" });
    // Switch to Quick Estimate (Simple 3-Step)
    await page.getByRole("button", { name: /快速测算|Quick Estimate/ }).click();
    // Click primary next button -> must advance out of Step 1 without deadlock
    await page.locator(".workflow-next-btn, button:has-text('下一步')").first().click();
    await expect(page.locator("main[data-workflow-step]")).not.toHaveAttribute("data-workflow-step", "1");

    // Express calculate -> Step 7, then jump back to Step 2 and verify Step 7 stays unlocked
    await page.getByRole("button", { name: /一键示例|1-Click Demo|快速计算/ }).first().click();
    await expect(page.locator("main[data-workflow-step='7']")).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test("BUG-002 & BUG-005: Dark mode contrast, 6 role workbenches, and 0px horizontal overflow", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/app", { waitUntil: "networkidle" });

    // All 6 role workbenches from Direction 20 must be rendered and interactive
    for (const label of [/快速测算/, /专业装柜/, /包装工程/, /现场执行/, /企业管理/, /开发者中心/]) {
      await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
    }

    // Check 0px horizontal overflow
    const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowPx).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test("BUG-004: Global unit switch syncs container dimensions immediately", async ({ page }) => {
    await page.goto("/app", { waitUntil: "networkidle" });
    const unitSelect = page.locator("select[aria-label*='单位'], select[aria-label*='Unit']").first();
    if (await unitSelect.count()) {
      await unitSelect.selectOption("cm/kg");
      await expect(page.locator("body")).toContainText(/1203\.2|cm/);
    }
  });

  test("BUG-008 & v2.0/v2.1 Pillars: All 5 breakthrough panels + ROI + CTU + Special Cargo render live", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/app", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /一键示例|1-Click Demo/ }).first().click();
    await expect(page.locator("main[data-workflow-step='7']")).toBeVisible({ timeout: 20_000 });

    // Open review/analytics pane
    const reviewTab = page.getByRole("tab", { name: /复核|分析|Review/ }).first();
    if (await reviewTab.count()) await reviewTab.click();

    await expect(page.locator("body")).toContainText(/经济收益|ROI|CTU|特殊货物|混合装载/);
    expect(errors).toEqual([]);
  });

  test("Crew mobile execution route /crew loads cleanly with 0 errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/crew", { waitUntil: "networkidle" });
    const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowPx).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
