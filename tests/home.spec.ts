import { expect, test } from "@playwright/test";

test("home page shows the store title @smoke", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle("Gate Demo Store");
  await expect(page.getByTestId("title")).toHaveText("Gate Demo Store");
});

test("footer shows the deployed version @smoke", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("version")).toHaveText(/^[0-9a-f]{7}$/);
});
