import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { addNote } from "@/core/service";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const r = await addNote(store, decodeURIComponent((await ctx.params).id), text ?? "", actorOf(req));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
