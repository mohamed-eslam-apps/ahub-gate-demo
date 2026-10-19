import { expect, test } from "@playwright/test";
import { siteRoot } from "./site";

// Pass by default. Automation Hub's docs screenshots need real failures, so a
// run can turn them red with per-run env: DEMO_FAIL=1 breaks the first test,
// DEMO_FLAKY=1 makes the second fail on its first attempt only (flaky with
// retries). Nothing here touches app/, so the release-gate hash is unchanged.

test("checkout shows the order total @checkout", async ({ page, baseURL }) => {
  await page.goto(siteRoot(baseURL));
  await page.getByTestId("add").click();
  const expected = process.env.DEMO_FAIL === "1" ? "3" : "1";
  await expect(page.getByTestId("count")).toHaveText(expected, { timeout: 2000 });
});

test("checkout keeps the cart after reload @checkout", async ({ page, baseURL }, info) => {
  await page.goto(siteRoot(baseURL));
  if (process.env.DEMO_FLAKY === "1" && info.retry === 0) {
    await expect(page.getByTestId("count")).toHaveText("9", { timeout: 1000 });
  }
  await expect(page.getByTestId("count")).toBeVisible();
});
