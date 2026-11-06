"use client";
import { CheckCircle2, Info, Loader2, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { PreBuyCheck as Check } from "@/lib/types";

const verdictCls = {
  Go: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  Caution: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  "Stop & rethink": "border-rose-500/30 bg-rose-500/10 text-rose-200",
} as const;

const icon = {
  pass: <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />,
  warn: <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-400" />,
  fail: <XCircle size={14} className="mt-0.5 shrink-0 text-rose-400" />,
  info: <Info size={14} className="mt-0.5 shrink-0 text-sky-400" />,
};

/** Instant "before you buy" checklist. Re-runs (debounced) when symbol / qty / price change. */
export default function PreBuyCheck({ symbol, qty, price, onSuggestStop }: { symbol: string; qty: number; price?: number; onSuggestStop?: (stop: number) => void }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol || !(qty > 0)) {
      setCheck(null);
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch("/api/precheck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, qty, price }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setCheck(j);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [symbol, qty, price]);

  if (!symbol || !(qty > 0)) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><ShieldCheck size={13} /> Before you buy</span>
        {loading && <Loader2 size={13} className="animate-spin text-slate-500" />}
      </div>
      {err && <p className="px-3 py-2 text-xs text-rose-400">{err}</p>}
      {check && (
        <div className={`space-y-2 p-3 ${loading ? "opacity-60" : ""}`}>
          <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm font-semibold ${verdictCls[check.verdict]}`}>
            <span>{check.verdict}</span>
            <span className="text-xs font-normal opacity-80">
              {check.positionPctAfter < 100 && `${check.positionPctAfter.toFixed(1)}% of portfolio after · `}
              {check.suggestedMaxQty > 0 && check.suggestedMaxQty < qty ? `suggested max ≈ ${check.suggestedMaxQty} sh` : "size OK"}
            </span>
          </div>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {check.checks.map((c, i) => (
              <li key={i} className="flex gap-2 text-xs">
                {icon[c.status]}
                <span><span className="font-medium text-slate-200">{c.label}: </span><span className="text-slate-400">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          {onSuggestStop && (
            <button type="button" className="text-xs text-sky-400 hover:underline" onClick={() => onSuggestStop(check.suggestedStop)}>
              Use suggested stop-loss ${check.suggestedStop}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
