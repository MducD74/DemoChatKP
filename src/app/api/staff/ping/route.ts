import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { touchSeen } from "@/core/service";

// Giao diện gọi mỗi phút khi đang mở KP Chat, để biết nhân viên nào đang trực tuyến
export async function POST(req: Request) {
  boot();
  const a = actorOf(req);
  if (a.role === "agent") await touchSeen(store, a.uid);
  return NextResponse.json({ ok: true });
}
