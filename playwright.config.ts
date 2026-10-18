import { defineConfig, devices } from "@playwright/test";

// BASE_URL comes from the Automation Hub environment (test or prod).
// Keep the trailing slash: the site lives under a sub-path on GitHub Pages.
const baseURL = (process.env.BASE_URL ?? "http://localhost:4173/").replace(/\/?$/, "/");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
