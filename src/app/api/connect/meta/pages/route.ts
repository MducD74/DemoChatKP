import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { connectPages, pagesForUi, readPickDiag } from "@/core/metalogin";

export const dynamic = "force-dynamic";

// GET ?session=...: danh sách Page để chọn (không có token). POST { session, picks: [{ pageId, instagram }] }: nối các Page đã chọn.
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const session = new URL(req.url).searchParams.get("session") ?? "";
  const pages = await pagesForUi(store, session);
  return pages ? NextResponse.json({ ok: true, pages, diag: await readPickDiag(store, session) }) : NextResponse.json({ ok: false, error: "Phiên chọn Page đã hết hạn, hãy đăng nhập Facebook lại" }, { status: 410 });
}
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { session?: string; picks?: Array<{ pageId: string; instagram?: boolean }> };
  if (!b.session || !Array.isArray(b.picks) || !b.picks.length) return NextResponse.json({ ok: false, error: "Chưa chọn Page nào" }, { status: 400 });
  const r = await connectPages(store, b.session, b.picks);
  return NextResponse.json(r, { status: r.ok ? 200 : 410 });
}
