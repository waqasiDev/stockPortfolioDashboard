import "server-only";
import { analyzeBuy } from "./analysis";
import { getFundamentals, getQuotes, getTechnicals } from "./market";
import { getSentiment } from "./research";
import { readStore, updateStore } from "./store";
import { nyNow } from "./time";
import { aiActive } from "./usage";
import { discover, isRunning, modeOf, runTrader, type RunOptions } from "./trader";
import type { ScanEvent, ScannerState, Sensitivity } from "./types";

/**
 * Event-driven AI Trader.
 *
 * Layer 1 (this file, free): every minute during market hours, scan ~100 stocks for triggers.
 * Layer 2 (paid): batch triggers for ~2 min, apply cooldowns + a daily cap, then wake the AI
 * with only the flagged stocks. Plus two safety-net full reviews per day (9:45 and 15:30 ET).
 */

const BENCH = "SPY";
const BATCH_WINDOW_MS = 2 * 60_000;
const MAX_FOCUS = 12; // max stocks per AI run; overflow waits for the next run
const MAX_UNIVERSE = 100;
const NEWS_FRESH_MS = 6 * 3600_000;

export const THRESHOLDS: Record<Sensitivity, { move: number; stopProx: number; rsiHigh: number; rsiLow: number; score: number; drop: number; vol: number; spy: number; pullback: number }> = {
  sensitive: { move: 2, stopProx: 3, rsiHigh: 70, rsiLow: 35, score: 70, drop: 4, vol: 1.5, spy: 1.0, pullback: 2 },
  normal: { move: 3, stopProx: 2, rsiHigh: 75, rsiLow: 30, score: 75, drop: 5, vol: 2, spy: 1.5, pullback: 1.5 },
  big: { move: 5, stopProx: 1.5, rsiHigh: 80, rsiLow: 25, score: 80, drop: 8, vol: 3, spy: 2.5, pullback: 1 },
};

export function emptyScanner(): ScannerState {
  return {
    lookPrice: {},
    lastAiLook: {},
    flags: {},
    seenNews: {},
    seenAnalyst: {},
    runsToday: { date: "", count: 0 },
    reviews: { date: "", open: false, close: false },
    pending: [],
    log: [],
  };
}

// ---- discovery pool: screener ideas, refreshed every 30 min ----
const g = globalThis as unknown as { __discPool?: { at: number; symbols: string[] }; __scanBusy?: boolean };
async function discoveryPool(): Promise<string[]> {
  if (g.__discPool && Date.now() - g.__discPool.at < 30 * 60_000) return g.__discPool.symbols;
  const symbols = [...new Set(await discover(15, true).catch(() => [] as string[]))];
  g.__discPool = { at: Date.now(), symbols };
  return symbols;
}

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!).catch(() => {});
  }));
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/** `force` (manual "Scan now") also scans outside market hours and dispatches without waiting for the batch window. */
export async function scannerTick(force = false): Promise<void> {
  if (g.__scanBusy) return; // previous scan still running
  g.__scanBusy = true;
  try {
    await scan(force);
  } finally {
    g.__scanBusy = false;
  }
}

