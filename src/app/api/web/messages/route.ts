import { NextResponse } from "next/server";
import { boot, store } from "@/server";
import { allowedOrigin, rateHit, validSid, webChannel, webHandoff, webMessages } from "@/core/webchat";

export const dynamic = "force-dynamic";

// Tin của một phiên khách (không gồm ghi chú nội bộ). GET ?key&sid&after=<ms>
export async function GET(req: Request) {
  boot();
  const q = new URL(req.url).searchParams;
  const key = q.get("key"), sid = q.get("sid");
  const ch = await webChannel(store, key);
  if (!ch || !key || !validSid(key, sid)) return NextResponse.json({ ok: false, error: "Phiên không hợp lệ" }, { status: 404 });
  const origin = allowedOrigin(ch, req.headers.get("origin"));
  if (!origin) return NextResponse.json({ ok: false, error: "Website này chưa được phép" }, { status: 403 });
  if (!rateHit(`poll:${sid}`, 60, 60_000)) return NextResponse.json({ ok: false, error: "Hỏi quá nhanh" }, { status: 429 });
  const after = Math.max(0, Number(q.get("after")) || 0);
  return NextResponse.json({ ok: true, messages: await webMessages(store, ch, sid, after), handoff: await webHandoff(store, ch, sid) }, { headers: { "access-control-allow-origin": origin, vary: "origin" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
}
