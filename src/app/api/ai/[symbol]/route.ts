import { NextResponse } from "next/server";
import { analyzeStock, getCachedAnalysis } from "@/lib/advisor";
import { normSymbol } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ symbol: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { symbol } = await params;
  return NextResponse.json(getCachedAnalysis(normSymbol(symbol)));
}

export async function POST(req: Request, { params }: Ctx) {
  const { symbol } = await params;
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    return NextResponse.json(await analyzeStock(normSymbol(symbol), force));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
