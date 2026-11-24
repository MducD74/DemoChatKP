import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { getThread, updateConversation } from "@/core/service";
import { botAssignInfo } from "@/core/botassign";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  boot();
  const id = decodeURIComponent((await ctx.params).id);
  const t = await getThread(store, id, actorOf(req));
  return t ? NextResponse.json({ ...t, botAssign: botAssignInfo(await store.load(), id, Date.now()) }) : NextResponse.json({ error: "không thấy hoặc không có quyền" }, { status: 404 });
}

export async function PATCH(req: Request, ctx: Ctx) {
  boot();
  const body = await req.json().catch(() => ({}));
  const r = await updateConversation(store, decodeURIComponent((await ctx.params).id), body, actorOf(req));
  return NextResponse.json(r, { status: r.ok ? 200 : ("code" in r && r.code) || 403 });
}
