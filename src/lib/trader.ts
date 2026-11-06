/* eslint-disable @typescript-eslint/no-explicit-any -- raw Yahoo screener payloads */
import "server-only";
import { arr, enumOf, nullableNum, num, obj, str, structured } from "./llm";
import { getQuotes, yf } from "./market";
import { researchPack } from "./research";
import { readStore, updateStore } from "./store";
import { nyNow } from "./time";
import { aiActive } from "./usage";
import type {
  AppNotification,
  RiskProfile,
  RunTrigger,
  StoreData,
  Trade,
  TraderConfig,
  TraderDecision,
  TraderRun,
  TraderState,
  TraderView,
} from "./types";

const BENCH = "SPY";
const SLIPPAGE = 0.0005; // 0.05% simulated spread/slippage on every fill
const MAX_CANDIDATES = 18;

export const RISK_RULES: Record<RiskProfile, { maxPositionPct: number; cashReservePct: number; maxPositions: number; defaultStopPct: number; style: string }> = {
  conservative: {
    maxPositionPct: 15,
    cashReservePct: 20,
    maxPositions: 10,
    defaultStopPct: 8,
    style: "Capital preservation first. Prefer profitable large caps with reasonable valuations, buy pullbacks in established uptrends, cut losers early, avoid hype and stocks into earnings.",
  },
  balanced: {
    maxPositionPct: 20,
    cashReservePct: 10,
    maxPositions: 8,
    defaultStopPct: 10,
    style: "Balance growth and risk. Quality growth at a reasonable price, add on strength or healthy pullbacks, trim extended winners, respect stops.",
  },
  aggressive: {
    maxPositionPct: 30,
    cashReservePct: 5,
    maxPositions: 6,
    defaultStopPct: 15,
    style: "Maximise return. Concentrate in the highest-conviction momentum and catalyst-driven names, accept volatility, but still exit broken theses.",
  },
};

export const DEFAULT_CONFIG: TraderConfig = {
  risk: "balanced",
  universe: "discover",
  mode: "event",
  sensitivity: "normal",
  maxRunsPerDay: 12,
  cooldownMinutes: 120,
  autoRun: true,
  intervalMinutes: 240,
  webSearch: false,
  minConfidence: 60,
};

// ---------- run lock (in-memory, per server process) ----------
const g = globalThis as unknown as { __traderRun?: { since: string } | null };
export const isRunning = () => Boolean(g.__traderRun);

// ---------- helpers ----------
const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function notify(d: StoreData, symbol: string, title: string, message: string, severity: AppNotification["severity"]) {
  d.notifications.unshift({ id: crypto.randomUUID(), symbol, kind: "ai-trader", title, message, severity, createdAt: new Date().toISOString(), read: false });
  d.notifications = d.notifications.slice(0, 200);
}

function equityOf(t: TraderState, prices: Record<string, number>) {
  return t.cash + Object.values(t.positions).reduce((a, p) => a + p.qty * (prices[p.symbol] ?? p.avgPrice), 0);
}

async function pricesFor(t: TraderState, extra: string[] = []) {
  const quotes = await getQuotes([...Object.keys(t.positions), BENCH, ...extra]);
  const prices: Record<string, number> = {};
  for (const [s, q] of Object.entries(quotes)) prices[s] = q.price;
  return { quotes, prices };
}

function sell(t: TraderState, symbol: string, qty: number, price: number, trigger: Trade["trigger"], reason: string, confidence?: number): Trade | null {
  const p = t.positions[symbol];
  if (!p || qty <= 0) return null;
  qty = Math.min(qty, p.qty);
  const fill = round(price * (1 - SLIPPAGE), 4);
  const value = round(qty * fill, 2);
  const realizedPl = round((fill - p.avgPrice) * qty, 2);
  t.cash = round(t.cash + value, 2);
  p.qty = round(p.qty - qty, 6);
  if (p.qty <= 0.0001) delete t.positions[symbol];
  const trade: Trade = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    symbol,
    side: "SELL",
    qty: round(qty, 4),
    price: fill,
    value,
    trigger,
    confidence,
    reason,
    realizedPl,
    realizedPlPct: round(((fill - p.avgPrice) / p.avgPrice) * 100, 2),
  };
  t.trades.unshift(trade);
  return trade;
}

