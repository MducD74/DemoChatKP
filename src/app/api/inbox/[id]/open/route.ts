import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { logOpen } from "@/core/audit";
import { canView } from "@/core/policy";

// Giao diện gọi một lần khi người dùng mở một hội thoại (không gọi lại mỗi lần làm mới) để ghi vào Nhật ký.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const id = decodeURIComponent((await ctx.params).id);
  const actor = actorOf(req);
  const db = await store.load();
  const c = db.conversations[id];
  if (!c || !canView(actor, c, db.channels[c.channelId])) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: await logOpen(store, id, actor) });
}
