import { NextResponse } from "next/server";
import { boot, store, adminOnly } from "@/server";
import { NextResponse as NR } from "next/server";
import { staticTokens } from "@/core/token-store";
import { subscribeMetaPage, verifyMetaToken } from "@/core/connect";

// POST { token }: kiểm token với Meta rồi lưu mã hóa. POST { subscribe: true }: đăng ký Page nhận tin.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NR) return a;
  const id = (await ctx.params).id;
  const ch = (await store.load()).channels[id];
  if (!ch || (ch.kind !== "facebook" && ch.kind !== "instagram")) return NextResponse.json({ ok: false, error: "Không phải kênh Meta" }, { status: 404 });
  const pageId = ch.meta?.pageId ?? ch.externalId;
  const body = (await req.json().catch(() => ({}))) as { token?: string; subscribe?: boolean };
  const st = staticTokens(store);
  if (body.subscribe) {
    const token = await st.get(id);
    if (!token) return NextResponse.json({ ok: false, error: "Chưa có token" }, { status: 400 });
    const r = await subscribeMetaPage(pageId, token);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  const token = body.token?.trim();
  if (!token) return NextResponse.json({ ok: false, error: "Thiếu token" }, { status: 400 });
  const v = await verifyMetaToken(token, pageId);
  if (!v.ok) return NextResponse.json(v, { status: 400 });
  await st.save(id, token);
  return NextResponse.json({ ok: true, name: v.name });
}
