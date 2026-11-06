/* eslint-disable @typescript-eslint/no-explicit-any -- raw Yahoo payloads are loosely typed */
import "server-only";
import YahooFinance from "yahoo-finance2";
import { rsi, sma } from "./indicators";
import type { Fundamentals, QuoteLite, Technicals } from "./types";

export const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  queue: { concurrency: 4 },
});

// ---------- tiny in-memory TTL cache (survives across requests in the dev/prod server) ----------
type Entry<T> = { at: number; value: T };
const g = globalThis as unknown as { __mktCache?: Map<string, Entry<unknown>> };
const cache = (g.__mktCache ??= new Map());

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const MIN = 60_000;

// ---------- quotes ----------
export async function getQuotes(symbols: string[], force = false): Promise<Record<string, QuoteLite>> {
  const uniq = [...new Set(symbols)].sort();
  if (!uniq.length) return {};
  const key = "q:" + uniq.join(",");
  if (force) cache.delete(key);
  return cached(key, 20_000, async () => {
    const res = await yf.quote(uniq, {}, { validateResult: false });
    const arr = (Array.isArray(res) ? res : [res]) as Record<string, any>[];
    const out: Record<string, QuoteLite> = {};
    for (const q of arr) {
      if (!q?.symbol || typeof q.regularMarketPrice !== "number") continue;
      out[q.symbol] = {
        symbol: q.symbol,
        name: q.shortName ?? q.longName ?? q.displayName ?? q.symbol,
        price: q.regularMarketPrice,
        change: q.regularMarketChange ?? 0,
        changePct: q.regularMarketChangePercent ?? 0,
        prevClose: q.regularMarketPreviousClose,
        marketState: q.marketState,
        marketCap: q.marketCap,
        trailingPE: q.trailingPE,
        forwardPE: q.forwardPE,
        dividendYield: q.dividendYield,
        volume: q.regularMarketVolume,
        avgVolume: q.averageDailyVolume3Month,
        earningsDate: toIso(q.earningsTimestamp ?? q.earningsTimestampStart),
        ext: extended(q),
      };
    }
    return out;
  });
}

/** Pre-market quote before the open; after-hours quote after the close (incl. overnight/weekend). */
function extended(q: Record<string, any>): QuoteLite["ext"] {
  const state = String(q.marketState ?? "");
  const reg = q.regularMarketPrice as number;
  const make = (session: "pre" | "post", price?: number, at?: unknown) =>
    typeof price === "number" && price > 0 ? { session, price, change: price - reg, changePct: ((price - reg) / reg) * 100, at: toIso(at) } : undefined;
  if (state.startsWith("PRE")) return make("pre", q.preMarketPrice, q.preMarketTime);
  if (state.startsWith("POST") || state === "CLOSED") return make("post", q.postMarketPrice, q.postMarketTime);
  return undefined;
}

function toIso(v: unknown): string | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : String(v));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

// ---------- history & technicals ----------
export interface Bar {
  date: string;
  close: number;
}

export async function getHistory(symbol: string, days = 400): Promise<Bar[]> {
  return cached(`h:${symbol}:${days}`, 30 * MIN, async () => {
    const res = await yf.chart(symbol, {
      period1: new Date(Date.now() - days * 86_400_000),
      interval: "1d",
      return: "array",
    });
    return res.quotes
      .filter((q) => typeof q.close === "number")
      .map((q) => ({ date: new Date(q.date).toISOString(), close: q.close as number }));
  });
}

export async function getTechnicals(symbol: string, livePrice?: number): Promise<Technicals> {
  const bars = await getHistory(symbol);
  const closes = bars.map((b) => b.close);
  if (livePrice && closes.length) closes[closes.length - 1] = livePrice; // use live price for "today"
  const last252 = closes.slice(-252);
  const high52 = last252.length ? Math.max(...last252) : undefined;
  const low52 = last252.length ? Math.min(...last252) : undefined;
  const price = livePrice ?? closes.at(-1);
  const rangePos =
    high52 !== undefined && low52 !== undefined && price !== undefined && high52 > low52
      ? (price - low52) / (high52 - low52)
      : undefined;
  return {
    rsi14: rsi(closes.slice(-150), 14),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    high52,
    low52,
    rangePos,
    spark: closes.slice(-30),
  };
}

// ---------- fundamentals ----------
export async function getFundamentals(symbol: string): Promise<Fundamentals> {
  return cached(`f:${symbol}`, 6 * 60 * MIN, async () => {
    const s = (await yf.quoteSummary(
      symbol,
      { modules: ["financialData", "defaultKeyStatistics", "assetProfile"] },
      { validateResult: false },
    )) as Record<string, any>;
    const fd = s.financialData ?? {};
    const ks = s.defaultKeyStatistics ?? {};
    const ap = s.assetProfile ?? {};
    return {
      sector: ap.sector,
      industry: ap.industry,
      summary: ap.longBusinessSummary,
      pegRatio: num(ks.pegRatio),
      analystTarget: num(fd.targetMeanPrice),
      analystLow: num(fd.targetLowPrice),
      analystHigh: num(fd.targetHighPrice),
      recommendation: fd.recommendationKey,
      analystCount: num(fd.numberOfAnalystOpinions),
      revenueGrowth: num(fd.revenueGrowth),
      profitMargin: num(fd.profitMargins),
    };
  });
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v && typeof v === "object" && "raw" in v && typeof (v as any).raw === "number") return (v as any).raw;
  return undefined;
}

// ---------- search ----------
export async function searchSymbols(query: string) {
  if (!query.trim()) return [];
  return cached(`s:${query.toLowerCase()}`, 10 * MIN, async () => {
    const r = (await yf.search(query, { quotesCount: 8, newsCount: 0 }, { validateResult: false })) as any;
    return ((r.quotes ?? []) as any[])
      .filter((q) => q.symbol && ["EQUITY", "ETF"].includes(q.quoteType))
      .map((q) => ({
        symbol: q.symbol as string,
        name: (q.shortname ?? q.longname ?? q.symbol) as string,
        exchange: (q.exchDisp ?? q.exchange) as string,
        type: q.quoteType as string,
      }));
  });
}

/** Chart data for the detail view. */
export async function getChart(symbol: string, range: "1M" | "6M" | "1Y" | "5Y") {
  const days = { "1M": 31, "6M": 183, "1Y": 366, "5Y": 1830 }[range];
  // fetch extra history so SMA200 is defined from the start of the window
  const bars = await getHistory(symbol, days + 300);
  return { bars, days };
}

/** Next earnings date + consensus estimates (Yahoo calendarEvents). */
export async function getEarningsEstimates(symbol: string): Promise<{ date?: string; eps?: number; revenue?: number }> {
  return cached(`e:${symbol}`, 6 * 60 * MIN, async () => {
    const s = (await yf.quoteSummary(symbol, { modules: ["calendarEvents"] }, { validateResult: false })) as Record<string, any>;
    const e = s.calendarEvents?.earnings ?? {};
    const d = e.earningsDate?.[0];
    return { date: d ? new Date(d).toISOString() : undefined, eps: num(e.earningsAverage), revenue: num(e.revenueAverage) };
  });
}
