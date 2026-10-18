// Narrated, slowed-down Playwright recordings of the release-gate scenarios.
// Every scenario becomes one MP4: a caption bar says what is happening and
// what we expect, the element about to be clicked is ringed and a cursor
// glides to it, and pipeline commands stream into an on-page terminal panel.
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");
export const APP = "http://localhost:9999";
export const OUT = join(process.env.HOME ?? "/tmp", "Videos", "release-gate-walkthrough");
const CLIPS = join(import.meta.dir, "videos");
const AUTH = join(import.meta.dir, ".auth");
const VIEWPORT = { width: 1440, height: 900 };

type Role = "owner" | "member" | "viewer";
const users: Record<Role, { email: string; password: string }> = JSON.parse(
  readFileSync(join(import.meta.dir, ".users.local.json"), "utf8"),
);

const STATE_FILE = join(import.meta.dir, ".state.json");
export const state: Record<string, string> = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
export const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const OVERLAY = `
(() => {
  if (window.__demo) return;
  const css = \`
  #demo-cap{position:fixed;left:72px;right:72px;bottom:16px;z-index:2147483646;background:rgba(15,23,42,.94);color:#f8fafc;
    font:15px/1.45 system-ui,sans-serif;border-radius:12px;padding:12px 16px;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none}
  #demo-cap .t{font-weight:700;font-size:13px;letter-spacing:.04em;color:#93c5fd;text-transform:uppercase}
  #demo-cap .s{font-size:17px;font-weight:600;margin-top:2px}
  #demo-cap .e{margin-top:4px;color:#fde68a}
  #demo-ring{position:fixed;z-index:2147483645;border:3px solid #ef4444;border-radius:10px;box-shadow:0 0 0 6px rgba(239,68,68,.25);
    pointer-events:none;transition:all .45s ease;opacity:0}
  #demo-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,.85);
    border:2px solid #fff;pointer-events:none;transition:left .7s ease,top .7s ease,transform .15s;left:50%;top:50%;margin:-11px 0 0 -11px}
  #demo-cursor.down{transform:scale(.6)}
  #demo-term{position:fixed;right:16px;top:16px;width:760px;max-height:62vh;overflow:hidden;z-index:2147483644;background:#0b1020;color:#d1fae5;
    font:12.5px/1.45 ui-monospace,Menlo,monospace;border-radius:10px;padding:10px 12px 12px;box-shadow:0 8px 30px rgba(0,0,0,.45);pointer-events:none;display:none;white-space:pre-wrap}
  #demo-term .h{color:#94a3b8;font:600 11px system-ui;margin-bottom:6px;letter-spacing:.05em}
  #demo-term .c{color:#fbbf24}
  #demo-stamp{position:fixed;left:50%;top:42%;transform:translate(-50%,-50%) rotate(-4deg);z-index:2147483647;padding:18px 30px;border-radius:14px;
    font:800 30px system-ui;color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.4);pointer-events:none;display:none;text-align:center;max-width:80vw}
  nextjs-portal{display:none!important}
  #demo-stamp small{display:block;font:600 16px system-ui;margin-top:6px;opacity:.95}\`;
  const mount = () => {
    if (document.getElementById('demo-cap')) return;
    const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st);
    for (const id of ['demo-cap','demo-ring','demo-cursor','demo-term','demo-stamp']) { const d = document.createElement('div'); d.id = id; document.documentElement.appendChild(d); }
    document.getElementById('demo-cap').style.display = 'none';
  };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  window.__demo = {
    mount,
    caption(t, s, e) { mount(); const c = document.getElementById('demo-cap'); c.style.display = 'block';
      c.innerHTML = '<div class="t">' + esc(t) + '</div><div class="s">' + esc(s) + '</div>' + (e ? '<div class="e">Expected: ' + esc(e) + '</div>' : ''); },
    ring(r) { mount(); const g = document.getElementById('demo-ring'); if (!r) { g.style.opacity = 0; return; }
      Object.assign(g.style, { left: (r.x - 6) + 'px', top: (r.y - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px', opacity: 1 }); },
    cursor(x, y, down) { mount(); const c = document.getElementById('demo-cursor'); c.style.left = x + 'px'; c.style.top = y + 'px'; c.classList.toggle('down', !!down); },
    term(title, lines) { mount(); const t = document.getElementById('demo-term'); if (!lines) { t.style.display = 'none'; return; }
      t.style.display = 'block';
      t.innerHTML = '<div class="h">' + esc(title) + '</div>' + lines.slice(-26).map((l) => l.startsWith('$ ') ? '<span class="c">' + esc(l) + '</span>' : esc(l)).join('\\n'); },
    stamp(ok, text, sub) { mount(); const s = document.getElementById('demo-stamp'); if (!text) { s.style.display = 'none'; return; }
      s.style.display = 'block'; s.style.background = ok ? '#15803d' : '#b91c1c'; s.innerHTML = esc(text) + (sub ? '<small>' + esc(sub) + '</small>' : ''); },
  };
  document.addEventListener('DOMContentLoaded', mount);
})();`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** One recorded scenario. Long waits happen between clips (`offscreen`), then clips are joined. */
export class Scenario {
  page!: Page;
  private ctx!: BrowserContext;
  private clips: string[] = [];
  private cap: [string, string, string?] = ["", ""];
  private termTitle = "";
  private termLines: string[] | null = null;
  private role: Role = "owner";

