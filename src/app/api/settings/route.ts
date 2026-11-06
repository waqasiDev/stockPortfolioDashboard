import { NextResponse } from "next/server";
import { readStore, updateStore } from "@/lib/store";

export async function GET() {
  return NextResponse.json(readStore().settings);
}

export async function POST(req: Request) {
  const body = await req.json();
  const s = updateStore((d) => {
    if (typeof body.aiWatchlist === "boolean") d.settings.aiWatchlist = body.aiWatchlist;
    if (typeof body.autoBrief === "boolean") d.settings.autoBrief = body.autoBrief;
    if (Number(body.maxAiPicks) >= 0) d.settings.maxAiPicks = Math.min(20, Math.round(Number(body.maxAiPicks)));
    return d.settings;
  });
  return NextResponse.json(s);
}
