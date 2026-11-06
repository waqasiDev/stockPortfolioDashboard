import { NextResponse } from "next/server";
import { normSymbol, updateStore } from "@/lib/store";

const numOrNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));

/** Create or update a holding. Set `mode: "buy"` to add shares and re-average the cost. */
export async function POST(req: Request) {
  const body = await req.json();
  const symbol = normSymbol(String(body.symbol ?? ""));
  const qty = Number(body.qty);
  const avgPrice = Number(body.avgPrice);
  if (!symbol || !(qty > 0) || !(avgPrice > 0))
    return NextResponse.json({ error: "symbol, qty > 0 and avgPrice > 0 are required" }, { status: 400 });

  updateStore((d) => {
    const h = d.holdings.find((x) => x.symbol === symbol);
    if (h && body.mode === "buy") {
      const newQty = h.qty + qty;
      h.avgPrice = (h.qty * h.avgPrice + qty * avgPrice) / newQty;
      h.qty = newQty;
    } else if (h) {
      h.qty = qty;
      h.avgPrice = avgPrice;
    } else {
      d.holdings.push({ symbol, qty, avgPrice, addedAt: new Date().toISOString() });
    }
    const target = d.holdings.find((x) => x.symbol === symbol)!;
    if ("stopLoss" in body) target.stopLoss = numOrNull(body.stopLoss);
    if ("takeProfit" in body) target.takeProfit = numOrNull(body.takeProfit);
    if ("notes" in body) target.notes = body.notes;
  });
  return NextResponse.json({ ok: true });
}

/** Sell some or all shares (qty param), or remove entirely when qty omitted. */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const symbol = normSymbol(url.searchParams.get("symbol") ?? "");
  const sellQty = Number(url.searchParams.get("qty") ?? 0);
  updateStore((d) => {
    const h = d.holdings.find((x) => x.symbol === symbol);
    if (!h) return;
    if (sellQty > 0 && sellQty < h.qty) h.qty = +(h.qty - sellQty).toFixed(6);
    else d.holdings = d.holdings.filter((x) => x.symbol !== symbol);
  });
  return NextResponse.json({ ok: true });
}
