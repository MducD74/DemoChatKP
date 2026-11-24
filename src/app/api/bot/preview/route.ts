import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { syncBotKey } from "@/core/chatbot";
import { previewChat } from "@/core/botpreview";

export const dynamic = "force-dynamic";

// Xem thử chatbot với cấu hình đang sửa (chỉ quản trị). Không lưu gì, không gửi tin cho ai.
// POST { botId?, form: { name, type, mode, tone, instructions, docIds, useTemplates, model, channelIds }, messages: [{ role: "user" | "assistant", content }] }
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const db = await store.load();
  syncBotKey(db);
  const r = await previewChat(db, (await req.json().catch(() => ({}))) as Record<string, unknown>);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
