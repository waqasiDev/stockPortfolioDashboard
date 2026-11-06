import { NextResponse } from "next/server";
import { buildDashboard } from "@/lib/dashboard";
import { aiEnabled } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const data = await buildDashboard(force);
  return NextResponse.json({ ...data, aiEnabled: aiEnabled() });
}
