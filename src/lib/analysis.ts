import type {
  Analysis,
  BuyVerdict,
  Fundamentals,
  HoldAction,
  Holding,
  QuoteLite,
  Signal,
  Technicals,
} from "./types";

const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

/**
 * Rule-based "is this a good price to buy?" score, 0-100.
 * 50 = neutral. Each rule nudges the score and leaves a human-readable signal behind.
 */
export function analyzeBuy(
  q: QuoteLite,
  t: Technicals | undefined,
  f: Fundamentals | undefined,
  targetPrice?: number | null,
): Analysis {
  let score = 50;
  const signals: Signal[] = [];
  const add = (delta: number, s: Signal) => {
    score += delta;
    signals.push(s);
  };
  const p = q.price;

  // 1. Your own target price
  if (targetPrice && targetPrice > 0) {
    const dist = ((p - targetPrice) / targetPrice) * 100;
    if (p <= targetPrice)
      add(25, { label: "At / below your target", detail: `Price ${p.toFixed(2)} ≤ target ${targetPrice.toFixed(2)}`, tone: "good" });
    else if (dist <= 3)
      add(10, { label: "Near your target", detail: `${dist.toFixed(1)}% above your target ${targetPrice.toFixed(2)}`, tone: "good" });
    else
      signals.push({ label: "Above your target", detail: `${dist.toFixed(1)}% above target ${targetPrice.toFixed(2)}`, tone: "neutral" });
  }

  if (t) {
    // 2. RSI momentum
    if (t.rsi14 !== undefined) {
      const r = t.rsi14;
      if (r < 30) add(15, { label: "Oversold (RSI)", detail: `RSI ${r.toFixed(0)} < 30 — sellers may be exhausted`, tone: "good" });
      else if (r < 40) add(7, { label: "Cooling off (RSI)", detail: `RSI ${r.toFixed(0)} — below average momentum`, tone: "good" });
      else if (r > 75) add(-15, { label: "Overbought (RSI)", detail: `RSI ${r.toFixed(0)} > 75 — stretched, pullback risk`, tone: "bad" });
      else if (r > 65) add(-6, { label: "Running hot (RSI)", detail: `RSI ${r.toFixed(0)} — strong but getting extended`, tone: "bad" });
      else signals.push({ label: "RSI neutral", detail: `RSI ${r.toFixed(0)}`, tone: "neutral" });
    }

    // 3. Where in the 52-week range
    if (t.rangePos !== undefined && t.high52 && t.low52) {
      const off = ((p - t.high52) / t.high52) * 100;
      if (t.rangePos < 0.2) add(10, { label: "Near 52-week low", detail: `${off.toFixed(0)}% from 52w high (${t.low52.toFixed(2)}–${t.high52.toFixed(2)})`, tone: "good" });
      else if (t.rangePos > 0.92) add(-7, { label: "Near 52-week high", detail: `Within ${Math.abs(off).toFixed(1)}% of 52w high — buying at the top of the range`, tone: "bad" });
      else signals.push({ label: "Mid 52-week range", detail: `${(t.rangePos * 100).toFixed(0)}% of the way from low to high`, tone: "neutral" });
    }

    // 4. Trend: 200-day & 50-day moving averages
    if (t.sma200) {
      const vs200 = ((p - t.sma200) / t.sma200) * 100;
      if (vs200 >= 0) add(5, { label: "Long-term uptrend", detail: `${pct(vs200)} above 200-day avg`, tone: "good" });
      else add(-5, { label: "Below 200-day avg", detail: `${pct(vs200)} vs 200-day avg — long-term trend is weak`, tone: "bad" });

      if (t.sma50) {
        const vs50 = ((p - t.sma50) / t.sma50) * 100;
        if (vs200 >= 0 && vs50 <= 2 && vs50 >= -4)
          add(8, { label: "Pullback to 50-day avg", detail: `Uptrend stock dipping to its 50-day avg (${pct(vs50)}) — classic entry area`, tone: "good" });
        if (vs50 > 12) add(-6, { label: "Extended above 50-day", detail: `${pct(vs50)} above 50-day avg — consider waiting for a dip`, tone: "bad" });
        if (t.sma50 > t.sma200) add(4, { label: "Golden cross regime", detail: "50-day avg above 200-day avg", tone: "good" });
        else add(-4, { label: "Death cross regime", detail: "50-day avg below 200-day avg", tone: "bad" });
      }
    }
  }

  // 5. Valuation
  if (f?.pegRatio !== undefined && f.pegRatio > 0) {
    if (f.pegRatio < 1) add(8, { label: "Cheap vs growth (PEG)", detail: `PEG ${f.pegRatio.toFixed(2)} < 1`, tone: "good" });
    else if (f.pegRatio > 2.5) add(-5, { label: "Expensive vs growth (PEG)", detail: `PEG ${f.pegRatio.toFixed(2)} > 2.5`, tone: "bad" });
  }
  if (q.trailingPE && q.forwardPE && q.forwardPE > 0) {
    if (q.forwardPE < q.trailingPE * 0.85)
      add(4, { label: "Earnings expected to grow", detail: `Forward P/E ${q.forwardPE.toFixed(1)} vs trailing ${q.trailingPE.toFixed(1)}`, tone: "good" });
    if (q.trailingPE > 60) add(-5, { label: "High P/E", detail: `Trailing P/E ${q.trailingPE.toFixed(0)} — priced for perfection`, tone: "bad" });
  }

  // 6. Wall Street analysts
  if (f?.analystTarget) {
    const up = ((f.analystTarget - p) / p) * 100;
    const who = f.analystCount ? `${f.analystCount} analysts` : "Analysts";
    if (up > 15) add(8, { label: "Analyst upside", detail: `${who} avg target ${f.analystTarget.toFixed(2)} (${pct(up)})`, tone: "good" });
    else if (up < 0) add(-8, { label: "Above analyst target", detail: `Trading ${pct(-up)} above avg target ${f.analystTarget.toFixed(2)}`, tone: "bad" });
    else signals.push({ label: "Modest analyst upside", detail: `Avg target ${f.analystTarget.toFixed(2)} (${pct(up)})`, tone: "neutral" });
  }
  if (f?.recommendation === "strong_buy" || f?.recommendation === "buy")
    add(3, { label: "Analyst rating: " + f.recommendation.replace("_", " "), detail: "Consensus recommendation", tone: "good" });
  else if (f?.recommendation === "sell" || f?.recommendation === "underperform")
    add(-5, { label: "Analyst rating: " + f.recommendation, detail: "Consensus recommendation", tone: "bad" });

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, verdict: verdictFor(score), signals: sortSignals(signals) };
}

