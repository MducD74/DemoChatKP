import { NextResponse } from "next/server";
import { boot, store, tiktokAdapter } from "@/server";

// Ảnh TikTok khách gửi chỉ có media_id: lấy link tải tạm rồi chuyển tiếp nội dung.
export async function GET(req: Request) {
  boot();
  const sp = new URL(req.url).searchParams;
  const ch = (await store.load()).channels[sp.get("channel") ?? ""];
  const ref = sp.get("ref") ?? "";
  const tt = tiktokAdapter();
  if (!ch || ch.kind !== "tiktok" || !tt) return NextResponse.json({ error: "không hỗ trợ" }, { status: 404 });
  const m = await tt.resolveMedia(ch, ref);
  if (!m) return NextResponse.json({ error: "không lấy được ảnh" }, { status: 502 });
  const r = await fetch(m.url, { headers: m.headers });
  if (!r.ok) return NextResponse.json({ error: "tải ảnh lỗi" }, { status: 502 });
  return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, max-age=3600" } });
}
