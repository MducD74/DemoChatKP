import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { routeUnassigned, setChannelRouting } from "@/core/service";

// PUT { routing: {...} | null }: cài hoặc gỡ chia khách. POST: chia lại các hội thoại chưa nhận của kênh.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const body = (await req.json().catch(() => ({}))) as { routing?: unknown };
  if (!("routing" in body)) return NextResponse.json({ ok: false, error: "Thiếu dữ liệu" }, { status: 400 });
  const r = await setChannelRouting(store, (await ctx.params).id, body.routing ?? null);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await routeUnassigned(store, (await ctx.params).id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
