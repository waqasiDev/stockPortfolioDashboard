import "server-only";
import { analyzeBuy, holdingAction } from "./analysis";
import { computeHealth } from "./health";
import { getEarningsEstimates, getFundamentals, getQuotes, getTechnicals } from "./market";
import { readStore, updateStore } from "./store";
import type {
  AppNotification,
  DashboardData,
  EarningsEvent,
  EnrichedHolding,
  EnrichedWatch,
  Fundamentals,
  PortfolioSummary,
  Severity,
  StoreData,
  Technicals,
} from "./types";

async function safe<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    console.warn("[market]", (e as Error).message);
    return undefined;
  }
}

export async function buildDashboard(force = false): Promise<DashboardData> {
  const store = readStore();
  const symbols = [...store.watchlist.map((w) => w.symbol), ...store.holdings.map((h) => h.symbol)];
  const quotes = (await safe(getQuotes(symbols, force))) ?? {};

  const uniq = [...new Set(symbols)];
  const techs: Record<string, Technicals | undefined> = {};
  const funds: Record<string, Fundamentals | undefined> = {};
  await Promise.all(
    uniq.map(async (s) => {
      [techs[s], funds[s]] = await Promise.all([
        safe(getTechnicals(s, quotes[s]?.price)),
        safe(getFundamentals(s)),
      ]);
    }),
  );

  const watchlist: EnrichedWatch[] = store.watchlist.map((w) => {
    const quote = quotes[w.symbol];
    if (!quote) return { ...w, error: "No quote data" };
    const tech = techs[w.symbol];
    const fund = funds[w.symbol];
    return {
      ...w,
      quote,
      tech,
      fund,
      analysis: analyzeBuy(quote, tech, fund, w.targetPrice),
      distanceToTargetPct: w.targetPrice ? ((quote.price - w.targetPrice) / w.targetPrice) * 100 : null,
    };
  });

  let holdings: EnrichedHolding[] = store.holdings.map((h) => {
    const quote = quotes[h.symbol];
    const cost = h.qty * h.avgPrice;
    if (!quote) return { ...h, cost, value: cost, pl: 0, plPct: 0, dayPl: 0, weight: 0, error: "No quote data" };
    const tech = techs[h.symbol];
    const fund = funds[h.symbol];
    const analysis = analyzeBuy(quote, tech, fund);
    const { action, reason } = holdingAction(h, quote, tech, analysis);
    const value = h.qty * quote.price;
    return {
      ...h,
      quote,
      tech,
      fund,
      analysis,
      action,
      actionReason: reason,
      cost,
      value,
      pl: value - cost,
      plPct: cost ? ((value - cost) / cost) * 100 : 0,
      dayPl: h.qty * quote.change,
      weight: 0,
    };
  });

  const totalValue = holdings.reduce((a, h) => a + h.value, 0);
  holdings = holdings.map((h) => {
    const weight = totalValue ? (h.value / totalValue) * 100 : 0;
    // never suggest adding to a position that's already oversized
    if (h.action === "Add More" && weight > 20)
      return { ...h, weight, action: "Hold" as const, actionReason: `Signals look attractive, but it's already ${weight.toFixed(0)}% of your portfolio — don't add more; let other positions catch up.` };
    return { ...h, weight };
  });
  const totalCost = holdings.reduce((a, h) => a + h.cost, 0);
  const dayPl = holdings.reduce((a, h) => a + h.dayPl, 0);
  const summary: PortfolioSummary = {
    totalValue,
    totalCost,
    totalPl: totalValue - totalCost,
    totalPlPct: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    dayPl,
    dayPlPct: totalValue - dayPl ? (dayPl / (totalValue - dayPl)) * 100 : 0,
    winners: holdings.filter((h) => h.pl > 0).length,
    losers: holdings.filter((h) => h.pl < 0).length,
  };
  const withExt = holdings.filter((h) => h.quote?.ext);
  if (withExt.length) {
    const extPl = withExt.reduce((a, h) => a + h.qty * h.quote!.ext!.change, 0);
    summary.ext = { session: withExt[0].quote!.ext!.session, pl: extPl, plPct: totalValue ? (extPl / totalValue) * 100 : 0, value: totalValue + extPl };
  }

  const earnings = await upcomingEarnings(quotes, holdings);

  const unread = updateStore((d) => {
    runAlerts(d, watchlist, holdings, earnings);
    return d.notifications.filter((n) => !n.read).length;
  });

  return {
    watchlist,
    holdings,
    summary,
    unread,
    updatedAt: new Date().toISOString(),
    marketState: Object.values(quotes)[0]?.marketState,
    health: computeHealth(holdings),
    earnings,
  };
}

