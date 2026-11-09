import { NextResponse } from "next/server";
import { connectTelegram, sendTestSignal, signalStatus } from "@/lib/signals";
import { updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(signalStatus());
}

/** body: { action: "connect" | "test" | "disconnect" } or { action: "toggle", enabled: boolean } */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    if (body.action === "connect") await connectTelegram();
    else if (body.action === "test") await sendTestSignal();
    else if (body.action === "disconnect") updateStore((d) => void (d.settings.telegramChatId = null));
    else if (body.action === "toggle") updateStore((d) => void (d.settings.signalsEnabled = Boolean(body.enabled)));
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    return NextResponse.json({ ...signalStatus(), ok: true });
  } catch (e) {
    return NextResponse.json({ ...signalStatus(), error: (e as Error).message }, { status: 400 });
  }
}
