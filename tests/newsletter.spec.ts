import { expect, test } from "@playwright/test";
import { siteRoot } from "./site";

test("rejects an invalid email", async ({ page, baseURL }) => {
  await page.goto(siteRoot(baseURL));
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Please enter a valid email.");
});

test("accepts a valid email", async ({ page, baseURL }) => {
  await page.goto(siteRoot(baseURL));
  await page.getByLabel("Email").fill("qa@example.com");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByTestId("form-status")).toHaveText("Subscribed!");
});
