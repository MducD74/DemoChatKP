import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { botHistory } from "@/core/bothistory";

export const dynamic = "force-dynamic";

// Lịch sử của một chatbot (chỉ quản trị, chỉ đọc). GET ?botId=<mã>
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const botId = new URL(req.url).searchParams.get("botId") ?? "";
  const db = await store.load();
  if (!db.bot?.bots?.[botId]) return NextResponse.json({ ok: false, error: "Không thấy chatbot" }, { status: 404 });
  return NextResponse.json({ ok: true, rows: botHistory(db, botId) });
}
