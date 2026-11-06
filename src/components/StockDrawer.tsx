"use client";
import { Loader2, Trash2, X } from "lucide-react";
import { AiAnalysisCard, SentimentCard } from "./AiAnalysisCard";
import type { JournalDraft } from "./Journal";
import PreBuyCheck from "./PreBuyCheck";
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EnrichedHolding, EnrichedWatch } from "@/lib/types";
import { ActionBadge, ExtQuote, VerdictBadge, compact, money, pct, signedMoney, toneClass, upDown } from "./ui";

type Item = { kind: "watch"; data: EnrichedWatch } | { kind: "hold"; data: EnrichedHolding };
type Point = { date: string; close: number; sma50?: number; sma200?: number };
const RANGES = ["1M", "6M", "1Y", "5Y"] as const;

export default function StockDrawer({
  item,
  ownedAlso,
  aiEnabled,
  autoAnalyze,
  onClose,
  onChanged,
  onJournal,
}: {
  item: Item;
  ownedAlso?: EnrichedHolding;
  aiEnabled: boolean;
  autoAnalyze?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onJournal: (d: JournalDraft) => void;
}) {
  const d = item.data;
  const q = d.quote;
  const t = d.tech;
  const f = d.fund;
  const hold = item.kind === "hold" ? item.data : ownedAlso;
  const watch = item.kind === "watch" ? item.data : undefined;

  const [range, setRange] = useState<(typeof RANGES)[number]>("6M");
  const [points, setPoints] = useState<Point[]>([]);
  const [loadingChart, setLoadingChart] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setLoadingChart(true);
    fetch(`/api/chart/${d.symbol}?range=${range}`)
      .then((r) => r.json())
      .then((j) => setPoints(Array.isArray(j) ? j : []))
      .finally(() => setLoadingChart(false));
  }, [d.symbol, range]);

  const first = points[0]?.close;
  const last = points.at(-1)?.close;
  const rangeChg = first && last ? ((last - first) / first) * 100 : 0;
  const stroke = rangeChg >= 0 ? "#34d399" : "#fb7185";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#0d121c] shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/5 bg-[#0d121c]/95 px-6 py-4 backdrop-blur">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">{d.symbol}</h2>
              {d.analysis && <VerdictBadge verdict={d.analysis.verdict} score={d.analysis.score} />}
            </div>
            <p className="text-sm text-slate-400">
              {q?.name}
              {f?.sector && <span className="text-slate-500"> · {f.sector}</span>}
            </p>
          </div>
          <div className="flex items-start gap-4">
            {q && (
              <div className="text-right">
                <div className="num text-xl font-semibold">{money(q.price)}</div>
                <div className={`num text-sm ${upDown(q.change)}`}>
                  {signedMoney(q.change)} ({pct(q.changePct)})
                </div>
                <ExtQuote ext={q.ext} className="mt-0.5" />
              </div>
            )}
            <button className="btn-ghost p-1" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          {/* chart */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button key={r} onClick={() => setRange(r)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${r === range ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className={`num font-medium ${upDown(rangeChg)}`}>{pct(rangeChg)}</span>
                <span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-amber-400" /> 50d</span>
                <span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-violet-400" /> 200d</span>
              </div>
            </div>
            <div className="h-60">
              {loadingChart ? (
                <div className="flex h-full items-center justify-center text-slate-500">
                  <Loader2 className="animate-spin" />
                </div>
              ) : (
                <ResponsiveContainer>
                  <LineChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#ffffff0d" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", range === "5Y" ? { year: "2-digit", month: "short" } : { month: "short", day: "numeric" })} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
                    <YAxis domain={["auto", "auto"]} orientation="right" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip
                      contentStyle={{ background: "#151c2b", border: "1px solid #ffffff1a", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(v) => new Date(String(v)).toLocaleDateString()}
                      formatter={(v, n) => [money(Number(v)), n === "close" ? "Price" : n === "sma50" ? "50-day avg" : "200-day avg"]}
                    />
                    <Line isAnimationActive={false} type="monotone" dataKey="close" stroke={stroke} dot={false} strokeWidth={2} />
                    <Line isAnimationActive={false} type="monotone" dataKey="sma50" stroke="#fbbf24" dot={false} strokeWidth={1} strokeOpacity={0.8} />
                    <Line isAnimationActive={false} type="monotone" dataKey="sma200" stroke="#a78bfa" dot={false} strokeWidth={1} strokeOpacity={0.8} />
                    {watch?.targetPrice && <ReferenceLine ifOverflow="extendDomain" y={watch.targetPrice} stroke="#34d399" strokeDasharray="4 4" label={{ value: "Target", fill: "#34d399", fontSize: 10, position: "insideTopLeft" }} />}
                    {hold && <ReferenceLine ifOverflow="extendDomain" y={hold.avgPrice} stroke="#38bdf8" strokeDasharray="4 4" label={{ value: "Your cost", fill: "#38bdf8", fontSize: 10, position: "insideTopLeft" }} />}
                    {hold?.stopLoss && <ReferenceLine ifOverflow="extendDomain" y={hold.stopLoss} stroke="#fb7185" strokeDasharray="2 4" label={{ value: "Stop", fill: "#fb7185", fontSize: 10, position: "insideBottomLeft" }} />}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* position */}
          {hold && <PositionPanel hold={hold} onChanged={onChanged} onClose={onClose} onJournal={onJournal} />}
          {watch && <WatchPanel watch={watch} owned={!!ownedAlso} onChanged={onChanged} onClose={onClose} onJournal={onJournal} />}

          {/* AI advisor + free sentiment */}
          <AiAnalysisCard symbol={d.symbol} aiEnabled={aiEnabled} autoRun={autoAnalyze} currentPrice={q?.price} />
          <SentimentCard symbol={d.symbol} />

          {/* signals */}
          {d.analysis && (
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold">Why this score?</h3>
              <ul className="space-y-2">
                {d.analysis.signals.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${s.tone === "good" ? "bg-emerald-400" : s.tone === "bad" ? "bg-rose-400" : "bg-slate-500"}`} />
                    <span>
                      <span className={`font-medium ${toneClass[s.tone]}`}>{s.label}</span>
                      <span className="text-slate-400"> — {s.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* stats */}
          <section className="card p-4">
            <h3 className="mb-3 text-sm font-semibold">Key stats</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Stat k="Market cap" v={compact(q?.marketCap)} />
              <Stat k="P/E (TTM)" v={q?.trailingPE?.toFixed(1)} />
              <Stat k="Forward P/E" v={q?.forwardPE?.toFixed(1)} />
              <Stat k="PEG" v={f?.pegRatio?.toFixed(2)} />
              <Stat k="Dividend yield" v={q?.dividendYield ? `${q.dividendYield.toFixed(2)}%` : undefined} />
              <Stat k="RSI (14)" v={t?.rsi14?.toFixed(0)} />
              <Stat k="50-day avg" v={money(t?.sma50)} />
              <Stat k="200-day avg" v={money(t?.sma200)} />
              <Stat k="52w range" v={t?.low52 && t?.high52 ? `${t.low52.toFixed(2)} – ${t.high52.toFixed(2)}` : undefined} />
              <Stat k="Analyst target" v={f?.analystTarget ? `${money(f.analystTarget)}${f.analystCount ? ` (${f.analystCount})` : ""}` : undefined} />
              <Stat k="Rating" v={f?.recommendation?.replace("_", " ")} />
              <Stat k="Revenue growth" v={f?.revenueGrowth !== undefined ? pct(f.revenueGrowth * 100, 1) : undefined} />
              <Stat k="Profit margin" v={f?.profitMargin !== undefined ? pct(f.profitMargin * 100, 1, false) : undefined} />
              <Stat k="Volume / avg" v={q?.volume ? `${compact(q.volume)} / ${compact(q.avgVolume)}` : undefined} />
              <Stat k="Next earnings" v={q?.earningsDate ? new Date(q.earningsDate).toLocaleDateString() : undefined} />
            </dl>
            {f?.summary && <p className="mt-4 line-clamp-4 text-xs leading-relaxed text-slate-500">{f.summary}</p>}
          </section>

          <p className="pb-4 text-center text-[11px] text-slate-600">Scores are rule-based signals for research, not financial advice.</p>
        </div>
      </aside>
    </div>
  );
}

function Stat({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/5 py-1">
      <dt className="text-slate-500">{k}</dt>
      <dd className="num text-right text-slate-200">{v ?? "—"}</dd>
    </div>
  );
}

function PositionPanel({ hold, onChanged, onClose, onJournal }: { hold: EnrichedHolding; onChanged: () => void; onClose: () => void; onJournal: (d: JournalDraft) => void }) {
  const [edit, setEdit] = useState(false);
  const [qty, setQty] = useState(String(hold.qty));
  const [avg, setAvg] = useState(String(hold.avgPrice));
  const [stop, setStop] = useState(hold.stopLoss ? String(hold.stopLoss) : "");
  const [tp, setTp] = useState(hold.takeProfit ? String(hold.takeProfit) : "");
  const [sellQty, setSellQty] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch("/api/holdings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: hold.symbol, qty, avgPrice: avg, stopLoss: stop, takeProfit: tp }),
    });
    setBusy(false);
    setEdit(false);
    onChanged();
  }
  async function sell(all: boolean) {
    const n = Number(sellQty);
    if (!all && !(n > 0)) return;
    if (all && !confirm(`Remove ${hold.symbol} from your portfolio?`)) return;
    setBusy(true);
    await fetch(`/api/holdings?symbol=${hold.symbol}${all ? "" : `&qty=${n}`}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
    const soldAll = all || n >= hold.qty;
    onJournal({ symbol: hold.symbol, action: soldAll ? "SELL" : "TRIM", price: hold.quote?.price, qty: soldAll ? hold.qty : n });
    if (soldAll) onClose();
    setSellQty("");
  }

  const realizedIfSold = hold.quote && Number(sellQty) > 0 ? (hold.quote.price - hold.avgPrice) * Number(sellQty) : null;

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Your position</h3>
        {hold.action && <ActionBadge action={hold.action} />}
      </div>
      {hold.actionReason && <p className="mb-4 text-sm text-slate-400">{hold.actionReason}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi k="Shares" v={String(hold.qty)} />
        <Kpi k="Avg cost" v={money(hold.avgPrice)} />
        <Kpi k="Value" v={money(hold.value)} />
        <Kpi k="Total P/L" v={`${signedMoney(hold.pl)}`} sub={pct(hold.plPct)} cls={upDown(hold.pl)} />
      </div>

      {edit ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Shares" v={qty} set={setQty} />
            <Field label="Avg price" v={avg} set={setAvg} />
            <Field label="Stop-loss" v={stop} set={setStop} />
            <Field label="Take-profit" v={tp} set={setTp} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEdit(false)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>Save</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-xs text-slate-500">
            Stop-loss: <span className="num text-slate-300">{money(hold.stopLoss)}</span> · Take-profit:{" "}
            <span className="num text-slate-300">{money(hold.takeProfit)}</span>
          </div>
          <div className="flex items-center gap-2">
            <input className="input num w-24 py-1.5" type="number" placeholder="Qty" value={sellQty} onChange={(e) => setSellQty(e.target.value)} />
            <button className="btn-outline" onClick={() => sell(false)} disabled={busy || !sellQty}>Sell</button>
            <button className="btn-outline" onClick={() => setEdit(true)}>Edit</button>
            <button className="btn-ghost p-2 text-rose-400" onClick={() => sell(true)} title="Remove position">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      )}
      {realizedIfSold !== null && (
        <p className={`mt-2 text-right text-xs ${upDown(realizedIfSold)}`}>
          Selling {sellQty} at {money(hold.quote?.price)} realizes {signedMoney(realizedIfSold)}
        </p>
      )}
    </section>
  );
}

function WatchPanel({ watch, owned, onChanged, onClose, onJournal }: { watch: EnrichedWatch; owned: boolean; onChanged: () => void; onClose: () => void; onJournal: (d: JournalDraft) => void }) {
  const [target, setTarget] = useState(watch.targetPrice ? String(watch.targetPrice) : "");
  const [buying, setBuying] = useState(false);
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(watch.quote ? watch.quote.price.toFixed(2) : "");
  const [busy, setBusy] = useState(false);

  async function saveTarget() {
    setBusy(true);
    await fetch("/api/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: watch.symbol, targetPrice: target }) });
    setBusy(false);
    onChanged();
  }
  async function bought() {
    setBusy(true);
    await fetch("/api/holdings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: watch.symbol, qty, avgPrice: price, mode: "buy" }) });
    setBusy(false);
    setBuying(false);
    onChanged();
    onJournal({ symbol: watch.symbol, action: owned ? "ADD" : "BUY", price: Number(price) || undefined, qty: Number(qty) || null });
  }
  async function remove() {
    await fetch(`/api/watchlist?symbol=${watch.symbol}`, { method: "DELETE" });
    onChanged();
    onClose();
  }
  async function wl(action: "keep" | "adopt") {
    await fetch("/api/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: watch.symbol, action }) });
    onChanged();
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Watchlist
          {watch.addedBy === "ai" && <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-200">AI PICK</span>}
        </h3>
        {owned && <span className="text-xs text-sky-400">You own this</span>}
      </div>
      {watch.addedBy === "ai" && watch.aiReason && (
        <div className="mb-3 rounded-lg bg-violet-500/5 p-3 text-sm text-violet-100 ring-1 ring-violet-400/20">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">Why the AI added it · </span>
          {watch.aiReason}
          <div className="mt-2 text-xs text-slate-400">
            The AI may remove its own picks later.{" "}
            <button className="text-violet-300 hover:underline" onClick={() => wl("adopt")}>Make it mine (AI won’t remove it)</button>
          </div>
        </div>
      )}
      {watch.aiRemoveSuggestion && (
        <div className="mb-3 rounded-lg bg-amber-500/5 p-3 text-sm text-amber-100 ring-1 ring-amber-400/20">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">AI suggests removing · </span>
          {watch.aiRemoveSuggestion.reason}
          <div className="mt-2 flex gap-3 text-xs">
            <button className="text-rose-300 hover:underline" onClick={remove}>Remove it</button>
            <button className="text-slate-300 hover:underline" onClick={() => wl("keep")}>Keep it (don’t ask again)</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <label className="label">Target buy price</label>
          <input className="input num py-1.5" type="number" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <button className="btn-outline" onClick={saveTarget} disabled={busy}>Save target</button>
        {watch.distanceToTargetPct !== null && watch.distanceToTargetPct !== undefined && (
          <span className={`num mb-1.5 text-xs ${watch.distanceToTargetPct <= 0 ? "text-emerald-400" : "text-slate-400"}`}>
            {watch.distanceToTargetPct <= 0 ? "At/below target" : `${watch.distanceToTargetPct.toFixed(1)}% above target`}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn-primary" onClick={() => setBuying((b) => !b)}>I bought it</button>
          <button className="btn-ghost p-2 text-rose-400" onClick={remove} title="Remove from watchlist">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {buying && (
        <div className="mt-4 space-y-3 rounded-lg bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-28"><Field label="Shares" v={qty} set={setQty} /></div>
            <div className="w-32"><Field label="Price paid" v={price} set={setPrice} /></div>
            <button className="btn-primary" onClick={bought} disabled={busy || !qty}>Add to portfolio</button>
          </div>
          <PreBuyCheck symbol={watch.symbol} qty={Number(qty) || 0} price={Number(price) || undefined} />
        </div>
      )}
    </section>
  );
}

function Kpi({ k, v, sub, cls = "" }: { k: string; v: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className={`num font-semibold ${cls}`}>{v}</div>
      {sub && <div className={`num text-xs ${cls}`}>{sub}</div>}
    </div>
  );
}

function Field({ label, v, set }: { label: string; v: string; set: (s: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input num py-1.5" type="number" step="any" value={v} onChange={(e) => set(e.target.value)} />
    </div>
  );
}
