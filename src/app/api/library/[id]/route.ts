import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { deleteMedia, updateMedia } from "@/core/library";

type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, ctx: Ctx) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await updateMedia(store, (await ctx.params).id, await req.json().catch(() => ({})));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
export async function DELETE(req: Request, ctx: Ctx) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await deleteMedia(store, (await ctx.params).id);
  return NextResponse.json(r, { status: r.ok ? 200 : 404 });
}
