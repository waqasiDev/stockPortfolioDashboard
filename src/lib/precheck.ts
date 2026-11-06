import "server-only";
import { analyzeBuy } from "./analysis";
import { isSpeculative } from "./health";
import { getEarningsEstimates, getFundamentals, getQuotes, getTechnicals } from "./market";
import { readStore } from "./store";
import type { PreBuyCheck } from "./types";

const DAY = 86_400_000;

/** Instant, rule-based "should I really buy this?" checklist. No AI cost. */
export async function preBuyCheck(symbol: string, qty: number, price?: number): Promise<PreBuyCheck> {
  const store = readStore();
  const quotes = await getQuotes([symbol, ...store.holdings.map((h) => h.symbol)]);
  const q = quotes[symbol];
  if (!q) throw new Error(`No quote for ${symbol}`);
  const buyPrice = price && price > 0 ? price : q.price;
  const [t, f, est] = await Promise.all([
    getTechnicals(symbol, q.price).catch(() => undefined),
    getFundamentals(symbol).catch(() => undefined),
    getEarningsEstimates(symbol).catch(() => undefined),
  ]);
  const watch = store.watchlist.find((w) => w.symbol === symbol);
  const a = analyzeBuy(q, t, f, watch?.targetPrice);

  // portfolio after the purchase
  const holdingsValue = (s: string, qtyOverride?: number) => {
    const h = store.holdings.find((x) => x.symbol === s);
    return (qtyOverride ?? h?.qty ?? 0) * (quotes[s]?.price ?? h?.avgPrice ?? 0);
  };
  const currentTotal = store.holdings.reduce((acc, h) => acc + holdingsValue(h.symbol), 0);
  const addValue = qty * buyPrice;
  const totalAfter = currentTotal + addValue;
  const posAfter = holdingsValue(symbol) + addValue;
  const positionPctAfter = totalAfter ? (posAfter / totalAfter) * 100 : 100;

  const sectorOf = async (s: string) => (await getFundamentals(s).catch(() => undefined))?.sector;
  const sector = f?.sector;
  let sectorAfter = 0;
  if (sector) {
    const sectors = await Promise.all(store.holdings.map(async (h) => ({ s: h.symbol, sec: await sectorOf(h.symbol) })));
    const inSector = sectors.filter((x) => x.sec === sector && x.s !== symbol).reduce((acc, x) => acc + holdingsValue(x.s), 0);
    sectorAfter = totalAfter ? ((inSector + posAfter) / totalAfter) * 100 : 100;
  }

  const checks: PreBuyCheck["checks"] = [];
  const add = (label: string, status: PreBuyCheck["checks"][number]["status"], detail: string) => checks.push({ label, status, detail });

  // 1. signal quality
  add("Buy signal", a.score >= 60 ? "pass" : a.score >= 45 ? "warn" : "fail", `Score ${a.score}/100 — ${a.verdict}. ${a.signals.filter((s) => s.tone === "good").slice(0, 2).map((s) => s.label).join(", ") || "Few bullish signals"}.`);

  // 2. position size (only meaningful once you have a portfolio)
  if (currentTotal > 0)
    add("Position size", positionPctAfter <= 10 ? "pass" : positionPctAfter <= 20 ? "warn" : "fail", `${symbol} would be ${positionPctAfter.toFixed(1)}% of your portfolio after this buy (aim ≤10–15%).`);

  // 3. sector concentration
  if (sector && currentTotal > 0)
    add("Sector concentration", sectorAfter <= 30 ? "pass" : sectorAfter <= 45 ? "warn" : "fail", `${sector} would be ${sectorAfter.toFixed(0)}% of your portfolio.`);

  // 4. earnings risk
  const earnDate = est?.date ?? q.earningsDate;
  if (earnDate) {
    const days = Math.round((new Date(earnDate).getTime() - Date.now()) / DAY);
    if (days >= 0 && days <= 7) add("Earnings soon", "warn", `Reports in ${days} day${days === 1 ? "" : "s"} — the stock can gap ±10%. Consider buying half now, half after.`);
    else if (days > 7) add("Earnings", "pass", `Next report in ${days} days.`);
  }

  // 5. chasing / momentum
  if (q.changePct >= 5) add("Chasing a spike?", "warn", `Already up ${q.changePct.toFixed(1)}% today. Buying into spikes often means buying the top — consider waiting for a pullback.`);
  if (t?.rsi14 !== undefined)
    add("Momentum (RSI)", t.rsi14 > 75 ? "warn" : "pass", t.rsi14 > 75 ? `RSI ${t.rsi14.toFixed(0)} — overbought, pullback risk.` : `RSI ${t.rsi14.toFixed(0)} — not overextended.`);

  // 6. trend
  if (t?.sma200)
    add("Long-term trend", buyPrice >= t.sma200 ? "pass" : "warn", buyPrice >= t.sma200 ? `Above its 200-day average (${t.sma200.toFixed(2)}).` : `Below its 200-day average (${t.sma200.toFixed(2)}) — you're buying a downtrend; keep size small.`);

  // 7. valuation vs analysts
  if (f?.analystTarget) {
    const up = ((f.analystTarget - buyPrice) / buyPrice) * 100;
    add("Analyst upside", up >= 10 ? "pass" : up >= 0 ? "warn" : "fail", `Avg target $${f.analystTarget.toFixed(2)} (${up >= 0 ? "+" : ""}${up.toFixed(0)}%).`);
  }

  // 8. quality
  if (isSpeculative({ quote: q, fund: f }))
    add("Speculative stock", "warn", `${q.marketCap && q.marketCap < 2e9 ? "Small cap" : "Unprofitable"} — higher volatility; size it smaller than a core holding.`);

  // 9. your own plan
  if (watch?.targetPrice) add("Your target price", buyPrice <= watch.targetPrice * 1.02 ? "pass" : "warn", buyPrice <= watch.targetPrice * 1.02 ? `At/near your target of $${watch.targetPrice}.` : `Above your own target of $${watch.targetPrice} — are you being patient?`);

  // suggested exit + size
  const suggestedStop = +Math.max(buyPrice * 0.88, t?.sma200 && t.sma200 < buyPrice ? t.sma200 * 0.98 : 0, t?.low52 && t.low52 < buyPrice ? t.low52 : 0).toFixed(2);
  add("Exit plan", "info", `Decide your stop-loss before buying. A sensible level: $${suggestedStop} (${(((suggestedStop - buyPrice) / buyPrice) * 100).toFixed(0)}%).`);

  const targetPct = isSpeculative({ quote: q, fund: f }) ? 5 : 10;
  // solve (current + x) / (total + x) = target%  →  x = (target·total − current) / (1 − target)
  const p = targetPct / 100;
  const maxValue = currentTotal > 0 ? Math.max(0, (p * currentTotal - holdingsValue(symbol)) / (1 - p)) : addValue;
  const suggestedMaxQty = Math.max(0, Math.floor((maxValue / buyPrice) * 100) / 100);

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  return {
    symbol,
    price: buyPrice,
    qty,
    verdict: fails ? "Stop & rethink" : warns >= 2 ? "Caution" : "Go",
    checks,
    suggestedMaxQty,
    suggestedStop,
    positionPctAfter,
  };
}
