import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { deleteBrand, saveBrand } from "@/core/brands";

export const dynamic = "force-dynamic";

// Thương hiệu (chỉ quản trị). POST: tạo (không có id) hoặc sửa (có id) { name, note?, website?, channelIds }. DELETE { id }.
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await saveBrand(store, await req.json().catch(() => ({})));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const r = await deleteBrand(store, String(id ?? ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
