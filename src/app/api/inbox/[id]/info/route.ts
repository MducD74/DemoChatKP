import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { updateContactInfo } from "@/core/service";

// Sửa thông tin khách (số điện thoại, địa chỉ, khu vực) ở ô bên phải hộp thư
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const b = await req.json().catch(() => ({}));
  const r = await updateContactInfo(store, decodeURIComponent((await ctx.params).id), b, actorOf(req));
  return NextResponse.json(r, { status: r.ok ? 200 : r.code ?? 403 });
}
