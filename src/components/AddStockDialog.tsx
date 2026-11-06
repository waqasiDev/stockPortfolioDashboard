"use client";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { JournalDraft } from "./Journal";
import PreBuyCheck from "./PreBuyCheck";

type Mode = "watchlist" | "holding";
interface Result {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export default function AddStockDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: Mode;
  onClose: () => void;
  onSaved: (journal?: JournalDraft) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Result | null>(null);
  const [target, setTarget] = useState("");
  const [qty, setQty] = useState("");
  const [avg, setAvg] = useState("");
  const [stop, setStop] = useState("");
  const [tp, setTp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (picked || query.trim().length < 1) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const j = await r.json();
        setResults(Array.isArray(j) ? j : []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query, picked]);

  async function save() {
    const symbol = picked?.symbol ?? query.trim().toUpperCase();
    if (!symbol) return setError("Pick a stock");
    setSaving(true);
    setError("");
    const body =
      mode === "watchlist"
        ? { symbol, targetPrice: target }
        : { symbol, qty, avgPrice: avg, stopLoss: stop, takeProfit: tp, mode: "buy" };
    const r = await fetch(mode === "watchlist" ? "/api/watchlist" : "/api/holdings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) return setError((await r.json()).error ?? "Failed to save");
    onSaved(mode === "holding" ? { symbol, action: "BUY", price: Number(avg) || undefined, qty: Number(qty) || null } : undefined);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card max-h-[88vh] w-full max-w-md overflow-y-auto p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{mode === "watchlist" ? "Add to watchlist" : "Add a stock you own"}</h2>
          <button className="btn-ghost p-1" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <label className="label">Stock</label>
        {picked ? (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <div>
              <span className="font-semibold">{picked.symbol}</span>
              <span className="ml-2 text-sm text-slate-400">{picked.name}</span>
            </div>
            <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setPicked(null)}>
              change
            </button>
          </div>
        ) : (
          <div className="relative mb-4">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              className="input pl-9"
              placeholder="Search ticker or company, e.g. NVDA or Apple"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && results[0] && setPicked(results[0])}
            />
            {searching && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-500" />}
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-white/10 bg-[#151c2b] py-1 shadow-xl">
                {results.map((r) => (
                  <li key={r.symbol}>
                    <button className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-white/5" onClick={() => setPicked(r)}>
                      <span>
                        <span className="font-semibold">{r.symbol}</span>
                        <span className="ml-2 text-sm text-slate-400">{r.name}</span>
                      </span>
                      <span className="text-[10px] uppercase text-slate-500">
                        {r.exchange} · {r.type}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === "watchlist" ? (
          <div className="mb-4">
            <label className="label">Target buy price (optional)</label>
            <input className="input num" type="number" step="0.01" placeholder="Notify me when price ≤ this" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Shares</label>
                <input className="input num" type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <label className="label">Avg buy price</label>
                <input className="input num" type="number" step="0.01" value={avg} onChange={(e) => setAvg(e.target.value)} />
              </div>
            </div>
            <div className="mb-1 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Stop-loss (optional)</label>
                <input className="input num" type="number" step="0.01" value={stop} onChange={(e) => setStop(e.target.value)} />
              </div>
              <div>
                <label className="label">Take-profit (optional)</label>
                <input className="input num" type="number" step="0.01" value={tp} onChange={(e) => setTp(e.target.value)} />
              </div>
            </div>
            <p className="mb-3 text-xs text-slate-500">If you already own this stock, the shares are added and your average cost is recalculated.</p>
            <div className="mb-4">
              <PreBuyCheck symbol={picked?.symbol ?? ""} qty={Number(qty) || 0} price={Number(avg) || undefined} onSuggestStop={(v) => setStop(String(v))} />
            </div>
          </>
        )}

        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || (!picked && !query.trim())}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
