import { NextResponse } from "next/server";
import { readStore, updateStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readStore().notifications);
}

/** body: { action: "readAll" | "read" | "clear" | "delete", id?: string } */
export async function POST(req: Request) {
  const { action, id } = await req.json();
  updateStore((d) => {
    if (action === "readAll") d.notifications.forEach((n) => (n.read = true));
    if (action === "read") d.notifications.forEach((n) => n.id === id && (n.read = true));
    if (action === "delete") d.notifications = d.notifications.filter((n) => n.id !== id);
    if (action === "clear") d.notifications = [];
  });
  return NextResponse.json({ ok: true });
}
