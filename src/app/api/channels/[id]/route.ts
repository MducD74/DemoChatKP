import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { removeChannel } from "@/core/connect";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await removeChannel(store, (await ctx.params).id);
  return r ? NextResponse.json({ ok: true, result: r }) : NextResponse.json({ ok: false }, { status: 404 });
}