function buy(t: TraderState, symbol: string, amount: number, price: number, reason: string, confidence: number, stop: number | null, tp: number | null): Trade | null {
  const fill = round(price * (1 + SLIPPAGE), 4);
  const qty = Math.floor((amount / fill) * 10_000) / 10_000; // fractional shares allowed
  if (qty <= 0) return null;
  const value = round(qty * fill, 2);
  t.cash = round(t.cash - value, 2);
  const p = t.positions[symbol];
  const rules = RISK_RULES[t.config.risk];
  if (p) {
    const newQty = p.qty + qty;
    p.avgPrice = round((p.qty * p.avgPrice + qty * fill) / newQty, 4);
    p.qty = round(newQty, 6);
    p.thesis = reason;
  } else {
    t.positions[symbol] = {
      symbol,
      qty: round(qty, 6),
      avgPrice: fill,
      openedAt: new Date().toISOString(),
      stopLoss: null,
      takeProfit: null,
      thesis: reason,
    };
  }
  const pos = t.positions[symbol];
  pos.stopLoss = stop && stop < fill ? round(stop, 2) : pos.stopLoss ?? round(fill * (1 - rules.defaultStopPct / 100), 2);
  if (tp && tp > fill) pos.takeProfit = round(tp, 2);
  const trade: Trade = { id: crypto.randomUUID(), at: new Date().toISOString(), symbol, side: "BUY", qty: round(qty, 4), price: fill, value, trigger: "ai", confidence, reason };
  t.trades.unshift(trade);
  return trade;
}

function snapshot(t: TraderState, prices: Record<string, number>, force = false) {
  const last = t.equityHistory.at(-1);
  if (!force && last && Date.now() - new Date(last.at).getTime() < 30 * 60_000) return;
  const spy = prices[BENCH];
  if (!spy) return;
  t.equityHistory.push({ at: new Date().toISOString(), equity: round(equityOf(t, prices), 2), benchmark: round(t.spyUnits * spy, 2) });
  if (t.equityHistory.length > 3000) t.equityHistory = t.equityHistory.filter((_, i) => i % 2 === 0); // thin out old points
}

// ---------- order execution (shared by live AI runs and queued orders) ----------

const GAP_LIMIT = 0.03; // cancel a queued BUY if the stock opens >3% above the decision price
const ORDER_TTL_MS = 3 * 86_400_000;

function queueOrder(t: TraderState, dec: TraderDecision, price: number | undefined, o: { source: "ai" | "manual"; allowQuickSell: boolean; runId?: string }) {
  t.orders ??= [];
  // one pending order per symbol+side: the newest decision wins
  for (const x of t.orders) if (x.status === "pending" && x.symbol === dec.symbol && x.side === dec.action) Object.assign(x, { status: "cancelled", resolvedAt: new Date().toISOString(), note: "Replaced by a newer decision" });
  t.orders.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    symbol: dec.symbol,
    side: dec.action as "BUY" | "SELL",
    source: o.source,
    decisionPrice: price ?? 0,
    percentOfEquity: dec.percentOfEquity,
    sellFraction: dec.sellFraction,
    confidence: dec.confidence,
    reasoning: dec.reasoning,
    stopLoss: dec.stopLoss,
    takeProfit: dec.takeProfit,
    allowQuickSell: o.allowQuickSell,
    runId: o.runId,
    status: "pending",
  });
}

