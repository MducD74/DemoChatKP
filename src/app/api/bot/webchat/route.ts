import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { createWebChannel, updateWebChannel } from "@/core/webchat";

export const dynamic = "force-dynamic";

// Tạo (không có id) hoặc sửa (có id) khung chat trên web. Chỉ quản trị.
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { id?: string; name?: unknown; title?: unknown; greeting?: unknown; color?: unknown; origins?: unknown; position?: unknown };
  const r = b.id ? await updateWebChannel(store, String(b.id), b) : await createWebChannel(store, b);
  return NextResponse.json(r.ok ? { ok: true, id: r.channel.id } : { ok: false, error: r.error }, { status: r.ok ? 200 : 400 });
}
