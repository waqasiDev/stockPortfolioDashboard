import { NextResponse } from "next/server";
import { curateWatchlist } from "@/lib/curator";
import { aiEnabled } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Ask the AI to refresh its picks on your watchlist right now. */
export async function POST() {
  if (!aiEnabled()) return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local first" }, { status: 400 });
  try {
    return NextResponse.json({ changes: await curateWatchlist() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