/** Apply BUY/SELL decisions with the hard risk limits. Sets `dec.executed` on each. */
function executeDecisions(
  d: StoreData,
  t: TraderState,
  decisions: TraderDecision[],
  prices: Record<string, number>,
  ctx: { allowQuickSell: boolean; tradeTrigger?: Trade["trigger"]; skipConfidence?: boolean },
) {
  const rules = RISK_RULES[t.config.risk];
  const eq = () => equityOf(t, prices);
  const trigger = ctx.tradeTrigger ?? "ai";
  const lowConf = (c: number) => !ctx.skipConfidence && c < t.config.minConfidence;

  // sells first to free up cash
  for (const dec of decisions.filter((x) => x.action === "SELL")) {
    const p = t.positions[dec.symbol];
    if (!p) dec.executed = "Skipped — not held";
    else if (!prices[dec.symbol]) dec.executed = "Skipped — no price";
    else if (!ctx.allowQuickSell && Date.now() - new Date(p.openedAt).getTime() < 86_400_000) dec.executed = "Skipped — held < 1 day (anti-churn rule)";
    else if (lowConf(dec.confidence)) dec.executed = `Skipped — confidence ${dec.confidence} < ${t.config.minConfidence}`;
    else {
      const frac = Math.max(0, Math.min(1, dec.sellFraction || 1));
      const tr = sell(t, dec.symbol, frac >= 0.98 ? p.qty : p.qty * frac, prices[dec.symbol], trigger, dec.reasoning, dec.confidence);
      if (tr) {
        dec.executed = `Sold ${tr.qty} @ ${money(tr.price)} · realized ${money(tr.realizedPl ?? 0)}`;
        notify(d, dec.symbol, `AI Trader sold ${dec.symbol}`, `${tr.qty} sh @ ${money(tr.price)} · P/L ${money(tr.realizedPl ?? 0)}. ${dec.reasoning.slice(0, 140)}`, (tr.realizedPl ?? 0) >= 0 ? "good" : "warn");
      }
    }
  }

  // buys by conviction
  for (const dec of decisions.filter((x) => x.action === "BUY").sort((a, b) => b.confidence - a.confidence)) {
    const price = prices[dec.symbol];
    const e = eq();
    const cur = t.positions[dec.symbol];
    const curVal = cur ? cur.qty * price : 0;
    const room = (rules.maxPositionPct / 100) * e - curVal;
    const spendable = t.cash - (rules.cashReservePct / 100) * e;
    const amount = Math.min((Math.max(0, dec.percentOfEquity) / 100) * e, room, spendable);
    if (!price) dec.executed = "Skipped — no price";
    else if (lowConf(dec.confidence)) dec.executed = `Skipped — confidence ${dec.confidence} < ${t.config.minConfidence}`;
    else if (!cur && Object.keys(t.positions).length >= rules.maxPositions) dec.executed = `Skipped — already at ${rules.maxPositions} positions`;
    else if (amount < Math.max(20, e * 0.01)) dec.executed = room <= 0 ? "Skipped — position size limit reached" : "Skipped — not enough free cash (reserve kept)";
    else {
      const tr = buy(t, dec.symbol, amount, price, dec.reasoning, dec.confidence, dec.stopLoss, dec.takeProfit);
      if (tr) {
        dec.executed = `Bought ${tr.qty} @ ${money(tr.price)} (${money(tr.value)})`;
        notify(d, dec.symbol, `AI Trader bought ${dec.symbol}`, `${tr.qty} sh @ ${money(tr.price)} (${money(tr.value)}), confidence ${dec.confidence}. ${dec.reasoning.slice(0, 140)}`, "info");
      }
    }
  }
}

/** Fill queued orders once each stock's market is open (a few minutes after the bell, with gap protection). */
export async function processPendingOrders() {
  const t0 = readStore().aiTrader;
  const pending = t0?.orders?.filter((o) => o.status === "pending") ?? [];
  if (!t0 || t0.config.paused || !pending.length || isRunning()) return;
  const quotes = await getQuotes([...new Set([...pending.map((o) => o.symbol), ...Object.keys(t0.positions), BENCH])]);
  const prices: Record<string, number> = {};
  for (const [s, q] of Object.entries(quotes)) prices[s] = q.price;
  const afterOpenSettle = nyNow().minutes >= 9 * 60 + 35; // skip the opening-auction spike

  updateStore((d) => {
    const t = d.aiTrader;
    if (!t?.orders) return;
    const now = Date.now();
    for (const o of t.orders.filter((x) => x.status === "pending")) {
      const q = quotes[o.symbol];
      const resolve = (status: "filled" | "cancelled" | "expired", note: string) => Object.assign(o, { status, note, resolvedAt: new Date().toISOString() });
      if (now - new Date(o.createdAt).getTime() > ORDER_TTL_MS) {
        resolve("expired", "Not filled within 3 days");
        continue;
      }
      if (!q || q.marketState !== "REGULAR" || !afterOpenSettle) continue; // still closed — keep waiting
      if (o.side === "BUY" && o.decisionPrice && q.price > o.decisionPrice * (1 + GAP_LIMIT)) {
        const gap = ((q.price / o.decisionPrice - 1) * 100).toFixed(1);
        resolve("cancelled", `Opened ${gap}% above the decision price ${money(o.decisionPrice)} — not chasing`);
        notify(d, o.symbol, `AI Trader cancelled queued buy of ${o.symbol}`, o.note!, "info");
        continue;
      }
      const dec: TraderDecision = {
        symbol: o.symbol,
        action: o.side,
        percentOfEquity: o.percentOfEquity,
        sellFraction: o.sellFraction,
        confidence: o.confidence,
        reasoning: o.source === "manual" ? o.reasoning : `[Queued ${new Date(o.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET] ${o.reasoning}`,
        stopLoss: o.stopLoss,
        takeProfit: o.takeProfit,
      };
      executeDecisions(d, t, [dec], prices, { allowQuickSell: o.allowQuickSell, tradeTrigger: o.source === "manual" ? "manual" : "ai", skipConfidence: o.source === "manual" });
      const ok = /^(Bought|Sold)/.test(dec.executed ?? "");
      resolve(ok ? "filled" : "cancelled", dec.executed ?? "Not executed");
    }
    // keep pending + the last 2 weeks of history
    t.orders = t.orders.filter((o) => o.status === "pending" || now - new Date(o.resolvedAt ?? o.createdAt).getTime() < 14 * 86_400_000).slice(0, 200);
    snapshot(t, prices);
  });
}

