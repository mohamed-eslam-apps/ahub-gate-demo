import { expect, test } from "@playwright/test";
import { siteRoot } from "./site";

// Covers the promo field from 5999bef. Tagged @smoke on purpose: it is the
// "test merged before its feature reached prod" case for the release gate.
test("applies the GATE10 promo code @smoke", async ({ page, baseURL }) => {
  await page.goto(siteRoot(baseURL));
  await page.getByLabel("Promo code").fill("gate10");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("promo-status")).toHaveText("10% off applied.");
});
