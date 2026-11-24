import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { handBack, takeOver } from "@/core/botreview";
import { setBotAssign } from "@/core/botassign";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// POST { action: "takeover" | "handback" }: nhân viên tiếp quản (dừng bot) hoặc giao lại cho bot
// POST { action: "assign", bot: "" | "none" | <mã chatbot>, withStaff?: boolean }: chọn chatbot phụ trách hội thoại
export async function POST(req: Request, ctx: Ctx) {
  boot();
  const id = decodeURIComponent((await ctx.params).id);
  const body = (await req.json().catch(() => ({}))) as { action?: string; bot?: unknown; withStaff?: unknown };
  const { action } = body;
  const actor = actorOf(req);
  const r = action === "takeover" ? await takeOver(store, id, actor) : action === "handback" ? await handBack(store, id, actor) : action === "assign" ? await setBotAssign(store, id, body, actor) : ({ ok: false, error: "Thao tác không hợp lệ" } as const);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
