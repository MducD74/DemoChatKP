import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { getChannelGroups, setChannelGroups } from "@/core/service";

export const dynamic = "force-dynamic";

// Nhóm kênh của chính người đang đăng nhập (gộp vài kênh để chọn một lần ở hộp thư)
export async function GET(req: Request) {
  boot();
  return NextResponse.json({ ok: true, groups: await getChannelGroups(store, actorOf(req).uid) });
}

export async function PUT(req: Request) {
  boot();
  const b = (await req.json().catch(() => ({}))) as { groups?: unknown };
  const r = await setChannelGroups(store, actorOf(req).uid, b.groups);
  return NextResponse.json(r, { status: r.ok ? 200 : r.code ?? 400 });
}
