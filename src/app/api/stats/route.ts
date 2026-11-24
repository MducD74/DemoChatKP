import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { statistics } from "@/core/stats";

export const dynamic = "force-dynamic";

// Admin xem tất cả; nhân viên chỉ thấy số của mình (máy chủ tự ép, bỏ qua tham số staff)
export async function GET(req: Request) {
  boot();
  const sp = new URL(req.url).searchParams;
  const now = Date.now();
  const num = (k: string, d: number) => { const v = Number(sp.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const from = num("from", now - 7 * 86400_000), to = num("to", now);
  const data = await statistics(store, actorOf(req), { from, to, channelId: sp.get("channel") || undefined, staffUid: sp.get("staff") || undefined }, now);
  return NextResponse.json(data);
}
