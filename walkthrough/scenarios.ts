import { type Browser, type Locator } from "@playwright/test";
import { Scenario, api, git, ownerApi, saveState, sleep, state, waitRun } from "./lib";

const PRODUCT = "01a14f4b-2af1-70bf-b3e7-a3cd2047afef"; // "Gate Demo"
const P = `/en/release-gate/${PRODUCT}`;
const REPO = "01a14f42-f343-7542-8bbd-1c5f3945b20e";
const PAGES = "https://mohamed-eslam-apps.github.io/ahub-gate-demo";

type Fn = (b: Browser) => Promise<void>;

// ---------- small helpers ----------

/** Make one app change, commit and push it, all visible in the terminal panel. */
async function commit(s: Scenario, file: string, sedExpr: string, msg: string) {
  await s.shell("bash", ["-c", `sed -i '${sedExpr}' ${file} && git commit -qam "${msg}" && git push -q && git log --oneline -1`], { title: "Developer pushes a change" });
  return git("rev-parse", "HEAD");
}

async function ciRun(s: Scenario, args: string[] = []) {
  const { out } = await s.shell("scripts/ci-run.sh", args, { title: "Pipeline triggers the test-env run" });
  const id = out.match(/"id":\s*"([0-9a-f-]{36})"/)?.[1];
  if (!id) throw new Error(`no run id in: ${out}`);
  return id;
}

async function subjectVersion(runId: string, timeoutMs = 4 * 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { data } = await ownerApi("GET", `/runs/${runId}/subject-versions`);
    const v = data?.versions?.[0];
    if (v?.state && v.resolved !== false) return v;
    await sleep(5000);
  }
  return null;
}

async function gate(sha: string) {
  const q = new URLSearchParams({ product: "Gate Demo", component: "web", commitSha: sha });
  return (await api("GET", `/ci/gate?${q}`)).data;
}

async function prodVersions() {
  return ((await ownerApi("GET", `/release-products/${PRODUCT}/prod-versions`)).data ?? []) as any[];
}

async function waitProd(sha: string, statuses: string[], timeoutMs = 8 * 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = (await prodVersions()).find((x) => x.commitSha === sha);
    if (v && statuses.includes(v.status)) return v;
    await sleep(10_000);
  }
  return (await prodVersions()).find((x) => x.commitSha === sha) ?? null;
}

async function waitSmoke(timeoutMs = 8 * 60_000, notBefore = 0) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { data } = await ownerApi("GET", `/release-products/${PRODUCT}/smoke`);
    const status = data?.runStatus;
    const created = Date.parse(data?.createdAt ?? 0);
    if (["passed", "failed", "cancelled"].includes(status) && created >= notBefore) return data;
    await sleep(10_000);
  }
  return (await ownerApi("GET", `/release-products/${PRODUCT}/smoke`)).data;
}

const tab = (s: Scenario, name: string) => s.page.getByRole("tab", { name, exact: true });
const dialog = (s: Scenario) => s.page.getByRole("dialog").first();

async function openLatestCheck(s: Scenario) {
  await s.goto(`${P}?tab=checks`);
  await s.click(s.page.getByRole("button", { name: "Details" }).first(), "Details (newest check)");
  await sleep(2500);
  await s.page.keyboard.press("Escape");
  await sleep(800);
}

async function ack(s: Scenario, note: string) {
  const banner = s.page.getByRole("alert").filter({ has: s.page.getByRole("button", { name: "Acknowledge" }) }).first();
  await s.show(banner, "Red banner on the product page", 3500);
  await s.click(banner.getByRole("button", { name: "Acknowledge" }), "Acknowledge");
  await s.type(s.page.locator("#ack-note"), note, "Note");
  await s.click(dialog(s).getByRole("button", { name: "Acknowledge" }), "Acknowledge (confirm)");
}

async function openInbox(s: Scenario) {
  await s.click(s.page.getByRole("button", { name: "Notifications" }).first(), "Notifications bell");
  await sleep(3000);
  await s.page.keyboard.press("Escape");
  await sleep(800);
}