async function scan(force: boolean) {
  const s0 = readStore();
  const t0 = s0.aiTrader;
  if (!t0 || t0.config.paused || (!force && modeOf(t0.config) !== "event")) return;
  const spy = (await getQuotes([BENCH]))[BENCH];
  if (!spy || (!force && spy.marketState !== "REGULAR")) return;

  const cfg = t0.config;
  const th = THRESHOLDS[cfg.sensitivity ?? "normal"];
  const sc = t0.scanner ?? emptyScanner();
  const ny = nyNow();
  const now = Date.now();
  const iso = new Date().toISOString();

  // ---------- universe ----------
  const positions = Object.keys(t0.positions);
  const mine = [...new Set([...s0.holdings.map((h) => h.symbol), ...s0.watchlist.map((w) => w.symbol)])];
  const disc = cfg.universe === "discover" ? await discoveryPool() : [];
  const universe = [...new Set([...positions, ...mine, ...disc])].filter((s) => s !== BENCH).slice(0, MAX_UNIVERSE);
  const quotes = await getQuotes(universe);

  const events: ScanEvent[] = [];
  const flags: Record<string, boolean> = {};
  const newBaselines: Record<string, number> = {};
  const mk = (symbol: string, kind: string, label: string, detail: string, group: ScanEvent["group"], urgent = false): ScanEvent => ({
    id: crypto.randomUUID(),
    at: iso,
    symbol,
    kind,
    label,
    detail,
    urgent,
    group,
    status: "queued",
  });
  // first scan after (re)starting the account: the start-up run already reviewed everything,
  // so just record which conditions are currently true instead of firing them all at once
  const seeding = !sc.lastScanAt;
  /** edge-triggered: fire only when the condition turns true */
  const edge = (symbol: string, kind: string, cond: boolean, make: () => ScanEvent) => {
    const k = `${symbol}:${kind}`;
    // a stock seen for the first time (e.g. new screener entrant) is also just recorded, not fired
    const firstSight = symbol !== BENCH && sc.lookPrice[symbol] === undefined;
    if (cond && !sc.flags[k] && !seeding && !firstSight) events.push(make());
    flags[k] = cond;
  };

  const dayFrac = Math.min(1, Math.max(0.05, (ny.minutes - (9 * 60 + 30)) / 390));

  await mapLimit(universe, 8, async (sym) => {
    const q = quotes[sym];
    if (!q) return;
    const t = await getTechnicals(sym, q.price).catch(() => undefined);
    const pos = t0.positions[sym];
    const base = sc.lookPrice[sym];
    if (base === undefined) newBaselines[sym] = q.price;
    const moved = base ? ((q.price - base) / base) * 100 : 0;

    if (pos) {
      // ---- protect what the AI owns ----
      if (pos.stopLoss) {
        const dist = ((q.price - pos.stopLoss) / q.price) * 100;
        edge(sym, "nearStop", dist >= 0 && dist <= th.stopProx, () => mk(sym, "nearStop", "Near stop-loss", `${q.price.toFixed(2)} is ${dist.toFixed(1)}% above the ${pos.stopLoss!.toFixed(2)} stop`, "position", true));
      }
      edge(sym, "move", Math.abs(moved) >= th.move, () => mk(sym, "move", `Moved ${pct(moved)} since last look`, `Now ${q.price.toFixed(2)} vs ${base?.toFixed(2)} when the AI last checked`, "position", Math.abs(moved) >= th.move * 2));
      if (t?.rsi14 !== undefined) edge(sym, "overbought", t.rsi14 > th.rsiHigh, () => mk(sym, "overbought", "Overbought", `RSI ${t.rsi14!.toFixed(0)} > ${th.rsiHigh} — consider trimming into strength`, "position"));
      if (t?.sma50) edge(sym, "lost50", q.price < t.sma50, () => mk(sym, "lost50", "Broke below 50-day avg", `${q.price.toFixed(2)} < ${t.sma50!.toFixed(2)}`, "position"));
      if (t?.sma200) edge(sym, "lost200", q.price < t.sma200, () => mk(sym, "lost200", "Broke below 200-day avg", `${q.price.toFixed(2)} < ${t.sma200!.toFixed(2)} — long-term trend at risk`, "position", true));
      if (q.earningsDate) {
        const days = (new Date(q.earningsDate).getTime() - now) / 86_400_000;
        edge(sym, `earnings:${q.earningsDate.slice(0, 10)}`, days >= 0 && days <= 1.2, () => mk(sym, "earnings", "Earnings within a day", `Reports ${new Date(q.earningsDate!).toLocaleDateString()} — hold through it or reduce?`, "position"));
      }
    } else {
      // ---- spot opportunities ----
      const f = await getFundamentals(sym).catch(() => undefined);
      const watch = s0.watchlist.find((w) => w.symbol === sym);
      const a = analyzeBuy(q, t, f, watch?.targetPrice);
      edge(sym, "score", a.score >= th.score, () => mk(sym, "score", `Buy score hit ${a.score}`, `${a.verdict}: ${a.signals.filter((x) => x.tone === "good").slice(0, 2).map((x) => x.label).join(", ")}`, "candidate"));
      if (t?.sma50 && t.sma200) {
        const off50 = ((q.price - t.sma50) / t.sma50) * 100;
        edge(sym, "pullback", q.price > t.sma200 && t.sma50 > t.sma200 && Math.abs(off50) <= th.pullback, () => mk(sym, "pullback", "Pullback to 50-day in uptrend", `${pct(off50)} from the 50-day avg, above the 200-day`, "candidate"));
      }
      if (t?.rsi14 !== undefined)
        edge(sym, "oversold", t.rsi14 < th.rsiLow && (f?.profitMargin ?? 0) > 0, () => mk(sym, "oversold", "Oversold quality stock", `RSI ${t.rsi14!.toFixed(0)}, profitable (margin ${((f?.profitMargin ?? 0) * 100).toFixed(0)}%)`, "candidate"));
      if (t?.high52 && q.volume && q.avgVolume) {
        const volRatio = q.volume / (q.avgVolume * dayFrac);
        edge(sym, "breakout", q.price >= t.high52 * 0.995 && volRatio >= th.vol, () => mk(sym, "breakout", "52-week-high breakout on volume", `Volume pace ${volRatio.toFixed(1)}× normal`, "candidate"));
      }
      edge(sym, `drop:${ny.date}`, q.changePct <= -th.drop, () => mk(sym, "drop", `Down ${q.changePct.toFixed(1)}% today`, "Possible overreaction — check if the news justifies it", "candidate"));
      if (watch?.targetPrice) edge(sym, `target:${watch.targetPrice}`, q.price <= watch.targetPrice, () => mk(sym, "target", "Hit watchlist target", `${q.price.toFixed(2)} ≤ your target ${watch.targetPrice}`, "candidate"));
    }
  });

  // ---------- news & analyst changes (your stocks + AI positions; refreshed via 30-min cache) ----------
  const seenNews = { ...sc.seenNews };
  const seenAnalyst = { ...sc.seenAnalyst };
  await mapLimit([...new Set([...positions, ...mine])].slice(0, 40), 4, async (sym) => {
    const s = await getSentiment(sym).catch(() => null);
    if (!s) return;
    const links = s.news.map((n) => n.link);
    if (!seenNews[sym]) seenNews[sym] = links; // first sight: just remember
    else {
      const fresh = s.news.filter((n) => !seenNews[sym].includes(n.link) && now - new Date(n.publishedAt).getTime() < NEWS_FRESH_MS);
      if (fresh.length)
        events.push(mk(sym, "news", fresh.length > 1 ? `${fresh.length} new headlines` : "New headline", fresh.map((n) => `“${n.title}” (${n.publisher})`).join(" · ").slice(0, 300), positions.includes(sym) ? "position" : "candidate"));
      seenNews[sym] = [...new Set([...links, ...seenNews[sym]])].slice(0, 40);
    }
    const latest = s.analystActions[0]?.date;
    if (latest) {
      if (!seenAnalyst[sym]) seenAnalyst[sym] = latest;
      else {
        for (const a of s.analystActions.filter((x) => x.date > seenAnalyst[sym] && (x.action === "up" || x.action === "down"))) {
          events.push(
            mk(sym, a.action === "up" ? "upgrade" : "downgrade", `${a.firm} ${a.action === "up" ? "upgraded" : "downgraded"} to ${a.toGrade}`, a.priceTarget ? `Price target ${a.priorPriceTarget ? `${a.priorPriceTarget} → ` : ""}${a.priceTarget}` : "", positions.includes(sym) ? "position" : "candidate", a.action === "down" && positions.includes(sym)),
          );
        }
        seenAnalyst[sym] = latest > seenAnalyst[sym] ? latest : seenAnalyst[sym];
      }
    }
  });

  // ---------- market-wide ----------
  const dir = spy.changePct >= 0 ? "up" : "down";
  edge(BENCH, `spy:${ny.date}:${dir}`, Math.abs(spy.changePct) >= th.spy, () => mk(BENCH, "market", `S&P 500 ${dir} ${Math.abs(spy.changePct).toFixed(1)}% today`, "Whole-portfolio review", "market", spy.changePct <= -th.spy * 1.5));
  // keep the daily SPY flag for the other direction too
  for (const [k, v] of Object.entries(sc.flags)) if (k.startsWith(`${BENCH}:spy:${ny.date}`) && !(k in flags)) flags[k] = v;

  // keep flags for symbols whose quote failed this round, so a data hiccup doesn't re-fire triggers
  for (const [k, v] of Object.entries(sc.flags)) if (!(k in flags) && !quotes[k.split(":")[0]] && k.split(":")[0] !== BENCH) flags[k] = v;

  // ---------- record + dispatch ----------
  const out: { dispatch: RunOptions | null } = { dispatch: null };
  updateStore((d) => {
    const t = d.aiTrader;
    if (!t) return;
    const s = (t.scanner ??= emptyScanner());
    s.flags = flags;
    s.seenNews = seenNews;
    s.seenAnalyst = seenAnalyst;
    Object.assign(s.lookPrice, newBaselines);
    s.lastScanAt = iso;
    s.universeSize = universe.length;
    if (s.runsToday.date !== ny.date) s.runsToday = { date: ny.date, count: 0 };
    if (s.reviews.date !== ny.date) s.reviews = { date: ny.date, open: false, close: false };

    const cooldown = (cfg.cooldownMinutes ?? 120) * 60_000;
    for (const ev of events) {
      const last = s.lastAiLook[ev.symbol];
      if (!ev.urgent && ev.group !== "market" && last && now - new Date(last).getTime() < cooldown) {
        ev.status = "cooldown";
        ev.outcome = `AI looked ${Math.round((now - new Date(last).getTime()) / 60_000)}m ago — skipped (cooldown)`;
      } else s.pending.push(ev);
      s.log.unshift(ev);
    }
    s.log = s.log.slice(0, 300);

    if (isRunning() || !aiActive()) return;

    // safety-net full reviews
    const openDue = !force && !s.reviews.open && ny.minutes >= 9 * 60 + 45 && ny.minutes < 11 * 60;
    const closeDue = !force && !s.reviews.close && ny.minutes >= 15 * 60 + 30 && ny.minutes < 16 * 60;
    if (openDue || closeDue) {
      if (openDue) s.reviews.open = true;
      else s.reviews.close = true;
      const ids = s.pending.map((e) => e.id);
      const triggeredBy = s.pending.map((e) => `${e.symbol}: ${e.label} — ${e.detail}`);
      s.pending = [];
      out.dispatch = { trigger: openDue ? "open-review" : "close-review", eventIds: ids, triggeredBy: triggeredBy.length ? triggeredBy : undefined, allowQuickSell: false };
      return;
    }

    if (!s.pending.length) return;
    const oldest = Math.min(...s.pending.map((e) => new Date(e.at).getTime()));
    const hasUrgent = s.pending.some((e) => e.urgent);
    if (!force && !hasUrgent && now - oldest < BATCH_WINDOW_MS) return; // keep batching

    let batch = s.pending;
    if (s.runsToday.count >= (cfg.maxRunsPerDay ?? 12)) {
      // budget spent: only protective/urgent triggers still get through
      for (const e of batch.filter((x) => !x.urgent)) {
        const logged = s.log.find((l) => l.id === e.id);
        if (logged) Object.assign(logged, { status: "capped", outcome: "Daily AI-run limit reached" });
      }
      batch = batch.filter((x) => x.urgent);
    }
    if (!batch.length) {
      s.pending = [];
      return;
    }

    // prioritise: urgent → AI's own positions → candidates with the most triggers; overflow stays queued
    const score = (sym: string) => {
      const evs = batch.filter((e) => e.symbol === sym);
      return (evs.some((e) => e.urgent) ? 1000 : 0) + (evs.some((e) => e.group === "position") ? 100 : 0) + evs.length;
    };
    const ranked = [...new Set(batch.filter((e) => e.symbol !== BENCH).map((e) => e.symbol))].sort((a, b) => score(b) - score(a));
    const focus = ranked.slice(0, MAX_FOCUS);
    const later = new Set(ranked.slice(MAX_FOCUS));
    s.pending = batch.filter((e) => later.has(e.symbol));
    batch = batch.filter((e) => !later.has(e.symbol));
    const market = batch.some((e) => e.group === "market");
    out.dispatch = {
      trigger: market ? "market-move" : "event",
      focus: focus.length ? focus : undefined, // market-only → full portfolio review
      triggeredBy: batch.map((e) => `${e.symbol}: ${e.label}${e.detail ? ` — ${e.detail}` : ""}`),
      eventIds: batch.map((e) => e.id),
      allowQuickSell: batch.some((e) => e.urgent && e.group === "position"),
    };
  });

  if (out.dispatch) runTrader(out.dispatch).catch((e) => console.error("[scanner] AI run failed:", (e as Error).message));
}