export function verdictFor(score: number): BuyVerdict {
  if (score >= 75) return "Strong Buy Zone";
  if (score >= 60) return "Buy Zone";
  if (score >= 45) return "Neutral";
  if (score >= 30) return "Wait";
  return "Overheated";
}

function sortSignals(s: Signal[]) {
  const rank = { good: 0, bad: 1, neutral: 2 } as const;
  return [...s].sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** Suggested action for a position you already own. */
export function holdingAction(
  h: Holding,
  q: QuoteLite,
  t: Technicals | undefined,
  buy: Analysis,
): { action: HoldAction; reason: string } {
  const plPct = ((q.price - h.avgPrice) / h.avgPrice) * 100;
  if (h.stopLoss && q.price <= h.stopLoss)
    return { action: "Review – Stop Hit", reason: `Price ${q.price.toFixed(2)} fell to your stop-loss ${h.stopLoss.toFixed(2)}` };
  if (h.takeProfit && q.price >= h.takeProfit)
    return { action: "Take Profit", reason: `Reached your take-profit ${h.takeProfit.toFixed(2)} (${pct(plPct)})` };
  if (t?.rsi14 !== undefined && t.rsi14 > 75 && plPct > 15)
    return { action: "Consider Trimming", reason: `Up ${plPct.toFixed(1)}% and overbought (RSI ${t.rsi14.toFixed(0)}) — locking in part of the gain is reasonable` };
  if (t?.sma200 && q.price < t.sma200 && plPct < -15)
    return { action: "Consider Trimming", reason: `Down ${Math.abs(plPct).toFixed(1)}% and below its 200-day avg — re-check your thesis` };
  if (buy.score >= 65 && q.price < h.avgPrice)
    return { action: "Add More", reason: `Buy-zone score ${buy.score} and price is below your avg cost — averaging down lowers cost basis` };
  if (buy.score >= 70)
    return { action: "Add More", reason: `Buy-zone score ${buy.score} — signals favour adding` };
  return { action: "Hold", reason: plPct >= 0 ? `Up ${plPct.toFixed(1)}% — no exit signals` : `Down ${Math.abs(plPct).toFixed(1)}% — no exit signals yet` };
}
