/* eslint-disable @typescript-eslint/no-explicit-any -- raw Yahoo payloads are loosely typed */
import "server-only";
import { analyzeBuy } from "./analysis";
import { cached, getFundamentals, getQuotes, getTechnicals, yf } from "./market";
import type { AnalystAction, NewsItem, Outlook, Sentiment } from "./types";

const MIN = 60_000;
const DAY = 86_400_000;

async function tryOr<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.warn("[research]", (e as Error).message);
    return fallback;
  }
}

export async function getNews(symbol: string, limit = 8): Promise<NewsItem[]> {
  return cached(`n:${symbol}`, 20 * MIN, async () => {
    const r = (await yf.search(symbol, { quotesCount: 0, newsCount: 15 }, { validateResult: false })) as any;
    const items = ((r.news ?? []) as any[])
      .filter((n) => n.title && n.link)
      .map((n) => ({
        title: n.title as string,
        publisher: (n.publisher ?? "") as string,
        link: n.link as string,
        publishedAt: new Date(n.providerPublishTime).toISOString(),
        related: (n.relatedTickers ?? []) as string[],
      }));
    // stories that actually tag this ticker first, then the rest; newest first within each group
    const score = (n: (typeof items)[number]) => (n.related.includes(symbol) ? 1 : 0);
    return items
      .sort((a, b) => score(b) - score(a) || b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit)
      .map((n) => ({ title: n.title, publisher: n.publisher, link: n.link, publishedAt: n.publishedAt }));
  });
}

function outlook(o: any): Outlook | undefined {
  if (!o?.direction) return undefined;
  return { direction: o.direction, score: o.score, description: o.scoreDescription ?? o.stateDescription };
}

export async function getSentiment(symbol: string): Promise<Sentiment> {
  return cached(`sent:${symbol}`, 30 * MIN, async () => {
    const [news, ins, qs] = await Promise.all([
      tryOr(getNews(symbol), []),
      tryOr(yf.insights(symbol, { reportsCount: 0 }, { validateResult: false }) as Promise<any>, null),
      tryOr(
        yf.quoteSummary(symbol, { modules: ["upgradeDowngradeHistory", "recommendationTrend"] }, { validateResult: false }) as Promise<any>,
        null,
      ),
    ]);

    const te = ins?.instrumentInfo?.technicalEvents;
    const since = Date.now() - 60 * DAY;
    const analystActions: AnalystAction[] = ((qs?.upgradeDowngradeHistory?.history ?? []) as any[])
      .filter((h) => new Date(h.epochGradeDate).getTime() >= since)
      .slice(0, 8)
      .map((h) => ({
        date: new Date(h.epochGradeDate).toISOString(),
        firm: h.firm,
        action: h.action,
        toGrade: h.toGrade,
        fromGrade: h.fromGrade || undefined,
        priceTarget: h.currentPriceTarget || undefined,
        priorPriceTarget: h.priorPriceTarget || undefined,
      }));
    const t0 = qs?.recommendationTrend?.trend?.[0];

    return {
      news,
      outlook: te
        ? {
            provider: te.provider,
            short: outlook(te.shortTermOutlook),
            mid: outlook(te.intermediateTermOutlook),
            long: outlook(te.longTermOutlook),
          }
        : undefined,
      analystActions,
      ratings: t0 ? { strongBuy: t0.strongBuy, buy: t0.buy, hold: t0.hold, sell: t0.sell, strongSell: t0.strongSell } : undefined,
      developments: ((ins?.sigDevs ?? []) as any[]).slice(0, 4).map((d) => ({ headline: d.headline, date: new Date(d.date).toISOString() })),
      researchRating: ins?.recommendation?.rating
        ? { provider: ins.recommendation.provider, rating: ins.recommendation.rating, targetPrice: ins.recommendation.targetPrice }
        : undefined,
    };
  });
}

/** Everything we know about a symbol, compacted for an LLM prompt. */
export async function researchPack(symbol: string, opts: { targetPrice?: number | null } = {}) {
  const q = (await getQuotes([symbol]))[symbol];
  if (!q) throw new Error(`No quote for ${symbol}`);
  const [t, f, s] = await Promise.all([
    tryOr(getTechnicals(symbol, q.price), undefined),
    tryOr(getFundamentals(symbol), undefined),
    tryOr(getSentiment(symbol), undefined),
  ]);
  const a = analyzeBuy(q, t, f, opts.targetPrice);
  const r2 = (n?: number) => (n === undefined ? undefined : Math.round(n * 100) / 100);
  return {
    quote: q,
    pack: {
      symbol,
      name: q.name,
      sector: f?.sector,
      industry: f?.industry,
      price: q.price,
      dayChangePct: r2(q.changePct),
      marketCap: q.marketCap,
      valuation: { trailingPE: r2(q.trailingPE), forwardPE: r2(q.forwardPE), peg: r2(f?.pegRatio), dividendYieldPct: q.dividendYield },
      growth: { revenueGrowthPct: r2((f?.revenueGrowth ?? NaN) * 100) || undefined, profitMarginPct: r2((f?.profitMargin ?? NaN) * 100) || undefined },
      technicals: t && {
        rsi14: r2(t.rsi14),
        sma50: r2(t.sma50),
        sma200: r2(t.sma200),
        high52: r2(t.high52),
        low52: r2(t.low52),
        pctOf52wRange: t.rangePos !== undefined ? Math.round(t.rangePos * 100) : undefined,
        last30Closes: t.spark.map((x) => Math.round(x * 100) / 100),
      },
      analysts: {
        consensus: f?.recommendation,
        count: f?.analystCount,
        avgTarget: f?.analystTarget,
        lowTarget: f?.analystLow,
        highTarget: f?.analystHigh,
        ratingCounts: s?.ratings,
        recentActions: s?.analystActions,
      },
      technicalOutlook: s?.outlook,
      thirdPartyResearch: s?.researchRating,
      significantDevelopments: s?.developments,
      news: s?.news.map((n) => ({ title: n.title, publisher: n.publisher, date: n.publishedAt.slice(0, 10) })),
      nextEarnings: q.earningsDate?.slice(0, 10),
      ruleBasedScore: { score: a.score, verdict: a.verdict, signals: a.signals.map((x) => `${x.tone}: ${x.label} — ${x.detail}`) },
    },
  };
}
