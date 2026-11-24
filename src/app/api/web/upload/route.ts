import { NextResponse } from "next/server";
import { baseUrl, boot, store } from "@/server";
import { allowedOrigin, validSid, webChannel, webUpload } from "@/core/webchat";
import { MAX_VISITOR_IMAGE } from "@/core/media";

export const dynamic = "force-dynamic";

// Khách tải ảnh lên: multipart/form-data gồm key, sid, file (jpg/png/webp, tối đa 5MB). multipart là "yêu cầu đơn giản" nên trình duyệt không hỏi trước (preflight).
export async function POST(req: Request) {
  boot();
  if (Number(req.headers.get("content-length")) > MAX_VISITOR_IMAGE + 64 * 1024) return NextResponse.json({ ok: false, error: "Ảnh lớn hơn 5MB" }, { status: 413 });
  const fd = await req.formData().catch(() => null);
  const key = fd?.get("key"), sid = fd?.get("sid"), file = fd?.get("file");
  const ch = await webChannel(store, key);
  if (!ch || typeof key !== "string" || !validSid(key, sid)) return NextResponse.json({ ok: false, error: "Phiên không hợp lệ" }, { status: 404 });
  const origin = allowedOrigin(ch, req.headers.get("origin"));
  if (!origin) return NextResponse.json({ ok: false, error: "Website này chưa được phép" }, { status: 403 });
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Chưa chọn ảnh" }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const r = await webUpload(sid as string, new Uint8Array(await file.arrayBuffer()), baseUrl(req), ip);
  return NextResponse.json(r.ok ? { ok: true, url: r.url } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status ?? 400, headers: { "access-control-allow-origin": origin, vary: "origin" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
}
