import "server-only";
import { getQuotes } from "./market";
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

/** Your side of the trade: how big your account is and how many shares you hold. */
export type CopyCtx = { accountUsd: number; source: "budget" | "portfolio"; held: Record<string, number> };

export async function copyContext(): Promise<CopyCtx> {
  const d = readStore();
  const held: Record<string, number> = {};
  for (const h of d.holdings) held[h.symbol] = (held[h.symbol] ?? 0) + h.qty;
  if (d.settings.copyBudgetUsd > 0) return { accountUsd: d.settings.copyBudgetUsd, source: "budget", held };
  // default: the live value of your real portfolio (falls back to cost if quotes fail)
  let value = d.holdings.reduce((a, h) => a + h.qty * h.avgPrice, 0);
  try {
    const q = await getQuotes(d.holdings.map((h) => h.symbol));
    value = d.holdings.reduce((a, h) => a + h.qty * (q[h.symbol]?.price ?? h.avgPrice), 0);
  } catch {}
  return { accountUsd: value, source: "portfolio", held };
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
        await sendTelegram(telegramChatId, formatSignal(s, await copyContext()));
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
      formatSignal(
        { kind: "BUY", symbol: "AAPL", qty: 2.5, price: 230.12, value: 575.3, pctOfPortfolio: 5.8, stopLoss: 212, takeProfit: 260, confidence: 72, reason: "Example only, not a real trade." },
        await copyContext(),
      ),
  );
}

export function setCopyBudget(usd: number) {
  updateStore((d) => void (d.settings.copyBudgetUsd = Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) / 100 : 0));
}

export function signalStatus() {
  const s = readStore().settings;
  return { configured: telegramConfigured(), connected: Boolean(s.telegramChatId), enabled: s.signalsEnabled, copyBudgetUsd: s.copyBudgetUsd };
}

// ---------- formatting ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const $ = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctStr = (n: number) => `${Math.round(n * 10) / 10}%`;
const short = (s: string, n = 280) => esc(s.length > n ? s.slice(0, n - 1) + "…" : s);
const sh = (n: number) => `${Number(n.toFixed(2))} ${n === 1 ? "share" : "shares"}`;
const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;
const tail = "\n\n<i>Copied from the AI Trader's paper trades. Not financial advice.</i>";

/** "Buy 2.49 shares ≈ $573.00", sized to your account, with a whole-share alternative. */
function yourBuy(symbol: string, price: number, pctOfPortfolio: number, c: CopyCtx, verb = "Buy") {
  if (!(c.accountUsd > 0) || !(price > 0))
    return `👉 <b>${verb} ~${pctStr(pctOfPortfolio)} of your portfolio in ${symbol}</b>\n(Set a copy budget in the AI Trader tab to get exact share counts.)`;
  const dollars = (pctOfPortfolio / 100) * c.accountUsd;
  const shares = floor2(dollars / price);
  const whole = Math.floor(shares);
  const base = c.source === "budget" ? `your ${$(c.accountUsd)} copy budget` : `your ${$(c.accountUsd)} portfolio`;
  let out = `👉 <b>YOUR ORDER: ${verb} ${sh(shares)} of ${symbol}</b> ≈ <b>${$(shares * price)}</b>\n`;
  if (whole >= 1 && whole !== shares) out += `   Whole shares only? ${verb} ${sh(whole)} ≈ ${$(whole * price)}\n`;
  if (whole === 0) out += `   That's less than 1 share, so it needs fractional shares (Revolut supports them).\n`;
  out += `   Sized at ${pctStr(pctOfPortfolio)} of ${base}, the same as the AI.`;
  if (c.held[symbol]) out += `\n   You already own ${sh(c.held[symbol])}. This adds to them.`;
  return out;
}

/** "Sell 3.2 shares ≈ $560", using how many shares YOU hold (from your Portfolio tab). */
function yourSell(symbol: string, price: number, fraction: number, c: CopyCtx, verb = "Sell") {
  const all = fraction >= 0.98;
  const mine = c.held[symbol] ?? 0;
  if (!mine)
    return `👉 You don't own ${symbol} in Stock Pulse, so there's nothing to sell.\n   (If you copied the AI's earlier buy, ${verb.toLowerCase()} ${all ? "all" : pctStr(fraction * 100)} of those shares.)`;
  const qty = all ? mine : floor2(mine * fraction);
  return (
    `👉 <b>YOUR ORDER: ${verb} ${sh(qty)} of ${symbol}</b> ≈ <b>${$(qty * price)}</b>\n` +
    `   ${all ? `That's all of your ${sh(mine)}.` : `That's ${pctStr(fraction * 100)} of your ${sh(mine)}.`}`
  );
}

export function formatSignal(s: Signal, c: CopyCtx): string {
  switch (s.kind) {
    case "BUY":
      return (
        `🟢 <b>BUY ${s.symbol}</b> @ ${$(s.price)}\n\n` +
        yourBuy(s.symbol, s.price, s.pctOfPortfolio, c) +
        "\n\n" +
        (s.stopLoss ? `🛑 Stop-loss: <b>${$(s.stopLoss)}</b>\n` : "") +
        (s.takeProfit ? `🎯 Target: <b>${$(s.takeProfit)}</b>\n` : "") +
        (s.confidence !== undefined ? `Confidence: ${s.confidence}/100\n` : "") +
        `\n<b>Why:</b> ${short(s.reason)}\n` +
        `<i>AI paper trade: ${sh(s.qty)} for ${$(s.value)}</i>` +
        tail
      );
    case "SELL": {
      const label = s.trigger === "stop" ? "STOP-LOSS HIT: SELL" : s.trigger === "target" ? "TARGET HIT: SELL" : "SELL";
      const icon = s.trigger === "stop" ? "🛑" : s.trigger === "target" ? "🎯" : "🔴";
      return (
        `${icon} <b>${label} ${s.symbol}</b> @ ${$(s.price)}\n\n` +
        yourSell(s.symbol, s.price, s.fractionOfPosition, c) +
        `\n\n<b>Why:</b> ${short(s.reason)}\n` +
        `<i>AI paper trade: sold ${sh(s.qty)} for ${$(s.value)}, ${s.realizedPl >= 0 ? "+" : ""}${$(s.realizedPl)} (${s.realizedPlPct >= 0 ? "+" : ""}${pctStr(s.realizedPlPct)})</i>` +
        tail
      );
    }
    case "QUEUED":
      return (
        `🕒 <b>${s.side} ${s.symbol}: planned for the market open</b> (last price ${$(s.price)})\n\n` +
        (s.side === "BUY" ? yourBuy(s.symbol, s.price, s.pctOfPortfolio, c, "Plan to buy") : yourSell(s.symbol, s.price, s.fractionOfPosition, c, "Plan to sell")) +
        `\n\nThe AI places it after 9:35 ET${s.side === "BUY" ? ", or skips it if the stock opens more than 3% higher" : ""}. ` +
        `<b>Wait for the fill message</b>, which will have the final numbers.\n` +
        `\n<b>Why:</b> ${short(s.reason)}` +
        tail
      );
    case "CANCELLED":
      return `⚪️ <b>${s.side} ${s.symbol} cancelled.</b> Don't place this order.\n${short(s.reason)}`;
  }
}
