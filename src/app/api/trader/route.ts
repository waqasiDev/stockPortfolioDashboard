import { NextResponse } from "next/server";
import { aiEnabled } from "@/lib/llm";
import { scannerTick } from "@/lib/scanner";
import { assertAiAllowed } from "@/lib/usage";
import { cancelOrder, deposit, getTraderView, manualClose, resetTrader, runTrader, startTrader, updateConfig } from "@/lib/trader";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ view: await getTraderView(), aiEnabled: aiEnabled() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** body: { action: "start" | "deposit" | "run" | "config" | "reset" | "close", ... } */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    switch (body.action) {
      case "start":
        assertAiAllowed();
        await startTrader(Number(body.amount), body.config ?? {});
        runTrader({ trigger: "manual" }).catch(() => {}); // first run immediately, in background
        break;
      case "deposit":
        await deposit(Number(body.amount));
        break;
      case "run":
        assertAiAllowed();
        runTrader({ trigger: "manual" }).catch(() => {}); // UI polls GET for progress
        break;
      case "pause":
        updateConfig({ paused: Boolean(body.paused) });
        break;
      case "scan":
        await scannerTick(true); // manual scan: checks triggers now and wakes the AI if anything fired
        break;
      case "config":
        updateConfig(body.config ?? {});
        break;
      case "reset":
        resetTrader();
        break;
      case "close": {
        const r = await manualClose(String(body.symbol));
        return NextResponse.json({ ok: true, result: r });
      }
      case "cancelOrder":
        cancelOrder(String(body.id));
        break;
      default:
        throw new Error("Unknown action");
    }
    // give a just-started background run a tick to set its lock so the UI sees "running"
    await new Promise((r) => setTimeout(r, 50));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
