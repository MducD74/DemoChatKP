import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { markRead } from "@/core/service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const ok = await markRead(store, decodeURIComponent((await ctx.params).id), actorOf(req));
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
