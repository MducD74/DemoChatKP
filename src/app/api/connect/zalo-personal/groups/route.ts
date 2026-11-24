import { NextResponse } from "next/server";
import { ZALO_PERSONAL_ENABLED, ZALO_PERSONAL_OFF } from "@/core/guardrails";
import { adminOnly, boot, store } from "@/server";
import { listZaloGroups, setZaloGroups } from "@/core/zalopersonal";

export const dynamic = "force-dynamic";

// Nhóm chat của một số Zalo cá nhân. Mặc định mọi nhóm TẮT (không vào hộp thư); quản trị bật từng nhóm.
// GET ?channelId=: danh sách nhóm của số này kèm trạng thái bật. PUT { channelId, groups: [mã nhóm] }: ghi danh sách nhóm được bật.
async function zaloChannel(id: string) {
  const ch = (await store.load()).channels[id];
  return ch && ch.kind === "zalo_personal" && !ch.off ? ch : null;
}

export async function GET(req: Request) {
  boot();
  if (!ZALO_PERSONAL_ENABLED) return NextResponse.json({ ok: false, error: ZALO_PERSONAL_OFF }, { status: 403 });
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const ch = await zaloChannel(new URL(req.url).searchParams.get("channelId") ?? "");
  if (!ch) return NextResponse.json({ ok: false, error: "Không tìm thấy kênh Zalo cá nhân" }, { status: 404 });
  const r = await listZaloGroups(ch);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function PUT(req: Request) {
  boot();
  if (!ZALO_PERSONAL_ENABLED) return NextResponse.json({ ok: false, error: ZALO_PERSONAL_OFF }, { status: 403 });
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { channelId?: string; groups?: unknown };
  const ch = await zaloChannel(b.channelId ?? "");
  if (!ch) return NextResponse.json({ ok: false, error: "Không tìm thấy kênh Zalo cá nhân" }, { status: 404 });
  if (!Array.isArray(b.groups)) return NextResponse.json({ ok: false, error: "Thiếu danh sách nhóm" }, { status: 400 });
  const r = await setZaloGroups(store, ch.id, b.groups.map(String));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