async function pickRepoCombobox(s: Scenario, trigger: Locator, repo: string) {
  if ((await trigger.evaluate((el) => el.tagName)) === "INPUT") return s.type(trigger, repo, "GitHub repository");
  await s.click(trigger, "GitHub repository");
  const search = s.page.getByPlaceholder("Search or type owner/repo");
  await s.type(search, repo, "Search or type owner/repo");
  const exact = s.page.getByRole("option", { name: new RegExp(`^${repo.replace("/", "\\/")}$`) });
  await s.click((await exact.count()) ? exact.first() : s.page.getByRole("option", { name: /Use/ }).first(), repo);
}


async function pickCommit(s: Scenario, d: Locator, sha: string) {
  const trigger = d.locator("#ov-sha");
  if ((await trigger.evaluate((el) => el.tagName)) === "INPUT") return s.type(trigger, sha, "Commit SHA");
  await s.click(trigger, "Commit picker (lists commits from GitHub)");
  await s.type(s.page.getByPlaceholder("Search by message or SHA"), sha.slice(0, 7), "Search by message or SHA");
  await s.click(s.page.getByRole("option", { name: new RegExp(sha.slice(0, 7)) }).first(), `commit ${sha.slice(0, 7)} (the broken one)`);
}

// ---------- scenarios ----------

