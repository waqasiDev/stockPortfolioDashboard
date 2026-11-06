// Background loops (run while the app server is running):
//  every 1 min  – AI Trader market scanner (event mode): free trigger checks that wake the AI only when needed
//  every 1 min  – AI Trader queued-order fills, stop-loss / take-profit checks, equity snapshots, scheduled-mode runs
//  every 5 min  – morning brief + AI watchlist refresh, once per weekday after 8:30am New York time
import { briefTick } from "./lib/brief";
import { scannerTick } from "./lib/scanner";
import { traderTick } from "./lib/trader";

const g = globalThis as unknown as { __traderLoop?: NodeJS.Timeout; __scanLoop?: NodeJS.Timeout };
if (!g.__traderLoop) {
  // every minute: queued-order fills at the open, stop-loss / take-profit, equity snapshots, scheduled runs
  const tick = () => traderTick().catch((e) => console.warn("[trader] tick failed:", (e as Error).message));
  g.__traderLoop = setInterval(tick, 60_000);
  setTimeout(tick, 15_000);
  // every 5 minutes: morning brief check
  const brief = () => briefTick().catch((e) => console.warn("[brief] tick failed:", (e as Error).message));
  setInterval(brief, 5 * 60_000);
  setTimeout(brief, 30_000);
}
if (!g.__scanLoop) {
  const scan = () => scannerTick().catch((e) => console.warn("[scanner] tick failed:", (e as Error).message));
  g.__scanLoop = setInterval(scan, 60_000);
  setTimeout(scan, 20_000);
}
