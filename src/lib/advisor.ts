import "server-only";
import { holdingAction, analyzeBuy } from "./analysis";
import { arr, enumOf, nullableNum, nullableStr, num, obj, str, structured } from "./llm";
import { getFundamentals, getTechnicals } from "./market";
import { researchPack } from "./research";
import { readStore, updateStore } from "./store";
import type { AiAnalysis } from "./types";

const TTL = 4 * 60 * 60 * 1000;

const SCHEMA = obj({
  recommendation: enumOf(["Strong Buy", "Buy", "Accumulate on Dips", "Hold", "Trim", "Sell", "Avoid"]),
  confidence: num("0-100: how confident you are in the recommendation given the evidence"),
  horizon: str("Time horizon this call is for, e.g. '3–6 months'"),
  headline: str("One punchy sentence summarising the call"),
  reasoning: str("3–5 sentences: the core of WHY, weighing price action, valuation, news and sentiment"),
  bullCase: arr(str(), "3–4 specific bullish points with numbers"),
  bearCase: arr(str(), "3–4 specific risks with numbers"),
  newsSentiment: obj({
    overall: enumOf(["Positive", "Neutral", "Negative", "Mixed"]),
    summary: str("2 sentences on what the news flow and analyst actions imply"),
    items: arr(obj({ headline: str(), sentiment: enumOf(["Positive", "Neutral", "Negative"]), impact: str("why it matters, <15 words") })),
  }),
  technicalView: str("2 sentences on trend/momentum using the numbers"),
  valuationView: str("2 sentences on valuation vs growth and analyst targets"),
  levels: obj({
    buyZoneLow: nullableNum(),
    buyZoneHigh: nullableNum(),
    stopLoss: nullableNum(),
    target: nullableNum("12-month-ish price target you find reasonable"),
  }),
  actionPlan: arr(str(), "2–4 concrete, numbered-style steps the investor can execute (with prices / share counts when they own it)"),
  whatWouldChangeMyMind: arr(str(), "2–3 observable triggers that would flip this call"),
  positionAdvice: nullableStr("Only if the user owns it: what to do with THEIR position given cost basis & P/L. Otherwise null."),
});

type Out = Omit<AiAnalysis, "symbol" | "createdAt" | "model" | "priceAtAnalysis" | "usedWebSearch" | "sources">;

export function getCachedAnalysis(symbol: string) {
  return readStore().analyses[symbol] ?? null;
}

export async function analyzeStock(symbol: string, force = false): Promise<AiAnalysis> {
  const existing = getCachedAnalysis(symbol);
  if (!force && existing && Date.now() - new Date(existing.createdAt).getTime() < TTL) return existing;

  const store = readStore();
  const WEB_SEARCH = store.settings.webSearch && process.env.AI_WEB_SEARCH !== "false";
  const watch = store.watchlist.find((w) => w.symbol === symbol);
  const hold = store.holdings.find((h) => h.symbol === symbol);
  const { quote, pack } = await researchPack(symbol, { targetPrice: watch?.targetPrice });

  let position = null;
  if (hold) {
    const [t, f] = await Promise.all([getTechnicals(symbol, quote.price).catch(() => undefined), getFundamentals(symbol).catch(() => undefined)]);
    const rule = holdingAction(hold, quote, t, analyzeBuy(quote, t, f));
    position = {
      shares: hold.qty,
      avgCost: hold.avgPrice,
      costBasis: +(hold.qty * hold.avgPrice).toFixed(2),
      marketValue: +(hold.qty * quote.price).toFixed(2),
      unrealizedPl: +((quote.price - hold.avgPrice) * hold.qty).toFixed(2),
      unrealizedPlPct: +(((quote.price - hold.avgPrice) / hold.avgPrice) * 100).toFixed(2),
      portfolioWeightPct: weightOf(store, symbol, quote.price),
      stopLoss: hold.stopLoss ?? null,
      takeProfit: hold.takeProfit ?? null,
      ruleEngineSuggestion: rule,
    };
  }

  const { data, sources, usedWebSearch, model } = await structured<Out>({
    name: "stock_analysis",
    feature: "advisor",
    schema: SCHEMA,
    webSearch: WEB_SEARCH,
    instructions: [
      "You are a seasoned equity analyst mentoring a beginner US retail investor who wants to make faster, better buy/sell decisions.",
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      WEB_SEARCH
        ? "First, search the web for the most important news about this company from the last ~2 weeks (earnings, guidance, product, legal, macro/sector moves) and factor it in. Prefer reputable financial sources."
        : "Use only the data provided.",
      "Weigh: price action & trend, valuation vs growth, analyst actions/targets, third-party technical outlook, news sentiment, and the user's own position/target if any.",
      "Be decisive and specific — cite the actual numbers. Do not hedge everything. If evidence conflicts, say which side you weight more and why.",
      "Price levels must be realistic relative to the current price and recent range.",
      "If the user owns the stock, the action plan must reference their share count and cost basis (e.g. 'Sell 3 of your 10 shares near $345 to lock in ~$430 profit').",
      "Never invent facts that are not in the data or your search results.",
    ].join("\n"),
    input: JSON.stringify({ stock: pack, userBuyTarget: watch?.targetPrice ?? null, userPosition: position }),
  });

  const analysis: AiAnalysis = {
    ...data,
    confidence: Math.max(0, Math.min(100, Math.round(data.confidence))),
    symbol,
    createdAt: new Date().toISOString(),
    model,
    priceAtAnalysis: quote.price,
    usedWebSearch,
    sources: sources.slice(0, 8),
  };
  updateStore((d) => {
    d.analyses[symbol] = analysis;
  });
  return analysis;
}

function weightOf(store: ReturnType<typeof readStore>, symbol: string, price: number) {
  // rough: uses avg cost for other holdings (we don't refetch every quote here)
  const total = store.holdings.reduce((a, h) => a + h.qty * (h.symbol === symbol ? price : h.avgPrice), 0);
  const mine = store.holdings.find((h) => h.symbol === symbol);
  return total && mine ? +(((mine.qty * price) / total) * 100).toFixed(1) : 0;
}
