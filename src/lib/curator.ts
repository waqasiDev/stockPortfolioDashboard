import "server-only";
import { analyzeBuy } from "./analysis";
import { arr, nullableNum, obj, str, structured } from "./llm";
import { getFundamentals, getQuotes, getTechnicals } from "./market";
import { researchPack } from "./research";
import { readStore, updateStore } from "./store";
import { discover } from "./trader";
import type { AppNotification, StoreData } from "./types";

const MAX_ADDS_PER_RUN = 3;

const SCHEMA = obj({
  adds: arr(obj({ symbol: str(), reason: str("1–2 sentences: why this deserves a spot on the watchlist, with numbers"), targetPrice: nullableNum("A sensible buy-below price, or null") })),
  removeAiPicks: arr(obj({ symbol: str(), reason: str() }), "AI-added stocks whose case has weakened and should come off"),
  flagUserItems: arr(obj({ symbol: str(), reason: str() }), "User-added stocks you would suggest removing (user decides). Use sparingly."),
});

type Out = {
  adds: { symbol: string; reason: string; targetPrice: number | null }[];
  removeAiPicks: { symbol: string; reason: string }[];
  flagUserItems: { symbol: string; reason: string }[];
};

function notify(d: StoreData, symbol: string, title: string, message: string, severity: AppNotification["severity"] = "info") {
  d.notifications.unshift({ id: crypto.randomUUID(), symbol, kind: "ai-watchlist", title, message, severity, createdAt: new Date().toISOString(), read: false });
}

/**
 * Lets the AI curate the watchlist. Rules (enforced here, not just in the prompt):
 * - adds are tagged addedBy "ai", only from the researched candidate list, capped by settings.maxAiPicks
 * - the AI may only REMOVE stocks it added itself, and never one you own
 * - for your own picks it can only leave a "consider removing" flag that you accept or dismiss
 */
export async function curateWatchlist(): Promise<string[]> {
  const store = readStore();
  if (!store.settings.aiWatchlist) return [];
  const owned = new Set(store.holdings.map((h) => h.symbol));
  const tracked = new Set([...store.watchlist.map((w) => w.symbol), ...owned]);
  const aiPicks = store.watchlist.filter((w) => w.addedBy === "ai");
  const room = Math.max(0, Math.min(MAX_ADDS_PER_RUN, store.settings.maxAiPicks - aiPicks.length + 2)); // +2 lets it rotate picks

  const fresh = [...new Set(await discover())].filter((s) => !tracked.has(s)).slice(0, 10);
  const candidates = (await Promise.all(fresh.map((s) => researchPack(s).then((r) => r.pack).catch(() => null)))).filter(Boolean);

  // current watchlist, compact
  const quotes = await getQuotes(store.watchlist.map((w) => w.symbol)).catch(() => ({}) as Awaited<ReturnType<typeof getQuotes>>);
  const current = await Promise.all(
    store.watchlist.map(async (w) => {
      const q = quotes[w.symbol];
      if (!q) return { symbol: w.symbol, addedBy: w.addedBy ?? "user" };
      const [t, f] = await Promise.all([getTechnicals(w.symbol, q.price).catch(() => undefined), getFundamentals(w.symbol).catch(() => undefined)]);
      const a = analyzeBuy(q, t, f, w.targetPrice);
      return {
        symbol: w.symbol,
        addedBy: w.addedBy ?? "user",
        userSaidKeep: Boolean(w.aiKeep),
        aiReasonWhenAdded: w.aiReason,
        addedOn: w.addedAt.slice(0, 10),
        price: q.price,
        targetPrice: w.targetPrice,
        buyScore: a.score,
        verdict: a.verdict,
        sector: f?.sector,
        analystConsensus: f?.recommendation,
      };
    }),
  );

  const { data } = await structured<Out>({
    name: "watchlist_curation",
    feature: "curator",
    schema: SCHEMA,
    instructions: [
      "You curate a beginner US investor's stock watchlist so it always contains the most promising ideas worth watching for an entry.",
      `You may add at most ${room} new stocks, ONLY from the candidate list. Prefer quality businesses with a catalyst or attractive setup, and diversify away from sectors the user already owns heavily.`,
      `The user can have at most ${store.settings.maxAiPicks} AI-added stocks; if you want to add more, propose removing weaker AI picks.`,
      "removeAiPicks: only stocks with addedBy='ai' whose thesis has weakened (score collapsed, thesis broken, better ideas available).",
      "flagUserItems: only addedBy='user' stocks that look clearly unattractive now. Never flag ones where userSaidKeep=true. Be sparing — it's their list.",
      "Give each reason in plain English with concrete numbers. It's fine to return empty arrays.",
    ].join("\n"),
    input: JSON.stringify({ ownedSymbols: [...owned], currentWatchlist: current, candidates }),
  });

  const changes: string[] = [];
  const validAdds = data.adds.filter((a) => fresh.includes(a.symbol)).slice(0, room);
  updateStore((d) => {
    for (const r of data.removeAiPicks) {
      const w = d.watchlist.find((x) => x.symbol === r.symbol);
      if (!w || w.addedBy !== "ai" || owned.has(r.symbol)) continue; // guardrail: only its own picks
      d.watchlist = d.watchlist.filter((x) => x.symbol !== r.symbol);
      changes.push(`Removed ${r.symbol}: ${r.reason}`);
      notify(d, r.symbol, `AI removed ${r.symbol} from your watchlist`, r.reason);
    }
    for (const a of validAdds) {
      if (d.watchlist.some((x) => x.symbol === a.symbol)) continue;
      if (d.watchlist.filter((x) => x.addedBy === "ai").length >= d.settings.maxAiPicks) break;
      d.watchlist.push({
        symbol: a.symbol,
        targetPrice: a.targetPrice,
        addedAt: new Date().toISOString(),
        addedBy: "ai",
        aiReason: a.reason,
      });
      changes.push(`Added ${a.symbol}: ${a.reason}`);
      notify(d, a.symbol, `AI added ${a.symbol} to your watchlist`, a.reason, "good");
    }
    for (const fl of data.flagUserItems) {
      const w = d.watchlist.find((x) => x.symbol === fl.symbol);
      if (!w || w.addedBy === "ai" || w.aiKeep || w.aiRemoveSuggestion) continue;
      w.aiRemoveSuggestion = { reason: fl.reason, at: new Date().toISOString() };
      changes.push(`Suggests removing ${fl.symbol}: ${fl.reason}`);
      notify(d, fl.symbol, `AI suggests removing ${fl.symbol}`, fl.reason, "warn");
    }
  });
  return changes;
}