const DAY = 86_400_000;

async function upcomingEarnings(quotes: Awaited<ReturnType<typeof getQuotes>>, holdings: EnrichedHolding[]): Promise<EarningsEvent[]> {
  const now = Date.now();
  const events: EarningsEvent[] = Object.values(quotes)
    .filter((q) => q.earningsDate && new Date(q.earningsDate).getTime() > now - DAY / 2 && new Date(q.earningsDate).getTime() < now + 21 * DAY)
    .map((q) => {
      const h = holdings.find((x) => x.symbol === q.symbol);
      return {
        symbol: q.symbol,
        name: q.name,
        date: q.earningsDate!,
        daysAway: Math.max(0, Math.round((new Date(q.earningsDate!).getTime() - now) / DAY)),
        owned: Boolean(h),
        positionValue: h?.value,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  // consensus estimates for the next two weeks
  await Promise.all(
    events
      .filter((e) => e.daysAway <= 14)
      .map(async (e) => {
        const est = await safe(getEarningsEstimates(e.symbol));
        e.epsEstimate = est?.eps;
        e.revenueEstimate = est?.revenue;
      }),
  );
  return events;
}

// ---------------- alerts ----------------

function runAlerts(d: StoreData, watch: EnrichedWatch[], holds: EnrichedHolding[], earnings: EarningsEvent[]) {
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();

  /** Edge-triggered: notifies only when `cond` flips false -> true. Returns true if it fired. */
  const check = (key: string, cond: boolean, make: () => Omit<AppNotification, "id" | "createdAt" | "read">, silent = false) => {
    seen.add(key);
    const was = d.alertState[key] ?? false;
    const fire = cond && !was && !silent;
    if (fire) {
      d.notifications.unshift({ ...make(), id: crypto.randomUUID(), createdAt: new Date().toISOString(), read: false });
    }
    d.alertState[key] = cond;
    return fire;
  };
  const n = (symbol: string, kind: string, title: string, message: string, severity: Severity) => () => ({
    symbol,
    kind,
    title,
    message,
    severity,
  });

  for (const w of watch) {
    if (!w.quote || !w.analysis) continue;
    const s = w.symbol;
    const p = w.quote.price;
    if (w.targetPrice)
      check(`w:${s}:target:${w.targetPrice}`, p <= w.targetPrice,
        n(s, "target", `${s} hit your buy target`, `Now ${fmt(p)} — your target was ${fmt(w.targetPrice)}.`, "good"));
    check(`w:${s}:strong`, w.analysis.score >= 75,
      n(s, "score", `${s} entered the Strong Buy Zone`, `Score ${w.analysis.score}/100. ${topReasons(w.analysis.signals)}`, "good"));
    check(`w:${s}:oversold`, (w.tech?.rsi14 ?? 50) < 30,
      n(s, "rsi", `${s} is oversold`, `RSI ${w.tech?.rsi14?.toFixed(0)} — potential bounce setup.`, "info"));
    check(`w:${s}:move:${today}`, Math.abs(w.quote.changePct) >= 5,
      n(s, "move", `${s} ${w.quote.changePct > 0 ? "up" : "down"} ${Math.abs(w.quote.changePct).toFixed(1)}% today`, `Trading at ${fmt(p)}.`, w.quote.changePct > 0 ? "info" : "warn"));
  }

  for (const h of holds) {
    if (!h.quote) continue;
    const s = h.symbol;
    const p = h.quote.price;
    if (h.stopLoss)
      check(`h:${s}:stop:${h.stopLoss}`, p <= h.stopLoss,
        n(s, "stop", `${s} hit your stop-loss`, `Now ${fmt(p)} ≤ stop ${fmt(h.stopLoss)}. P/L ${h.plPct.toFixed(1)}%.`, "bad"));
    if (h.takeProfit)
      check(`h:${s}:tp:${h.takeProfit}`, p >= h.takeProfit,
        n(s, "tp", `${s} reached your take-profit`, `Now ${fmt(p)} ≥ ${fmt(h.takeProfit)}. Gain ${h.plPct.toFixed(1)}% (${fmt(h.pl)}).`, "good"));
    check(`h:${s}:overbought`, (h.tech?.rsi14 ?? 50) > 75,
      n(s, "rsi", `${s} looks overbought`, `RSI ${h.tech?.rsi14?.toFixed(0)}. You're ${h.plPct >= 0 ? "up" : "down"} ${Math.abs(h.plPct).toFixed(1)}% — consider trimming.`, "warn"));
    check(`h:${s}:move:${today}`, Math.abs(h.quote.changePct) >= 5,
      n(s, "move", `${s} ${h.quote.changePct > 0 ? "up" : "down"} ${Math.abs(h.quote.changePct).toFixed(1)}% today`, `Position ${h.dayPl >= 0 ? "+" : ""}${fmt(h.dayPl)} today.`, h.quote.changePct > 0 ? "good" : "warn"));
    // highest milestone first; lower ones are marked silently so you get one alert, not three
    let firedMilestone = false;
    for (const m of [50, 25, 10])
      firedMilestone =
        check(`h:${s}:gain${m}`, h.plPct >= m,
          n(s, "milestone", `${s} is up ${m}%+`, `Gain ${h.plPct.toFixed(1)}% (${fmt(h.pl)}) on your position.`, "good"),
          firedMilestone) || firedMilestone;
    check(`h:${s}:loss10`, h.plPct <= -10,
      n(s, "milestone", `${s} is down 10%+`, `Loss ${h.plPct.toFixed(1)}% (${fmt(h.pl)}). Review your thesis or stop-loss.`, "warn"));
  }

  for (const e of earnings.filter((x) => x.owned)) {
    const when = e.daysAway === 0 ? "today" : e.daysAway === 1 ? "tomorrow" : `in ${e.daysAway} days`;
    const est = e.epsEstimate !== undefined ? ` EPS est. $${e.epsEstimate.toFixed(2)}.` : "";
    check(`h:${e.symbol}:earn:${e.date.slice(0, 10)}`, e.daysAway <= 3,
      n(e.symbol, "earnings", `${e.symbol} reports earnings ${when}`, `Expect a big move either way.${est} Decide now: hold through it, trim, or set a stop.`, "warn"));
  }

  // forget state for removed symbols / old daily keys so they can trigger again later
  // (keep state for symbols whose quote failed this round, so a hiccup doesn't re-fire alerts)
  const missing = new Set([...watch, ...holds].filter((x) => !x.quote).map((x) => x.symbol));
  for (const k of Object.keys(d.alertState)) {
    if (seen.has(k)) continue;
    if (missing.has(k.split(":")[1]) && !k.includes(":move:")) continue;
    delete d.alertState[k];
  }
  d.notifications = d.notifications.slice(0, 200);
}

function topReasons(signals: { label: string; tone: string }[]) {
  return signals.filter((s) => s.tone === "good").slice(0, 3).map((s) => s.label).join(" · ");
}

function fmt(n: number) {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
