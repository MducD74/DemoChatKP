import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { markTyping } from "@/core/botassign";

export const dynamic = "force-dynamic";

// Nhân viên đang gõ trong ô soạn: chatbot chờ một lúc (khoảng 2 phút kể từ lần báo cuối) để không gửi chen vào
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const r = await markTyping(store, decodeURIComponent((await ctx.params).id), actorOf(req));
  return NextResponse.json(r, { status: r.ok ? 200 : 403 });
}
