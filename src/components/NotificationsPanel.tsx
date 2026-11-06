"use client";
import { CheckCheck, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppNotification } from "@/lib/types";
import { Empty, severityDot } from "./ui";

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsPanel({
  version,
  onClose,
  onOpen,
  onChanged,
}: {
  version: number; // bump to refetch
  onClose: () => void;
  onOpen: (symbol: string, kind: string) => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = () => fetch("/api/notifications").then((r) => r.json()).then(setItems);
  useEffect(() => {
    load();
  }, [version]);

  async function act(action: string, id?: string) {
    await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id }) });
    await load();
    onChanged();
  }

  const shown = filter === "unread" ? items.filter((n) => !n.read) : items;

  return (
    <div className="fixed inset-0 z-40" onMouseDown={onClose}>
      <div className="card absolute right-4 top-16 flex max-h-[75vh] w-[420px] max-w-[calc(100vw-2rem)] flex-col shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">Notifications</h3>
            <div className="flex rounded-md bg-white/5 p-0.5 text-xs">
              {(["all", "unread"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded px-2 py-0.5 capitalize ${filter === f ? "bg-white/10 text-white" : "text-slate-400"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act("readAll")} title="Mark all read">
              <CheckCheck size={14} />
            </button>
            <button className="btn-ghost px-2 py-1 text-xs text-slate-400" onClick={() => confirm("Clear all notifications?") && act("clear")} title="Clear all">
              <Trash2 size={14} />
            </button>
            <button className="btn-ghost p-1" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <ul className="flex-1 divide-y divide-white/5 overflow-y-auto">
          {shown.length === 0 && (
            <Empty title={filter === "unread" ? "You're all caught up" : "No notifications yet"}>
              Alerts appear when a stock hits your target, stop-loss or take-profit, turns oversold/overbought, moves 5%+ in a day, or when the AI Trader makes a trade.
            </Empty>
          )}
          {shown.map((n) => (
            <li
              key={n.id}
              className={`group flex cursor-pointer gap-3 px-4 py-3 hover:bg-white/[0.03] ${n.read ? "opacity-60" : ""}`}
              onClick={() => {
                if (!n.read) act("read", n.id);
                onOpen(n.symbol, n.kind);
                onClose();
              }}
            >
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot[n.severity]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-100">{n.title}</p>
                  <span className="shrink-0 text-[11px] text-slate-500">{ago(n.createdAt)}</span>
                </div>
                <p className="text-xs text-slate-400">{n.message}</p>
              </div>
              <button
                className="invisible self-center text-slate-500 hover:text-rose-400 group-hover:visible"
                onClick={(e) => {
                  e.stopPropagation();
                  act("delete", n.id);
                }}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
