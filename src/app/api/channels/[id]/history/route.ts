import { NextResponse } from "next/server";
import { ZALO_PERSONAL_ENABLED, ZALO_PERSONAL_OFF } from "@/core/guardrails";
import { adminOnly, boot, store } from "@/server";
import { cancelHistory, getHistoryJob, importHistory } from "@/core/history";
import { staticTokens } from "@/core/token-store";
import { cancelZaloHistory, getZaloHistoryJob, importZaloHistory } from "@/core/zalohistory";

export const dynamic = "force-dynamic";

// GET: tiến độ lần tải gần nhất. POST { days }: bắt đầu tải (0 = toàn bộ). DELETE: dừng.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const id = (await ctx.params).id;
  return NextResponse.json({ job: getHistoryJob(id) ?? getZaloHistoryJob(id) ?? null });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const id = (await ctx.params).id;
  const body = (await req.json().catch(() => ({}))) as { days?: number; hours?: number; mode?: string };
  const catchup = body.mode === "catchup"; // khôi phục tin lỡ: ghi như tin mới, chỉ trong vài giờ gần nhất
  const days = catchup ? 0 : body.days;
  if (catchup) {
    if (typeof body.hours !== "number" || !Number.isFinite(body.hours) || body.hours < 1 || body.hours > 168) return NextResponse.json({ ok: false, error: "Số giờ khôi phục phải từ 1 đến 168" }, { status: 400 });
  } else if (typeof days !== "number" || !Number.isFinite(days) || days < 0 || days > 3650) return NextResponse.json({ ok: false, error: "Số ngày không hợp lệ" }, { status: 400 });
  const ch = (await store.load()).channels[id];
  if (!ch || ch.off) return NextResponse.json({ ok: false, error: "Không tìm thấy kênh" }, { status: 404 });
  if (ch.kind === "zalo_personal") {
    if (!ZALO_PERSONAL_ENABLED) return NextResponse.json({ ok: false, error: ZALO_PERSONAL_OFF }, { status: 403 });
    if (catchup) return NextResponse.json({ ok: false, error: "Zalo cá nhân nhận tin trực tiếp, không có webhook nên không cần khôi phục tin lỡ" }, { status: 400 });
    if (getZaloHistoryJob(id)?.status === "running") return NextResponse.json({ ok: false, error: "Kênh này đang tải, đợi xong hoặc bấm Dừng" }, { status: 409 });
    void importZaloHistory(store, ch, { days: days as number });
    return NextResponse.json({ ok: true, job: getZaloHistoryJob(id) });
  }
  if (ch.kind !== "facebook" && ch.kind !== "instagram") return NextResponse.json({ ok: false, error: "Hiện chỉ tải được tin cũ của Messenger, Instagram và Zalo cá nhân" }, { status: 400 });
  if (getHistoryJob(id)?.status === "running") return NextResponse.json({ ok: false, error: "Kênh này đang tải, đợi xong hoặc bấm Dừng" }, { status: 409 });
  const tokens = staticTokens(store);
  // Chạy nền: trả lời ngay, giao diện hỏi tiến độ bằng GET
  void importHistory(store, ch, { days: days as number, mode: catchup ? "catchup" : "history", hours: catchup ? body.hours : undefined, getToken: async (c) => (await tokens.get(c.id)) ?? process.env[`META_TOKEN_${c.externalId}`] ?? null, pauseMs: 150 });
  return NextResponse.json({ ok: true, job: getHistoryJob(id) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const id = (await ctx.params).id;
  return NextResponse.json({ ok: cancelHistory(id) || cancelZaloHistory(id) });
}
