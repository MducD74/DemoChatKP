import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { refreshDoc } from "@/core/botsource";

export const dynamic = "force-dynamic";

// Lấy lại nội dung của tài liệu từ link (web, Drive). POST { id }
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const r = await refreshDoc(store, String(id ?? ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
