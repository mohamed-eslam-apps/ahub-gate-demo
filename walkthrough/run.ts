// Usage: bun walkthrough/run.ts S00 S01 ...   (no ids = every scenario, in order)
import { launch, cleanClips } from "./lib";
import { scenarios } from "./scenarios";

const ORDER = ["S00", "S01", "S02", "S03", "S04", "S05", "S07", "S08", "S10", "S06", "S09", "S11", "S12", "S13", "S15", "S16"];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ORDER;

cleanClips();
const browser = await launch();
const failed: string[] = [];
for (const id of ids) {
  const entry = scenarios[id];
  if (!entry) { console.error(`unknown scenario ${id}`); continue; }
  console.log(`\n=== ${id}: ${entry[0]}`);
  try {
    await entry[1](browser);
  } catch (e) {
    failed.push(id);
    await (globalThis as any).__lastPage?.screenshot({ path: `walkthrough/videos/${id}-crash.png` }).catch(() => {});
    console.error(`[${id}] crashed:`, (e as Error).message.split("\n").slice(0, 6).join("\n"));
    break; // later scenarios depend on this one's state
  }
}
await browser.close();
console.log(failed.length ? `\nStopped at: ${failed.join(", ")}` : "\nAll requested scenarios recorded.");