  constructor(private browser: Browser, readonly id: string, readonly title: string) {}

  async open(role: Role = "owner", path = "/en/release-gate") {
    this.role = role;
    mkdirSync(CLIPS, { recursive: true });
    mkdirSync(AUTH, { recursive: true });
    const storage = join(AUTH, `${role}.json`);
    this.ctx = await this.browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: CLIPS, size: VIEWPORT },
      storageState: existsSync(storage) ? storage : undefined,
      locale: "en-US",
    });
    await this.ctx.addInitScript(OVERLAY);
    this.page = await this.ctx.newPage();
    (globalThis as any).__lastPage = this.page;
    this.page.on("load", () => void this.repaint());
    await this.goto(path);
    if (this.page.url().includes("/login")) await this.login(role, path);
  }

  private async login(role: Role, path: string) {
    const u = users[role];
    await this.say(`Sign in as gate-${role}`, `Local test user, ${role} of Gate Lab`);
    await this.type(this.page.getByLabel(/email/i).first(), u.email, "Email");
    await this.type(this.page.getByLabel(/password/i).first(), u.password, "Password (masked)", true);
    await this.click(this.page.getByRole("button", { name: /sign in|log in/i }).first(), "Sign in");
    await this.page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await this.ctx.storageState({ path: join(AUTH, `${role}.json`) });
    await this.goto(path);
  }

  /** Finish the current clip, run `fn` unrecorded (waits, polling), then start a new clip. */
  async offscreen<T>(note: string, fn: () => Promise<T>, resumePath?: string): Promise<T> {
    await this.say(note, "Skipping the wait in the video; recording resumes when it is done");
    await sleep(2500);
    const url = resumePath ?? new URL(this.page.url()).pathname + new URL(this.page.url()).search;
    await this.closeClip();
    const out = await fn();
    await this.open(this.role, url);
    return out;
  }

  private async closeClip() {
    const video = this.page.video();
    await this.ctx.close();
    if (video) this.clips.push(await video.path());
  }

  async finish() {
    await sleep(2500);
    await this.closeClip();
    mkdirSync(OUT, { recursive: true });
    const name = `${this.id}-${this.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}.mp4`;
    const list = join(CLIPS, `${this.id}.txt`);
    writeFileSync(list, this.clips.map((c) => `file '${c}'`).join("\n"));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart", join(OUT, name)]);
    for (const c of this.clips) rmSync(c, { force: true });
    rmSync(list, { force: true });
    console.log(`[${this.id}] saved ${join(OUT, name)}`);
    return join(OUT, name);
  }

  private async repaint() {
    try {
      await this.page.evaluate(([t, s, e]) => (window as any).__demo?.caption(t, s, e), this.cap);
      if (this.termLines) await this.page.evaluate(([t, l]) => (window as any).__demo?.term(t, l), [this.termTitle, this.termLines] as const);
    } catch {}
  }

  async goto(path: string) {
    await this.page.goto(APP + path, { waitUntil: "domcontentloaded" });
    await this.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await this.repaint();
    await sleep(1200);
  }

  /** Caption: what this step does and what should happen. Holds long enough to read. */
  async say(step: string, expected?: string, holdMs = 2600) {
    this.cap = [`${this.id} · ${this.title}`, step, expected];
    await this.repaint();
    await sleep(holdMs);
  }

  private async point(loc: Locator) {
    await loc.scrollIntoViewIfNeeded({ timeout: 15_000 });
    const box = await loc.boundingBox();
    if (!box) return;
    await this.page.evaluate((r) => (window as any).__demo.ring(r), box);
    await this.page.evaluate(([x, y]) => (window as any).__demo.cursor(x, y, false), [box.x + box.width / 2, box.y + box.height / 2]);
    await sleep(1100);
  }

  async show(loc: Locator, note?: string, holdMs = 2500) {
    if (note) await this.say(note, undefined, 0);
    await this.point(loc);
    await sleep(holdMs);
    await this.page.evaluate(() => (window as any).__demo.ring(null));
  }

  async click(loc: Locator, note?: string) {
    if (note) await this.say(`Click “${note}”`, this.cap[2], 600);
    await this.point(loc);
    await this.page.evaluate(() => { const c = document.getElementById("demo-cursor"); c?.classList.add("down"); });
    await loc.click();
    await sleep(350);
    await this.page.evaluate(() => { document.getElementById("demo-cursor")?.classList.remove("down"); (window as any).__demo.ring(null); });
    await this.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await sleep(900);
  }

  async type(loc: Locator, text: string, note?: string, secret = false) {
    if (note) await this.say(`Type into “${note}”`, this.cap[2], 600);
    await this.point(loc);
    await loc.click();
    await loc.fill("");
    await loc.pressSequentially(text, { delay: secret ? 25 : 55 });
    await this.page.evaluate(() => (window as any).__demo.ring(null));
    await sleep(700);
  }

  /** Run a pipeline command from the demo repo, streaming it into the on-page terminal. */
  async shell(cmd: string, args: string[] = [], opts: { title?: string; allowFail?: boolean; env?: Record<string, string> } = {}) {
    this.termTitle = opts.title ?? "Pipeline (ahub-gate-demo)";
    const shown = `$ ${[cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`;
    this.termLines = [...(this.termLines ?? []), shown];
    await this.repaint();
    await sleep(1200);
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...opts.env } });
    let out = "";
    const onData = (b: Buffer) => {
      const text = strip(b.toString());
      out += text;
      for (const line of text.split("\n")) if (line.trim()) this.termLines!.push(line);
      void this.repaint();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const code: number = await new Promise((r) => child.on("close", (c) => r(c ?? 1)));
    await this.repaint();
    await sleep(2800);
    if (code !== 0 && !opts.allowFail) throw new Error(`${shown} exited ${code}\n${out}`);
    return { code, out };
  }

  async clearTerm() {
    this.termLines = null;
    await this.page.evaluate(() => (window as any).__demo.term("", null));
  }

  /** Big PASS/FAIL stamp: did the system do what the scenario expects? */
  async verdict(ok: boolean, text: string, sub?: string) {
    await this.page.evaluate(([o, t, s]) => (window as any).__demo.stamp(o, t, s), [ok, text, sub] as const);
    await sleep(3800);
    await this.page.evaluate(() => (window as any).__demo.stamp(false, ""));
    if (!ok) console.error(`[${this.id}] UNEXPECTED: ${text} ${sub ?? ""}`);
  }
}

