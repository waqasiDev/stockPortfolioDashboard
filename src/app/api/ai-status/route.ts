import { NextResponse } from "next/server";
import { updateStore } from "@/lib/store";
import { getAiStatus, setPause } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAiStatus());
}

/**
 * body:
 *  { action: "pause", minutes?: number | "tomorrow" }   — omit minutes to pause until resumed
 *  { action: "resume" }
 *  { action: "settings", dailyBudgetUsd?, priceInputPerM?, priceOutputPerM?, pricePerWebSearch? }
 */
export async function POST(req: Request) {
  const body = await req.json();
  if (body.action === "pause") setPause(true, body.minutes);
  else if (body.action === "resume") setPause(false);
  else if (body.action === "settings") {
    updateStore((d) => {
      if (typeof body.webSearch === "boolean") d.settings.webSearch = body.webSearch;
      for (const k of ["dailyBudgetUsd", "priceInputPerM", "priceOutputPerM", "pricePerWebSearch"] as const) {
        const v = Number(body[k]);
        if (k in body && Number.isFinite(v) && v >= 0) d.settings[k] = v;
      }
    });
  } else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  return NextResponse.json(getAiStatus());
}
