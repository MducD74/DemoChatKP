import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { refreshProfile } from "@/core/profile";

export const dynamic = "force-dynamic";

// POST: lấy lại tên và ảnh khách từ kênh ngay (link ảnh của Meta hết hạn, hoặc lần lấy trước lỗi). Trả lý do khi kênh không trả ảnh.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const r = await refreshProfile(store, decodeURIComponent((await ctx.params).id), actorOf(req));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