// ---------- account management ----------

export async function startTrader(amount: number, config: Partial<TraderConfig>) {
  if (!(amount >= 100)) throw new Error("Start with at least $100");
  const spy = (await getQuotes([BENCH]))[BENCH]?.price;
  if (!spy) throw new Error("Could not fetch SPY price for the benchmark");
  const state: TraderState = {
    config: { ...DEFAULT_CONFIG, ...config },
    startedAt: new Date().toISOString(),
    deposited: amount,
    cash: amount,
    spyUnits: amount / spy,
    positions: {},
    trades: [],
    runs: [],
    equityHistory: [{ at: new Date().toISOString(), equity: amount, benchmark: amount }],
  };
  updateStore((d) => {
    d.aiTrader = state;
  });
}

export async function deposit(amount: number) {
  if (!(amount > 0)) throw new Error("Amount must be positive");
  if (isRunning()) throw new Error("AI is trading right now — try again in a minute");
  const spy = (await getQuotes([BENCH]))[BENCH]?.price;
  if (!spy) throw new Error("Could not fetch SPY price");
  updateStore((d) => {
    if (!d.aiTrader) throw new Error("AI Trader not started");
    d.aiTrader.cash = round(d.aiTrader.cash + amount, 2);
    d.aiTrader.deposited = round(d.aiTrader.deposited + amount, 2);
    d.aiTrader.spyUnits += amount / spy; // benchmark gets the same deposit at the same time
  });
}

export function updateConfig(config: Partial<TraderConfig>) {
  updateStore((d) => {
    if (!d.aiTrader) throw new Error("AI Trader not started");
    d.aiTrader.config = { ...d.aiTrader.config, ...config };
  });
}

export function resetTrader() {
  if (isRunning()) throw new Error("AI is trading right now — try again in a minute");
  updateStore((d) => {
    delete d.aiTrader;
  });
}

export async function manualClose(symbol: string) {
  if (isRunning()) throw new Error("AI is trading right now — try again in a minute");
  const t0 = readStore().aiTrader;
  if (!t0?.positions[symbol]) throw new Error("No such position");
  const { quotes, prices } = await pricesFor(t0);
  const open = quotes[symbol]?.marketState === "REGULAR";
  updateStore((d) => {
    const t = d.aiTrader!;
    const p = t.positions[symbol];
    if (!p) return;
    if (open && prices[symbol]) sell(t, symbol, p.qty, prices[symbol], "manual", "Closed manually by you");
    else
      queueOrder(t, { symbol, action: "SELL", percentOfEquity: 0, sellFraction: 1, confidence: 100, reasoning: "Closed manually by you", stopLoss: null, takeProfit: null }, prices[symbol], { source: "manual", allowQuickSell: true });
    snapshot(t, prices, true);
  });
  return open ? "closed" : "queued";
}

export function cancelOrder(id: string) {
  updateStore((d) => {
    const o = d.aiTrader?.orders?.find((x) => x.id === id && x.status === "pending");
    if (o) Object.assign(o, { status: "cancelled", resolvedAt: new Date().toISOString(), note: "Cancelled by you" });
  });
}

// ---------- view ----------