/** Plain API helpers (no recording) used to wait for async work. */
export function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; raw: any }> {
  const e = env();
  const r = await fetch(`${e.AHUB_URL}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${e.AHUB_TOKEN}`, "Content-Type": "application/json", "x-ahub-actor": "walkthrough" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.json().catch(() => null);
  return { status: r.status, data: raw?.data, raw };
}

export async function waitRun(runId: string, timeoutMs = 10 * 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { data } = await api("GET", `/ci/runs/${runId}`);
    if (["passed", "failed", "cancelled"].includes(data?.status)) return data;
    await sleep(5000);
  }
  throw new Error(`run ${runId} did not finish`);
}

export function git(...args: string[]) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export async function launch() {
  return chromium.launch({ headless: true, slowMo: 120 });
}

export function cleanClips() {
  if (!existsSync(CLIPS)) return;
  for (const f of readdirSync(CLIPS)) if (f.endsWith(".webm")) rmSync(join(CLIPS, f), { force: true });
}
export { renameSync };

const ORG_ID = "01a14f1e-beb0-760f-add2-12d0be7b4a2e"; // Gate Lab
let jwt: string | null = null;

/** Signed-in owner API (JWT + X-Org-Id) for reads the CI token cannot make. */
export async function ownerApi<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; raw: any }> {
  const e = env();
  if (!jwt) {
    const r = await fetch(`${e.AHUB_URL}/api/v1/auth/email/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: users.owner.email, password: users.owner.password }),
    });
    jwt = (await r.json())?.data?.token ?? null;
    if (!jwt) throw new Error(`owner login failed: ${r.status}`);
  }
  const r = await fetch(`${e.AHUB_URL}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, "X-Org-Id": ORG_ID, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.json().catch(() => null);
  return { status: r.status, data: raw?.data, raw };
}
