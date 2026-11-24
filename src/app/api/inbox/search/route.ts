import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { searchConversations } from "@/core/service";

export const dynamic = "force-dynamic";

// Tìm khách và nội dung tin trong mọi hội thoại người này được xem. GET ?q=
export async function GET(req: Request) {
  boot();
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  return NextResponse.json({ hits: await searchConversations(store, actorOf(req), q) });
}
