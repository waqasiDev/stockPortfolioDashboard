import "server-only";
import { analyzeBuy } from "./analysis";
import { arr, obj, str, structured } from "./llm";
import { getFundamentals, getQuotes, getTechnicals } from "./market";
import { readStore, updateStore } from "./store";
import type { Emotion, JournalAction, JournalEntry, JournalReview } from "./types";

export interface JournalInput {
  symbol: string;
  action: JournalAction;
  price?: number;
  qty?: number | null;
  reasoning: string;
  confidence: number;
  emotion?: Emotion;
  horizon?: string;
}

/** Save an entry with a snapshot of what the signals/AI said at that moment. */
export async function addEntry(input: JournalInput): Promise<JournalEntry> {
  const symbol = input.symbol.trim().toUpperCase();
  const q = (await getQuotes([symbol]))[symbol];
  const price = input.price && input.price > 0 ? input.price : q?.price;
  if (!price) throw new Error(`No price for ${symbol}`);
  let snapshot: JournalEntry["snapshot"] = {};
  if (q) {
    const [t, f] = await Promise.all([getTechnicals(symbol, q.price).catch(() => undefined), getFundamentals(symbol).catch(() => undefined)]);
    const a = analyzeBuy(q, t, f);
    const ai = readStore().analyses[symbol];
    snapshot = {
      buyScore: a.score,
      verdict: a.verdict,
      rsi: t?.rsi14 !== undefined ? Math.round(t.rsi14) : undefined,
      // only count an AI view as "at the time" if it is less than 3 days old
      ...(ai && Date.now() - new Date(ai.createdAt).getTime() < 3 * 86_400_000 ? { aiRecommendation: ai.recommendation, aiConfidence: ai.confidence } : {}),
    };
  }
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    symbol,
    action: input.action,
    price,
    qty: input.qty ?? null,
    reasoning: input.reasoning.trim(),
    confidence: Math.max(1, Math.min(5, Math.round(input.confidence || 3))),
    emotion: input.emotion,
    horizon: input.horizon,
    snapshot,
  };
  updateStore((d) => {
    d.journal.unshift(entry);
  });
  return entry;
}

export function updateEntry(id: string, patch: Partial<JournalInput>) {
  updateStore((d) => {
    const e = d.journal.find((x) => x.id === id);
    if (!e) throw new Error("Entry not found");
    if (patch.reasoning !== undefined) e.reasoning = patch.reasoning;
    if (patch.confidence !== undefined) e.confidence = patch.confidence;
    if (patch.emotion !== undefined) e.emotion = patch.emotion;
    if (patch.horizon !== undefined) e.horizon = patch.horizon;
  });
}

export function deleteEntry(id: string) {
  updateStore((d) => {
    d.journal = d.journal.filter((x) => x.id !== id);
  });
}

/** Entries with how each decision has played out since. */
export async function journalWithOutcomes() {
  const store = readStore();
  const quotes = await getQuotes(store.journal.map((e) => e.symbol)).catch(() => ({}) as Awaited<ReturnType<typeof getQuotes>>);
  return store.journal.map((e) => {
    const now = quotes[e.symbol]?.price;
    const movePct = now ? ((now - e.price) / e.price) * 100 : null;
    // BUY/ADD/WATCH are right if price rose; SELL/TRIM/PASS are right if it fell
    const bullish = ["BUY", "ADD", "WATCH"].includes(e.action);
    const outcome = movePct === null || Math.abs(movePct) < 2 ? "too early" : (bullish ? movePct > 0 : movePct < 0) ? "right" : "wrong";
    return { ...e, priceNow: now ?? null, movePct, outcome, daysAgo: Math.floor((Date.now() - new Date(e.createdAt).getTime()) / 86_400_000) };
  });
}

const REVIEW_SCHEMA = obj({
  grade: str("Letter grade A–F for decision quality (process, not just luck)"),
  summary: str("3–4 sentences: how this investor decides, what's working, what's costing them"),
  strengths: arr(str(), "2–3 specific strengths with examples from the journal"),
  mistakes: arr(str(), "2–4 specific mistakes with symbols/dates/numbers"),
  biases: arr(obj({ name: str("e.g. FOMO, loss aversion, confirmation bias, recency bias, overconfidence, anchoring"), evidence: str() }), "Behavioural biases visible in the entries; empty if none"),
  lessons: arr(str(), "3 concrete rules to adopt going forward"),
  vsAiTrader: str("2–3 sentences comparing the user's decisions/results with the AI Trader's over the same period (or say there is no AI Trader data)"),
});

export async function reviewJournal(): Promise<JournalReview> {
  const entries = await journalWithOutcomes();
  if (entries.length < 3) throw new Error("Write at least 3 journal entries first — the review needs a pattern to look at.");
  const store = readStore();
  const t = store.aiTrader;
  const aiTrader = t
    ? {
        startedAt: t.startedAt.slice(0, 10),
        deposited: t.deposited,
        recentTrades: t.trades.slice(0, 25).map((x) => ({ date: x.at.slice(0, 10), side: x.side, symbol: x.symbol, price: x.price, realizedPlPct: x.realizedPlPct, reason: x.reason.slice(0, 160) })),
        equityStart: t.equityHistory[0]?.equity,
        equityLatest: t.equityHistory.at(-1)?.equity,
        benchmarkLatest: t.equityHistory.at(-1)?.benchmark,
      }
    : null;

  const { data, model } = await structured<Omit<JournalReview, "createdAt" | "model">>({
    name: "journal_review",
    feature: "journal",
    schema: REVIEW_SCHEMA,
    instructions: [
      "You are a trading coach reviewing a beginner investor's decision journal. Be honest, specific and kind — like a good mentor.",
      "Judge the PROCESS (reasoning quality, sizing, emotional state, following signals vs. impulse) as well as outcomes; a good decision can lose money short-term.",
      "Look for patterns: does low confidence or FOMO/fear correlate with worse outcomes? do they ignore their own signals or the AI's view? do they sell winners early / hold losers?",
      "Use the snapshot (buy score, AI recommendation at the time) to point out when they went against the evidence and how it turned out.",
    ].join("\n"),
    input: JSON.stringify({
      entries: entries.slice(0, 60).map((e) => ({
        date: e.createdAt.slice(0, 10),
        symbol: e.symbol,
        action: e.action,
        price: e.price,
        qty: e.qty,
        reasoning: e.reasoning,
        confidence1to5: e.confidence,
        emotion: e.emotion,
        horizon: e.horizon,
        signalsAtTheTime: e.snapshot,
        priceNow: e.priceNow,
        movePctSince: e.movePct !== null ? +e.movePct.toFixed(2) : null,
        outcome: e.outcome,
      })),
      aiTrader,
    }),
  });
  const review: JournalReview = { ...data, createdAt: new Date().toISOString(), model };
  updateStore((d) => {
    d.journalReview = review;
  });
  return review;
}
