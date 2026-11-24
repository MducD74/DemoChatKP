import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { createBackup, defaultPaths, lastBackup, listBackups } from "@/core/backup";

export const dynamic = "force-dynamic";

// Sao lưu (chỉ quản trị). GET: danh sách bản sao lưu và lần chạy gần nhất. POST: sao lưu ngay.
// Khôi phục không làm qua API (phải dừng máy chủ): xem docs/VAN-HANH.md.
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const all = await listBackups(defaultPaths());
  return NextResponse.json({ backups: all.map(({ media, ...m }) => ({ ...m, images: media.length })), last: lastBackup() ?? null });
}

export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  try {
    const m = await createBackup(defaultPaths(), { text: await store.snapshot() });
    return NextResponse.json({ ok: true, id: m.id, counts: m.counts, images: m.media.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Sao lưu lỗi" }, { status: 500 });
  }
}
