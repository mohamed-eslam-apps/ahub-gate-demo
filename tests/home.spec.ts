import { expect, test } from "@playwright/test";
import { siteRoot } from "./site";

test("home page shows the store title @smoke", async ({ page, baseURL }) => {
  await page.goto(siteRoot(baseURL));
  await expect(page).toHaveTitle("Gate Demo Store");
  await expect(page.getByTestId("title")).toHaveText("Gate Demo Store");
});

test("footer shows the deployed version @smoke", async ({ page, baseURL }) => {
  await page.goto(siteRoot(baseURL));
  await expect(page.getByTestId("version")).toHaveText(/^[0-9a-f]{7}$/);
});