export async function getTraderView(): Promise<TraderView | null> {
  const t = readStore().aiTrader;
  if (!t) return null;
  const { quotes, prices } = await pricesFor(t).catch(() => ({ quotes: {} as Awaited<ReturnType<typeof getQuotes>>, prices: {} as Record<string, number> }));
  const equity = equityOf(t, prices);
  const positions = Object.values(t.positions).map((p) => {
    const price = prices[p.symbol] ?? p.avgPrice;
    const value = p.qty * price;
    return {
      ...p,
      name: quotes[p.symbol]?.name ?? p.symbol,
      price,
      changePct: quotes[p.symbol]?.changePct ?? 0,
      ext: quotes[p.symbol]?.ext,
      value,
      pl: (price - p.avgPrice) * p.qty,
      plPct: ((price - p.avgPrice) / p.avgPrice) * 100,
      weight: equity ? (value / equity) * 100 : 0,
    };
  });
  const sells = t.trades.filter((x) => x.side === "SELL" && x.realizedPl !== undefined);
  const benchmarkValue = prices[BENCH] ? t.spyUnits * prices[BENCH] : t.deposited;

  let peak = 0;
  let maxDd = 0;
  for (const pt of [...t.equityHistory, { equity }]) {
    peak = Math.max(peak, pt.equity);
    if (peak) maxDd = Math.max(maxDd, ((peak - pt.equity) / peak) * 100);
  }

  return {
    state: { ...t, scanner: undefined, orders: undefined, trades: t.trades.slice(0, 200), runs: t.runs.slice(0, 30) },
    orders: [...(t.orders ?? []).filter((o) => o.status === "pending"), ...(t.orders ?? []).filter((o) => o.status !== "pending").slice(0, 20)],
    running: isRunning(),
    runningSince: g.__traderRun?.since,
    positions: positions.sort((a, b) => b.value - a.value),
    equity,
    invested: equity - t.cash,
    totalReturn: equity - t.deposited,
    totalReturnPct: ((equity - t.deposited) / t.deposited) * 100,
    benchmarkValue,
    benchmarkReturnPct: ((benchmarkValue - t.deposited) / t.deposited) * 100,
    realizedPl: sells.reduce((a, x) => a + (x.realizedPl ?? 0), 0),
    winRate: sells.length ? (sells.filter((x) => (x.realizedPl ?? 0) > 0).length / sells.length) * 100 : null,
    closedTrades: sells.length,
    maxDrawdownPct: maxDd,
    marketState: quotes[BENCH]?.marketState,
    nextRunAt:
      modeOf(t.config) === "scheduled" && t.config.autoRun
        ? new Date(new Date(t.lastRunAt ?? t.startedAt).getTime() + t.config.intervalMinutes * 60_000).toISOString()
        : undefined,
    scanner: {
      mode: modeOf(t.config),
      sensitivity: t.config.sensitivity ?? "normal",
      maxRunsPerDay: t.config.maxRunsPerDay ?? 12,
      cooldownMinutes: t.config.cooldownMinutes ?? 120,
      runsToday: t.scanner?.runsToday.date === nyNow().date ? t.scanner.runsToday.count : 0,
      lastScanAt: t.scanner?.lastScanAt,
      universeSize: t.scanner?.universeSize,
      pending: t.scanner?.pending.length ?? 0,
      log: (t.scanner?.log ?? []).slice(0, 150),
    },
  };
}

// ---------- the AI decision loop ----------

/** Screener ideas. `perScreener` small for AI prompts (cost), large for the free scanner. */
export async function discover(perScreener = 4, wide = false): Promise<string[]> {
  const out: string[] = [];
  const screeners = ["undervalued_growth_stocks", "growth_technology_stocks", "most_actives", "day_losers", ...(wide ? ["day_gainers", "undervalued_large_caps"] : [])];
  for (const scrIds of screeners) {
    try {
      const r = (await yf.screener({ scrIds: scrIds as any, count: Math.max(15, perScreener * 2) }, undefined, { validateResult: false })) as any;
      const picks = ((r.quotes ?? []) as any[])
        .filter((q) => q.quoteType === "EQUITY" && !String(q.symbol).includes(".") && q.regularMarketPrice > 5 && (q.marketCap ?? 0) > 2e9)
        .slice(0, perScreener)
        .map((q) => q.symbol as string);
      out.push(...picks);
    } catch (e) {
      console.warn("[trader] screener", scrIds, (e as Error).message);
    }
  }
  return out;
}

const DECISION_SCHEMA = obj({
  marketView: str("3–4 sentences: your read of the market backdrop and how you are positioning this round"),
  decisions: arr(
    obj({
      symbol: str(),
      action: enumOf(["BUY", "SELL", "HOLD"]),
      percentOfEquity: num("For BUY: dollars to spend now as % of total equity (e.g. 8). 0 otherwise."),
      sellFraction: num("For SELL: fraction of the position to sell, 0–1 (1 = close). 0 otherwise."),
      confidence: num("0–100"),
      reasoning: str("2–4 sentences citing specific data: price/trend, valuation, news, analysts"),
      stopLoss: nullableNum("Protective stop price for this position (BUY/HOLD of owned). null if not applicable."),
      takeProfit: nullableNum("Price at which to take profit. null if none."),
    }),
    "One entry per candidate you have an opinion on; always include every currently held position.",
  ),
});

