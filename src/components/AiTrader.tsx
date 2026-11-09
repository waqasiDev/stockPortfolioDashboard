"use client";
import { Bot, ChevronDown, ChevronRight, Clock, Loader2, Moon, Pause, Play, Plus, Radar, RotateCcw, Settings2, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PendingOrder, RiskProfile, RunTrigger, ScanEvent, Sensitivity, Trade, TraderConfig, TraderMode, TraderRun, TraderView } from "@/lib/types";
import SignalsCard from "./SignalsCard";
import { Empty, ExtQuote, money, pct, signedMoney, upDown } from "./ui";

// validated pair (dark surface): AI = violet, benchmark = blue + dashed as secondary encoding
const C_AI = "#8b5cf6";
const C_BENCH = "#0b94cf";

const RISK: Record<RiskProfile, { label: string; blurb: string; limits: string }> = {
  conservative: { label: "Conservative", blurb: "Quality large caps, buy dips, cut losers fast", limits: "≤15% per stock · 20% cash · 8% stops" },
  balanced: { label: "Balanced", blurb: "Quality growth at a fair price, trims winners", limits: "≤20% per stock · 10% cash · 10% stops" },
  aggressive: { label: "Aggressive", blurb: "High-conviction momentum & catalysts", limits: "≤30% per stock · 5% cash · 15% stops" },
};
const MODES: { k: TraderMode; t: string; d: string }[] = [
  { k: "event", t: "⚡ Event-driven", d: "Scans 100 stocks every minute for free; wakes the AI only when an opportunity or risk appears. Plus reviews at 9:45 & 3:30." },
  { k: "scheduled", t: "⏱ Scheduled", d: "Runs a full review on a fixed timer during market hours." },
  { k: "manual", t: "✋ Manual", d: "Only trades when you click Run AI now." },
];

const TRIGGER_LABEL: Record<RunTrigger, string> = {
  manual: "Manual run",
  scheduled: "Scheduled run",
  event: "Triggered by scanner",
  "open-review": "🌅 Post-open review (9:45 ET)",
  "close-review": "🌇 Pre-close review (3:30 ET)",
  "market-move": "📉 Market-move review",
};

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}

const INTERVALS = [
  { m: 60, label: "Every hour" },
  { m: 240, label: "Every 4 hours" },
  { m: 1440, label: "Once a day" },
];

