"use client";
import type { BuyVerdict, HoldAction, Severity, Tone } from "@/lib/types";

export const money = (n: number | undefined | null, dp = 2) =>
  n === undefined || n === null || !isFinite(n)
    ? "—"
    : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const signedMoney = (n: number) => (n > 0 ? "+" : "") + money(n);

export const pct = (n: number | undefined | null, dp = 2, signed = true) =>
  n === undefined || n === null || !isFinite(n) ? "—" : `${signed && n > 0 ? "+" : ""}${n.toFixed(dp)}%`;

export const compact = (n?: number) =>
  n === undefined ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const upDown = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-slate-400");

export const toneClass: Record<Tone, string> = {
  good: "text-emerald-400",
  bad: "text-rose-400",
  neutral: "text-slate-400",
};

const verdictStyle: Record<BuyVerdict, string> = {
  "Strong Buy Zone": "bg-emerald-500/20 text-emerald-300 ring-emerald-400/30",
  "Buy Zone": "bg-emerald-500/10 text-emerald-400 ring-emerald-400/20",
  Neutral: "bg-slate-500/10 text-slate-300 ring-slate-400/20",
  Wait: "bg-amber-500/10 text-amber-300 ring-amber-400/20",
  Overheated: "bg-rose-500/10 text-rose-300 ring-rose-400/20",
};

export function VerdictBadge({ verdict, score }: { verdict: BuyVerdict; score?: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${verdictStyle[verdict]}`}>
      {score !== undefined && <span className="num font-semibold">{score}</span>}
      {verdict}
    </span>
  );
}

const actionStyle: Record<HoldAction, string> = {
  Hold: "bg-slate-500/10 text-slate-300 ring-slate-400/20",
  "Add More": "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25",
  "Consider Trimming": "bg-amber-500/10 text-amber-300 ring-amber-400/25",
  "Take Profit": "bg-sky-500/10 text-sky-300 ring-sky-400/25",
  "Review – Stop Hit": "bg-rose-500/15 text-rose-300 ring-rose-400/30",
};

export function ActionBadge({ action }: { action: HoldAction }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${actionStyle[action]}`}>
      {action}
    </span>
  );
}

export const severityDot: Record<Severity, string> = {
  good: "bg-emerald-400",
  bad: "bg-rose-400",
  warn: "bg-amber-400",
  info: "bg-sky-400",
};

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-emerald-400" : score >= 60 ? "bg-emerald-500/70" : score >= 45 ? "bg-slate-400" : score >= 30 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
      <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
    </div>
  );
}

export function Sparkline({ data, width = 96, height = 28 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`);
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? "#34d399" : "#fb7185";
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** 52-week range bar with a marker at the current price. */
export function RangeBar({ low, high, price }: { low?: number; high?: number; price: number }) {
  if (!low || !high || high <= low) return <span className="text-slate-500">—</span>;
  const pos = Math.max(0, Math.min(1, (price - low) / (high - low)));
  return (
    <div className="w-28">
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-emerald-500/40 via-slate-500/30 to-rose-500/40">
        <div className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded bg-white" style={{ left: `calc(${pos * 100}% - 2px)` }} />
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-slate-500">
        <span>{low.toFixed(0)}</span>
        <span>{high.toFixed(0)}</span>
      </div>
    </div>
  );
}

/** Minimal markdown renderer for AI output (bold, italics, bullets, paragraphs). */
export function MiniMarkdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-100">$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
      .replace(/_(.+?)_/g, '<em class="text-slate-500">$1</em>');
  const lines = text.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const l = raw.trim();
    const m = l.match(/^[-*•]\s+(.*)/);
    if (m) {
      if (!inList) out.push('<ul class="ml-4 list-disc space-y-1 marker:text-slate-600">');
      inList = true;
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (inList) out.push("</ul>");
    inList = false;
    if (l.startsWith("#")) out.push(`<p class="mt-2 font-semibold text-slate-100">${inline(l.replace(/^#+\s*/, ""))}</p>`);
    else if (l) out.push(`<p>${inline(l)}</p>`);
  }
  if (inList) out.push("</ul>");
  return <div className="space-y-2 text-sm leading-relaxed text-slate-300" dangerouslySetInnerHTML={{ __html: out.join("") }} />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

/** Small "Pre $189.32 +4.3%" / "After $180.10 −0.8%" line for extended-hours quotes. */
export function ExtQuote({ ext, className = "" }: { ext?: { session: "pre" | "post"; price: number; changePct: number }; className?: string }) {
  if (!ext) return null;
  return (
    <div className={`num whitespace-nowrap text-[11px] ${className}`} title={ext.session === "pre" ? "Pre-market price (before 9:30 ET)" : "After-hours price (after 16:00 ET)"}>
      <span className="text-slate-500">{ext.session === "pre" ? "Pre" : "After"} </span>
      <span className="text-slate-300">{money(ext.price)}</span> <span className={upDown(ext.changePct)}>{pct(ext.changePct, 1)}</span>
    </div>
  );
}
