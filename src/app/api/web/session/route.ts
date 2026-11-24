import { NextResponse } from "next/server";
import { boot, store } from "@/server";
import { allowedOrigin, newSid, validSid, webCfg, webChannel, webHandoff, webMessages } from "@/core/webchat";

export const dynamic = "force-dynamic";

// Khóa phiên khách: nhận { key, sid? }. Có sid hợp lệ thì dùng lại, không thì cấp mới. Công khai, có kiểm website (Origin) theo cấu hình kênh.
export async function POST(req: Request) {
  boot();
  const b = (await req.text().then((t) => JSON.parse(t)).catch(() => ({}))) as { key?: string; sid?: string };
  const ch = await webChannel(store, b.key);
  if (!ch || !b.key) return NextResponse.json({ ok: false, error: "Khung chat không tồn tại" }, { status: 404 });
  const origin = allowedOrigin(ch, req.headers.get("origin"));
  if (!origin) return NextResponse.json({ ok: false, error: "Website này chưa được phép dùng khung chat" }, { status: 403 });
  const sid = validSid(b.key, b.sid) ? b.sid : newSid(b.key);
  return NextResponse.json({ ok: true, sid, config: webCfg(ch), messages: await webMessages(store, ch, sid), handoff: await webHandoff(store, ch, sid) }, { headers: { "access-control-allow-origin": origin, vary: "origin" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
}
