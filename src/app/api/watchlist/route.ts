import { NextResponse } from "next/server";
import { normSymbol, updateStore } from "@/lib/store";

const numOrNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));

export async function POST(req: Request) {
  const body = await req.json();
  const symbol = normSymbol(String(body.symbol ?? ""));
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  updateStore((d) => {
    const existing = d.watchlist.find((w) => w.symbol === symbol);
    if (existing) {
      if ("targetPrice" in body) existing.targetPrice = numOrNull(body.targetPrice);
      if ("notes" in body) existing.notes = body.notes;
      // "keep": dismiss the AI's removal suggestion for good
      if (body.action === "keep") {
        existing.aiRemoveSuggestion = null;
        existing.aiKeep = true;
      }
      // "adopt": make an AI pick your own, so the AI will never remove it
      if (body.action === "adopt") existing.addedBy = "user";
    } else {
      d.watchlist.push({
        symbol,
        targetPrice: numOrNull(body.targetPrice),
        notes: body.notes ?? "",
        addedAt: new Date().toISOString(),
        addedBy: "user",
      });
    }
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const symbol = normSymbol(new URL(req.url).searchParams.get("symbol") ?? "");
  updateStore((d) => {
    d.watchlist = d.watchlist.filter((w) => w.symbol !== symbol);
  });
  return NextResponse.json({ ok: true });
}
