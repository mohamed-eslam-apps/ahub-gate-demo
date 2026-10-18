import { expect, test } from "@playwright/test";
import { siteRoot } from "./site";

test("version.json follows the release-gate contract", async ({ request, baseURL }) => {
  const res = await request.get(`${siteRoot(baseURL)}version.json?ts=${Date.now()}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.component).toBe("web");
  expect(body.commitSha).toMatch(/^[0-9a-f]{40}$/);
});
