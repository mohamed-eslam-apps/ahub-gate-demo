import { test } from "@playwright/test";

// Idle unless a run sets DEMO_SLOW_MS (per-run env): keeps a run alive long
// enough to change what the test environment serves mid-run (versionDrift demo).
test("holds the run open when DEMO_SLOW_MS is set", async () => {
  const ms = Number(process.env.DEMO_SLOW_MS ?? 0);
  test.setTimeout(ms + 30_000);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
});
