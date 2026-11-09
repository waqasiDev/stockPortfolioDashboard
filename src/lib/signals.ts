import "server-only";
import { readStore, updateStore } from "./store";

/**
 * Trade signals → Telegram, so you can copy the AI Trader's moves in your real account.
 *
 * The trader engine runs inside synchronous store updates, so it can't await network calls.
 * It calls `queueSignal()` (an in-memory outbox) and we flush it on the next tick.
 * Setup: create a bot with @BotFather, put TELEGRAM_BOT_TOKEN in .env, message the bot once,
 * then press "Connect" in the AI Trader tab (it finds your chat id via getUpdates).
 */

export type Signal =
  | {
      kind: "BUY";
      symbol: string;
      qty: number;
      price: number;
      value: number;
      pctOfPortfolio: number;
      stopLoss: number | null;
      takeProfit: number | null;
      confidence?: number;
      reason: string;
    }
  | {
      kind: "SELL";
      symbol: string;
      qty: number;
      price: number;
      value: number;
      fractionOfPosition: number;
      realizedPl: number;
      realizedPlPct: number;
      trigger: "ai" | "stop" | "target" | "manual";
      reason: string;
    }
  | { kind: "QUEUED"; side: "BUY" | "SELL"; symbol: string; price: number; pctOfPortfolio: number; fractionOfPosition: number; reason: string }
  | { kind: "CANCELLED"; side: "BUY" | "SELL"; symbol: string; reason: string };

const g = globalThis as unknown as { __signalOutbox?: Signal[]; __signalFlushing?: boolean };
const outbox = () => (g.__signalOutbox ??= []);

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
export const telegramConfigured = () => Boolean(token());

export function queueSignal(s: Signal) {
  if (!telegramConfigured()) return;
  outbox().push(s);
  setTimeout(() => void flushSignals(), 0);
}

async function flushSignals() {
  if (g.__signalFlushing) return;
  g.__signalFlushing = true;
  try {
    while (outbox().length) {
      const s = outbox().shift()!;
      const { signalsEnabled, telegramChatId } = readStore().settings;
      if (!signalsEnabled || !telegramChatId) continue;
      try {
        await sendTelegram(telegramChatId, format(s));
      } catch (e) {
        console.error("[signals] Telegram send failed:", (e as Error).message);
      }
    }
  } finally {
    g.__signalFlushing = false;
  }
}

async function tg(method: string, body?: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || `Telegram ${method} failed (${r.status})`);
  return j.result;
}

export const sendTelegram = (chatId: string, html: string) => tg("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true });

/** Finds the chat id of whoever last messaged the bot, saves it, and sends a confirmation. */
export async function connectTelegram() {
  if (!telegramConfigured()) throw new Error("Add TELEGRAM_BOT_TOKEN to .env and restart the app first.");
  const me = await tg("getMe");
  const updates: { message?: { chat: { id: number; first_name?: string; title?: string; username?: string } } }[] = await tg("getUpdates");
  const chat = updates.map((u) => u.message?.chat).filter(Boolean).at(-1);
  if (!chat) throw new Error(`No messages found. Open Telegram, send any message (e.g. "hi") to @${me.username}, then press Connect again.`);
  const chatId = String(chat.id);
  updateStore((d) => {
    d.settings.telegramChatId = chatId;
    d.settings.signalsEnabled = true;
  });
  await sendTelegram(chatId, "✅ <b>Stock Pulse connected.</b>\nYou'll get a message here every time the AI Trader buys or sells.");
  return { bot: me.username as string, chat: chat.title || chat.first_name || chat.username || chatId };
}

export async function sendTestSignal() {
  const id = readStore().settings.telegramChatId;
  if (!id) throw new Error("Not connected yet");
  await sendTelegram(
    id,
    `🧪 <b>Test signal</b>\n\n` +
      format({ kind: "BUY", symbol: "AAPL", qty: 2.5, price: 230.12, value: 575.3, pctOfPortfolio: 5.8, stopLoss: 212, takeProfit: 260, confidence: 72, reason: "Example only, not a real trade." }),
  );
}

export function signalStatus() {
  const s = readStore().settings;
  return { configured: telegramConfigured(), connected: Boolean(s.telegramChatId), enabled: s.signalsEnabled };
}

// ---------- formatting ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const $ = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctStr = (n: number) => `${Math.round(n * 10) / 10}%`;
const short = (s: string, n = 280) => esc(s.length > n ? s.slice(0, n - 1) + "…" : s);

function format(s: Signal): string {
  const tail = "\n\n<i>Paper trade by the AI Trader, not financial advice.</i>";
  switch (s.kind) {
    case "BUY":
      return (
        `🟢 <b>BUY ${s.symbol}</b> @ ${$(s.price)}\n` +
        `Size: <b>${pctStr(s.pctOfPortfolio)} of portfolio</b> (${s.qty} sh, ${$(s.value)})\n` +
        (s.stopLoss ? `Stop-loss: ${$(s.stopLoss)}  ` : "") +
        (s.takeProfit ? `Target: ${$(s.takeProfit)}` : "") +
        (s.stopLoss || s.takeProfit ? "\n" : "") +
        (s.confidence !== undefined ? `Confidence: ${s.confidence}/100\n` : "") +
        `\n<b>Why:</b> ${short(s.reason)}\n\n` +
        `👉 <b>To copy:</b> put ~${pctStr(s.pctOfPortfolio)} of your portfolio into ${s.symbol} near ${$(s.price)}` +
        (s.stopLoss ? `, stop-loss ${$(s.stopLoss)}` : "") +
        "." +
        tail
      );
    case "SELL": {
      const all = s.fractionOfPosition >= 0.98;
      const label = s.trigger === "stop" ? "STOP-LOSS HIT" : s.trigger === "target" ? "TARGET HIT" : "SELL";
      const icon = s.trigger === "stop" ? "🛑" : s.trigger === "target" ? "🎯" : "🔴";
      return (
        `${icon} <b>${label} ${s.symbol}</b> @ ${$(s.price)}\n` +
        `Sold <b>${all ? "the whole position" : `${pctStr(s.fractionOfPosition * 100)} of the position`}</b> (${s.qty} sh, ${$(s.value)})\n` +
        `Result: ${s.realizedPl >= 0 ? "+" : ""}${$(s.realizedPl)} (${s.realizedPlPct >= 0 ? "+" : ""}${pctStr(s.realizedPlPct)})\n` +
        `\n<b>Why:</b> ${short(s.reason)}\n\n` +
        `👉 <b>To copy:</b> sell ${all ? "all" : `${pctStr(s.fractionOfPosition * 100)}`} of your ${s.symbol} shares near ${$(s.price)}.` +
        tail
      );
    }
    case "QUEUED":
      return (
        `🕒 <b>${s.side} ${s.symbol} queued for the market open</b> (last ${$(s.price)})\n` +
        (s.side === "BUY" ? `Planned size: ~${pctStr(s.pctOfPortfolio)} of portfolio\n` : `Planned: sell ${s.fractionOfPosition >= 0.98 ? "the whole position" : pctStr(s.fractionOfPosition * 100) + " of the position"}\n`) +
        `Fills after 9:35 ET${s.side === "BUY" ? ", cancelled if it opens more than 3% higher" : ""}. You'll get another message when it fills.\n` +
        `\n<b>Why:</b> ${short(s.reason)}` +
        tail
      );
    case "CANCELLED":
      return `⚪️ <b>${s.side} ${s.symbol} cancelled</b>, don't place this one.\n${short(s.reason)}`;
  }
}
