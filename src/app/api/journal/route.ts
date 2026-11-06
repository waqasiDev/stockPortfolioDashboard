import { NextResponse } from "next/server";
import { addEntry, deleteEntry, journalWithOutcomes, reviewJournal, updateEntry } from "@/lib/journal";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({ entries: await journalWithOutcomes(), review: readStore().journalReview ?? null });
}

/** body: { action: "add" | "update" | "review", ... } */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    if (body.action === "review") return NextResponse.json({ review: await reviewJournal() });
    if (body.action === "update") {
      updateEntry(String(body.id), body.patch ?? {});
      return NextResponse.json({ ok: true });
    }
    if (!body.symbol || !body.action || !String(body.reasoning ?? "").trim()) throw new Error("Symbol, action and your reasoning are required");
    return NextResponse.json({ entry: await addEntry(body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  deleteEntry(new URL(req.url).searchParams.get("id") ?? "");
  return NextResponse.json({ ok: true });
}
