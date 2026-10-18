import { expect, test } from "@playwright/test";
import { siteRoot } from "./site";

test("add to cart increments the counter", async ({ page, baseURL }) => {
  await page.goto(siteRoot(baseURL));
  await page.getByTestId("add").click();
  await page.getByTestId("add").click();
  await expect(page.getByTestId("count")).toHaveText("2");
});

test("clear resets the counter", async ({ page, baseURL }) => {
  await page.goto(siteRoot(baseURL));
  await page.getByTestId("add").click();
  await page.getByTestId("clear").click();
  await expect(page.getByTestId("count")).toHaveText("0");
});
