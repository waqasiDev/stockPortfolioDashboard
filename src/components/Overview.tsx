"use client";
import { AlertTriangle, ShoppingCart, TrendingDown, TrendingUp } from "lucide-react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import type { DashboardData } from "@/lib/types";
import { EarningsCard, HealthCard, MorningBriefCard } from "./Insights";
import { ActionBadge, Empty, VerdictBadge, money, pct, signedMoney, upDown } from "./ui";

const PIE_COLORS = ["#38bdf8", "#34d399", "#a78bfa", "#fbbf24", "#f472b6", "#2dd4bf", "#fb923c", "#818cf8", "#a3e635", "#94a3b8"];

export default function Overview({ data, onOpen, onChanged }: { data: DashboardData; onOpen: (s: string, analyze?: boolean) => void; onChanged: () => void }) {
  const { summary: s, holdings, watchlist } = data;

  const buyIdeas = watchlist
    .filter((w) => w.analysis && (w.analysis.score >= 60 || (w.distanceToTargetPct ?? 1) <= 0))
    .sort((a, b) => b.analysis!.score - a.analysis!.score);
  const nearTarget = watchlist
    .filter((w) => w.distanceToTargetPct !== null && w.distanceToTargetPct !== undefined && w.distanceToTargetPct > 0 && w.distanceToTargetPct <= 5)
    .sort((a, b) => a.distanceToTargetPct! - b.distanceToTargetPct!);
  const attention = holdings.filter((h) => h.action && h.action !== "Hold");

  const movers = [
    ...holdings.map((h) => ({ symbol: h.symbol, chg: h.quote?.changePct ?? 0, price: h.quote?.price, owned: true })),
    ...watchlist.filter((w) => !holdings.some((h) => h.symbol === w.symbol)).map((w) => ({ symbol: w.symbol, chg: w.quote?.changePct ?? 0, price: w.quote?.price, owned: false })),
  ].sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg)).slice(0, 6);

  const pie = holdings.filter((h) => h.value > 0).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Portfolio value" value={money(s.totalValue)} sub={`Invested ${money(s.totalCost)}`} />
        <Kpi
          label={s.ext ? "Last session" : "Today"}
          value={signedMoney(s.dayPl)}
          sub={pct(s.dayPlPct)}
          tone={s.dayPl}
          extra={
            s.ext && (
              <div className="mt-1.5 border-t border-white/5 pt-1.5 text-xs">
                <span className="text-slate-500">{s.ext.session === "pre" ? "Pre-market" : "After hours"} </span>
                <span className={`num font-semibold ${upDown(s.ext.pl)}`}>{signedMoney(s.ext.pl)} ({pct(s.ext.plPct)})</span>
              </div>
            )
          }
        />
        <Kpi label="Total profit / loss" value={signedMoney(s.totalPl)} sub={pct(s.totalPlPct)} tone={s.totalPl} />
        <Kpi label="Positions" value={`${holdings.length}`} sub={`${s.winners} winning · ${s.losers} losing`} />
      </div>

      <MorningBriefCard onOpen={onOpen} onChanged={onChanged} />

      {/* Action center */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Buy opportunities" icon={<ShoppingCart size={15} className="text-emerald-400" />} hint="Watchlist stocks in the buy zone or at your target">
          {buyIdeas.length === 0 && nearTarget.length === 0 ? (
            <Empty title="Nothing in the buy zone right now">Patience is a position. Stocks show up here when signals line up or your target is hit.</Empty>
          ) : (
            <ul className="divide-y divide-white/5">
              {buyIdeas.map((w) => (
                <Row key={w.symbol} onClick={() => onOpen(w.symbol, true)} symbol={w.symbol} price={w.quote?.price} chg={w.quote?.changePct}
                  right={<VerdictBadge verdict={w.analysis!.verdict} score={w.analysis!.score} />}
                  note={(w.distanceToTargetPct ?? 1) <= 0 ? `At/below your target ${money(w.targetPrice)}` : w.analysis!.signals.filter((x) => x.tone === "good").slice(0, 2).map((x) => x.label).join(" · ")} />
              ))}
              {nearTarget.filter((w) => !buyIdeas.includes(w)).map((w) => (
                <Row key={w.symbol} onClick={() => onOpen(w.symbol)} symbol={w.symbol} price={w.quote?.price} chg={w.quote?.changePct}
                  right={<span className="text-xs text-amber-300">{w.distanceToTargetPct!.toFixed(1)}% to target</span>}
                  note={`Target ${money(w.targetPrice)} — getting close`} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Needs your attention" icon={<AlertTriangle size={15} className="text-amber-400" />} hint="Holdings with a non-Hold suggestion">
          {attention.length === 0 ? (
            <Empty title={holdings.length ? "All positions look steady" : "No holdings yet"}>{holdings.length ? "No stop-loss, take-profit or trim signals." : "Add the stocks you own in the Portfolio tab."}</Empty>
          ) : (
            <ul className="divide-y divide-white/5">
              {attention.map((h) => (
                <Row key={h.symbol} onClick={() => onOpen(h.symbol, true)} symbol={h.symbol} price={h.quote?.price} chg={h.quote?.changePct} right={<ActionBadge action={h.action!} />} note={h.actionReason} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <HealthCard health={data.health} />
        <EarningsCard events={data.earnings} onOpen={onOpen} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* allocation */}
        <Panel title="Allocation" className="lg:col-span-3">
          {pie.length === 0 ? (
            <Empty title="No holdings yet" />
          ) : (
            <div className="flex flex-col items-center gap-6 p-4 sm:flex-row">
              <div className="h-48 w-48 shrink-0">
                  <PieChart width={192} height={192}>
                    <Pie data={pie} dataKey="value" nameKey="symbol" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none" isAnimationActive={false}>
                      {pie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#151c2b", border: "1px solid #ffffff1a", borderRadius: 8, fontSize: 12 }} itemStyle={{ color: "#e2e8f0" }} formatter={(v) => money(Number(v))} />
                  </PieChart>
              </div>
              <ul className="w-full space-y-1.5 text-sm">
                {pie.map((h, i) => (
                  <li key={h.symbol} className="flex cursor-pointer items-center gap-2 rounded px-1 hover:bg-white/5" onClick={() => onOpen(h.symbol)}>
                    <i className="h-2.5 w-2.5 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="w-16 font-medium">{h.symbol}</span>
                    <span className="num flex-1 text-slate-400">{money(h.value, 0)}</span>
                    <span className={`num w-20 text-right text-xs ${upDown(h.pl)}`}>{pct(h.plPct, 1)}</span>
                    <span className={`num w-14 text-right ${h.weight > 30 ? "text-amber-300" : ""}`} title={h.weight > 30 ? "Concentrated position (>30%)" : ""}>{h.weight.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        {/* movers */}
        <Panel title="Biggest movers today" className="lg:col-span-2">
          {movers.length === 0 ? (
            <Empty title="Add stocks to see movers" />
          ) : (
            <ul className="divide-y divide-white/5">
              {movers.map((m) => (
                <li key={m.symbol} className="flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-white/[0.03]" onClick={() => onOpen(m.symbol)}>
                  <span className="flex items-center gap-2 font-medium">
                    {m.chg >= 0 ? <TrendingUp size={14} className="text-emerald-400" /> : <TrendingDown size={14} className="text-rose-400" />}
                    {m.symbol}
                    {m.owned && <span className="rounded bg-sky-500/15 px-1 text-[10px] text-sky-300">OWNED</span>}
                  </span>
                  <span className="num flex items-center gap-4 text-sm">
                    <span className="text-slate-400">{money(m.price)}</span>
                    <span className={`w-16 text-right font-medium ${upDown(m.chg)}`}>{pct(m.chg)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, extra }: { label: string; value: string; sub?: string; tone?: number; extra?: React.ReactNode }) {
  const cls = tone === undefined ? "" : upDown(tone);
  return (
    <div className="card px-4 py-3.5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
      {sub && <div className={`num mt-0.5 text-sm ${cls || "text-slate-500"}`}>{sub}</div>}
      {extra}
    </div>
  );
}

function Panel({ title, icon, hint, className = "", children }: { title: string; icon?: React.ReactNode; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</h3>
        {hint && <span className="hidden text-[11px] text-slate-500 sm:inline">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function Row({ symbol, price, chg, right, note, onClick }: { symbol: string; price?: number; chg?: number; right: React.ReactNode; note?: string; onClick: () => void }) {
  return (
    <li className="cursor-pointer px-4 py-3 hover:bg-white/[0.03]" onClick={onClick}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-semibold">{symbol}</span>
          <span className="num text-sm text-slate-400">{money(price)}</span>
          <span className={`num text-xs ${upDown(chg ?? 0)}`}>{pct(chg)}</span>
        </div>
        {right}
      </div>
      {note && <p className="mt-1 truncate text-xs text-slate-500">{note}</p>}
    </li>
  );
}