export interface RunOptions {
  trigger: RunTrigger;
  /** event-driven runs: only these symbols (+ held positions) are evaluated */
  focus?: string[];
  /** human-readable reasons the scanner woke the AI */
  triggeredBy?: string[];
  /** scanner event ids this run answers */
  eventIds?: string[];
  /** allow selling positions bought < 24h ago (only for urgent/protective triggers) */
  allowQuickSell?: boolean;
}

export const modeOf = (c: TraderConfig) => c.mode ?? "event";

export async function runTrader(opts: RunOptions): Promise<void> {
  if (isRunning()) throw new Error("A run is already in progress");
  const t0 = readStore().aiTrader;
  if (!t0) throw new Error("AI Trader not started");
  g.__traderRun = { since: new Date().toISOString() };
  const manual = opts.trigger === "manual";

  const run: TraderRun = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    model: "",
    marketView: "",
    candidates: [],
    decisions: [],
    manual,
    trigger: opts.trigger,
    triggeredBy: opts.triggeredBy,
  };
  try {
    const store = readStore();
    const held = Object.keys(t0.positions);
    let candidates: string[];
    if (opts.focus?.length) {
      // targeted run: just what the scanner flagged, plus current positions for context
      candidates = [...new Set([...opts.focus, ...held])].filter((s) => s !== BENCH);
    } else {
      let pool = [...held, ...store.watchlist.map((w) => w.symbol), ...store.holdings.map((h) => h.symbol)];
      if (t0.config.universe === "discover") pool.push(...(await discover()));
      pool = [...new Set(pool)].filter((s) => s !== BENCH);
      candidates = [...held, ...pool.filter((s) => !held.includes(s))].slice(0, Math.max(MAX_CANDIDATES, held.length));
    }
    run.candidates = candidates;

    const packs: Record<string, unknown>[] = [];
    const prices: Record<string, number> = {};
    const openNow: Record<string, boolean> = {};
    // research with modest parallelism (yahoo-finance2 also queues internally)
    for (let i = 0; i < candidates.length; i += 6) {
      const batch = await Promise.all(
        candidates.slice(i, i + 6).map((s) =>
          researchPack(s)
            .then((r) => {
              prices[s] = r.quote.price;
              openNow[s] = r.quote.marketState === "REGULAR";
              const p = r.pack;
              return {
                ...p,
                technicals: p.technicals && { ...p.technicals, last30Closes: p.technicals.last30Closes.slice(-10) },
                news: p.news?.slice(0, 5),
                significantDevelopments: p.significantDevelopments?.slice(0, 2),
                analysts: { ...p.analysts, recentActions: p.analysts.recentActions?.slice(0, 3) },
              };
            })
            .catch(() => null),
        ),
      );
      packs.push(...(batch.filter(Boolean) as Record<string, unknown>[]));
    }
    const spy = (await getQuotes([BENCH]))[BENCH];
    if (spy) prices[BENCH] = spy.price;

    const rules = RISK_RULES[t0.config.risk];
    const equity = equityOf(t0, prices);
    const portfolio = {
      cash: round(t0.cash, 2),
      equity: round(equity, 2),
      deposited: t0.deposited,
      returnPct: round(((equity - t0.deposited) / t0.deposited) * 100, 2),
      positions: Object.values(t0.positions).map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        avgCost: p.avgPrice,
        price: prices[p.symbol],
        plPct: prices[p.symbol] ? round(((prices[p.symbol] - p.avgPrice) / p.avgPrice) * 100, 2) : null,
        weightPct: prices[p.symbol] ? round(((p.qty * prices[p.symbol]) / equity) * 100, 1) : null,
        heldSince: p.openedAt.slice(0, 10),
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        originalThesis: p.thesis,
      })),
      recentTrades: t0.trades.slice(0, 10).map((x) => `${x.at.slice(0, 10)} ${x.side} ${x.qty} ${x.symbol} @ ${x.price} (${x.trigger})`),
      lastMarketView: t0.runs[0]?.marketView,
    };

    const { data, model, usedWebSearch } = await structured<{ marketView: string; decisions: TraderDecision[] }>({
      name: "trading_decisions",
      feature: "trader",
      schema: DECISION_SCHEMA,
      webSearch: t0.config.webSearch,
      instructions: [
        "You are an autonomous portfolio manager running a PAPER-TRADING account (US stocks, long-only, no options/shorting/leverage).",
        "Your goal is to beat the S&P 500 (SPY) on a risk-adjusted basis over months, so the user can judge whether AI-driven decisions are trustworthy.",
        `Today is ${new Date().toISOString().slice(0, 10)}. SPY is ${spy?.price} (${spy?.changePct?.toFixed(2)}% today).`,
        `Risk profile: ${t0.config.risk.toUpperCase()} — ${rules.style}`,
        `Hard limits enforced by code (plan within them): max ${rules.maxPositionPct}% of equity per position, keep ≥${rules.cashReservePct}% cash, max ${rules.maxPositions} positions, trades below ${t0.config.minConfidence} confidence are ignored.`,
        "Process: (1) review every held position — is the original thesis intact? sell or trim if broken, extended, or a clearly better use of capital exists; tighten stops on winners. (2) evaluate candidates and buy only the best risk/reward setups. Doing nothing is valid.",
        "Avoid over-trading: don't churn positions bought in the last few days without a real reason. Size by conviction.",
        "Weigh trend/momentum, valuation vs growth, analyst actions, third-party technical outlook, and news sentiment. Cite numbers in your reasoning.",
        usedWebSearchHint(t0.config.webSearch),
        opts.triggeredBy?.length
          ? `You were woken up by the market scanner because:\n- ${opts.triggeredBy.join("\n- ")}\nFocus on these situations and decide whether they are real opportunities/risks or noise. Other held positions are included for context only — act on them only if clearly warranted.`
          : opts.trigger === "open-review"
            ? "This is the post-open review (9:45am ET): reassess the whole book after the opening volatility."
            : opts.trigger === "close-review"
              ? "This is the pre-close review (3:30pm ET): decide what you are comfortable holding overnight."
              : "",
        "Positions bought less than 1 day ago cannot be sold by you unless a stop-loss is threatened (anti-churn rule).",
        Object.values(openNow).some(Boolean)
          ? ""
          : "THE MARKET IS CURRENTLY CLOSED. Prices shown are the last regular-session close. Any BUY/SELL you make becomes an order queued for the next regular open (a few minutes after the bell); queued BUYs are cancelled automatically if the stock opens >3% above the current price. Only place orders you would still want at the next open.",
        "Use only symbols from the candidate list.",
      ].join("\n"),
      input: JSON.stringify({ portfolio, candidates: packs }),
    });
    run.model = model;
    run.marketView = data.marketView + (t0.config.webSearch && !usedWebSearch ? " (web search unavailable this run)" : "");

    // ---- execute with guardrails, against FRESH state ----
    updateStore((d) => {
      const t = d.aiTrader;
      if (!t) throw new Error("AI Trader was reset during the run");
      const decisions = data.decisions.filter((x) => candidates.includes(x.symbol));
      const quickSell = Boolean(opts.allowQuickSell) || manual;

      // only trade stocks whose own market is in its regular session — queue the rest for the next open
      for (const dec of decisions.filter((x) => x.action !== "HOLD" && !openNow[x.symbol])) {
        if (dec.confidence < t.config.minConfidence) {
          dec.executed = `Skipped — confidence ${dec.confidence} < ${t.config.minConfidence}`;
          continue;
        }
        if (dec.action === "SELL" && !t.positions[dec.symbol]) {
          dec.executed = "Skipped — not held";
          continue;
        }
        queueOrder(t, dec, prices[dec.symbol], { source: "ai", allowQuickSell: quickSell, runId: run.id });
        dec.executed = `Queued — market closed; will ${dec.action === "BUY" ? "buy" : "sell"} at the next open`;
      }
      executeDecisions(d, t, decisions.filter((x) => x.action !== "HOLD" && openNow[x.symbol]), prices, { allowQuickSell: quickSell });


      // holds: accept updated (tighter or sensible) protective levels
      for (const dec of decisions.filter((x) => x.action === "HOLD")) {
        const p = t.positions[dec.symbol];
        const price = prices[dec.symbol];
        if (!p || !price) {
          dec.executed = p ? "Held" : "Watching";
          continue;
        }
        const changes: string[] = [];
        if (dec.stopLoss && dec.stopLoss < price && dec.stopLoss !== p.stopLoss) {
          p.stopLoss = round(dec.stopLoss, 2);
          changes.push(`stop → ${money(p.stopLoss)}`);
        }
        if (dec.takeProfit && dec.takeProfit > price && dec.takeProfit !== p.takeProfit) {
          p.takeProfit = round(dec.takeProfit, 2);
          changes.push(`target → ${money(p.takeProfit)}`);
        }
        dec.executed = changes.length ? `Held · ${changes.join(", ")}` : "Held";
      }

      run.decisions = decisions;
      t.lastRunAt = run.at;

      // scanner bookkeeping: new baselines, outcomes for the events that woke us, daily budget
      if (t.scanner) {
        const sc = t.scanner;
        for (const s of candidates) {
          if (!prices[s]) continue;
          sc.lookPrice[s] = prices[s];
          sc.lastAiLook[s] = run.at;
        }
        const ids = new Set(opts.eventIds ?? []);
        for (const ev of sc.log) {
          if (!ids.has(ev.id)) continue;
          const dec = decisions.find((x) => x.symbol === ev.symbol);
          ev.status = "sent";
          ev.runId = run.id;
          ev.outcome = ev.symbol === BENCH ? "Portfolio reviewed" : dec ? `${dec.action} · ${dec.executed ?? ""}`.trim() : "No action";
        }
        if (!manual) {
          const today = nyNow().date;
          if (sc.runsToday.date !== today) sc.runsToday = { date: today, count: 0 };
          sc.runsToday.count++;
        }
      }

      snapshot(t, prices, true);
      run.equityAfter = round(equityOf(t, prices), 2);
      t.runs.unshift(run);
      t.runs = t.runs.slice(0, 60);
      t.trades = t.trades.slice(0, 1000);
    });
  } catch (e) {
    run.error = (e as Error).message;
    console.error("[trader] run failed:", run.error);
    updateStore((d) => {
      if (!d.aiTrader) return;
      d.aiTrader.lastRunAt = run.at; // don't hammer the API on repeated failures
      d.aiTrader.runs.unshift(run);
      const ids = new Set(opts.eventIds ?? []);
      for (const ev of d.aiTrader.scanner?.log ?? []) if (ids.has(ev.id)) Object.assign(ev, { status: "sent", runId: run.id, outcome: "AI run failed" });
      notify(d, "AI", "AI Trader run failed", run.error!, "bad");
    });
  } finally {
    g.__traderRun = null;
  }
}

