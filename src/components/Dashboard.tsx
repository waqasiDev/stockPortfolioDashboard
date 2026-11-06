"use client";
import { Activity, Bell, BookOpen, Bot, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppNotification, AppSettings, DashboardData } from "@/lib/types";
import AddStockDialog from "./AddStockDialog";
import AiControl from "./AiControl";
import AiTrader from "./AiTrader";
import Journal, { JournalDialog, type JournalDraft } from "./Journal";
import NotificationsPanel from "./NotificationsPanel";
import Overview from "./Overview";
import StockDrawer from "./StockDrawer";
import { PortfolioTable, WatchlistTable } from "./Tables";
import { money, pct, severityDot, signedMoney, upDown } from "./ui";

type Tab = "overview" | "portfolio" | "watchlist" | "journal" | "ai-trader";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "portfolio", label: "Portfolio" },
  { id: "watchlist", label: "Watchlist" },
  { id: "journal", label: "Journal" },
  { id: "ai-trader", label: "AI Trader" },
];
type Data = DashboardData & { aiEnabled: boolean };

const INTERVALS = [
  { label: "Off", ms: 0 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
];

const MARKET_LABEL: Record<string, { text: string; cls: string }> = {
  REGULAR: { text: "Market open", cls: "bg-emerald-400" },
  PRE: { text: "Pre-market", cls: "bg-amber-400" },
  PREPRE: { text: "Pre-market", cls: "bg-amber-400" },
  POST: { text: "After hours", cls: "bg-violet-400" },
  POSTPOST: { text: "After hours", cls: "bg-violet-400" },
  CLOSED: { text: "Market closed", cls: "bg-slate-500" },
};

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [intervalMs, setIntervalMs] = useState(60_000);
  const [adding, setAdding] = useState<null | "watchlist" | "holding">(null);
  const [openSymbol, setOpenSymbol] = useState<{ symbol: string; prefer?: "watch" | "hold"; analyze?: boolean } | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [journalDraft, setJournalDraft] = useState<JournalDraft | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [curating, setCurating] = useState(false);
  const [curateMsg, setCurateMsg] = useState("");

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setSettings).catch(() => {});
  }, []);
  async function saveSettings(patch: Partial<AppSettings>) {
    const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    setSettings(await r.json());
  }
  async function curate() {
    setCurating(true);
    setCurateMsg("");
    const r = await fetch("/api/watchlist/curate", { method: "POST" });
    const j = await r.json();
    setCurating(false);
    setCurateMsg(!r.ok ? j.error : j.changes.length ? `${j.changes.length} change${j.changes.length === 1 ? "" : "s"}: ${j.changes.map((c: string) => c.split(":")[0]).join(" · ")}` : "No changes — your watchlist already looks good.");
    load(true);
  }
  const [notifVersion, setNotifVersion] = useState(0);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const lastUnread = useRef<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab") as Tab | null;
    setTab(urlTab && TABS.some((t) => t.id === urlTab) ? urlTab : readPref<Tab>("sp.tab", "overview"));
    const open = params.get("open");
    if (open) setOpenSymbol({ symbol: open.toUpperCase(), analyze: params.get("analyze") === "1" });
    setIntervalMs(readPref("sp.interval", 60_000));
  }, []);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/dashboard${force ? "?force=1" : ""}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: Data = await r.json();
      setData(j);
      setError("");
      // pop toasts for newly created notifications
      if (lastUnread.current !== null && j.unread > lastUnread.current) {
        const n: AppNotification[] = await fetch("/api/notifications").then((x) => x.json());
        const fresh = n.filter((x) => !x.read).slice(0, j.unread - lastUnread.current);
        setToasts((t) => [...fresh, ...t].slice(0, 4));
        fresh.forEach((f) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== f.id)), 8000));
      }
      lastUnread.current = j.unread;
      setNotifVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // auto refresh, paused while the tab is hidden
  useEffect(() => {
    if (!intervalMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs, load]);

  const ownedSymbols = useMemo(() => new Set(data?.holdings.map((h) => h.symbol)), [data]);

  const drawerItem = useMemo(() => {
    if (!openSymbol || !data) return null;
    const h = data.holdings.find((x) => x.symbol === openSymbol.symbol);
    const w = data.watchlist.find((x) => x.symbol === openSymbol.symbol);
    if (h && (openSymbol.prefer !== "watch" || !w)) return { item: { kind: "hold" as const, data: h }, ownedAlso: undefined };
    if (w) return { item: { kind: "watch" as const, data: w }, ownedAlso: h };
    return null;
  }, [openSymbol, data]);

  const setTabP = (t: Tab) => {
    setTab(t);
    writePref("sp.tab", t);
  };

  /** Open a stock's detail + AI analysis; untracked symbols (e.g. AI Trader picks) are added to the watchlist first. */
  async function deepDive(symbol: string) {
    const tracked = data?.watchlist.some((w) => w.symbol === symbol) || data?.holdings.some((h) => h.symbol === symbol);
    if (!tracked) {
      await fetch("/api/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol }) });
      await load(true);
    }
    setOpenSymbol({ symbol, analyze: true });
  }

  const market = data?.marketState ? MARKET_LABEL[data.marketState] : undefined;

  return (
    <div className="min-h-screen">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0b0f17]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Activity size={18} />
            </div>
            <span className="text-base font-semibold tracking-tight">Stock Pulse</span>
          </div>

          <nav className="ml-4 hidden gap-1 md:flex">
            {TABS.map(({ id: t, label }) => (
              <button key={t} onClick={() => setTabP(t)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? (t === "ai-trader" ? "bg-violet-500/20 text-violet-200" : "bg-white/10 text-white") : t === "ai-trader" ? "text-violet-300/80 hover:text-violet-200" : "text-slate-400 hover:text-slate-200"}`}>
                {t === "ai-trader" && <Bot size={14} />}{t === "journal" && <BookOpen size={14} />}
                {label}
                {t === "portfolio" && data && <span className="text-xs text-slate-500">{data.holdings.length}</span>}
                {t === "watchlist" && data && <span className="text-xs text-slate-500">{data.watchlist.length}</span>}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {market && (
              <span className="hidden items-center gap-1.5 text-xs text-slate-400 lg:flex">
                <i className={`h-1.5 w-1.5 rounded-full ${market.cls} ${data?.marketState === "REGULAR" ? "animate-pulse" : ""}`} />
                {market.text}
              </span>
            )}
            {data && <span className="hidden text-xs text-slate-500 sm:inline">Updated {new Date(data.updatedAt).toLocaleTimeString()}</span>}
            <select
              className="rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-xs text-slate-300 outline-none"
              value={intervalMs}
              onChange={(e) => {
                const v = Number(e.target.value);
                setIntervalMs(v);
                writePref("sp.interval", v);
              }}
              title="Auto-refresh interval"
            >
              {INTERVALS.map((i) => (
                <option key={i.ms} value={i.ms} className="bg-[#111723]">
                  Auto: {i.label}
                </option>
              ))}
            </select>
            <AiControl refreshKey={notifVersion} onChanged={() => load()} />
            <button className="btn-outline px-2.5" onClick={() => load(true)} disabled={loading} title="Refresh now">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button className="btn-outline relative px-2.5" onClick={() => setShowNotifs((s) => !s)} title="Notifications">
              <Bell size={15} />
              {!!data?.unread && (
                <span className="num absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
                  {data.unread > 99 ? "99+" : data.unread}
                </span>
              )}
            </button>
          </div>
        </div>
        {/* mobile tabs */}
        <nav className="flex gap-1 px-4 pb-2 md:hidden">
          {TABS.map(({ id: t, label }) => (
            <button key={t} onClick={() => setTabP(t)} className={`flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium ${tab === t ? "bg-white/10 text-white" : "text-slate-400"}`}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">Couldn’t load market data: {error}</div>}

        {!data ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card h-24 animate-pulse" />)}
          </div>
        ) : tab === "ai-trader" ? (
          <AiTrader onOpenSymbol={deepDive} />
        ) : tab === "journal" ? (
          <Journal aiEnabled={data.aiEnabled} onOpenSymbol={(s) => deepDive(s)} />
        ) : tab === "overview" ? (
          <Overview data={data} onOpen={(s, analyze) => (data.watchlist.some((w) => w.symbol === s) || data.holdings.some((h) => h.symbol === s) ? setOpenSymbol({ symbol: s, analyze }) : deepDive(s))} onChanged={() => load(true)} />
        ) : tab === "portfolio" ? (
          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
              <div className="flex items-baseline gap-4">
                <h2 className="font-semibold">Portfolio</h2>
                <span className="num text-sm text-slate-300">{money(data.summary.totalValue)}</span>
                <span className={`num text-sm ${upDown(data.summary.totalPl)}`}>
                  {signedMoney(data.summary.totalPl)} ({pct(data.summary.totalPlPct)})
                </span>
                {data.summary.ext && (
                  <span className="num rounded-md bg-white/5 px-2 py-0.5 text-xs">
                    <span className="text-slate-500">{data.summary.ext.session === "pre" ? "Pre-market" : "After hours"} </span>
                    <span className={upDown(data.summary.ext.pl)}>{signedMoney(data.summary.ext.pl)} ({pct(data.summary.ext.plPct)})</span>
                  </span>
                )}
              </div>
              <button className="btn-primary" onClick={() => setAdding("holding")}>
                <Plus size={15} /> Add holding
              </button>
            </header>
            <PortfolioTable rows={data.holdings} onOpen={(s) => setOpenSymbol({ symbol: s, prefer: "hold" })} onAnalyze={(s) => setOpenSymbol({ symbol: s, prefer: "hold", analyze: true })} />
          </section>
        ) : (
          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
              <div>
                <h2 className="font-semibold">Watchlist</h2>
                <p className="text-xs text-slate-500">Sorted by buy signal. Click a row for chart, reasons & AI take.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {settings && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400" title="Let the AI add up to N picks (tagged AI) and remove its own picks. It only suggests removing yours.">
                    <input type="checkbox" className="accent-violet-500" checked={settings.aiWatchlist} onChange={(e) => saveSettings({ aiWatchlist: e.target.checked })} />
                    AI picks
                    {settings.aiWatchlist && (
                      <select className="rounded border border-white/10 bg-transparent px-1 py-0.5 text-xs" value={settings.maxAiPicks} onChange={(e) => saveSettings({ maxAiPicks: Number(e.target.value) })}>
                        {[3, 6, 10].map((n) => <option key={n} value={n} className="bg-[#111723]">max {n}</option>)}
                      </select>
                    )}
                  </label>
                )}
                {settings?.aiWatchlist && data.aiEnabled && (
                  <button className="btn-outline text-violet-200" onClick={curate} disabled={curating}>
                    {curating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {curating ? "AI is scanning the market…" : "Refresh AI picks"}
                  </button>
                )}
                <button className="btn-primary" onClick={() => setAdding("watchlist")}>
                  <Plus size={15} /> Add to watchlist
                </button>
              </div>
            </header>
            {curateMsg && <div className="border-b border-white/5 bg-violet-500/5 px-4 py-2 text-xs text-violet-200">{curateMsg}</div>}
            <WatchlistTable rows={data.watchlist} ownedSymbols={ownedSymbols} onOpen={(s) => setOpenSymbol({ symbol: s, prefer: "watch" })} onAnalyze={(s) => setOpenSymbol({ symbol: s, prefer: "watch", analyze: true })} />
          </section>
        )}

        {data && tab === "overview" && (
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn-outline" onClick={() => setAdding("holding")}><Plus size={14} /> Add holding</button>
            <button className="btn-outline" onClick={() => setAdding("watchlist")}><Plus size={14} /> Add to watchlist</button>
          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-slate-600">
          Data from Yahoo Finance (may be delayed up to 15 min). Signals are educational, not financial advice.
        </p>
      </main>

      {adding && (
        <AddStockDialog
          mode={adding}
          onClose={() => setAdding(null)}
          onSaved={(j) => {
            load(true);
            if (j) setJournalDraft(j);
          }}
        />
      )}
      {journalDraft && <JournalDialog draft={journalDraft} onClose={() => setJournalDraft(null)} />}
      {drawerItem && (
        <StockDrawer
          key={openSymbol!.symbol + drawerItem.item.kind}
          item={drawerItem.item}
          ownedAlso={drawerItem.ownedAlso}
          aiEnabled={data!.aiEnabled}
          autoAnalyze={openSymbol!.analyze}
          onClose={() => setOpenSymbol(null)}
          onChanged={() => load(true)}
          onJournal={setJournalDraft}
        />
      )}
      {showNotifs && (
        <NotificationsPanel
          version={notifVersion}
          onClose={() => setShowNotifs(false)}
          onOpen={(s, kind) => (kind === "ai-trader" ? setTabP("ai-trader") : setOpenSymbol({ symbol: s }))}
          onChanged={() => load()}
        />
      )}

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            className="card pointer-events-auto flex gap-3 p-3 text-left shadow-xl"
            onClick={() => {
              if (t.kind === "ai-trader") setTabP("ai-trader");
              else setOpenSymbol({ symbol: t.symbol });
              setToasts((x) => x.filter((y) => y.id !== t.id));
            }}
          >
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot[t.severity]}`} />
            <span>
              <span className="block text-sm font-medium">{t.title}</span>
              <span className="block text-xs text-slate-400">{t.message}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