async function post(body: unknown) {
  const r = await fetch("/api/trader", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
}

export default function AiTrader({ onOpenSymbol }: { onOpenSymbol: (s: string) => void }) {
  const [view, setView] = useState<TraderView | null | undefined>(undefined);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [err, setErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState("");

  async function closePosition(symbol: string) {
    const open = view?.marketState === "REGULAR";
    if (!confirm(open ? `Close the AI's ${symbol} position at market?` : `Market is closed — queue a sell of the AI's ${symbol} position for the next open?`)) return;
    setErr("");
    const r = await fetch("/api/trader", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close", symbol }) });
    const j = await r.json();
    if (!r.ok) setErr(j.error);
    else setNotice(j.result === "queued" ? `${symbol} sell queued — it will fill after the next market open.` : `${symbol} position closed.`);
    load();
  }

  const load = useCallback(async () => {
    const r = await fetch("/api/trader", { cache: "no-store" });
    const j = await r.json();
    if (j.error) setErr(j.error);
    setView(j.view);
    setAiEnabled(j.aiEnabled);
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  // poll fast while the AI is working, slowly otherwise
  useEffect(() => {
    const id = setInterval(load, view?.running ? 3000 : 60_000);
    return () => clearInterval(id);
  }, [load, view?.running]);

  async function act(body: unknown) {
    setErr("");
    try {
      await post(body);
    } catch (e) {
      setErr((e as Error).message);
    }
    await load();
  }

  if (view === undefined) return <div className="card h-64 animate-pulse" />;
  if (view === null) return <Setup aiEnabled={aiEnabled} err={err} onStart={(amount, config) => act({ action: "start", amount, config })} />;

  const v = view;
  const alpha = v.totalReturnPct - v.benchmarkReturnPct;
  const lastRun = v.state.runs[0];

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Bot size={20} className="text-violet-400" /> AI Trader
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-300">Paper money</span>
          </h2>
          <p className="text-xs text-slate-500">
            {RISK[v.state.config.risk].label} · {v.state.config.universe === "discover" ? "Watchlist + AI discovery" : "Your watchlist only"} · started{" "}
            {new Date(v.state.startedAt).toLocaleDateString()} ·{" "}
            {v.scanner.mode === "event" ? (
              <>⚡ event-driven ({v.scanner.sensitivity}) · {v.scanner.runsToday}/{v.scanner.maxRunsPerDay} AI runs today{v.scanner.lastScanAt ? ` · scanned ${v.scanner.universeSize} stocks ${ago(v.scanner.lastScanAt)}` : " · scanner starts at market open"}{v.scanner.pending ? ` · ${v.scanner.pending} trigger${v.scanner.pending > 1 ? "s" : ""} queued` : ""}</>
            ) : v.scanner.mode === "scheduled" && v.state.config.autoRun ? (
              <>auto-trades {INTERVALS.find((i) => i.m === v.state.config.intervalMinutes)?.label.toLowerCase() ?? `every ${v.state.config.intervalMinutes}m`} during market hours{v.nextRunAt && !v.running ? ` · next ≈ ${new Date(v.nextRunAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}</>
            ) : (
              "manual mode — trades only when you click Run AI now"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`btn-outline ${v.state.config.paused ? "border-amber-400/40 text-amber-200" : ""}`}
            onClick={() => act({ action: "pause", paused: !v.state.config.paused })}
            title={v.state.config.paused ? "Resume the AI Trader" : "Pause the AI Trader: no scanning, AI runs or queued fills (stop-losses still protect)"}
          >
            {v.state.config.paused ? <Play size={14} /> : <Pause size={14} />} {v.state.config.paused ? "Resume trader" : "Pause trader"}
          </button>
          {v.scanner.mode === "event" && !v.state.config.paused && (
            <button className="btn-outline" disabled={v.running || scanning} onClick={async () => { setScanning(true); await act({ action: "scan" }); setScanning(false); }} title="Check all triggers right now (works outside market hours too)">
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />} Scan now
            </button>
          )}
          <button className="btn-outline" onClick={() => setShowDeposit(true)}><Plus size={14} /> Add funds</button>
          <button className="btn-outline" onClick={() => setShowSettings(true)}><Settings2 size={14} /> Settings</button>
          <button className="btn bg-violet-500 text-white hover:bg-violet-400" disabled={v.running || !aiEnabled} onClick={() => act({ action: "run" })}>
            {v.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {v.running ? "AI is trading…" : v.marketState && v.marketState !== "REGULAR" ? "Run AI now (queues orders)" : "Run AI now"}
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{err}</div>}
      {notice && <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-200">{notice}</div>}
      {v.state.config.paused && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
          <Pause size={16} className="mt-0.5 shrink-0" />
          <span>
            <b>AI Trader is paused.</b> No scanning, no AI calls and no queued-order fills (pending orders stay queued and still expire after 3 days). Stop-losses and take-profits keep protecting open positions.
          </span>
        </div>
      )}
      {v.marketState && v.marketState !== "REGULAR" && (
        <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-300">
          <Moon size={16} className="mt-0.5 shrink-0 text-slate-400" />
          <span>
            <span className="font-semibold text-slate-100">US market is closed{v.marketState.startsWith("PRE") ? " (pre-market)" : v.marketState.startsWith("POST") ? " (after hours)" : ""}.</span>{" "}
            The AI Trader only trades during regular hours (9:30–16:00 ET). It can still analyze now, but any buy/sell is queued and fills a few minutes after the next open — queued buys are cancelled if the stock opens more than 3% higher.
          </span>
        </div>
      )}
      {v.running && (
        <div className="flex items-center gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">
          <Loader2 size={16} className="animate-spin" />
          Researching candidates (news, analyst moves, technicals, valuation) and deciding trades… this usually takes 1–2 minutes.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Account value" value={money(v.equity)} sub={`Deposited ${money(v.state.deposited, 0)}`} />
        <Kpi label="AI return" value={pct(v.totalReturnPct)} sub={signedMoney(v.totalReturn)} tone={v.totalReturn} />
        <Kpi label="S&P 500 (same $)" value={pct(v.benchmarkReturnPct)} sub={money(v.benchmarkValue)} tone={v.benchmarkReturnPct} />
        <Kpi label="AI vs S&P 500" value={`${alpha >= 0 ? "+" : ""}${alpha.toFixed(2)} pts`} sub={alpha >= 0 ? "Beating the market" : "Trailing the market"} tone={alpha} />
        <Kpi label="Win rate" value={v.winRate === null ? "—" : `${v.winRate.toFixed(0)}%`} sub={`${v.closedTrades} closed · realized ${signedMoney(v.realizedPl)}`} />
        <Kpi label="Cash · Max drawdown" value={money(v.state.cash, 0)} sub={`Drawdown −${v.maxDrawdownPct.toFixed(1)}%`} />
      </div>

      <Verdict v={v} alpha={alpha} />

      {/* equity chart */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Account value vs. S&amp;P 500</h3>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={C_AI} strokeWidth="2" /></svg> AI Trader</span>
            <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={C_BENCH} strokeWidth="2" strokeDasharray="4 3" /></svg> S&amp;P 500 (SPY)</span>
          </div>
        </div>
        <div className="h-64">
          {v.state.equityHistory.length < 2 ? (
            <Empty title="The chart fills in as the AI trades">Equity is recorded every 30 minutes while the app is running.</Empty>
          ) : (
            <ResponsiveContainer>
              <LineChart data={v.state.equityHistory} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#ffffff0d" vertical={false} />
                <XAxis dataKey="at" tickFormatter={(x) => new Date(x).toLocaleDateString([], { month: "short", day: "numeric" })} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={50} />
                <YAxis orientation="right" domain={["auto", "auto"]} allowDecimals={false} tickFormatter={(x) => money(Number(x), 0)} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip
                  cursor={{ stroke: "#ffffff30" }}
                  contentStyle={{ background: "#151c2b", border: "1px solid #ffffff1a", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  itemStyle={{ color: "#e2e8f0" }}
                  labelFormatter={(x) => new Date(String(x)).toLocaleString()}
                  formatter={(val, name) => [money(Number(val)), name === "equity" ? "AI Trader" : "S&P 500"]}
                />
                <Line isAnimationActive={false} type="monotone" dataKey="benchmark" stroke={C_BENCH} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="equity" stroke={C_AI} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-5">
        {/* positions */}
        <section className="card overflow-hidden xl:col-span-3">
          <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <h3 className="text-sm font-semibold">AI positions</h3>
            <span className="text-xs text-slate-500">{v.positions.length} holdings · {money(v.invested, 0)} invested</span>
          </header>
          {v.positions.length === 0 ? (
            <Empty title="All cash for now">{v.running ? "The AI is deciding what to buy…" : "The AI hasn't found a setup it likes yet — that's a valid decision."}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead className="border-b border-white/5">
                  <tr>
                    <th className="th">Stock</th>
                    <th className="th text-right">Shares · Avg</th>
                    <th className="th text-right">Price</th>
                    <th className="th text-right">Value</th>
                    <th className="th text-right">P/L</th>
                    <th className="th text-right">Stop / Target</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {v.positions.map((p) => (
                    <PositionRow key={p.symbol} p={p} onClose={() => closePosition(p.symbol)} onOpen={() => onOpenSymbol(p.symbol)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* latest decision */}
        <section className="card overflow-hidden xl:col-span-2">
          <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={14} className="text-violet-400" /> Latest AI decision</h3>
            {lastRun && <span className="text-[11px] text-slate-500">{new Date(lastRun.at).toLocaleString()}</span>}
          </header>
          {lastRun ? <RunDetail run={lastRun} /> : <Empty title="No runs yet" />}
        </section>
      </div>

      {v.orders.length > 0 && <OrdersCard orders={v.orders} onCancel={(id) => act({ action: "cancelOrder", id })} />}
      <SignalsCard />
      {v.scanner.mode === "event" && <ActivityLog log={v.scanner.log} />}
      <TradeLog trades={v.state.trades} />
      <RunHistory runs={v.state.runs.slice(1)} />

      <p className="text-center text-[11px] text-slate-600">
        Simulated fills at the live quote ±0.05% slippage, no commissions. Past paper performance does not guarantee real results. Not financial advice.
      </p>

      {showSettings && <SettingsDialog config={v.state.config} onClose={() => setShowSettings(false)} onSave={(c) => act({ action: "config", config: c }).then(() => setShowSettings(false))} onReset={() => act({ action: "reset" }).then(() => setShowSettings(false))} />}
      {showDeposit && <DepositDialog onClose={() => setShowDeposit(false)} onSave={(amount) => act({ action: "deposit", amount }).then(() => setShowDeposit(false))} />}
    </div>
  );
}

// ---------------- pieces ----------------

function Verdict({ v, alpha }: { v: TraderView; alpha: number }) {
  const days = (Date.now() - new Date(v.state.startedAt).getTime()) / 86_400_000;
  const enough = days >= 30 && v.closedTrades >= 5;
  let text: string;
  let cls = "border-white/10 bg-white/[0.03] text-slate-300";
  if (!enough) {
    text = `Too early to judge — ${days < 30 ? `${Math.ceil(30 - days)} more days` : ""}${days < 30 && v.closedTrades < 5 ? " and " : ""}${v.closedTrades < 5 ? `${5 - v.closedTrades} more closed trades` : ""} needed before the track record means much. Keep it running.`;
  } else if (alpha > 2) {
    text = `The AI is beating the S&P 500 by ${alpha.toFixed(1)} pts over ${Math.round(days)} days with a ${v.winRate?.toFixed(0)}% win rate. Its calls are earning some trust — compare its picks with your own decisions.`;
    cls = "border-emerald-500/25 bg-emerald-500/5 text-emerald-200";
  } else if (alpha < -2) {
    text = `The AI is trailing the S&P 500 by ${Math.abs(alpha).toFixed(1)} pts over ${Math.round(days)} days. So far, simply holding an index fund would have done better — treat its suggestions with caution.`;
    cls = "border-rose-500/25 bg-rose-500/5 text-rose-200";
  } else {
    text = `Roughly matching the S&P 500 after ${Math.round(days)} days (${alpha >= 0 ? "+" : ""}${alpha.toFixed(1)} pts). No clear edge yet.`;
  }
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <ShieldCheck size={18} className="mt-0.5 shrink-0" />
      <span><span className="font-semibold">Confidence check: </span>{text}</span>
    </div>
  );
}

function PositionRow({ p, onClose, onOpen }: { p: TraderView["positions"][number]; onClose: () => void; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.03]" onClick={() => setOpen((o) => !o)}>
        <td className="td">
          <div className="flex items-center gap-1.5 font-semibold">
            {open ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
            {p.symbol}
          </div>
          <div className="max-w-[150px] truncate pl-5 text-xs text-slate-500">{p.name}</div>
        </td>
        <td className="td num text-right">
          <div>{p.qty}</div>
          <div className="text-xs text-slate-500">@ {money(p.avgPrice)}</div>
        </td>
        <td className="td num text-right">
          <div>{money(p.price)}</div>
          <div className={`text-xs ${upDown(p.changePct)}`}>{pct(p.changePct)}</div>
          <ExtQuote ext={p.ext} />
        </td>
        <td className="td num text-right">
          <div>{money(p.value)}</div>
          <div className="text-xs text-slate-500">{p.weight.toFixed(1)}%</div>
        </td>
        <td className={`td num text-right ${upDown(p.pl)}`}>
          <div>{signedMoney(p.pl)}</div>
          <div className="text-xs">{pct(p.plPct)}</div>
        </td>
        <td className="td num text-right text-xs">
          <div className="text-rose-300">{money(p.stopLoss)}</div>
          <div className="text-emerald-300">{money(p.takeProfit)}</div>
        </td>
        <td className="td text-right">
          <button className="btn-ghost p-1 text-slate-500 hover:text-rose-400" title="Close position" onClick={(e) => { e.stopPropagation(); onClose(); }}>
            <X size={14} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-white/[0.04] bg-white/[0.02]">
          <td colSpan={7} className="px-4 py-3 text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">AI thesis · </span>
            <span className="text-slate-300">{p.thesis}</span>
            <span className="ml-2 text-xs text-slate-500">held since {new Date(p.openedAt).toLocaleDateString()}</span>
            <button className="ml-3 text-xs text-sky-400 hover:underline" onClick={onOpen}>AI deep-dive on {p.symbol} →</button>
          </td>
        </tr>
      )}
    </>
  );
}

const actionCls = { BUY: "bg-emerald-500/15 text-emerald-300", SELL: "bg-rose-500/15 text-rose-300", HOLD: "bg-white/5 text-slate-300" } as const;

function RunDetail({ run }: { run: TraderRun }) {
  if (run.error) return <p className="p-4 text-sm text-rose-300">Run failed: {run.error}</p>;
  return <RunDetailInner run={run} />;
}

function RunDetailInner({ run }: { run: TraderRun }) {
  const [showAll, setShowAll] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);
  // full cards for trades and held positions; plain "watching" candidates fold into chips
  const main = run.decisions.filter((d) => d.action !== "HOLD" || (d.executed && d.executed !== "Watching"));
  const watching = run.decisions.filter((d) => !main.includes(d));
  const peekDec = watching.find((d) => d.symbol === peek);
  return (
    <div className="max-h-[760px] space-y-3 overflow-y-auto p-4">
      {run.triggeredBy && run.triggeredBy.length > 0 && (
        <div className="rounded-lg bg-amber-500/5 p-2.5 ring-1 ring-amber-400/20">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300">⚡ Woken up by</div>
          <ul className="space-y-0.5 text-xs text-amber-100/90">{run.triggeredBy.slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {run.trigger && run.trigger !== "event" && run.trigger !== "manual" && (
        <div className="text-[11px] uppercase tracking-wide text-slate-500">{TRIGGER_LABEL[run.trigger]}</div>
      )}
      <p className="text-sm leading-relaxed text-slate-300">{run.marketView}</p>
      {main.length === 0 && <p className="text-sm text-slate-500">No trades this round — the AI chose to wait.</p>}
      <ul className="space-y-2">
        {(showAll ? main : main.slice(0, 6)).map((d, i) => (
          <li key={i} className="rounded-lg bg-white/[0.03] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${actionCls[d.action]}`}>{d.action}</span>
                <span className="font-semibold">{d.symbol}</span>
                <span className="text-[11px] text-slate-500">conf {d.confidence}</span>
              </span>
              {d.executed && <span className={`text-right text-[11px] ${d.executed.startsWith("Skipped") ? "text-amber-300/80" : "text-slate-400"}`}>{d.executed}</span>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{d.reasoning}</p>
          </li>
        ))}
      </ul>
      {main.length > 6 && (
        <button className="text-xs text-violet-300 hover:underline" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show fewer" : `Show all ${main.length} decisions`}
        </button>
      )}
      {watching.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">Also considered, not bought ({watching.length}) — click for why</div>
          <div className="flex flex-wrap gap-1.5">
            {watching.map((d) => (
              <button
                key={d.symbol}
                onClick={() => setPeek((p) => (p === d.symbol ? null : d.symbol))}
                className={`rounded-md px-2 py-0.5 text-xs ${peek === d.symbol ? "bg-white/15 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
              >
                {d.symbol} <span className="text-slate-500">{d.confidence}</span>
              </button>
            ))}
          </div>
          {peekDec && <p className="mt-2 rounded-lg bg-white/[0.03] p-2.5 text-xs leading-relaxed text-slate-400"><span className="font-semibold text-slate-200">{peekDec.symbol}: </span>{peekDec.reasoning}</p>}
        </div>
      )}
      <p className="text-[11px] text-slate-600">
        Looked at {run.candidates.length} stocks: {run.candidates.join(", ")} · {run.model} · {run.manual ? "manual run" : "scheduled run"}
      </p>
    </div>
  );
}

const ORDER_STATUS: Record<PendingOrder["status"], string> = {
  pending: "bg-sky-500/15 text-sky-300",
  filled: "bg-emerald-500/15 text-emerald-300",
  cancelled: "bg-white/5 text-slate-400",
  expired: "bg-white/5 text-slate-500",
};

function OrdersCard({ orders, onCancel }: { orders: PendingOrder[]; onCancel: (id: string) => void }) {
  const pending = orders.filter((o) => o.status === "pending").length;
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Clock size={15} className="text-sky-300" /> Queued orders</h3>
        <span className="text-[11px] text-slate-500">{pending ? `${pending} waiting for the open` : "fill a few minutes after the 9:30 ET open"}</span>
      </header>
      <ul className="max-h-72 divide-y divide-white/5 overflow-y-auto">
        {orders.map((o) => (
          <li key={o.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${o.side === "BUY" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{o.side}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{o.symbol}</span>
                <span className="text-xs text-slate-500">
                  {o.side === "BUY" ? `${o.percentOfEquity}% of equity` : o.sellFraction >= 0.98 ? "entire position" : `${Math.round(o.sellFraction * 100)}% of position`} · decided at {money(o.decisionPrice)} · {new Date(o.createdAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                  {o.source === "manual" ? " · by you" : ` · conf ${o.confidence}`}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ORDER_STATUS[o.status]}`}>{o.status}</span>
              </div>
              <p className="truncate text-xs text-slate-400" title={o.reasoning}>{o.note ? `→ ${o.note}` : o.reasoning}</p>
            </div>
            {o.status === "pending" && (
              <button className="btn-ghost px-2 py-1 text-xs text-slate-400 hover:text-rose-300" onClick={() => onCancel(o.id)}>Cancel</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS: Record<ScanEvent["status"], { label: string; cls: string }> = {
  queued: { label: "queued", cls: "bg-sky-500/15 text-sky-300" },
  sent: { label: "AI checked", cls: "bg-violet-500/15 text-violet-200" },
  cooldown: { label: "cooldown", cls: "bg-white/5 text-slate-400" },
  capped: { label: "daily limit", cls: "bg-amber-500/15 text-amber-300" },
  dropped: { label: "dropped", cls: "bg-white/5 text-slate-500" },
};

function ActivityLog({ log }: { log: ScanEvent[] }) {
  const [filter, setFilter] = useState<"all" | "acted" | "skipped">("all");
  const acted = (e: ScanEvent) => Boolean(e.outcome && /^(BUY|SELL)/.test(e.outcome) && !/Skipped/.test(e.outcome));
  const shown = log.filter((e) => (filter === "acted" ? acted(e) : filter === "skipped" ? e.status === "cooldown" || e.status === "capped" || (e.outcome ?? "").includes("Skipped") || (e.outcome ?? "").startsWith("HOLD") : true));
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Zap size={15} className="text-amber-300" /> Scanner activity</h3>
        <div className="flex rounded-md bg-white/5 p-0.5 text-xs">
          {(["all", "acted", "skipped"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded px-2 py-0.5 ${filter === f ? "bg-white/10 text-white" : "text-slate-400"}`}>
              {f === "all" ? "All triggers" : f === "acted" ? "Led to a trade" : "No trade / skipped"}
            </button>
          ))}
        </div>
      </header>
      {shown.length === 0 ? (
        <Empty title={log.length ? "Nothing in this filter" : "No triggers yet"}>
          {log.length ? "" : "During market hours the scanner checks every minute. Everything it notices shows up here — including what the AI decided and why it skipped."}
        </Empty>
      ) : (
        <ul className="max-h-[420px] divide-y divide-white/5 overflow-y-auto">
          {shown.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-2.5 text-sm">
              <span className="w-14 shrink-0 pt-0.5 text-[11px] text-slate-500">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.symbol === "SPY" ? "Market" : e.symbol}</span>
                  {e.urgent && <span className="rounded bg-rose-500/15 px-1 text-[10px] font-bold text-rose-300">URGENT</span>}
                  <span className="text-slate-200">{e.label}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span>
                </div>
                {e.detail && <p className="truncate text-xs text-slate-500" title={e.detail}>{e.detail}</p>}
                {e.outcome && <p className={`text-xs ${acted(e) ? "text-emerald-300" : "text-slate-400"}`}>→ {e.outcome}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TradeLog({ trades }: { trades: Trade[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="card overflow-hidden">
      <header className="border-b border-white/5 px-4 py-3">
        <h3 className="text-sm font-semibold">Trade log</h3>
      </header>
      {trades.length === 0 ? (
        <Empty title="No trades yet" />
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[720px]">
            <thead className="sticky top-0 border-b border-white/5 bg-[#111723]">
              <tr>
                <th className="th">When</th>
                <th className="th">Trade</th>
                <th className="th text-right">Price</th>
                <th className="th text-right">Value</th>
                <th className="th text-right">Realized P/L</th>
                <th className="th">Why</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="cursor-pointer border-b border-white/[0.04] align-top hover:bg-white/[0.03]" onClick={() => setExpanded((e) => (e === t.id ? null : t.id))}>
                  <td className="td whitespace-nowrap text-xs text-slate-400">{new Date(t.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td className="td whitespace-nowrap">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-bold ${actionCls[t.side]}`}>{t.side}</span>
                    <span className="num">{t.qty}</span> <span className="font-semibold">{t.symbol}</span>
                    {t.trigger !== "ai" && <span className="ml-2 rounded bg-white/5 px-1 text-[10px] uppercase text-slate-400">{t.trigger}</span>}
                  </td>
                  <td className="td num text-right">{money(t.price)}</td>
                  <td className="td num text-right">{money(t.value)}</td>
                  <td className={`td num text-right ${t.realizedPl === undefined ? "text-slate-600" : upDown(t.realizedPl)}`}>
                    {t.realizedPl === undefined ? "—" : <>{signedMoney(t.realizedPl)} <span className="text-xs">({pct(t.realizedPlPct)})</span></>}
                  </td>
                  <td className="td max-w-[380px] text-xs text-slate-400">
                    <div className={expanded === t.id ? "" : "truncate"}>{t.reason}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunHistory({ runs }: { runs: TraderRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runs.length) return null;
  return (
    <section className="card overflow-hidden">
      <header className="border-b border-white/5 px-4 py-3">
        <h3 className="text-sm font-semibold">Earlier AI runs</h3>
      </header>
      <ul className="divide-y divide-white/5">
        {runs.map((r) => {
          const n = r.decisions.filter((d) => d.executed && !d.executed.startsWith("Skipped") && d.action !== "HOLD").length;
          return (
            <li key={r.id}>
              <button className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]" onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                <span className="flex items-center gap-2 text-sm">
                  {open === r.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {new Date(r.at).toLocaleString()}
                  <span className="text-xs text-slate-500">{r.error ? "failed" : `${n} trade${n === 1 ? "" : "s"}`}</span>
                </span>
                {r.equityAfter && <span className="num text-xs text-slate-400">{money(r.equityAfter)}</span>}
              </button>
              {open === r.id && <RunDetail run={r} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) {
  const cls = tone === undefined ? "" : upDown(tone);
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`num mt-1 text-xl font-semibold ${cls}`}>{value}</div>
      {sub && <div className="num mt-0.5 truncate text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ---------------- setup & dialogs ----------------

function ConfigFields({ c, set }: { c: TraderConfig; set: (c: TraderConfig) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <label className="label">Risk profile</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(RISK) as RiskProfile[]).map((r) => (
            <button key={r} onClick={() => set({ ...c, risk: r })} className={`rounded-lg border p-3 text-left transition ${c.risk === r ? "border-violet-400/60 bg-violet-500/10" : "border-white/10 hover:border-white/20"}`}>
              <div className="text-sm font-semibold">{RISK[r].label}</div>
              <div className="mt-0.5 text-xs text-slate-400">{RISK[r].blurb}</div>
              <div className="mt-1.5 text-[10px] text-slate-500">{RISK[r].limits}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">What can it buy?</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { k: "discover" as const, t: "Watchlist + AI discovery", d: "Your stocks plus ideas from market screeners (growth, value, most active)" },
            { k: "watchlist" as const, t: "Only my watchlist & holdings", d: "Tests the AI on exactly the stocks you follow" },
          ].map((o) => (
            <button key={o.k} onClick={() => set({ ...c, universe: o.k })} className={`rounded-lg border p-3 text-left ${c.universe === o.k ? "border-violet-400/60 bg-violet-500/10" : "border-white/10 hover:border-white/20"}`}>
              <div className="text-sm font-semibold">{o.t}</div>
              <div className="mt-0.5 text-xs text-slate-400">{o.d}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">When does the AI trade?</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button key={m.k} onClick={() => set({ ...c, mode: m.k, autoRun: m.k !== "manual" })} className={`rounded-lg border p-3 text-left ${(c.mode ?? "event") === m.k ? "border-violet-400/60 bg-violet-500/10" : "border-white/10 hover:border-white/20"}`}>
              <div className="text-sm font-semibold">{m.t}</div>
              <div className="mt-0.5 text-xs text-slate-400">{m.d}</div>
            </button>
          ))}
        </div>
      </div>
      {(c.mode ?? "event") === "event" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Trigger sensitivity</label>
            <select className="input" value={c.sensitivity ?? "normal"} onChange={(e) => set({ ...c, sensitivity: e.target.value as Sensitivity })}>
              <option value="sensitive">Sensitive — reacts to ±2% moves</option>
              <option value="normal">Normal — ±3% moves (recommended)</option>
              <option value="big">Only big moves — ±5%+</option>
            </select>
          </div>
          <div>
            <label className="label">Max AI runs / day</label>
            <select className="input" value={c.maxRunsPerDay ?? 12} onChange={(e) => set({ ...c, maxRunsPerDay: Number(e.target.value) })}>
              {[6, 12, 24].map((n) => <option key={n} value={n}>{n} (≈ ${(n * 0.02).toFixed(2)}/day max)</option>)}
            </select>
          </div>
          <div>
            <label className="label">Cooldown per stock</label>
            <select className="input" value={c.cooldownMinutes ?? 120} onChange={(e) => set({ ...c, cooldownMinutes: Number(e.target.value) })}>
              {[30, 60, 120, 240].map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} hour${n > 60 ? "s" : ""}`}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {c.mode === "scheduled" && (
          <div>
            <label className="label">Run every</label>
            <select className="input" value={c.intervalMinutes} onChange={(e) => set({ ...c, intervalMinutes: Number(e.target.value), autoRun: true })}>
              {INTERVALS.map((i) => <option key={i.m} value={i.m}>{i.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Min. confidence to trade</label>
          <select className="input" value={c.minConfidence} onChange={(e) => set({ ...c, minConfidence: Number(e.target.value) })}>
            {[50, 60, 70, 80].map((n) => <option key={n} value={n}>{n}%</option>)}
          </select>
        </div>
        <div>
          <label className="label">Live web news</label>
          <button onClick={() => set({ ...c, webSearch: !c.webSearch })} className={`input flex items-center justify-between ${c.webSearch ? "border-violet-400/60" : ""}`}>
            <span>{c.webSearch ? "On" : "Off"}</span>
            <span className="text-[10px] text-slate-500">{c.webSearch ? "slower, costs more" : "uses Yahoo headlines"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Setup({ aiEnabled, err, onStart }: { aiEnabled: boolean; err: string; onStart: (amount: number, c: TraderConfig) => void }) {
  const [amount, setAmount] = useState("10000");
  const [c, setC] = useState<TraderConfig>({ risk: "balanced", universe: "discover", mode: "event", sensitivity: "normal", maxRunsPerDay: 12, cooldownMinutes: 120, autoRun: true, intervalMinutes: 240, webSearch: false, minConfidence: 60 });
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-violet-500/15 via-transparent to-transparent p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Bot className="text-violet-400" /> AI Trader</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
            Give the AI a pretend budget and let it manage a portfolio on its own. It reads price action, valuation, analyst moves and
            news sentiment, then buys and sells with real-time prices — no real money involved. Its results are compared against simply
            putting the same money in the S&amp;P 500, so after a few weeks you&apos;ll know whether its judgement deserves your trust.
          </p>
          <ul className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
            <li className="rounded-lg bg-white/[0.03] p-2.5">🧠 Explains every trade with its reasoning</li>
            <li className="rounded-lg bg-white/[0.03] p-2.5">🛡️ Hard risk limits enforced in code, plus automatic stop-losses</li>
            <li className="rounded-lg bg-white/[0.03] p-2.5">📊 Scored vs the S&amp;P 500 with win rate &amp; drawdown</li>
          </ul>
        </div>
        <div className="space-y-5 border-t border-white/5 p-6">
          <div className="max-w-xs">
            <label className="label">Starting funds (paper money)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
              <input className="input num pl-7 text-lg" type="number" min={100} step={100} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <ConfigFields c={c} set={setC} />
          {!aiEnabled && <p className="text-sm text-amber-300">Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the app to start the AI Trader.</p>}
          {err && <p className="text-sm text-rose-400">{err}</p>}
          <button
            className="btn w-full justify-center bg-violet-500 py-2.5 text-white hover:bg-violet-400"
            disabled={!aiEnabled || busy || !(Number(amount) >= 100)}
            onClick={async () => { setBusy(true); await onStart(Number(amount), c); setBusy(false); }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Fund with {money(Number(amount) || 0, 0)} &amp; start trading
          </button>
        </div>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card w-full max-w-2xl p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SettingsDialog({ config, onClose, onSave, onReset }: { config: TraderConfig; onClose: () => void; onSave: (c: TraderConfig) => void; onReset: () => void }) {
  const [c, setC] = useState(config);
  return (
    <Modal title="AI Trader settings" onClose={onClose}>
      <ConfigFields c={c} set={setC} />
      <div className="mt-6 flex items-center justify-between">
        <button className="btn-ghost text-rose-400" onClick={() => confirm("Reset the AI Trader? All paper positions, trades and history will be deleted.") && onReset()}>
          <RotateCcw size={14} /> Reset account
        </button>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn bg-violet-500 text-white hover:bg-violet-400" onClick={() => onSave(c)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function DepositDialog({ onClose, onSave }: { onClose: () => void; onSave: (n: number) => void }) {
  const [amount, setAmount] = useState("1000");
  return (
    <Modal title="Add paper funds" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-400">The S&amp;P 500 benchmark receives the same deposit at today&apos;s price, so the comparison stays fair.</p>
      <input className="input num mb-4" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn bg-violet-500 text-white hover:bg-violet-400" disabled={!(Number(amount) > 0)} onClick={() => onSave(Number(amount))}>Add {money(Number(amount) || 0, 0)}</button>
      </div>
    </Modal>
  );
}
