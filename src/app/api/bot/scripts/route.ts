import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { deleteScript, ensureScripts, saveScript } from "@/core/botscripts";

export const dynamic = "force-dynamic";

// POST: tạo kịch bản (không có id) hoặc sửa (có id). DELETE { id }: xóa. Chỉ quản trị.
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  await ensureScripts(store);
  const r = await saveScript(store, await req.json().catch(() => ({})));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  await ensureScripts(store);
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const r = await deleteScript(store, String(id ?? ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
