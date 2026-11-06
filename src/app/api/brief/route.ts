import { NextResponse } from "next/server";
import { briefInProgress, generateBrief, latestBrief, nyNow } from "@/lib/brief";
import { aiEnabled } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ brief: latestBrief(), today: nyNow().date, generating: briefInProgress(), aiEnabled: aiEnabled() });
}

/** Generates (or regenerates) today's brief. Also refreshes the AI watchlist picks. */
export async function POST() {
  try {
    return NextResponse.json({ brief: await generateBrief() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
