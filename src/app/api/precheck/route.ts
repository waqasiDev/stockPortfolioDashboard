import { NextResponse } from "next/server";
import { preBuyCheck } from "@/lib/precheck";
import { normSymbol } from "@/lib/store";

export async function POST(req: Request) {
  const { symbol, qty, price } = await req.json();
  try {
    return NextResponse.json(await preBuyCheck(normSymbol(String(symbol ?? "")), Number(qty) || 0, Number(price) || undefined));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