function usedWebSearchHint(on: boolean) {
  return on
    ? "Before deciding, search the web for market-moving news from the last few days on the held positions and the most promising candidates."
    : "Base news sentiment on the headlines provided.";
}

// ---------- background tick: stops/targets, equity snapshots, scheduled runs ----------

export async function traderTick() {
  await processPendingOrders().catch((e) => console.warn("[trader] pending orders:", (e as Error).message));
  const t0 = readStore().aiTrader;
  if (!t0 || isRunning()) return;
  const { quotes, prices } = await pricesFor(t0);
  const open = quotes[BENCH]?.marketState === "REGULAR";

  updateStore((d) => {
    const t = d.aiTrader;
    if (!t) return;
    {
      for (const p of Object.values({ ...t.positions })) {
        const price = prices[p.symbol];
        // protective exits only fill while that stock's own market is in its regular session
        if (!price || quotes[p.symbol]?.marketState !== "REGULAR") continue;
        if (p.stopLoss && price <= p.stopLoss) {
          const tr = sell(t, p.symbol, p.qty, price, "stop", `Stop-loss ${money(p.stopLoss)} hit`);
          if (tr) notify(d, p.symbol, `AI Trader stopped out of ${p.symbol}`, `Sold ${tr.qty} @ ${money(tr.price)} · P/L ${money(tr.realizedPl ?? 0)}`, "warn");
        } else if (p.takeProfit && price >= p.takeProfit) {
          const tr = sell(t, p.symbol, p.qty, price, "target", `Take-profit ${money(p.takeProfit)} reached`);
          if (tr) notify(d, p.symbol, `AI Trader took profit on ${p.symbol}`, `Sold ${tr.qty} @ ${money(tr.price)} · P/L ${money(tr.realizedPl ?? 0)}`, "good");
        }
      }
    }
    snapshot(t, prices);
  });

  // scheduled mode only — event mode is driven by the scanner (scanner.ts)
  const due = new Date(t0.lastRunAt ?? t0.startedAt).getTime() + t0.config.intervalMinutes * 60_000 <= Date.now();
  if (!t0.config.paused && aiActive() && modeOf(t0.config) === "scheduled" && t0.config.autoRun && open && (due || !t0.lastRunAt)) {
    runTrader({ trigger: "scheduled" }).catch((e) => console.error("[trader] scheduled run", e));
  }
}
