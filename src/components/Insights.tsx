"use client";
import { CalendarClock, CheckCircle2, ExternalLink, HeartPulse, Loader2, RefreshCw, Sunrise, TriangleAlert, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { EarningsEvent, HealthReport, MorningBrief } from "@/lib/types";
import { Empty, compact, money } from "./ui";

// ---------------- Morning brief ----------------

export function MorningBriefCard({ onOpen, onChanged }: { onOpen: (s: string, analyze?: boolean) => void; onChanged: () => void }) {
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [today, setToday] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiOn, setAiOn] = useState(true);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/brief", { cache: "no-store" }).then((r) => r.json());
    setBrief(j.brief);
    setToday(j.today);
    setAiOn(j.aiEnabled);
    setBusy(j.generating);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // background generation in progress → poll
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [busy, load]);

  async function generate() {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/brief", { method: "POST" });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    setBrief(j.brief);
    onChanged(); // watchlist may have changed
  }

  const stale = brief && brief.date !== today;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/5 bg-gradient-to-r from-amber-500/10 via-transparent to-transparent px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sunrise size={16} className="text-amber-300" /> Morning brief
          {brief && <span className="text-xs font-normal text-slate-500">{stale ? `from ${brief.date}` : "today"}</span>}
        </h3>
        {aiOn && (
          <button className="btn-ghost px-2 py-1 text-xs" onClick={generate} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {busy ? "Writing your brief…" : brief && !stale ? "Regenerate" : "Generate today’s brief"}
          </button>
        )}
      </header>

      {!brief ? (
        busy ? (
          <div className="flex items-center gap-2 p-5 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Reading today’s news, checking your positions and refreshing AI watchlist picks… (~1 min)</div>
        ) : (
          <Empty title={aiOn ? "No brief yet" : "AI is off"}>
            {aiOn ? "It’s generated automatically every weekday after 8:30am ET while the app is running — or generate one now." : "Add OPENAI_API_KEY to .env.local to get a daily brief."}
          </Empty>
        )
      ) : (
        <div className={`space-y-4 p-4 ${busy ? "opacity-60" : ""}`}>
          <p className="text-[15px] font-semibold leading-snug text-slate-100">{brief.headline}</p>

          <ol className="grid gap-2 md:grid-cols-3">
            {brief.topActions.map((a, i) => (
              <li
                key={i}
                className={`rounded-lg border border-white/5 bg-white/[0.03] p-3 ${a.symbol ? "cursor-pointer hover:border-amber-400/30" : ""}`}
                onClick={() => a.symbol && onOpen(a.symbol, true)}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="num flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-[11px] font-bold text-amber-200">{i + 1}</span>
                  {a.symbol && <span className="text-xs font-semibold text-slate-300">{a.symbol}</span>}
                </div>
                <p className="text-sm font-medium text-slate-100">{a.action}</p>
                <p className="mt-1 text-xs text-slate-400">{a.why}</p>
              </li>
            ))}
          </ol>

          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Market backdrop</h4>
              <p className="text-slate-300">{brief.marketBackdrop}</p>
            </div>
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Your portfolio</h4>
              <p className="text-slate-300">{brief.portfolioPulse}</p>
            </div>
          </div>

          {expanded && (
            <div className="grid gap-4 text-sm md:grid-cols-2">
              {brief.watchToday.length > 0 && (
                <div>
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Watch today</h4>
                  <ul className="space-y-1">
                    {brief.watchToday.map((w) => (
                      <li key={w.symbol} className="cursor-pointer text-slate-300 hover:text-white" onClick={() => onOpen(w.symbol)}>
                        <span className="font-semibold">{w.symbol}</span> <span className="text-slate-400">— {w.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Risks</h4>
                <ul className="ml-4 list-disc space-y-1 text-slate-300 marker:text-slate-600">{brief.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              {brief.earningsWatch.length > 0 && (
                <div>
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Earnings watch</h4>
                  <ul className="space-y-1">{brief.earningsWatch.map((e) => <li key={e.symbol} className="text-slate-300"><span className="font-semibold">{e.symbol}</span> <span className="text-slate-500">{e.date}</span> — {e.note}</li>)}</ul>
                </div>
              )}
              {brief.watchlistChanges.length > 0 && (
                <div>
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">AI watchlist changes</h4>
                  <ul className="space-y-1 text-slate-300">{brief.watchlistChanges.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </div>
              )}
              <div className="md:col-span-2 rounded-lg bg-violet-500/5 p-3 text-violet-200">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">Mindset · </span>{brief.mindsetTip}
              </div>
              {brief.sources.length > 0 && (
                <div className="md:col-span-2 flex flex-wrap gap-1.5">
                  {brief.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[240px] items-center gap-1 truncate rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200">
                      <ExternalLink size={10} className="shrink-0" /><span className="truncate">{s.title || s.url}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="text-xs text-amber-300/90 hover:underline" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Show less" : `Watch list, risks${brief.earningsWatch.length ? ", earnings" : ""}${brief.watchlistChanges.length ? ", AI watchlist changes" : ""} & mindset tip →`}
          </button>
        </div>
      )}
      {err && <p className="px-4 pb-3 text-sm text-rose-400">{err}</p>}
    </section>
  );
}

// ---------------- Health ----------------

const gradeColor: Record<HealthReport["grade"], string> = {
  A: "text-emerald-300",
  B: "text-emerald-400",
  C: "text-amber-300",
  D: "text-orange-400",
  F: "text-rose-400",
};

export function HealthCard({ health }: { health: HealthReport | null }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><HeartPulse size={15} className="text-rose-300" /> Portfolio health</h3>
      </header>
      {!health ? (
        <Empty title="Add holdings to get a health score" />
      ) : (
        <div className="space-y-4 p-4">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0">
              <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#ffffff14" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(health.score / 100) * 97.4} 97.4`} className={gradeColor[health.grade]} />
              </svg>
              <span className={`absolute inset-0 flex items-center justify-center text-xl font-bold ${gradeColor[health.grade]}`}>{health.grade}</span>
            </div>
            <div>
              <div className="num text-2xl font-semibold">{health.score}<span className="text-sm text-slate-500">/100</span></div>
              <div className="text-sm text-slate-400">{health.label}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <Mini k="Largest position" v={`${health.topHoldingPct.toFixed(0)}%`} bad={health.topHoldingPct > 25} warn={health.topHoldingPct > 15} />
            <Mini k="Top 3" v={`${health.top3Pct.toFixed(0)}%`} warn={health.top3Pct > 60} />
            <Mini k="Speculative" v={`${health.speculativePct.toFixed(0)}%`} bad={health.speculativePct > 30} warn={health.speculativePct > 15} />
            <Mini k="With stop-loss" v={`${health.stopsCoveragePct.toFixed(0)}%`} warn={health.stopsCoveragePct < 50} />
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Sector mix</div>
            <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
              {health.sectors.map((s, i) => (
                <div key={s.sector} title={`${s.sector}: ${s.weight.toFixed(0)}%`} style={{ width: `${s.weight}%`, background: SECTOR_COLORS[i % SECTOR_COLORS.length] }} className="border-r-2 border-[#111723] last:border-r-0" />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
              {health.sectors.slice(0, 6).map((s, i) => (
                <span key={s.sector} className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />{s.sector} {s.weight.toFixed(0)}%</span>
              ))}
            </div>
          </div>

          <ul className="space-y-1.5 text-sm">
            {health.issues.map((x, i) => (
              <li key={i} className="flex gap-2">
                {x.severity === "bad" ? <XCircle size={15} className="mt-0.5 shrink-0 text-rose-400" /> : <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-400" />}
                <span className="text-slate-300">{x.text}</span>
              </li>
            ))}
            {health.strengths.map((x, i) => (
              <li key={`s${i}`} className="flex gap-2">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                <span className="text-slate-400">{x}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const SECTOR_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#2dd4bf", "#fb923c", "#94a3b8"];

function Mini({ k, v, warn, bad }: { k: string; v: string; warn?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
      <div className="text-slate-500">{k}</div>
      <div className={`num text-sm font-semibold ${bad ? "text-rose-300" : warn ? "text-amber-300" : "text-slate-200"}`}>{v}</div>
    </div>
  );
}

// ---------------- Earnings ----------------

export function EarningsCard({ events, onOpen }: { events: EarningsEvent[]; onOpen: (s: string, analyze?: boolean) => void }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock size={15} className="text-sky-300" /> Upcoming earnings</h3>
        <span className="text-[11px] text-slate-500">next 3 weeks</span>
      </header>
      {events.length === 0 ? (
        <Empty title="No earnings in the next 3 weeks">for your holdings or watchlist.</Empty>
      ) : (
        <ul className="divide-y divide-white/5">
          {events.map((e) => (
            <li key={e.symbol} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03]" onClick={() => onOpen(e.symbol, e.owned)}>
              <div className={`w-12 shrink-0 rounded-md py-1 text-center ${e.daysAway <= 3 ? "bg-amber-500/15 text-amber-200" : "bg-white/5 text-slate-300"}`}>
                <div className="text-[10px] uppercase">{new Date(e.date).toLocaleDateString([], { month: "short" })}</div>
                <div className="num text-sm font-bold leading-tight">{new Date(e.date).getDate()}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{e.symbol}</span>
                  {e.owned ? <span className="rounded bg-sky-500/15 px-1 text-[10px] text-sky-300">OWNED</span> : <span className="rounded bg-white/5 px-1 text-[10px] text-slate-400">WATCHING</span>}
                  <span className={`text-xs ${e.daysAway <= 3 ? "text-amber-300" : "text-slate-500"}`}>{e.daysAway === 0 ? "today" : e.daysAway === 1 ? "tomorrow" : `in ${e.daysAway} days`}</span>
                </div>
                <div className="truncate text-xs text-slate-500">
                  {e.epsEstimate !== undefined ? `EPS est. $${e.epsEstimate.toFixed(2)}` : "No estimate"}
                  {e.revenueEstimate ? ` · Revenue est. $${compact(e.revenueEstimate)}` : ""}
                  {e.owned && e.positionValue ? ` · your position ${money(e.positionValue, 0)}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {events.some((e) => e.owned && e.daysAway <= 7) && (
        <p className="border-t border-white/5 px-4 py-2.5 text-xs text-slate-400">
          💡 Before a report, decide your plan: hold through it, trim to reduce risk, or set a stop. Click a stock for the AI’s take.
        </p>
      )}
    </section>
  );
}
