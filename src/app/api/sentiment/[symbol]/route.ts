import { NextResponse } from "next/server";
import { getSentiment } from "@/lib/research";
import { normSymbol } from "@/lib/store";

type Ctx = { params: Promise<{ symbol: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { symbol } = await params;
  try {
    return NextResponse.json(await getSentiment(normSymbol(symbol)));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
