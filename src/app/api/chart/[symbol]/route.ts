import { NextResponse } from "next/server";
import { getChart } from "@/lib/market";
import { smaSeries } from "@/lib/indicators";
import { normSymbol } from "@/lib/store";

type Ctx = { params: Promise<{ symbol: string }> };
const RANGES = ["1M", "6M", "1Y", "5Y"] as const;

export async function GET(req: Request, { params }: Ctx) {
  const { symbol } = await params;
  const r = new URL(req.url).searchParams.get("range") ?? "6M";
  const range = (RANGES as readonly string[]).includes(r) ? (r as (typeof RANGES)[number]) : "6M";
  try {
    const { bars, days } = await getChart(normSymbol(symbol), range);
    const closes = bars.map((b) => b.close);
    const s50 = smaSeries(closes, 50);
    const s200 = smaSeries(closes, 200);
    const cutoff = Date.now() - days * 86_400_000;
    const points = bars
      .map((b, i) => ({ date: b.date, close: b.close, sma50: s50[i], sma200: s200[i] }))
      .filter((p) => new Date(p.date).getTime() >= cutoff);
    return NextResponse.json(points);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
