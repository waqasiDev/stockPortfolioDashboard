"use client";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Globe, Loader2, Newspaper, RefreshCw, Sparkles, Target } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiAnalysis, AiRecommendation, Sentiment } from "@/lib/types";
import { money } from "./ui";

const recStyle: Record<AiRecommendation, string> = {
  "Strong Buy": "bg-emerald-500 text-emerald-950",
  Buy: "bg-emerald-500/80 text-emerald-950",
  "Accumulate on Dips": "bg-teal-500/25 text-teal-200 ring-1 ring-teal-400/40",
  Hold: "bg-slate-500/25 text-slate-200 ring-1 ring-slate-400/30",
  Trim: "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/40",
  Sell: "bg-rose-500/80 text-rose-50",
  Avoid: "bg-rose-500/25 text-rose-200 ring-1 ring-rose-400/40",
};
const sentColor = { Positive: "text-emerald-400", Negative: "text-rose-400", Neutral: "text-slate-400", Mixed: "text-amber-300" } as const;

function ago(iso: string) {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

export function AiAnalysisCard({ symbol, aiEnabled, autoRun, currentPrice }: { symbol: string; aiEnabled: boolean; autoRun?: boolean; currentPrice?: number }) {
  const [a, setA] = useState<AiAnalysis | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLElement>(null);
  const started = useRef(false);

  async function run(force: boolean) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/ai/${symbol}${force ? "?force=1" : ""}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setA(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    fetch(`/api/ai/${symbol}`)
      .then((r) => r.json())
      .then((j) => setA(j))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [symbol]);

  useEffect(() => {
    if (!autoRun || !loaded || started.current) return;
    started.current = true;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (aiEnabled && (!a || Date.now() - new Date(a.createdAt).getTime() > 4 * 3600_000)) run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, loaded]);

  const moved = a && currentPrice ? ((currentPrice - a.priceAtAnalysis) / a.priceAtAnalysis) * 100 : 0;

  return (
    <section ref={ref} className="card scroll-mt-24 overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/5 bg-gradient-to-r from-violet-500/10 to-transparent px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles size={16} className="text-violet-400" /> AI Advisor
        </h3>
        {a && (
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => run(true)} disabled={busy}>
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Re-analyze
          </button>
        )}
      </header>

      <div className="p-4">
        {busy && !a && <Researching symbol={symbol} />}

        {!a && !busy && (
          aiEnabled ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">
                Get a full buy/sell recommendation: AI reads the latest news, analyst moves, technicals and valuation, and explains its reasoning step by step.
              </p>
              <button className="btn w-full justify-center bg-violet-500 py-2 text-white hover:bg-violet-400" onClick={() => run(false)}>
                <Sparkles size={15} /> Analyze {symbol} with AI
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Add <code className="rounded bg-white/5 px-1">OPENAI_API_KEY</code> to <code className="rounded bg-white/5 px-1">.env.local</code> and restart to enable the AI Advisor.
            </p>
          )
        )}

        {a && (
          <div className={`space-y-5 ${busy ? "opacity-50" : ""}`}>
            {/* verdict */}
            <div className="flex flex-wrap items-center gap-4">
              <span className={`rounded-lg px-3 py-1.5 text-base font-bold ${recStyle[a.recommendation]}`}>{a.recommendation}</span>
              <div className="min-w-[140px] flex-1">
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Confidence</span>
                  <span className="num text-slate-300">{a.confidence}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-violet-400" style={{ width: `${a.confidence}%` }} />
                </div>
              </div>
              <span className="text-xs text-slate-400">Horizon: {a.horizon}</span>
            </div>
            <p className="text-[15px] font-medium leading-snug text-slate-100">{a.headline}</p>
            <p className="text-sm leading-relaxed text-slate-300">{a.reasoning}</p>

            {a.positionAdvice && (
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-sm text-sky-100">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-sky-400">Your position</span>
                {a.positionAdvice}
              </div>
            )}

            {/* action plan */}
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Target size={13} /> Action plan
              </h4>
              <ol className="space-y-1.5">
                {a.actionPlan.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-200">
                    <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-semibold text-violet-300">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>

            {/* levels */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Level k="Buy zone" v={a.levels.buyZoneLow && a.levels.buyZoneHigh ? `${money(a.levels.buyZoneLow, 0)}–${money(a.levels.buyZoneHigh, 0)}` : money(a.levels.buyZoneLow ?? a.levels.buyZoneHigh)} />
              <Level k="Stop-loss" v={money(a.levels.stopLoss)} cls="text-rose-300" />
              <Level k="Target" v={money(a.levels.target)} cls="text-emerald-300" />
              <Level k="Price then" v={money(a.priceAtAnalysis)} sub={currentPrice ? `${moved >= 0 ? "+" : ""}${moved.toFixed(1)}% since` : undefined} />
            </div>

            {/* bull / bear */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Case title="Bull case" icon={<ArrowUpRight size={14} />} items={a.bullCase} cls="border-emerald-500/20 text-emerald-400" />
              <Case title="Bear case" icon={<ArrowDownRight size={14} />} items={a.bearCase} cls="border-rose-500/20 text-rose-400" />
            </div>

            {/* news sentiment */}
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Newspaper size={13} /> News sentiment: <span className={sentColor[a.newsSentiment.overall]}>{a.newsSentiment.overall}</span>
              </h4>
              <p className="mb-2 text-sm text-slate-300">{a.newsSentiment.summary}</p>
              <ul className="space-y-1.5">
                {a.newsSentiment.items.map((n, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className={`w-14 shrink-0 font-medium ${sentColor[n.sentiment]}`}>{n.sentiment}</span>
                    <span className="text-slate-300">
                      {n.headline} <span className="text-slate-500">— {n.impact}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Technicals</h4>
                <p className="text-slate-300">{a.technicalView}</p>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Valuation</h4>
                <p className="text-slate-300">{a.valuationView}</p>
              </div>
            </div>

            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">What would change this call</h4>
              <ul className="ml-4 list-disc space-y-0.5 text-sm text-slate-400 marker:text-slate-600">
                {a.whatWouldChangeMyMind.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>

            {a.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {a.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200">
                    <ExternalLink size={10} className="shrink-0" /> <span className="truncate">{s.title || new URL(s.url).hostname}</span>
                  </a>
                ))}
              </div>
            )}

            <p className="flex items-center gap-1.5 text-[11px] text-slate-600">
              {a.usedWebSearch && <Globe size={11} />} {a.usedWebSearch ? "Used live web search · " : ""}
              {ago(a.createdAt)} · {a.model} · Not financial advice
            </p>
          </div>
        )}
        {busy && a && <p className="mt-3 flex items-center gap-2 text-xs text-violet-300"><Loader2 size={12} className="animate-spin" /> Re-analyzing with the latest data…</p>}
        {err && <p className="mt-3 text-sm text-rose-400">{err}</p>}
      </div>
    </section>
  );
}

function Researching({ symbol }: { symbol: string }) {
  const steps = ["Reading latest news & web coverage", "Checking analyst upgrades/downgrades", "Reviewing trend, momentum & valuation", "Weighing your position & writing the plan"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 6000);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <div className="space-y-2 py-2">
      <p className="flex items-center gap-2 text-sm text-violet-300">
        <Loader2 size={14} className="animate-spin" /> Analyzing {symbol}… (usually 20–60s)
      </p>
      {steps.map((s, k) => (
        <p key={s} className={`pl-6 text-xs ${k < i ? "text-slate-500 line-through" : k === i ? "text-slate-300" : "text-slate-600"}`}>{s}</p>
      ))}
    </div>
  );
}

function Level({ k, v, sub, cls = "text-slate-100" }: { k: string; v: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className={`num text-sm font-semibold ${cls}`}>{v}</div>
      {sub && <div className="num text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Case({ title, icon, items, cls }: { title: string; icon: React.ReactNode; items: string[]; cls: string }) {
  return (
    <div className={`rounded-lg border bg-white/[0.02] p-3 ${cls.split(" ")[0]}`}>
      <h4 className={`mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${cls.split(" ")[1]}`}>{icon}{title}</h4>
      <ul className="space-y-1 text-sm text-slate-300">
        {items.map((s, i) => <li key={i}>• {s}</li>)}
      </ul>
    </div>
  );
}

// ---------------- free (no AI) sentiment panel ----------------

const dirColor = (d?: string) => (d === "Bullish" ? "text-emerald-400 bg-emerald-500/10" : d === "Bearish" ? "text-rose-400 bg-rose-500/10" : "text-slate-300 bg-white/5");

export function SentimentCard({ symbol }: { symbol: string }) {
  const [s, setS] = useState<Sentiment | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`/api/sentiment/${symbol}`)
      .then((r) => r.json())
      .then((j) => setS(j.error ? null : j))
      .finally(() => setLoading(false));
  }, [symbol]);

  const total = s?.ratings ? s.ratings.strongBuy + s.ratings.buy + s.ratings.hold + s.ratings.sell + s.ratings.strongSell : 0;

  return (
    <section className="card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Newspaper size={15} className="text-sky-400" /> News & sentiment
      </h3>
      {loading ? (
        <div className="flex justify-center py-6 text-slate-500"><Loader2 className="animate-spin" size={18} /></div>
      ) : !s ? (
        <p className="text-sm text-slate-500">Couldn’t load sentiment data.</p>
      ) : (
        <div className="space-y-4">
          {s.outlook && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Technical outlook {s.outlook.provider && `· ${s.outlook.provider}`}</div>
              <div className="grid grid-cols-3 gap-2">
                {(["short", "mid", "long"] as const).map((k) => {
                  const o = s.outlook?.[k];
                  return (
                    <div key={k} className={`rounded-lg px-2.5 py-1.5 ${dirColor(o?.direction)}`} title={o?.description}>
                      <div className="text-[10px] uppercase tracking-wide opacity-70">{k === "short" ? "Short term" : k === "mid" ? "Mid term" : "Long term"}</div>
                      <div className="text-sm font-semibold">{o?.direction ?? "—"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {s.ratings && total > 0 && (
            <div>
              <div className="mb-1.5 flex justify-between text-[11px] uppercase tracking-wide text-slate-500">
                <span>Analyst ratings ({total})</span>
                {s.researchRating && <span className="normal-case">{s.researchRating.provider}: {s.researchRating.rating}{s.researchRating.targetPrice ? ` · PT ${money(s.researchRating.targetPrice, 0)}` : ""}</span>}
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full">
                {[["strongBuy", "bg-emerald-500"], ["buy", "bg-emerald-400/60"], ["hold", "bg-slate-500"], ["sell", "bg-rose-400/70"], ["strongSell", "bg-rose-500"]].map(([k, c]) => {
                  const n = s.ratings![k as keyof typeof s.ratings];
                  return n ? <div key={k} className={c} style={{ width: `${(n / total) * 100}%` }} title={`${k}: ${n}`} /> : null;
                })}
              </div>
              <div className="num mt-1 flex justify-between text-[10px] text-slate-500">
                <span>Buy {s.ratings.strongBuy + s.ratings.buy}</span>
                <span>Hold {s.ratings.hold}</span>
                <span>Sell {s.ratings.sell + s.ratings.strongSell}</span>
              </div>
            </div>
          )}

          {s.analystActions.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Recent analyst moves</div>
              <ul className="space-y-1 text-xs">
                {s.analystActions.slice(0, 5).map((x, i) => {
                  const ptDir = x.priceTarget && x.priorPriceTarget ? Math.sign(x.priceTarget - x.priorPriceTarget) : 0;
                  return (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="text-slate-300">
                        <span className="text-slate-500">{new Date(x.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span> {x.firm}
                        <span className={x.action === "up" ? "text-emerald-400" : x.action === "down" ? "text-rose-400" : "text-slate-400"}>
                          {" "}{x.action === "up" ? "upgraded" : x.action === "down" ? "downgraded" : x.action === "init" ? "initiated" : "kept"} {x.toGrade}
                        </span>
                      </span>
                      {x.priceTarget && (
                        <span className={`num shrink-0 ${ptDir > 0 ? "text-emerald-400" : ptDir < 0 ? "text-rose-400" : "text-slate-400"}`}>
                          PT {x.priorPriceTarget && x.priorPriceTarget !== x.priceTarget ? `${money(x.priorPriceTarget, 0)} → ` : ""}{money(x.priceTarget, 0)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {s.news.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Latest headlines</div>
              <ul className="space-y-2">
                {s.news.slice(0, 6).map((n) => (
                  <li key={n.link}>
                    <a href={n.link} target="_blank" rel="noreferrer" className="group block text-sm text-slate-200 hover:text-white">
                      <span className="group-hover:underline">{n.title}</span>
                      <span className="ml-2 text-[11px] text-slate-500">{n.publisher} · {ago(n.publishedAt)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
