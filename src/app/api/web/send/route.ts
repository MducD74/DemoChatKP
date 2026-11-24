import { NextResponse } from "next/server";
import { baseUrl, boot, store } from "@/server";
import { allowedOrigin, validSid, webChannel, webSend } from "@/core/webchat";

export const dynamic = "force-dynamic";

// Khách gửi tin: { key, sid, text, name?, lang?, images?: [địa chỉ ảnh đã tải lên qua /api/web/upload] }. Nội dung gửi dạng text/plain (JSON) để trình duyệt không cần hỏi trước (preflight).
export async function POST(req: Request) {
  boot();
  const b = (await req.text().then((t) => JSON.parse(t)).catch(() => ({}))) as { key?: string; sid?: string; text?: unknown; name?: unknown; lang?: unknown; images?: unknown };
  const ch = await webChannel(store, b.key);
  if (!ch || !b.key || !validSid(b.key, b.sid)) return NextResponse.json({ ok: false, error: "Phiên không hợp lệ" }, { status: 404 });
  const origin = allowedOrigin(ch, req.headers.get("origin"));
  if (!origin) return NextResponse.json({ ok: false, error: "Website này chưa được phép" }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const r = await webSend(store, ch, b.sid as string, b, ip, Date.now(), baseUrl(req));
  return NextResponse.json(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 400, headers: { "access-control-allow-origin": origin, vary: "origin" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
}
