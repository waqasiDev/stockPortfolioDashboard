import type { EnrichedHolding, HealthReport } from "./types";

/** Speculative = small cap (< $2B) or losing money. */
export const isSpeculative = (h: Pick<EnrichedHolding, "quote" | "fund">) =>
  (h.quote?.marketCap !== undefined && h.quote.marketCap < 2e9) || (h.fund?.profitMargin !== undefined && h.fund.profitMargin < 0);

/** Rule-based portfolio health: diversification, concentration, speculation and risk management. */
export function computeHealth(holdings: EnrichedHolding[]): HealthReport | null {
  const live = holdings.filter((h) => h.value > 0);
  if (!live.length) return null;
  const total = live.reduce((a, h) => a + h.value, 0);
  const byWeight = [...live].sort((a, b) => b.value - a.value);
  const w = (v: number) => (v / total) * 100;

  const topHoldingPct = w(byWeight[0].value);
  const top3Pct = w(byWeight.slice(0, 3).reduce((a, h) => a + h.value, 0));
  const sectorMap = new Map<string, number>();
  for (const h of live) sectorMap.set(h.fund?.sector ?? "Unknown", (sectorMap.get(h.fund?.sector ?? "Unknown") ?? 0) + h.value);
  const sectors = [...sectorMap.entries()].map(([sector, v]) => ({ sector, weight: w(v) })).sort((a, b) => b.weight - a.weight);
  const topSector = sectors.find((s) => s.sector !== "Unknown") ?? sectors[0];
  const speculative = live.filter(isSpeculative);
  const speculativePct = w(speculative.reduce((a, h) => a + h.value, 0));
  const stopsCoveragePct = (live.filter((h) => h.stopLoss).length / live.length) * 100;
  const deepLosers = live.filter((h) => h.plPct <= -25);

  let score = 100;
  const issues: HealthReport["issues"] = [];
  const strengths: string[] = [];
  const hit = (pts: number, severity: "bad" | "warn", text: string) => {
    score -= pts;
    issues.push({ severity, text });
  };

  if (topHoldingPct > 25) hit(20, "bad", `${byWeight[0].symbol} is ${topHoldingPct.toFixed(0)}% of your portfolio — one bad report could hurt a lot. Aim for ≤15%.`);
  else if (topHoldingPct > 15) hit(10, "warn", `${byWeight[0].symbol} is ${topHoldingPct.toFixed(0)}% of your portfolio (above the ~15% comfort zone).`);
  else strengths.push(`No single stock is over 15% (largest: ${byWeight[0].symbol} ${topHoldingPct.toFixed(0)}%).`);

  if (top3Pct > 60) hit(10, "warn", `Your top 3 positions are ${top3Pct.toFixed(0)}% of the portfolio.`);

  if (topSector && topSector.weight > 50) hit(15, "bad", `${topSector.weight.toFixed(0)}% is in ${topSector.sector} — a sector sell-off hits almost everything at once.`);
  else if (topSector && topSector.weight > 35) hit(8, "warn", `${topSector.weight.toFixed(0)}% is in ${topSector.sector}. Consider adding other sectors.`);
  else if (sectors.length >= 4) strengths.push(`Spread across ${sectors.length} sectors.`);

  if (speculativePct > 30)
    hit(15, "bad", `${speculativePct.toFixed(0)}% is in speculative names (small caps or unprofitable: ${speculative.map((h) => h.symbol).join(", ")}).`);
  else if (speculativePct > 15) hit(8, "warn", `${speculativePct.toFixed(0)}% is in speculative names (${speculative.map((h) => h.symbol).join(", ")}).`);
  else strengths.push("Mostly established, profitable companies.");

  if (live.length < 5) hit(10, "warn", `Only ${live.length} positions — returns depend heavily on a few stocks.`);
  else if (live.length > 25) hit(5, "warn", `${live.length} positions is a lot to track; consider consolidating into your best ideas.`);

  if (stopsCoveragePct < 50) hit(10, "warn", `Only ${stopsCoveragePct.toFixed(0)}% of positions have a stop-loss set — decide your exit before you need it.`);
  else strengths.push(`${stopsCoveragePct.toFixed(0)}% of positions have a stop-loss.`);

  if (deepLosers.length)
    hit(Math.min(15, deepLosers.length * 4), "warn", `${deepLosers.map((h) => h.symbol).join(", ")} ${deepLosers.length === 1 ? "is" : "are"} down 25%+ — re-check whether the original reason to own still holds.`);

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  const label = { A: "Well diversified", B: "Mostly healthy", C: "Needs attention", D: "High risk", F: "Very high risk" }[grade];

  return {
    score,
    grade,
    label,
    issues: issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "bad" ? -1 : 1)),
    strengths,
    sectors,
    topHoldingPct,
    top3Pct,
    speculativePct,
    stopsCoveragePct,
  };
}
