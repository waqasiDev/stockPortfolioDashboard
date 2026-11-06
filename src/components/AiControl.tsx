"use client";
import { ChevronDown, Pause, Play, Power, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AiFeature, AiStatus } from "@/lib/types";

const FEATURE_LABEL: Record<AiFeature, string> = {
  advisor: "AI Advisor (stock analysis)",
  trader: "AI Trader",
  brief: "Morning brief",
  curator: "AI watchlist picks",
  journal: "Journal review",
  other: "Other",
};

const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);

/** Top-bar AI switch: shows status + today's spend; opens the pause / budget / usage panel. */
export default function AiControl({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [s, setS] = useState<AiStatus | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => fetch("/api/ai-status", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function post(body: unknown) {
    const r = await fetch("/api/ai-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setS(await r.json());
    onChanged();
  }

  if (!s) return null;
  const label = s.reason === "no-key" ? "AI off" : s.reason === "paused" ? "AI paused" : s.reason === "budget" ? "Budget reached" : `AI on · ${usd(s.today.cost)}`;
  const dot = s.active ? "bg-emerald-400" : s.reason === "budget" ? "bg-amber-400" : "bg-slate-500";

  return (
    <>
      <button
        className={`btn-outline px-2.5 text-xs ${s.active ? "" : "border-amber-500/30 text-amber-200"}`}
        onClick={() => setOpen((o) => !o)}
        title="AI on/off, daily budget and spending"
      >
        <i className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
        <ChevronDown size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)}>
          <div className="card absolute right-4 top-16 max-h-[80vh] w-[440px] max-w-[calc(100vw-2rem)] overflow-y-auto p-4 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Power size={15} /> AI &amp; costs</h3>
              <button className="btn-ghost p-1" onClick={() => setOpen(false)}><X size={16} /></button>
            </div>

            {/* switch */}
            <div className={`mb-4 rounded-lg p-3 ${s.active ? "bg-emerald-500/5 ring-1 ring-emerald-400/20" : "bg-amber-500/5 ring-1 ring-amber-400/20"}`}>
              <div className="mb-2 text-sm">
                {s.reason === "no-key" && <span className="text-slate-300">No OPENAI_API_KEY set — AI features are off.</span>}
                {s.reason === null && <span className="text-emerald-200"><b>AI is on.</b> Advisor, AI Trader, morning brief and watchlist picks can call OpenAI.</span>}
                {s.reason === "paused" && (
                  <span className="text-amber-100">
                    <b>All AI is paused</b>{s.pausedUntil ? ` until ${new Date(s.pausedUntil).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : " until you resume"}. No OpenAI calls are made; prices, alerts, health, checklists and earnings still work.
                  </span>
                )}
                {s.reason === "budget" && <span className="text-amber-100"><b>Daily budget reached</b> ({usd(s.settings.dailyBudgetUsd)}). AI resumes automatically tomorrow.</span>}
              </div>
              {s.enabled &&
                (s.paused ? (
                  <button className="btn-primary" onClick={() => post({ action: "resume" })}><Play size={14} /> Resume AI</button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-outline text-xs" onClick={() => post({ action: "pause", minutes: 60 })}><Pause size={13} /> Pause 1 hour</button>
                    <button className="btn-outline text-xs" onClick={() => post({ action: "pause", minutes: "tomorrow" })}><Pause size={13} /> Until tomorrow 8am ET</button>
                    <button className="btn-outline text-xs text-amber-200" onClick={() => post({ action: "pause" })}><Pause size={13} /> Until I resume</button>
                  </div>
                ))}
            </div>

            {/* budget */}
            <div className="mb-4">
              <label className="label">Daily budget (auto-pause when reached)</label>
              <div className="flex flex-wrap gap-1.5">
                {[0, 0.25, 0.5, 1, 2, 5].map((b) => (
                  <button
                    key={b}
                    onClick={() => post({ action: "settings", dailyBudgetUsd: b })}
                    className={`rounded-md px-2.5 py-1 text-xs ${s.settings.dailyBudgetUsd === b ? "bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/40" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
                  >
                    {b === 0 ? "No limit" : `$${b.toFixed(2)}/day`}
                  </button>
                ))}
              </div>
              {s.settings.dailyBudgetUsd > 0 && (
                <div className="mt-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full ${s.today.cost >= s.settings.dailyBudgetUsd ? "bg-amber-400" : "bg-violet-400"}`} style={{ width: `${Math.min(100, (s.today.cost / s.settings.dailyBudgetUsd) * 100)}%` }} />
                  </div>
                  <div className="num mt-1 text-[11px] text-slate-500">{usd(s.today.cost)} of {usd(s.settings.dailyBudgetUsd)} used today</div>
                </div>
              )}
            </div>

            {/* cost lever */}
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] p-3">
              <div>
                <div className="text-sm font-medium">Live web search</div>
                <div className="text-[11px] text-slate-500">For the Advisor &amp; morning brief. Fresher news, but each call costs roughly 5–10× more. Off = Yahoo headlines only.</div>
              </div>
              <button
                onClick={() => post({ action: "settings", webSearch: !s.settings.webSearch })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${s.settings.webSearch ? "bg-violet-500" : "bg-white/15"}`}
                aria-label="Toggle web search"
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${s.settings.webSearch ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>

            {/* usage */}
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <Stat k="Today" cost={s.today.cost} calls={s.today.calls} />
              <Stat k="Last 7 days" cost={s.last7.cost} calls={s.last7.calls} />
              <Stat k="Last 30 days" cost={s.last30.cost} calls={s.last30.calls} />
            </div>

            {s.history.length > 1 && (
              <div className="mb-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Daily spend (last {s.history.length} days)</div>
                <div className="flex h-12 items-end gap-1">
                  {s.history.map((h) => {
                    const max = Math.max(...s.history.map((x) => x.cost), 0.0001);
                    return <div key={h.date} title={`${h.date}: ${usd(h.cost)} · ${h.calls} calls`} className="flex-1 rounded-t bg-violet-400/70" style={{ height: `${Math.max(4, (h.cost / max) * 100)}%` }} />;
                  })}
                </div>
              </div>
            )}

            <div className="mb-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Where the money goes (30 days)</div>
              {Object.keys(s.byFeature30).length === 0 ? (
                <p className="text-xs text-slate-500">No AI calls yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(Object.entries(s.byFeature30) as [AiFeature, { calls: number; cost: number }][])
                    .sort((a, b) => b[1].cost - a[1].cost)
                    .map(([k, v]) => (
                      <li key={k} className="text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-300">{FEATURE_LABEL[k]}</span>
                          <span className="num text-slate-400">{v.calls} calls · <span className="text-slate-200">{usd(v.cost)}</span></span>
                        </div>
                        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/5">
                          <div className="h-full bg-violet-400/70" style={{ width: `${(v.cost / Math.max(s.last30.cost, 0.0001)) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <Pricing s={s} onSave={(p) => post({ action: "settings", ...p })} />
            <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
              Costs are estimates from the token counts OpenAI reports for each call × the prices above. Your OpenAI billing page is the source of truth.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ k, cost, calls }: { k: string; cost: number; calls: number }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className="num text-base font-semibold">{usd(cost)}</div>
      <div className="num text-[10px] text-slate-500">{calls} calls</div>
    </div>
  );
}

function Pricing({ s, onSave }: { s: AiStatus; onSave: (p: Partial<AiStatus["settings"]>) => void }) {
  const [open, setOpen] = useState(false);
  const [inp, setInp] = useState(String(s.settings.priceInputPerM));
  const [out, setOut] = useState(String(s.settings.priceOutputPerM));
  const [ws, setWs] = useState(String(s.settings.pricePerWebSearch));
  return (
    <div className="rounded-lg bg-white/[0.02] p-2.5">
      <button className="flex w-full items-center justify-between text-xs text-slate-400" onClick={() => setOpen((o) => !o)}>
        <span>Model pricing used for estimates</span>
        <span className="num">${s.settings.priceInputPerM}/M in · ${s.settings.priceOutputPerM}/M out</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Field label="$ / 1M input" v={inp} set={setInp} />
            <Field label="$ / 1M output" v={out} set={setOut} />
            <Field label="$ / web search" v={ws} set={setWs} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Check your model’s price on OpenAI’s pricing page.</span>
            <button className="btn-outline px-2 py-1 text-xs" onClick={() => onSave({ priceInputPerM: Number(inp), priceOutputPerM: Number(out), pricePerWebSearch: Number(ws) })}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, v, set }: { label: string; v: string; set: (s: string) => void }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-500">{label}</label>
      <input className="input num px-2 py-1 text-xs" type="number" step="0.01" min={0} value={v} onChange={(e) => set(e.target.value)} />
    </div>
  );
}
