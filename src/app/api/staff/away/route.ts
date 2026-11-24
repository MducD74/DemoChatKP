import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { setAway } from "@/core/service";

// POST { away: boolean, uid?: string }: mặc định đổi cho chính người đang dùng
export async function POST(req: Request) {
  boot();
  const actor = actorOf(req);
  const b = (await req.json().catch(() => ({}))) as { away?: boolean; uid?: string };
  if (typeof b.away !== "boolean") return NextResponse.json({ ok: false, error: "Thiếu dữ liệu" }, { status: 400 });
  const r = await setAway(store, actor, b.uid ?? actor.uid, b.away);
  return NextResponse.json(r, { status: r.ok ? 200 : 403 });
}
