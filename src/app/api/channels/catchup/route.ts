import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { getHistoryJob, importHistory } from "@/core/history";
import { staticTokens } from "@/core/token-store";

export const dynamic = "force-dynamic";

// POST { hours }: khôi phục tin bị lỡ (webhook ngắt) cho mọi kênh Messenger và Instagram đang nối. Ghi như tin mới. Chạy nền; hỏi tiến độ ở /api/channels/<id>/history.
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { hours } = (await req.json().catch(() => ({}))) as { hours?: number };
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 1 || hours > 168) return NextResponse.json({ ok: false, error: "Số giờ khôi phục phải từ 1 đến 168" }, { status: 400 });
  const tokens = staticTokens(store);
  const started: string[] = [], skipped: string[] = [];
  for (const ch of Object.values((await store.load()).channels)) {
    if (ch.off || (ch.kind !== "facebook" && ch.kind !== "instagram")) continue;
    if (getHistoryJob(ch.id)?.status === "running" || !(await tokens.get(ch.id))) { skipped.push(ch.name); continue; }
    void importHistory(store, ch, { days: 0, mode: "catchup", hours, getToken: async (c) => (await tokens.get(c.id)) ?? null, pauseMs: 150 });
    started.push(ch.name);
  }
  return NextResponse.json({ ok: true, started, skipped });
}
