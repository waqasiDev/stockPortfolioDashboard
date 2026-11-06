"use client";
import { BookOpen, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Emotion, JournalAction, JournalEntry, JournalReview } from "@/lib/types";
import { Empty, money, pct, upDown } from "./ui";

type Row = JournalEntry & { priceNow: number | null; movePct: number | null; outcome: "right" | "wrong" | "too early"; daysAgo: number };

export interface JournalDraft {
  symbol: string;
  action: JournalAction;
  price?: number;
  qty?: number | null;
}

const ACTIONS: JournalAction[] = ["BUY", "ADD", "SELL", "TRIM", "WATCH", "PASS"];
const EMOTIONS: { k: Emotion; label: string }[] = [
  { k: "calm", label: "😌 Calm" },
  { k: "confident", label: "💪 Confident" },
  { k: "unsure", label: "🤔 Unsure" },
  { k: "fomo", label: "🏃 FOMO" },
  { k: "fearful", label: "😰 Fearful" },
  { k: "greedy", label: "🤑 Greedy" },
];
const actionCls: Record<JournalAction, string> = {
  BUY: "bg-emerald-500/15 text-emerald-300",
  ADD: "bg-emerald-500/10 text-emerald-300",
  SELL: "bg-rose-500/15 text-rose-300",
  TRIM: "bg-amber-500/15 text-amber-300",
  WATCH: "bg-sky-500/15 text-sky-300",
  PASS: "bg-white/5 text-slate-300",
};
const outcomeCls = { right: "text-emerald-400", wrong: "text-rose-400", "too early": "text-slate-500" } as const;

// ---------------- entry dialog (also used as the post-trade prompt) ----------------

