"use client";
import { ArrowDown, ArrowUp, Sparkles, Target } from "lucide-react";
import { useMemo, useState } from "react";
import type { EnrichedHolding, EnrichedWatch } from "@/lib/types";
import { ActionBadge, Empty, ExtQuote, RangeBar, ScoreBar, Sparkline, VerdictBadge, money, pct, signedMoney, upDown } from "./ui";

type SortState<K extends string> = { key: K; dir: 1 | -1 };

function useSort<T, K extends string>(rows: T[], initial: SortState<K>, get: (r: T, k: K) => number | string | undefined) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const va = get(a, sort.key) ?? -Infinity;
        const vb = get(b, sort.key) ?? -Infinity;
        return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort],
  );
  const header = (k: K, label: string, right = false) => (
    <th className={`th cursor-pointer select-none hover:text-slate-300 ${right ? "text-right" : ""}`} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : -1 }))}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
  );
  return { sorted, header };
}

// ---------------- Watchlist ----------------
type WKey = "symbol" | "price" | "change" | "target" | "rsi" | "score";

export function WatchlistTable({ rows, onOpen, onAnalyze, ownedSymbols }: { rows: EnrichedWatch[]; onOpen: (s: string) => void; onAnalyze: (s: string) => void; ownedSymbols: Set<string> }) {
  const { sorted, header } = useSort<EnrichedWatch, WKey>(rows, { key: "score", dir: -1 }, (r, k) => {
    switch (k) {
      case "symbol": return r.symbol;
      case "price": return r.quote?.price;
      case "change": return r.quote?.changePct;
      case "target": return r.distanceToTargetPct ?? undefined;
      case "rsi": return r.tech?.rsi14;
      case "score": return r.analysis?.score;
    }
  });

  if (!rows.length) return <Empty title="Your watchlist is empty">Add stocks you’re interested in. You’ll get a buy-zone score and alerts when they hit your target.</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px]">
        <thead className="border-b border-white/5">
          <tr>
            {header("symbol", "Stock")}
            {header("price", "Price", true)}
            {header("change", "Today", true)}
            <th className="th">30d</th>
            {header("target", "Target", true)}
            <th className="th">52w range</th>
            {header("rsi", "RSI", true)}
            {header("score", "Buy signal")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.symbol} onClick={() => onOpen(r.symbol)} className="cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.03]">
              <td className="td">
                <div className="flex items-center gap-2 font-semibold">
                  {r.symbol}
                  {ownedSymbols.has(r.symbol) && <span className="rounded bg-sky-500/15 px-1 text-[10px] font-medium text-sky-300">OWNED</span>}
                  {r.addedBy === "ai" && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/20 px-1 text-[10px] font-bold text-violet-200" title={`Added by AI: ${r.aiReason ?? ""}`}>
                      <Sparkles size={9} /> AI
                    </span>
                  )}
                  {r.aiRemoveSuggestion && (
                    <span className="rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-300" title={`AI suggests removing: ${r.aiRemoveSuggestion.reason}`}>
                      REMOVE?
                    </span>
                  )}
                </div>
                <div className="max-w-[180px] truncate text-xs text-slate-500">{r.quote?.name ?? r.error}</div>
              </td>
              <td className="td num text-right font-medium">
                {money(r.quote?.price)}
                <ExtQuote ext={r.quote?.ext} className="font-normal" />
              </td>
              <td className={`td num text-right ${upDown(r.quote?.changePct ?? 0)}`}>{pct(r.quote?.changePct)}</td>
              <td className="td"><Sparkline data={r.tech?.spark ?? []} /></td>
              <td className="td num text-right">
                {r.targetPrice ? (
                  <div>
                    <div className="flex items-center justify-end gap-1">
                      {(r.distanceToTargetPct ?? 1) <= 0 && <Target size={12} className="text-emerald-400" />}
                      {money(r.targetPrice)}
                    </div>
                    <div className={`text-xs ${(r.distanceToTargetPct ?? 1) <= 0 ? "text-emerald-400" : "text-slate-500"}`}>
                      {(r.distanceToTargetPct ?? 0) <= 0 ? "hit" : `${r.distanceToTargetPct!.toFixed(1)}% away`}
                    </div>
                  </div>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className="td">{r.quote && <RangeBar low={r.tech?.low52} high={r.tech?.high52} price={r.quote.price} />}</td>
              <td className={`td num text-right ${rsiColor(r.tech?.rsi14)}`}>{r.tech?.rsi14?.toFixed(0) ?? "—"}</td>
              <td className="td">
                {r.analysis && (
                  <div className="flex items-center gap-2">
                    <ScoreBar score={r.analysis.score} />
                    <VerdictBadge verdict={r.analysis.verdict} score={r.analysis.score} />
                    <AskAi onClick={() => onAnalyze(r.symbol)} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const rsiColor = (r?: number) => (r === undefined ? "text-slate-500" : r < 30 ? "text-emerald-400" : r > 70 ? "text-rose-400" : "text-slate-300");

// ---------------- Portfolio ----------------
type HKey = "symbol" | "price" | "change" | "value" | "pl" | "plPct" | "dayPl" | "weight";

export function PortfolioTable({ rows, onOpen, onAnalyze }: { rows: EnrichedHolding[]; onOpen: (s: string) => void; onAnalyze: (s: string) => void }) {
  const { sorted, header } = useSort<EnrichedHolding, HKey>(rows, { key: "value", dir: -1 }, (r, k) => {
    switch (k) {
      case "symbol": return r.symbol;
      case "price": return r.quote?.price;
      case "change": return r.quote?.changePct;
      default: return r[k];
    }
  });

  if (!rows.length) return <Empty title="No holdings yet">Add the stocks you’ve bought with quantity and average price to track profit and loss.</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px]">
        <thead className="border-b border-white/5">
          <tr>
            {header("symbol", "Stock")}
            {header("price", "Price", true)}
            {header("change", "Today", true)}
            <th className="th text-right">Shares · Avg</th>
            {header("value", "Value", true)}
            {header("dayPl", "Day P/L", true)}
            {header("pl", "Total P/L", true)}
            {header("weight", "Weight", true)}
            <th className="th">Suggestion</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.symbol} onClick={() => onOpen(r.symbol)} className="cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.03]">
              <td className="td">
                <div className="font-semibold">{r.symbol}</div>
                <div className="max-w-[170px] truncate text-xs text-slate-500">{r.quote?.name ?? r.error}</div>
              </td>
              <td className="td num text-right font-medium">
                {money(r.quote?.price)}
                <ExtQuote ext={r.quote?.ext} className="font-normal" />
              </td>
              <td className={`td num text-right ${upDown(r.quote?.changePct ?? 0)}`}>{pct(r.quote?.changePct)}</td>
              <td className="td num text-right">
                <div>{r.qty}</div>
                <div className="text-xs text-slate-500">@ {money(r.avgPrice)}</div>
              </td>
              <td className="td num text-right font-medium">{money(r.value)}</td>
              <td className={`td num text-right ${upDown(r.dayPl)}`}>{signedMoney(r.dayPl)}</td>
              <td className={`td num text-right ${upDown(r.pl)}`}>
                <div className="font-medium">{signedMoney(r.pl)}</div>
                <div className="text-xs">{pct(r.plPct)}</div>
              </td>
              <td className="td num text-right">
                <div>{r.weight.toFixed(1)}%</div>
                <div className="ml-auto mt-1 h-1 w-14 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-sky-400/70" style={{ width: `${Math.min(100, r.weight)}%` }} />
                </div>
              </td>
              <td className="td" title={`${r.actionReason ?? ""}\nClick for the AI's detailed reasoning`}>
                <button
                  className="group text-left"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAnalyze(r.symbol);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {r.action && <ActionBadge action={r.action} />}
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-violet-400 opacity-70 group-hover:opacity-100">
                      <Sparkles size={11} /> Why?
                    </span>
                  </span>
                  <div className="mt-1 max-w-[220px] truncate text-[11px] text-slate-500 group-hover:text-slate-300">{r.actionReason}</div>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AskAi({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex items-center gap-0.5 rounded px-1 text-[11px] text-violet-400 opacity-70 hover:bg-violet-500/10 hover:opacity-100"
      title="Ask AI: should I buy this now?"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Sparkles size={11} /> Ask AI
    </button>
  );
}
