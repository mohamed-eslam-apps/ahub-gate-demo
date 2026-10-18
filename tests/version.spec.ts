import { expect, test } from "@playwright/test";

test("version.json follows the release-gate contract", async ({ request }) => {
  const res = await request.get(`version.json?ts=${Date.now()}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.component).toBe("web");
  expect(body.commitSha).toMatch(/^[0-9a-f]{40}$/);
});