export function JournalDialog({ draft, onClose, onSaved }: { draft: JournalDraft; onClose: () => void; onSaved?: () => void }) {
  const [symbol, setSymbol] = useState(draft.symbol);
  const [action, setAction] = useState<JournalAction>(draft.action);
  const [price, setPrice] = useState(draft.price ? String(draft.price) : "");
  const [qty, setQty] = useState(draft.qty ? String(draft.qty) : "");
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState(3);
  const [emotion, setEmotion] = useState<Emotion | undefined>();
  const [horizon, setHorizon] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isPrompt = Boolean(draft.symbol);

  async function save() {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/journal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol, action, price: Number(price) || undefined, qty: Number(qty) || null, reasoning, confidence, emotion, horizon }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    onSaved?.();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card w-full max-w-lg p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold"><BookOpen size={17} className="text-sky-300" /> {isPrompt ? "Log this decision" : "New journal entry"}</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          {isPrompt ? "10 seconds now = a much better investor later. The AI reviews your entries to find patterns." : "Record why you're making a decision — the AI reviews patterns over time."}
        </p>

        <div className="mb-3 grid grid-cols-3 gap-3">
          <div>
            <label className="label">Stock</label>
            <input className="input uppercase" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="NVDA" />
          </div>
          <div>
            <label className="label">Price</label>
            <input className="input num" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="live" />
          </div>
          <div>
            <label className="label">Shares</label>
            <input className="input num" type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ACTIONS.map((a) => (
            <button key={a} onClick={() => setAction(a)} className={`rounded-md px-2.5 py-1 text-xs font-bold ${action === a ? actionCls[a] + " ring-1 ring-white/20" : "bg-white/5 text-slate-500"}`}>{a}</button>
          ))}
        </div>
        <label className="label">Why? (your thesis in a sentence or two)</label>
        <textarea autoFocus className="input mb-3 min-h-[80px]" value={reasoning} onChange={(e) => setReasoning(e.target.value)} placeholder="e.g. Pulled back to the 50-day avg, earnings growth 40%, AI says accumulate on dips. Will sell if it closes below $165." />

        <div className="mb-3">
          <label className="label">How do you feel?</label>
          <div className="flex flex-wrap gap-1.5">
            {EMOTIONS.map((e) => (
              <button key={e.k} onClick={() => setEmotion(emotion === e.k ? undefined : e.k)} className={`rounded-full px-2.5 py-1 text-xs ${emotion === e.k ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40" : "bg-white/5 text-slate-400"}`}>{e.label}</button>
            ))}
          </div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Confidence</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setConfidence(n)} className={`num h-8 flex-1 rounded-md text-sm ${n <= confidence ? "bg-sky-500/25 text-sky-200" : "bg-white/5 text-slate-500"}`}>{n}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Time horizon</label>
            <select className="input" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
              <option value="">—</option>
              <option>Days</option>
              <option>Weeks</option>
              <option>Months</option>
              <option>Years</option>
            </select>
          </div>
        </div>
        {err && <p className="mb-3 text-sm text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>{isPrompt ? "Skip" : "Cancel"}</button>
          <button className="btn-primary" disabled={busy || !symbol || !reasoning.trim()} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Save entry</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Journal tab ----------------

export default function Journal({ onOpenSymbol, aiEnabled }: { onOpenSymbol: (s: string) => void; aiEnabled: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [review, setReview] = useState<JournalReview | null>(null);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const j = await fetch("/api/journal", { cache: "no-store" }).then((r) => r.json());
    setRows(j.entries);
    setReview(j.review);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function runReview() {
    setReviewing(true);
    setErr("");
    const r = await fetch("/api/journal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "review" }) });
    const j = await r.json();
    setReviewing(false);
    if (!r.ok) return setErr(j.error);
    setReview(j.review);
  }

  async function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/journal?id=${id}`, { method: "DELETE" });
    load();
  }

  if (!rows) return <div className="card h-64 animate-pulse" />;

  const decided = rows.filter((r) => r.outcome !== "too early");
  const hitRate = decided.length ? (decided.filter((r) => r.outcome === "right").length / decided.length) * 100 : null;
  const byEmotion = (["calm", "confident", "unsure", "fomo", "fearful", "greedy"] as Emotion[])
    .map((e) => {
      const xs = decided.filter((r) => r.emotion === e);
      return { e, n: xs.length, rate: xs.length ? (xs.filter((r) => r.outcome === "right").length / xs.length) * 100 : 0 };
    })
    .filter((x) => x.n > 0);
  const againstAi = decided.filter((r) => {
    const rec = r.snapshot?.aiRecommendation;
    if (!rec) return false;
    const aiBull = ["Strong Buy", "Buy", "Accumulate on Dips"].includes(rec);
    const userBull = ["BUY", "ADD", "WATCH"].includes(r.action);
    return aiBull !== userBull;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpen size={20} className="text-sky-300" /> Decision journal</h2>
          <p className="text-xs text-slate-500">Every buy/sell you log is graded against what the price did next — the fastest way to learn what works for you.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => setAdding(true)}><Plus size={14} /> New entry</button>
          <button className="btn bg-violet-500 text-white hover:bg-violet-400" disabled={!aiEnabled || reviewing || rows.length < 3} onClick={runReview} title={rows.length < 3 ? "Needs at least 3 entries" : ""}>
            {reviewing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {reviewing ? "Reviewing…" : "AI review my decisions"}
          </button>
        </div>
      </div>
      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{err}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Entries" value={String(rows.length)} sub={`${decided.length} with a clear outcome`} />
        <Stat label="Hit rate" value={hitRate === null ? "—" : `${hitRate.toFixed(0)}%`} sub="price moved your way (±2%+)" />
        <Stat label="Best mood" value={byEmotion.length ? byEmotion.sort((a, b) => b.rate - a.rate)[0].e : "—"} sub={byEmotion.length ? `${byEmotion[0].rate.toFixed(0)}% right when ${byEmotion[0].e}` : "tag emotions to see this"} />
        <Stat label="Went against AI" value={String(againstAi.length)} sub={againstAi.length ? `${againstAi.filter((r) => r.outcome === "right").length} of them worked out` : "no conflicts yet"} />
      </div>

      {review && <ReviewCard review={review} />}

      <section className="card overflow-hidden">
        {rows.length === 0 ? (
          <Empty title="No entries yet">You’ll be prompted to log a quick note whenever you buy or sell in the app — or add one now.</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {rows.map((r) => (
              <li key={r.id} className="group px-4 py-3 hover:bg-white/[0.02]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${actionCls[r.action]}`}>{r.action}</span>
                    <button className="font-semibold hover:underline" onClick={() => onOpenSymbol(r.symbol)}>{r.symbol}</button>
                    <span className="num text-sm text-slate-400">{r.qty ? `${r.qty} @ ` : "@ "}{money(r.price)}</span>
                    <span className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleDateString()} · {r.daysAgo}d ago</span>
                    {r.emotion && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">{EMOTIONS.find((e) => e.k === r.emotion)?.label}</span>}
                    <span className="text-[11px] text-slate-500">conf {r.confidence}/5</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.movePct !== null && (
                      <span className="num text-sm">
                        <span className="text-slate-500">now {money(r.priceNow)} </span>
                        <span className={upDown(r.movePct)}>{pct(r.movePct, 1)}</span>
                      </span>
                    )}
                    <span className={`text-xs font-semibold uppercase ${outcomeCls[r.outcome]}`}>{r.outcome === "right" ? "✓ right" : r.outcome === "wrong" ? "✗ wrong" : "too early"}</span>
                    <button className="invisible text-slate-500 hover:text-rose-400 group-hover:visible" onClick={() => remove(r.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
                <p className="mt-1.5 text-sm text-slate-300">{r.reasoning}</p>
                {r.snapshot && (r.snapshot.buyScore !== undefined || r.snapshot.aiRecommendation) && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    At the time: buy score {r.snapshot.buyScore} ({r.snapshot.verdict}){r.snapshot.rsi !== undefined && ` · RSI ${r.snapshot.rsi}`}
                    {r.snapshot.aiRecommendation && <> · AI said <span className="text-violet-300">{r.snapshot.aiRecommendation}</span> ({r.snapshot.aiConfidence}%)</>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {adding && <JournalDialog draft={{ symbol: "", action: "BUY" }} onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold capitalize">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function ReviewCard({ review }: { review: JournalReview }) {
  const gradeCls = review.grade.startsWith("A") || review.grade.startsWith("B") ? "text-emerald-300 bg-emerald-500/15" : review.grade.startsWith("C") ? "text-amber-300 bg-amber-500/15" : "text-rose-300 bg-rose-500/15";
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/5 bg-gradient-to-r from-violet-500/10 to-transparent px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-violet-400" /> AI coach review</h3>
        <span className="text-[11px] text-slate-500">{new Date(review.createdAt).toLocaleString()}</span>
      </header>
      <div className="space-y-4 p-4">
        <div className="flex gap-4">
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold ${gradeCls}`}>{review.grade}</span>
          <p className="text-sm leading-relaxed text-slate-200">{review.summary}</p>
        </div>
        <div className="grid gap-4 text-sm md:grid-cols-3">
          <List title="What you do well" items={review.strengths} cls="text-emerald-400" />
          <List title="What’s costing you" items={review.mistakes} cls="text-rose-400" />
          <List title="Rules to adopt" items={review.lessons} cls="text-sky-300" />
        </div>
        {review.biases.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Biases spotted</h4>
            <div className="flex flex-wrap gap-2">
              {review.biases.map((b, i) => (
                <div key={i} className="rounded-lg bg-amber-500/5 px-3 py-2 text-xs ring-1 ring-amber-400/20">
                  <span className="font-semibold text-amber-200">{b.name}: </span><span className="text-slate-400">{b.evidence}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg bg-violet-500/5 p-3 text-sm text-violet-100">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">You vs AI Trader · </span>{review.vsAiTrader}
        </div>
      </div>
    </section>
  );
}

function List({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  return (
    <div>
      <h4 className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>{title}</h4>
      <ul className="space-y-1.5 text-slate-300">{items.map((x, i) => <li key={i}>• {x}</li>)}</ul>
    </div>
  );
}
