"use client";
import { Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";

type Status = { configured: boolean; connected: boolean; enabled: boolean; error?: string };

/** Telegram trade-signal setup for the AI Trader tab. */
export default function SignalsCard() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/signals", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => {});
  }, []);

  async function post(body: Record<string, unknown>, okText?: string) {
    setBusy(String(body.action));
    setMsg(null);
    try {
      const r = await fetch("/api/signals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j: Status = await r.json();
      setS(j);
      if (j.error) setMsg({ ok: false, text: j.error });
      else if (okText) setMsg({ ok: true, text: okText });
    } finally {
      setBusy("");
    }
  }

  if (!s) return null;
  const spin = (a: string) => busy === a && <Loader2 size={13} className="animate-spin" />;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Send size={14} className="text-sky-400" /> Trade signals on Telegram</h3>
          <p className="mt-0.5 text-xs text-slate-400">Get a message for every AI Trader buy and sell, sized as a % of your portfolio so you can copy it.</p>
        </div>
        {s.connected && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => post({ action: "toggle", enabled: !s.enabled })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${s.enabled ? "bg-sky-500" : "bg-white/15"}`}
              aria-label="Toggle Telegram signals"
              title={s.enabled ? "Signals on" : "Signals off"}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${s.enabled ? "left-[22px]" : "left-0.5"}`} />
            </button>
            <button className="btn-outline text-xs" disabled={!!busy} onClick={() => post({ action: "test" }, "Test message sent, check Telegram.")}>{spin("test")} Send test</button>
            <button className="btn-ghost text-xs text-slate-400" disabled={!!busy} onClick={() => post({ action: "disconnect" })}>Disconnect</button>
          </div>
        )}
      </div>

      {!s.configured && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-300">
          <li>In Telegram, open <b>@BotFather</b>, send <code className="text-sky-300">/newbot</code> and follow the steps. It gives you a bot token.</li>
          <li>Add it to your <code className="text-sky-300">.env</code> file: <code className="text-sky-300">TELEGRAM_BOT_TOKEN=123456:ABC…</code></li>
          <li>Restart the app (stop <code>npm run dev</code> and start it again), then come back here.</li>
        </ol>
      )}

      {s.configured && !s.connected && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-300">Open your new bot in Telegram and send it any message (e.g. “hi”), then press Connect.</p>
          <button className="btn-primary text-xs" disabled={!!busy} onClick={() => post({ action: "connect" }, "Connected! Check Telegram for a confirmation.")}>{spin("connect")} Connect</button>
        </div>
      )}

      {s.connected && <p className="mt-2 text-xs text-slate-500">{s.enabled ? "Connected. Signals are on." : "Connected. Signals are paused."}</p>}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</p>}
    </section>
  );
}
