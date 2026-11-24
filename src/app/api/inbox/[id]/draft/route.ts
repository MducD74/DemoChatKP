import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { askBot, getLiveDraft, reviewDraft } from "@/core/botreview";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Nháp đang chờ duyệt của hội thoại (chỉ khi kênh ở chế độ nháp và người xem có quyền)
export async function GET(req: Request, ctx: Ctx) {
  boot();
  return NextResponse.json(await getLiveDraft(store, decodeURIComponent((await ctx.params).id), actorOf(req)));
}

// POST { action: "use" | "edit" | "discard" | "ask" }. Chỉ nhân viên có quyền trả lời mới duyệt được; "use" gửi bằng quyền của họ.
export async function POST(req: Request, ctx: Ctx) {
  boot();
  const id = decodeURIComponent((await ctx.params).id);
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const actor = actorOf(req);
  const r = action === "ask" ? await askBot(store, id, actor)
    : action === "use" || action === "edit" || action === "discard" ? await reviewDraft(store, id, action, actor)
    : ({ ok: false, error: "Thao tác không hợp lệ" } as const);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
