import "server-only";
import { readStore, updateStore } from "./store";
import { nyNow } from "./time";
import type { AiFeature, AiStatus, AppSettings, UsageDay } from "./types";

/**
 * Central AI gate + cost tracking. Every OpenAI call goes through `structured()` in llm.ts,
 * which calls `assertAiAllowed()` before and `recordUsage()` after — so pausing here stops
 * ALL AI features at once, and every token is counted.
 */

export class AiPausedError extends Error {}

const emptyDay = (): UsageDay => ({ calls: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, cost: 0, byFeature: {} });
const hasKey = () => Boolean(process.env.OPENAI_API_KEY);

function pauseState(s: AppSettings, today: UsageDay) {
  const timedOut = s.aiPaused && s.aiPausedUntil && new Date(s.aiPausedUntil).getTime() <= Date.now();
  const paused = s.aiPaused && !timedOut;
  const overBudget = s.dailyBudgetUsd > 0 && today.cost >= s.dailyBudgetUsd;
  return { paused: Boolean(paused), timedOut: Boolean(timedOut), overBudget };
}

/** True when AI calls are allowed right now (key present, not paused, under budget). */
export function aiActive(): boolean {
  if (!hasKey()) return false;
  const d = readStore();
  const { paused, overBudget } = pauseState(d.settings, d.usage[nyNow().date] ?? emptyDay());
  return !paused && !overBudget;
}

export function assertAiAllowed() {
  if (!hasKey()) throw new Error("OPENAI_API_KEY is not set. Add it to .env.local and restart the app.");
  const d = readStore();
  const st = pauseState(d.settings, d.usage[nyNow().date] ?? emptyDay());
  if (st.timedOut) setPause(false); // pause window ended → auto-resume
  else if (st.paused)
    throw new AiPausedError(
      `AI is paused${d.settings.aiPausedUntil ? ` until ${new Date(d.settings.aiPausedUntil).toLocaleString()}` : ""} — resume it from “AI & costs” in the top bar.`,
    );
  if (st.overBudget)
    throw new AiPausedError(`Today’s AI budget ($${d.settings.dailyBudgetUsd.toFixed(2)}) is used up — AI resumes tomorrow, or raise the budget in “AI & costs”.`);
}

export function recordUsage(feature: AiFeature, u: { inputTokens: number; outputTokens: number; webSearches: number }) {
  updateStore((d) => {
    const date = nyNow().date;
    const s = d.settings;
    const cost = (u.inputTokens / 1e6) * s.priceInputPerM + (u.outputTokens / 1e6) * s.priceOutputPerM + u.webSearches * s.pricePerWebSearch;
    const day = (d.usage[date] ??= emptyDay());
    const wasUnder = !(s.dailyBudgetUsd > 0 && day.cost >= s.dailyBudgetUsd);
    day.calls++;
    day.inputTokens += u.inputTokens;
    day.outputTokens += u.outputTokens;
    day.webSearches += u.webSearches;
    day.cost += cost;
    const f = (day.byFeature[feature] ??= { calls: 0, cost: 0 });
    f.calls++;
    f.cost += cost;
    if (wasUnder && s.dailyBudgetUsd > 0 && day.cost >= s.dailyBudgetUsd) {
      d.notifications.unshift({
        id: crypto.randomUUID(),
        symbol: "AI",
        kind: "ai-budget",
        title: "Daily AI budget reached — AI paused until tomorrow",
        message: `Estimated spend today: $${day.cost.toFixed(2)} (budget $${s.dailyBudgetUsd.toFixed(2)}). Free features keep working.`,
        severity: "warn",
        createdAt: new Date().toISOString(),
        read: false,
      });
    }
    // keep ~90 days
    const keys = Object.keys(d.usage).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete d.usage[k];
  });
}

export function setPause(paused: boolean, minutes?: number | "tomorrow") {
  updateStore((d) => {
    d.settings.aiPaused = paused;
    if (!paused) d.settings.aiPausedUntil = null;
    else if (minutes === "tomorrow") {
      // next 8:00am New York time (before the morning brief)
      const ny = nyNow();
      const minsToMidnight = 24 * 60 - ny.minutes;
      d.settings.aiPausedUntil = new Date(Date.now() + (minsToMidnight + 8 * 60) * 60_000).toISOString();
    } else d.settings.aiPausedUntil = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
  });
}

export function getAiStatus(): AiStatus {
  const d = readStore();
  const today = d.usage[nyNow().date] ?? emptyDay();
  const st = pauseState(d.settings, today);
  const days = Object.entries(d.usage).sort(([a], [b]) => b.localeCompare(a));
  const sum = (n: number) => days.slice(0, n).reduce((a, [, x]) => ({ calls: a.calls + x.calls, cost: a.cost + x.cost }), { calls: 0, cost: 0 });
  const byFeature30: AiStatus["byFeature30"] = {};
  for (const [, x] of days.slice(0, 30))
    for (const [k, v] of Object.entries(x.byFeature)) {
      const f = (byFeature30[k as AiFeature] ??= { calls: 0, cost: 0 });
      f.calls += v!.calls;
      f.cost += v!.cost;
    }
  const reason = !hasKey() ? "no-key" : st.paused ? "paused" : st.overBudget ? "budget" : null;
  return {
    enabled: hasKey(),
    active: reason === null,
    paused: st.paused,
    pausedUntil: st.paused ? d.settings.aiPausedUntil : null,
    reason,
    today,
    last7: sum(7),
    last30: sum(30),
    byFeature30,
    history: days.slice(0, 14).map(([date, x]) => ({ date, cost: x.cost, calls: x.calls })).reverse(),
    settings: {
      dailyBudgetUsd: d.settings.dailyBudgetUsd,
      priceInputPerM: d.settings.priceInputPerM,
      priceOutputPerM: d.settings.priceOutputPerM,
      pricePerWebSearch: d.settings.pricePerWebSearch,
      webSearch: d.settings.webSearch,
    },
  };
}