export const scenarios: Record<string, [string, Fn]> = {
  S00: ["Setup tour", async (b) => {
    const s = new Scenario(b, "S00", "Setup tour");
    await s.open("owner", "/en/settings/integrations");
    await s.say("GitHub App for Gate Lab", "Installed on mohamed-eslam-apps; created without webhooks (local backend)");
    await s.show(s.page.getByText("Connected:").first(), "The App the gate uses to read commits and trees", 3500);
    await s.goto("/en/settings/environments");
    await s.say("Two environments", "test → /test/, prod → /prod/ on GitHub Pages");
    await s.show(s.page.getByText("test", { exact: true }).first(), undefined, 2500);
    await s.goto("/en/release-gate");
    await s.click(s.page.getByRole("link", { name: /Gate Demo/ }).first(), "Gate Demo product");
    await s.say("Policy tab", "Test env, scope, freshness 72h, quarantine ≤10%, grace 1 min, smoke on prod");
    await s.page.mouse.wheel(0, 500); await sleep(2500); await s.page.mouse.wheel(0, 700); await sleep(2500);
    await s.click(tab(s, "Components"), "Components tab");
    await s.say("One component: web", "Path app/, prod + test /version URLs");
    await sleep(3500);
    await s.finish();
  }],

  S01: ["Create a product - mistakes are rejected", async (b) => {
    const s = new Scenario(b, "S01", "Create a product - mistakes are rejected");
    await s.open("owner");
    await s.click(s.page.getByRole("button", { name: "New product" }), "New product");
    const d = dialog(s);
    await s.type(d.locator("#rg-name"), "Gate Demo", "Name (deliberately a name that already exists)");
    await s.click(d.getByRole("checkbox", { name: "test", exact: true }).first(), "Test environment: test");
    await s.click(d.getByTestId("gate-scope").getByText("Gate Demo").first(), "Test scope: Gate Demo repo");
    await s.type(d.locator("#rg-grace"), "1", "Backstop grace (minutes)");
    await s.click(d.getByRole("checkbox", { name: "prod", exact: true }).nth(1), "Production environment: prod");
    await s.click(d.locator("#rg-smoke"), "Smoke tests in production: on");
    await s.click(d.getByTestId("smoke-scope").getByText("Gate Demo").first(), "Smoke scope: Gate Demo repo");
    await s.say("Mistake 1: leave the read-only confirmation unticked", "Next is refused with a confirmation error");
    await s.click(d.getByRole("button", { name: "Next" }), "Next");
    const confirmErr = d.getByText(/Confirm that the smoke tests are read-only/);
    await s.show(confirmErr, "Rejected", 2500);
    await s.verdict(await confirmErr.isVisible(), "Rejected ✓", "Smoke on prod needs the read-only confirmation");
    await s.click(d.locator("#rg-smoke-confirm"), "Confirm read-only smoke");
    await s.click(d.getByRole("button", { name: "Next" }), "Next");

    await s.say("Step 2: components. Mistakes 2 + 3: bad name, http URL", "Both fields show an error");
    await s.type(d.locator("#c-name-0"), "Web App", "Component name (space is not allowed)");
    await pickRepoCombobox(s, d.locator("#c-repo-0"), "mohamed-eslam-apps/ahub-gate-demo");
    await s.click(d.getByRole("switch", { name: /Whole repository/ }).first(), "Whole repository: off (gate only app/)");
    await s.type(d.locator("#c-paths-0"), "app", "Paths");
    await s.type(d.locator("#c-url-0"), `http://mohamed-eslam-apps.github.io/ahub-gate-demo/prod/version.json`, "Prod /version URL (http, not https)");
    await s.type(d.locator("#c-test-url-0"), `${PAGES}/test/version.json`, "Test /version URL");
    await s.click(d.getByRole("button", { name: "Create product" }), "Create product");
    const nameErr = d.getByText("Use 1-64 characters: a-z, 0-9 and -");
    const urlErr = d.getByText("Use a public https address");
    await s.show(nameErr, "Name rejected", 2000);
    await s.show(urlErr, "URL rejected", 2000);
    await s.verdict((await nameErr.isVisible()) && (await urlErr.isVisible()), "Rejected ✓", "Component name and non-https URL");

    await s.say("Fix both. Mistake 4: the product name already exists", "Server answers 409, the sheet stays open");
    await s.type(d.locator("#c-name-0"), "web", "Component name");
    await s.type(d.locator("#c-url-0"), `${PAGES}/prod/version.json`, "Prod /version URL");
    await s.click(d.getByRole("button", { name: "Create product" }), "Create product");
    const dup = s.page.getByText("A product with this name already exists.");
    const dupSeen = await dup.first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
    await s.show(dup.first(), "Toast from the server", 1500);
    await s.verdict(dupSeen, "Rejected ✓", "409 productNameAlreadyExists");

    await s.say("Rename and create for real (smoke off, so it watches nothing)", "Product created and opened");
    await s.click(d.getByRole("button", { name: "Back" }), "Back");
    await s.type(d.locator("#rg-name"), "Scratch product", "Name");
    await s.click(d.locator("#rg-smoke"), "Smoke: off");
    await s.click(d.getByRole("button", { name: "Next" }), "Next");
    const wiped = (await d.locator("#c-name-0").inputValue()) === "";
    await s.show(d.locator("#c-name-0").locator("xpath=ancestor::*[contains(@class,'border')][1]"), "BUG FOUND: Back + Next wiped everything typed in step 2", 3000);
    await s.verdict(!wiped, wiped ? "Bug: step 2 was cleared" : "Step 2 kept ✓", wiped ? "logged as a bug; refilling the component to continue" : "");
    await s.type(d.locator("#c-name-0"), "web", "Component name");
    await pickRepoCombobox(s, d.locator("#c-repo-0"), "mohamed-eslam-apps/ahub-gate-demo");
    await s.click(d.getByRole("switch", { name: /Whole repository/ }).first(), "Whole repository: off");
    await s.type(d.locator("#c-paths-0"), "app", "Paths");
    await s.type(d.locator("#c-url-0"), `${PAGES}/prod/version.json`, "Prod /version URL");
    await s.type(d.locator("#c-test-url-0"), `${PAGES}/test/version.json`, "Test /version URL");
    await s.click(d.getByRole("button", { name: "Create product" }), "Create product");
    await s.page.waitForURL(/\/release-gate\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await sleep(2000);
    const heading = s.page.getByRole("heading", { name: "Scratch product" });
    await s.verdict(await heading.isVisible(), "Created ✓", "Valid product saved");
    await s.say("Delete it again", "Confirm dialog, then back to the list");
    await s.click(s.page.getByRole("button", { name: "Delete" }).first(), "Delete");
    await s.click(s.page.getByRole("alertdialog").getByRole("button", { name: "Delete" }), "Delete (confirm)");
    await sleep(2500);
    await s.finish();
  }],

  S02: ["No run yet - the gate says unknown", async (b) => {
    const s = new Scenario(b, "S02", "No run yet - the gate says unknown");
    await s.open("owner", P);
    await s.say("A developer changes the app (footer text)", "New commit → new component hash → nothing tested it yet");
    state.A1 = await commit(s, "app/index.html", "s/Version: /Version (v2): /", "feat: show v2 in the footer");
    saveState();
    await s.say("The pipeline asks the gate before deploying to prod", "verdict unknown, reason noMatchingRun, no deploy");
    const { out } = await s.shell("scripts/release.sh", [], { allowFail: true });
    await s.verdict(/noMatchingRun/.test(out) && /Not deploying/.test(out), "Blocked ✓", "unknown · noMatchingRun · prod untouched");
    await s.clearTerm();
    await openLatestCheck(s);
    await s.finish();
  }],

  S03: ["Unknown commit and a repo the App cannot see", async (b) => {
    const s = new Scenario(b, "S03", "Unknown commit and a repo the App cannot see");
    await s.open("owner", P);
    await s.say("Ask about a commit that does not exist", "unknown · commitNotFound");
    const a = await s.shell("scripts/gate-check.sh", ["1234567890abcdef1234567890abcdef12345678"]);
    await s.verdict(/commitNotFound/.test(a.out), "Refused ✓", "unknown · commitNotFound");
    await s.clearTerm();
    await s.say("Add a component on a repo the GitHub App is not installed on", "unknown · githubAppNotInstalled");
    await s.click(tab(s, "Components"), "Components tab");
    await s.click(s.page.getByRole("button", { name: "Add component" }), "Add component");
    await s.type(s.page.locator("#c-name-1"), "pw", "Name");
    await pickRepoCombobox(s, s.page.locator("#c-repo-1"), "microsoft/playwright");
    await s.click(s.page.getByRole("button", { name: "Save components" }), "Save components");
    const pwSha = (await (await fetch("https://api.github.com/repos/microsoft/playwright/commits/main")).json()).sha as string;
    const c = await s.shell("scripts/gate-check.sh", [pwSha, "pw"]);
    await s.verdict(/githubAppNotInstalled/.test(c.out), "Refused ✓", "unknown · githubAppNotInstalled");
    await s.clearTerm();
    await s.say("Remove the probe component again");
    await s.click(s.page.getByRole("button", { name: "Remove component" }).nth(1), "Remove component 2");
    await s.click(s.page.getByRole("button", { name: "Save components" }), "Save components");
    await s.finish();
  }],

  S04: ["Deploy to test, run the tests, gate passes", async (b) => {
    const s = new Scenario(b, "S04", "Deploy to test, run the tests, gate passes");
    await s.open("owner", P);
    await s.say("Pipeline deploys the new commit to the test environment", "test/version.json now reports it");
    await s.shell("scripts/deploy.sh", ["test", state.A1]);
    await s.say("Pipeline starts the test run and reports the deployed commit", "Run queued on env test");
    const runId = await ciRun(s, [state.A1]);
    state.runA1 = runId; saveState();
    await s.offscreen("Waiting for the run and the end-of-run version probe (~2 min)", async () => {
      await waitRun(runId);
      await subjectVersion(runId);
    }, `/en/runs/${runId}`);
    await s.say("Run detail: which version did this run test?", "Tested version: web · sha · pipeline · verified");
    const tv = s.page.getByText("Tested version").first();
    await s.show(tv.locator("xpath=..").first(), undefined, 4000);
    const row = await s.page.getByText(/web · [0-9a-f]{7} ·/).first().textContent().catch(() => "");
    await s.verdict(/verified/.test(row ?? ""), "Recorded ✓", row ?? "");
    await s.click(s.page.getByRole("tab", { name: "Tests" }), "Tests tab");
    await sleep(3000);
    await s.say("Pipeline asks the gate again", "pass — every in-scope test passed on this exact hash");
    const g = await s.shell("scripts/release.sh", [state.A1, "--check-only"]);
    await s.verdict(/"verdict": "pass"/.test(g.out), "Gate: PASS ✓", "fresh passing results for this component hash");
    await s.finish();
  }],

  S05: ["Change outside app/ - earlier run still counts", async (b) => {
    const s = new Scenario(b, "S05", "Change outside app - earlier run still counts");
    await s.open("owner", P);
    await s.say("Commit a docs-only change (outside the component path app/)", "Same component hash → the S04 run still covers it");
    state.docs = await commit(s, "docs/README.md", "s/Edit counter: [0-9]*/Edit counter: 1/", "docs: bump the notes counter");
    saveState();
    const g = await s.shell("scripts/gate-check.sh", [state.docs]);
    await s.verdict(/"verdict": "pass"/.test(g.out) && g.out.includes(state.runA1), "Gate: PASS ✓", "no new run needed: app/ tree unchanged");
    await s.finish();
  }],

  S07: ["Scope that matches no test - unknown", async (b) => {
    const s = new Scenario(b, "S07", "Scope that matches no test - unknown");
    await s.open("owner", P);
    await s.say("Narrow the test scope to a tag no test carries (via the API)", "unknown · emptyScope — an empty scope never passes");
    const before = (await ownerApi("GET", `/release-products/${PRODUCT}`)).data;
    state.scope = JSON.stringify(before.testScope); saveState();
    await s.shell("bash", ["-c", `echo 'PATCH /api/v1/release-products/<Gate Demo>  {"testScope":{"repoIds":["<Gate Demo repo>"],"tags":["@does-not-exist"]}}'`], { title: "Admin narrows the scope" });
    await ownerApi("PATCH", `/release-products/${PRODUCT}`, { testScope: { ...before.testScope, tags: ["@does-not-exist"] } });
    const g = await s.shell("scripts/gate-check.sh", [state.docs]);
    await s.verdict(/emptyScope/.test(g.out), "Refused ✓", "unknown · emptyScope");
    await s.shell("bash", ["-c", "echo 'PATCH … restore the whole-suite scope'"]);
    await ownerApi("PATCH", `/release-products/${PRODUCT}`, { testScope: before.testScope });
    const g2 = await s.shell("scripts/gate-check.sh", [state.docs]);
    await s.verdict(/"verdict": "pass"/.test(g2.out), "Restored ✓", "pass again");
    await s.goto(P);
    await s.show(s.page.getByRole("status").first(), "Policy tab warns that the scope changed recently", 4000);
    await s.finish();
  }],

  S08: ["Too many quarantined tests - unknown", async (b) => {
    const s = new Scenario(b, "S08", "Too many quarantined tests - unknown");
    const tests = (await ownerApi("GET", `/test-catalog/tests?repoId=${REPO}&per_page=50`)).data as any[];
    const victim = tests.find((t) => t.title.includes("clear resets the counter"));
    await s.open("owner", "/en/settings/quarantine");
    await s.say("Quarantine 1 of 8 tests = 12.5% (limit 10%)", "Next run counts it; gate → unknown · tooManyQuarantined");
    await s.click(s.page.getByRole("button", { name: "Quarantine a test" }).first(), "Quarantine a test");
    const d = dialog(s);
    await s.click(d.getByRole("combobox").first(), "Repository");
    await s.click(s.page.getByRole("option", { name: /Gate Demo/ }).first(), "Gate Demo");
    await s.type(d.getByPlaceholder("e2e-login-flow"), victim.key, "Test case key");
    await s.type(d.getByRole("textbox").nth(1), victim.title, "Title");
    await s.type(d.getByPlaceholder("tests/login.spec.ts"), victim.file ?? "cart.spec.ts", "File");
    await s.type(d.getByPlaceholder("chromium"), "chromium", "Project");
    await s.type(d.locator("textarea").first(), "Walkthrough: push quarantine over the gate's 10% limit", "Reason");
    await s.click(d.getByRole("button", { name: "Quarantine a test" }), "Quarantine a test (submit)");
    await sleep(2000);
    const runId = await ciRun(s, [state.A1]);
    await s.offscreen("Waiting for a fresh run (a quarantine only counts if it predates the latest result)", async () => {
      await waitRun(runId);
      await subjectVersion(runId);
    }, P);
    const g = await s.shell("scripts/gate-check.sh", [state.docs]);
    await s.verdict(/tooManyQuarantined/.test(g.out), "Refused ✓", "unknown · tooManyQuarantined");
    await s.clearTerm();
    await s.goto("/en/settings/quarantine");
    await s.say("Release the test from quarantine", "Gate passes again");
    await s.click(s.page.getByRole("button", { name: "Release" }).first(), "Release");
    await s.click(s.page.getByRole("alertdialog").getByRole("button", { name: "Release" }), "Release (confirm)");
    const g2 = await s.shell("scripts/gate-check.sh", [state.docs]);
    await s.verdict(/"verdict": "pass"/.test(g2.out), "Gate: PASS ✓", "quarantine released");
    await s.finish();
  }],

  S10: ["Full release to production - gated and smoke-tested", async (b) => {
    const s = new Scenario(b, "S10", "Full release to production - gated and smoke-tested");
    await s.open("owner", P);
    await s.say("release.sh: gate check → deploy prod → confirm", "pass, prod deployed, check confirmed");
    const t0 = Date.now();
    await s.shell("scripts/release.sh", [state.docs]);
    state.prod1 = state.docs; saveState();
    const v = await s.offscreen("Waiting: watcher sees prod (2 stable readings), grace 1 min, smoke run on prod", async () => {
      const pv = await waitProd(state.docs, ["gated", "unconfirmed", "ungated", "bypassed"]);
      await waitSmoke(8 * 60_000, t0);
      return pv;
    }, `/en/release-gate`);
    await s.show(s.page.getByRole("link", { name: /Gate Demo/ }).first(), "Card: In production shows the new version", 4000);
    await s.verdict(v?.status === "gated", `Prod version: ${v?.status ?? "?"}`, "gated = passed the gate and was confirmed");
    await s.goto(`${P}?tab=checks`);
    await s.show(s.page.getByRole("row").nth(1), "Newest check: Pass, Confirmed", 4000);
    await s.goto("/en/runs");
    await s.show(s.page.getByRole("row").nth(1), "Smoke run on prod, started by the release gate", 4500);
    await s.finish();
  }],

  S06: ["Broken build - the gate fails", async (b) => {
    const s = new Scenario(b, "S06", "Broken build - the gate fails");
    await s.open("owner", P);
    await s.say("A developer breaks the page title", "Title tests fail on test → gate: fail · failingTests");
    state.B = await commit(s, "app/index.html", "s/<title>Gate Demo Store/<title>Gate Demo Shop/", "feat: rename the store (breaks the title test)");
    saveState();
    await s.shell("scripts/deploy.sh", ["test", state.B]);
    const runId = await ciRun(s, [state.B]);
    await s.offscreen("Waiting for the test run (~2 min)", async () => { await waitRun(runId); await subjectVersion(runId); }, `/en/runs/${runId}`);
    await s.click(s.page.getByRole("tab", { name: "Tests" }), "Tests tab");
    await sleep(3500);
    const { out } = await s.shell("scripts/release.sh", [state.B], { allowFail: true });
    await s.verdict(/failingTests/.test(out) && /Not deploying/.test(out), "Blocked ✓", "fail · failingTests — prod untouched");
    await s.clearTerm();
    await openLatestCheck(s);
    await s.finish();
  }],

  S09: ["Override a failing commit - and smoke catches it in prod", async (b) => {
    const s = new Scenario(b, "S09", "Override a failing commit - and smoke catches it in prod");
    await s.open("owner", `${P}?tab=overrides`);
    await s.say("A manager waives the failing verdict for this one commit", "Override: single use, 24 h, audited");
    await s.click(s.page.getByRole("button", { name: "New override" }), "New override");
    const d = dialog(s);
    await pickCommit(s, d, state.B);
    await s.type(d.locator("#ov-reason"), "Walkthrough: ship the renamed store despite the title test", "Reason");
    await s.click(d.getByRole("button", { name: "Create override" }), "Create override");
    await sleep(3000);
    await s.click(d.getByRole("button", { name: "Done" }), "Done");
    const t0 = Date.now();
    const r = await s.shell("scripts/release.sh", [state.B]);
    await s.verdict(/"override":/.test(r.out) && /Confirmed check/.test(r.out), "Allowed by override ✓", "verdict stays fail, overrideApplied, confirm consumes it");
    await s.clearTerm();
    await s.offscreen("Waiting for the watcher and the smoke run on prod (~3 min)", async () => {
      await waitProd(state.B, ["gated", "unconfirmed"]);
      await waitSmoke(8 * 60_000, t0);
    }, P);
    const banner = s.page.getByText("Production smoke tests are failing");
    await s.show(banner, "Smoke caught the broken title in production", 4000);
    await s.verdict(await banner.isVisible(), "Smoke failing ✓", "banner + inbox + run alert");
    await openInbox(s);
    await s.click(s.page.getByRole("button", { name: "Re-run smoke" }).first(), "Re-run smoke");
    await sleep(2000);
    await s.goto(`${P}?tab=overrides`);
    await s.show(s.page.getByRole("row").nth(1), "Override status: Used", 3500);
    await s.say("Use it twice? Ask the gate for the same commit again", "fail, no override left");
    const again = await s.shell("scripts/release.sh", [state.B], { allowFail: true });
    await s.verdict(/Not deploying/.test(again.out), "Blocked ✓", "an override is single-use");
    await s.clearTerm();
    await s.say("Create another override and revoke it", "Status: Revoked");
    await s.click(s.page.getByRole("button", { name: "New override" }), "New override");
    const d2 = dialog(s);
    await pickCommit(s, d2, state.B);
    await s.type(d2.locator("#ov-reason"), "Walkthrough: created only to be revoked", "Reason");
    await s.click(d2.getByRole("button", { name: "Create override" }), "Create override");
    await sleep(2000);
    await s.click(d2.getByRole("button", { name: "Done" }), "Done");
    await s.click(s.page.getByRole("button", { name: "Revoke" }).first(), "Revoke");
    await sleep(2500);
    await s.finish();
  }],

  S11: ["Deployed but never confirmed - unconfirmed alert", async (b) => {
    const s = new Scenario(b, "S11", "Deployed but never confirmed - unconfirmed alert");
    await s.open("owner", P);
    await s.say("Fix the title (and footer v3), test it", "Gate passes");
    state.C = await commit(s, "app/index.html", "s/<title>Gate Demo Shop/<title>Gate Demo Store/; s/Version (v2): /Version (v3): /", "fix: restore the store title");
    saveState();
    await s.shell("scripts/deploy.sh", ["test", state.C]);
    const runId = await ciRun(s, [state.C]);
    await s.offscreen("Waiting for the test run", async () => { await waitRun(runId); await subjectVersion(runId); }, P);
    await s.say("Pipeline deploys but crashes before confirming", "After the 1 min grace: unconfirmed alert");
    await s.shell("scripts/release.sh", [state.C, "--no-confirm"]);
    const v = await s.offscreen("Waiting for the watcher + grace period", () => waitProd(state.C, ["gated", "unconfirmed"]), P);
    await s.verdict(v?.status === "unconfirmed", `Prod version: ${v?.status ?? "?"}`, "passed the gate, never confirmed");
    await openInbox(s);
    await ack(s, "Pipeline crashed after deploy; verified manually");
    await sleep(2000);
    await s.finish();
  }],

  S12: ["Deployed without asking the gate - ungated alert", async (b) => {
    const s = new Scenario(b, "S12", "Deployed without asking the gate - ungated alert");
    await s.open("owner", P);
    state.D = await commit(s, "app/index.html", "s/Version (v3): /Version (v4): /", "feat: footer v4");
    saveState();
    await s.say("Someone deploys straight to prod, skipping the gate", "After grace: ungated alert");
    await s.shell("scripts/release.sh", [state.D, "--skip-gate"]);
    const v = await s.offscreen("Waiting for the watcher + grace period", () => waitProd(state.D, ["ungated", "gated"]), P);
    await s.verdict(v?.status === "ungated", `Prod version: ${v?.status ?? "?"}`, "no gate check covers it");
    await ack(s, "Hotfix pushed by hand during an incident");
    await sleep(2000);
    await s.finish();
  }],

  S13: ["Break-glass deploy - bypassed alert", async (b) => {
    const s = new Scenario(b, "S13", "Break-glass deploy - bypassed alert");
    await s.open("owner", P);
    state.E = await commit(s, "app/index.html", "s/Version (v4): /Version (v5): /", "feat: footer v5");
    saveState();
    await s.say("Automation Hub is 'down': the pipeline uses break-glass", "Recorded with actor + reason; alert still raised");
    await s.shell("scripts/release.sh", [state.E, "--break-glass", "Automation Hub outage drill"]);
    const v = await s.offscreen("Waiting for the watcher + grace period", () => waitProd(state.E, ["bypassed", "gated"]), `${P}?tab=checks`);
    await s.show(s.page.getByRole("row").nth(1), "Check row: Break-glass badge, actor, reason", 4000);
    await s.verdict(v?.status === "bypassed", `Prod version: ${v?.status ?? "?"}`, "break-glass never clears the alert");
    await s.goto(P);
    await ack(s, "Outage drill, reviewed by the release manager");
    await sleep(2000);
    await s.finish();
  }],

  S15: ["Test env changed during the run - versionDrift", async (b) => {
    const s = new Scenario(b, "S15", "Test env changed during the run - versionDrift");
    await s.open("owner", P);
    await s.say("Start a slow run on test (reports commit C)", "Then deploy another commit mid-run");
    await s.shell("scripts/deploy.sh", ["test", state.C]);
    const runId = await ciRun(s, [state.C, '{"env":{"DEMO_SLOW_MS":"150000"}}']);
    await s.say("While it runs, the test environment gets a different commit", "End probe disagrees with the pipeline → versionDrift");
    await s.shell("scripts/deploy.sh", ["test", state.E]);
    await s.offscreen("Waiting for the slow run to finish", async () => { await waitRun(runId); await subjectVersion(runId); }, `/en/runs/${runId}`);
    const row = await s.page.getByText(/web · [0-9a-f]{7} ·/).first().textContent().catch(() => "");
    await s.show(s.page.getByText("Tested version").first().locator("xpath=.."), "Tested version", 4000);
    await s.verdict(/changed during the run/.test(row ?? ""), "Drift caught ✓", row ?? "");
    const g = await s.shell("scripts/gate-check.sh", [state.C]);
    await s.say("This run is not counted as evidence for C", `matchedRunIds must not include ${runId.slice(-6)}`);
    await s.verdict(!g.out.includes(runId), "Not counted ✓", "drifted runs never qualify");
    await s.finish();
  }],

  S16: ["Roles - viewer and member", async (b) => {
    const v = new Scenario(b, "S16a", "Roles - viewer");
    await v.open("viewer");
    await v.say("Signed in as a viewer", "Can read everything, change nothing");
    await v.verdict((await v.page.getByRole("button", { name: "New product" }).count()) === 0, "No New product ✓");
    await v.goto(P);
    await v.show(v.page.locator("#rg-name"), "Policy fields are disabled", 3000);
    const noDelete = (await v.page.getByRole("button", { name: "Delete" }).count()) === 0;
    const noSmoke = (await v.page.getByRole("button", { name: "Re-run smoke" }).count()) === 0;
    await v.verdict(noDelete && noSmoke && (await v.page.locator("#rg-name").isDisabled()), "Read-only ✓", "no Delete, no Re-run smoke, disabled fields");
    await v.goto(`${P}?tab=overrides`);
    await v.verdict((await v.page.getByRole("button", { name: "New override" }).count()) === 0, "No New override ✓");
    await v.finish();

    const m = new Scenario(b, "S16b", "Roles - member");
    await m.open("member", P);
    await m.say("Signed in as a member (runner)", "Can re-run smoke, cannot edit the gate");
    const smoke = m.page.getByRole("button", { name: "Re-run smoke" });
    await m.show(smoke, "Re-run smoke is available to runners", 2500);
    await m.verdict((await smoke.count()) > 0 && (await m.page.getByRole("button", { name: "Delete" }).count()) === 0, "Runner rights ✓", "Re-run smoke yes, Delete no");
    await m.finish();
  }],
};
