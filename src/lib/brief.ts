import "server-only";
import { curateWatchlist } from "./curator";
import { buildDashboard } from "./dashboard";
import { arr, nullableStr, num, obj, str, structured } from "./llm";
import { getQuotes } from "./market";
import { readStore, updateStore } from "./store";
import { nyNow } from "./time";
import { aiActive, assertAiAllowed } from "./usage";
import { getTraderView } from "./trader";
import type { MorningBrief } from "./types";

export { nyNow };

const SCHEMA = obj({
  headline: str("One sentence: the single most important thing for this investor today"),
  marketBackdrop: str("2–3 sentences on what's moving markets today and why it matters for THEIR holdings"),
  portfolioPulse: str("2 sentences: how their portfolio is positioned / doing"),
  topActions: arr(
    obj({ priority: num("1 = most important"), symbol: nullableStr("ticker or null for portfolio-level actions"), action: str("Imperative, specific, e.g. 'Trim 2 of your 6 NVDA shares above $195'"), why: str("1 sentence with numbers") }),
    "Exactly 3 actions, most important first. Include 'do nothing / be patient' if that's genuinely best.",
  ),
  watchToday: arr(obj({ symbol: str(), why: str() }), "2–4 stocks to keep an eye on today"),
  earningsWatch: arr(obj({ symbol: str(), date: str(), note: str("what to expect / how to prepare") }), "Their stocks reporting in the next ~10 days; empty if none"),
  risks: arr(str(), "2–3 risks to their portfolio right now"),
  mindsetTip: str("One short coaching tip about investor psychology tied to today's situation"),
});

type Out = Omit<MorningBrief, "date" | "createdAt" | "model" | "usedWebSearch" | "sources" | "watchlistChanges">;

export function latestBrief(): MorningBrief | null {
  return readStore().briefs[0] ?? null;
}

let generating: Promise<MorningBrief> | null = null;
export const briefInProgress = () => Boolean(generating);

export function generateBrief(): Promise<MorningBrief> {
  generating ??= doGenerate().finally(() => (generating = null));
  return generating;
}

async function doGenerate(): Promise<MorningBrief> {
  assertAiAllowed();
  const { date } = nyNow();

  // 1) let the AI refresh its watchlist picks first so the brief can mention them
  let watchlistChanges: string[] = [];
  try {
    watchlistChanges = await curateWatchlist();
  } catch (e) {
    console.warn("[brief] watchlist curation failed:", (e as Error).message);
  }

  // 2) gather everything
  const [dash, trader, spy] = await Promise.all([buildDashboard(), getTraderView().catch(() => null), getQuotes(["SPY", "QQQ"]).catch(() => ({}))]);
  const store = readStore();
  const r = (n?: number | null, dp = 1) => (n === undefined || n === null ? undefined : +n.toFixed(dp));

  const context = {
    date,
    indexes: Object.values(spy).map((q) => ({ symbol: q.symbol, price: q.price, dayChangePct: r(q.changePct, 2) })),
    portfolio: {
      value: r(dash.summary.totalValue, 0),
      totalPlPct: r(dash.summary.totalPlPct),
      dayPlPct: r(dash.summary.dayPlPct, 2),
      holdings: dash.holdings.map((h) => ({
        symbol: h.symbol,
        shares: h.qty,
        avgCost: h.avgPrice,
        price: h.quote?.price,
        weightPct: r(h.weight),
        plPct: r(h.plPct),
        dayChangePct: r(h.quote?.changePct, 2),
        ruleSuggestion: h.action,
        suggestionReason: h.actionReason,
        buyScore: h.analysis?.score,
        rsi: r(h.tech?.rsi14, 0),
        stopLoss: h.stopLoss,
        takeProfit: h.takeProfit,
        sector: h.fund?.sector,
      })),
    },
    health: dash.health && { score: dash.health.score, grade: dash.health.grade, issues: dash.health.issues.map((i) => i.text) },
    watchlist: dash.watchlist.map((w) => ({
      symbol: w.symbol,
      price: w.quote?.price,
      dayChangePct: r(w.quote?.changePct, 2),
      buyScore: w.analysis?.score,
      verdict: w.analysis?.verdict,
      targetPrice: w.targetPrice,
      pctFromTarget: r(w.distanceToTargetPct),
      addedBy: w.addedBy ?? "user",
    })),
    upcomingEarnings: dash.earnings.map((e) => ({ symbol: e.symbol, date: e.date.slice(0, 10), owned: e.owned, epsEstimate: e.epsEstimate })),
    aiTrader: trader && {
      returnPct: r(trader.totalReturnPct, 2),
      sp500ReturnPct: r(trader.benchmarkReturnPct, 2),
      positions: trader.positions.map((p) => p.symbol),
      lastMarketView: trader.state.runs[0]?.marketView,
    },
    watchlistChangesThisMorning: watchlistChanges,
    recentJournal: store.journal.slice(0, 5).map((e) => ({ date: e.createdAt.slice(0, 10), symbol: e.symbol, action: e.action, reasoning: e.reasoning, emotion: e.emotion })),
  };

  const { data, model, usedWebSearch, sources } = await structured<Out>({
    name: "morning_brief",
    feature: "brief",
    schema: SCHEMA,
    webSearch: store.settings.webSearch,
    instructions: [
      "You write a beginner US investor's pre-market morning brief. It must take under 60 seconds to read and make their day's decisions faster.",
      store.settings.webSearch
        ? `Today is ${date}. First search the web for today's market-moving news (futures, macro data, Fed, big earnings) and any news on their largest holdings.`
        : `Today is ${date}. Web search is off: base the market backdrop on the index moves and headlines in the data; don't claim specific news you weren't given.`,
      "Be concrete: reference their actual positions, share counts, prices and weights. No generic advice.",
      "Prioritise ruthlessly — the 3 top actions should be the ones that matter most for their money (risk first: stops hit, earnings, over-concentration; then opportunities: watchlist names in buy zones).",
      "Never invent numbers that aren't in the data or your search results.",
    ].join("\n"),
    input: JSON.stringify(context),
  });

  const brief: MorningBrief = {
    ...data,
    topActions: [...data.topActions].sort((a, b) => a.priority - b.priority).slice(0, 3),
    date,
    createdAt: new Date().toISOString(),
    model,
    usedWebSearch,
    sources: sources.slice(0, 8),
    watchlistChanges,
  };
  updateStore((d) => {
    d.briefs = [brief, ...d.briefs.filter((b) => b.date !== date)].slice(0, 14);
    d.notifications.unshift({
      id: crypto.randomUUID(),
      symbol: "BRIEF",
      kind: "brief",
      title: "Your morning brief is ready",
      message: brief.headline,
      severity: "info",
      createdAt: new Date().toISOString(),
      read: false,
    });
  });
  return brief;
}

/** Called from the background loop: weekdays after 8:30am New York time, once per day. */
export async function briefTick() {
  const s = readStore();
  if (!s.settings.autoBrief || !aiActive() || briefInProgress()) return;
  const { date, hour, minute, weekday } = nyNow();
  if (weekday === "Sat" || weekday === "Sun") return;
  if (hour * 60 + minute < 8 * 60 + 30) return;
  if (s.briefs[0]?.date === date) return;
  if (!s.holdings.length && !s.watchlist.length) return;
  // don't retry a failing generation more than every 30 minutes
  const g = globalThis as unknown as { __briefAttempt?: number };
  if (g.__briefAttempt && Date.now() - g.__briefAttempt < 30 * 60_000) return;
  g.__briefAttempt = Date.now();
  await generateBrief();
}
